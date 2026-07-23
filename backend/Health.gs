/**
 * Health module — ตรวจสุขภาพ/สุขอนามัย (ไม่ใช้ PIN)
 *
 * 5 รายการ: ผม (hair), เล็บ (nails), แก้วน้ำ (cup), แปรงสีฟัน (toothbrush), ยาสีฟัน (toothpaste)
 * ค่า: 'ผ่าน' | 'ไม่ผ่าน'
 * Unique = (date, citizen_id) — บันทึกซ้ำในวันเดียวจะ "อัปเดต" ไม่เพิ่มแถวใหม่
 *
 * ใช้งานแบบรายชั้น: เลือกชั้น → ตรวจทั้งห้อง → บันทึกทีเดียว (save)
 */

const HEALTH_ITEMS = ['hair', 'nails', 'cup', 'toothbrush', 'toothpaste'];

const HealthAPI = {

  /** รายชื่อชั้น/ห้อง สำหรับ dropdown */
  classes: function () {
    return { classes: listClasses() };
  },

  /**
   * นักเรียนในชั้น + ผลตรวจของวันที่ระบุ (เพื่อ pre-fill ฟอร์ม)
   * params = { grade, room, date? }
   */
  by_class: function (params) {
    if (!params.grade) apiError('VALIDATION', 'กรุณาเลือกชั้นเรียน');
    const date = params.date ? toYmd(params.date) : today();
    const checkIndex = {};
    readAll('HEALTH_CHECK').forEach(function (c) {
      if (toYmd(c.date) === date) checkIndex[String(c.citizen_id)] = c;
    });

    const results = studentsInClass(params.grade, params.room).map(function (s) {
      const c = checkIndex[String(s.citizen_id)];
      const o = {
        citizen_id: s.citizen_id, student_code: s.student_code, name: studentName(s),
        grade: s.grade, room: s.room, checked: !!c, note: c ? c.note : '',
      };
      HEALTH_ITEMS.forEach(function (k) { o[k] = c ? (c[k] || 'ผ่าน') : 'ผ่าน'; });
      return o;
    });
    results.sort(function (a, b) { return String(a.name).localeCompare(String(b.name), 'th'); });
    return { date: date, results: results };
  },

  /**
   * บันทึกผลตรวจ (รับได้ทีละหลายคน) — upsert ตาม (date, citizen_id)
   * params = { date?, records:[{citizen_id, hair, nails, cup, toothbrush, toothpaste, note}], recorded_by }
   */
  save: function (params) {
    const records = params.records;
    if (!Array.isArray(records) || !records.length) apiError('VALIDATION', 'ไม่มีข้อมูลให้บันทึก');
    const date = params.date ? toYmd(params.date) : today();
    const ts = now();
    const by = params.recorded_by || 'admin';

    const lock = LockService.getScriptLock();
    lock.waitLock(15000);
    try {
      const sh = getSheet('HEALTH_CHECK');
      const headers = SHEETS.HEALTH_CHECK.headers;
      const lastRow = sh.getLastRow();
      const keyToRow = {};
      if (lastRow > 1) {
        const dateCol = headers.indexOf('date') + 1;
        const cidCol = headers.indexOf('citizen_id') + 1;
        const dates = sh.getRange(2, dateCol, lastRow - 1, 1).getValues();
        const cids = sh.getRange(2, cidCol, lastRow - 1, 1).getValues();
        for (let i = 0; i < dates.length; i++) {
          keyToRow[toYmd(dates[i][0]) + '|' + String(cids[i][0])] = i + 2;
        }
      }

      const inserts = [];
      let updated = 0;
      records.forEach(function (r) {
        if (!r.citizen_id) return;
        const rec = {
          date: date, citizen_id: r.citizen_id,
          note: r.note || '', recorded_by: by, created_at: ts,
        };
        HEALTH_ITEMS.forEach(function (k) { rec[k] = r[k] === 'ไม่ผ่าน' ? 'ไม่ผ่าน' : 'ผ่าน'; });

        const existRow = keyToRow[date + '|' + String(r.citizen_id)];
        if (existRow) {
          updateRow('HEALTH_CHECK', existRow, rec);
          updated++;
        } else {
          rec.check_id = genId('HC');
          inserts.push(rec);
        }
      });
      if (inserts.length) appendRows('HEALTH_CHECK', inserts);

      audit('health', 'SAVE', date, { date: date, inserted: inserts.length, updated: updated }, by);
      return { date: date, inserted: inserts.length, updated: updated };
    } finally {
      lock.releaseLock();
    }
  },

  /** ประวัติผลตรวจ — กรองตามวันที่/ชั้น/นักเรียน */
  history: function (params) {
    const p = params || {};
    const stIndex = buildIndex('STUDENTS', 'citizen_id');
    let rows = readAll('HEALTH_CHECK');

    if (p.date) rows = rows.filter(function (c) { return toYmd(c.date) === toYmd(p.date); });
    if (p.date_from) rows = rows.filter(function (c) { return toYmd(c.date) >= p.date_from; });
    if (p.date_to) rows = rows.filter(function (c) { return toYmd(c.date) <= p.date_to; });
    if (p.citizen_id) rows = rows.filter(function (c) { return String(c.citizen_id) === String(p.citizen_id); });
    if (p.grade) {
      rows = rows.filter(function (c) {
        const s = stIndex[String(c.citizen_id)];
        return s && s.grade === p.grade;
      });
    }
    if (p.only_fail) {
      rows = rows.filter(function (c) {
        return HEALTH_ITEMS.some(function (k) { return c[k] === 'ไม่ผ่าน'; });
      });
    }

    rows.sort(function (a, b) { return String(b.created_at).localeCompare(String(a.created_at)); });
    const limit = Math.min(parseInt(p.limit, 10) || 200, 600);
    const total = rows.length;
    rows = rows.slice(0, limit).map(function (c) {
      const s = stIndex[String(c.citizen_id)];
      const o = {
        check_id: c.check_id, date: c.date, citizen_id: c.citizen_id,
        name: s ? studentName(s) : '(ไม่พบ)', grade: s ? s.grade : '', room: s ? s.room : '',
        note: c.note, recorded_by: c.recorded_by,
        fail_count: 0,
      };
      HEALTH_ITEMS.forEach(function (k) {
        o[k] = c[k] || '';
        if (c[k] === 'ไม่ผ่าน') o.fail_count++;
      });
      return o;
    });
    return { checks: rows, total: total, returned: rows.length };
  },

  /** Dashboard — ผ่าน/ไม่ผ่านรายข้อ, ภาพรวม, รายชั้น, รายชื่อที่ไม่ผ่าน (ของวันที่ระบุ) */
  dashboard: function (params) {
    const date = (params && params.date) ? toYmd(params.date) : today();
    return cachedResult('health.dash:' + date, ['HEALTH_CHECK', 'STUDENTS'], 90, function () {
    const stIndex = buildIndex('STUDENTS', 'citizen_id');
    const checks = readAll('HEALTH_CHECK').filter(function (c) { return toYmd(c.date) === date; });

    const totalStudents = readAll('STUDENTS').filter(function (s) { return s.status !== 'inactive'; }).length;

    // ผ่าน/ไม่ผ่านรายข้อ
    const byItem = {};
    HEALTH_ITEMS.forEach(function (k) { byItem[k] = { pass: 0, fail: 0 }; });

    const gradeMap = {};
    const failList = [];
    let totalPass = 0, totalCells = 0;

    checks.forEach(function (c) {
      const s = stIndex[String(c.citizen_id)];
      const g = s ? (s.grade || '-') : '-';
      if (!gradeMap[g]) gradeMap[g] = { grade: g, pass: 0, fail: 0 };

      let studentFails = [];
      HEALTH_ITEMS.forEach(function (k) {
        const v = c[k];
        if (v === 'ไม่ผ่าน') { byItem[k].fail++; gradeMap[g].fail++; totalCells++; studentFails.push(k); }
        else if (v === 'ผ่าน') { byItem[k].pass++; gradeMap[g].pass++; totalPass++; totalCells++; }
      });
      if (studentFails.length) {
        failList.push({
          citizen_id: c.citizen_id, name: s ? studentName(s) : '(ไม่พบ)',
          grade: s ? s.grade : '', room: s ? s.room : '', fails: studentFails,
        });
      }
    });

    const byGrade = Object.keys(gradeMap).map(function (g) {
      const o = gradeMap[g];
      const tot = o.pass + o.fail;
      o.pass_rate = tot ? Math.round((o.pass / tot) * 1000) / 10 : 0;
      return o;
    });

    return {
      date: date,
      total_students: totalStudents,
      checked_count: checks.length,
      not_checked: Math.max(totalStudents - checks.length, 0),
      overall_pass_rate: totalCells ? Math.round((totalPass / totalCells) * 1000) / 10 : 0,
      by_item: byItem,
      by_grade: byGrade,
      fail_list: failList,
    };
    });
  },
};
