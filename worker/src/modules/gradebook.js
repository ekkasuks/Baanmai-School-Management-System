/**
 * วิชาการ › บันทึกคะแนน (Gradebook) — ต้องเข้าสู่ระบบด้วยบัญชีบุคลากร (tt-auth.js)
 * เฟส 1: วิชาของฉัน (จากการมอบหมายในตารางสอน TT_ASSIGN) + รายชื่อนักเรียนรายวิชา (อ่าน STUDENTS อย่างเดียว)
 * เฟส 2: GB_COURSE (น้ำหนัก 4 ช่วง) · GB_ROSTER (ถ่ายรายชื่อ ณ ภาคนั้น) · GB_ITEM (งาน) · GB_SCORE (คะแนน) — schema-gradebook.sql
 *   gb       : ครู — เห็น/บันทึกเฉพาะวิชา×ชั้นที่ได้รับมอบหมาย
 *   gb_admin : ฝ่ายวิชาการ/ผู้ดูแล — ทุกวิชา · ดูในนามครูคนใดก็ได้
 *   gb_view  : ผู้บริหาร — ดูทุกวิชา (แก้ไม่ได้)
 * รายวิชา = วิชา × ชั้น × ภาคเรียน · course_id = term:class_id:subject_id
 * เขียนเฉพาะ GB_* (ไม่เขียนตารางเดิม · ไม่ลงบันทึก AUDIT_LOG) · ดีไซน์ทั้งหมด: docs/superpowers/specs/2026-11-06-gradebook-design.md
 */
import { selectWhere, getBy, apiError, now, genId } from '../db.js';
import { requireCap, can, teacherForTerm } from './tt-auth.js';
import { getSetting } from './settings.js';
import { studentName } from '../shared.js';

export const SUBJECT_TYPE = { core: 'พื้นฐาน', elective: 'เพิ่มเติม', practical: 'ปฏิบัติ', activity: 'กิจกรรม' };
export const PERIODS = ['ก่อนกลางภาค', 'กลางภาค', 'หลังกลางภาค', 'ปลายภาค'];
const DEFAULT_WEIGHTS = [30, 20, 20, 30];
const MAX_CELLS = 200;   // คะแนนต่อคำขอ (D1 plan ฟรี ~50 คำสั่ง/คำขอ · 14 แถว/คำสั่ง)

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
  return acc;
}
function requireEdit(cx) {
  if (cx.locked) apiError('LOCKED', 'รายวิชานี้ส่งผลแล้ว — ต้องให้ฝ่ายวิชาการปลดล็อกก่อนแก้ไข');
  if (!cx.canEdit) apiError('FORBIDDEN', cx.isCurrent ? 'คุณดูรายวิชานี้ได้อย่างเดียว' : 'ภาคเรียนที่ผ่านมาแล้ว แก้ไขได้เฉพาะฝ่ายวิชาการ');
}

