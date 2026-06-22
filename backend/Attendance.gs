/**
 * Attendance module — เช็คการมาเรียน (ต้องใช้ PIN: attendance)
 *
 * สถานะ: มา / ขาด / ลา / สาย
 * Unique = (date, citizen_id) — เช็คซ้ำในวันเดียวจะ "อัปเดต" ไม่เพิ่มแถว
 * ใช้งานแบบรายชั้น: เลือกชั้น → เช็คทั้งห้อง → บันทึกทีเดียว (save)
 */

const ATT_STATUSES = ['มา', 'ขาด', 'ลา', 'สาย'];

const AttendanceAPI = {

  /** รายชื่อชั้น/ห้อง สำหรับ dropdown */
  classes: function (params, ctx) {
    requirePin(ctx, 'attendance');
    return { classes: listClasses() };
  },

  /**
   * นักเรียนในชั้น + สถานะของวันที่ระบุ (pre-fill, default 'มา')
   * params = { grade, room, date? }
   */
  by_class: function (params, ctx) {
    requirePin(ctx, 'attendance');
    if (!params.grade) apiError('VALIDATION', 'กรุณาเลือกชั้นเรียน');
    const date = params.date || today();
    const attIndex = {};
    readAll('ATTENDANCE').forEach(function (a) {
      if (String(a.date) === date) attIndex[String(a.citizen_id)] = a;
    });

    const results = studentsInClass(params.grade, params.room).map(function (s) {
      const a = attIndex[String(s.citizen_id)];
      return {
        citizen_id: s.citizen_id, student_code: s.student_code, name: studentName(s),
        grade: s.grade, room: s.room, checked: !!a,
        status: a ? (a.status || 'มา') : 'มา', note: a ? a.note : '',
      };
    });
    results.sort(function (a, b) { return String(a.name).localeCompare(String(b.name), 'th'); });
    return { date: date, results: results };
  },

  /**
   * บันทึกการเช็คชื่อ (รับได้ทีละหลายคน) — upsert ตาม (date, citizen_id)
   * params = { date?, records:[{citizen_id, status, note}], recorded_by }
   */
  save: function (params, ctx) {
    requirePin(ctx, 'attendance');
    const records = params.records;
    if (!Array.isArray(records) || !records.length) apiError('VALIDATION', 'ไม่มีข้อมูลให้บันทึก');
    const date = params.date || today();
    const ts = now();
    const by = params.recorded_by || 'admin';

    const lock = LockService.getScriptLock();
    lock.waitLock(15000);
    try {
      const sh = getSheet('ATTENDANCE');
      const headers = SHEETS.ATTENDANCE.headers;
      const lastRow = sh.getLastRow();
      const keyToRow = {};
      if (lastRow > 1) {
        const dateCol = headers.indexOf('date') + 1;
        const cidCol = headers.indexOf('citizen_id') + 1;
        const dates = sh.getRange(2, dateCol, lastRow - 1, 1).getValues();
        const cids = sh.getRange(2, cidCol, lastRow - 1, 1).getValues();
        for (let i = 0; i < dates.length; i++) {
          keyToRow[String(dates[i][0]) + '|' + String(cids[i][0])] = i + 2;
        }
      }

      const inserts = [];
      let updated = 0;
      records.forEach(function (r) {
        if (!r.citizen_id) return;
        const status = ATT_STATUSES.indexOf(r.status) >= 0 ? r.status : 'มา';
        const rec = {
          date: date, citizen_id: r.citizen_id, status: status,
          note: r.note || '', recorded_by: by, created_at: ts,
        };
        const existRow = keyToRow[date + '|' + String(r.citizen_id)];
        if (existRow) {
          updateRow('ATTENDANCE', existRow, rec);
          updated++;
        } else {
          rec.att_id = genId('ATT');
          inserts.push(rec);
        }
      });
      if (inserts.length) appendRows('ATTENDANCE', inserts);

      audit('attendance', 'SAVE', date, { date: date, inserted: inserts.length, updated: updated }, by);
      return { date: date, inserted: inserts.length, updated: updated };
    } finally {
      lock.releaseLock();
    }
  },

  /** ประวัติการเช็คชื่อ — กรองตามวันที่/ชั้น/นักเรียน/สถานะ */
  history: function (params, ctx) {
    requirePin(ctx, 'attendance');
    const p = params || {};
    const stIndex = buildIndex('STUDENTS', 'citizen_id');
    let rows = readAll('ATTENDANCE');

    if (p.date) rows = rows.filter(function (a) { return String(a.date) === p.date; });
    if (p.date_from) rows = rows.filter(function (a) { return String(a.date) >= p.date_from; });
    if (p.date_to) rows = rows.filter(function (a) { return String(a.date) <= p.date_to; });
    if (p.citizen_id) rows = rows.filter(function (a) { return String(a.citizen_id) === String(p.citizen_id); });
    if (p.status) rows = rows.filter(function (a) { return a.status === p.status; });
    if (p.grade) {
      rows = rows.filter(function (a) {
        const s = stIndex[String(a.citizen_id)];
        return s && s.grade === p.grade;
      });
    }

    rows.sort(function (a, b) { return String(b.created_at).localeCompare(String(a.created_at)); });
    const limit = Math.min(parseInt(p.limit, 10) || 200, 600);
    const total = rows.length;
    rows = rows.slice(0, limit).map(function (a) {
      const s = stIndex[String(a.citizen_id)];
      return {
        att_id: a.att_id, date: a.date, citizen_id: a.citizen_id,
        name: s ? studentName(s) : '(ไม่พบ)', grade: s ? s.grade : '', room: s ? s.room : '',
        status: a.status, note: a.note, recorded_by: a.recorded_by,
      };
    });
    return { records: rows, total: total, returned: rows.length };
  },

  /** Dashboard — สรุปสถานะรายวัน, รายชั้น, รายชื่อที่ไม่มา (ของวันที่ระบุ) */
  dashboard: function (params, ctx) {
    requirePin(ctx, 'attendance');
    const date = (params && params.date) || today();
    const stIndex = buildIndex('STUDENTS', 'citizen_id');
    const records = readAll('ATTENDANCE').filter(function (a) { return String(a.date) === date; });
    const totalStudents = readAll('STUDENTS').filter(function (s) { return s.status !== 'inactive'; }).length;

    const counts = { 'มา': 0, 'ขาด': 0, 'ลา': 0, 'สาย': 0 };
    const gradeMap = {};
    const absentList = [];

    records.forEach(function (a) {
      const st = ATT_STATUSES.indexOf(a.status) >= 0 ? a.status : 'มา';
      counts[st]++;
      const s = stIndex[String(a.citizen_id)];
      const g = s ? (s.grade || '-') : '-';
      if (!gradeMap[g]) gradeMap[g] = { grade: g, 'มา': 0, 'ขาด': 0, 'ลา': 0, 'สาย': 0 };
      gradeMap[g][st]++;
      if (st !== 'มา') {
        absentList.push({
          citizen_id: a.citizen_id, name: s ? studentName(s) : '(ไม่พบ)',
          grade: s ? s.grade : '', room: s ? s.room : '', status: st,
        });
      }
    });

    const byGrade = Object.keys(gradeMap).map(function (g) {
      const o = gradeMap[g];
      const checked = o['มา'] + o['ขาด'] + o['ลา'] + o['สาย'];
      o.present_rate = checked ? Math.round((o['มา'] / checked) * 1000) / 10 : 0;
      return o;
    });

    return {
      date: date,
      total_students: totalStudents,
      checked_count: records.length,
      not_checked: Math.max(totalStudents - records.length, 0),
      present_rate: records.length ? Math.round((counts['มา'] / records.length) * 1000) / 10 : 0,
      counts: counts,
      by_grade: byGrade,
      absent_list: absentList,
    };
  },
};
