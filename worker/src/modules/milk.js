/** Milk — นมโรงเรียน (ไม่ใช้ PIN) · ยอดค้าง = วันไม่มา (ขาด/ลา) หลัง watermark */
import {
  readAll, insertRows, buildIndex,
  now, today, toYmd, genId, audit, apiError,
} from '../db.js';
import { studentName, gradeSortKey, listClasses } from '../shared.js';

const MILK_ABSENT_STATUSES = ['ขาด', 'ลา'];

export const MilkAPI = {

  dashboard: async function (params, ctx) {
    const db = ctx.db;
    const pend = await computeMilkPending(db);
    const stIndex = buildIndex(await readAll(db, 'STUDENTS'), 'citizen_id');
    const gradeMap = {};
    let totalStudents = 0, totalBoxes = 0;
    Object.keys(pend.pending).forEach(function (cid) {
      const s = stIndex[cid];
      if (!s || s.status === 'inactive') return;
      const boxes = pend.pending[cid];
      const grade = s.grade || '-';
      const room = (s.room === undefined || s.room === null) ? '' : String(s.room);
      const key = grade + '|' + room;
      if (!gradeMap[key]) gradeMap[key] = { grade: grade, room: room, students: 0, boxes: 0 };
      gradeMap[key].students++; gradeMap[key].boxes += boxes;
      totalStudents++; totalBoxes += boxes;
    });
    const byClass = Object.keys(gradeMap).map(function (k) { return gradeMap[k]; }).sort(function (a, b) {
      const d = gradeSortKey(a.grade) - gradeSortKey(b.grade);
      return d !== 0 ? d : (parseInt(a.room, 10) || 0) - (parseInt(b.room, 10) || 0);
    });
    return { date: today(), total_pending_students: totalStudents, total_pending_boxes: totalBoxes, by_class: byClass };
  },

  classes: async function (params, ctx) { return { classes: await listClasses(ctx.db) }; },

  pending: async function (params, ctx) {
    const db = ctx.db;
    const p = params || {};
    const pend = await computeMilkPending(db);
    const stIndex = buildIndex(await readAll(db, 'STUDENTS'), 'citizen_id');
    let list = Object.keys(pend.pending).map(function (cid) {
      const s = stIndex[cid];
      if (!s || s.status === 'inactive') return null;
      return {
        citizen_id: s.citizen_id, student_code: s.student_code, name: studentName(s),
        grade: s.grade, room: s.room, pending_boxes: pend.pending[cid], last_absent: pend.lastAbsent[cid] || '',
      };
    }).filter(Boolean);
    if (p.grade) list = list.filter(function (e) { return e.grade === p.grade; });
    if (p.room) list = list.filter(function (e) { return String(e.room) === String(p.room); });
    list.sort(function (a, b) {
      if (b.pending_boxes !== a.pending_boxes) return b.pending_boxes - a.pending_boxes;
      return String(a.name).localeCompare(String(b.name), 'th');
    });
    return { count: list.length, boxes: list.reduce(function (s, e) { return s + e.pending_boxes; }, 0), students: list };
  },

  mark_received: async function (params, ctx) {
    const db = ctx.db;
    const cid = params.citizen_id;
    if (!cid) apiError('VALIDATION', 'กรุณาระบุนักเรียน');
    const s = buildIndex(await readAll(db, 'STUDENTS'), 'citizen_id')[String(cid)];
    if (!s) apiError('NOT_FOUND', 'ไม่พบนักเรียน');
    const pend = await computeMilkPending(db);
    const boxes = pend.pending[String(cid)] || 0;
    if (boxes <= 0) apiError('VALIDATION', 'นักเรียนคนนี้ไม่มียอดนมค้าง');
    await insertRows(db, 'MILK_LOG', [{
      milk_id: genId('MILK'), date: today(), citizen_id: cid, boxes: boxes,
      type: 'clear', note: params.note || '', recorded_by: params.recorded_by || 'admin', created_at: now(),
    }]);
    await audit(db, 'milk', 'RECEIVE', cid, { boxes: boxes }, params.recorded_by);
    return { citizen_id: cid, name: studentName(s), cleared_boxes: boxes };
  },

  reset_all: async function (params, ctx) {
    const db = ctx.db;
    await insertRows(db, 'MILK_LOG', [{
      milk_id: genId('MILK'), date: today(), citizen_id: '', boxes: 0,
      type: 'reset_all', note: params.note || '', recorded_by: params.recorded_by || 'admin', created_at: now(),
    }]);
    await audit(db, 'milk', 'RESET_ALL', today(), {}, params.recorded_by);
    return { ok: true, through: today() };
  },

  history: async function (params, ctx) {
    const db = ctx.db;
    const p = params || {};
    const stIndex = buildIndex(await readAll(db, 'STUDENTS'), 'citizen_id');
    let rows = (await readAll(db, 'MILK_LOG')).filter(function (r) { return r.type === 'clear'; });
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
async function milkWatermarks(db) {
  let resetAll = '';
  const perStudent = {};
  (await readAll(db, 'MILK_LOG')).forEach(function (r) {
    const d = toYmd(r.date);
    if (r.type === 'reset_all') { if (d > resetAll) resetAll = d; }
    else if (r.type === 'clear') { const cid = String(r.citizen_id); if (!perStudent[cid] || d > perStudent[cid]) perStudent[cid] = d; }
  });
  return { resetAll: resetAll, perStudent: perStudent };
}

async function computeMilkPending(db) {
  const wm = await milkWatermarks(db);
  const td = today();
  const pending = {};
  const lastAbsent = {};
  (await readAll(db, 'ATTENDANCE')).forEach(function (a) {
    if (MILK_ABSENT_STATUSES.indexOf(a.status) < 0) return;
    const d = toYmd(a.date);
    if (!d || d > td) return;
    const cid = String(a.citizen_id);
    const sw = wm.perStudent[cid] || '';
    const floor = sw > wm.resetAll ? sw : wm.resetAll;
    if (floor && d <= floor) return;
    pending[cid] = (pending[cid] || 0) + 1;
    if (!lastAbsent[cid] || d > lastAbsent[cid]) lastAbsent[cid] = d;
  });
  return { pending: pending, lastAbsent: lastAbsent };
}
