/** Settings — ข้อมูลโรงเรียน + PIN · backup/restore · เลื่อนชั้น
 *  get / init / promote_preview อ่านได้สาธารณะ · update / backup / restore / promote ต้องมี PIN session โมดูล 'settings' */
import { TABLES, readAll, getBy, upsert, updateWhere, insertRows, clearTable, now, hashPin, audit, apiError } from '../db.js';
import { requirePin, revokeSessions } from './auth.js';

/** อ่านค่า setting ดิบ (ใช้ภายใน เช่น auth) */
export async function getSetting(db, key) {
  const row = await getBy(db, 'SETTINGS', 'key', key);
  return row ? String(row.value) : null;
}

/** ลำดับชั้น (อนุบาล→ประถม, มัธยม) — ใช้หาชั้นถัดไปตอนเลื่อนชั้น */
const GRADE_CHAINS = [
  ['อ.1', 'อ.2', 'อ.3', 'ป.1', 'ป.2', 'ป.3', 'ป.4', 'ป.5', 'ป.6'],
  ['ม.1', 'ม.2', 'ม.3', 'ม.4', 'ม.5', 'ม.6'],
];
/** ชั้นถัดไป: คืน string = ชั้นใหม่ · null = ชั้นสุดท้าย(จบ) · undefined = ไม่รู้จัก(ข้าม) */
function nextGrade(g) {
  g = String(g || '').trim();
  for (const ch of GRADE_CHAINS) {
    const i = ch.indexOf(g);
    if (i >= 0) return i + 1 < ch.length ? ch[i + 1] : null;
  }
  return undefined;
}

