/** Auth — ตรวจ PIN + session token (เก็บใน SESSIONS table แทน CacheService) */
import { getBy, insertRows, deleteWhere, now, today, genId, hashPin, audit, apiError } from '../db.js';
import { getSetting } from './settings.js';

const PIN_MODULES = ['bank', 'attendance', 'settings'];

/** กันเดา PIN: ผิดเกิน MAX_FAILS ครั้ง (ต่อ IP ต่อโมดูล) ภายใน LOCK_MIN นาที → ล็อกชั่วคราว */
const MAX_FAILS = 10;
const LOCK_MIN = 15;

/** คีย์ PIN ของโมดูล — settings ยังไม่ได้ตั้ง pin_settings → ใช้ pin_bank แทน (ไม่มีช่วงที่ไม่มีการป้องกัน) */
async function storedPin(db, mod) {
  const own = await getSetting(db, 'pin_' + mod);
  if (own || mod !== 'settings') return own;
  return await getSetting(db, 'pin_bank');
}

async function recentFails(db, mod, ip) {
  const since = new Date(Date.now() + 7 * 3600 * 1000 - LOCK_MIN * 60 * 1000).toISOString().slice(0, 19);
  const row = await db.prepare(
    "SELECT COUNT(*) AS n FROM AUDIT_LOG WHERE module='auth' AND action='PIN_FAIL' AND target_id=? AND timestamp>? AND details LIKE ?"
  ).bind(mod, since, '%"ip":' + JSON.stringify(ip) + '%').first();
  return (row && row.n) || 0;
}

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

    const ip = ctx.ip || 'unknown';
    if ((await recentFails(ctx.db, mod, ip)) >= MAX_FAILS) {
      apiError('PIN_LOCKED', 'กรอก PIN ผิดหลายครั้ง — กรุณารอ ' + LOCK_MIN + ' นาทีแล้วลองใหม่');
    }

    const stored = await storedPin(ctx.db, mod);
    if (!stored) apiError('NOT_FOUND', 'ยังไม่ได้ตั้ง PIN สำหรับ ' + mod);
    if ((await hashPin(String(pin))) !== stored) {
      await audit(ctx.db, 'auth', 'PIN_FAIL', mod, { module: mod, ip: ip }, 'anonymous');
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

/** ยกเลิก session ทั้งหมดของโมดูล (ใช้ตอนเปลี่ยน PIN) */
export async function revokeSessions(db, moduleName) {
  await deleteWhere(db, 'SESSIONS', 'module', moduleName);
}

/** เรียกต้น method ที่ต้องใช้ PIN — throw ถ้าไม่ผ่าน */
export async function requirePin(ctx, moduleName) {
  if (!(await isTokenValid(ctx.db, ctx.token, moduleName))) {
    apiError('TOKEN_EXPIRED', 'กรุณากรอก PIN ใหม่');
  }
}
