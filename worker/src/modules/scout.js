/** Scout — คะแนนกิจกรรมลูกเสือ (ไม่ใช้ PIN) · หมู่ ─< สมาชิก · กิจกรรม ─< คะแนน(ต่อหมู่) */
import {
  readAll, getBy, selectWhere, insertRows, updateWhere, deleteWhere, buildIndex,
  now, today, toYmd, genId, audit, apiError,
} from '../db.js';
import { studentName, gradeSortKey } from '../shared.js';
import { getSetting } from './settings.js';

const SCOUT_ROLE_LABEL = { leader: 'นายหมู่', deputy: 'รองนายหมู่' };
function scoutRole(v) { const s = String(v || '').trim(); return (s === 'leader' || s === 'deputy') ? s : ''; }
function scoutRoleOrder(role) { const r = scoutRole(role); return r === 'leader' ? 0 : r === 'deputy' ? 2 : 1; }
async function scoutYear(db, params) {
  const y = params && params.year;
  return String(y || (await getSetting(db, 'current_year')) || (new Date().getFullYear() + 543));
}

export const ScoutAPI = {

  years: async function (params, ctx) {
    const db = ctx.db;
    const set = {};
    (await readAll(db, 'SCOUT_GROUP')).forEach(function (g) { if (g.year) set[String(g.year)] = true; });
    (await readAll(db, 'SCOUT_ACTIVITY')).forEach(function (a) { if (a.year) set[String(a.year)] = true; });
    const cur = await getSetting(db, 'current_year');
    if (cur) set[String(cur)] = true;
    return { years: Object.keys(set).sort().reverse(), current: cur || '' };
  },

  dashboard: async function (params, ctx) {
    const db = ctx.db;
    const year = await scoutYear(db, params);
    const groups = (await readAll(db, 'SCOUT_GROUP')).filter(function (g) { return String(g.year) === year; });
    const activities = (await readAll(db, 'SCOUT_ACTIVITY')).filter(function (a) { return String(a.year) === year; });
    const actIds = {};
    let maxTotal = 0;
    activities.forEach(function (a) { actIds[String(a.activity_id)] = true; maxTotal += Number(a.max_score) || 0; });

    const stIndex = buildIndex(await readAll(db, 'STUDENTS'), 'citizen_id');
    const memberCount = {}, leaderOf = {};
    (await readAll(db, 'SCOUT_MEMBER')).forEach(function (m) {
      const gid = String(m.group_id);
      memberCount[gid] = (memberCount[gid] || 0) + 1;
      if (scoutRole(m.role) === 'leader') { const s = stIndex[String(m.citizen_id)]; leaderOf[gid] = s ? studentName(s) : ''; }
    });
    const sums = {}, scored = {};
    (await readAll(db, 'SCOUT_SCORE')).forEach(function (s) {
      if (!actIds[String(s.activity_id)]) return;
      const gid = String(s.group_id);
      sums[gid] = (sums[gid] || 0) + (Number(s.score) || 0);
      scored[gid] = (scored[gid] || 0) + 1;
    });
    const rows = groups.map(function (g) {
      const gid = String(g.group_id);
      const total = Math.round((sums[gid] || 0) * 100) / 100;
      return { group_id: gid, name: g.name, leader: leaderOf[gid] || '', members: memberCount[gid] || 0, total: total, scored_activities: scored[gid] || 0, percent: maxTotal ? Math.round((total / maxTotal) * 1000) / 10 : 0 };
    }).sort(function (a, b) { if (b.total !== a.total) return b.total - a.total; return String(a.name).localeCompare(String(b.name), 'th'); });
    rows.forEach(function (r, i) { r.rank = i + 1; });
    return {
      year: year, group_count: groups.length, activity_count: activities.length,
      max_total: Math.round(maxTotal * 100) / 100,
      total_awarded: Math.round(rows.reduce(function (s, r) { return s + r.total; }, 0) * 100) / 100,
      groups: rows,
    };
  },

  groups: async function (params, ctx) {
    const db = ctx.db;
    const year = await scoutYear(db, params);
    const stIndex = buildIndex(await readAll(db, 'STUDENTS'), 'citizen_id');
    const memberCount = {}, leaderOf = {}, deputyOf = {};
    (await readAll(db, 'SCOUT_MEMBER')).forEach(function (m) {
      const gid = String(m.group_id);
      memberCount[gid] = (memberCount[gid] || 0) + 1;
      const r = scoutRole(m.role);
      if (!r) return;
      const s = stIndex[String(m.citizen_id)];
      const nm = s ? studentName(s) : '';
      if (r === 'leader') leaderOf[gid] = nm; else deputyOf[gid] = nm;
    });
    const list = (await readAll(db, 'SCOUT_GROUP')).filter(function (g) { return String(g.year) === year; })
      .map(function (g) {
        const gid = String(g.group_id);
        return { group_id: g.group_id, name: g.name, year: String(g.year), note: g.note, members: memberCount[gid] || 0, leader: leaderOf[gid] || '', deputy: deputyOf[gid] || '' };
      }).sort(function (a, b) { return String(a.name).localeCompare(String(b.name), 'th'); });
    return { year: year, groups: list };
  },

  group_save: async function (params, ctx) {
    const db = ctx.db;
    const name = String(params.name || '').trim();
    if (!name) apiError('VALIDATION', 'กรุณาระบุชื่อหมู่');
    const year = await scoutYear(db, params);
    if (params.group_id) {
      if (!(await getBy(db, 'SCOUT_GROUP', 'group_id', params.group_id))) apiError('NOT_FOUND', 'ไม่พบหมู่ลูกเสือ');
      await updateWhere(db, 'SCOUT_GROUP', 'group_id', params.group_id, { name: name, note: params.note || '', updated_at: now() });
      await audit(db, 'scout', 'GROUP_UPDATE', params.group_id, { name: name }, params.recorded_by);
      return { group_id: params.group_id, name: name };
    }
    const dup = (await readAll(db, 'SCOUT_GROUP')).some(function (g) { return String(g.year) === year && String(g.name).trim() === name; });
    if (dup) apiError('DUPLICATE', 'มีหมู่ชื่อนี้อยู่แล้วในปีการศึกษานี้');
    const id = genId('SG');
    await insertRows(db, 'SCOUT_GROUP', [{ group_id: id, name: name, year: year, note: params.note || '', created_at: now(), updated_at: now() }]);
    await audit(db, 'scout', 'GROUP_CREATE', id, { name: name, year: year }, params.recorded_by);
    return { group_id: id, name: name, year: year };
  },

  group_delete: async function (params, ctx) {
    const db = ctx.db;
    const gid = String(params.group_id || '');
    if (!gid) apiError('VALIDATION', 'ไม่ได้ระบุหมู่');
    if (!(await getBy(db, 'SCOUT_GROUP', 'group_id', gid))) apiError('NOT_FOUND', 'ไม่พบหมู่ลูกเสือ');
    await deleteWhere(db, 'SCOUT_MEMBER', 'group_id', gid);
    await deleteWhere(db, 'SCOUT_SCORE', 'group_id', gid);
    await deleteWhere(db, 'SCOUT_GROUP', 'group_id', gid);
    await audit(db, 'scout', 'GROUP_DELETE', gid, {}, params.recorded_by);
    return { ok: true };
  },

  members: async function (params, ctx) {
    const db = ctx.db;
    const gid = String(params.group_id || '');
    if (!gid) apiError('VALIDATION', 'ไม่ได้ระบุหมู่');
    const stIndex = buildIndex(await readAll(db, 'STUDENTS'), 'citizen_id');
    const list = (await selectWhere(db, 'SCOUT_MEMBER', 'group_id', gid)).map(function (m) {
      const s = stIndex[String(m.citizen_id)];
      return {
        member_id: m.member_id, citizen_id: m.citizen_id, name: s ? studentName(s) : '(ไม่พบนักเรียน)',
        student_code: s ? s.student_code : '', grade: s ? s.grade : '', room: s ? s.room : '',
        role: scoutRole(m.role), role_label: SCOUT_ROLE_LABEL[scoutRole(m.role)] || '',
      };
    }).sort(function (a, b) {
      const ra = scoutRoleOrder(a.role), rb = scoutRoleOrder(b.role);
      if (ra !== rb) return ra - rb;
      const d = gradeSortKey(a.grade) - gradeSortKey(b.grade);
      return d !== 0 ? d : String(a.name).localeCompare(String(b.name), 'th');
    });
    return { group_id: gid, members: list };
  },

  member_role: async function (params, ctx) {
    const db = ctx.db;
    const gid = String(params.group_id || ''), cid = String(params.citizen_id || '');
    const role = scoutRole(params.role);
    if (!gid || !cid) apiError('VALIDATION', 'ข้อมูลไม่ครบ');
    if (params.role && !role) apiError('VALIDATION', 'ตำแหน่งไม่ถูกต้อง');
    const members = await selectWhere(db, 'SCOUT_MEMBER', 'group_id', gid);
    let target = null; const clear = [];
    members.forEach(function (m) {
      if (String(m.citizen_id) === cid) target = m;
      else if (role && scoutRole(m.role) === role) clear.push(m);
    });
    if (!target) apiError('NOT_FOUND', 'ไม่พบสมาชิกในหมู่นี้');
    for (const m of clear) await updateWhere(db, 'SCOUT_MEMBER', 'member_id', m.member_id, { role: '' });
    await updateWhere(db, 'SCOUT_MEMBER', 'member_id', target.member_id, { role: role });
    await audit(db, 'scout', 'MEMBER_ROLE', gid, { citizen_id: cid, role: role || '(ยกเลิก)' }, params.recorded_by);
    return { ok: true, role: role, role_label: SCOUT_ROLE_LABEL[role] || '' };
  },

  available_students: async function (params, ctx) {
    const db = ctx.db;
    const p = params || {};
    const year = await scoutYear(db, p);
    const yearGroups = {};
    (await readAll(db, 'SCOUT_GROUP')).forEach(function (g) { if (String(g.year) === year) yearGroups[String(g.group_id)] = true; });
    const taken = {};
    (await readAll(db, 'SCOUT_MEMBER')).forEach(function (m) { if (yearGroups[String(m.group_id)]) taken[String(m.citizen_id)] = true; });
    const q = String(p.q || '').trim().toLowerCase();
    let list = (await readAll(db, 'STUDENTS')).filter(function (s) {
      if (s.status === 'inactive') return false;
      if (taken[String(s.citizen_id)]) return false;
      if (p.grade && s.grade !== p.grade) return false;
      if (q && (studentName(s) + ' ' + s.student_code).toLowerCase().indexOf(q) < 0) return false;
      return true;
    }).map(function (s) { return { citizen_id: s.citizen_id, student_code: s.student_code, name: studentName(s), grade: s.grade, room: s.room }; });
    list.sort(function (a, b) {
      const d = gradeSortKey(a.grade) - gradeSortKey(b.grade);
      if (d !== 0) return d;
      const r = (parseInt(a.room, 10) || 0) - (parseInt(b.room, 10) || 0);
      return r !== 0 ? r : String(a.name).localeCompare(String(b.name), 'th');
    });
    return { year: year, students: list.slice(0, 300), total: list.length };
  },

  member_add: async function (params, ctx) {
    const db = ctx.db;
    const gid = String(params.group_id || '');
    const cids = params.citizen_ids;
    if (!gid) apiError('VALIDATION', 'ไม่ได้ระบุหมู่');
    if (!Array.isArray(cids) || !cids.length) apiError('VALIDATION', 'กรุณาเลือกนักเรียน');
    const group = await getBy(db, 'SCOUT_GROUP', 'group_id', gid);
    if (!group) apiError('NOT_FOUND', 'ไม่พบหมู่ลูกเสือ');
    const year = String(group.year);
    const yearGroups = {};
    (await readAll(db, 'SCOUT_GROUP')).forEach(function (g) { if (String(g.year) === year) yearGroups[String(g.group_id)] = true; });
    const taken = {};
    (await readAll(db, 'SCOUT_MEMBER')).forEach(function (m) { if (yearGroups[String(m.group_id)]) taken[String(m.citizen_id)] = true; });
    const stIndex = buildIndex(await readAll(db, 'STUDENTS'), 'citizen_id');
    const rows = [];
    let skipped = 0;
    cids.forEach(function (cid) {
      const key = String(cid);
      if (taken[key] || !stIndex[key]) { skipped++; return; }
      taken[key] = true;
      rows.push({ member_id: genId('SM'), group_id: gid, citizen_id: cid, created_at: now(), role: '' });
    });
    if (rows.length) await insertRows(db, 'SCOUT_MEMBER', rows);
    await audit(db, 'scout', 'MEMBER_ADD', gid, { added: rows.length, skipped: skipped }, params.recorded_by);
    return { added: rows.length, skipped: skipped };
  },

  member_remove: async function (params, ctx) {
    const db = ctx.db;
    const gid = String(params.group_id || ''), cid = String(params.citizen_id || '');
    if (!gid || !cid) apiError('VALIDATION', 'ข้อมูลไม่ครบ');
    const members = await selectWhere(db, 'SCOUT_MEMBER', 'group_id', gid);
    const t = members.find(function (m) { return String(m.citizen_id) === cid; });
    if (!t) apiError('NOT_FOUND', 'ไม่พบสมาชิกในหมู่นี้');
    await deleteWhere(db, 'SCOUT_MEMBER', 'member_id', t.member_id);
    await audit(db, 'scout', 'MEMBER_REMOVE', gid, { citizen_id: cid }, params.recorded_by);
    return { ok: true };
  },

  activities: async function (params, ctx) {
    const db = ctx.db;
    const year = await scoutYear(db, params);
    const scoredCount = {};
    (await readAll(db, 'SCOUT_SCORE')).forEach(function (s) { const aid = String(s.activity_id); scoredCount[aid] = (scoredCount[aid] || 0) + 1; });
    const list = (await readAll(db, 'SCOUT_ACTIVITY')).filter(function (a) { return String(a.year) === year; })
      .map(function (a) {
        return { activity_id: a.activity_id, name: a.name, task: a.task, max_score: Number(a.max_score) || 0, date: a.date ? toYmd(a.date) : '', note: a.note, year: String(a.year), scored_groups: scoredCount[String(a.activity_id)] || 0 };
      }).sort(function (a, b) { return String(b.date).localeCompare(String(a.date)); });
    return { year: year, activities: list };
  },

  activity_save: async function (params, ctx) {
    const db = ctx.db;
    const name = String(params.name || '').trim();
    const task = String(params.task || '').trim();
    const max = Number(params.max_score);
    if (!name) apiError('VALIDATION', 'กรุณาระบุชื่อกิจกรรม');
    if (!task) apiError('VALIDATION', 'กรุณาระบุชื่องานที่มอบหมาย');
    if (!isFinite(max) || max <= 0) apiError('VALIDATION', 'คะแนนเต็มต้องมากกว่า 0');
    const date = params.date ? toYmd(params.date) : today();
    const year = await scoutYear(db, params);
    if (params.activity_id) {
      if (!(await getBy(db, 'SCOUT_ACTIVITY', 'activity_id', params.activity_id))) apiError('NOT_FOUND', 'ไม่พบกิจกรรม');
      await updateWhere(db, 'SCOUT_ACTIVITY', 'activity_id', params.activity_id, { name: name, task: task, max_score: max, date: date, note: params.note || '', updated_at: now() });
      await audit(db, 'scout', 'ACTIVITY_UPDATE', params.activity_id, { name: name, max_score: max }, params.recorded_by);
      return { activity_id: params.activity_id };
    }
    const id = genId('SA');
    await insertRows(db, 'SCOUT_ACTIVITY', [{ activity_id: id, name: name, task: task, max_score: max, year: year, date: date, note: params.note || '', created_at: now(), updated_at: now() }]);
    await audit(db, 'scout', 'ACTIVITY_CREATE', id, { name: name, task: task, max_score: max }, params.recorded_by);
    return { activity_id: id };
  },

  activity_delete: async function (params, ctx) {
    const db = ctx.db;
    const aid = String(params.activity_id || '');
    if (!aid) apiError('VALIDATION', 'ไม่ได้ระบุกิจกรรม');
    if (!(await getBy(db, 'SCOUT_ACTIVITY', 'activity_id', aid))) apiError('NOT_FOUND', 'ไม่พบกิจกรรม');
    await deleteWhere(db, 'SCOUT_SCORE', 'activity_id', aid);
    await deleteWhere(db, 'SCOUT_ACTIVITY', 'activity_id', aid);
    await audit(db, 'scout', 'ACTIVITY_DELETE', aid, {}, params.recorded_by);
    return { ok: true };
  },

  score_sheet: async function (params, ctx) {
    const db = ctx.db;
    const aid = String(params.activity_id || '');
    if (!aid) apiError('VALIDATION', 'กรุณาเลือกกิจกรรม');
    const act = await getBy(db, 'SCOUT_ACTIVITY', 'activity_id', aid);
    if (!act) apiError('NOT_FOUND', 'ไม่พบกิจกรรม');
    const year = String(act.year);
    const current = {};
    (await selectWhere(db, 'SCOUT_SCORE', 'activity_id', aid)).forEach(function (s) { current[String(s.group_id)] = Number(s.score) || 0; });
    const memberCount = {};
    (await readAll(db, 'SCOUT_MEMBER')).forEach(function (m) { const gid = String(m.group_id); memberCount[gid] = (memberCount[gid] || 0) + 1; });
    const groups = (await readAll(db, 'SCOUT_GROUP')).filter(function (g) { return String(g.year) === year; })
      .map(function (g) { const gid = String(g.group_id); return { group_id: gid, name: g.name, members: memberCount[gid] || 0, score: current[gid] !== undefined ? current[gid] : null }; })
      .sort(function (a, b) { return String(a.name).localeCompare(String(b.name), 'th'); });
    return { activity: { activity_id: aid, name: act.name, task: act.task, max_score: Number(act.max_score) || 0, date: act.date ? toYmd(act.date) : '', year: year }, groups: groups };
  },

  score_save: async function (params, ctx) {
    const db = ctx.db;
    const aid = String(params.activity_id || '');
    const scores = params.scores;
    if (!aid) apiError('VALIDATION', 'กรุณาเลือกกิจกรรม');
    if (!Array.isArray(scores) || !scores.length) apiError('VALIDATION', 'ไม่มีข้อมูลให้บันทึก');
    const act = await getBy(db, 'SCOUT_ACTIVITY', 'activity_id', aid);
    if (!act) apiError('NOT_FOUND', 'ไม่พบกิจกรรม');
    const max = Number(act.max_score) || 0;

    const keyToId = {};
    (await selectWhere(db, 'SCOUT_SCORE', 'activity_id', aid)).forEach(function (s) { keyToId[String(s.group_id)] = s.score_id; });

    const ts = now();
    const by = params.recorded_by || 'admin';
    const inserts = [];
    let updated = 0, skipped = 0;
    for (const r of scores) {
      const gid = String(r.group_id || '');
      if (!gid) { skipped++; continue; }
      if (r.score === '' || r.score === null || r.score === undefined) { skipped++; continue; }
      let sc = Number(r.score);
      if (!isFinite(sc) || sc < 0) { skipped++; continue; }
      if (max && sc > max) sc = max;
      sc = Math.round(sc * 100) / 100;
      const existId = keyToId[gid];
      if (existId) { await updateWhere(db, 'SCOUT_SCORE', 'score_id', existId, { activity_id: aid, group_id: gid, score: sc, note: r.note || '', recorded_by: by, date: today(), created_at: ts }); updated++; }
      else { inserts.push({ score_id: genId('SS'), activity_id: aid, group_id: gid, score: sc, note: r.note || '', recorded_by: by, date: today(), created_at: ts }); }
    }
    if (inserts.length) await insertRows(db, 'SCOUT_SCORE', inserts);
    await audit(db, 'scout', 'SCORE_SAVE', aid, { inserted: inserts.length, updated: updated, skipped: skipped }, by);
    return { activity_id: aid, inserted: inserts.length, updated: updated, skipped: skipped };
  },

  group_detail: async function (params, ctx) {
    const db = ctx.db;
    const gid = String(params.group_id || '');
    if (!gid) apiError('VALIDATION', 'ไม่ได้ระบุหมู่');
    const group = await getBy(db, 'SCOUT_GROUP', 'group_id', gid);
    if (!group) apiError('NOT_FOUND', 'ไม่พบหมู่ลูกเสือ');
    const year = String(group.year);
    const scoreOf = {};
    (await selectWhere(db, 'SCOUT_SCORE', 'group_id', gid)).forEach(function (s) { scoreOf[String(s.activity_id)] = Number(s.score) || 0; });
    let total = 0, maxTotal = 0;
    const rows = (await readAll(db, 'SCOUT_ACTIVITY')).filter(function (a) { return String(a.year) === year; })
      .map(function (a) {
        const aid = String(a.activity_id);
        const sc = scoreOf[aid];
        const mx = Number(a.max_score) || 0;
        maxTotal += mx;
        if (sc !== undefined) total += sc;
        return { activity_id: aid, name: a.name, task: a.task, max_score: mx, date: a.date ? toYmd(a.date) : '', score: sc === undefined ? null : sc };
      }).sort(function (a, b) { return String(b.date).localeCompare(String(a.date)); });
    return { group: { group_id: gid, name: group.name, year: year }, total: Math.round(total * 100) / 100, max_total: Math.round(maxTotal * 100) / 100, activities: rows };
  },
};
