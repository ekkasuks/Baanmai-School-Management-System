/**
 * Milk module — นมโรงเรียน (ไม่ใช้ PIN)
 *
 * แนวคิด: นักเรียนได้รับนมคนละ 1 กล่อง/วัน
 *  - วันที่ "ไม่มาโรงเรียน" (สถานะ ขาด/ลา จากการเช็คชื่อ) = วันนั้นยังไม่ได้รับนม → ค้าง 1 กล่อง
 *  - (สาย = มาโรงเรียนแล้ว ถือว่ารับนม; มา = รับนมปกติ ไม่ค้าง)
 *  - ค้างสะสมต่อเนื่องจนกว่าจะกด "ได้รับนมแล้ว" (เคลียร์ backlog รายคน) หรือ "ล้างทั้งโรงเรียน"
 *
 * ยอดค้าง = คำนวณสด ๆ จาก ATTENDANCE (ไม่เก็บ counter) เทียบกับ watermark ใน MILK_LOG
 *  - clear รายคน: date = วันเคลียร์ถึง (through-date) ของคนนั้น
 *  - reset_all: date = วันเคลียร์ถึงของทั้งโรงเรียน
 *  - วันไม่มาที่ date > watermark เท่านั้นที่นับเป็นยอดค้าง
 */

const MILK_ABSENT_STATUSES = ['ขาด', 'ลา']; // ไม่มาโรงเรียน → ไม่ได้รับนม

const MilkAPI = {

  /** หน้าแรก — จำนวนนักเรียนที่ยังไม่ได้รับนม + จำนวนกล่องค้าง แยกตามชั้น */
  dashboard: function (params) {
    return cachedResult('milk.dash', ['STUDENTS', 'ATTENDANCE', 'MILK_LOG'], 90, function () {
      const pend = computeMilkPending();
      const stIndex = buildIndex('STUDENTS', 'citizen_id');

      const gradeMap = {};
      let totalStudents = 0, totalBoxes = 0;
      Object.keys(pend.pending).forEach(function (cid) {
        const s = stIndex[cid];
        if (!s || s.status === 'inactive') return;   // ข้ามนักเรียนที่ลบ/ไม่พบ
        const boxes = pend.pending[cid];
        const grade = s.grade || '-';
        const room = (s.room === undefined || s.room === null) ? '' : String(s.room);
        const key = grade + '|' + room;
        if (!gradeMap[key]) gradeMap[key] = { grade: grade, room: room, students: 0, boxes: 0 };
        gradeMap[key].students++;
        gradeMap[key].boxes += boxes;
        totalStudents++;
        totalBoxes += boxes;
      });

      const byClass = Object.keys(gradeMap).map(function (k) { return gradeMap[k]; })
        .sort(function (a, b) {
          const d = gradeSortKey(a.grade) - gradeSortKey(b.grade);
          return d !== 0 ? d : (parseInt(a.room, 10) || 0) - (parseInt(b.room, 10) || 0);
        });

      return {
        date: today(),
        total_pending_students: totalStudents,
        total_pending_boxes: totalBoxes,
        by_class: byClass,
      };
    });
  },

  /** รายชื่อชั้น/ห้อง สำหรับ dropdown เรียกดูรายชั้น */
  classes: function () {
    return { classes: listClasses() };
  },

  /** รายชื่อนักเรียนที่ยังค้างรับนม (กรองตามชั้น/ห้องได้) — เรียงกล่องค้างมาก→น้อย */
  pending: function (params) {
    const p = params || {};
    return cachedResult('milk.pending:' + (p.grade || '') + ':' + (p.room || ''),
      ['STUDENTS', 'ATTENDANCE', 'MILK_LOG'], 90, function () {
        const pend = computeMilkPending();
        const stIndex = buildIndex('STUDENTS', 'citizen_id');

        let list = Object.keys(pend.pending).map(function (cid) {
          const s = stIndex[cid];
          if (!s || s.status === 'inactive') return null;
          return {
            citizen_id: s.citizen_id, student_code: s.student_code, name: studentName(s),
            grade: s.grade, room: s.room,
            pending_boxes: pend.pending[cid],
            last_absent: pend.lastAbsent[cid] || '',
          };
        }).filter(Boolean);

        if (p.grade) list = list.filter(function (e) { return e.grade === p.grade; });
        if (p.room) list = list.filter(function (e) { return String(e.room) === String(p.room); });

        list.sort(function (a, b) {
          if (b.pending_boxes !== a.pending_boxes) return b.pending_boxes - a.pending_boxes;
          return String(a.name).localeCompare(String(b.name), 'th');
        });

        return { count: list.length, boxes: list.reduce(function (s, e) { return s + e.pending_boxes; }, 0), students: list };
      });
  },

  /** กด "ได้รับนมแล้ว" — เคลียร์ยอดค้างของนักเรียน 1 คน (บันทึกจำนวนที่จ่าย) */
  mark_received: function (params) {
    const cid = params.citizen_id;
    if (!cid) apiError('VALIDATION', 'กรุณาระบุนักเรียน');
    const s = buildIndex('STUDENTS', 'citizen_id')[String(cid)];
    if (!s) apiError('NOT_FOUND', 'ไม่พบนักเรียน');

    const pend = computeMilkPending();
    const boxes = pend.pending[String(cid)] || 0;
    if (boxes <= 0) apiError('VALIDATION', 'นักเรียนคนนี้ไม่มียอดนมค้าง');

    appendRows('MILK_LOG', [{
      milk_id: genId('MILK'), date: today(), citizen_id: cid, boxes: boxes,
      type: 'clear', note: params.note || '', recorded_by: params.recorded_by || 'admin', created_at: now(),
    }]);
    audit('milk', 'RECEIVE', cid, { boxes: boxes }, params.recorded_by);
    return { citizen_id: cid, name: studentName(s), cleared_boxes: boxes };
  },

  /** ล้างยอดนมค้างทั้งโรงเรียน — ตั้ง watermark วันนี้ให้ทุกคน (ยอดค้างก่อนวันนี้ถือว่าจัดการแล้ว) */
  reset_all: function (params) {
    appendRows('MILK_LOG', [{
      milk_id: genId('MILK'), date: today(), citizen_id: '', boxes: 0,
      type: 'reset_all', note: params.note || '', recorded_by: params.recorded_by || 'admin', created_at: now(),
    }]);
    audit('milk', 'RESET_ALL', today(), {}, params.recorded_by);
    return { ok: true, through: today() };
  },

  /** ประวัติการจ่ายนมค้าง (clear) — ล่าสุดก่อน */
  history: function (params) {
    const p = params || {};
    const stIndex = buildIndex('STUDENTS', 'citizen_id');
    let rows = readAll('MILK_LOG').filter(function (r) { return r.type === 'clear'; });
    if (p.citizen_id) rows = rows.filter(function (r) { return String(r.citizen_id) === String(p.citizen_id); });
    rows.sort(function (a, b) { return String(b.created_at).localeCompare(String(a.created_at)); });
    const limit = Math.min(parseInt(p.limit, 10) || 200, 500);
    rows = rows.slice(0, limit).map(function (r) {
      const s = stIndex[String(r.citizen_id)];
      return {
        milk_id: r.milk_id, date: toYmd(r.date), citizen_id: r.citizen_id,
        name: s ? studentName(s) : '(ไม่พบ)', grade: s ? s.grade : '', room: s ? s.room : '',
        boxes: Number(r.boxes) || 0, recorded_by: r.recorded_by, created_at: r.created_at,
      };
    });
    return { records: rows };
  },
};

