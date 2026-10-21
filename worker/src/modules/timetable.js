/**
 * AI Smart Timetable — เฟส 1: ข้อมูลพื้นฐาน (ครู/วิชา/ห้อง/ชั้น/คาบ) + Dashboard
 * เขียนเฉพาะตาราง TT_* เท่านั้น · อ่าน STUDENTS/SETTINGS แบบอ่านอย่างเดียว (ห้ามกระทบข้อมูลเดิม)
 * action: tt.bootstrap · tt.list · tt.save · tt.remove · tt.dashboard · tt.sync_classes · tt.seed_periods
 * เฟส 2–3: tt.constraints_* · tt.save_version · tt.get_version · tt.update_slots (Auto Save) · tt.version_meta · tt.duplicate_version · tt.delete_version · tt.changes
 * เฟส 5: tt.import_entities · tt.ticker (หน้าหลัก) · tt.announce · tt.ticker_hide
 * เฟส 6: tt.public_view + ผู้ใช้/สิทธิ์ (tt-auth.js) — ทุก action ผ่าน guard() ตรวจสิทธิ์ตามตาราง NEED
 */
import {
  TABLES, readAll, getBy, selectWhere, insertRows, insertStmts, updateWhere, deleteWhere, upsert,
  now, genId, apiError,
} from '../db.js';
import { gradeSortKey } from '../shared.js';
import { getSetting } from './settings.js';
import { AuthActions, ROLES, currentUser, requireCap, can } from './tt-auth.js';

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
  checkRow(entName, row, others);
}

