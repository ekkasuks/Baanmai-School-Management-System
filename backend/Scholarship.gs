/**
 * Scholarship module — บันทึกการรับทุนการศึกษา (ไม่ใช้ PIN)
 *
 * เลือกนักเรียน → กรอก ชื่อทุน + จำนวนเงิน + วันที่ได้รับ
 * บันทึกได้หลายทุนต่อคน · จัดกลุ่มสรุปตาม "ปีการศึกษา" (year, พ.ศ. จาก SETTINGS.current_year)
 */

const ScholarshipAPI = {

  /** รายชื่อชั้น/ห้อง สำหรับ dropdown */
  classes: function () {
    return { classes: listClasses() };
  },

  /** ปีการศึกษาที่มีข้อมูล (+ปีปัจจุบัน) สำหรับ dropdown */
  years: function () {
    const set = {};
    readAll('SCHOLARSHIP').forEach(function (r) { if (r.year) set[String(r.year)] = true; });
    const cur = SettingsAPI.get_raw('current_year');
    if (cur) set[String(cur)] = true;
    const years = Object.keys(set).sort().reverse();
    return { years: years, current: cur || '' };
  },

  /** นักเรียนในชั้น + ยอดทุนรวมในปีที่เลือก */
  by_class: function (params) {
    if (!params.grade) apiError('VALIDATION', 'กรุณาเลือกชั้นเรียน');
    const year = String(params.year || SettingsAPI.get_raw('current_year') || '');
    const sums = {};
    readAll('SCHOLARSHIP').forEach(function (r) {
      if (String(r.year) !== year) return;
      const cid = String(r.citizen_id);
      if (!sums[cid]) sums[cid] = { total: 0, count: 0 };
      sums[cid].total += Number(r.amount) || 0;
      sums[cid].count += 1;
    });
    const results = studentsInClass(params.grade, params.room).map(function (s) {
      const x = sums[String(s.citizen_id)] || { total: 0, count: 0 };
      return {
        citizen_id: s.citizen_id, student_code: s.student_code, name: studentName(s),
        grade: s.grade, room: s.room, total: Math.round(x.total * 100) / 100, count: x.count,
      };
    });
    results.sort(function (a, b) { return String(a.name).localeCompare(String(b.name), 'th'); });
    return { year: year, results: results };
  },

  /**
   * บันทึกการรับทุน 1 รายการ
   * params = { citizen_id, name, amount, date?, note, recorded_by }
   */
  record: function (params) {
    const cid = params.citizen_id;
    const name = String(params.name || '').trim();
    let amount = Number(params.amount);
    if (!cid) apiError('VALIDATION', 'กรุณาเลือกนักเรียน');
    if (!name) apiError('VALIDATION', 'กรุณาระบุชื่อทุน');
    if (!isFinite(amount) || amount <= 0) apiError('VALIDATION', 'จำนวนเงินต้องมากกว่า 0');

    const student = buildIndex('STUDENTS', 'citizen_id')[String(cid)];
    if (!student) apiError('NOT_FOUND', 'ไม่พบนักเรียน');

    amount = Math.round(amount * 100) / 100;
    const date = params.date ? toYmd(params.date) : today();
    const year = String(params.year || SettingsAPI.get_raw('current_year') || toYmd(date).substring(0, 4));
    const id = genId('SCH');

    appendRows('SCHOLARSHIP', [{
      scholarship_id: id, date: date, year: year, citizen_id: cid, name: name,
      amount: amount, note: params.note || '', recorded_by: params.recorded_by || 'admin', created_at: now(),
    }]);
    audit('scholarship', 'RECORD', id, { citizen_id: cid, name: name, amount: amount, year: year }, params.recorded_by);

    return {
      scholarship_id: id, date: date, year: year, name: name, amount: amount,
      student: { name: studentName(student), grade: student.grade, room: student.room, student_code: student.student_code },
    };
  },

  /** ลบรายการทุน (แก้ไขข้อผิดพลาด) */
  delete: function (params) {
    if (!params.scholarship_id) apiError('VALIDATION', 'ไม่ได้ระบุรายการ');
    const idx = findRowIndex('SCHOLARSHIP', 'scholarship_id', params.scholarship_id);
    if (idx < 0) apiError('NOT_FOUND', 'ไม่พบรายการทุน');
    deleteRow('SCHOLARSHIP', idx);
    audit('scholarship', 'DELETE', params.scholarship_id, {}, params.recorded_by);
    return { ok: true };
  },

  /** รายการทุนของนักเรียน 1 คน (ใหม่→เก่า) — ใช้ในหน้าบันทึก + โปรไฟล์ */
  student: function (params) {
    const cid = String(params.citizen_id || '');
    if (!cid) apiError('VALIDATION', 'กรุณาระบุนักเรียน');
    let rows = readAll('SCHOLARSHIP').filter(function (r) { return String(r.citizen_id) === cid; });
    if (params.year) rows = rows.filter(function (r) { return String(r.year) === String(params.year); });
    rows = rows.map(function (r) {
      return {
        scholarship_id: r.scholarship_id, date: toYmd(r.date), year: r.year,
        name: r.name, amount: Number(r.amount) || 0, note: r.note, recorded_by: r.recorded_by,
      };
    }).sort(function (a, b) { return String(b.date).localeCompare(String(a.date)); });
    let total = 0;
    rows.forEach(function (r) { total += r.amount; });
    return { records: rows, total: Math.round(total * 100) / 100, count: rows.length };
  },

  /** ประวัติการรับทุน — กรองตามปี/ชั้น/นักเรียน */
  history: function (params) {
    const p = params || {};
    const stIndex = buildIndex('STUDENTS', 'citizen_id');
    let rows = readAll('SCHOLARSHIP');
    if (p.year) rows = rows.filter(function (r) { return String(r.year) === String(p.year); });
    if (p.citizen_id) rows = rows.filter(function (r) { return String(r.citizen_id) === String(p.citizen_id); });
    if (p.grade) {
      rows = rows.filter(function (r) {
        const s = stIndex[String(r.citizen_id)];
        return s && s.grade === p.grade;
      });
    }
    rows.sort(function (a, b) { return String(b.date).localeCompare(String(a.date)); });
    const limit = Math.min(parseInt(p.limit, 10) || 300, 800);
    const total = rows.length;
    rows = rows.slice(0, limit).map(function (r) {
      const s = stIndex[String(r.citizen_id)];
      return {
        scholarship_id: r.scholarship_id, date: toYmd(r.date), year: r.year, citizen_id: r.citizen_id,
        name: r.name, amount: Number(r.amount) || 0,
        student_name: s ? studentName(s) : '(ไม่พบ)', grade: s ? s.grade : '', room: s ? s.room : '',
        recorded_by: r.recorded_by,
      };
    });
    return { records: rows, total: total, returned: rows.length };
  },

  /** สรุปทุนในปี — รวมเงิน, จำนวนราย, จำนวนนักเรียน, รายชั้น, ผู้รับสูงสุด */
  dashboard: function (params) {
    const year = String((params && params.year) || SettingsAPI.get_raw('current_year') || '');
    return cachedResult('sch.dash:' + year, ['SCHOLARSHIP', 'STUDENTS'], 90, function () {
    const stIndex = buildIndex('STUDENTS', 'citizen_id');
    const rows = readAll('SCHOLARSHIP').filter(function (r) { return String(r.year) === year; });

    let totalAmount = 0;
    const studentSet = {};
    const gradeMap = {};
    const perStudent = {};
    rows.forEach(function (r) {
      const amt = Number(r.amount) || 0;
      totalAmount += amt;
      const cid = String(r.citizen_id);
      studentSet[cid] = true;
      const s = stIndex[cid];
      const g = s ? (s.grade || '-') : '-';
      if (!gradeMap[g]) gradeMap[g] = { grade: g, total: 0, count: 0, students: {} };
      gradeMap[g].total += amt; gradeMap[g].count += 1; gradeMap[g].students[cid] = true;
      if (!perStudent[cid]) perStudent[cid] = { citizen_id: cid, name: s ? studentName(s) : '(ไม่พบ)', grade: s ? s.grade : '', room: s ? s.room : '', total: 0, count: 0 };
      perStudent[cid].total += amt; perStudent[cid].count += 1;
    });

    const byGrade = Object.keys(gradeMap).map(function (g) {
      const o = gradeMap[g];
      return { grade: o.grade, total: Math.round(o.total * 100) / 100, count: o.count, students: Object.keys(o.students).length };
    });

    const top = Object.keys(perStudent).map(function (k) { return perStudent[k]; })
      .sort(function (a, b) { return b.total - a.total; }).slice(0, 10)
      .map(function (e) { e.total = Math.round(e.total * 100) / 100; return e; });

    return {
      year: year,
      total_amount: Math.round(totalAmount * 100) / 100,
      record_count: rows.length,
      student_count: Object.keys(studentSet).length,
      by_grade: byGrade,
      top: top,
    };
    });
  },
};