/* ── helpers ── */

/** watermark การเคลียร์: { resetAll: 'YYYY-MM-DD', perStudent: {cid -> 'YYYY-MM-DD'} } */
function milkWatermarks() {
  let resetAll = '';
  const perStudent = {};
  readAll('MILK_LOG').forEach(function (r) {
    const d = toYmd(r.date);
    if (r.type === 'reset_all') {
      if (d > resetAll) resetAll = d;
    } else if (r.type === 'clear') {
      const cid = String(r.citizen_id);
      if (!perStudent[cid] || d > perStudent[cid]) perStudent[cid] = d;
    }
  });
  return { resetAll: resetAll, perStudent: perStudent };
}

/**
 * ยอดนมค้างของทุกคน — นับวัน "ไม่มา" (ขาด/ลา) ที่ date > watermark และ <= วันนี้
 * คืน { pending: {cid -> จำนวนกล่อง}, lastAbsent: {cid -> วันไม่มาล่าสุด} }
 */
function computeMilkPending() {
  const wm = milkWatermarks();
  const td = today();
  const pending = {};
  const lastAbsent = {};
  readAll('ATTENDANCE').forEach(function (a) {
    if (MILK_ABSENT_STATUSES.indexOf(a.status) < 0) return;
    const d = toYmd(a.date);
    if (!d || d > td) return;
    const cid = String(a.citizen_id);
    const sw = wm.perStudent[cid] || '';
    const floor = sw > wm.resetAll ? sw : wm.resetAll;   // watermark = max(รายคน, ทั้งโรงเรียน)
    if (floor && d <= floor) return;                     // เคลียร์ไปแล้ว
    pending[cid] = (pending[cid] || 0) + 1;
    if (!lastAbsent[cid] || d > lastAbsent[cid]) lastAbsent[cid] = d;
  });
  return { pending: pending, lastAbsent: lastAbsent };
}
