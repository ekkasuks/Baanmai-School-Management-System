/**
 * วิชาการ › บันทึกคะแนน (Gradebook) — ต้องเข้าสู่ระบบด้วยบัญชีบุคลากร (tt-auth.js)
 * เฟส 1: วิชาของฉัน (จากการมอบหมายในตารางสอน TT_ASSIGN) + รายชื่อนักเรียนรายวิชา (อ่าน STUDENTS อย่างเดียว)
 * เฟส 2: GB_COURSE (น้ำหนัก 4 ช่วง) · GB_ROSTER (ถ่ายรายชื่อ ณ ภาคนั้น) · GB_ITEM (งาน) · GB_SCORE (คะแนน) — schema-gradebook.sql
 * เฟส 3: ป้ายในงาน (ช้า/ไม่ส่ง/ยกเว้น + % หักส่งช้า) · GB_DEDUCT หักจากคะแนนรวม (ยกเลิก = void) · ตัดเกรด 0–4 / ผ–มผ (วิชากิจกรรม)
 *        · ผลพิเศษ ร/มส (ผ/มผ กำหนดเอง) ใน GB_ROSTER.special · ส่งผล = ล็อก, gb_admin ปลดล็อก — schema-gradebook-002.sql
 * เฟส 4: gb_overview — สรุปทุกรายวิชาของภาค (ผู้ดู) หรือเฉพาะวิชาของครู + ผลรายคน (ไม่ส่งเลขประจำตัว) สำหรับแดชบอร์ด/CSV
 *   gb       : ครู — เห็น/บันทึกเฉพาะวิชา×ชั้นที่ได้รับมอบหมาย
 *   gb_admin : ฝ่ายวิชาการ/ผู้ดูแล — ทุกวิชา · ดูในนามครูคนใดก็ได้
 *   gb_view  : ผู้บริหาร — ดูทุกวิชา (แก้ไม่ได้)
 * รายวิชา = วิชา × ชั้น × ภาคเรียน · course_id = term:class_id:subject_id
 * เขียนเฉพาะ GB_* (ไม่เขียนตารางเดิม · ไม่ลงบันทึก AUDIT_LOG) · ดีไซน์ทั้งหมด: docs/superpowers/specs/2026-11-06-gradebook-design.md
 */
import { selectWhere, getBy, apiError, now, today, genId } from '../db.js';
import { requireCap, can, teacherForTerm } from './tt-auth.js';
import { getSetting } from './settings.js';
import { studentName } from '../shared.js';

export const SUBJECT_TYPE = { core: 'พื้นฐาน', elective: 'เพิ่มเติม', practical: 'ปฏิบัติ', activity: 'กิจกรรม' };
export const PERIODS = ['ก่อนกลางภาค', 'กลางภาค', 'หลังกลางภาค', 'ปลายภาค'];
const DEFAULT_WEIGHTS = [30, 20, 20, 30];
const MAX_CELLS = 200;   // คะแนนต่อคำขอ (D1 plan ฟรี ~50 คำสั่ง/คำขอ · 12 แถว/คำสั่ง)
const GRADE_STEPS = [4, 3.5, 3, 2.5, 2, 1.5, 1];
const DEFAULT_TH = [80, 75, 70, 65, 60, 55, 50];   // ขั้นต่ำของเกรด 4 … 1 (ต่ำกว่าขั้นสุดท้าย = 0)
const FLAGS = ['', 'late', 'missing', 'exempt'];
const SPECIAL = { grade: ['', 'ร', 'มส'], pass: ['', 'ผ', 'มผ'] };

/** เกณฑ์ผลการเรียน (GB_COURSE.grade_scale JSON) · ค่าเริ่มต้น: วิชากิจกรรม = ผ/มผ (ผ่าน ≥ 50), วิชาอื่น = เกรด 0–4 */
function parseScale(v, subjectType) {
  let o = null; try { o = JSON.parse(v || 'null'); } catch (e) { o = null; }
  const mode = o && (o.mode === 'grade' || o.mode === 'pass') ? o.mode : (subjectType === 'activity' ? 'pass' : 'grade');
  const th = o && Array.isArray(o.th) && validTh(o.th) ? o.th.map(Number) : DEFAULT_TH.slice();
  const pass = o && isFinite(Number(o.pass)) && Number(o.pass) > 0 && Number(o.pass) <= 100 ? Number(o.pass) : 50;
  return { mode: mode, th: th, pass: pass };
}
function validTh(th) {
  if (!Array.isArray(th) || th.length !== 7) return false;
  for (let i = 0; i < 7; i++) { const n = Number(th[i]); if (!isFinite(n) || n <= 0 || n > 100 || (i && n >= Number(th[i - 1]))) return false; }
  return true;
}

/**
 * คะแนนของนักเรียน 1 คน (ใช้ทั้งหน้าเว็บและแดชบอร์ด — สูตรเดียวกับ js/modules/gradebook.js calc)
 *  ช่วง = Σ ได้ / Σ เต็ม × น้ำหนัก · ช่องว่าง/ไม่ส่ง = 0 · ช้า = คะแนน × (1 − %หัก) · ยกเว้น = ไม่นับงานนั้นทั้งได้และเต็ม
 *  ยกเว้นทุกงานในช่วง → ช่วงนั้นไม่นับ และขยายคะแนนรวมเป็นฐาน 100 · รวม = max(0, ดิบ − หักรวม) · ตัดเกรดจากคะแนนรวมปัดเป็นจำนวนเต็ม
 *  pct = คะแนนเทียบสัดส่วนเฉพาะช่วงที่มีงานแล้ว (ระหว่างภาค ใช้ประเมินความเสี่ยง — ไม่ใช่เกรดจริง)
 */
export function calcStudent(items, weights, sc, fl, deduct, scale, special) {
  sc = sc || {}; fl = fl || {};
  let exW = 0, any = false;
  const per = weights.map(function (w, pi) {
    const its = items.filter(function (i) { return Number(i.period) === pi + 1; });
    if (!its.length || !w) return null;
    any = true;
    let e = 0, m = 0;
    its.forEach(function (i) {
      const f = fl[i.item_id] || '';
      if (f === 'exempt') return;
      m += Number(i.max_score);
      if (f === 'missing') return;
      let v = Number(sc[i.item_id]) || 0;
      if (f === 'late' && Number(i.late_pct) > 0) v = v * (1 - Number(i.late_pct) / 100);
      e += v;
    });
    if (!m) { exW += w; return null; }
    return e / m * w;
  });
  let raw = per.reduce(function (a, b) { return a + (b || 0); }, 0);
  const covW = weights.reduce(function (a, w, i) { return a + (per[i] != null ? w : 0); }, 0);
  const pct = covW ? Math.max(0, raw / covW * 100 - (deduct || 0)) : null;
  if (exW > 0 && exW < 100) raw = raw * 100 / (100 - exW);
  const total = Math.max(0, raw - (deduct || 0));
  let result = '';
  if (special) result = special;
  else if (any) {
    const t = Math.round(total + 1e-9);
    if (scale.mode === 'pass') result = t >= scale.pass ? 'ผ' : 'มผ';
    else { result = '0'; for (let i = 0; i < 7; i++) if (t >= scale.th[i]) { result = String(GRADE_STEPS[i]); break; } }
  }
  return { per: per, raw: raw, deduct: deduct || 0, total: total, pct: pct, result: result, special: special || '' };
}
/** เสี่ยง: ส่งผลแล้ว = ผล 0/มผ/ร/มส · ระหว่างภาค = ผลพิเศษ ร/มส/มผ หรือคะแนนเทียบสัดส่วนต่ำกว่าเกณฑ์ผ่านขั้นต่ำ · หรือมีงานไม่ส่ง */
export function isRisk(x, scale, submitted, missing) {
  if (missing > 0) return true;
  if (submitted) return ['0', 'มผ', 'ร', 'มส'].indexOf(x.result) >= 0;
  if (['ร', 'มส', 'มผ'].indexOf(x.result) >= 0 && x.result !== '' && x.result === x.special) return true;
  return x.pct != null && x.pct < (scale.mode === 'pass' ? scale.pass : scale.th[6]);
}

