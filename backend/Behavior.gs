/**
 * Behavior module — พฤติกรรมนักเรียน (ไม่ใช้ PIN)
 *
 * ทุกคนเริ่ม behavior_start (20) คะแนน/เดือน
 * คะแนนเดือนปัจจุบัน = behavior_start + ผลรวม points_change ของ year_month นั้น
 * วันที่ 1 ของเดือนใหม่ → ยังไม่มี log → คะแนน = 20 อัตโนมัติ (รีเซ็ตโดยปริยาย)
 *
 * BEHAVIOR_MASTER = รายการพฤติกรรม (add/deduct) ตั้งค่าได้
 * BEHAVIOR_LOG    = บันทึกการให้/หักคะแนนรายครั้ง
 */

const BehaviorAPI = {

  /** รายการพฤติกรรมทั้งหมด — seed ค่าเริ่มต้นถ้ายังว่าง */
  master_list: function (params) {
    let items = readAll('BEHAVIOR_MASTER');
    if (!items.length) {
      seedBehaviorMaster();
      items = readAll('BEHAVIOR_MASTER');
    }
    const includeInactive = params && params.include_inactive;
    items = items
      .filter(function (it) { return includeInactive || String(it.active) !== 'false'; })
      .map(function (it) {
        return {
          item_id: it.item_id, type: it.type, name: it.name,
          points: Number(it.points) || 0,
          active: String(it.active) !== 'false',
        };
      });
    // เพิ่มก่อน แล้วหักทีหลัง · เรียงตามชื่อ
    items.sort(function (a, b) {
      if (a.type !== b.type) return a.type === 'add' ? -1 : 1;
      return String(a.name).localeCompare(String(b.name), 'th');
    });
    return { items: items };
  },

  /**
   * เพิ่ม/แก้ไขรายการพฤติกรรม
   * params = { item_id?, type:'add'|'deduct', name, points, active?, recorded_by }
   */
  master_save: function (params) {
    const type = params.type;
    const name = String(params.name || '').trim();
    let points = Math.abs(parseInt(params.points, 10));
    if (type !== 'add' && type !== 'deduct') apiError('VALIDATION', 'ประเภทต้องเป็น add หรือ deduct');
    if (!name) apiError('VALIDATION', 'กรุณาระบุชื่อรายการ');
    if (!isFinite(points) || points <= 0) apiError('VALIDATION', 'คะแนนต้องมากกว่า 0');

    const active = params.active === undefined ? true : (params.active !== false && params.active !== 'false');
    let itemId = params.item_id;

    if (itemId) {
      const rowIdx = findRowIndex('BEHAVIOR_MASTER', 'item_id', itemId);
      if (rowIdx < 0) apiError('NOT_FOUND', 'ไม่พบรายการพฤติกรรม');
      updateRow('BEHAVIOR_MASTER', rowIdx, { type: type, name: name, points: points, active: active });
      audit('behavior', 'MASTER_UPDATE', itemId, { type: type, name: name, points: points, active: active }, params.recorded_by);
    } else {
      itemId = genBehaviorItemId();
      appendRows('BEHAVIOR_MASTER', [{ item_id: itemId, type: type, name: name, points: points, active: active }]);
      audit('behavior', 'MASTER_CREATE', itemId, { type: type, name: name, points: points }, params.recorded_by);
    }
    return { item_id: itemId };
  },

  /** ปิดการใช้งานรายการ (soft delete — เก็บประวัติ log ไว้) */
  master_delete: function (params) {
    if (!params.item_id) apiError('VALIDATION', 'ไม่ได้ระบุรายการ');
    const rowIdx = findRowIndex('BEHAVIOR_MASTER', 'item_id', params.item_id);
    if (rowIdx < 0) apiError('NOT_FOUND', 'ไม่พบรายการพฤติกรรม');
    updateRow('BEHAVIOR_MASTER', rowIdx, { active: false });
    audit('behavior', 'MASTER_DELETE', params.item_id, {}, params.recorded_by);
    return { ok: true };
  },

  /** รายชื่อชั้น/ห้อง สำหรับ dropdown เลือกชั้น */
  classes: function () {
    return { classes: listClasses() };
  },

  /** นักเรียนในชั้น/ห้อง + คะแนนของเดือนที่ระบุ (สำหรับเลือกบันทึก) */
  by_class: function (params) {
    if (!params.grade) apiError('VALIDATION', 'กรุณาเลือกชั้นเรียน');
    const ym = params.year_month || yearMonth();
    const ms = monthScores(ym);
    const results = studentsInClass(params.grade, params.room).map(function (s) {
      return {
        citizen_id: s.citizen_id, student_code: s.student_code, name: studentName(s),
        grade: s.grade, room: s.room, score: ms.start + (ms.sums[String(s.citizen_id)] || 0),
      };
    });
    results.sort(function (a, b) { return String(a.name).localeCompare(String(b.name), 'th'); });
    return { results: results };
  },

  /** ค้นหานักเรียน + คะแนนเดือนปัจจุบัน (สำหรับเลือกบันทึก) */
  search: function (params) {
    const q = String(params.q || '').trim().toLowerCase();
    if (!q) return { results: [] };
    const ym = params.year_month || yearMonth();
    const ms = monthScores(ym);

    const results = [];
    const rows = readAll('STUDENTS');
    for (let i = 0; i < rows.length && results.length < 20; i++) {
      const s = rows[i];
      if (s.status === 'inactive') continue;
      const hay = (studentName(s) + ' ' + s.student_code + ' ' + s.citizen_id).toLowerCase();
      if (hay.indexOf(q) < 0) continue;
      results.push({
        citizen_id: s.citizen_id, student_code: s.student_code,
        name: studentName(s), grade: s.grade, room: s.room,
        score: ms.start + (ms.sums[String(s.citizen_id)] || 0),
      });
    }
    return { results: results };
  },

  /**
   * บันทึกพฤติกรรม 1 รายการ
   * params = { citizen_id, item_id, note, recorded_by, date? }
   */
  record: function (params) {
    const cid = params.citizen_id;
    const itemId = params.item_id;
    if (!cid) apiError('VALIDATION', 'กรุณาระบุนักเรียน');
    if (!itemId) apiError('VALIDATION', 'กรุณาเลือกรายการพฤติกรรม');

    const student = buildIndex('STUDENTS', 'citizen_id')[String(cid)];
    if (!student) apiError('NOT_FOUND', 'ไม่พบนักเรียน');

    const item = buildIndex('BEHAVIOR_MASTER', 'item_id')[String(itemId)];
    if (!item) apiError('NOT_FOUND', 'ไม่พบรายการพฤติกรรม');

    const points = Math.abs(Number(item.points) || 0);
    const change = item.type === 'add' ? points : -points;

    const lock = LockService.getScriptLock();
    lock.waitLock(15000);
    try {
      const date = params.date ? toYmd(params.date) : today();
      const ym = toYm(date);
      const ms = monthScores(ym);
      const current = ms.start + (ms.sums[String(cid)] || 0);
      const pointsAfter = current + change;

      const logId = genId('BHV');
      appendRows('BEHAVIOR_LOG', [{
        log_id: logId, date: date, year_month: ym, citizen_id: cid, item_id: itemId,
        points_change: change, points_after: pointsAfter,
        note: params.note || '', recorded_by: params.recorded_by || 'admin', created_at: now(),
      }]);

      audit('behavior', 'RECORD', logId,
        { citizen_id: cid, item_id: itemId, points_change: change, points_after: pointsAfter }, params.recorded_by);

      return {
        log_id: logId, date: date, year_month: ym,
        item_name: item.name, item_type: item.type,
        points_change: change, points_after: pointsAfter,
        student: { name: studentName(student), grade: student.grade, room: student.room, student_code: student.student_code },
      };
    } finally {
      lock.releaseLock();
    }
  },

  /** คะแนน + รายการของนักเรียน 1 คน ในเดือนที่ระบุ (default เดือนปัจจุบัน) */
  student_score: function (params) {
    const cid = params.citizen_id;
    if (!cid) apiError('VALIDATION', 'กรุณาระบุนักเรียน');
    const s = buildIndex('STUDENTS', 'citizen_id')[String(cid)];
    if (!s) apiError('NOT_FOUND', 'ไม่พบนักเรียน');

    const ym = params.year_month || yearMonth();
    const start = behaviorStart();
    const itemIndex = buildIndex('BEHAVIOR_MASTER', 'item_id');

    const logs = readAll('BEHAVIOR_LOG')
      .filter(function (l) { return String(l.citizen_id) === String(cid) && toYm(l.year_month) === ym; })
      .sort(function (a, b) { return String(a.created_at).localeCompare(String(b.created_at)); })
      .map(function (l) {
        const it = itemIndex[String(l.item_id)];
        return {
          log_id: l.log_id, date: l.date, item_name: it ? it.name : '(ลบแล้ว)',
          points_change: Number(l.points_change) || 0, points_after: Number(l.points_after) || 0,
          note: l.note, recorded_by: l.recorded_by, created_at: l.created_at,
        };
      });

    const score = logs.length ? logs[logs.length - 1].points_after : start;
    return {
      student: { citizen_id: s.citizen_id, student_code: s.student_code, name: studentName(s), grade: s.grade, room: s.room },
      year_month: ym, start: start, score: score, logs: logs,
    };
  },

  /** ประวัติการบันทึก — กรองตามเดือน/ชั้น/นักเรียน/ประเภท */
  history: function (params) {
    const p = params || {};
    const stIndex = buildIndex('STUDENTS', 'citizen_id');
    const itemIndex = buildIndex('BEHAVIOR_MASTER', 'item_id');
    let rows = readAll('BEHAVIOR_LOG');

    if (p.year_month) rows = rows.filter(function (l) { return toYm(l.year_month) === p.year_month; });
    if (p.citizen_id) rows = rows.filter(function (l) { return String(l.citizen_id) === String(p.citizen_id); });
    if (p.type) {
      rows = rows.filter(function (l) {
        const c = Number(l.points_change) || 0;
        return p.type === 'add' ? c > 0 : c < 0;
      });
    }
    if (p.grade) {
      rows = rows.filter(function (l) {
        const s = stIndex[String(l.citizen_id)];
        return s && s.grade === p.grade;
      });
    }

    rows.sort(function (a, b) { return String(b.created_at).localeCompare(String(a.created_at)); });
    const limit = Math.min(parseInt(p.limit, 10) || 100, 500);
    const total = rows.length;
    rows = rows.slice(0, limit).map(function (l) {
      const s = stIndex[String(l.citizen_id)];
      const it = itemIndex[String(l.item_id)];
      return {
        log_id: l.log_id, date: l.date, year_month: l.year_month, citizen_id: l.citizen_id,
        name: s ? studentName(s) : '(ไม่พบ)', grade: s ? s.grade : '', room: s ? s.room : '',
        item_name: it ? it.name : '(ลบแล้ว)',
        points_change: Number(l.points_change) || 0, points_after: Number(l.points_after) || 0,
        note: l.note, recorded_by: l.recorded_by, created_at: l.created_at,
      };
    });
    return { logs: rows, total: total, returned: rows.length };
  },

  /** อันดับคะแนนรายเดือน (นักเรียน active) — เรียงมาก→น้อย */
  ranking: function (params) {
    const ym = (params && params.year_month) || yearMonth();
    const grade = (params && params.grade) || '';
    return cachedResult('bhv.rank:' + ym + ':' + grade, ['STUDENTS', 'BEHAVIOR_LOG'], 90, function () {
    const ms = monthScores(ym);
    const students = readAll('STUDENTS').filter(function (s) { return s.status !== 'inactive'; });

    let list = students.map(function (s) {
      return {
        citizen_id: s.citizen_id, student_code: s.student_code, name: studentName(s),
        grade: s.grade, room: s.room,
        score: ms.start + (ms.sums[String(s.citizen_id)] || 0),
      };
    });
    if (params && params.grade) list = list.filter(function (e) { return e.grade === params.grade; });

    list.sort(function (a, b) {
      if (b.score !== a.score) return b.score - a.score;
      return String(a.name).localeCompare(String(b.name), 'th');
    });
    list.forEach(function (e, i) { e.rank = i + 1; });

    return { year_month: ym, start: ms.start, ranking: list };
    });
  },

  /** Dashboard — เฉลี่ย, การกระจายคะแนน, เฉลี่ยรายชั้น, สูงสุด/ต่ำสุด */
  dashboard: function (params) {
    const ym = (params && params.year_month) || yearMonth();
    return cachedResult('bhv.dash:' + ym, ['STUDENTS', 'BEHAVIOR_LOG'], 90, function () {
    const ms = monthScores(ym);
    const students = readAll('STUDENTS').filter(function (s) { return s.status !== 'inactive'; });

    const enriched = students.map(function (s) {
      return {
        citizen_id: s.citizen_id, name: studentName(s), grade: s.grade, room: s.room,
        score: ms.start + (ms.sums[String(s.citizen_id)] || 0),
      };
    });

    let sum = 0;
    const gradeMap = {};
    const dist = { excellent: 0, good: 0, fair: 0, watch: 0 }; // >=20 / 15-19 / 10-14 / <10
    enriched.forEach(function (e) {
      sum += e.score;
      const g = e.grade || '-';
      if (!gradeMap[g]) gradeMap[g] = { grade: g, total: 0, count: 0 };
      gradeMap[g].total += e.score;
      gradeMap[g].count += 1;
      if (e.score >= 20) dist.excellent++;
      else if (e.score >= 15) dist.good++;
      else if (e.score >= 10) dist.fair++;
      else dist.watch++;
    });

    const byGrade = Object.keys(gradeMap).map(function (g) {
      const o = gradeMap[g];
      return { grade: g, avg: o.count ? Math.round((o.total / o.count) * 100) / 100 : 0, count: o.count };
    });

    const sorted = enriched.slice().sort(function (a, b) { return b.score - a.score; });
    const top = sorted.slice(0, 5);
    // "ควรดูแลเป็นพิเศษ" — เฉพาะนักเรียนที่ถูกหักคะแนนจริง (ต่ำกว่าคะแนนเริ่มต้น) เท่านั้น
    // นักเรียนที่ยังคงคะแนนเต็ม (= start) ไม่ถือว่าต้องดูแล จึงไม่ขึ้นรายชื่อ
    const bottom = sorted.slice().reverse().filter(function (e) { return e.score < ms.start; }).slice(0, 5);

    // จำนวนการบันทึกในเดือนนี้
    let recordCount = 0;
    readAll('BEHAVIOR_LOG').forEach(function (l) { if (toYm(l.year_month) === ym) recordCount++; });

    return {
      year_month: ym,
      start: ms.start,
      student_count: enriched.length,
      avg_score: enriched.length ? Math.round((sum / enriched.length) * 100) / 100 : ms.start,
      record_count: recordCount,
      distribution: dist,
      by_grade: byGrade,
      top: top,
      bottom: bottom,
    };
    });
  },
};

