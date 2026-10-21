/**
 * AI Smart Timetable — เฟส 1: ข้อมูลพื้นฐาน (ครู/วิชา/ห้อง/ชั้น/คาบ) + Dashboard
 * เขียนเฉพาะตาราง TT_* เท่านั้น · อ่าน STUDENTS/SETTINGS แบบอ่านอย่างเดียว (ห้ามกระทบข้อมูลเดิม)
 * action: tt.bootstrap · tt.list · tt.save · tt.remove · tt.dashboard · tt.sync_classes · tt.seed_periods
 * เฟส 2–3: tt.constraints_* · tt.save_version · tt.get_version · tt.update_slots (Auto Save) · tt.version_meta · tt.duplicate_version · tt.delete_version · tt.changes
 */
import {
  TABLES, readAll, getBy, selectWhere, insertRows, insertStmts, updateWhere, deleteWhere, upsert,
  now, genId, apiError,
} from '../db.js';
import { gradeSortKey } from '../shared.js';
import { getSetting } from './settings.js';

const DAYS = 5; // จันทร์–ศุกร์

/** บันทึกประวัติของโมดูลนี้ลง TT_CHANGE (ไม่ใช้ AUDIT_LOG เดิม — แยกข้อมูลขาดจากระบบเดิม) */
async function ttLog(db, term, action, entity, id, by, extra) {
  try {
    await insertRows(db, 'TT_CHANGE', [{
      change_id: genId('TTC'), term_id: term, version_id: (extra && extra.version_id) || '',
      message: String((extra && extra.message) || '').slice(0, 300),
      detail: Object.assign({ kind: 'data', action: action, entity: entity, id: id }, (extra && extra.detail) || {}),
      created_by: by || 'admin', created_at: now(),
    }]);
  } catch (e) { /* log ไม่ควรทำให้คำขอหลักล้ม */ }
}

/** นิยามข้อมูลแต่ละประเภท — CRUD ใช้ร่วมกัน */
const ENTITIES = {
  teacher: {
    table: 'TT_TEACHER', pk: 'teacher_id', prefix: 'TCH',
    json: { subjects: [], off_days: [], unavailable: [], prefs: {} },
    ints: ['min_periods', 'max_periods'], required: ['name'],
    search: ['code', 'title', 'name', 'dept', 'extra_duty'],
    labels: { name: 'ชื่อ-สกุล', min_periods: 'คาบขั้นต่ำ', max_periods: 'คาบสูงสุด' },
  },
  subject: {
    table: 'TT_SUBJECT', pk: 'subject_id', prefix: 'SUB',
    json: { grades: [], teachers: [], rules: {} },
    ints: ['periods_week'], required: ['name', 'periods_week'],
    search: ['code', 'name', 'type', 'room_type'],
    labels: { name: 'ชื่อวิชา', periods_week: 'จำนวนคาบ/สัปดาห์' },
  },
  room: {
    table: 'TT_ROOM', pk: 'room_id', prefix: 'RM',
    json: { allowed_subjects: [] },
    ints: ['capacity', 'max_concurrent'], required: ['name'],
    search: ['code', 'name', 'building', 'type'],
    labels: { name: 'ชื่อห้อง', capacity: 'ความจุ', max_concurrent: 'ผู้ใช้พร้อมกัน' },
  },
  class: {
    table: 'TT_CLASS', pk: 'class_id', prefix: 'CLS',
    json: {}, ints: ['students'], required: ['grade'],
    search: ['grade', 'room'],
    labels: { grade: 'ชั้นเรียน', students: 'จำนวนนักเรียน' },
  },
  period: {
    table: 'TT_PERIOD', pk: 'period_id', prefix: 'PER',
    json: {}, ints: ['seq'], required: ['label'],
    search: ['label', 'start_time', 'end_time', 'session'],
    labels: { label: 'ชื่อคาบ', seq: 'ลำดับ' },
  },
};

function entityOf(name) {
  const e = ENTITIES[name];
  if (!e) apiError('VALIDATION', 'ไม่รู้จักประเภทข้อมูล: ' + name);
  return e;
}
function hasCol(ent, col) { return TABLES[ent.table].cols.indexOf(col) >= 0; }

function parseJson(v, def) {
  if (v === null || v === undefined || v === '') return Array.isArray(def) ? [] : (def && typeof def === 'object' ? {} : def);
  if (typeof v === 'object') return v;
  try { return JSON.parse(v); } catch (e) { return Array.isArray(def) ? [] : {}; }
}

/** แถวจาก D1 → object พร้อมใช้ (แปลง JSON/ตัวเลข) */
function parseRow(ent, r) {
  const o = Object.assign({}, r);
  Object.keys(ent.json).forEach(function (f) { o[f] = parseJson(r[f], ent.json[f]); });
  ent.ints.forEach(function (f) { o[f] = (r[f] === null || r[f] === undefined || r[f] === '') ? null : Number(r[f]); });
  return o;
}

function sortItems(entName, items) {
  if (entName === 'period') return items.sort(function (a, b) { return (a.seq || 0) - (b.seq || 0); });
  if (entName === 'class') return items.sort(function (a, b) {
    const d = gradeSortKey(a.grade) - gradeSortKey(b.grade);
    return d !== 0 ? d : (parseInt(a.room, 10) || 0) - (parseInt(b.room, 10) || 0);
  });
  return items.sort(function (a, b) {
    return String(a.code || a.name || '').localeCompare(String(b.code || b.name || ''), 'th', { numeric: true });
  });
}

/** ภาคเรียนที่ใช้งาน = current_year-current_semester จาก SETTINGS (สร้างแถว TT_TERM ถ้ายังไม่มี) */
async function activeTerm(db, params) {
  if (params && params.term_id) return String(params.term_id);
  const year = String((await getSetting(db, 'current_year')) || '').trim();
  const sem = String((await getSetting(db, 'current_semester')) || '1').trim();
  const id = year + '-' + sem;
  if (!(await getBy(db, 'TT_TERM', 'term_id', id))) {
    await insertRows(db, 'TT_TERM', [{
      term_id: id, school_id: 'default', year: year, semester: sem,
      label: 'ปีการศึกษา ' + year + ' ภาคเรียนที่ ' + sem, is_active: '1', created_at: now(),
    }]);
  }
  return id;
}