/** สร้าง/อัปเดตแถว GB_COURSE (ภาพถ่ายชื่อวิชา/ชั้น/ครูล่าสุด) — 1 คำสั่ง (คืน statement ไว้รวม batch) */
function courseUpsertStmt(db, cx, by, weights) {
  const c = cx.course, t = now();
  return db.prepare('INSERT INTO GB_COURSE (course_id, term, class_id, subject_id, teacher_id, subject_code, subject_name, class_label, teacher_name, weights, grade_scale, status, created_by, created_at, updated_by, updated_at) ' +
    "VALUES (?,?,?,?,?,?,?,?,?,?,'','',?,?,?,?) ON CONFLICT(course_id) DO UPDATE SET teacher_id=excluded.teacher_id, subject_code=excluded.subject_code, " +
    'subject_name=excluded.subject_name, class_label=excluded.class_label, teacher_name=excluded.teacher_name' +
    (weights ? ', weights=excluded.weights, updated_by=excluded.updated_by, updated_at=excluded.updated_at' : ''))
    .bind(c.course_id, c.term, c.class_id, c.subject_id, c.teacher_id, c.subject_code, c.subject_name, c.class_label, c.teacher_name,
      (weights || cx.weights).join(','), by, t, by, t);
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
  return { item_id: r.item_id, period: Number(r.period), title: r.title || '', max_score: Number(r.max_score) || 0, item_date: r.item_date || '', note: r.note || '', active: Number(r.active) !== 0 };
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
    courses.forEach(function (c) { c.items = ic[c.course_id] || 0; });
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
    const [itemRows, scoreRows, stuRows] = await Promise.all([
      selectWhere(db, 'GB_ITEM', 'course_id', cid), selectWhere(db, 'GB_SCORE', 'course_id', cid),
      // นักเรียนที่ออกจากชั้นแล้วอาจไม่ active — อ่านชื่อจาก STUDENTS ทุกสถานะเฉพาะคนในรายชื่อ
      roster.some(function (r) { return r.left; }) ? db.prepare("SELECT s.* FROM STUDENTS s JOIN GB_ROSTER r ON r.citizen_id = s.citizen_id WHERE r.course_id = ? AND r.left_class = 1").bind(cid).all().then(function (x) { return x.results || []; }) : Promise.resolve([]),
    ]);
    const S = {}; cx.d.students.concat(stuRows).forEach(function (s) { S[s.citizen_id] = s; });
    const items = itemRows.map(itemOut).sort(function (a, b) { return a.period - b.period || String(a.item_date || '9').localeCompare(String(b.item_date || '9')) || 0; });
    const activeIds = {}; items.forEach(function (i) { if (i.active) activeIds[i.item_id] = true; });
    const scores = {}, hasScore = {};
    scoreRows.forEach(function (r) {
      if (r.score == null || r.score === '') return;
      (scores[r.citizen_id] = scores[r.citizen_id] || {})[r.item_id] = Number(r.score);
      if (activeIds[r.item_id]) hasScore[r.citizen_id] = true;
    });
    // คนที่ออกจากชั้นแสดงเฉพาะที่มีคะแนนค้าง (ไว้ดู) — ไม่มีคะแนนก็ซ่อน
    let no = 0;
    const students = roster.filter(function (r) { return !r.left || hasScore[r.citizen_id]; }).map(function (r) {
      const s = S[r.citizen_id] || {};
      return { no: r.left ? null : ++no, citizen_id: r.citizen_id, student_code: s.student_code || '', name: s.citizen_id ? studentName(s) : '(ไม่พบข้อมูลนักเรียน)', gender: s.gender || '', left: r.left };
    });
    return {
      course: cx.course, periods: PERIODS.map(function (l, i) { return { no: i + 1, label: l, weight: cx.weights[i] }; }),
      students: students, items: items.filter(function (i) { return i.active; }), removed_items: items.filter(function (i) { return !i.active; }),
      scores: scores, can_edit: cx.canEdit, locked: cx.locked, is_current: cx.isCurrent,
    };
  },

  /** ตั้งน้ำหนัก 4 ช่วง (รวม 100) · ช่วงที่ยังมีงานอยู่ตั้งเป็น 0 ไม่ได้ */
  gb_course_save: async function (params, ctx) {
    const u = await requireCap(ctx, null), db = ctx.db;
    const cx = await courseCtx(db, u, params.course_id); requireEdit(cx);
    const w = Array.isArray(params.weights) ? params.weights.map(Number) : [];
    if (w.length !== 4 || w.some(function (n) { return !isFinite(n) || n < 0 || n > 100 || Math.round(n) !== n; })) apiError('VALIDATION', 'น้ำหนักแต่ละช่วงต้องเป็นจำนวนเต็ม 0–100');
    const sum = w.reduce(function (a, b) { return a + b; }, 0);
    if (sum !== 100) apiError('VALIDATION', 'น้ำหนักรวมต้องเท่ากับ 100 (ตอนนี้ ' + sum + ')');
    const items = (await selectWhere(db, 'GB_ITEM', 'course_id', cx.course.course_id)).filter(function (r) { return Number(r.active) !== 0; });
    const bad = PERIODS.filter(function (l, i) { return w[i] === 0 && items.some(function (r) { return Number(r.period) === i + 1; }); });
    if (bad.length) apiError('VALIDATION', 'ช่วง "' + bad.join('", "') + '" ยังมีงานอยู่ — ย้ายหรือลบงานก่อนตั้งน้ำหนักเป็น 0');
    await courseUpsertStmt(db, cx, u.user_id, w).run();
    return { weights: w };
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
    if (!(period >= 1 && period <= 4 && Math.round(period) === period)) apiError('VALIDATION', 'เลือกช่วงคะแนน');
    if (cx.weights[period - 1] === 0) apiError('VALIDATION', 'ช่วง "' + PERIODS[period - 1] + '" มีน้ำหนัก 0 — ตั้งน้ำหนักในตั้งค่าวิชาก่อน');
    if (!title) apiError('VALIDATION', 'กรอกชื่องาน');
    if (title.length > 80) apiError('VALIDATION', 'ชื่องานยาวเกิน 80 ตัวอักษร');
    if (!(max > 0 && max <= 1000)) apiError('VALIDATION', 'คะแนนเต็มต้องมากกว่า 0 และไม่เกิน 1000');
    if (date === null) apiError('VALIDATION', 'วันที่ไม่ถูกต้อง');
    const t = now();
    if (old) {
      const over = await db.prepare('SELECT COUNT(*) AS n FROM GB_SCORE WHERE item_id = ? AND score > ?').bind(old.item_id, max).first();
      if (over && Number(over.n) > 0) apiError('VALIDATION', 'มีนักเรียน ' + over.n + ' คนได้คะแนนเกิน ' + max + ' — แก้คะแนนก่อนลดคะแนนเต็ม');
      await db.batch([courseUpsertStmt(db, cx, u.user_id),
        db.prepare('UPDATE GB_ITEM SET period = ?, title = ?, max_score = ?, item_date = ?, note = ?, active = ?, updated_by = ?, updated_at = ? WHERE item_id = ?')
          .bind(period, title, max, date, note, params.active === true ? 1 : Number(old.active), u.user_id, t, old.item_id)]);
      return { item: itemOut(Object.assign({}, old, { period: period, title: title, max_score: max, item_date: date, note: note, active: params.active === true ? 1 : old.active })) };
    }
    const n = await db.prepare('SELECT COUNT(*) AS n FROM GB_ITEM WHERE course_id = ? AND active = 1').bind(cid).first();
    if (n && Number(n.n) >= 60) apiError('VALIDATION', 'รายวิชานี้มีงานครบ 60 รายการแล้ว');
    const row = { item_id: genId('GBI'), course_id: cid, period: period, title: title, max_score: max, item_date: date, note: note, active: 1 };
    await db.batch([courseUpsertStmt(db, cx, u.user_id),
      db.prepare("INSERT INTO GB_ITEM (item_id, course_id, period, title, max_score, item_date, late_pct, note, active, created_by, created_at, updated_by, updated_at) VALUES (?,?,?,?,?,?,NULL,?,1,?,?,?,?)")
        .bind(row.item_id, cid, period, title, max, date, note, u.user_id, t, u.user_id, t)]);
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
   * บันทึกคะแนน · params { course_id, scores:[{ item_id, citizen_id, score }] } (score null/'' = ล้าง) · ไม่เกิน 200 ช่อง/คำขอ
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
      let v = x.score;
      if (v === '' || v === undefined) v = null;
      if (v !== null) {
        v = Number(v);
        if (!isFinite(v) || v < 0) apiError('VALIDATION', 'คะแนนต้องเป็นตัวเลขตั้งแต่ 0 ขึ้นไป');
        v = num(v);
        if (v > Number(it.max_score)) apiError('VALIDATION', 'คะแนนเกินคะแนนเต็ม (' + it.title + ' เต็ม ' + Number(it.max_score) + ')');
      }
      const k = it.item_id + ':' + c;
      if (!seen[k]) rows.push({ k: k, item_id: it.item_id, cid: c, v: v });
      else rows[seen[k] - 1].v = v;
      seen[k] = seen[k] || rows.length;
    });
    const t = now(), stmts = [];
    for (let i = 0; i < rows.length; i += 14) {
      const part = rows.slice(i, i + 14), binds = [];
      part.forEach(function (r) { binds.push(r.k, r.item_id, cid, r.cid, r.v, u.user_id, t); });
      const st = db.prepare('INSERT INTO GB_SCORE (score_id, item_id, course_id, citizen_id, score, recorded_by, updated_at) VALUES ' +
        part.map(function () { return '(?,?,?,?,?,?,?)'; }).join(',') +
        ' ON CONFLICT(score_id) DO UPDATE SET score = excluded.score, recorded_by = excluded.recorded_by, updated_at = excluded.updated_at');
      stmts.push(st.bind.apply(st, binds));
    }
    await db.batch([courseUpsertStmt(db, cx, u.user_id)].concat(stmts));
    return { saved: rows.length, updated_at: t };
  },
};