/** "30,20,20,30" → [30,20,20,30] · ผิดรูปแบบ = ค่าเริ่มต้น */
function parseWeights(v) {
  const a = String(v || '').split(',').map(Number);
  const ok = a.length === 4 && a.every(function (n) { return isFinite(n) && n >= 0; }) && Math.abs(a.reduce(function (x, y) { return x + y; }, 0) - 100) < 0.001;
  return ok ? a : DEFAULT_WEIGHTS.slice();
}

async function currentTerm(db) {
  const y = String((await getSetting(db, 'current_year')) || '').trim();
  const s = String((await getSetting(db, 'current_semester')) || '1').trim();
  return y ? y + '-' + s : '';
}
/** ห้องว่าง/0 ถือเป็นห้อง 1 (เหมือนแผนที่บ้าน) */
function classKey(grade, room) { const r = String(room == null ? '' : room).trim(); return String(grade || '').trim() + '|' + (r === '' || r === '0' ? '1' : r); }
function classLabel(c) { return String(c.grade || '') + (c.room && String(c.room) !== '1' ? '/' + c.room : ''); }
function teacherLabel(t) { return t ? String((t.title || '') + ' ' + (t.name || '')).replace(/\s+/g, ' ').trim() : ''; }
function isViewer(u) { return can(u, 'gb_admin') || can(u, 'gb_view'); }
function gradeOrder(g) {
  const m = /^(อ|ป|ม)\.?\s*(\d+)/.exec(String(g || ''));
  return m ? ({ 'อ': 0, 'ป': 10, 'ม': 20 }[m[1]] + Number(m[2])) : 99;
}

/** ข้อมูลตารางสอนของภาค (ครู/วิชา/ชั้น/การมอบหมาย) + จำนวนนักเรียนต่อชั้น */
async function termData(db, term) {
  const [teachers, subjects, classes, assigns, students] = await Promise.all([
    selectWhere(db, 'TT_TEACHER', 'term_id', term), selectWhere(db, 'TT_SUBJECT', 'term_id', term),
    selectWhere(db, 'TT_CLASS', 'term_id', term), selectWhere(db, 'TT_ASSIGN', 'term_id', term),
    selectWhere(db, 'STUDENTS', 'status', 'active'),
  ]);
  const idx = function (rows, k) { const o = {}; rows.forEach(function (r) { o[r[k]] = r; }); return o; };
  const count = {};
  students.forEach(function (s) { const k = classKey(s.grade, s.room); count[k] = (count[k] || 0) + 1; });
  return { teachers: teachers, T: idx(teachers, 'teacher_id'), S: idx(subjects, 'subject_id'), C: idx(classes, 'class_id'), assigns: assigns, count: count, students: students };
}

function courseOf(term, a, d) {
  const c = d.C[a.class_id], s = d.S[a.subject_id], t = d.T[a.teacher_id];
  if (!c || !s || String(c.active) === '0' || String(s.active) === '0') return null;
  return {
    course_id: term + ':' + a.class_id + ':' + a.subject_id, term: term,
    class_id: a.class_id, grade: c.grade || '', room: c.room || '', class_label: classLabel(c), combine_group: c.combine_group || '',
    subject_id: a.subject_id, subject_code: s.code || '', subject_name: s.name || '', subject_type: s.type || '', type_label: SUBJECT_TYPE[s.type] || '',
    periods_week: Number(s.periods_week) || 0,
    teacher_id: a.teacher_id, teacher_name: teacherLabel(t),
    students: d.count[classKey(c.grade, c.room)] || 0,
  };
}
function sortCourses(list) {
  return list.sort(function (a, b) {
    return gradeOrder(a.grade) - gradeOrder(b.grade) || String(a.room).localeCompare(String(b.room)) ||
      String(a.subject_code).localeCompare(String(b.subject_code)) || a.subject_name.localeCompare(b.subject_name, 'th');
  });
}

/** สิทธิ์เข้าถึงรายวิชา: ครูผู้สอน (ตามการมอบหมาย) หรือ gb_admin / gb_view */
async function courseAccess(db, u, courseId) {
  const m = /^(\d{4}-[1-3]):([^:]+):([^:]+)$/.exec(String(courseId || ''));
  if (!m) apiError('VALIDATION', 'รหัสรายวิชาไม่ถูกต้อง');
  const term = m[1], d = await termData(db, term);
  const a = d.assigns.find(function (x) { return x.class_id === m[2] && x.subject_id === m[3]; });
  const course = a ? courseOf(term, a, d) : null;
  if (!course) apiError('NOT_FOUND', 'ไม่พบรายวิชานี้ในการมอบหมายการสอน');
  let mine = false;
  if (can(u, 'gb')) { const t = await teacherForTerm(db, u, term); mine = !!(t && t.teacher_id === a.teacher_id); }
  if (!mine && !isViewer(u)) apiError('FORBIDDEN', 'วิชานี้ไม่ได้มอบหมายให้คุณ');
  return { course: course, d: d, mine: mine, a: a };
}

/** สิทธิ์ + สถานะรายวิชา · แก้ได้: ครูผู้สอนในภาคปัจจุบัน หรือ gb_admin (ทุกภาค) · ส่งผลแล้ว = ล็อก (เฟส 3) */
async function courseCtx(db, u, courseId) {
  const acc = await courseAccess(db, u, courseId);
  const [cur, gc] = await Promise.all([currentTerm(db), getBy(db, 'GB_COURSE', 'course_id', acc.course.course_id)]);
  acc.gc = gc;
  acc.isCurrent = acc.course.term === cur;
  acc.locked = !!(gc && gc.status === 'submitted');
  acc.canEdit = !acc.locked && ((acc.mine && acc.isCurrent) || can(u, 'gb_admin'));
  acc.weights = parseWeights(gc && gc.weights);
  acc.scale = parseScale(gc && gc.grade_scale, acc.course.subject_type);
  return acc;
}
function requireEdit(cx) {
  if (cx.locked) apiError('LOCKED', 'รายวิชานี้ส่งผลแล้ว — ต้องให้ฝ่ายวิชาการปลดล็อกก่อนแก้ไข');
  if (!cx.canEdit) apiError('FORBIDDEN', cx.isCurrent ? 'คุณดูรายวิชานี้ได้อย่างเดียว' : 'ภาคเรียนที่ผ่านมาแล้ว แก้ไขได้เฉพาะฝ่ายวิชาการ');
}

