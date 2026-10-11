/** Health — ตรวจสุขอนามัย (ไม่ใช้ PIN) · ผม/เล็บ/แก้วน้ำ/แปรงสีฟัน/ยาสีฟัน = ผ่าน/ไม่ผ่าน · unique (date, citizen_id) */
import {
  readAll, insertRows, updateWhere, buildIndex,
  now, today, toYmd, genId, audit, apiError,
} from '../db.js';
import { studentName, listClasses, studentsInClass } from '../shared.js';

const HEALTH_ITEMS = ['hair', 'nails', 'cup', 'toothbrush', 'toothpaste'];

export const HealthAPI = {

  classes: async function (params, ctx) { return { classes: await listClasses(ctx.db) }; },

  by_class: async function (params, ctx) {
    if (!params.grade) apiError('VALIDATION', 'กรุณาเลือกชั้นเรียน');
    const date = params.date ? toYmd(params.date) : today();
    const checkIndex = {};
    (await readAll(ctx.db, 'HEALTH_CHECK')).forEach(function (c) {
      if (toYmd(c.date) === date) checkIndex[String(c.citizen_id)] = c;
    });
    const results = (await studentsInClass(ctx.db, params.grade, params.room)).map(function (s) {
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

  save: async function (params, ctx) {
    const db = ctx.db;
    const records = params.records;
    if (!Array.isArray(records) || !records.length) apiError('VALIDATION', 'ไม่มีข้อมูลให้บันทึก');
    const date = params.date ? toYmd(params.date) : today();
    const ts = now();
    const by = params.recorded_by || 'admin';

    const keyToId = {};
    (await readAll(db, 'HEALTH_CHECK')).forEach(function (c) {
      keyToId[toYmd(c.date) + '|' + String(c.citizen_id)] = c.check_id;
    });

    const inserts = [];
    const seen = {};
    let updated = 0;
    for (const r of records) {
      if (!r.citizen_id) continue;
      const key = date + '|' + String(r.citizen_id);
      if (seen[key]) continue;
      seen[key] = true;
      const rec = { date: date, citizen_id: r.citizen_id, note: r.note || '', recorded_by: by, created_at: ts };
      HEALTH_ITEMS.forEach(function (k) { rec[k] = r[k] === 'ไม่ผ่าน' ? 'ไม่ผ่าน' : 'ผ่าน'; });
      const existId = keyToId[key];
      if (existId) { await updateWhere(db, 'HEALTH_CHECK', 'check_id', existId, rec); updated++; }
      else { rec.check_id = genId('HC'); inserts.push(rec); }
    }
    if (inserts.length) await insertRows(db, 'HEALTH_CHECK', inserts);
    await audit(db, 'health', 'SAVE', date, { date: date, inserted: inserts.length, updated: updated }, by);
    return { date: date, inserted: inserts.length, updated: updated };
  },

  history: async function (params, ctx) {
    const p = params || {};
    const stIndex = buildIndex(await readAll(ctx.db, 'STUDENTS'), 'citizen_id');
    let rows = await readAll(ctx.db, 'HEALTH_CHECK');
    if (p.date) rows = rows.filter(function (c) { return toYmd(c.date) === toYmd(p.date); });
    if (p.date_from) rows = rows.filter(function (c) { return toYmd(c.date) >= p.date_from; });
    if (p.date_to) rows = rows.filter(function (c) { return toYmd(c.date) <= p.date_to; });
    if (p.citizen_id) rows = rows.filter(function (c) { return String(c.citizen_id) === String(p.citizen_id); });
    if (p.grade) rows = rows.filter(function (c) { const s = stIndex[String(c.citizen_id)]; return s && s.grade === p.grade; });
    if (p.only_fail) rows = rows.filter(function (c) { return HEALTH_ITEMS.some(function (k) { return c[k] === 'ไม่ผ่าน'; }); });

    rows.sort(function (a, b) { return String(b.created_at).localeCompare(String(a.created_at)); });
    const limit = Math.min(parseInt(p.limit, 10) || 200, 600);
    const total = rows.length;
    rows = rows.slice(0, limit).map(function (c) {
      const s = stIndex[String(c.citizen_id)];
      const o = {
        check_id: c.check_id, date: c.date, citizen_id: c.citizen_id,
        name: s ? studentName(s) : '(ไม่พบ)', grade: s ? s.grade : '', room: s ? s.room : '',
        note: c.note, recorded_by: c.recorded_by, fail_count: 0,
      };
      HEALTH_ITEMS.forEach(function (k) { o[k] = c[k] || ''; if (c[k] === 'ไม่ผ่าน') o.fail_count++; });
      return o;
    });
    return { checks: rows, total: total, returned: rows.length };
  },

  dashboard: async function (params, ctx) {
    const db = ctx.db;
    const date = (params && params.date) ? toYmd(params.date) : today();
    const stIndex = buildIndex(await readAll(db, 'STUDENTS'), 'citizen_id');
    const checks = (await readAll(db, 'HEALTH_CHECK')).filter(function (c) { return toYmd(c.date) === date; });
    const totalStudents = (await readAll(db, 'STUDENTS')).filter(function (s) { return s.status !== 'inactive'; }).length;

    const byItem = {};
    HEALTH_ITEMS.forEach(function (k) { byItem[k] = { pass: 0, fail: 0 }; });
    const gradeMap = {};
    const failList = [];
    let totalPass = 0, totalCells = 0;

    checks.forEach(function (c) {
      const s = stIndex[String(c.citizen_id)];
      const g = s ? (s.grade || '-') : '-';
      if (!gradeMap[g]) gradeMap[g] = { grade: g, pass: 0, fail: 0 };
      const studentFails = [];
      HEALTH_ITEMS.forEach(function (k) {
        const v = c[k];
        if (v === 'ไม่ผ่าน') { byItem[k].fail++; gradeMap[g].fail++; totalCells++; studentFails.push(k); }
        else if (v === 'ผ่าน') { byItem[k].pass++; gradeMap[g].pass++; totalPass++; totalCells++; }
      });
      if (studentFails.length) failList.push({ citizen_id: c.citizen_id, name: s ? studentName(s) : '(ไม่พบ)', grade: s ? s.grade : '', room: s ? s.room : '', fails: studentFails });
    });

    const byGrade = Object.keys(gradeMap).map(function (g) {
      const o = gradeMap[g];
      const tot = o.pass + o.fail;
      o.pass_rate = tot ? Math.round((o.pass / tot) * 1000) / 10 : 0;
      return o;
    });

    return {
      date: date, total_students: totalStudents, checked_count: checks.length,
      not_checked: Math.max(totalStudents - checks.length, 0),
      overall_pass_rate: totalCells ? Math.round((totalPass / totalCells) * 1000) / 10 : 0,
      by_item: byItem, by_grade: byGrade, fail_list: failList,
    };
  },
};
