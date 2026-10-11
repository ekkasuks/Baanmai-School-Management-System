/** Auth — ตรวจ PIN + session token (เก็บใน SESSIONS table แทน CacheService) */
import { getBy, insertRows, deleteWhere, now, today, genId, hashPin, audit, apiError } from '../db.js';
import { getSetting } from './settings.js';

const PIN_MODULES = ['bank', 'attendance'];

/** วินาทีถึงเที่ยงคืน (ไทย) — PIN กรอกวันละ 1 ครั้ง */
function secondsUntilMidnight() {
  const bkk = new Date(Date.now() + 7 * 3600 * 1000);
  const elapsed = bkk.getUTCHours() * 3600 + bkk.getUTCMinutes() * 60 + bkk.getUTCSeconds();
  return Math.max(86400 - elapsed, 60);
}

function midnightIso() {
  return new Date(Date.now() + (7 * 3600 + secondsUntilMidnight()) * 1000).toISOString().slice(0, 19);
}

export const AuthAPI = {

  verify_pin: async function (params, ctx) {
    const mod = params.module, pin = params.pin;
    if (!mod || !pin) apiError('VALIDATION', 'กรุณาระบุ module และ PIN');
    if (PIN_MODULES.indexOf(mod) < 0) apiError('VALIDATION', 'module นี้ไม่ต้องใช้ PIN: ' + mod);

    const stored = await getSetting(ctx.db, 'pin_' + mod);
    if (!stored) apiError('NOT_FOUND', 'ยังไม่ได้ตั้ง PIN สำหรับ ' + mod);
    if ((await hashPin(String(pin))) !== stored) {
      await audit(ctx.db, 'auth', 'PIN_FAIL', mod, { module: mod }, 'anonymous');
      apiError('PIN_INVALID', 'PIN ไม่ถูกต้อง');
    }

    const token = crypto.randomUUID();
    await insertRows(ctx.db, 'SESSIONS', [{ token: token, module: mod, issued_at: now(), expires_at: midnightIso() }]);
    await audit(ctx.db, 'auth', 'PIN_OK', mod, { module: mod }, 'anonymous');
    return { token: token, expires_in: secondsUntilMidnight() };
  },

  check: async function (params, ctx) {
    return { valid: await isTokenValid(ctx.db, params.token, params.module) };
  },
};

export async function isTokenValid(db, token, requireModule) {
  if (!token) return false;
  const row = await getBy(db, 'SESSIONS', 'token', token);
  if (!row) return false;
  if (String(row.expires_at) <= now()) {         // หมดอายุ → ลบทิ้ง
    await deleteWhere(db, 'SESSIONS', 'token', token);
    return false;
  }
  if (requireModule && row.module !== requireModule) return false;
  return true;
}

/** เรียกต้น method ที่ต้องใช้ PIN — throw ถ้าไม่ผ่าน */
export async function requirePin(ctx, moduleName) {
  if (!(await isTokenValid(ctx.db, ctx.token, moduleName))) {
    apiError('TOKEN_EXPIRED', 'กรุณากรอก PIN ใหม่');
  }
}