/**
 * สร้าง/อัปเดตแถว GB_COURSE (ภาพถ่ายชื่อวิชา/ชั้น/ครูล่าสุด) — 1 คำสั่ง (คืน statement ไว้รวม batch)
 * set = ฟิลด์ที่ต้องการเขียนเพิ่ม { weights, grade_scale, status, submitted_at, submitted_by } (ไม่ส่ง = คงค่าเดิม)
 */
function courseUpsertStmt(db, cx, by, set) {
  const c = cx.course, t = now();
  set = Object.assign({}, set || {});
  if (Array.isArray(set.weights)) set.weights = set.weights.join(',');
  const keys = Object.keys(set);
  const base = { course_id: c.course_id, term: c.term, class_id: c.class_id, subject_id: c.subject_id, teacher_id: c.teacher_id, subject_code: c.subject_code,
    subject_name: c.subject_name, class_label: c.class_label, teacher_name: c.teacher_name, weights: cx.weights.join(','), grade_scale: '', status: '',
    submitted_at: '', submitted_by: '', created_by: by, created_at: t, updated_by: by, updated_at: t };
  keys.forEach(function (k) { base[k] = set[k]; });
  const cols = Object.keys(base);
  const upd = ['teacher_id', 'subject_code', 'subject_name', 'class_label', 'teacher_name'].concat(keys).concat(keys.length ? ['updated_by', 'updated_at'] : []);
  const st = db.prepare('INSERT INTO GB_COURSE (' + cols.join(',') + ') VALUES (' + cols.map(function () { return '?'; }).join(',') + ') ON CONFLICT(course_id) DO UPDATE SET ' +
    upd.map(function (k) { return k + '=excluded.' + k; }).join(', '));
  return st.bind.apply(st, cols.map(function (k) { return base[k] == null ? null : base[k]; }));
}

/** นักเรียนที่กำลังศึกษาในชั้นของรายวิชา (เรียงรหัสนักเรียน) */
function classStudents(cx) {
  const c = cx.course, key = classKey(c.grade, c.room);
  return cx.d.students.filter(function (s) { return classKey(s.grade, s.room) === key; })
    .sort(function (a, b) { return String(a.student_code).localeCompare(String(b.student_code), undefined, { numeric: true }) || studentName(a).localeCompare(studentName(b), 'th'); });
}

/**
 * รายชื่อรายวิชา = GB_ROSTER (ถ่าย ณ ภาคนั้น) · sync=true (ผู้แก้ไขได้ + ภาคปัจจุบัน) → เพิ่มคนใหม่ในชั้น / ตั้ง left_class ให้คนที่ออกจากชั้น
 * ไม่ sync และยังไม่เคยถ่าย (ผู้ดูอย่างเดียว / ภาคเก่า) → ใช้รายชื่อสดจากชั้น โดยไม่เขียนอะไร
 * → [{ citizen_id, left }]
 */
async function loadRoster(db, cx, sync) {
  const live = classStudents(cx), cid = cx.course.course_id;
  const rows = await selectWhere(db, 'GB_ROSTER', 'course_id', cid);
  if (!sync || cx.locked || !cx.isCurrent) {
    if (!rows.length) return live.map(function (s) { return { citizen_id: s.citizen_id, left: false }; });
    return rows.map(function (r) { return { citizen_id: r.citizen_id, left: Number(r.left_class) === 1 }; });
  }
  const inClass = {}; live.forEach(function (s) { inClass[s.citizen_id] = true; });
  const have = {}; rows.forEach(function (r) { have[r.citizen_id] = r; });
  const t = now(), stmts = [];
  const add = live.filter(function (s) { return !have[s.citizen_id]; });
  for (let i = 0; i < add.length; i += 20) {
    const part = add.slice(i, i + 20), binds = [];
    part.forEach(function (s) { binds.push(cid + ':' + s.citizen_id, cid, s.citizen_id, t); });
    const st = db.prepare('INSERT OR IGNORE INTO GB_ROSTER (roster_id, course_id, citizen_id, left_class, special, updated_at) VALUES ' + part.map(function () { return "(?,?,?,0,'',?)"; }).join(','));
    stmts.push(st.bind.apply(st, binds));
  }
  const flip = function (ids, v) {
    for (let i = 0; i < ids.length; i += 90) {
      const part = ids.slice(i, i + 90);
      const st = db.prepare('UPDATE GB_ROSTER SET left_class = ' + v + ', updated_at = ? WHERE roster_id IN (' + part.map(function () { return '?'; }).join(',') + ')');
      stmts.push(st.bind.apply(st, [t].concat(part)));
    }
  };
  flip(rows.filter(function (r) { return Number(r.left_class) !== 1 && !inClass[r.citizen_id]; }).map(function (r) { return r.roster_id; }), 1);
  flip(rows.filter(function (r) { return Number(r.left_class) === 1 && inClass[r.citizen_id]; }).map(function (r) { return r.roster_id; }), 0);
  if (stmts.length) await db.batch([courseUpsertStmt(db, cx, null)].concat(stmts));
  const out = live.map(function (s) { return { citizen_id: s.citizen_id, left: false }; });
  rows.forEach(function (r) { if (!inClass[r.citizen_id]) out.push({ citizen_id: r.citizen_id, left: true }); });
  return out;
}

function itemOut(r) {
  return { item_id: r.item_id, period: Number(r.period), title: r.title || '', max_score: Number(r.max_score) || 0, late_pct: Number(r.late_pct) || 0,
    item_date: r.item_date || '', note: r.note || '', active: Number(r.active) !== 0 };
}
async function userNames(db, ids) {
  ids = ids.filter(function (x, i) { return x && ids.indexOf(x) === i; }).slice(0, 90);
  if (!ids.length) return {};
  const st = db.prepare('SELECT user_id, display_name FROM TT_USER WHERE user_id IN (' + ids.map(function () { return '?'; }).join(',') + ')');
  const o = {}; ((await st.bind.apply(st, ids).all()).results || []).forEach(function (r) { o[r.user_id] = r.display_name || ''; });
  return o;
}
function deductOut(r, names) {
  return { deduct_id: r.deduct_id, citizen_id: r.citizen_id, points: Number(r.points) || 0, reason: r.reason || '', deduct_date: r.deduct_date || '',
    by: names[r.created_by] || '', created_at: r.created_at || '', voided: !!r.voided_at, voided_at: r.voided_at || '', voided_by: names[r.voided_by] || '', void_reason: r.void_reason || '' };
}
/** คนในรายชื่อที่ยังไม่ออกจากชั้น (สำหรับตรวจสิทธิ์เขียน) */
async function rosterSet(db, cx) {
  const o = {}; (await loadRoster(db, cx, true)).forEach(function (r) { if (!r.left) o[r.citizen_id] = true; });
  return o;
}
function num(v) { return Math.round(Number(v) * 100) / 100; }

