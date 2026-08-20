/**
 * Attendance module — เช็คการมาเรียน (ไม่ใช้ PIN)
 *
 * สถานะ: มา / ขาด / ลา / สาย
 * Unique = (date, citizen_id) — เช็คซ้ำในวันเดียวจะ "อัปเดต" ไม่เพิ่มแถว
 * ใช้งานแบบรายชั้น: เลือกชั้น → เช็คทั้งห้อง → บันทึกทีเดียว (save)
 */

const ATT_STATUSES = ['มา', 'ขาด', 'ลา', 'สาย'];

const AttendanceAPI = {

  /** รายชื่อชั้น/ห้อง สำหรับ dropdown */
  classes: function (params, ctx) {
    return { classes: listClasses() };
  },

  /**
   * นักเรียนในชั้น + สถานะของวันที่ระบุ (pre-fill, default 'มา')
   * params = { grade, room, date? }
   */
  by_class: function (params, ctx) {
    if (!params.grade) apiError('VALIDATION', 'กรุณาเลือกชั้นเรียน');
    const date = params.date ? toYmd(params.date) : today();
    const attIndex = {};
    readAll('ATTENDANCE').forEach(function (a) {
      if (toYmd(a.date) === date) attIndex[String(a.citizen_id)] = a;
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
    const records = params.records;
    if (!Array.isArray(records) || !records.length) apiError('VALIDATION', 'ไม่มีข้อมูลให้บันทึก');
    const date = params.date ? toYmd(params.date) : today();
    const ts = now();
    const by = params.recorded_by || 'admin';

    let result;
    const lock = LockService.getScriptLock();
    lock.waitLock(15000);
    try {
      const sh = getSheet('ATTENDANCE');
      const headers = SHEETS.ATTENDANCE.headers;   // att_id, date, citizen_id, status, note, recorded_by, created_at
      const lastRow = sh.getLastRow();

      // อ่าน att_id(1)+date(2)+citizen_id(3) ทีเดียว (3 คอลัมน์ติดกัน) → เลขแถว + att_id เดิม (ต้องคงไว้ตอน update)
      const keyToRow = {}, keyToAtt = {};
      if (lastRow > 1) {
        const head3 = sh.getRange(2, 1, lastRow - 1, 3).getValues();
        for (let i = 0; i < head3.length; i++) {
          const k = toYmd(head3[i][1]) + '|' + String(head3[i][2]);
          keyToRow[k] = i + 2;
          keyToAtt[k] = head3[i][0];
        }
      }

      const inserts = [];
      const updates = [];   // { row, values:[...] } — เขียนเฉพาะแถวเป้าหมาย
      const seen = {};      // กันส่งซ้ำ (date, citizen_id) ในชุดเดียว → ไม่เพิ่มแถวซ้ำ
      let inserted = 0, updated = 0;

      records.forEach(function (r) {
        if (!r.citizen_id) return;
        const key = date + '|' + String(r.citizen_id);
        if (seen[key]) return;   // ซ้ำในpayloadเดียว → ข้ามตัวถัดไป
        seen[key] = true;
        const status = ATT_STATUSES.indexOf(r.status) >= 0 ? r.status : 'มา';
        const note = r.note || '';

        if (keyToRow[key]) {
          // update: คง att_id เดิมไว้ · เขียนทั้งแถวตามลำดับ header
          updates.push({ row: keyToRow[key], values: [keyToAtt[key], date, r.citizen_id, status, note, by, ts] });
          updated++;
        } else {
          inserts.push({ att_id: genId('ATT'), date: date, citizen_id: r.citizen_id,
            status: status, note: note, recorded_by: by, created_at: ts });
          inserted++;
        }
      });

      // เขียน update แบบรวมช่วงแถวที่ติดกัน (setValues ทีเดียวต่อ 1 ช่วง — เขียนเฉพาะแถวเป้าหมาย ไม่แตะแถวอื่น)
      if (updates.length) attWriteUpdates(sh, headers.length, updates);
      if (inserts.length) appendRows('ATTENDANCE', inserts);   // batched + ล้าง cache ให้
      if (updates.length && !inserts.length) invalidateCache('ATTENDANCE');   // มีแต่ update → ต้องล้าง cache เอง

      result = { date: date, inserted: inserted, updated: updated };
    } finally {
      lock.releaseLock();
    }

    // audit นอก lock — ไม่ให้การเขียน AUDIT_LOG (และการตัด log เป็นครั้งคราว) หน่วงการเช็คชื่อของครูคนอื่นที่รอ lock
    audit('attendance', 'SAVE', result.date, { date: result.date, inserted: result.inserted, updated: result.updated }, by);
    return result;
  },

  /** ประวัติการเช็คชื่อ — กรองตามวันที่/ชั้น/นักเรียน/สถานะ */
  history: function (params, ctx) {
    const p = params || {};
    const stIndex = buildIndex('STUDENTS', 'citizen_id');
    let rows = readAll('ATTENDANCE');

    if (p.date) rows = rows.filter(function (a) { return toYmd(a.date) === toYmd(p.date); });
    if (p.date_from) rows = rows.filter(function (a) { return toYmd(a.date) >= p.date_from; });
    if (p.date_to) rows = rows.filter(function (a) { return toYmd(a.date) <= p.date_to; });
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
    const date = (params && params.date) ? toYmd(params.date) : today();
    return cachedResult('att.dash:' + date, ['STUDENTS', 'ATTENDANCE'], 90, function () {
    const stIndex = buildIndex('STUDENTS', 'citizen_id');
    const records = readAll('ATTENDANCE').filter(function (a) { return toYmd(a.date) === date; });
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
    });
  },

  /**
   * สรุปการมาเรียนรายวัน แยกตามชั้น/ห้อง — หน้าแรกของโมดูล
   * แต่ละแถว: จำนวนนักเรียน (ช/ญ/รวม) · มา (ช/ญ/รวม) · ไม่มา (ขาด/ลา/สาย/รวม)
   * ชั้นที่ยังไม่เช็คชื่อ → checked=0 (frontend แสดง '-')
   */
  daily_summary: function (params, ctx) {
    const date = (params && params.date) ? toYmd(params.date) : today();
    return cachedResult('att.summary:' + date, ['STUDENTS', 'ATTENDANCE'], 90, function () {

    // สถานะการเช็คชื่อของวันนี้ index ด้วย citizen_id
    const statusByCid = {};
    readAll('ATTENDANCE').forEach(function (a) {
      if (toYmd(a.date) === date) statusByCid[String(a.citizen_id)] = a.status;
    });

    // จัดกลุ่มนักเรียน active ตามชั้น|ห้อง
    const classMap = {};
    readAll('STUDENTS').forEach(function (s) {
      if (s.status === 'inactive') return;
      const grade = s.grade || '-';
      const room = (s.room === undefined || s.room === null) ? '' : String(s.room);
      const key = grade + '|' + room;
      if (!classMap[key]) {
        classMap[key] = {
          grade: grade, room: room,
          male: 0, female: 0, total: 0,
          male_present: 0, female_present: 0, present: 0,
          absent: 0, leave: 0, late: 0, not_present: 0,
          checked: 0,
        };
      }
      const c = classMap[key];
      const male = s.gender === 'ช', female = s.gender === 'ญ';
      if (male) c.male++; else if (female) c.female++;
      c.total++;

      const st = statusByCid[String(s.citizen_id)];
      if (st === undefined) return;
      c.checked++;
      if (st === 'มา') {
        c.present++;
        if (male) c.male_present++; else if (female) c.female_present++;
      } else if (st === 'ขาด') { c.absent++; c.not_present++; }
      else if (st === 'ลา') { c.leave++; c.not_present++; }
      else if (st === 'สาย') { c.late++; c.not_present++; }
    });

    const rows = Object.keys(classMap).map(function (k) { return classMap[k]; })
      .sort(function (a, b) {
        const d = gradeSortKey(a.grade) - gradeSortKey(b.grade);
        return d !== 0 ? d : (parseInt(a.room, 10) || 0) - (parseInt(b.room, 10) || 0);
      });

    const totals = {
      male: 0, female: 0, total: 0, male_present: 0, female_present: 0,
      present: 0, absent: 0, leave: 0, late: 0, not_present: 0, classes_checked: 0,
    };
    rows.forEach(function (c) {
      totals.male += c.male; totals.female += c.female; totals.total += c.total;
      totals.male_present += c.male_present; totals.female_present += c.female_present;
      totals.present += c.present;
      totals.absent += c.absent; totals.leave += c.leave; totals.late += c.late;
      totals.not_present += c.not_present;
      if (c.checked > 0) totals.classes_checked++;
    });

    return { date: date, rows: rows, totals: totals, class_count: rows.length };
    });
  },
};

/**
 * เขียน update หลายแถวแบบรวมช่วงแถวที่ติดกัน (batched setValues)
 * ⚠️ ปลอดภัยต่อข้อมูล: เขียนเฉพาะ "แถวเป้าหมาย" เท่านั้น — แถวที่อยู่ระหว่างช่วง (ไม่ใช่เป้าหมาย)
 *    จะถูกแยกเป็นคนละช่วงและไม่ถูกแตะ (กันเขียนทับข้อมูลของชั้น/วันอื่น)
 * updates = [{ row: <เลขแถว 1-based>, values: [...ทั้งแถวตามลำดับ header] }]
 */
function attWriteUpdates(sh, ncols, updates) {
  updates.sort(function (a, b) { return a.row - b.row; });
  let i = 0;
  while (i < updates.length) {
    let j = i;
    while (j + 1 < updates.length && updates[j + 1].row === updates[j].row + 1) j++;   // รวมแถวที่ต่อเนื่อง
    const block = [];
    for (let k = i; k <= j; k++) block.push(updates[k].values);
    sh.getRange(updates[i].row, 1, block.length, ncols).setValues(block);
    i = j + 1;
  }
}