async function listEntity(db, entName, term, opts) {
  const ent = entityOf(entName);
  let rows = await selectWhere(db, ent.table, 'term_id', term);
  if (hasCol(ent, 'active') && !(opts && opts.include_inactive)) rows = rows.filter(function (r) { return String(r.active) !== '0'; });
  const q = String((opts && opts.q) || '').trim().toLowerCase();
  if (q) rows = rows.filter(function (r) { return ent.search.some(function (f) { return String(r[f] || '').toLowerCase().indexOf(q) >= 0; }); });
  return sortItems(entName, rows.map(function (r) { return parseRow(ent, r); }));
}

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

/** ตรวจความถูกต้องเฉพาะแต่ละประเภท (ก่อนบันทึก) */
async function validate(db, entName, term, row, id) {
  const ent = entityOf(entName);
  const others = (await selectWhere(db, ent.table, 'term_id', term)).filter(function (r) {
    return String(r[ent.pk]) !== String(id || '') && String(r.active) !== '0';
  });
  if (row.code && others.some(function (r) { return String(r.code || '').trim() === String(row.code).trim(); })) {
    apiError('DUPLICATE', 'รหัส "' + row.code + '" ถูกใช้แล้ว');
  }
  if (entName === 'teacher' && row.min_periods != null && row.max_periods != null && row.min_periods !== '' && row.max_periods !== '' &&
      Number(row.min_periods) > Number(row.max_periods)) {
    apiError('VALIDATION', 'คาบขั้นต่ำต้องไม่มากกว่าคาบสูงสุด');
  }
  if (entName === 'subject' && !(Number(row.periods_week) > 0)) apiError('VALIDATION', 'จำนวนคาบ/สัปดาห์ต้องมากกว่า 0');
  if (entName === 'class') {
    const room = String(row.room || '').trim();
    if (others.some(function (r) { return String(r.grade) === String(row.grade) && String(r.room || '') === room; })) {
      apiError('DUPLICATE', 'มีชั้น ' + row.grade + (room ? '/' + room : '') + ' อยู่แล้ว');
    }
  }
  if (entName === 'period') {
    if (row.start_time && !HHMM.test(row.start_time)) apiError('VALIDATION', 'เวลาเริ่มต้องเป็นรูปแบบ HH:MM');
    if (row.end_time && !HHMM.test(row.end_time)) apiError('VALIDATION', 'เวลาสิ้นสุดต้องเป็นรูปแบบ HH:MM');
    if (row.start_time && row.end_time && row.start_time >= row.end_time) apiError('VALIDATION', 'เวลาเริ่มต้องก่อนเวลาสิ้นสุด');
  }
}

