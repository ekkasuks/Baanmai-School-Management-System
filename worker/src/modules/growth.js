/** Growth — น้ำหนัก/ส่วนสูง/BMI + z-score WHO (ไม่ใช้ PIN) · กันซ้ำ (date, citizen_id) */
import {
  readAll, insertRows, updateWhere, buildIndex,
  now, today, toYmd, genId, audit, apiError,
} from '../db.js';
import { studentName, listClasses, studentsInClass } from '../shared.js';
import { WHO_BMI_LMS } from '../who-data.js';

export const GrowthAPI = {

  classes: async function (params, ctx) { return { classes: await listClasses(ctx.db) }; },

  by_class: async function (params, ctx) {
    if (!params.grade) apiError('VALIDATION', 'กรุณาเลือกชั้นเรียน');
    const date = params.date ? toYmd(params.date) : '';
    const byCid = {};
    (await readAll(ctx.db, 'GROWTH')).forEach(function (g) {
      const cid = String(g.citizen_id);
      if (!byCid[cid]) byCid[cid] = [];
      byCid[cid].push(g);
    });
    const results = (await studentsInClass(ctx.db, params.grade, params.room)).map(function (s) {
      const recs = (byCid[String(s.citizen_id)] || []).slice().sort(function (a, b) { return toYmd(a.date).localeCompare(toYmd(b.date)); });
      const latest = recs.length ? recs[recs.length - 1] : null;
      const onDate = date ? recs.filter(function (r) { return toYmd(r.date) === date; }).pop() : null;
      let latestOut = null;
      if (latest) {
        const bmi = Number(latest.bmi) || 0;
        const ev = growthEval(bmi, s, toYmd(latest.date));
        latestOut = { date: toYmd(latest.date), weight: Number(latest.weight) || 0, height: Number(latest.height) || 0, bmi: bmi, zscore: ev.z, bmi_label: ev.label };
      }
      return {
        citizen_id: s.citizen_id, student_code: s.student_code, name: studentName(s),
        grade: s.grade, room: s.room, gender: s.gender, birth_date: s.birth_date,
        latest: latestOut,
        on_date: onDate ? { weight: Number(onDate.weight) || 0, height: Number(onDate.height) || 0 } : null,
      };
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
    const stIndex = buildIndex(await readAll(db, 'STUDENTS'), 'citizen_id');

    const keyToId = {};
    (await readAll(db, 'GROWTH')).forEach(function (g) { keyToId[toYmd(g.date) + '|' + String(g.citizen_id)] = g.growth_id; });

    const inserts = [];
    const seen = {};
    let updated = 0, skipped = 0;
    for (const r of records) {
      const weight = Number(r.weight), height = Number(r.height);
      if (!r.citizen_id || !(weight > 0) || !(height > 0)) { skipped++; continue; }
      const key = date + '|' + String(r.citizen_id);
      if (seen[key]) continue;
      seen[key] = true;
      const bmi = computeBmi(weight, height);
      const student = stIndex[String(r.citizen_id)];
      let z = null, label = '';
      if (student) { const ageM = ageMonthsAt(student.birth_date, date); z = whoZ(bmi, sexCode(student.gender), ageM); label = whoLabel(z, ageM); }
      const rec = {
        date: date, citizen_id: r.citizen_id,
        weight: Math.round(weight * 10) / 10, height: Math.round(height * 10) / 10,
        bmi: bmi, zscore: (z == null ? '' : z), bmi_label: label,
        note: r.note || '', recorded_by: by, created_at: ts,
      };
      const existId = keyToId[key];
      if (existId) { await updateWhere(db, 'GROWTH', 'growth_id', existId, rec); updated++; }
      else { rec.growth_id = genId('GRW'); inserts.push(rec); }
    }
    if (inserts.length) await insertRows(db, 'GROWTH', inserts);
    await audit(db, 'growth', 'SAVE', date, { date: date, inserted: inserts.length, updated: updated, skipped: skipped }, by);
    return { date: date, inserted: inserts.length, updated: updated, skipped: skipped };
  },

  student: async function (params, ctx) {
    const db = ctx.db;
    if (!params.citizen_id) apiError('VALIDATION', 'กรุณาระบุนักเรียน');
    const cid = String(params.citizen_id);
    const s = await (async function () { const i = buildIndex(await readAll(db, 'STUDENTS'), 'citizen_id'); return i[cid]; })();
    if (!s) apiError('NOT_FOUND', 'ไม่พบนักเรียน');
    const records = (await readAll(db, 'GROWTH'))
      .filter(function (g) { return String(g.citizen_id) === cid; })
      .map(function (g) {
        const bmi = Number(g.bmi) || 0;
        const ev = growthEval(bmi, s, toYmd(g.date));
        return { growth_id: g.growth_id, date: toYmd(g.date), weight: Number(g.weight) || 0, height: Number(g.height) || 0, bmi: bmi, zscore: ev.z, bmi_label: ev.label, note: g.note, recorded_by: g.recorded_by };
      })
      .sort(function (a, b) { return a.date.localeCompare(b.date); });
    return { student: { citizen_id: s.citizen_id, student_code: s.student_code, name: studentName(s), grade: s.grade, room: s.room }, records: records };
  },

  search: async function (params, ctx) {
    const q = String(params.q || '').trim().toLowerCase();
    if (!q) return { results: [] };
    const rows = await readAll(ctx.db, 'STUDENTS');
    const results = [];
    for (let i = 0; i < rows.length && results.length < 20; i++) {
      const s = rows[i];
      if (s.status === 'inactive') continue;
      const hay = (studentName(s) + ' ' + s.student_code + ' ' + s.citizen_id).toLowerCase();
      if (hay.indexOf(q) < 0) continue;
      results.push({ citizen_id: s.citizen_id, student_code: s.student_code, name: studentName(s), grade: s.grade, room: s.room });
    }
    return { results: results };
  },

  dashboard: async function (params, ctx) {
    const db = ctx.db;
    const students = (await readAll(db, 'STUDENTS')).filter(function (s) { return s.status !== 'inactive'; });
    const latest = {};
    (await readAll(db, 'GROWTH')).forEach(function (g) {
      const cid = String(g.citizen_id), d = toYmd(g.date);
      if (!latest[cid] || d > latest[cid].date) latest[cid] = { date: d, bmi: Number(g.bmi) || 0 };
    });
    const dist = { 'ผอมมาก': 0, 'ผอม': 0, 'สมส่วน': 0, 'น้ำหนักเกิน': 0, 'อ้วน': 0 };
    const gradeMap = {};
    let bmiSum = 0, measured = 0;
    students.forEach(function (s) {
      const g = latest[String(s.citizen_id)];
      const grade = s.grade || '-';
      if (!gradeMap[grade]) gradeMap[grade] = { grade: grade, bmi_sum: 0, measured: 0, total: 0 };
      gradeMap[grade].total++;
      if (g && g.bmi > 0) {
        measured++; bmiSum += g.bmi;
        gradeMap[grade].measured++; gradeMap[grade].bmi_sum += g.bmi;
        const label = growthEval(g.bmi, s, g.date).label;
        if (dist[label] !== undefined) dist[label]++;
      }
    });
    const byGrade = Object.keys(gradeMap).map(function (k) {
      const o = gradeMap[k];
      return { grade: o.grade, avg_bmi: o.measured ? Math.round((o.bmi_sum / o.measured) * 10) / 10 : 0, measured: o.measured, total: o.total };
    });
    return {
      student_count: students.length, measured: measured, not_measured: Math.max(students.length - measured, 0),
      avg_bmi: measured ? Math.round((bmiSum / measured) * 10) / 10 : 0, distribution: dist, by_grade: byGrade,
    };
  },
};

/* ── helpers (WHO BMI-for-age z-score) ── */
function computeBmi(weight, height) {
  const w = Number(weight), h = Number(height) / 100;
  if (!(w > 0) || !(h > 0)) return 0;
  return Math.round((w / (h * h)) * 10) / 10;
}

function ageMonthsAt(birthDate, atYmd) {
  if (!birthDate) return null;
  let by, bm, bd;
  const s = String(birthDate);
  let m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (m) { bd = +m[1]; bm = +m[2]; by = +m[3]; }
  else {
    m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
    if (m) { by = +m[1]; bm = +m[2]; bd = +m[3]; }
    else { const d = new Date(s); if (isNaN(d.getTime())) return null; by = d.getFullYear(); bm = d.getMonth() + 1; bd = d.getDate(); }
  }
  if (by >= 2400) by -= 543;
  const p = String(toYmd(atYmd)).split('-');
  const ay = +p[0], am = +p[1], ad = +p[2];
  if (!by || !ay) return null;
  let months = (ay - by) * 12 + (am - bm);
  if (ad < bd) months -= 1;
  return months >= 0 ? months : null;
}

function growthEval(bmi, student, atYmd) {
  if (!(bmi > 0) || !student) return { z: null, label: '' };
  const ageM = ageMonthsAt(student.birth_date, atYmd);
  const z = whoZ(bmi, sexCode(student.gender), ageM);
  return { z: z, label: whoLabel(z, ageM) };
}

function sexCode(gender) { return gender === 'ช' ? '1' : gender === 'ญ' ? '2' : null; }

function whoZ(bmi, sex, ageM) {
  if (!(bmi > 0) || !sex || ageM == null) return null;
  const table = WHO_BMI_LMS[sex];
  if (!table) return null;
  let mo = ageM;
  if (mo < 24) mo = 24;
  if (mo > 228) mo = 228;
  const lms = table[String(mo)];
  if (!lms) return null;
  const L = lms[0], M = lms[1], S = lms[2];
  const z = (Math.abs(L) < 1e-9) ? Math.log(bmi / M) / S : (Math.pow(bmi / M, L) - 1) / (L * S);
  return Math.round(z * 100) / 100;
}

function whoLabel(z, ageM) {
  if (z == null) return '';
  if (z < -3) return 'ผอมมาก';
  if (z < -2) return 'ผอม';
  if (ageM != null && ageM < 60) {
    if (z <= 2) return 'สมส่วน';
    if (z <= 3) return 'น้ำหนักเกิน';
    return 'อ้วน';
  }
  if (z <= 1) return 'สมส่วน';
  if (z <= 2) return 'น้ำหนักเกิน';
  return 'อ้วน';
}
