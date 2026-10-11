/** Attendance — เช็คการมาเรียน (ไม่ใช้ PIN) · มา/ขาด/ลา/สาย · unique (date, citizen_id) */
import {
  readAll, insertRows, updateWhere, buildIndex,
  now, today, yearMonth, toYmd, toYm, genId, audit, apiError,
} from '../db.js';
import { studentName, gradeSortKey, listClasses, studentsInClass } from '../shared.js';

const ATT_STATUSES = ['มา', 'ขาด', 'ลา', 'สาย'];

export const AttendanceAPI = {

  classes: async function (params, ctx) { return { classes: await listClasses(ctx.db) }; },

  /** นักเรียนในชั้น + สถานะของวันที่ระบุ (pre-fill, default 'มา') */
  by_class: async function (params, ctx) {
    if (!params.grade) apiError('VALIDATION', 'กรุณาเลือกชั้นเรียน');
    const date = params.date ? toYmd(params.date) : today();
    const attIndex = {};
    (await readAll(ctx.db, 'ATTENDANCE')).forEach(function (a) {
      if (toYmd(a.date) === date) attIndex[String(a.citizen_id)] = a;
    });
    const results = (await studentsInClass(ctx.db, params.grade, params.room)).map(function (s) {
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

  /** บันทึกเช็คชื่อ (หลายคน) — upsert ตาม (date, citizen_id) */
  save: async function (params, ctx) {
    const db = ctx.db;
    const records = params.records;
    if (!Array.isArray(records) || !records.length) apiError('VALIDATION', 'ไม่มีข้อมูลให้บันทึก');
    const date = params.date ? toYmd(params.date) : today();
    const ts = now();
    const by = params.recorded_by || 'admin';

    // index att_id เดิมตาม (วันไทย|citizen_id)
    const keyToId = {};
    (await readAll(db, 'ATTENDANCE')).forEach(function (a) {
      keyToId[toYmd(a.date) + '|' + String(a.citizen_id)] = a.att_id;
    });

    const inserts = [];
    const seen = {};
    let inserted = 0, updated = 0;
    for (const r of records) {
      if (!r.citizen_id) continue;
      const key = date + '|' + String(r.citizen_id);
      if (seen[key]) continue;
      seen[key] = true;
      const status = ATT_STATUSES.indexOf(r.status) >= 0 ? r.status : 'มา';
      const note = r.note || '';
      const existId = keyToId[key];
      if (existId) {
        await updateWhere(db, 'ATTENDANCE', 'att_id', existId, { date: date, status: status, note: note, recorded_by: by, created_at: ts });
        updated++;
      } else {
        inserts.push({ att_id: genId('ATT'), date: date, citizen_id: r.citizen_id, status: status, note: note, recorded_by: by, created_at: ts });
        inserted++;
      }
    }
    if (inserts.length) await insertRows(db, 'ATTENDANCE', inserts);
    await audit(db, 'attendance', 'SAVE', date, { date: date, inserted: inserted, updated: updated }, by);
    return { date: date, inserted: inserted, updated: updated };
  },

  history: async function (params, ctx) {
    const p = params || {};
    const stIndex = buildIndex(await readAll(ctx.db, 'STUDENTS'), 'citizen_id');
    let rows = await readAll(ctx.db, 'ATTENDANCE');
    if (p.date) rows = rows.filter(function (a) { return toYmd(a.date) === toYmd(p.date); });
    if (p.date_from) rows = rows.filter(function (a) { return toYmd(a.date) >= p.date_from; });
    if (p.date_to) rows = rows.filter(function (a) { return toYmd(a.date) <= p.date_to; });
    if (p.citizen_id) rows = rows.filter(function (a) { return String(a.citizen_id) === String(p.citizen_id); });
    if (p.status) rows = rows.filter(function (a) { return a.status === p.status; });
    if (p.grade) rows = rows.filter(function (a) { const s = stIndex[String(a.citizen_id)]; return s && s.grade === p.grade; });

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

  dashboard: async function (params, ctx) {
    const db = ctx.db;
    const date = (params && params.date) ? toYmd(params.date) : today();
    const stIndex = buildIndex(await readAll(db, 'STUDENTS'), 'citizen_id');
    const records = (await readAll(db, 'ATTENDANCE')).filter(function (a) { return toYmd(a.date) === date; });
    const totalStudents = (await readAll(db, 'STUDENTS')).filter(function (s) { return s.status !== 'inactive'; }).length;

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
      if (st !== 'มา') absentList.push({ citizen_id: a.citizen_id, name: s ? studentName(s) : '(ไม่พบ)', grade: s ? s.grade : '', room: s ? s.room : '', status: st });
    });
    const byGrade = Object.keys(gradeMap).map(function (g) {
      const o = gradeMap[g];
      const checked = o['มา'] + o['ขาด'] + o['ลา'] + o['สาย'];
      o.present_rate = checked ? Math.round((o['มา'] / checked) * 1000) / 10 : 0;
      return o;
    });
    return {
      date: date, total_students: totalStudents, checked_count: records.length,
      not_checked: Math.max(totalStudents - records.length, 0),
      present_rate: records.length ? Math.round((counts['มา'] / records.length) * 1000) / 10 : 0,
      counts: counts, by_grade: byGrade, absent_list: absentList,
    };
  },

  daily_summary: async function (params, ctx) {
    const db = ctx.db;
    const date = (params && params.date) ? toYmd(params.date) : today();
    const statusByCid = {};
    (await readAll(db, 'ATTENDANCE')).forEach(function (a) { if (toYmd(a.date) === date) statusByCid[String(a.citizen_id)] = a.status; });

    const classMap = {};
    (await readAll(db, 'STUDENTS')).forEach(function (s) {
      if (s.status === 'inactive') return;
      const grade = s.grade || '-';
      const room = (s.room === undefined || s.room === null) ? '' : String(s.room);
      const key = grade + '|' + room;
      if (!classMap[key]) classMap[key] = { grade: grade, room: room, male: 0, female: 0, total: 0, male_present: 0, female_present: 0, present: 0, absent: 0, leave: 0, late: 0, not_present: 0, checked: 0 };
      const c = classMap[key];
      const male = s.gender === 'ช', female = s.gender === 'ญ';
      if (male) c.male++; else if (female) c.female++;
      c.total++;
      const st = statusByCid[String(s.citizen_id)];
      if (st === undefined) return;
      c.checked++;
      if (st === 'มา') { c.present++; if (male) c.male_present++; else if (female) c.female_present++; }
      else if (st === 'ขาด') { c.absent++; c.not_present++; }
      else if (st === 'ลา') { c.leave++; c.not_present++; }
      else if (st === 'สาย') { c.late++; c.not_present++; }
    });
    const rows = Object.keys(classMap).map(function (k) { return classMap[k]; }).sort(function (a, b) {
      const d = gradeSortKey(a.grade) - gradeSortKey(b.grade);
      return d !== 0 ? d : (parseInt(a.room, 10) || 0) - (parseInt(b.room, 10) || 0);
    });
    const totals = { male: 0, female: 0, total: 0, male_present: 0, female_present: 0, present: 0, absent: 0, leave: 0, late: 0, not_present: 0, classes_checked: 0 };
    rows.forEach(function (c) {
      totals.male += c.male; totals.female += c.female; totals.total += c.total;
      totals.male_present += c.male_present; totals.female_present += c.female_present; totals.present += c.present;
      totals.absent += c.absent; totals.leave += c.leave; totals.late += c.late; totals.not_present += c.not_present;
      if (c.checked > 0) totals.classes_checked++;
    });
    return { date: date, rows: rows, totals: totals, class_count: rows.length };
  },

  report_months: async function (params, ctx) {
    const set = {};
    (await readAll(ctx.db, 'ATTENDANCE')).forEach(function (a) { const ym = toYm(a.date); if (ym) set[ym] = true; });
    set[yearMonth()] = true;
    return { months: Object.keys(set).sort().reverse() };
  },

  monthly_by_class: async function (params, ctx) {
    const db = ctx.db;
    const ym = (params && params.year_month) ? String(params.year_month).substring(0, 7) : yearMonth();
    const stIndex = buildIndex(await readAll(db, 'STUDENTS'), 'citizen_id');
    const classMap = {};
    const keyOf = function (g, r) { return g + '|' + r; };
    (await readAll(db, 'STUDENTS')).forEach(function (s) {
      if (s.status === 'inactive') return;
      const grade = s.grade || '-';
      const room = (s.room === undefined || s.room === null) ? '' : String(s.room);
      const k = keyOf(grade, room);
      if (!classMap[k]) classMap[k] = newMonthRow(grade, room);
      classMap[k].student_count++;
    });
    const allDays = {};
    (await readAll(db, 'ATTENDANCE')).forEach(function (a) {
      if (toYm(a.date) !== ym) return;
      const s = stIndex[String(a.citizen_id)];
      const grade = s ? (s.grade || '-') : '-';
      const room = s ? ((s.room === undefined || s.room === null) ? '' : String(s.room)) : '';
      const k = keyOf(grade, room);
      if (!classMap[k]) classMap[k] = newMonthRow(grade, room);
      addStatus(classMap[k], a.status);
      classMap[k].days[toYmd(a.date)] = true;
      allDays[toYmd(a.date)] = true;
    });
    const rows = Object.keys(classMap).map(function (k) { return finalizeMonthRow(classMap[k]); }).sort(function (a, b) {
      const d = gradeSortKey(a.grade) - gradeSortKey(b.grade);
      return d !== 0 ? d : (parseInt(a.room, 10) || 0) - (parseInt(b.room, 10) || 0);
    });
    const totals = finalizeMonthRow(rows.reduce(function (t, c) {
      t.student_count += c.student_count; t.present += c.present; t.late += c.late; t.leave += c.leave; t.absent += c.absent; t.records += c.records; return t;
    }, newMonthRow('รวมทั้งหมด', '')));
    totals.days_checked = Object.keys(allDays).length;
    return { year_month: ym, school_days: Object.keys(allDays).length, rows: rows, totals: totals, class_count: rows.length };
  },

  monthly_by_student: async function (params, ctx) {
    const db = ctx.db;
    if (!params || !params.grade) apiError('VALIDATION', 'กรุณาเลือกชั้นเรียน');
    const ym = params.year_month ? String(params.year_month).substring(0, 7) : yearMonth();
    const grade = params.grade, room = params.room || '';
    const byCid = {};
    (await studentsInClass(db, grade, room)).forEach(function (s) {
      const row = newMonthRow(s.grade, (s.room === undefined || s.room === null) ? '' : String(s.room));
      row.citizen_id = s.citizen_id; row.name = studentName(s); row.student_count = 1;
      byCid[String(s.citizen_id)] = row;
    });
    const allDays = {};
    (await readAll(db, 'ATTENDANCE')).forEach(function (a) {
      if (toYm(a.date) !== ym) return;
      const row = byCid[String(a.citizen_id)];
      if (!row) return;
      addStatus(row, a.status);
      row.days[toYmd(a.date)] = true;
      allDays[toYmd(a.date)] = true;
    });
    const rows = Object.keys(byCid).map(function (c) { return finalizeMonthRow(byCid[c]); }).sort(function (a, b) { return String(a.name).localeCompare(String(b.name), 'th'); });
    const totals = finalizeMonthRow(rows.reduce(function (t, c) {
      t.present += c.present; t.late += c.late; t.leave += c.leave; t.absent += c.absent; t.records += c.records; return t;
    }, newMonthRow('รวม', '')));
    totals.student_count = rows.length;
    return { year_month: ym, grade: grade, room: room, school_days: Object.keys(allDays).length, rows: rows, totals: totals };
  },
};

/* ── helpers รายงานรายเดือน ── */
function newMonthRow(grade, room) {
  return { grade: grade, room: room, student_count: 0, present: 0, late: 0, leave: 0, absent: 0, records: 0, days: {} };
}
function addStatus(row, status) {
  const st = ATT_STATUSES.indexOf(status) >= 0 ? status : 'มา';
  if (st === 'มา') row.present++;
  else if (st === 'สาย') row.late++;
  else if (st === 'ลา') row.leave++;
  else if (st === 'ขาด') row.absent++;
  row.records++;
}
function finalizeMonthRow(row) {
  row.came = row.present + row.late;
  row.rate = row.records ? Math.round((row.came / row.records) * 1000) / 10 : 0;
  row.days_checked = (row.days && typeof row.days === 'object') ? Object.keys(row.days).length : 0;
  delete row.days;
  return row;
}
