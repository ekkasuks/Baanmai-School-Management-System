/**
 * วิชาการ › บันทึกคะแนน (Gradebook) — ต้องเข้าสู่ระบบด้วยบัญชีบุคลากร (tt-auth.js)
 * เฟส 1: วิชาของฉัน (จากการมอบหมายในตารางสอน TT_ASSIGN) + รายชื่อนักเรียนรายวิชา (อ่าน STUDENTS อย่างเดียว)
 *   gb       : ครู — เห็น/บันทึกเฉพาะวิชา×ชั้นที่ได้รับมอบหมาย
 *   gb_admin : ฝ่ายวิชาการ/ผู้ดูแล — ทุกวิชา · ดูในนามครูคนใดก็ได้
 *   gb_view  : ผู้บริหาร — ดูทุกวิชา (แก้ไม่ได้)
 * รายวิชา = วิชา × ชั้น × ภาคเรียน · course_id = term:class_id:subject_id
 * ไม่เขียนตารางเดิมใด ๆ · ดีไซน์ทั้งหมด: docs/superpowers/specs/2026-11-06-gradebook-design.md
 */
import { selectWhere, getBy, apiError } from '../db.js';
import { requireCap, can, teacherForTerm } from './tt-auth.js';
import { getSetting } from './settings.js';
import { studentName } from '../shared.js';

export const SUBJECT_TYPE = { core: 'พื้นฐาน', elective: 'เพิ่มเติม', practical: 'ปฏิบัติ', activity: 'กิจกรรม' };

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
  return { course: course, d: d, mine: mine };
}

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

  /** รายวิชา 1 รายการ + รายชื่อนักเรียน (อัตโนมัติจากชั้น/ห้อง) */
  gb_course: async function (params, ctx) {
    const u = await requireCap(ctx, null);
    const acc = await courseAccess(ctx.db, u, params.course_id);
    const c = acc.course, key = classKey(c.grade, c.room);
    const students = acc.d.students.filter(function (s) { return classKey(s.grade, s.room) === key; })
      .sort(function (a, b) { return String(a.student_code).localeCompare(String(b.student_code), undefined, { numeric: true }) || studentName(a).localeCompare(studentName(b), 'th'); })
      .map(function (s, i) { return { no: i + 1, citizen_id: s.citizen_id, student_code: s.student_code || '', name: studentName(s), gender: s.gender || '' }; });
    return { course: c, students: students, can_edit: acc.mine || can(u, 'gb_admin') };
  },
};
