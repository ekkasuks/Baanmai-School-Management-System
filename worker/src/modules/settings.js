/** Settings — ข้อมูลโรงเรียน + PIN (hash) · init ค่าเริ่มต้น */
import { readAll, getBy, upsert, now, hashPin, audit, apiError } from '../db.js';

/** อ่านค่า setting ดิบ (ใช้ภายใน เช่น auth) */
export async function getSetting(db, key) {
  const row = await getBy(db, 'SETTINGS', 'key', key);
  return row ? String(row.value) : null;
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
    return { ok: true };
  },

  /** เติมค่าเริ่มต้นเฉพาะคีย์ที่ยังไม่มี (idempotent) — schema สร้างโดย schema.sql แล้ว */
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
};