export const GradebookActions = {

  /**
   * วิชาของฉันในภาคปัจจุบัน · gb_admin/gb_view ส่ง teacher_id เพื่อดูในนามครูคนอื่น หรือ all:true ดูทุกวิชา
   * → { term, me:{teacher_id,name}|null, viewing, courses[], teachers[] (เฉพาะผู้ดู) }
   */
  gb_my_courses: async function (params, ctx) {
    const u = await requireCap(ctx, null);
    if (!can(u, 'gb') && !isViewer(u)) apiError('FORBIDDEN', 'บัญชีนี้ไม่มีสิทธิ์ใช้ระบบบันทึกคะแนน');
    const db = ctx.db, term = await currentTerm(db);
    if (!term) apiError('CONFIG', 'ยังไม่ได้ตั้งปีการศึกษาปัจจุบันในหน้าตั้งค่าระบบ');
    const d = await termData(db, term);
    const meT = can(u, 'gb') ? await teacherForTerm(db, u, term) : null;
    let viewing = meT ? meT.teacher_id : '';
    if (isViewer(u) && params.all === true) viewing = '*';
    else if (isViewer(u) && params.teacher_id) viewing = String(params.teacher_id);
    else if (!viewing && isViewer(u)) viewing = '*';
    const courses = sortCourses(d.assigns.filter(function (a) { return viewing === '*' || a.teacher_id === viewing; })
      .map(function (a) { return courseOf(term, a, d); }).filter(Boolean));
    const ic = {};
    ((await ctx.db.prepare('SELECT course_id, COUNT(*) AS n FROM GB_ITEM WHERE active = 1 AND course_id LIKE ? GROUP BY course_id').bind(term + ':%').all()).results || [])
      .forEach(function (r) { ic[r.course_id] = Number(r.n) || 0; });
    const stt = {};
    ((await ctx.db.prepare("SELECT course_id, status FROM GB_COURSE WHERE term = ?").bind(term).all()).results || []).forEach(function (r) { stt[r.course_id] = r.status || ''; });
    courses.forEach(function (c) { c.items = ic[c.course_id] || 0; c.status = stt[c.course_id] || ''; });
    const out = { term: term, me: meT ? { teacher_id: meT.teacher_id, name: teacherLabel(meT) } : null, viewing: viewing, courses: courses,
      can_admin: can(u, 'gb_admin'), can_view_all: isViewer(u) };
    if (isViewer(u)) {
      const n = {}; d.assigns.forEach(function (a) { n[a.teacher_id] = (n[a.teacher_id] || 0) + 1; });
      out.teachers = d.teachers.filter(function (t) { return String(t.active) !== '0'; })
        .map(function (t) { return { teacher_id: t.teacher_id, name: teacherLabel(t), courses: n[t.teacher_id] || 0 }; })
        .sort(function (a, b) { return a.name.localeCompare(b.name, 'th'); });
    }
    return out;
  },

  /**
   * รายวิชา 1 รายการ: ข้อมูลวิชา + น้ำหนักช่วง + รายชื่อ (อัตโนมัติจากชั้น/ห้อง) + งาน + คะแนน
   * → { course, periods[{no,label,weight}], students[{no,citizen_id,student_code,name,gender,left}], items[], removed_items[], scores{cid:{item_id:score}}, can_edit, locked, is_current }
   */
  gb_course: async function (params, ctx) {
    const u = await requireCap(ctx, null), db = ctx.db;
    const cx = await courseCtx(db, u, params.course_id), cid = cx.course.course_id;
    const roster = await loadRoster(db, cx, cx.canEdit);
    const [itemRows, scoreRows, dedRows, rosterRows, stuRows] = await Promise.all([
      selectWhere(db, 'GB_ITEM', 'course_id', cid), selectWhere(db, 'GB_SCORE', 'course_id', cid), selectWhere(db, 'GB_DEDUCT', 'course_id', cid),
      selectWhere(db, 'GB_ROSTER', 'course_id', cid),
      // นักเรียนที่ออกจากชั้นแล้วอาจไม่ active — อ่านชื่อจาก STUDENTS ทุกสถานะเฉพาะคนในรายชื่อ
      roster.some(function (r) { return r.left; }) ? db.prepare("SELECT s.* FROM STUDENTS s JOIN GB_ROSTER r ON r.citizen_id = s.citizen_id WHERE r.course_id = ? AND r.left_class = 1").bind(cid).all().then(function (x) { return x.results || []; }) : Promise.resolve([]),
    ]);
    const S = {}; cx.d.students.concat(stuRows).forEach(function (s) { S[s.citizen_id] = s; });
    const items = itemRows.map(itemOut).sort(function (a, b) { return a.period - b.period || String(a.item_date || '9').localeCompare(String(b.item_date || '9')) || 0; });
    const activeIds = {}; items.forEach(function (i) { if (i.active) activeIds[i.item_id] = true; });
    const scores = {}, flags = {}, hasScore = {};
    scoreRows.forEach(function (r) {
      if (r.flag) (flags[r.citizen_id] = flags[r.citizen_id] || {})[r.item_id] = r.flag;
      if (r.score == null || r.score === '') { if (r.flag && activeIds[r.item_id]) hasScore[r.citizen_id] = true; return; }
      (scores[r.citizen_id] = scores[r.citizen_id] || {})[r.item_id] = Number(r.score);
      if (activeIds[r.item_id]) hasScore[r.citizen_id] = true;
    });
    const special = {}; rosterRows.forEach(function (r) { if (r.special) special[r.citizen_id] = r.special; });
    const names = await userNames(db, dedRows.map(function (r) { return r.created_by; }).concat(dedRows.map(function (r) { return r.voided_by; }), [cx.gc && cx.gc.submitted_by]));
    // คนที่ออกจากชั้นแสดงเฉพาะที่มีคะแนนค้าง (ไว้ดู) — ไม่มีคะแนนก็ซ่อน
    let no = 0;
    const students = roster.filter(function (r) { return !r.left || hasScore[r.citizen_id]; }).map(function (r) {
      const s = S[r.citizen_id] || {};
      return { no: r.left ? null : ++no, citizen_id: r.citizen_id, student_code: s.student_code || '', name: s.citizen_id ? studentName(s) : '(ไม่พบข้อมูลนักเรียน)', gender: s.gender || '', left: r.left, special: special[r.citizen_id] || '' };
    });
    return {
      course: cx.course, periods: PERIODS.map(function (l, i) { return { no: i + 1, label: l, weight: cx.weights[i] }; }),
      students: students, items: items.filter(function (i) { return i.active; }), removed_items: items.filter(function (i) { return !i.active; }),
      scores: scores, flags: flags, scale: cx.scale,
      deductions: dedRows.map(function (r) { return deductOut(r, names); }).sort(function (a, b) { return String(b.created_at).localeCompare(String(a.created_at)); }),
      can_edit: cx.canEdit, locked: cx.locked, is_current: cx.isCurrent, can_unlock: cx.locked && can(u, 'gb_admin'),
      submitted: cx.locked ? { at: cx.gc.submitted_at || '', by: names[cx.gc.submitted_by] || '' } : null,
    };
  },

  /**
   * ตั้งค่าวิชา · params { course_id, weights?:[4 จำนวนเต็ม รวม 100], scale?:{ mode:'grade'|'pass', th:[7 ขั้นจากมากไปน้อย], pass } }
   * ช่วงที่ยังมีงานอยู่ตั้งน้ำหนักเป็น 0 ไม่ได้
   */
  gb_course_save: async function (params, ctx) {
    const u = await requireCap(ctx, null), db = ctx.db;
    const cx = await courseCtx(db, u, params.course_id); requireEdit(cx);
    const set = {};
    if (params.weights !== undefined) {
      const w = Array.isArray(params.weights) ? params.weights.map(Number) : [];
      if (w.length !== 4 || w.some(function (n) { return !isFinite(n) || n < 0 || n > 100 || Math.round(n) !== n; })) apiError('VALIDATION', 'น้ำหนักแต่ละช่วงต้องเป็นจำนวนเต็ม 0–100');
      const sum = w.reduce(function (a, b) { return a + b; }, 0);
      if (sum !== 100) apiError('VALIDATION', 'น้ำหนักรวมต้องเท่ากับ 100 (ตอนนี้ ' + sum + ')');
      const items = (await selectWhere(db, 'GB_ITEM', 'course_id', cx.course.course_id)).filter(function (r) { return Number(r.active) !== 0; });
      const bad = PERIODS.filter(function (l, i) { return w[i] === 0 && items.some(function (r) { return Number(r.period) === i + 1; }); });
      if (bad.length) apiError('VALIDATION', 'ช่วง "' + bad.join('", "') + '" ยังมีงานอยู่ — ย้ายหรือลบงานก่อนตั้งน้ำหนักเป็น 0');
      set.weights = w;
    }
    let scale = cx.scale;
    if (params.scale !== undefined) {
      const sc = params.scale || {};
      if (sc.mode !== 'grade' && sc.mode !== 'pass') apiError('VALIDATION', 'เลือกรูปแบบผลการเรียน');
      const th = Array.isArray(sc.th) ? sc.th.map(Number) : cx.scale.th;
      if (!validTh(th)) apiError('VALIDATION', 'เกณฑ์เกรดต้องเป็นตัวเลข 1–100 และเรียงจากมากไปน้อย (เกรด 4 สูงสุด)');
      const pass = Number(sc.pass === undefined ? cx.scale.pass : sc.pass);
      if (!(pass > 0 && pass <= 100)) apiError('VALIDATION', 'เกณฑ์ผ่านต้องอยู่ระหว่าง 1–100');
      if (sc.mode !== cx.scale.mode) {
        // เปลี่ยนรูปแบบ → ผลพิเศษของแบบเดิมใช้ไม่ได้ (ร/มส ↔ ผ/มผ)
        const n = await db.prepare("SELECT COUNT(*) AS n FROM GB_ROSTER WHERE course_id = ? AND special IS NOT NULL AND special <> ''").bind(cx.course.course_id).first();
        if (n && Number(n.n) > 0) apiError('VALIDATION', 'มีนักเรียน ' + n.n + ' คนที่กำหนดผลพิเศษไว้ (' + SPECIAL[cx.scale.mode].slice(1).join('/') + ') — ล้างผลพิเศษก่อนเปลี่ยนรูปแบบ');
      }
      scale = { mode: sc.mode, th: th, pass: pass };
      set.grade_scale = JSON.stringify(scale);
    }
    if (!Object.keys(set).length) apiError('VALIDATION', 'ไม่มีค่าที่จะบันทึก');
    await courseUpsertStmt(db, cx, u.user_id, set).run();
    return { weights: set.weights || cx.weights, scale: scale };
  },

  /** เพิ่ม/แก้ไขงาน · params { course_id, item_id?, period, title, max_score, item_date?, note?, active? } (active:true = กู้คืนงานที่ลบ) */
  gb_item_save: async function (params, ctx) {
    const u = await requireCap(ctx, null), db = ctx.db;
    const cx = await courseCtx(db, u, params.course_id); requireEdit(cx);
    const cid = cx.course.course_id;
    let old = null;
    if (params.item_id) {
      old = await getBy(db, 'GB_ITEM', 'item_id', String(params.item_id));
      if (!old || old.course_id !== cid) apiError('NOT_FOUND', 'ไม่พบงานนี้ในรายวิชา');
    }
    const restoreOnly = old && params.active === true && params.title === undefined;
    const period = restoreOnly ? Number(old.period) : Number(params.period);
    const title = restoreOnly ? old.title : String(params.title || '').replace(/\s+/g, ' ').trim();
    const max = restoreOnly ? Number(old.max_score) : num(params.max_score);
    const date = restoreOnly ? (old.item_date || '') : (params.item_date ? (/^\d{4}-\d{2}-\d{2}$/.test(String(params.item_date)) ? String(params.item_date) : null) : '');
    const note = restoreOnly ? (old.note || '') : String(params.note || '').trim().slice(0, 200);
    const late = restoreOnly ? (Number(old.late_pct) || 0) : num(params.late_pct || 0);
    if (!(period >= 1 && period <= 4 && Math.round(period) === period)) apiError('VALIDATION', 'เลือกช่วงคะแนน');
    if (cx.weights[period - 1] === 0) apiError('VALIDATION', 'ช่วง "' + PERIODS[period - 1] + '" มีน้ำหนัก 0 — ตั้งน้ำหนักในตั้งค่าวิชาก่อน');
    if (!title) apiError('VALIDATION', 'กรอกชื่องาน');
    if (title.length > 80) apiError('VALIDATION', 'ชื่องานยาวเกิน 80 ตัวอักษร');
    if (!(max > 0 && max <= 1000)) apiError('VALIDATION', 'คะแนนเต็มต้องมากกว่า 0 และไม่เกิน 1000');
    if (date === null) apiError('VALIDATION', 'วันที่ไม่ถูกต้อง');
    if (!(late >= 0 && late <= 100)) apiError('VALIDATION', '% หักเมื่อส่งช้าต้องอยู่ระหว่าง 0–100');
    const t = now();
    if (old) {
      const over = await db.prepare('SELECT COUNT(*) AS n FROM GB_SCORE WHERE item_id = ? AND score > ?').bind(old.item_id, max).first();
      if (over && Number(over.n) > 0) apiError('VALIDATION', 'มีนักเรียน ' + over.n + ' คนได้คะแนนเกิน ' + max + ' — แก้คะแนนก่อนลดคะแนนเต็ม');
      await db.batch([courseUpsertStmt(db, cx, u.user_id),
        db.prepare('UPDATE GB_ITEM SET period = ?, title = ?, max_score = ?, late_pct = ?, item_date = ?, note = ?, active = ?, updated_by = ?, updated_at = ? WHERE item_id = ?')
          .bind(period, title, max, late, date, note, params.active === true ? 1 : Number(old.active), u.user_id, t, old.item_id)]);
      return { item: itemOut(Object.assign({}, old, { period: period, title: title, max_score: max, late_pct: late, item_date: date, note: note, active: params.active === true ? 1 : old.active })) };
    }
    const n = await db.prepare('SELECT COUNT(*) AS n FROM GB_ITEM WHERE course_id = ? AND active = 1').bind(cid).first();
    if (n && Number(n.n) >= 60) apiError('VALIDATION', 'รายวิชานี้มีงานครบ 60 รายการแล้ว');
    const row = { item_id: genId('GBI'), course_id: cid, period: period, title: title, max_score: max, late_pct: late, item_date: date, note: note, active: 1 };
    await db.batch([courseUpsertStmt(db, cx, u.user_id),
      db.prepare("INSERT INTO GB_ITEM (item_id, course_id, period, title, max_score, item_date, late_pct, note, active, created_by, created_at, updated_by, updated_at) VALUES (?,?,?,?,?,?,?,?,1,?,?,?,?)")
        .bind(row.item_id, cid, period, title, max, date, late, note, u.user_id, t, u.user_id, t)]);
    return { item: itemOut(row) };
  },

  /** ลบงาน = active 0 (คะแนนยังเก็บไว้ กู้คืนได้) */
  gb_item_remove: async function (params, ctx) {
    const u = await requireCap(ctx, null), db = ctx.db;
    const cx = await courseCtx(db, u, params.course_id); requireEdit(cx);
    const old = await getBy(db, 'GB_ITEM', 'item_id', String(params.item_id || ''));
    if (!old || old.course_id !== cx.course.course_id) apiError('NOT_FOUND', 'ไม่พบงานนี้ในรายวิชา');
    await db.prepare('UPDATE GB_ITEM SET active = 0, updated_by = ?, updated_at = ? WHERE item_id = ?').bind(u.user_id, now(), old.item_id).run();
    return { item_id: old.item_id };
  },

  /**
   * บันทึกคะแนน · params { course_id, scores:[{ item_id, citizen_id, score, flag? }] } (score null/'' = ล้าง) · ไม่เกิน 200 ช่อง/คำขอ
   * flag: '' | late | missing | exempt (ไม่ส่ง flag = คงป้ายเดิม) · ไม่ส่ง/ยกเว้น → ล้างคะแนน
   * ต้องเป็นงานที่ใช้งานอยู่ของรายวิชา และนักเรียนในรายชื่อ (ยังไม่ออกจากชั้น) · 0 ≤ score ≤ คะแนนเต็ม
   */
  gb_score_save: async function (params, ctx) {
    const u = await requireCap(ctx, null), db = ctx.db;
    const cx = await courseCtx(db, u, params.course_id); requireEdit(cx);
    const cid = cx.course.course_id, list = params.scores;
    if (!Array.isArray(list) || !list.length) apiError('VALIDATION', 'ไม่มีคะแนนที่จะบันทึก');
    if (list.length > MAX_CELLS) apiError('VALIDATION', 'บันทึกได้ครั้งละไม่เกิน ' + MAX_CELLS + ' ช่อง');
    const [roster, itemRows] = await Promise.all([loadRoster(db, cx, true), selectWhere(db, 'GB_ITEM', 'course_id', cid)]);
    const inRoster = {}; roster.forEach(function (r) { if (!r.left) inRoster[r.citizen_id] = true; });
    const I = {}; itemRows.forEach(function (r) { if (Number(r.active) !== 0) I[r.item_id] = r; });
    const seen = {}, rows = [];
    list.forEach(function (x) {
      const it = I[String(x && x.item_id)], c = String(x && x.citizen_id);
      if (!it) apiError('VALIDATION', 'ไม่พบงานนี้ (อาจถูกลบไปแล้ว) — โหลดหน้าใหม่');
      if (!inRoster[c]) apiError('VALIDATION', 'นักเรียนไม่อยู่ในรายชื่อรายวิชานี้ — โหลดหน้าใหม่');
      let v = x.score, f = null;
      if (x.flag !== undefined && x.flag !== null) {
        f = String(x.flag);
        if (FLAGS.indexOf(f) < 0) apiError('VALIDATION', 'ป้ายคะแนนไม่ถูกต้อง');
      }
      if (v === '' || v === undefined || f === 'missing' || f === 'exempt') v = null;
      if (v !== null) {
        v = Number(v);
        if (!isFinite(v) || v < 0) apiError('VALIDATION', 'คะแนนต้องเป็นตัวเลขตั้งแต่ 0 ขึ้นไป');
        v = num(v);
        if (v > Number(it.max_score)) apiError('VALIDATION', 'คะแนนเกินคะแนนเต็ม (' + it.title + ' เต็ม ' + Number(it.max_score) + ')');
      }
      const k = it.item_id + ':' + c;
      if (!seen[k]) rows.push({ k: k, item_id: it.item_id, cid: c, v: v, f: f });
      else { rows[seen[k] - 1].v = v; rows[seen[k] - 1].f = f; }
      seen[k] = seen[k] || rows.length;
    });
    const t = now(), stmts = [];
    for (let i = 0; i < rows.length; i += 12) {
      const part = rows.slice(i, i + 12), binds = [];
      part.forEach(function (r) { binds.push(r.k, r.item_id, cid, r.cid, r.v, r.f, u.user_id, t); });
      const st = db.prepare('INSERT INTO GB_SCORE (score_id, item_id, course_id, citizen_id, score, flag, recorded_by, updated_at) VALUES ' +
        part.map(function () { return '(?,?,?,?,?,?,?,?)'; }).join(',') +
        ' ON CONFLICT(score_id) DO UPDATE SET score = excluded.score, flag = COALESCE(excluded.flag, GB_SCORE.flag), recorded_by = excluded.recorded_by, updated_at = excluded.updated_at');
      stmts.push(st.bind.apply(st, binds));
    }
    await db.batch([courseUpsertStmt(db, cx, u.user_id)].concat(stmts));
    return { saved: rows.length, updated_at: t };
  },

  /** ผลพิเศษรายคน · params { course_id, items:[{ citizen_id, special }] } · เกรด: '' ร มส · ผ่าน/ไม่ผ่าน: '' ผ มผ ('' = ตามคะแนน) */
  gb_special_save: async function (params, ctx) {
    const u = await requireCap(ctx, null), db = ctx.db;
    const cx = await courseCtx(db, u, params.course_id); requireEdit(cx);
    const list = params.items, cid = cx.course.course_id;
    if (!Array.isArray(list) || !list.length || list.length > 100) apiError('VALIDATION', 'ต้องมี 1–100 รายการ');
    const ok = await rosterSet(db, cx), allowed = SPECIAL[cx.scale.mode], by = {};
    list.forEach(function (x) {
      const c = String(x && x.citizen_id), v = String((x && x.special) || '');
      if (!ok[c]) apiError('VALIDATION', 'นักเรียนไม่อยู่ในรายชื่อรายวิชานี้ — โหลดหน้าใหม่');
      if (allowed.indexOf(v) < 0) apiError('VALIDATION', 'ผลพิเศษ "' + v + '" ใช้กับรายวิชานี้ไม่ได้');
      (by[v] = by[v] || []).push(cid + ':' + c);
    });
    const t = now(), stmts = [courseUpsertStmt(db, cx, u.user_id)];
    Object.keys(by).forEach(function (v) {
      const st = db.prepare('UPDATE GB_ROSTER SET special = ?, updated_at = ? WHERE roster_id IN (' + by[v].map(function () { return '?'; }).join(',') + ')');
      stmts.push(st.bind.apply(st, [v, t].concat(by[v])));
    });
    await db.batch(stmts);
    return { saved: list.length };
  },

  /** หักคะแนนจากคะแนนรวม · params { course_id, citizen_ids[], points, reason, deduct_date? } (หลายคนพร้อมกันได้ ≤ 60) */
  gb_deduct_add: async function (params, ctx) {
    const u = await requireCap(ctx, null), db = ctx.db;
    const cx = await courseCtx(db, u, params.course_id); requireEdit(cx);
    const ids = Array.isArray(params.citizen_ids) ? params.citizen_ids.map(String).filter(function (x, i, a) { return a.indexOf(x) === i; }) : [];
    if (!ids.length || ids.length > 60) apiError('VALIDATION', 'เลือกนักเรียน 1–60 คน');
    const pts = num(params.points), reason = String(params.reason || '').replace(/\s+/g, ' ').trim();
    if (!(pts > 0 && pts <= 100)) apiError('VALIDATION', 'คะแนนที่หักต้องมากกว่า 0 และไม่เกิน 100');
    if (!reason) apiError('VALIDATION', 'กรอกเหตุผลที่หักคะแนน');
    if (reason.length > 200) apiError('VALIDATION', 'เหตุผลยาวเกิน 200 ตัวอักษร');
    const date = params.deduct_date ? String(params.deduct_date) : today();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) apiError('VALIDATION', 'วันที่ไม่ถูกต้อง');
    const ok = await rosterSet(db, cx);
    ids.forEach(function (c) { if (!ok[c]) apiError('VALIDATION', 'นักเรียนไม่อยู่ในรายชื่อรายวิชานี้ — โหลดหน้าใหม่'); });
    const t = now(), cid = cx.course.course_id, rows = ids.map(function (c) { return { deduct_id: genId('GBD'), citizen_id: c }; });
    const stmts = [courseUpsertStmt(db, cx, u.user_id)];
    for (let i = 0; i < rows.length; i += 12) {
      const part = rows.slice(i, i + 12), binds = [];
      part.forEach(function (r) { binds.push(r.deduct_id, cid, r.citizen_id, pts, reason, date, u.user_id, t); });
      const st = db.prepare('INSERT INTO GB_DEDUCT (deduct_id, course_id, citizen_id, points, reason, deduct_date, created_by, created_at) VALUES ' + part.map(function () { return '(?,?,?,?,?,?,?,?)'; }).join(','));
      stmts.push(st.bind.apply(st, binds));
    }
    await db.batch(stmts);
    const names = {}; names[u.user_id] = u.display_name || '';
    return { deductions: rows.map(function (r) { return deductOut({ deduct_id: r.deduct_id, citizen_id: r.citizen_id, points: pts, reason: reason, deduct_date: date, created_by: u.user_id, created_at: t }, names); }) };
  },

  /** ยกเลิกการหัก (ไม่ลบ — เก็บประวัติ) · params { course_id, deduct_id, reason? } */
  gb_deduct_void: async function (params, ctx) {
    const u = await requireCap(ctx, null), db = ctx.db;
    const cx = await courseCtx(db, u, params.course_id); requireEdit(cx);
    const r = await getBy(db, 'GB_DEDUCT', 'deduct_id', String(params.deduct_id || ''));
    if (!r || r.course_id !== cx.course.course_id) apiError('NOT_FOUND', 'ไม่พบรายการหักคะแนนนี้');
    if (r.voided_at) apiError('VALIDATION', 'รายการนี้ยกเลิกไปแล้ว');
    const t = now(), why = String(params.reason || '').replace(/\s+/g, ' ').trim().slice(0, 200);
    await db.prepare('UPDATE GB_DEDUCT SET voided_at = ?, voided_by = ?, void_reason = ? WHERE deduct_id = ?').bind(t, u.user_id, why, r.deduct_id).run();
    return { deduct_id: r.deduct_id, voided_at: t, void_reason: why };
  },

  /**
   * ส่งผลการเรียน = ล็อกรายวิชา (แก้ไม่ได้จนกว่า gb_admin ปลดล็อก) · params { course_id, confirm:true }
   * ต้องมีงานอย่างน้อย 1 รายการ หรือทุกคนมีผลพิเศษ · คืนสรุปผล
   */
  gb_submit: async function (params, ctx) {
    const u = await requireCap(ctx, null), db = ctx.db;
    const cx = await courseCtx(db, u, params.course_id); requireEdit(cx);
    if (params.confirm !== true) apiError('VALIDATION', 'ต้องยืนยันก่อนส่งผล (confirm=true)');
    const cid = cx.course.course_id;
    const [roster, itemRows, scoreRows, dedRows, rosterRows] = await Promise.all([loadRoster(db, cx, true), selectWhere(db, 'GB_ITEM', 'course_id', cid),
      selectWhere(db, 'GB_SCORE', 'course_id', cid), selectWhere(db, 'GB_DEDUCT', 'course_id', cid), selectWhere(db, 'GB_ROSTER', 'course_id', cid)]);
    const items = itemRows.filter(function (r) { return Number(r.active) !== 0; });
    const sc = {}, fl = {}, dd = {}, sp = {};
    scoreRows.forEach(function (r) { if (r.score != null && r.score !== '') (sc[r.citizen_id] = sc[r.citizen_id] || {})[r.item_id] = Number(r.score); if (r.flag) (fl[r.citizen_id] = fl[r.citizen_id] || {})[r.item_id] = r.flag; });
    dedRows.forEach(function (r) { if (!r.voided_at) dd[r.citizen_id] = (dd[r.citizen_id] || 0) + Number(r.points); });
    rosterRows.forEach(function (r) { if (r.special) sp[r.citizen_id] = r.special; });
    const act = roster.filter(function (r) { return !r.left; });
    if (!act.length) apiError('VALIDATION', 'รายวิชานี้ไม่มีนักเรียน');
    const res = {}, blank = [];
    act.forEach(function (r) {
      const x = calcStudent(items, cx.weights, sc[r.citizen_id], fl[r.citizen_id], dd[r.citizen_id], cx.scale, sp[r.citizen_id]);
      if (!x.result) blank.push(r.citizen_id);
      res[x.result] = (res[x.result] || 0) + 1;
    });
    if (blank.length) apiError('VALIDATION', 'ยังไม่มีผลการเรียน ' + blank.length + ' คน — เพิ่มงาน/คะแนน หรือกำหนดผลรายคนก่อนส่ง');
    const t = now();
    await courseUpsertStmt(db, cx, u.user_id, { status: 'submitted', submitted_at: t, submitted_by: u.user_id }).run();
    return { status: 'submitted', submitted_at: t, summary: res, students: act.length };
  },

  /** ปลดล็อกรายวิชาที่ส่งผลแล้ว — ฝ่ายวิชาการ/ผู้ดูแล (gb_admin) เท่านั้น */
  gb_unlock: async function (params, ctx) {
    const u = await requireCap(ctx, 'gb_admin'), db = ctx.db;
    const cx = await courseCtx(db, u, params.course_id);
    if (!cx.locked) apiError('VALIDATION', 'รายวิชานี้ยังไม่ได้ส่งผล');
    await courseUpsertStmt(db, cx, u.user_id, { status: '' }).run();
    return { status: '' };
  },

  /**
   * แดชบอร์ด · params { term?, teacher_id? } — gb_admin/gb_view เห็นทุกรายวิชา (หรือเฉพาะครูที่เลือก) · ครูเห็นเฉพาะวิชาตัวเอง
   * → { term, terms[], scope, courses[{…, students, items, entered_pct, avg, dist{ผล:จำนวน}, risk, status}], students[{name, student_code, class_label, grade, room}],
   *     results[[student_idx, course_idx, total|null, result, missing, risk 0/1, pct|null]] }   (ไม่ส่งเลขประจำตัว)
   * ความคืบหน้า = ช่องที่มีคะแนนหรือป้าย ÷ (งาน × นักเรียน) · เสี่ยง = isRisk · avg = คะแนนรวมเฉลี่ย (ส่งผลแล้ว) หรือ % เทียบช่วงที่มีงาน (ระหว่างภาค)
   */
  gb_overview: async function (params, ctx) {
    const u = await requireCap(ctx, null), db = ctx.db;
    if (!can(u, 'gb') && !isViewer(u)) apiError('FORBIDDEN', 'บัญชีนี้ไม่มีสิทธิ์ใช้ระบบบันทึกคะแนน');
    const cur = await currentTerm(db);
    const term = /^\d{4}-[1-3]$/.test(String(params.term || '')) ? String(params.term) : cur;
    if (!term) apiError('CONFIG', 'ยังไม่ได้ตั้งปีการศึกษาปัจจุบันในหน้าตั้งค่าระบบ');
    const d = await termData(db, term);
    let scope = '*';
    if (!isViewer(u)) { const t = await teacherForTerm(db, u, term); scope = t ? t.teacher_id : '-'; }
    else if (params.teacher_id) scope = String(params.teacher_id);
    const courses = sortCourses(d.assigns.filter(function (a) { return scope === '*' || a.teacher_id === scope; })
      .map(function (a) { return courseOf(term, a, d); }).filter(Boolean));
    // อ่าน GB_* ของทั้งภาคด้วยช่วง course_id (ใช้ index) แล้วจัดกลุ่มในหน่วยความจำ
    const lo = term + ':', hi = term + ';';
    const rng = function (t) { return db.prepare('SELECT * FROM ' + t + ' WHERE course_id >= ? AND course_id < ?').bind(lo, hi).all().then(function (r) { return r.results || []; }); };
    const [gcs, items, scores, deds, rosters, terms] = await Promise.all([rng('GB_COURSE'), rng('GB_ITEM'), rng('GB_SCORE'), rng('GB_DEDUCT'), rng('GB_ROSTER'),
      db.prepare('SELECT DISTINCT term FROM GB_COURSE').all().then(function (r) { return (r.results || []).map(function (x) { return x.term; }); })]);
    const by = function (rows) { const o = {}; rows.forEach(function (r) { (o[r.course_id] = o[r.course_id] || []).push(r); }); return o; };
    const G = {}; gcs.forEach(function (r) { G[r.course_id] = r; });
    const I = by(items.filter(function (r) { return Number(r.active) !== 0; })), SC = by(scores), DD = by(deds), RO = by(rosters);
    // ชื่อนักเรียนที่ออกจากชั้น/ไม่ active ต้องอ่านเพิ่ม
    const S = {}; d.students.forEach(function (x) { S[x.citizen_id] = x; });
    const missingIds = rosters.filter(function (r) { return !S[r.citizen_id] && Number(r.left_class) !== 1; }).map(function (r) { return r.citizen_id; })
      .filter(function (x, i, a) { return a.indexOf(x) === i; });
    for (let i = 0; i < missingIds.length; i += 90) {
      const part = missingIds.slice(i, i + 90), st = db.prepare('SELECT * FROM STUDENTS WHERE citizen_id IN (' + part.map(function () { return '?'; }).join(',') + ')');
      ((await st.bind.apply(st, part).all()).results || []).forEach(function (x) { S[x.citizen_id] = x; });
    }
    const sIdx = {}, students = [], results = [];
    const stuIndex = function (cid, c) {
      if (sIdx[cid] === undefined) {
        const x = S[cid] || {};
        sIdx[cid] = students.length;
        students.push({ name: x.citizen_id ? studentName(x) : '(ไม่พบข้อมูลนักเรียน)', student_code: x.student_code || '', class_label: c.class_label, grade: c.grade, room: c.room });
      }
      return sIdx[cid];
    };
    const out = courses.map(function (c, ci) {
      const gc = G[c.course_id], its = I[c.course_id] || [], weights = parseWeights(gc && gc.weights), scale = parseScale(gc && gc.grade_scale, c.subject_type);
      const ro = RO[c.course_id];
      const roster = ro && ro.length ? ro.filter(function (r) { return Number(r.left_class) !== 1; }).map(function (r) { return r.citizen_id; })
        : d.students.filter(function (x) { return classKey(x.grade, x.room) === classKey(c.grade, c.room); }).map(function (x) { return x.citizen_id; });
      const sp = {}; (ro || []).forEach(function (r) { if (r.special) sp[r.citizen_id] = r.special; });
      const sc = {}, fl = {}, dd = {};
      const activeItem = {}; its.forEach(function (i) { activeItem[i.item_id] = true; });
      let filled = 0;
      const inRoster = {}; roster.forEach(function (x) { inRoster[x] = true; });
      (SC[c.course_id] || []).forEach(function (r) {
        if (!activeItem[r.item_id]) return;
        const has = r.score != null && r.score !== '';
        if (has) (sc[r.citizen_id] = sc[r.citizen_id] || {})[r.item_id] = Number(r.score);
        if (r.flag) (fl[r.citizen_id] = fl[r.citizen_id] || {})[r.item_id] = r.flag;
        if ((has || r.flag) && inRoster[r.citizen_id]) filled++;
      });
      (DD[c.course_id] || []).forEach(function (r) { if (!r.voided_at) dd[r.citizen_id] = (dd[r.citizen_id] || 0) + Number(r.points); });
      const dist = {}, submitted = !!(gc && gc.status === 'submitted'); let sum = 0, n = 0, risk = 0;
      roster.forEach(function (cid) {
        const x = calcStudent(its, weights, sc[cid], fl[cid], dd[cid], scale, sp[cid]);
        const miss = Object.keys(fl[cid] || {}).filter(function (k) { return fl[cid][k] === 'missing'; }).length;
        if (x.result) dist[x.result] = (dist[x.result] || 0) + 1;
        const v = submitted ? x.total : x.pct;
        if (its.length && v != null) { sum += v; n++; }
        const bad = isRisk(x, scale, submitted, miss);
        if (bad) risk++;
        results.push([stuIndex(cid, c), ci, its.length ? Math.round(x.total * 100) / 100 : null, x.result, miss, bad ? 1 : 0, x.pct == null ? null : Math.round(x.pct * 10) / 10]);
      });
      return { course_id: c.course_id, class_id: c.class_id, grade: c.grade, room: c.room, class_label: c.class_label, subject_id: c.subject_id, subject_code: c.subject_code,
        subject_name: c.subject_name, subject_type: c.subject_type, type_label: c.type_label, teacher_id: c.teacher_id, teacher_name: c.teacher_name, mode: scale.mode,
        students: roster.length, items: its.length, entered_pct: its.length && roster.length ? Math.round(filled / (its.length * roster.length) * 1000) / 10 : 0,
        avg: n ? Math.round(sum / n * 100) / 100 : null, dist: dist, risk: risk, status: (gc && gc.status) || '' };
    });
    if (terms.indexOf(cur) < 0 && cur) terms.push(cur);
    terms.sort().reverse();
    return { term: term, current_term: cur, terms: terms, scope: scope, can_view_all: isViewer(u), courses: out, students: students, results: results,
      teachers: isViewer(u) ? d.teachers.filter(function (t) { return String(t.active) !== '0'; }).map(function (t) { return { teacher_id: t.teacher_id, name: teacherLabel(t) }; })
        .sort(function (a, b) { return a.name.localeCompare(b.name, 'th'); }) : [] };
  },
};