/** ภาพรวม Dashboard — ตัวเลข + ความพร้อมก่อนจัดตาราง + ข้อมูลกราฟ */
async function buildDashboard(db, term, data) {
  const teachers = data.teachers, subjects = data.subjects, rooms = data.rooms, classes = data.classes, periods = data.periods;
  const teaching = periods.filter(function (p) { return String(p.is_break) !== '1'; });
  const slotsPerClass = teaching.length * DAYS;

  const versions = (await selectWhere(db, 'TT_VERSION', 'term_id', term))
    .map(function (v) { return Object.assign({}, v, { stats: parseJson(v.stats, {}) }); })
    .sort(function (a, b) { return String(b.created_at).localeCompare(String(a.created_at)); });
  const latest = versions[0] || null;
  const slots = latest ? await selectWhere(db, 'TT_SLOT', 'version_id', latest.version_id) : [];

  const doneVersions = versions.filter(function (v) { return ['generated', 'edited', 'approved', 'published'].indexOf(v.status) >= 0; });
  const conflictVersions = versions.filter(function (v) { return Number(v.stats && v.stats.conflicts) > 0; });

  // ความพร้อม: คาบที่ต้องเรียน vs คาบที่มี, วิชาไม่มีครู, ครูไม่มีวิชา
  const issues = [];
  if (!teaching.length) issues.push({ level: 'error', msg: 'ยังไม่ได้กำหนดคาบเรียน (แท็บ "คาบเรียน")' });
  const teacherBySubject = {};
  teachers.forEach(function (t) { (t.subjects || []).forEach(function (sid) { (teacherBySubject[sid] = teacherBySubject[sid] || []).push(t.teacher_id); }); });
  subjects.forEach(function (s) {
    const n = (s.teachers || []).length + (teacherBySubject[s.subject_id] || []).length;
    if (!n) issues.push({ level: 'warning', msg: 'วิชา "' + s.name + '" ยังไม่มีครูผู้สอน' });
    if (!(s.grades || []).length) issues.push({ level: 'warning', msg: 'วิชา "' + s.name + '" ยังไม่ได้ระบุระดับชั้น' });
  });
  teachers.forEach(function (t) {
    if (!(t.subjects || []).length && !subjects.some(function (s) { return (s.teachers || []).indexOf(t.teacher_id) >= 0; })) {
      issues.push({ level: 'warning', msg: 'ครู "' + t.name + '" ยังไม่ได้ระบุวิชาที่สอนได้' });
    }
  });
  // หน่วยการเรียน: ห้องปกติ = 1 หน่วย · กลุ่มควบชั้น (เช่น ป.5+ป.6) = 1 หน่วย (เรียนรวมทุกวิชา)
  const units = teachingUnits(classes);
  let demand = 0;
  units.forEach(function (u) {
    const subs = unitSubjects(u, subjects);
    const need = subs.reduce(function (a, s) { return a + (Number(s.periods_week) || 0); }, 0);
    demand += need;
    if (teaching.length && need > slotsPerClass) {
      issues.push({ level: 'error', msg: 'ชั้น ' + u.label + ' ต้องเรียน ' + need + ' คาบ แต่มีช่องเพียง ' + slotsPerClass + ' คาบ/สัปดาห์' });
    }
    if (u.combined) {
      subs.forEach(function (s) {
        const missing = u.grades.filter(function (g) { return (s.grades || []).indexOf(g) < 0; });
        if (missing.length) issues.push({ level: 'info', msg: 'วิชา "' + s.name + '" ระบุเฉพาะบางชั้น — เมื่อเรียนควบ ' + u.label + ' นักเรียน ' + missing.join(', ') + ' จะเรียนวิชานี้ด้วย' });
      });
    }
  });

  // กราฟ — นับ "ครั้งที่สอน" แบบไม่ซ้ำเวลา (คาบควบชั้นมีหลายแถวแต่สอนครั้งเดียว)
  const unitOfClass = {};
  units.forEach(function (u) { u.class_ids.forEach(function (cid) { unitOfClass[cid] = u.unit_id; }); });
  const tSet = {}, rSet = {}, fill = {};
  slots.forEach(function (s) {
    const t = s.day + '|' + s.period_id;
    if (s.teacher_id) (tSet[s.teacher_id] = tSet[s.teacher_id] || {})[t] = 1;
    if (s.room_id) (rSet[s.room_id] = rSet[s.room_id] || {})[t] = 1;
    fill[(unitOfClass[s.class_id] || s.class_id) + '|' + t] = 1;
  });
  const cnt = function (o) { return o ? Object.keys(o).length : 0; };
  const teacherLoad = teachers.map(function (t) {
    return { id: t.teacher_id, name: (t.title || '') + t.name, assigned: cnt(tSet[t.teacher_id]), min: t.min_periods, max: t.max_periods };
  });
  const roomUsage = rooms.map(function (r) {
    const cap = slotsPerClass * (Number(r.max_concurrent) || 1);
    const used = cnt(rSet[r.room_id]);
    return { id: r.room_id, name: r.name, used: used, capacity: cap, percent: cap ? Math.round(used / cap * 1000) / 10 : 0 };
  });
  const totalSlots = units.length * slotsPerClass;
  const filled = Object.keys(fill).length;
  const taught = Object.keys(tSet).reduce(function (a, k) { return a + cnt(tSet[k]); }, 0);
  const maxLoad = teachers.reduce(function (a, t) { return a + (Number(t.max_periods) || 0); }, 0);

  return {
    term_id: term,
    counts: {
      teachers: teachers.length, subjects: subjects.length, rooms: rooms.length,
      grades: Object.keys(classes.reduce(function (m, c) { m[c.grade] = 1; return m; }, {})).length,
      classes: classes.length, units: units.length,
      combined_groups: units.filter(function (u) { return u.combined; }).length,
      periods_per_day: teaching.length, periods_per_week: slotsPerClass,
      demand_periods: demand, total_slots: totalSlots,
      done_versions: doneVersions.length, conflict_versions: conflictVersions.length,
    },
    latest: latest ? { version_id: latest.version_id, label: latest.label, status: latest.status, stats: latest.stats, created_at: latest.created_at } : null,
    utilization: {
      slots_filled: filled, slots_total: totalSlots,
      slot_percent: totalSlots ? Math.round(filled / totalSlots * 1000) / 10 : 0,
      demand_percent: totalSlots ? Math.round(demand / totalSlots * 1000) / 10 : 0,
      teacher_percent: maxLoad ? Math.round(taught / maxLoad * 1000) / 10 : 0,
    },
    units: units, teacher_load: teacherLoad, room_usage: roomUsage, issues: issues,
  };
}

/**
 * หน่วยการเรียน (ใช้ทั้ง Dashboard และ AI Engine เฟสถัดไป)
 * ห้องที่มี combine_group เดียวกัน (≥2 ห้อง) = 1 หน่วย เรียนรวมทุกวิชา
 */
export function teachingUnits(classes) {
  const groups = {}, units = [];
  classes.forEach(function (c) {
    const g = String(c.combine_group || '').trim();
    if (g) (groups[g] = groups[g] || []).push(c); else units.push({ unit_id: c.class_id, members: [c] });
  });
  Object.keys(groups).forEach(function (g) { units.push({ unit_id: g, members: groups[g] }); });
  return units.map(function (u) {
    const m = u.members.slice().sort(function (a, b) { return gradeSortKey(a.grade) - gradeSortKey(b.grade); });
    const grades = m.map(function (c) { return c.grade; }).filter(function (g, i, a) { return a.indexOf(g) === i; });
    return {
      unit_id: u.unit_id, combined: m.length > 1,
      class_ids: m.map(function (c) { return c.class_id; }), grades: grades,
      label: m.map(function (c) { return c.grade + (c.room ? '/' + c.room : ''); }).join(' + '),
      students: m.reduce(function (a, c) { return a + (Number(c.students) || 0); }, 0),
      sort: gradeSortKey(m[0] && m[0].grade),
    };
  }).sort(function (a, b) { return a.sort - b.sort; });
}

/** วิชาที่หน่วยการเรียนต้องเรียน = วิชาของทุกชั้นในหน่วยรวมกัน (ไม่นับวิชาเดียวกันซ้ำ) */
export function unitSubjects(unit, subjects) {
  return subjects.filter(function (s) { return (s.grades || []).some(function (g) { return unit.grades.indexOf(g) >= 0; }); });
}

/** กลุ่มควบชั้นที่เหลือสมาชิก <2 ห้อง → ยกเลิกกลุ่ม */
async function cleanupGroups(db, term) {
  const rows = (await selectWhere(db, 'TT_CLASS', 'term_id', term)).filter(function (c) { return String(c.active) !== '0'; });
  const count = {};
  rows.forEach(function (c) { const g = String(c.combine_group || ''); if (g) count[g] = (count[g] || 0) + 1; });
  for (const c of rows) {
    const g = String(c.combine_group || '');
    if (g && count[g] < 2) await updateWhere(db, 'TT_CLASS', 'class_id', c.class_id, { combine_group: '', updated_at: now() });
  }
}

async function loadAll(db, term) {
  return {
    teachers: await listEntity(db, 'teacher', term),
    subjects: await listEntity(db, 'subject', term),
    rooms: await listEntity(db, 'room', term),
    classes: await listEntity(db, 'class', term),
    periods: await listEntity(db, 'period', term),
  };
}

