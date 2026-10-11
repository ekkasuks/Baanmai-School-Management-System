/** Behavior — พฤติกรรม (ไม่ใช้ PIN) · คะแนนเดือน = behavior_start + ผลรวม points_change ของเดือนนั้น */
import {
  readAll, getBy, selectWhere, insertRows, updateWhere, buildIndex,
  now, today, yearMonth, toYmd, toYm, genId, audit, apiError,
} from '../db.js';
import { studentName, listClasses, studentsInClass, behaviorStart } from '../shared.js';

/** active = ใช้งาน เว้นแต่ถูกปิดชัดเจน (รองรับทั้ง boolean/"1"/"0"/"true"/"false" ที่ migrate มา) */
function isActive(v) {
  return !(v === false || v === 0 || v === '0' || v === 'false' || v === '' || v === null || v === undefined);
}

export const BehaviorAPI = {

  master_list: async function (params, ctx) {
    const db = ctx.db;
    let items = await readAll(db, 'BEHAVIOR_MASTER');
    if (!items.length) { await seedBehaviorMaster(db); items = await readAll(db, 'BEHAVIOR_MASTER'); }
    const includeInactive = params && params.include_inactive;
    items = items
      .filter(function (it) { return includeInactive || isActive(it.active); })
      .map(function (it) {
        return { item_id: it.item_id, type: it.type, name: it.name, points: Number(it.points) || 0, active: isActive(it.active) };
      });
    items.sort(function (a, b) {
      if (a.type !== b.type) return a.type === 'add' ? -1 : 1;
      return String(a.name).localeCompare(String(b.name), 'th');
    });
    return { items: items };
  },

  master_save: async function (params, ctx) {
    const db = ctx.db;
    const type = params.type;
    const name = String(params.name || '').trim();
    const points = Math.abs(parseInt(params.points, 10));
    if (type !== 'add' && type !== 'deduct') apiError('VALIDATION', 'ประเภทต้องเป็น add หรือ deduct');
    if (!name) apiError('VALIDATION', 'กรุณาระบุชื่อรายการ');
    if (!isFinite(points) || points <= 0) apiError('VALIDATION', 'คะแนนต้องมากกว่า 0');
    const active = params.active === undefined ? true : (params.active !== false && params.active !== 'false');
    let itemId = params.item_id;

    if (itemId) {
      if (!(await getBy(db, 'BEHAVIOR_MASTER', 'item_id', itemId))) apiError('NOT_FOUND', 'ไม่พบรายการพฤติกรรม');
      await updateWhere(db, 'BEHAVIOR_MASTER', 'item_id', itemId, { type: type, name: name, points: points, active: active });
      await audit(db, 'behavior', 'MASTER_UPDATE', itemId, { type: type, name: name, points: points, active: active }, params.recorded_by);
    } else {
      itemId = await genBehaviorItemId(db);
      await insertRows(db, 'BEHAVIOR_MASTER', [{ item_id: itemId, type: type, name: name, points: points, active: active }]);
      await audit(db, 'behavior', 'MASTER_CREATE', itemId, { type: type, name: name, points: points }, params.recorded_by);
    }
    return { item_id: itemId };
  },

  master_delete: async function (params, ctx) {
    if (!params.item_id) apiError('VALIDATION', 'ไม่ได้ระบุรายการ');
    if (!(await getBy(ctx.db, 'BEHAVIOR_MASTER', 'item_id', params.item_id))) apiError('NOT_FOUND', 'ไม่พบรายการพฤติกรรม');
    await updateWhere(ctx.db, 'BEHAVIOR_MASTER', 'item_id', params.item_id, { active: false });
    await audit(ctx.db, 'behavior', 'MASTER_DELETE', params.item_id, {}, params.recorded_by);
    return { ok: true };
  },

  classes: async function (params, ctx) { return { classes: await listClasses(ctx.db) }; },

  by_class: async function (params, ctx) {
    if (!params.grade) apiError('VALIDATION', 'กรุณาเลือกชั้นเรียน');
    const ym = toYm(params.year_month) || yearMonth();
    const ms = await monthScores(ctx.db, ym);
    const results = (await studentsInClass(ctx.db, params.grade, params.room)).map(function (s) {
      return {
        citizen_id: s.citizen_id, student_code: s.student_code, name: studentName(s),
        grade: s.grade, room: s.room, score: ms.start + (ms.sums[String(s.citizen_id)] || 0),
      };
    });
    results.sort(function (a, b) { return String(a.name).localeCompare(String(b.name), 'th'); });
    return { results: results };
  },

  search: async function (params, ctx) {
    const q = String(params.q || '').trim().toLowerCase();
    if (!q) return { results: [] };
    const ym = toYm(params.year_month) || yearMonth();
    const ms = await monthScores(ctx.db, ym);
    const rows = await readAll(ctx.db, 'STUDENTS');
    const results = [];
    for (let i = 0; i < rows.length && results.length < 20; i++) {
      const s = rows[i];
      if (s.status === 'inactive') continue;
      const hay = (studentName(s) + ' ' + s.student_code + ' ' + s.citizen_id).toLowerCase();
      if (hay.indexOf(q) < 0) continue;
      results.push({
        citizen_id: s.citizen_id, student_code: s.student_code, name: studentName(s),
        grade: s.grade, room: s.room, score: ms.start + (ms.sums[String(s.citizen_id)] || 0),
      });
    }
    return { results: results };
  },

  record: async function (params, ctx) {
    const db = ctx.db;
    const cid = params.citizen_id, itemId = params.item_id;
    if (!cid) apiError('VALIDATION', 'กรุณาระบุนักเรียน');
    if (!itemId) apiError('VALIDATION', 'กรุณาเลือกรายการพฤติกรรม');
    const student = await getBy(db, 'STUDENTS', 'citizen_id', String(cid));
    if (!student) apiError('NOT_FOUND', 'ไม่พบนักเรียน');
    const itemIndex = buildIndex(await readAll(db, 'BEHAVIOR_MASTER'), 'item_id');
    const item = itemIndex[String(itemId)];
    if (!item) apiError('NOT_FOUND', 'ไม่พบรายการพฤติกรรม');

    const points = Math.abs(Number(item.points) || 0);
    const change = item.type === 'add' ? points : -points;
    const date = params.date ? toYmd(params.date) : today();
    const ym = toYm(date);
    const ms = await monthScores(db, ym);
    const pointsAfter = ms.start + (ms.sums[String(cid)] || 0) + change;

    const priorLogs = (await selectWhere(db, 'BEHAVIOR_LOG', 'citizen_id', String(cid)))
      .filter(function (l) { return toYm(l.year_month) === ym; })
      .map(function (l) { return behaviorLogView(l, itemIndex); });

    const logId = genId('BHV');
    const ts = now();
    await insertRows(db, 'BEHAVIOR_LOG', [{
      log_id: logId, date: date, year_month: ym, citizen_id: cid, item_id: itemId,
      points_change: change, points_after: pointsAfter,
      note: params.note || '', recorded_by: params.recorded_by || 'admin', created_at: ts,
    }]);

    const logs = priorLogs.concat([{
      log_id: logId, date: date, item_name: item.name, points_change: change, points_after: pointsAfter,
      note: params.note || '', recorded_by: params.recorded_by || 'admin', created_at: ts,
    }]).sort(function (a, b) { return String(a.created_at).localeCompare(String(b.created_at)); });

    await audit(db, 'behavior', 'RECORD', logId, { citizen_id: cid, item_id: itemId, points_change: change, points_after: pointsAfter }, params.recorded_by);
    return {
      log_id: logId, date: date, year_month: ym, item_name: item.name, item_type: item.type,
      points_change: change, points_after: pointsAfter, score: pointsAfter, logs: logs,
      student: { name: studentName(student), grade: student.grade, room: student.room, student_code: student.student_code },
    };
  },

  student_score: async function (params, ctx) {
    const db = ctx.db;
    const cid = params.citizen_id;
    if (!cid) apiError('VALIDATION', 'กรุณาระบุนักเรียน');
    const s = await getBy(db, 'STUDENTS', 'citizen_id', String(cid));
    if (!s) apiError('NOT_FOUND', 'ไม่พบนักเรียน');
    const ym = toYm(params.year_month) || yearMonth();
    const start = await behaviorStart(db);
    const itemIndex = buildIndex(await readAll(db, 'BEHAVIOR_MASTER'), 'item_id');
    const logs = (await selectWhere(db, 'BEHAVIOR_LOG', 'citizen_id', String(cid)))
      .filter(function (l) { return toYm(l.year_month) === ym; })
      .sort(function (a, b) { return String(a.created_at).localeCompare(String(b.created_at)); })
      .map(function (l) { return behaviorLogView(l, itemIndex); });
    const score = logs.reduce(function (acc, l) { return acc + l.points_change; }, start);
    return {
      student: { citizen_id: s.citizen_id, student_code: s.student_code, name: studentName(s), grade: s.grade, room: s.room },
      year_month: ym, start: start, score: score, logs: logs,
    };
  },

  history: async function (params, ctx) {
    const db = ctx.db;
    const p = params || {};
    const stIndex = buildIndex(await readAll(db, 'STUDENTS'), 'citizen_id');
    const itemIndex = buildIndex(await readAll(db, 'BEHAVIOR_MASTER'), 'item_id');
    let rows = p.citizen_id
      ? await selectWhere(db, 'BEHAVIOR_LOG', 'citizen_id', String(p.citizen_id))
      : await readAll(db, 'BEHAVIOR_LOG');

    if (p.year_month) { const ymP = toYm(p.year_month); rows = rows.filter(function (l) { return toYm(l.year_month) === ymP; }); }
    if (p.type) rows = rows.filter(function (l) { const c = Number(l.points_change) || 0; return p.type === 'add' ? c > 0 : c < 0; });
    if (p.grade) rows = rows.filter(function (l) { const s = stIndex[String(l.citizen_id)]; return s && s.grade === p.grade; });

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

  ranking: async function (params, ctx) {
    const db = ctx.db;
    const ym = (params && toYm(params.year_month)) || yearMonth();
    const ms = await monthScores(db, ym);
    const students = (await readAll(db, 'STUDENTS')).filter(function (s) { return s.status !== 'inactive'; });
    let list = students.map(function (s) {
      return {
        citizen_id: s.citizen_id, student_code: s.student_code, name: studentName(s),
        grade: s.grade, room: s.room, score: ms.start + (ms.sums[String(s.citizen_id)] || 0),
      };
    });
    if (params && params.grade) list = list.filter(function (e) { return e.grade === params.grade; });
    list.sort(function (a, b) { if (b.score !== a.score) return b.score - a.score; return String(a.name).localeCompare(String(b.name), 'th'); });
    list.forEach(function (e, i) { e.rank = i + 1; });
    return { year_month: ym, start: ms.start, ranking: list };
  },

  dashboard: async function (params, ctx) {
    const db = ctx.db;
    const ym = (params && toYm(params.year_month)) || yearMonth();
    const ms = await monthScores(db, ym);
    const students = (await readAll(db, 'STUDENTS')).filter(function (s) { return s.status !== 'inactive'; });
    const enriched = students.map(function (s) {
      return { citizen_id: s.citizen_id, name: studentName(s), grade: s.grade, room: s.room, score: ms.start + (ms.sums[String(s.citizen_id)] || 0) };
    });
    let sum = 0;
    const gradeMap = {};
    const dist = { excellent: 0, good: 0, fair: 0, watch: 0 };
    enriched.forEach(function (e) {
      sum += e.score;
      const g = e.grade || '-';
      if (!gradeMap[g]) gradeMap[g] = { grade: g, total: 0, count: 0 };
      gradeMap[g].total += e.score; gradeMap[g].count += 1;
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
    return {
      year_month: ym, start: ms.start, student_count: enriched.length,
      avg_score: enriched.length ? Math.round((sum / enriched.length) * 100) / 100 : ms.start,
      record_count: ms.count, distribution: dist, by_grade: byGrade,
      top: sorted.slice(0, 5),
      bottom: sorted.slice().reverse().filter(function (e) { return e.score < ms.start; }).slice(0, 5),
    };
  },
};

/* ── helpers ── */
async function monthScores(db, ym) {
  const sums = {};
  let count = 0;
  (await readAll(db, 'BEHAVIOR_LOG')).forEach(function (l) {
    if (toYm(l.year_month) !== ym) return;
    count++;
    const cid = String(l.citizen_id);
    sums[cid] = (sums[cid] || 0) + (Number(l.points_change) || 0);
  });
  return { start: await behaviorStart(db), sums: sums, count: count };
}

function behaviorLogView(l, itemIndex) {
  const it = itemIndex[String(l.item_id)];
  return {
    log_id: l.log_id, date: l.date, item_name: it ? it.name : '(ลบแล้ว)',
    points_change: Number(l.points_change) || 0, points_after: Number(l.points_after) || 0,
    note: l.note, recorded_by: l.recorded_by, created_at: l.created_at,
  };
}

async function genBehaviorItemId(db) {
  let max = 0;
  (await readAll(db, 'BEHAVIOR_MASTER')).forEach(function (it) {
    const m = String(it.item_id).match(/^B(\d+)$/);
    if (m) max = Math.max(max, parseInt(m[1], 10));
  });
  return 'B' + ('00' + (max + 1)).slice(-3);
}

async function seedBehaviorMaster(db) {
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
  await insertRows(db, 'BEHAVIOR_MASTER', rows);
}
