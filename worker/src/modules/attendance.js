/** Attendance — เช็คการมาเรียน (ไม่ใช้ PIN) · มา/ขาด/ลา/สาย · unique (date, citizen_id)
 *  แก้วันที่เช็คผิด: ย้ายไปวันที่ถูก (move_day) · ลบ → ถังกู้คืน ATTENDANCE_TRASH (remove_day / trash_restore)
 *  วันหยุดโรงเรียน ATT_HOLIDAY: ไม่นับในรายงานรายเดือน (แถวเช็คชื่อไม่ถูกลบ) · บันทึกในวันหยุดต้องยืนยัน (force) */
import {
  readAll, insertRows, updateWhere, buildIndex,
  now, today, yearMonth, toYmd, toYm, genId, audit, apiError,
} from '../db.js';
import { studentName, gradeSortKey, listClasses, studentsInClass } from '../shared.js';

const ATT_STATUSES = ['มา', 'ขาด', 'ลา', 'สาย'];
const CHUNK = 80;   // id ต่อคำสั่ง SQL (D1 จำกัด bound parameters 100/คำสั่ง)
const WEEKDAYS = ['อาทิตย์', 'จันทร์', 'อังคาร', 'พุธ', 'พฤหัสบดี', 'ศุกร์', 'เสาร์'];
function weekday(ymd) { return new Date(ymd + 'T00:00:00Z').getUTCDay(); }
function validYmd(v, label) {
  const d = toYmd(v);
  if (!d || !/^\d{4}-\d{2}-\d{2}$/.test(d)) apiError('VALIDATION', 'วันที่' + (label || '') + 'ไม่ถูกต้อง');
  return d;
}
function actor(v) {
  const n = String(v || '').replace(/\s+/g, ' ').trim().slice(0, 60);
  if (!n) apiError('VALIDATION', 'กรุณาพิมพ์ชื่อผู้แก้ไข');
  return n;
}
async function holidayMap(db) {
  const m = {};
  (await readAll(db, 'ATT_HOLIDAY')).forEach(function (h) { m[toYmd(h.date)] = h.name || 'วันหยุด'; });
  return m;
}
/** แถวเช็คชื่อของวันที่ (+ เฉพาะชั้น/ห้อง ถ้าระบุ) — ชั้นตามข้อมูลนักเรียนปัจจุบัน */
async function rowsOfDay(db, date, grade, room) {
  const stIndex = buildIndex(await readAll(db, 'STUDENTS'), 'citizen_id');
  return (await readAll(db, 'ATTENDANCE')).filter(function (a) {
    if (toYmd(a.date) !== date) return false;
    if (!grade) return true;
    const s = stIndex[String(a.citizen_id)];
    if (!s || String(s.grade) !== String(grade)) return false;
    return room === undefined || room === null || room === '' || String(s.room) === String(room);
  });
}
function chunks(arr) { const out = []; for (let i = 0; i < arr.length; i += CHUNK) out.push(arr.slice(i, i + CHUNK)); return out; }
function qs(n) { return new Array(n).fill('?').join(','); }
/** prepare + bind หลายค่า */
function stmt(db, sql, args) { const st = db.prepare(sql); return st.bind.apply(st, args); }
/** คำสั่งย้ายแถวไปถังกู้คืน (คัดลอก + ลบ) — ใช้ใน db.batch เดียว (atomic) */
function trashStmts(db, ids, batchId, by, reason, ts) {
  const out = [];
  chunks(ids).forEach(function (c) {
    out.push(stmt(db, 'INSERT INTO ATTENDANCE_TRASH (trash_id, batch_id, att_id, date, citizen_id, status, note, recorded_by, created_at, deleted_at, deleted_by, reason) ' +
      "SELECT ? || ':' || att_id, ?, att_id, date, citizen_id, status, note, recorded_by, created_at, ?, ?, ? FROM ATTENDANCE WHERE att_id IN (" + qs(c.length) + ')',
      [batchId, batchId, ts, by, reason].concat(c)));
    out.push(stmt(db, 'DELETE FROM ATTENDANCE WHERE att_id IN (' + qs(c.length) + ')', c));
  });
  return out;
}

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
    const wd = weekday(date);
    return { date: date, results: results, weekday: WEEKDAYS[wd], weekend: wd === 0 || wd === 6, holiday: (await holidayMap(ctx.db))[date] || '', future: date > today() };
  },

  /** บันทึกเช็คชื่อ (หลายคน) — upsert ตาม (date, citizen_id) */
  save: async function (params, ctx) {
    const db = ctx.db;
    const records = params.records;
    if (!Array.isArray(records) || !records.length) apiError('VALIDATION', 'ไม่มีข้อมูลให้บันทึก');
    const date = params.date ? toYmd(params.date) : today();
    const ts = now();
    const by = params.recorded_by || 'admin';
    const hol = (await holidayMap(db))[date];
    if (hol && params.force !== true) apiError('HOLIDAY', 'วันที่ ' + date + ' เป็นวันหยุด (' + hol + ') — ยืนยันก่อนบันทึก');

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
    const allDays = {}, hol = await holidayMap(db), skipped = {};
    (await readAll(db, 'ATTENDANCE')).forEach(function (a) {
      if (toYm(a.date) !== ym) return;
      if (hol[toYmd(a.date)]) { skipped[toYmd(a.date)] = true; return; }   // วันหยุด → ไม่นับ (ข้อมูลยังอยู่)
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
    return { year_month: ym, school_days: Object.keys(allDays).length, holiday_days_skipped: Object.keys(skipped).sort(), rows: rows, totals: totals, class_count: rows.length };
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
    const allDays = {}, hol = await holidayMap(db), skipped = {};
    (await readAll(db, 'ATTENDANCE')).forEach(function (a) {
      if (toYm(a.date) !== ym) return;
      if (hol[toYmd(a.date)]) { skipped[toYmd(a.date)] = true; return; }
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
    return { year_month: ym, grade: grade, room: room, school_days: Object.keys(allDays).length, holiday_days_skipped: Object.keys(skipped).sort(), rows: rows, totals: totals };
  },

  /* ════ แก้วันที่เช็คผิด ════ */

  /** วันที่มีการเช็คชื่อในเดือน + ชั้นที่เช็ค · ติดธง เสาร์-อาทิตย์ / วันหยุด / วันในอนาคต — params = { year_month } */
  days: async function (params, ctx) {
    const db = ctx.db;
    const ym = params && params.year_month ? String(params.year_month).substring(0, 7) : yearMonth();
    const stIndex = buildIndex(await readAll(db, 'STUDENTS'), 'citizen_id');
    const hol = await holidayMap(db), td = today(), map = {};
    (await readAll(db, 'ATTENDANCE')).forEach(function (a) {
      const d = toYmd(a.date);
      if (!d || d.substring(0, 7) !== ym) return;
      const s = stIndex[String(a.citizen_id)];
      const grade = s ? (s.grade || '-') : '-', room = s && s.room != null ? String(s.room) : '';
      const day = map[d] || (map[d] = { date: d, count: 0, classes: {} });
      day.count++;
      const k = grade + '|' + room;
      const c = day.classes[k] || (day.classes[k] = { grade: grade, room: room, count: 0, recorded_by: {} });
      c.count++;
      if (a.recorded_by) c.recorded_by[a.recorded_by] = 1;
    });
    const days = Object.keys(map).sort().map(function (d) {
      const wd = weekday(d), x = map[d];
      return { date: d, weekday: WEEKDAYS[wd], weekend: wd === 0 || wd === 6, holiday: hol[d] || '', future: d > td, count: x.count,
        classes: Object.keys(x.classes).map(function (k) { const c = x.classes[k]; return { grade: c.grade, room: c.room, count: c.count, recorded_by: Object.keys(c.recorded_by).join(', ') }; })
          .sort(function (a, b) { return gradeSortKey(a.grade) - gradeSortKey(b.grade) || (parseInt(a.room, 10) || 0) - (parseInt(b.room, 10) || 0); }) };
    });
    const holidays = Object.keys(hol).filter(function (d) { return d.substring(0, 7) === ym; }).sort().map(function (d) { return { date: d, name: hol[d] }; });
    return { year_month: ym, days: days, holidays: holidays };
  },

  /** ลบการเช็คชื่อของวันที่ (ทั้งวัน หรือเฉพาะชั้น) → ย้ายไปถังกู้คืน — params = { date, grade?, room?, by, reason? } */
  remove_day: async function (params, ctx) {
    const db = ctx.db;
    const date = validYmd(params.date), by = actor(params.by);
    if (!params.grade && params.all !== true) apiError('VALIDATION', 'เลือกชั้น หรือยืนยันลบทั้งวัน');
    const rows = await rowsOfDay(db, date, params.grade, params.room);
    if (!rows.length) apiError('NOT_FOUND', 'ไม่มีการเช็คชื่อในวันที่/ชั้นนี้');
    const batchId = genId('ATB'), ts = now(), reason = String(params.reason || 'เช็ควันผิด').slice(0, 200);
    await db.batch(trashStmts(db, rows.map(function (a) { return a.att_id; }), batchId, by, reason, ts));
    await audit(db, 'attendance', 'REMOVE_DAY', date, { grade: params.grade || 'ทั้งวัน', room: params.room || '', rows: rows.length, batch_id: batchId, reason: reason }, by);
    return { date: date, removed: rows.length, batch_id: batchId };
  },

  /** ย้ายการเช็คชื่อไปวันที่ถูกต้อง — params = { date, to_date, grade?, room?, by, overwrite? }
   *  วันปลายทางมีเช็คชื่อของนักเรียนคนเดียวกันอยู่แล้ว → แจ้ง CONFLICT · overwrite=true → แถวเดิมของวันปลายทางไปถังกู้คืน */
  move_day: async function (params, ctx) {
    const db = ctx.db;
    const date = validYmd(params.date, 'ต้นทาง'), to = validYmd(params.to_date, 'ปลายทาง'), by = actor(params.by);
    if (date === to) apiError('VALIDATION', 'วันที่ปลายทางต้องต่างจากเดิม');
    if (!params.grade && params.all !== true) apiError('VALIDATION', 'เลือกชั้น หรือยืนยันย้ายทั้งวัน');
    const rows = await rowsOfDay(db, date, params.grade, params.room);
    if (!rows.length) apiError('NOT_FOUND', 'ไม่มีการเช็คชื่อในวันที่/ชั้นนี้');
    const cids = {};
    rows.forEach(function (a) { cids[String(a.citizen_id)] = 1; });
    const clash = (await readAll(db, 'ATTENDANCE')).filter(function (a) { return toYmd(a.date) === to && cids[String(a.citizen_id)]; });
    if (clash.length && params.overwrite !== true) apiError('CONFLICT', 'วันที่ ' + to + ' มีการเช็คชื่อของนักเรียนกลุ่มนี้แล้ว ' + clash.length + ' คน — ยืนยันเขียนทับ (ข้อมูลเดิมของวันนั้นไปอยู่ในถังกู้คืน)');
    const ts = now(), batchId = genId('ATB'), stmts = [];
    if (clash.length) trashStmts(db, clash.map(function (a) { return a.att_id; }), batchId, by, 'ถูกเขียนทับเมื่อย้ายจาก ' + date, ts).forEach(function (x) { stmts.push(x); });
    chunks(rows.map(function (a) { return a.att_id; })).forEach(function (c) {
      stmts.push(stmt(db, 'UPDATE ATTENDANCE SET date = ? WHERE att_id IN (' + qs(c.length) + ')', [to].concat(c)));
    });
    await db.batch(stmts);
    await audit(db, 'attendance', 'MOVE_DAY', date, { to: to, grade: params.grade || 'ทั้งวัน', room: params.room || '', rows: rows.length, overwritten: clash.length, batch_id: clash.length ? batchId : '' }, by);
    return { from: date, to: to, moved: rows.length, overwritten: clash.length };
  },

  /** ถังกู้คืน (ล่าสุดก่อน) — สรุปเป็นชุดการลบ */
  trash_list: async function (params, ctx) {
    const db = ctx.db;
    const stIndex = buildIndex(await readAll(db, 'STUDENTS'), 'citizen_id');
    const m = {};
    (await readAll(db, 'ATTENDANCE_TRASH')).forEach(function (t) {
      const b = m[t.batch_id] || (m[t.batch_id] = { batch_id: t.batch_id, deleted_at: t.deleted_at, deleted_by: t.deleted_by, reason: t.reason, dates: {}, classes: {}, count: 0 });
      b.count++;
      b.dates[toYmd(t.date)] = 1;
      const s = stIndex[String(t.citizen_id)];
      if (s) b.classes[s.grade + (s.room ? '/' + s.room : '')] = 1;
    });
    const list = Object.keys(m).map(function (k) { const b = m[k]; return { batch_id: b.batch_id, deleted_at: b.deleted_at, deleted_by: b.deleted_by, reason: b.reason, count: b.count, dates: Object.keys(b.dates).sort(), classes: Object.keys(b.classes).sort() }; })
      .sort(function (a, b) { return String(b.deleted_at).localeCompare(String(a.deleted_at)); });
    return { batches: list.slice(0, Math.min(Number(params && params.limit) || 50, 200)) };
  },

  /** กู้คืนชุดที่ลบ — ข้ามคนที่ตอนนี้มีเช็คชื่อวันเดียวกันอยู่แล้ว (ไม่เขียนทับ) — params = { batch_id, by } */
  trash_restore: async function (params, ctx) {
    const db = ctx.db;
    const by = actor(params.by);
    const items = (await readAll(db, 'ATTENDANCE_TRASH')).filter(function (t) { return t.batch_id === String(params.batch_id || ''); });
    if (!items.length) apiError('NOT_FOUND', 'ไม่พบชุดที่ลบ');
    const have = {};
    (await readAll(db, 'ATTENDANCE')).forEach(function (a) { have[toYmd(a.date) + '|' + String(a.citizen_id)] = 1; have['id|' + a.att_id] = 1; });
    const ok = [], skipped = [];
    items.forEach(function (t) { (have[toYmd(t.date) + '|' + String(t.citizen_id)] || have['id|' + t.att_id] ? skipped : ok).push(t.trash_id); });
    const stmts = [];
    chunks(ok).forEach(function (c) {
      stmts.push(stmt(db, 'INSERT INTO ATTENDANCE (att_id, date, citizen_id, status, note, recorded_by, created_at) SELECT att_id, date, citizen_id, status, note, recorded_by, created_at FROM ATTENDANCE_TRASH WHERE trash_id IN (' + qs(c.length) + ')', c));
      stmts.push(stmt(db, 'DELETE FROM ATTENDANCE_TRASH WHERE trash_id IN (' + qs(c.length) + ')', c));
    });
    if (stmts.length) await db.batch(stmts);
    await audit(db, 'attendance', 'TRASH_RESTORE', String(params.batch_id), { restored: ok.length, skipped: skipped.length }, by);
    return { restored: ok.length, skipped: skipped.length };
  },

  /* ── วันหยุดโรงเรียน ── */
  holidays: async function (params, ctx) {
    const y = params && params.year ? String(params.year) : '';
    return { holidays: (await readAll(ctx.db, 'ATT_HOLIDAY')).map(function (h) { return { date: toYmd(h.date), name: h.name || '', created_by: h.created_by || '' }; })
      .filter(function (h) { return !y || h.date.substring(0, 4) === y; }).sort(function (a, b) { return a.date < b.date ? -1 : 1; }) };
  },
  /** ตั้งวันหยุด (ช่วงวันที่ได้) — params = { date, to_date?, name, by } */
  holiday_save: async function (params, ctx) {
    const db = ctx.db;
    const from = validYmd(params.date), to = params.to_date ? validYmd(params.to_date) : from, by = actor(params.by);
    if (to < from) apiError('VALIDATION', 'ช่วงวันที่ไม่ถูกต้อง');
    const name = String(params.name || '').trim().slice(0, 80) || 'วันหยุด';
    const dates = [];
    for (let d = new Date(from + 'T00:00:00Z'); d.toISOString().slice(0, 10) <= to; d.setUTCDate(d.getUTCDate() + 1)) {
      dates.push(d.toISOString().slice(0, 10));
      if (dates.length > 31) apiError('VALIDATION', 'ตั้งได้ครั้งละไม่เกิน 31 วัน');
    }
    const ts = now();
    await db.batch(dates.map(function (d) {
      return stmt(db, 'INSERT INTO ATT_HOLIDAY (date, name, created_by, created_at) VALUES (?,?,?,?) ON CONFLICT(date) DO UPDATE SET name = excluded.name, created_by = excluded.created_by, created_at = excluded.created_at', [d, name, by, ts]);
    }));
    await audit(db, 'attendance', 'HOLIDAY_SAVE', from, { to: to, name: name, days: dates.length }, by);
    return { saved: dates.length };
  },
  holiday_delete: async function (params, ctx) {
    const db = ctx.db;
    const d = validYmd(params.date), by = actor(params.by);
    await stmt(db, 'DELETE FROM ATT_HOLIDAY WHERE date = ?', [d]).run();
    await audit(db, 'attendance', 'HOLIDAY_DELETE', d, {}, by);
    return { deleted: d };
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