export const SettingsAPI = {

  get: async function (params, ctx) {
    const all = await readAll(ctx.db, 'SETTINGS');
    const out = {};
    all.forEach(function (r) {
      out[r.key] = String(r.key).indexOf('pin_') === 0 ? '***' : r.value;  // ไม่ส่ง hash ออก
    });
    return { settings: out };
  },

  update: async function (params, ctx) {
    await requirePin(ctx, 'settings');
    const key = params.key;
    if (!key) apiError('VALIDATION', 'missing key');
    let value = params.value;
    if (String(key).indexOf('pin_') === 0) {
      if (String(value).length < 3) apiError('VALIDATION', 'PIN ต้องไม่น้อยกว่า 3 หลัก');
      value = await hashPin(String(value));
    }
    await upsert(ctx.db, 'SETTINGS', {
      key: key, value: value, updated_at: now(), updated_by: params.recorded_by || 'admin',
    });
    await audit(ctx.db, 'settings', 'UPDATE', key, { key: key }, params.recorded_by);
    if (String(key).indexOf('pin_') === 0) await revokeSessions(ctx.db, String(key).slice(4));   // เปลี่ยน PIN → token เดิมของโมดูลนั้นใช้ไม่ได้
    return { ok: true };
  },

  /** เติมค่าเริ่มต้นเฉพาะคีย์ที่ยังไม่มี (idempotent) — schema สร้างโดย schema.sql แล้ว
   *  ห้ามใส่ pin_settings ใน defaults: init เรียกได้โดยไม่มี PIN จะกลายเป็นตั้ง PIN ที่คนนอกรู้ */
  init: async function (params, ctx) {
    const defaults = {
      school_name: 'โรงเรียนบ้านใหม่', address: '', phone: '', director: '',
      email: '', website: '', current_year: '2569', current_semester: '1',
      pin_bank: await hashPin('127'), pin_attendance: await hashPin('127'),
      behavior_start: '20', behavior_reset_day: '1',
    };
    const existing = {};
    (await readAll(ctx.db, 'SETTINGS')).forEach(function (r) { existing[r.key] = true; });
    let inserted = 0;
    for (const k of Object.keys(defaults)) {
      if (!existing[k]) {
        await upsert(ctx.db, 'SETTINGS', { key: k, value: defaults[k], updated_at: now(), updated_by: 'system' });
        inserted++;
      }
    }
    return { settings_inserted: inserted };
  },

  /** สำรองข้อมูลทุกตาราง → { version, created_at, data:{TABLE:[...]} } (ฝั่ง frontend เอาไปดาวน์โหลดเป็นไฟล์) */
  backup: async function (params, ctx) {
    await requirePin(ctx, 'settings');
    const data = {};
    for (const table of Object.keys(TABLES)) { if (!TABLES[table].secret) data[table] = await readAll(ctx.db, table); }
    return { version: 2, source: 'cloudflare-d1', created_at: now(), data: data };
  },

  /** กู้คืน — ลบของเดิมในตารางที่อยู่ใน backup แล้วเขียนใหม่ (ต้อง confirm:true) */
  restore: async function (params, ctx) {
    await requirePin(ctx, 'settings');
    const backup = params.backup;
    if (!backup || !backup.data) apiError('VALIDATION', 'ไฟล์สำรองไม่ถูกต้อง');
    if (params.confirm !== true) apiError('VALIDATION', 'ต้องยืนยันก่อนกู้คืน (confirm=true)');
    const report = {};
    for (const table of Object.keys(backup.data)) {
      if (!TABLES[table] || TABLES[table].secret) continue;
      const rows = backup.data[table] || [];
      await clearTable(ctx.db, table);
      let n = 0;
      for (let i = 0; i < rows.length; i += 50) n += await insertRows(ctx.db, table, rows.slice(i, i + 50), true);
      report[table] = n;
    }
    await audit(ctx.db, 'settings', 'RESTORE', 'backup', { tables: Object.keys(report).length }, params.recorded_by);
    return { restored: report };
  },

  /** พรีวิวการเลื่อนชั้น (ไม่เขียนข้อมูล) — ชั้นไหนเลื่อนไปไหน + ใครจบ + ปีการศึกษา */
  promote_preview: async function (params, ctx) {
    const db = ctx.db;
    const students = (await readAll(db, 'STUDENTS')).filter(function (s) { return s.status !== 'inactive'; });
    const byGrade = {};
    students.forEach(function (s) { const g = s.grade || '-'; byGrade[g] = (byGrade[g] || 0) + 1; });
    let graduates = 0, promoted = 0, skipped = 0;
    const moves = Object.keys(byGrade).map(function (g) {
      const ng = nextGrade(g);
      let to, kind;
      if (ng === null) { to = 'จบการศึกษา'; kind = 'graduate'; graduates += byGrade[g]; }
      else if (ng === undefined) { to = g; kind = 'skip'; skipped += byGrade[g]; }
      else { to = ng; kind = 'promote'; promoted += byGrade[g]; }
      return { grade: g, count: byGrade[g], to: to, kind: kind };
    }).sort(function (a, b) { return gradeKey(a.grade) - gradeKey(b.grade); });

    const curYear = String((await getSetting(db, 'current_year')) || '');
    const toYear = curYear && /^\d+$/.test(curYear) ? String(parseInt(curYear, 10) + 1) : curYear;
    return {
      total: students.length, promoted: promoted, graduates: graduates, skipped: skipped,
      moves: moves, from_year: curYear, to_year: toYear,
    };
  },

  /** เลื่อนชั้นจริง — เลื่อนทุกคน (active), ป.6→จบ(inactive), เพิ่มปีการศึกษา +1 · ต้อง confirm:true */
  promote: async function (params, ctx) {
    await requirePin(ctx, 'settings');
    const db = ctx.db;
    if (params.confirm !== true) apiError('VALIDATION', 'ต้องยืนยันก่อนเลื่อนชั้น (confirm=true)');
    const ts = now();
    const students = (await readAll(db, 'STUDENTS')).filter(function (s) { return s.status !== 'inactive'; });
    let promoted = 0, graduated = 0, skipped = 0;
    for (const s of students) {
      const ng = nextGrade(s.grade);
      if (ng === null) { await updateWhere(db, 'STUDENTS', 'citizen_id', String(s.citizen_id), { status: 'inactive', updated_at: ts }); graduated++; }
      else if (ng && ng !== s.grade) { await updateWhere(db, 'STUDENTS', 'citizen_id', String(s.citizen_id), { grade: ng, updated_at: ts }); promoted++; }
      else { skipped++; }
    }

    const curYear = String((await getSetting(db, 'current_year')) || '');
    let toYear = curYear;
    if (params.bump_year !== false && curYear && /^\d+$/.test(curYear)) {
      toYear = String(parseInt(curYear, 10) + 1);
      await upsert(db, 'SETTINGS', { key: 'current_year', value: toYear, updated_at: ts, updated_by: params.recorded_by || 'admin' });
    }
    await audit(db, 'settings', 'PROMOTE', 'all', { promoted: promoted, graduated: graduated, skipped: skipped, from_year: curYear, to_year: toYear }, params.recorded_by);
    return { promoted: promoted, graduated: graduated, skipped: skipped, from_year: curYear, to_year: toYear };
  },
};

/** คีย์เรียงชั้น (ใช้ใน preview) */
function gradeKey(g) {
  g = String(g || '');
  if (g.indexOf('อ.') === 0) return parseInt(g.slice(2), 10) || 0;
  if (g.indexOf('ป.') === 0) return 10 + (parseInt(g.slice(2), 10) || 0);
  if (g.indexOf('ม.') === 0) return 20 + (parseInt(g.slice(2), 10) || 0);
  return 99;
}
