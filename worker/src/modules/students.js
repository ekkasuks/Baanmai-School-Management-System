/** Students — CRUD + โปรไฟล์รวมข้ามโมดูล + สถิติ + Import DMC */
import {
  readAll, getBy, selectWhere, insertRows, updateWhere, buildIndex,
  now, yearMonth, toYmd, toYm, audit, apiError,
} from '../db.js';
import { studentName, mapDmcStudent, behaviorStart } from '../shared.js';
import { getSetting } from './settings.js';

const EDITABLE = ['student_code', 'prefix', 'first_name', 'last_name', 'gender',
  'grade', 'room', 'birth_date', 'blood_type', 'religion', 'nationality',
  'guardian_relation', 'guardian_name', 'guardian_phone', 'address',
  'weight_init', 'height_init'];

export const StudentsAPI = {

  list: async function (params, ctx) {
    let rows = await readAll(ctx.db, 'STUDENTS');
    if (params.grade) rows = rows.filter(function (r) { return r.grade === params.grade; });
    if (params.room) rows = rows.filter(function (r) { return String(r.room) === String(params.room); });
    if (params.search) {
      const q = String(params.search).toLowerCase();
      rows = rows.filter(function (r) {
        return String(r.first_name).toLowerCase().indexOf(q) >= 0 ||
               String(r.last_name).toLowerCase().indexOf(q) >= 0 ||
               String(r.student_code).indexOf(q) >= 0 ||
               String(r.citizen_id).indexOf(q) >= 0;
      });
    }
    return { students: rows, total: rows.length };
  },

  get: async function (params, ctx) {
    if (!params.citizen_id) apiError('VALIDATION', 'ไม่ได้ระบุ citizen_id');
    const found = await getBy(ctx.db, 'STUDENTS', 'citizen_id', String(params.citizen_id));
    if (!found) apiError('NOT_FOUND', 'ไม่พบนักเรียน');
    return { student: found };
  },

  update: async function (params, ctx) {
    if (!params.citizen_id) apiError('VALIDATION', 'ไม่ได้ระบุ citizen_id');
    const cur = await getBy(ctx.db, 'STUDENTS', 'citizen_id', String(params.citizen_id));
    if (!cur) apiError('NOT_FOUND', 'ไม่พบนักเรียน');
    const fields = params.fields || {};
    const update = { updated_at: now() };
    Object.keys(fields).forEach(function (k) { if (EDITABLE.indexOf(k) >= 0) update[k] = fields[k]; });
    await updateWhere(ctx.db, 'STUDENTS', 'citizen_id', String(params.citizen_id), update);
    await audit(ctx.db, 'students', 'UPDATE', params.citizen_id, { fields: Object.keys(fields) }, params.recorded_by);
    return { ok: true };
  },

  create: async function (params, ctx) {
    const fields = params.fields || {};
    const cid = String(fields.citizen_id || '').trim();
    if (!/^\d{13}$/.test(cid)) apiError('VALIDATION', 'เลขบัตรประชาชนต้องเป็นตัวเลข 13 หลัก');
    if (!String(fields.first_name || '').trim()) apiError('VALIDATION', 'กรุณากรอกชื่อ');
    if (!String(fields.grade || '').trim()) apiError('VALIDATION', 'กรุณาเลือกชั้นเรียน');
    if (await getBy(ctx.db, 'STUDENTS', 'citizen_id', cid)) apiError('VALIDATION', 'มีเลขบัตรประชาชนนี้ในระบบแล้ว');

    const row = { citizen_id: cid, status: 'active', created_at: now(), updated_at: now() };
    EDITABLE.forEach(function (k) { row[k] = fields[k] !== undefined ? fields[k] : ''; });
    await insertRows(ctx.db, 'STUDENTS', [row]);
    await audit(ctx.db, 'students', 'CREATE', cid, { fields: Object.keys(fields) }, params.recorded_by);
    return { student: row };
  },

  remove: async function (params, ctx) {
    if (!params.citizen_id) apiError('VALIDATION', 'ไม่ได้ระบุ citizen_id');
    if (!(await getBy(ctx.db, 'STUDENTS', 'citizen_id', String(params.citizen_id)))) apiError('NOT_FOUND', 'ไม่พบนักเรียน');
    await updateWhere(ctx.db, 'STUDENTS', 'citizen_id', String(params.citizen_id), { status: 'inactive', updated_at: now() });
    await audit(ctx.db, 'students', 'DELETE', params.citizen_id, {}, params.recorded_by);
    return { ok: true };
  },

  restore: async function (params, ctx) {
    if (!params.citizen_id) apiError('VALIDATION', 'ไม่ได้ระบุ citizen_id');
    if (!(await getBy(ctx.db, 'STUDENTS', 'citizen_id', String(params.citizen_id)))) apiError('NOT_FOUND', 'ไม่พบนักเรียน');
    await updateWhere(ctx.db, 'STUDENTS', 'citizen_id', String(params.citizen_id), { status: 'active', updated_at: now() });
    await audit(ctx.db, 'students', 'RESTORE', params.citizen_id, {}, params.recorded_by);
    return { ok: true };
  },

  /** โปรไฟล์รายบุคคล — รวมข้อมูลข้ามโมดูล (ใช้ค่า bmi_label/zscore ที่บันทึกไว้แล้วในแถว GROWTH) */
  profile: async function (params, ctx) {
    const db = ctx.db;
    if (!params.citizen_id) apiError('VALIDATION', 'ไม่ได้ระบุ citizen_id');
    const cid = String(params.citizen_id);
    const student = await getBy(db, 'STUDENTS', 'citizen_id', cid);
    if (!student) apiError('NOT_FOUND', 'ไม่พบนักเรียน');

    const ym = yearMonth();

    // ธนาคาร
    const balRow = await getBy(db, 'BANK_BALANCE', 'citizen_id', cid);
    const balance = balRow ? Number(balRow.balance) || 0 : 0;

    // พฤติกรรม — คะแนนเดือนปัจจุบัน + 5 รายการล่าสุด
    const start = await behaviorStart(db);
    const itemIndex = buildIndex(await readAll(db, 'BEHAVIOR_MASTER'), 'item_id');
    const bhvLogs = (await selectWhere(db, 'BEHAVIOR_LOG', 'citizen_id', cid))
      .filter(function (l) { return toYm(l.year_month) === ym; })
      .sort(function (a, b) { return String(a.created_at).localeCompare(String(b.created_at)); });
    const behaviorScore = bhvLogs.length ? Number(bhvLogs[bhvLogs.length - 1].points_after) || start : start;
    const recentBehavior = bhvLogs.slice(-5).reverse().map(function (l) {
      const it = itemIndex[String(l.item_id)];
      return { date: l.date, item_name: it ? it.name : '(ลบแล้ว)', points_change: Number(l.points_change) || 0 };
    });

    // สุขภาพ — ผลตรวจล่าสุด
    const healthItems = ['hair', 'nails', 'cup', 'toothbrush', 'toothpaste'];
    let latestHealth = null;
    (await selectWhere(db, 'HEALTH_CHECK', 'citizen_id', cid)).forEach(function (c) {
      if (!latestHealth || toYmd(c.date) > toYmd(latestHealth.date)) latestHealth = c;
    });
    let health = null;
    if (latestHealth) {
      health = { date: toYmd(latestHealth.date) };
      healthItems.forEach(function (k) { health[k] = latestHealth[k] || ''; });
    }

    // การมาเรียน — สรุปเดือนปัจจุบัน
    const attCounts = { 'มา': 0, 'ขาด': 0, 'ลา': 0, 'สาย': 0 };
    (await selectWhere(db, 'ATTENDANCE', 'citizen_id', cid)).forEach(function (a) {
      if (toYm(a.date) !== ym) return;
      if (attCounts[a.status] !== undefined) attCounts[a.status]++;
    });

    // การเจริญเติบโต — ผลล่าสุด (ใช้ค่าที่บันทึกไว้)
    let latestGrowth = null;
    (await selectWhere(db, 'GROWTH', 'citizen_id', cid)).forEach(function (g) {
      if (!latestGrowth || toYmd(g.date) > toYmd(latestGrowth.date)) latestGrowth = g;
    });
    let growth = null;
    if (latestGrowth) {
      growth = {
        date: toYmd(latestGrowth.date), weight: Number(latestGrowth.weight) || 0,
        height: Number(latestGrowth.height) || 0, bmi: Number(latestGrowth.bmi) || 0,
        zscore: latestGrowth.zscore === '' || latestGrowth.zscore === null ? null : Number(latestGrowth.zscore),
        bmi_label: latestGrowth.bmi_label || '',
      };
    }

    // ทุนการศึกษา
    const curYear = String((await getSetting(db, 'current_year')) || '');
    const schAll = (await selectWhere(db, 'SCHOLARSHIP', 'citizen_id', cid))
      .map(function (r) { return { date: toYmd(r.date), year: String(r.year), name: r.name, amount: Number(r.amount) || 0 }; })
      .sort(function (a, b) { return b.date.localeCompare(a.date); });
    let schYearTotal = 0, schYearCount = 0;
    schAll.forEach(function (r) { if (r.year === curYear) { schYearTotal += r.amount; schYearCount++; } });

    return {
      student: student,
      bank: { balance: balance },
      behavior: { year_month: ym, score: behaviorScore, recent: recentBehavior },
      health: health,
      attendance: { year_month: ym, counts: attCounts },
      growth: growth,
      scholarship: { year: curYear, year_total: Math.round(schYearTotal * 100) / 100, year_count: schYearCount, recent: schAll.slice(0, 5) },
    };
  },

  stats: async function (params, ctx) {
    const rows = (await readAll(ctx.db, 'STUDENTS')).filter(function (r) { return r.status !== 'inactive'; });
    const byGrade = {};
    let male = 0, female = 0;
    rows.forEach(function (r) {
      const key = r.grade + '/' + r.room;
      byGrade[key] = (byGrade[key] || 0) + 1;
      if (r.gender === 'ช') male++;
      else if (r.gender === 'ญ') female++;
    });
    return { total: rows.length, male: male, female: female, by_grade: byGrade };
  },

  /** Import DMC (chunk ละ ~50 แถว) — ใหม่=insert, มีอยู่=update เฉพาะ field ที่ map (คง status/created_at) */
  import_dmc: async function (params, ctx) {
    const rows = params.rows;
    if (!Array.isArray(rows)) apiError('VALIDATION', 'rows ต้องเป็น array');
    const existing = buildIndex(await readAll(ctx.db, 'STUDENTS'), 'citizen_id');
    const inserts = [];
    let updated = 0, skipped = 0;

    for (const raw of rows) {
      const m = mapDmcStudent(raw);
      if (!m.citizen_id || String(m.citizen_id).length !== 13) { skipped++; continue; }
      if (existing[String(m.citizen_id)]) {
        m.updated_at = now();
        await updateWhere(ctx.db, 'STUDENTS', 'citizen_id', String(m.citizen_id), m);
        updated++;
      } else {
        m.status = 'active'; m.created_at = now(); m.updated_at = now();
        inserts.push(m);
      }
    }
    if (inserts.length) await insertRows(ctx.db, 'STUDENTS', inserts);
    await audit(ctx.db, 'students', 'IMPORT_DMC', 'chunk-' + params.chunk_index,
      { inserted: inserts.length, updated: updated, skipped: skipped, total_chunks: params.total_chunks }, params.recorded_by);
    return { chunk_index: params.chunk_index, inserted: inserts.length, updated: updated, skipped: skipped };
  },
};