/* ── เฟส 2: เงื่อนไขรวม (โมดูล 3) — ค่าตั้งของ AI Engine ต่อภาคเรียน ── */
const DEFAULT_CONFIG = {
  teacher_max_consecutive: 4,    // ครูสอนติดกันได้สูงสุด (ใช้เมื่อครูไม่ได้ตั้งเอง)
  subject_max_per_day: 2,        // วิชาเดียวกันไม่เกินวันละ (ใช้เมื่อวิชาไม่ได้ตั้งเอง)
  spread_subjects: true,         // กระจายวิชาไม่ให้ซ้ำวันเดียวกัน
  prefer_core_morning: true,     // วิชาพื้นฐานช่วงเช้า
  prefer_activity_afternoon: true, // กิจกรรมช่วงบ่าย
  avoid_gaps: true,              // ไม่ให้มีคาบว่างแทรกระหว่างวัน
  fallback_homeroom: true,       // วิชาที่ไม่ระบุครู → ให้ครูประจำชั้นสอน
  time_limit_sec: 6,             // เวลาค้นหาของ AI Engine
};
const CONFIG_INT = { teacher_max_consecutive: [1, 10], subject_max_per_day: [1, 10], time_limit_sec: [1, 30] };

async function getConfig(db, term) {
  const row = await getBy(db, 'TT_CONSTRAINT', 'term_id', term);
  return Object.assign({}, DEFAULT_CONFIG, row ? parseJson(row.config, {}) : {});
}

const VERSION_STATUS = ['generated', 'edited', 'draft', 'approved', 'published'];

/** ตัวช่วยตรวจ slot ที่ส่งมาจากหน้าเว็บ (ใช้ทั้ง save_version และ update_slots) */
function slotChecker(data) {
  const ids = function (list, pk) { const m = {}; list.forEach(function (x) { m[x[pk]] = x; }); return m; };
  const C = ids(data.classes, 'class_id'), Sb = ids(data.subjects, 'subject_id'), T = ids(data.teachers, 'teacher_id'), R = ids(data.rooms, 'room_id');
  const teach = data.periods.filter(function (p) { return String(p.is_break) !== '1'; });
  const Pd = ids(teach, 'period_id');
  const unitOf = {};
  teachingUnits(data.classes).forEach(function (u) { u.class_ids.forEach(function (c) { unitOf[c] = u.unit_id; }); });
  return {
    R: R, unitOf: unitOf, maxSlots: data.classes.length * teach.length * DAYS,
    /** ตรวจ ref + แปลงวันเป็นตัวเลข → {class_id, day, period_id, subject_id, teacher_id, room_id, locked} */
    clean: function (s) {
      const day = Math.round(Number(s && s.day));
      if (!C[s.class_id]) apiError('VALIDATION', 'อ้างอิงชั้นเรียนไม่ถูกต้อง');
      if (!(day >= 1 && day <= DAYS)) apiError('VALIDATION', 'วันไม่ถูกต้อง');
      if (!Pd[s.period_id]) apiError('VALIDATION', 'อ้างอิงคาบเรียนไม่ถูกต้อง');
      if (s.subject_id && !Sb[s.subject_id]) apiError('VALIDATION', 'อ้างอิงวิชาไม่ถูกต้อง');
      if (s.teacher_id && !T[s.teacher_id]) apiError('VALIDATION', 'อ้างอิงครูไม่ถูกต้อง');
      if (s.room_id && !R[s.room_id]) apiError('VALIDATION', 'อ้างอิงห้องไม่ถูกต้อง');
      return { class_id: s.class_id, day: day, period_id: s.period_id, subject_id: s.subject_id || '',
        teacher_id: s.teacher_id || '', room_id: s.room_id || '', locked: (s.locked === true || String(s.locked) === '1') ? '1' : '' };
    },
  };
}

/** นับครู/ห้องชนข้ามหน่วยการเรียน (ครู/ห้องเดียวกันในกลุ่มควบชั้นเดียวกัน = สอนครั้งเดียว ไม่นับชน) */
function slotConflicts(slots, chk) {
  const tUse = {}, rUse = {};
  slots.forEach(function (s) {
    const t = s.day + '|' + s.period_id, u = chk.unitOf[s.class_id] || s.class_id;
    if (s.teacher_id) ((tUse[s.teacher_id + '|' + t] = tUse[s.teacher_id + '|' + t] || {})[u] = 1);
    if (s.room_id) ((rUse[s.room_id + '|' + t] = rUse[s.room_id + '|' + t] || {})[u] = 1);
  });
  const conflicts = [];
  Object.keys(tUse).forEach(function (k) {
    const n = Object.keys(tUse[k]).length;
    if (n > 1) conflicts.push({ type: 'teacher', key: k, units: n });
  });
  Object.keys(rUse).forEach(function (k) {
    const r = chk.R[k.split('|')[0]];
    if (Object.keys(rUse[k]).length > Math.max(1, Number(r && r.max_concurrent) || 1)) conflicts.push({ type: 'room', key: k, units: Object.keys(rUse[k]).length });
  });
  return conflicts;
}

async function versionOf(db, term, id) {
  const v = id ? await getBy(db, 'TT_VERSION', 'version_id', String(id)) : null;
  if (!v || String(v.term_id) !== term) apiError('NOT_FOUND', 'ไม่พบฉบับตาราง');
  return Object.assign({}, v, { stats: parseJson(v.stats, {}) });
}

async function listVersions(db, term) {
  return (await selectWhere(db, 'TT_VERSION', 'term_id', term))
    .map(function (v) { return Object.assign({}, v, { stats: parseJson(v.stats, {}) }); })
    .sort(function (a, b) { return String(b.created_at).localeCompare(String(a.created_at)); });
}