/* ── helpers ── */

/** คะแนนเริ่มต้นรายเดือนจาก SETTINGS (default 20) */
function behaviorStart() {
  const v = parseInt(SettingsAPI.get_raw('behavior_start'), 10);
  return isFinite(v) ? v : 20;
}

/** { start, sums:{ citizen_id -> ผลรวม points_change ของเดือน ym } } */
function monthScores(ym) {
  const sums = {};
  readAll('BEHAVIOR_LOG').forEach(function (l) {
    if (toYm(l.year_month) !== ym) return;
    const cid = String(l.citizen_id);
    sums[cid] = (sums[cid] || 0) + (Number(l.points_change) || 0);
  });
  return { start: behaviorStart(), sums: sums };
}

/** id แบบ B001, B002, ... (อิงเลขสูงสุดเดิม) */
function genBehaviorItemId() {
  let max = 0;
  readAll('BEHAVIOR_MASTER').forEach(function (it) {
    const m = String(it.item_id).match(/^B(\d+)$/);
    if (m) max = Math.max(max, parseInt(m[1], 10));
  });
  return 'B' + ('00' + (max + 1)).slice(-3);
}

/** สร้างรายการพฤติกรรมตัวอย่างเมื่อยังไม่มีข้อมูล */
function seedBehaviorMaster() {
  const defaults = [
    { type: 'add', name: 'ช่วยงานครู', points: 2 },
    { type: 'add', name: 'ทำความดี / จิตอาสา', points: 2 },
    { type: 'add', name: 'ตอบคำถาม / ตั้งใจเรียน', points: 1 },
    { type: 'add', name: 'แต่งกายเรียบร้อย', points: 1 },
    { type: 'deduct', name: 'มาสาย', points: 1 },
    { type: 'deduct', name: 'ไม่ส่งการบ้าน', points: 2 },
    { type: 'deduct', name: 'ไม่แต่งกายตามระเบียบ', points: 2 },
    { type: 'deduct', name: 'ทะเลาะวิวาท', points: 5 },
  ];
  const rows = defaults.map(function (d, i) {
    return { item_id: 'B' + ('00' + (i + 1)).slice(-3), type: d.type, name: d.name, points: d.points, active: true };
  });
  appendRows('BEHAVIOR_MASTER', rows);
}