/** record จากหน้าเว็บ → แถวที่พร้อมบันทึก (เฉพาะคอลัมน์ที่แก้ได้ · trim · แปลงตัวเลข/JSON) */
function normalizeRecord(ent, rec) {
  const row = {};
  TABLES[ent.table].cols.forEach(function (c) {
    if (c === ent.pk || c === 'term_id' || c === 'updated_at' || c === 'active' || c === 'combine_group') return;
    if (rec[c] !== undefined) row[c] = typeof rec[c] === 'string' ? rec[c].trim() : rec[c];
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
  return row;
}
function requireFields(ent, row) {
  ent.required.forEach(function (f) {
    if (row[f] === undefined || row[f] === null || String(row[f]).trim() === '') apiError('VALIDATION', 'กรุณากรอก' + (ent.labels[f] || f));
  });
}

/** ตรวจ 1 แถวเทียบกับรายการอื่น (ไม่แตะ DB — ใช้ซ้ำตอนนำเข้าทีละหลายแถว) */
function checkRow(entName, row, others) {
  if (row.code && others.some(function (r) { return String(r.code || '').trim() === String(row.code).trim(); })) {
    apiError('DUPLICATE', 'รหัส "' + row.code + '" ถูกใช้แล้ว');
  }
  if (entName === 'teacher' && row.min_periods != null && row.max_periods != null && row.min_periods !== '' && row.max_periods !== '' &&
      Number(row.min_periods) > Number(row.max_periods)) {
    apiError('VALIDATION', 'คาบขั้นต่ำต้องไม่มากกว่าคาบสูงสุด');
  }
  if (entName === 'subject' && !(Number(row.periods_week) > 0)) apiError('VALIDATION', 'จำนวนคาบ/สัปดาห์ต้องมากกว่า 0');
  if (entName === 'subject') {
    const rules = typeof row.rules === 'string' ? parseJson(row.rules, {}) : (row.rules || {});
    const fx = rules.fixed_slots || [];
    if (!Array.isArray(fx) || fx.some(function (x) { return !x || !(Number(x.day) >= 1 && Number(x.day) <= DAYS) || !x.period_id; })) apiError('VALIDATION', 'คาบที่ล็อกไว้ไม่ถูกต้อง');
    if (fx.length > Number(row.periods_week)) apiError('VALIDATION', 'วิชา "' + row.name + '" ล็อกไว้ ' + fx.length + ' คาบ เกินจำนวนคาบ/สัปดาห์ (' + row.periods_week + ')');
  }
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
  const assigned = {};
  (data.assignments || []).forEach(function (a) { assigned[a.subject_id] = 1; });
  subjects.forEach(function (s) {
    const n = (s.teachers || []).length + (teacherBySubject[s.subject_id] || []).length + (assigned[s.subject_id] ? 1 : 0);
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
    assignments: (await selectWhere(db, 'TT_ASSIGN', 'term_id', term)).map(function (a) {
      return { class_id: a.class_id, subject_id: a.subject_id, teacher_id: a.teacher_id };
    }),
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
  ticker_enabled: true,          // ข้อความวิ่งที่หน้าหลัก (เฟส 5)
  ticker_days: 7,                // แสดงการเปลี่ยนแปลงย้อนหลังกี่วัน
  public_view: true,             // เฟส 6: ดูตารางที่เผยแพร่แล้วได้โดยไม่ต้องเข้าสู่ระบบ
};
const CONFIG_INT = { teacher_max_consecutive: [1, 10], subject_max_per_day: [1, 10], time_limit_sec: [1, 30], ticker_days: [1, 60] };
const IMPORT_MAX = 500;

/** เวลาไทยย้อนหลัง n วัน ในรูปแบบเดียวกับ now() — ใช้เทียบ created_at แบบ string */
function bkkDaysAgo(n) { return new Date(Date.now() + 7 * 3600 * 1000 - n * 86400000).toISOString().slice(0, 19); }

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
    R: R, Sb: Sb, unitOf: unitOf, maxSlots: data.classes.length * teach.length * DAYS,
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

/** วิชานี้ล็อกไว้ที่ (วัน, คาบ) นี้ และให้ครูดูแลหลายชั้นพร้อมกันได้ (กิจกรรมรวมทั้งโรงเรียน) */
function sharedLocked(subject, day, pid) {
  const r = (subject && subject.rules) || {};
  return r.shared !== false && (r.fixed_slots || []).some(function (x) { return Number(x.day) === Number(day) && x.period_id === pid; });
}

/** นับครู/ห้องชนข้ามหน่วยการเรียน (ครู/ห้องเดียวกันในกลุ่มควบชั้นเดียวกัน = สอนครั้งเดียว ไม่นับชน · กิจกรรมล็อกที่ดูแลร่วม = ไม่นับชน) */
function slotConflicts(slots, chk) {
  const tUse = {}, rUse = {}, tShared = {};
  slots.forEach(function (s) {
    const t = s.day + '|' + s.period_id, u = chk.unitOf[s.class_id] || s.class_id;
    if (s.teacher_id) {
      const k = s.teacher_id + '|' + t;
      (tUse[k] = tUse[k] || {})[u] = 1;
      tShared[k] = (tShared[k] !== false) && sharedLocked(chk.Sb && chk.Sb[s.subject_id], s.day, s.period_id);
    }
    if (s.room_id) ((rUse[s.room_id + '|' + t] = rUse[s.room_id + '|' + t] || {})[u] = 1);
  });
  const conflicts = [];
  Object.keys(tUse).forEach(function (k) {
    const n = Object.keys(tUse[k]).length;
    if (n > 1 && !tShared[k]) conflicts.push({ type: 'teacher', key: k, units: n });
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

const API = {

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

    const all = Object.keys(byKey).map(function (k) { const s = byKey[k]; return { class_id: s.class_id, day: Number(s.day), period_id: s.period_id, subject_id: s.subject_id, teacher_id: s.teacher_id, room_id: s.room_id }; });
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
    // เผยแพร่ได้ทีละฉบับ: ฉบับที่เคยเผยแพร่อยู่ → กลับเป็น "อนุมัติแล้ว"
    if (fields.status === 'published') {
      await db.prepare("UPDATE TT_VERSION SET status='approved' WHERE term_id=? AND status='published' AND version_id<>?").bind(term, v.version_id).run();
    }
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

  /* ════ เฟส 5: นำเข้า + ข้อความวิ่ง ════ */

  /**
   * นำเข้าข้อมูลพื้นฐานหลายแถว — params = { entity, rows:[record (+pk = อัปเดตแถวเดิม), __row?] }
   * ตรวจทุกแถวในหน่วยความจำก่อน (รหัสซ้ำ/ชั้นซ้ำ/เวลา ฯลฯ ทั้งกับข้อมูลเดิมและภายในไฟล์) → ผิดแม้แถวเดียว = ไม่บันทึกเลย
   * บันทึกทั้งหมดใน db.batch เดียว (atomic) · เพิ่ม/อัปเดตเท่านั้น ไม่ลบข้อมูลเดิม
   */
  import_entities: async function (params, ctx) {
    const db = ctx.db;
    const entName = params.entity;
    const ent = entityOf(entName);
    const term = await activeTerm(db, params);
    const rows = params.rows;
    if (!Array.isArray(rows) || !rows.length) apiError('VALIDATION', 'ไม่มีข้อมูลให้นำเข้า');
    if (rows.length > IMPORT_MAX) apiError('VALIDATION', 'นำเข้าได้ครั้งละไม่เกิน ' + IMPORT_MAX + ' แถว');

    const existing = await selectWhere(db, ent.table, 'term_id', term);
    const byId = {}, pool = {};
    existing.forEach(function (r) { byId[r[ent.pk]] = r; if (String(r.active) !== '0') pool[r[ent.pk]] = r; });
    let maxSeq = existing.reduce(function (m, p) { return Math.max(m, Number(p.seq) || 0); }, 0);
    const ts = now(), errors = [], out = [];
    rows.forEach(function (rec, i) {
      try {
        const id = rec[ent.pk] ? String(rec[ent.pk]) : '';
        const row = normalizeRecord(ent, rec);
        let full;
        if (id) {
          if (!byId[id]) apiError('NOT_FOUND', 'ไม่พบข้อมูลเดิมที่จะอัปเดต');
          full = Object.assign({}, byId[id], row);        // ช่องที่ไม่ได้ส่งมา = คงค่าเดิม
          if (hasCol(ent, 'active')) full.active = '1';
        } else {
          full = Object.assign({}, row);
          full[ent.pk] = genId(ent.prefix);
          full.term_id = term;
          if (hasCol(ent, 'active')) full.active = '1';
        }
        if (entName === 'period' && (full.seq === undefined || full.seq === null || full.seq === '')) full.seq = ++maxSeq;
        requireFields(ent, full);
        checkRow(entName, full, Object.keys(pool).filter(function (k) { return k !== String(full[ent.pk]); }).map(function (k) { return pool[k]; }));
        if (hasCol(ent, 'updated_at')) full.updated_at = ts;
        pool[full[ent.pk]] = full;
        out.push({ row: full, isNew: !id });
      } catch (e) {
        errors.push('แถว ' + (rec.__row || i + 1) + ': ' + e.message);
      }
    });
    if (errors.length) apiError('VALIDATION', 'ข้อมูลไม่ถูกต้อง ' + errors.length + ' แถว (ยังไม่ได้บันทึก) — ' + errors.slice(0, 5).join(' · ') + (errors.length > 5 ? ' …' : ''));

    await db.batch(insertStmts(db, ent.table, out.map(function (x) { return x.row; }), true));
    const created = out.filter(function (x) { return x.isNew; }).length;
    await ttLog(db, term, 'IMPORT', entName, '', params.recorded_by, { detail: { created: created, updated: out.length - created } });
    return { entity: entName, created: created, updated: out.length - created };
  },

  /**
   * ข้อความวิ่ง (หน้าหลัก) — ประกาศจากผู้ดูแล + การประกาศใช้/แก้ไขตารางฉบับที่เผยแพร่ (ย้อนหลัง ticker_days วัน)
   * params.all = true → รวมรายการที่ซ่อน/หมดอายุ (สำหรับหน้าจัดการ)
   */
  ticker: async function (params, ctx) {
    const db = ctx.db;
    const term = await activeTerm(db, params);
    const cfg = await getConfig(db, term);
    const all = params.all === true;
    if (!cfg.ticker_enabled && !all) return { enabled: false, days: cfg.ticker_days, items: [] };
    const V = {};
    (await selectWhere(db, 'TT_VERSION', 'term_id', term)).forEach(function (v) { V[v.version_id] = v; });
    const rows = (await selectWhere(db, 'TT_CHANGE', 'term_id', term)).map(function (r) { return Object.assign({}, r, { det: parseJson(r.detail, {}) }); });
    const publishedAt = {};
    rows.forEach(function (r) {
      if (r.det.action === 'UPDATE' && r.det.entity === 'version' && r.det.status === 'published' && String(r.created_at) > (publishedAt[r.version_id] || '')) publishedAt[r.version_id] = String(r.created_at);
    });
    const nowS = now(), since = bkkDaysAgo(cfg.ticker_days);
    const items = [];
    rows.forEach(function (r) {
      const det = r.det, v = V[r.version_id];
      let kind, text, expired = false;
      if (det.kind === 'announce') {
        kind = 'announce'; text = r.message;
        expired = !!(det.expires_at && det.expires_at < nowS);
      } else if (det.action === 'UPDATE' && det.entity === 'version' && det.status === 'published' && v && v.status === 'published' && String(r.created_at) === publishedAt[r.version_id]) {
        kind = 'publish'; text = 'ประกาศใช้ตารางสอน "' + v.label + '"';
      } else if (det.action === 'EDIT' && r.message && v && v.status === 'published' && publishedAt[r.version_id] && String(r.created_at) > publishedAt[r.version_id]) {
        kind = 'edit'; text = 'ปรับตารางสอน: ' + r.message;
      } else return;
      if (kind !== 'announce' && String(r.created_at) < since) expired = true;
      if (!all && (expired || det.hidden)) return;
      items.push({ id: r.change_id, kind: kind, text: text, at: r.created_at, hidden: !!det.hidden, expired: expired, expires_at: det.expires_at || '' });
    });
    items.sort(function (a, b) { return String(b.at).localeCompare(String(a.at)); });
    return { enabled: !!cfg.ticker_enabled, days: cfg.ticker_days, items: items.slice(0, all ? 100 : 20) };
  },

  /** เพิ่มประกาศข้อความวิ่ง — params = { message, days (1–60) } */
  announce: async function (params, ctx) {
    const db = ctx.db;
    const term = await activeTerm(db, params);
    const msg = String(params.message || '').trim();
    if (!msg) apiError('VALIDATION', 'กรุณาพิมพ์ข้อความประกาศ');
    if (msg.length > 200) apiError('VALIDATION', 'ข้อความยาวเกิน 200 ตัวอักษร');
    const days = Math.round(Number(params.days) || 7);
    if (days < 1 || days > 60) apiError('VALIDATION', 'จำนวนวันต้องอยู่ระหว่าง 1–60');
    const expires = new Date(Date.now() + 7 * 3600 * 1000 + days * 86400000).toISOString().slice(0, 19);
    await ttLog(db, term, 'ANNOUNCE', 'ticker', '', params.recorded_by, { message: msg, detail: { kind: 'announce', expires_at: expires } });
    return { ok: true, expires_at: expires };
  },

  /** ซ่อน/แสดงข้อความวิ่ง 1 รายการ — params = { change_id, hidden } */
  ticker_hide: async function (params, ctx) {
    const db = ctx.db;
    const term = await activeTerm(db, params);
    const r = params.change_id ? await getBy(db, 'TT_CHANGE', 'change_id', String(params.change_id)) : null;
    if (!r || String(r.term_id) !== term) apiError('NOT_FOUND', 'ไม่พบข้อความ');
    const det = parseJson(r.detail, {});
    det.hidden = params.hidden !== false;
    await updateWhere(db, 'TT_CHANGE', 'change_id', r.change_id, { detail: det });
    return { id: r.change_id, hidden: det.hidden };
  },

  /**
   * มอบหมายการสอน: วิชา × ชั้นเรียน → ครู — params = { rows:[{ class_id, subject_id, teacher_id ('' = ยกเลิก) }] }
   * ตรวจทุกแถว (ชั้น/วิชา/ครูมีจริง · วิชาเรียนในระดับชั้นนั้น) แล้วบันทึกใน db.batch เดียว
   */
  assign_save: async function (params, ctx) {
    const db = ctx.db;
    const term = await activeTerm(db, params);
    const rows = params.rows;
    if (!Array.isArray(rows) || !rows.length) apiError('VALIDATION', 'ไม่มีข้อมูลการมอบหมาย');
    if (rows.length > 3000) apiError('VALIDATION', 'ข้อมูลมากเกินไป');
    const data = await loadAll(db, term);
    const ids = function (list, pk) { const m = {}; list.forEach(function (x) { m[x[pk]] = x; }); return m; };
    const C = ids(data.classes, 'class_id'), Sb = ids(data.subjects, 'subject_id'), T = ids(data.teachers, 'teacher_id');
    const ts = now(), seen = {}, stmts = [];
    let set = 0, cleared = 0;
    rows.forEach(function (r, i) {
      const c = C[r.class_id], sb = Sb[r.subject_id], tid = r.teacher_id ? String(r.teacher_id) : '';
      if (!c) apiError('VALIDATION', 'แถว ' + (i + 1) + ': ไม่พบชั้นเรียน');
      if (!sb) apiError('VALIDATION', 'แถว ' + (i + 1) + ': ไม่พบวิชา');
      if ((sb.grades || []).indexOf(c.grade) < 0) apiError('VALIDATION', 'วิชา "' + sb.name + '" ไม่ได้เรียนในชั้น ' + c.grade);
      if (tid && !T[tid]) apiError('VALIDATION', 'แถว ' + (i + 1) + ': ไม่พบครู');
      const k = c.class_id + '|' + sb.subject_id;
      if (seen[k]) apiError('VALIDATION', 'มอบหมายวิชา "' + sb.name + '" ชั้น ' + c.grade + ' ซ้ำ');
      seen[k] = 1;
      stmts.push(db.prepare('DELETE FROM TT_ASSIGN WHERE term_id=? AND class_id=? AND subject_id=?').bind(term, c.class_id, sb.subject_id));
      if (tid) { stmts.push.apply(stmts, insertStmts(db, 'TT_ASSIGN', [{ assign_id: genId('ASG'), term_id: term, class_id: c.class_id, subject_id: sb.subject_id, teacher_id: tid, updated_at: ts }])); set++; }
      else cleared++;
    });
    await db.batch(stmts);
    await ttLog(db, term, 'ASSIGN', 'assign', '', params.recorded_by, { detail: { set: set, cleared: cleared } });
    return { set: set, cleared: cleared };
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
    const row = normalizeRecord(ent, rec);
    requireFields(ent, row);

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

  /**
   * ตารางที่เผยแพร่แล้ว สำหรับหน้า "ดูตารางเรียน/ตารางสอน" (นักเรียน · ผู้ปกครอง · ครู)
   * เปิดให้ดูโดยไม่ต้องเข้าสู่ระบบ (ปิดได้ด้วย config.public_view = false) · ส่งเฉพาะข้อมูลที่อยู่บนตารางจริง (ชื่อครู/วิชา/ห้อง)
   */
  public_view: async function (params, ctx) {
    const db = ctx.db;
    const term = await activeTerm(db, params);
    const cfg = await getConfig(db, term);
    const u = await currentUser(ctx);
    if (cfg.public_view === false && !u) apiError('AUTH_REQUIRED', 'ต้องเข้าสู่ระบบเพื่อดูตาราง');
    const termRow = await getBy(db, 'TT_TERM', 'term_id', term);
    const published = (await listVersions(db, term)).filter(function (v) { return v.status === 'published'; });
    const v = published[0] || null;
    const data = await loadAll(db, term);
    const slots = v ? (await selectWhere(db, 'TT_SLOT', 'version_id', v.version_id)).map(function (s) {
      return { class_id: s.class_id, day: Number(s.day), period_id: s.period_id, subject_id: s.subject_id || '', teacher_id: s.teacher_id || '', room_id: s.room_id || '' };
    }) : [];
    return {
      school: (await getSetting(db, 'school_name')) || '', term: termRow ? termRow.label : term,
      version: v ? { version_id: v.version_id, label: v.label, updated_at: v.stats.edited_at || v.created_at } : null,
      units: teachingUnits(data.classes).map(function (x) { return { unit_id: x.unit_id, label: x.label, class_ids: x.class_ids, combined: x.combined }; }),
      classes: data.classes.map(function (c) { return { class_id: c.class_id, grade: c.grade, room: c.room || '' }; }),
      teachers: data.teachers.map(function (t) { return { teacher_id: t.teacher_id, title: t.title || '', name: t.name }; }),
      subjects: data.subjects.map(function (s) { return { subject_id: s.subject_id, name: s.name, type: s.type || 'core' }; }),
      rooms: data.rooms.map(function (r) { return { room_id: r.room_id, name: r.name }; }),
      periods: data.periods.map(function (p) { return { period_id: p.period_id, seq: p.seq, label: p.label, start_time: p.start_time, end_time: p.end_time, is_break: p.is_break }; }),
      slots: slots, me: u ? { role: u.role, teacher_id: u.teacher_id || '', class_id: u.class_id || '', display_name: u.display_name || u.username } : null,
    };
  },
};

/* ════ เฟส 6: ตรวจสิทธิ์ทุก action (ค่าเริ่มต้น = ปฏิเสธ) ════
   ค่า = ความสามารถที่ต้องมี · ฟังก์ชัน = คำนวณจาก params (คืน array ของเงื่อนไข; เงื่อนไขเป็น array = มีอย่างใดอย่างหนึ่ง) */
const OPEN = ['auth_status', 'setup_admin', 'login', 'logout', 'me', 'change_password', 'users_list', 'user_save', 'user_reset_password', 'public_view'];
const NEED = {
  bootstrap: 'view', dashboard: 'view', list: 'view', versions: 'view', get_version: 'view', changes: 'view', constraints_get: 'view',
  save: 'edit_data', remove: 'edit_data', assign_save: 'edit_data', combine: 'edit_data', uncombine: 'edit_data', seed_periods: 'edit_data', sync_classes: 'edit_data', import_entities: 'edit_data',
  save_version: 'edit_timetable', update_slots: 'edit_timetable', duplicate_version: 'edit_timetable', delete_version: 'edit_timetable',
  announce: 'announce', ticker_hide: 'announce',
  ticker: function (p) { return p.all === true ? ['announce'] : null; },          // null = สาธารณะ (หน้าหลัก)
  version_meta: function (p) {
    const need = [];
    if (p.label !== undefined) need.push('edit_timetable');
    if (p.status === 'approved' || p.status === 'published') need.push('approve');
    else if (p.status !== undefined) need.push(['approve', 'edit_timetable']);
    return need.length ? need : ['edit_timetable'];
  },
  constraints_save: function (p) {
    const need = {};
    Object.keys((p && p.config) || {}).forEach(function (k) {
      need[/^ticker_/.test(k) ? 'announce' : k === 'public_view' ? 'manage_users' : 'edit_data'] = 1;
    });
    const list = Object.keys(need);
    return list.length ? list : ['edit_data'];
  },
};

function guard(api) {
  const out = {};
  Object.keys(api).forEach(function (name) {
    const fn = api[name];
    out[name] = async function (params, ctx) {
      params = params || {};
      if (OPEN.indexOf(name) >= 0) return fn(params, ctx);
      const rule = NEED[name];
      if (rule === undefined) apiError('FORBIDDEN', 'ไม่อนุญาต: tt.' + name);
      const need = typeof rule === 'function' ? rule(params) : [rule];
      if (need === null) return fn(params, ctx);
      const u = await requireCap(ctx, null);
      need.forEach(function (n) {
        const alts = Array.isArray(n) ? n : [n];
        if (!alts.some(function (c) { return can(u, c); })) apiError('FORBIDDEN', 'บัญชี "' + (ROLES[u.role] ? ROLES[u.role].label : u.role) + '" ไม่มีสิทธิ์ทำรายการนี้');
      });
      params.recorded_by = u.username;   // ประวัติใช้ชื่อผู้ใช้จริง ไม่เชื่อค่าจากหน้าเว็บ
      return fn(params, ctx);
    };
  });
  return out;
}

export const TimetableAPI = guard(Object.assign({}, API, AuthActions));