const DEFAULT_PERIODS = [
  ['คาบ 1', '08:30', '09:20', 'morning', '0'], ['คาบ 2', '09:20', '10:10', 'morning', '0'],
  ['คาบ 3', '10:10', '11:00', 'morning', '0'], ['คาบ 4', '11:00', '11:50', 'morning', '0'],
  ['พักกลางวัน', '11:50', '12:50', 'afternoon', '1'],
  ['คาบ 5', '12:50', '13:40', 'afternoon', '0'], ['คาบ 6', '13:40', '14:30', 'afternoon', '0'],
  ['คาบ 7', '14:30', '15:20', 'afternoon', '0'],
];

export const TimetableAPI = {

  /** โหลดทุกอย่างที่หน้าเว็บต้องใช้ในคำขอเดียว */
  bootstrap: async function (params, ctx) {
    const db = ctx.db;
    const term = await activeTerm(db, params);
    const data = await loadAll(db, term);
    const termRow = await getBy(db, 'TT_TERM', 'term_id', term);
    return Object.assign({
      term: termRow, dashboard: await buildDashboard(db, term, data),
      config: await getConfig(db, term), config_defaults: DEFAULT_CONFIG,
      versions: (await listVersions(db, term)).map(function (v) { delete v.stats.conflict_list; return v; }),
    }, data);
  },

  /* ════ เฟส 2: เงื่อนไข + ฉบับตาราง ════ */

  constraints_get: async function (params, ctx) {
    const term = await activeTerm(ctx.db, params);
    return { config: await getConfig(ctx.db, term), defaults: DEFAULT_CONFIG };
  },

  /** บันทึกเงื่อนไขรวม — params = { config:{...} } (รับเฉพาะคีย์ที่รู้จัก) */
  constraints_save: async function (params, ctx) {
    const db = ctx.db;
    const term = await activeTerm(db, params);
    const input = params.config || {};
    const cur = await getConfig(db, term);
    Object.keys(DEFAULT_CONFIG).forEach(function (k) {
      if (input[k] === undefined) return;
      if (CONFIG_INT[k]) {
        const n = Math.round(Number(input[k]));
        if (!isFinite(n) || n < CONFIG_INT[k][0] || n > CONFIG_INT[k][1]) apiError('VALIDATION', 'ค่า ' + k + ' ต้องอยู่ระหว่าง ' + CONFIG_INT[k][0] + '–' + CONFIG_INT[k][1]);
        cur[k] = n;
      } else {
        cur[k] = input[k] === true || input[k] === 'true' || input[k] === 1 || input[k] === '1';
      }
    });
    await upsert(db, 'TT_CONSTRAINT', { term_id: term, config: cur, updated_at: now() });
    await ttLog(db, term, 'UPDATE', 'constraint', term, params.recorded_by);
    return { config: cur };
  },

  versions: async function (params, ctx) {
    const term = await activeTerm(ctx.db, params);
    return { versions: await listVersions(ctx.db, term) };
  },

  /** ตารางของฉบับที่เลือก (ทุกห้อง) */
  get_version: async function (params, ctx) {
    const db = ctx.db;
    const term = await activeTerm(db, params);
    const v = await versionOf(db, term, params.version_id);
    const slots = (await selectWhere(db, 'TT_SLOT', 'version_id', v.version_id)).map(function (s) {
      return { class_id: s.class_id, day: Number(s.day), period_id: s.period_id, subject_id: s.subject_id || '', teacher_id: s.teacher_id || '', room_id: s.room_id || '', locked: String(s.locked || '') === '1' ? '1' : '' };
    });
    return { version: v, slots: slots };
  },

  /**
   * บันทึกผลจาก AI Engine เป็นฉบับใหม่ — params = { label?, slots:[{class_id,day,period_id,subject_id,teacher_id,room_id,locked?}], stats, status? }
   * ตรวจซ้ำฝั่ง server: ข้อมูลอ้างอิงถูกภาคเรียน, ห้องเรียนไม่ซ้ำช่อง, นับครู/ห้องชน (ยกเว้นกลุ่มควบชั้นเดียวกัน)
   */
  save_version: async function (params, ctx) {
    const db = ctx.db;
    const term = await activeTerm(db, params);
    const slots = params.slots;
    if (!Array.isArray(slots) || !slots.length) apiError('VALIDATION', 'ไม่มีข้อมูลตารางให้บันทึก');
    const chk = slotChecker(await loadAll(db, term));
    if (slots.length > chk.maxSlots) apiError('VALIDATION', 'จำนวนช่องตารางเกินกว่าที่เป็นไปได้');

    const seen = {};
    const rows = slots.map(function (s) {
      const c = chk.clean(s);
      const k = c.class_id + '|' + c.day + '|' + c.period_id;
      if (seen[k]) apiError('VALIDATION', 'มีชั้นเรียนซ้ำในช่องเวลาเดียวกัน');
      seen[k] = 1;
      return c;
    });
    const conflicts = slotConflicts(rows, chk);

    const vid = genId('VER');
    const n = (await selectWhere(db, 'TT_VERSION', 'term_id', term)).length + 1;
    const stats = Object.assign({}, params.stats || {}, { slots: rows.length, conflicts: conflicts.length, conflict_list: conflicts.slice(0, 30), rev: 0 });
    const status = VERSION_STATUS.indexOf(params.status) >= 0 ? params.status : 'generated';
    const ts = now();
    await insertRows(db, 'TT_VERSION', [{
      version_id: vid, term_id: term, label: String(params.label || ('ฉบับที่ ' + n + (status === 'generated' ? ' (AI)' : ''))).slice(0, 80),
      status: status, stats: stats, created_by: params.recorded_by || 'admin', created_at: ts,
    }]);
    const slotRows = rows.map(function (c) { return Object.assign({ slot_id: genId('SL'), term_id: term, version_id: vid, updated_at: ts }, c); });
    for (let i = 0; i < slotRows.length; i += 50) await insertRows(db, 'TT_SLOT', slotRows.slice(i, i + 50));
    await ttLog(db, term, 'GENERATE', 'version', vid, params.recorded_by, { version_id: vid });
    return { version_id: vid, label: 'ฉบับที่ ' + n, slots: slotRows.length, conflicts: conflicts.length };
  },

  /**
   * บันทึกการแก้ไขตาราง (Auto Save จาก Drag & Drop) — เขียนเฉพาะช่องที่เปลี่ยน
   * params = { version_id, rev, changes:[{class_id,day,period_id,subject_id,teacher_id,room_id,locked}], message? }
   *   subject_id ว่าง = ลบคาบออกจากช่องนั้น · rev ต้องตรงกับฉบับล่าสุด (กันแก้ทับกันจากหลายเครื่อง)
   */
  update_slots: async function (params, ctx) {
    const db = ctx.db;
    const term = await activeTerm(db, params);
    const v = await versionOf(db, term, params.version_id);
    const rev = Number(v.stats.rev) || 0;
    if (params.rev !== undefined && Number(params.rev) !== rev) {
      apiError('CONFLICT', 'ฉบับนี้ถูกแก้ไขจากเครื่องอื่นแล้ว — โหลดฉบับล่าสุดก่อนแก้ต่อ');
    }
    const changes = params.changes;
    if (!Array.isArray(changes) || !changes.length) apiError('VALIDATION', 'ไม่มีการเปลี่ยนแปลง');
    const chk = slotChecker(await loadAll(db, term));
    if (changes.length > chk.maxSlots) apiError('VALIDATION', 'จำนวนการเปลี่ยนแปลงเกินกว่าที่เป็นไปได้');

    const existing = await selectWhere(db, 'TT_SLOT', 'version_id', v.version_id);
    const byKey = {};
    existing.forEach(function (s) { byKey[s.class_id + '|' + Number(s.day) + '|' + s.period_id] = s; });
    const ts = now();
    const del = [], ins = [], touched = {};
    changes.forEach(function (raw) {
      const c = chk.clean(raw);
      const k = c.class_id + '|' + c.day + '|' + c.period_id;
      if (touched[k]) apiError('VALIDATION', 'มีการแก้ช่องเดียวกันซ้ำในคำขอเดียว');
      touched[k] = 1;
      if (byKey[k]) del.push(byKey[k].slot_id);
      if (c.subject_id) {
        const row = Object.assign({ slot_id: genId('SL'), term_id: term, version_id: v.version_id, updated_at: ts }, c);
        ins.push(row);
        byKey[k] = row;
      } else {
        delete byKey[k];
      }
    });

    const all = Object.keys(byKey).map(function (k) { const s = byKey[k]; return { class_id: s.class_id, day: Number(s.day), period_id: s.period_id, teacher_id: s.teacher_id, room_id: s.room_id }; });
    const conflicts = slotConflicts(all, chk);
    const stats = Object.assign({}, v.stats, {
      slots: all.length, conflicts: conflicts.length, conflict_list: conflicts.slice(0, 30), rev: rev + 1,
      edits: (Number(v.stats.edits) || 0) + changes.length, edited_at: ts, edited_by: params.recorded_by || 'admin',
    });
    if (params.stats && typeof params.stats === 'object') {
      ['errors', 'warnings', 'quality'].forEach(function (f) { if (params.stats[f] !== undefined) stats[f === 'quality' ? 'quality' : 'check_' + f] = Number(params.stats[f]) || 0; });
    }
    // ลบ + เพิ่ม + อัปเดตสถิติฉบับ ใน batch เดียว (atomic: สำเร็จทั้งหมดหรือไม่เปลี่ยนเลย)
    const stmts = del.map(function (id) { return db.prepare('DELETE FROM TT_SLOT WHERE slot_id=?').bind(id); })
      .concat(insertStmts(db, 'TT_SLOT', ins))
      .concat([db.prepare('UPDATE TT_VERSION SET stats=?, status=? WHERE version_id=?').bind(
        JSON.stringify(stats), v.status === 'generated' ? 'edited' : v.status, v.version_id)]);
    await db.batch(stmts);
    await ttLog(db, term, 'EDIT', 'version', v.version_id, params.recorded_by, {
      version_id: v.version_id, message: params.message || '', detail: { cells: changes.length },
    });
    return { rev: rev + 1, slots: all.length, conflicts: conflicts.length, status: v.status === 'generated' ? 'edited' : v.status };
  },

  /** เปลี่ยนชื่อ/สถานะฉบับ — params = { version_id, label?, status? } */
  version_meta: async function (params, ctx) {
    const db = ctx.db;
    const term = await activeTerm(db, params);
    const v = await versionOf(db, term, params.version_id);
    const fields = {};
    if (params.label !== undefined) {
      const label = String(params.label || '').trim().slice(0, 80);
      if (!label) apiError('VALIDATION', 'กรุณาระบุชื่อฉบับ');
      fields.label = label;
    }
    if (params.status !== undefined) {
      if (VERSION_STATUS.indexOf(params.status) < 0) apiError('VALIDATION', 'สถานะไม่ถูกต้อง');
      if (params.status === 'published' && Number(v.stats.conflicts) > 0) apiError('VALIDATION', 'ฉบับนี้ยังมีครู/ห้องชนกัน ' + v.stats.conflicts + ' จุด — แก้ก่อนเผยแพร่');
      fields.status = params.status;
    }
    if (!Object.keys(fields).length) apiError('VALIDATION', 'ไม่มีข้อมูลที่จะแก้');
    await updateWhere(db, 'TT_VERSION', 'version_id', v.version_id, fields);
    await ttLog(db, term, 'UPDATE', 'version', v.version_id, params.recorded_by, { version_id: v.version_id, detail: fields });
    return Object.assign({ version_id: v.version_id }, fields);
  },

  /** ทำสำเนาฉบับ (คัดลอกทุกช่องฝั่ง server) — params = { version_id, label? } */
  duplicate_version: async function (params, ctx) {
    const db = ctx.db;
    const term = await activeTerm(db, params);
    const v = await versionOf(db, term, params.version_id);
    const src = await selectWhere(db, 'TT_SLOT', 'version_id', v.version_id);
    const vid = genId('VER'), ts = now();
    const stats = Object.assign({}, v.stats, { rev: 0, edits: 0, copied_from: v.version_id });
    delete stats.edited_at; delete stats.edited_by;
    await insertRows(db, 'TT_VERSION', [{
      version_id: vid, term_id: term, label: String(params.label || ('สำเนา ' + v.label)).slice(0, 80),
      status: 'draft', stats: stats, created_by: params.recorded_by || 'admin', created_at: ts,
    }]);
    const rows = src.map(function (s) { return Object.assign({}, s, { slot_id: genId('SL'), version_id: vid, updated_at: ts }); });
    for (let i = 0; i < rows.length; i += 50) await insertRows(db, 'TT_SLOT', rows.slice(i, i + 50));
    await ttLog(db, term, 'COPY', 'version', vid, params.recorded_by, { version_id: vid, detail: { from: v.version_id } });
    return { version_id: vid, slots: rows.length };
  },

  /** ประวัติการเปลี่ยนแปลง (อ่านอย่างเดียว) — params = { version_id?, limit? } ใหม่สุดก่อน */
  changes: async function (params, ctx) {
    const db = ctx.db;
    const term = await activeTerm(db, params);
    const limit = Math.min(500, Math.max(1, Math.round(Number(params.limit) || 200)));
    let rows = await selectWhere(db, 'TT_CHANGE', 'term_id', term);
    if (params.version_id) rows = rows.filter(function (r) { return r.version_id === String(params.version_id); });
    rows.sort(function (a, b) { return String(b.created_at).localeCompare(String(a.created_at)); });
    return {
      total: rows.length,
      items: rows.slice(0, limit).map(function (r) {
        return { change_id: r.change_id, version_id: r.version_id || '', message: r.message || '', detail: parseJson(r.detail, {}), created_by: r.created_by, created_at: r.created_at };
      }),
    };
  },

  /** ลบฉบับตาราง (เฉพาะ TT_SLOT/TT_VERSION ของฉบับนั้น) */
  delete_version: async function (params, ctx) {
    const db = ctx.db;
    const term = await activeTerm(db, params);
    const v = await versionOf(db, term, params.version_id);
    await deleteWhere(db, 'TT_SLOT', 'version_id', v.version_id);
    await deleteWhere(db, 'TT_VERSION', 'version_id', v.version_id);
    await ttLog(db, term, 'DELETE', 'version', v.version_id, params.recorded_by);
    return { ok: true };
  },
  dashboard: async function (params, ctx) {
    const term = await activeTerm(ctx.db, params);
    return buildDashboard(ctx.db, term, await loadAll(ctx.db, term));
  },

  list: async function (params, ctx) {
    const term = await activeTerm(ctx.db, params);
    return { term_id: term, items: await listEntity(ctx.db, params.entity, term, params) };
  },

  /** เพิ่ม/แก้ไข 1 รายการ — params = { entity, record } (มี pk = แก้ไข) */
  save: async function (params, ctx) {
    const db = ctx.db;
    const entName = params.entity;
    const ent = entityOf(entName);
    const term = await activeTerm(db, params);
    const rec = params.record || {};
    const id = rec[ent.pk] ? String(rec[ent.pk]) : '';

    const row = {};
    TABLES[ent.table].cols.forEach(function (c) {
      if (c === ent.pk || c === 'term_id' || c === 'updated_at' || c === 'active' || c === 'combine_group') return;
      if (rec[c] !== undefined) row[c] = typeof rec[c] === 'string' ? rec[c].trim() : rec[c];
    });
    ent.required.forEach(function (f) {
      if (row[f] === undefined || row[f] === null || String(row[f]).trim() === '') apiError('VALIDATION', 'กรุณากรอก' + (ent.labels[f] || f));
    });
    ent.ints.forEach(function (f) {
      if (row[f] === undefined) return;
      if (row[f] === null || row[f] === '') { row[f] = null; return; }
      const n = Number(row[f]);
      if (!isFinite(n) || n < 0) apiError('VALIDATION', (ent.labels[f] || f) + ' ต้องเป็นตัวเลขไม่ติดลบ');
      row[f] = Math.round(n);
    });
    Object.keys(ent.json).forEach(function (f) {
      if (row[f] === undefined) return;
      if (typeof row[f] === 'string') { try { row[f] = JSON.parse(row[f] || 'null'); } catch (e) { apiError('VALIDATION', 'รูปแบบข้อมูล ' + f + ' ไม่ถูกต้อง'); } }
      if (row[f] === null) row[f] = Array.isArray(ent.json[f]) ? [] : {};
    });

    if (entName === 'period' && !id && (row.seq === undefined || row.seq === null)) {
      const ps = await selectWhere(db, 'TT_PERIOD', 'term_id', term);
      row.seq = ps.reduce(function (m, p) { return Math.max(m, Number(p.seq) || 0); }, 0) + 1;
    }
    await validate(db, entName, term, row, id);
    if (hasCol(ent, 'updated_at')) row.updated_at = now();

    let savedId = id;
    if (id) {
      const cur = await getBy(db, ent.table, ent.pk, id);
      if (!cur || String(cur.term_id) !== term) apiError('NOT_FOUND', 'ไม่พบข้อมูลที่จะแก้ไข');
      await updateWhere(db, ent.table, ent.pk, id, row);
    } else {
      savedId = genId(ent.prefix);
      row[ent.pk] = savedId;
      row.term_id = term;
      if (hasCol(ent, 'active')) row.active = '1';
      await insertRows(db, ent.table, [row]);
    }
    await ttLog(db, term, id ? 'UPDATE' : 'CREATE', entName, savedId, params.recorded_by);
    const saved = await getBy(db, ent.table, ent.pk, savedId);
    return { entity: entName, id: savedId, record: parseRow(ent, saved) };
  },

  /** ลบ — ครู/วิชา/ห้อง/ชั้น = ปิดใช้งาน (เก็บประวัติ) · คาบ = ลบจริงถ้ายังไม่ถูกใช้ในตาราง */
  remove: async function (params, ctx) {
    const db = ctx.db;
    const ent = entityOf(params.entity);
    const term = await activeTerm(db, params);
    const id = String(params.id || '');
    const cur = id ? await getBy(db, ent.table, ent.pk, id) : null;
    if (!cur || String(cur.term_id) !== term) apiError('NOT_FOUND', 'ไม่พบข้อมูล');
    if (hasCol(ent, 'active')) {
      const patch = { active: '0', updated_at: now() };
      if (params.entity === 'class') patch.combine_group = '';   // ออกจากกลุ่มควบชั้นด้วย
      await updateWhere(db, ent.table, ent.pk, id, patch);
      if (params.entity === 'class') await cleanupGroups(db, term);
    } else {
      if ((await selectWhere(db, 'TT_SLOT', 'period_id', id)).length) apiError('VALIDATION', 'คาบนี้ถูกใช้ในตารางแล้ว ลบไม่ได้');
      await deleteWhere(db, ent.table, ent.pk, id);
    }
    await ttLog(db, term, 'DELETE', params.entity, id, params.recorded_by);
    return { ok: true };
  },

  /**
   * จัดกลุ่มเรียนควบชั้น — params = { class_ids:[≥2], group_id? }
   * ห้องที่เลือกจะเรียนรวมกันทุกวิชา · ถ้าห้องเคยอยู่กลุ่มอื่นจะย้ายมากลุ่มนี้ · กลุ่มที่เหลือ 1 ห้องจะถูกยกเลิก
   */
  combine: async function (params, ctx) {
    const db = ctx.db;
    const term = await activeTerm(db, params);
    const ids = (params.class_ids || []).map(String).filter(function (v, i, a) { return v && a.indexOf(v) === i; });
    if (ids.length < 2) apiError('VALIDATION', 'เลือกห้องที่จะเรียนควบอย่างน้อย 2 ห้อง');
    const all = (await selectWhere(db, 'TT_CLASS', 'term_id', term)).filter(function (c) { return String(c.active) !== '0'; });
    const sel = ids.map(function (id) { return all.find(function (c) { return c.class_id === id; }); });
    if (sel.some(function (c) { return !c; })) apiError('NOT_FOUND', 'ไม่พบห้องเรียนบางห้อง');

    const gid = String(params.group_id || '') ||
      (sel.map(function (c) { return String(c.combine_group || ''); }).filter(Boolean)[0]) || genId('GRP');
    const ts = now();
    for (const c of all) {
      if (String(c.combine_group || '') === gid && ids.indexOf(c.class_id) < 0) {
        await updateWhere(db, 'TT_CLASS', 'class_id', c.class_id, { combine_group: '', updated_at: ts });
      }
    }
    for (const c of sel) await updateWhere(db, 'TT_CLASS', 'class_id', c.class_id, { combine_group: gid, updated_at: ts });
    await cleanupGroups(db, term);
    await ttLog(db, term, 'COMBINE', 'class', gid, params.recorded_by);
    return {
      group_id: gid, class_ids: ids,
      label: sel.slice().sort(function (a, b) { return gradeSortKey(a.grade) - gradeSortKey(b.grade); })
        .map(function (c) { return c.grade + (c.room ? '/' + c.room : ''); }).join(' + '),
    };
  },

  /** เอาห้องออกจากกลุ่มควบชั้น — params = { class_id } */
  uncombine: async function (params, ctx) {
    const db = ctx.db;
    const term = await activeTerm(db, params);
    const cur = params.class_id ? await getBy(db, 'TT_CLASS', 'class_id', String(params.class_id)) : null;
    if (!cur || String(cur.term_id) !== term) apiError('NOT_FOUND', 'ไม่พบห้องเรียน');
    if (!cur.combine_group) return { ok: true, changed: false };
    await updateWhere(db, 'TT_CLASS', 'class_id', cur.class_id, { combine_group: '', updated_at: now() });
    await cleanupGroups(db, term);
    await ttLog(db, term, 'UNCOMBINE', 'class', cur.class_id, params.recorded_by);
    return { ok: true, changed: true };
  },

  /** สร้างคาบเรียนมาตรฐาน 7 คาบ + พักกลางวัน (เฉพาะเมื่อยังไม่มีคาบ) */
  seed_periods: async function (params, ctx) {
    const db = ctx.db;
    const term = await activeTerm(db, params);
    if ((await selectWhere(db, 'TT_PERIOD', 'term_id', term)).length) return { created: 0, message: 'มีคาบเรียนอยู่แล้ว' };
    const rows = DEFAULT_PERIODS.map(function (p, i) {
      return { period_id: genId('PER'), term_id: term, seq: i + 1, label: p[0], start_time: p[1], end_time: p[2], session: p[3], is_break: p[4] };
    });
    await insertRows(db, 'TT_PERIOD', rows);
    return { created: rows.length };
  },

  /** ดึงชั้น/ห้อง + จำนวนนักเรียนจากข้อมูลนักเรียน (อ่าน STUDENTS อย่างเดียว ไม่แก้) */
  sync_classes: async function (params, ctx) {
    const db = ctx.db;
    const term = await activeTerm(db, params);
    const groups = {};
    (await readAll(db, 'STUDENTS')).forEach(function (s) {
      if (s.status === 'inactive' || !s.grade) return;
      const room = (s.room === undefined || s.room === null) ? '' : String(s.room);
      const k = s.grade + '|' + room;
      if (!groups[k]) groups[k] = { grade: s.grade, room: room, students: 0 };
      groups[k].students++;
    });
    const existing = (await selectWhere(db, 'TT_CLASS', 'term_id', term)).filter(function (c) { return String(c.active) !== '0'; });
    const inserts = [];
    let updated = 0;
    for (const k of Object.keys(groups)) {
      const g = groups[k];
      const cur = existing.find(function (c) { return String(c.grade) === g.grade && String(c.room || '') === g.room; });
      if (cur) {
        if (Number(cur.students) !== g.students) { await updateWhere(db, 'TT_CLASS', 'class_id', cur.class_id, { students: g.students, updated_at: now() }); updated++; }
      } else {
        inserts.push({ class_id: genId('CLS'), term_id: term, grade: g.grade, room: g.room, students: g.students, active: '1', updated_at: now() });
      }
    }
    if (inserts.length) await insertRows(db, 'TT_CLASS', inserts);
    return { created: inserts.length, updated: updated };
  },
};
