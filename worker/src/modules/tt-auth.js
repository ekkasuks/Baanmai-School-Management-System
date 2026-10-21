/**
 * AI Smart Timetable — เฟส 6: ผู้ใช้ + สิทธิ์ 6 ระดับ (โมดูล 12)
 * ใช้ตาราง TT_USER / TT_SESSION ของตัวเอง — ไม่แตะ USERS/SESSIONS/PIN เดิม (อ่าน pin_bank แบบอ่านอย่างเดียวตอนตั้งผู้ดูแลคนแรกเท่านั้น)
 *
 * รหัสผ่าน: PBKDF2-SHA256 + salt สุ่มต่อคน (รูปแบบ pbkdf2$รอบ$salt$hash — เพิ่มรอบภายหลังได้โดยไม่ต้องรีเซ็ต)
 * session: token สุ่ม 256 บิต ส่งให้เบราว์เซอร์ · ฐานข้อมูลเก็บเฉพาะ SHA-256 ของ token
 * กันเดารหัส: ผิด 5 ครั้ง ล็อก 10 นาที
 */
import { getBy, selectWhere, readAll, insertRows, updateWhere, deleteWhere, now, genId, hashPin, apiError } from '../db.js';
import { getSetting } from './settings.js';

const PBKDF2_ITER = 10000;          // Worker ฟรีจำกัด CPU ~10ms/คำขอ — ปรับเพิ่มได้ (เก็บรอบไว้ในค่า hash)
const MAX_FAILS = 5, LOCK_MIN = 10;
const SESSION_HOURS = 12, REMEMBER_DAYS = 30;
const MIN_PASSWORD = 8;

/** บทบาท → ความสามารถ */
export const ROLES = {
  admin:    { label: 'ผู้ดูแลระบบ',              caps: ['view', 'edit_data', 'edit_timetable', 'approve', 'announce', 'manage_users'] },
  director: { label: 'ผู้บริหาร',                 caps: ['view', 'approve', 'announce'] },
  academic: { label: 'ฝ่ายวิชาการ (ผู้จัดตาราง)', caps: ['view', 'edit_data', 'edit_timetable', 'announce'] },
  teacher:  { label: 'ครู',                       caps: ['view'] },
  student:  { label: 'นักเรียน',                  caps: [] },
  parent:   { label: 'ผู้ปกครอง',                 caps: [] },
};

/* ── crypto ── */
function b64(buf) { return btoa(String.fromCharCode.apply(null, new Uint8Array(buf))); }
function unb64(s) { return Uint8Array.from(atob(s), function (c) { return c.charCodeAt(0); }); }
async function sha256hex(s) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return Array.prototype.map.call(new Uint8Array(buf), function (b) { return ('0' + b.toString(16)).slice(-2); }).join('');
}
async function pbkdf2(password, salt, iter) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits']);
  return crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: salt, iterations: iter }, key, 256);
}
async function hashPassword(password) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  return 'pbkdf2$' + PBKDF2_ITER + '$' + b64(salt) + '$' + b64(await pbkdf2(password, salt, PBKDF2_ITER));
}
/** เทียบแบบเวลาคงที่ */
async function checkPassword(password, stored) {
  const p = String(stored || '').split('$');
  if (p.length !== 4 || p[0] !== 'pbkdf2') return false;
  const got = new Uint8Array(await pbkdf2(password, unb64(p[2]), Number(p[1]))), want = unb64(p[3]);
  if (got.length !== want.length) return false;
  let diff = 0;
  for (let i = 0; i < got.length; i++) diff |= got[i] ^ want[i];
  return diff === 0;
}
const DUMMY_HASH = 'pbkdf2$' + PBKDF2_ITER + '$AAAAAAAAAAAAAAAAAAAAAA==$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=';

function plusHours(h) { return new Date(Date.now() + 7 * 3600 * 1000 + h * 3600 * 1000).toISOString().slice(0, 19); }
function normUser(u) { return String(u || '').trim().toLowerCase(); }
function validUsername(u) { return /^[a-z0-9._-]{3,32}$/.test(u); }
function checkNewPassword(p) {
  if (String(p || '').length < MIN_PASSWORD) apiError('VALIDATION', 'รหัสผ่านต้องยาวอย่างน้อย ' + MIN_PASSWORD + ' ตัวอักษร');
  if (String(p).length > 128) apiError('VALIDATION', 'รหัสผ่านยาวเกินไป');
}
function publicUser(u) {
  const r = ROLES[u.role] || { label: u.role, caps: [] };
  return { user_id: u.user_id, username: u.username, display_name: u.display_name || u.username, role: u.role, role_label: r.label, caps: r.caps,
    teacher_id: u.teacher_id || '', class_id: u.class_id || '' };
}

/* ── session ── */
async function newSession(db, userId, remember) {
  const token = crypto.randomUUID().replace(/-/g, '') + crypto.randomUUID().replace(/-/g, '');
  const expires = plusHours(remember ? REMEMBER_DAYS * 24 : SESSION_HOURS);
  await insertRows(db, 'TT_SESSION', [{ token_hash: await sha256hex(token), user_id: userId, created_at: now(), expires_at: expires }]);
  return { token: token, expires_at: expires };
}

/** ผู้ใช้ของคำขอนี้ (หรือ null) — cache ไว้ใน ctx ให้ใช้ซ้ำในคำขอเดียวกัน */
export async function currentUser(ctx) {
  if (ctx._ttUser !== undefined) return ctx._ttUser;
  ctx._ttUser = null;
  if (!ctx.token || typeof ctx.token !== 'string' || ctx.token.length < 32) return null;
  const h = await sha256hex(ctx.token);
  const s = await getBy(ctx.db, 'TT_SESSION', 'token_hash', h);
  if (!s) return null;
  if (String(s.expires_at) <= now()) { await deleteWhere(ctx.db, 'TT_SESSION', 'token_hash', h); return null; }
  const u = await getBy(ctx.db, 'TT_USER', 'user_id', s.user_id);
  if (!u || String(u.active) === '0') return null;
  ctx._ttUser = u;
  ctx._ttTokenHash = h;
  return u;
}
export function can(user, cap) { return !!(user && ROLES[user.role] && ROLES[user.role].caps.indexOf(cap) >= 0); }

/** ต้องเข้าสู่ระบบ + มีความสามารถ cap (null = แค่เข้าสู่ระบบ) */
export async function requireCap(ctx, cap) {
  const u = await currentUser(ctx);
  if (!u) {
    const n = (await readAll(ctx.db, 'TT_USER')).length;
    apiError(n ? 'AUTH_REQUIRED' : 'SETUP_REQUIRED', n ? 'กรุณาเข้าสู่ระบบ' : 'ยังไม่ได้ตั้งผู้ดูแลระบบ — สร้างบัญชีผู้ดูแลคนแรกก่อน');
  }
  if (cap && !can(u, cap)) apiError('FORBIDDEN', 'บัญชี "' + (ROLES[u.role] ? ROLES[u.role].label : u.role) + '" ไม่มีสิทธิ์ทำรายการนี้');
  return u;
}

async function log(db, action, id, by, detail) {
  const year = String((await getSetting(db, 'current_year')) || '').trim(), sem = String((await getSetting(db, 'current_semester')) || '1').trim();
  try {
    await insertRows(db, 'TT_CHANGE', [{ change_id: genId('TTC'), term_id: year + '-' + sem, version_id: '', message: '',
      detail: Object.assign({ kind: 'auth', action: action, entity: 'user', id: id }, detail || {}), created_by: by || '', created_at: now() }]);
  } catch (e) { /* ignore */ }
}

/* ════ actions (เรียกผ่าน tt.*) ════ */
export const AuthActions = {

  /** สถานะ: ต้องตั้งผู้ดูแลคนแรกไหม + ผู้ใช้ปัจจุบัน (ถ้ามี token ที่ใช้ได้) */
  auth_status: async function (params, ctx) {
    const n = (await readAll(ctx.db, 'TT_USER')).length;
    const u = await currentUser(ctx);
    return { setup_required: n === 0, user: u ? publicUser(u) : null, roles: Object.keys(ROLES).map(function (k) { return { key: k, label: ROLES[k].label, caps: ROLES[k].caps }; }) };
  },

  /** ตั้งผู้ดูแลคนแรก — ทำได้ครั้งเดียว (ยังไม่มีผู้ใช้เลย) และต้องยืนยันด้วย PIN ธนาคารโรงเรียนของระบบเดิม */
  setup_admin: async function (params, ctx) {
    const db = ctx.db;
    if ((await readAll(db, 'TT_USER')).length) apiError('FORBIDDEN', 'มีผู้ดูแลระบบแล้ว — เข้าสู่ระบบแทน');
    const stored = await getSetting(db, 'pin_bank');
    if (!stored) apiError('CONFIG', 'ยังไม่ได้ตั้ง PIN ธนาคารโรงเรียนในหน้าตั้งค่าระบบ');
    if ((await hashPin(String(params.pin || ''))) !== stored) apiError('PIN_INVALID', 'PIN ไม่ถูกต้อง');
    const username = normUser(params.username);
    if (!validUsername(username)) apiError('VALIDATION', 'ชื่อผู้ใช้ 3–32 ตัว ใช้ a-z 0-9 . _ - เท่านั้น');
    checkNewPassword(params.password);
    const u = { user_id: genId('USR'), username: username, display_name: String(params.display_name || username).trim().slice(0, 60), role: 'admin',
      password_hash: await hashPassword(params.password), teacher_id: '', class_id: '', active: '1', failed_count: 0, created_at: now(), updated_at: now() };
    await insertRows(db, 'TT_USER', [u]);
    await log(db, 'SETUP', u.user_id, username);
    const s = await newSession(db, u.user_id, false);
    return { token: s.token, expires_at: s.expires_at, user: publicUser(u) };
  },

  login: async function (params, ctx) {
    const db = ctx.db;
    const username = normUser(params.username), password = String(params.password || '');
    const u = username ? await getBy(db, 'TT_USER', 'username', username) : null;
    const fail = function () { apiError('LOGIN_FAILED', 'ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง'); };
    if (!u || String(u.active) === '0') { await checkPassword(password, DUMMY_HASH); fail(); }   // ใช้เวลาเท่ากันไม่ว่าจะมีชื่อผู้ใช้หรือไม่
    if (u.locked_until && String(u.locked_until) > now()) apiError('LOCKED', 'ใส่รหัสผิดหลายครั้ง — ลองใหม่หลัง ' + String(u.locked_until).slice(11, 16) + ' น.');
    if (!(await checkPassword(password, u.password_hash))) {
      const n = (Number(u.failed_count) || 0) + 1;
      await updateWhere(db, 'TT_USER', 'user_id', u.user_id, n >= MAX_FAILS ? { failed_count: 0, locked_until: plusHours(LOCK_MIN / 60) } : { failed_count: n });
      fail();
    }
    await updateWhere(db, 'TT_USER', 'user_id', u.user_id, { failed_count: 0, locked_until: '', last_login: now() });
    const s = await newSession(db, u.user_id, params.remember === true);
    return { token: s.token, expires_at: s.expires_at, user: publicUser(u) };
  },

  logout: async function (params, ctx) {
    const u = await currentUser(ctx);
    if (u) await deleteWhere(ctx.db, 'TT_SESSION', 'token_hash', ctx._ttTokenHash);
    return { ok: true };
  },

  me: async function (params, ctx) { return { user: publicUser(await requireCap(ctx, null)) }; },

  /** เปลี่ยนรหัสผ่านตัวเอง → ออกจากระบบเครื่องอื่นทั้งหมด */
  change_password: async function (params, ctx) {
    const u = await requireCap(ctx, null);
    if (!(await checkPassword(String(params.old_password || ''), u.password_hash))) apiError('LOGIN_FAILED', 'รหัสผ่านเดิมไม่ถูกต้อง');
    checkNewPassword(params.new_password);
    await updateWhere(ctx.db, 'TT_USER', 'user_id', u.user_id, { password_hash: await hashPassword(params.new_password), updated_at: now() });
    const others = (await selectWhere(ctx.db, 'TT_SESSION', 'user_id', u.user_id)).filter(function (s) { return s.token_hash !== ctx._ttTokenHash; });
    if (others.length) await ctx.db.batch(others.map(function (s) { return ctx.db.prepare('DELETE FROM TT_SESSION WHERE token_hash=?').bind(s.token_hash); }));
    await log(ctx.db, 'PASSWORD', u.user_id, u.username);
    return { ok: true, signed_out_others: others.length };
  },

  users_list: async function (params, ctx) {
    await requireCap(ctx, 'manage_users');
    const users = (await readAll(ctx.db, 'TT_USER')).map(function (u) {
      return Object.assign(publicUser(u), { active: String(u.active) !== '0', last_login: u.last_login || '', locked: !!(u.locked_until && String(u.locked_until) > now()), created_at: u.created_at });
    }).sort(function (a, b) { return Object.keys(ROLES).indexOf(a.role) - Object.keys(ROLES).indexOf(b.role) || a.username.localeCompare(b.username); });
    return { users: users };
  },

  /** เพิ่ม/แก้ผู้ใช้ — params = { user_id?, username, display_name, role, teacher_id?, class_id?, active?, password? (ต้องมีตอนเพิ่ม) } */
  user_save: async function (params, ctx) {
    const me = await requireCap(ctx, 'manage_users');
    const db = ctx.db;
    const all = await readAll(db, 'TT_USER');
    const id = params.user_id ? String(params.user_id) : '';
    const cur = id ? all.find(function (u) { return u.user_id === id; }) : null;
    if (id && !cur) apiError('NOT_FOUND', 'ไม่พบผู้ใช้');
    const username = normUser(params.username);
    if (!validUsername(username)) apiError('VALIDATION', 'ชื่อผู้ใช้ 3–32 ตัว ใช้ a-z 0-9 . _ - เท่านั้น');
    if (all.some(function (u) { return u.username === username && u.user_id !== id; })) apiError('DUPLICATE', 'ชื่อผู้ใช้ "' + username + '" ถูกใช้แล้ว');
    if (!ROLES[params.role]) apiError('VALIDATION', 'บทบาทไม่ถูกต้อง');
    const active = params.active === false || params.active === '0' ? '0' : '1';
    // ห้ามทำให้ไม่เหลือผู้ดูแลระบบที่ใช้งานได้
    if (cur && cur.role === 'admin' && String(cur.active) !== '0' && (params.role !== 'admin' || active === '0')) {
      const admins = all.filter(function (u) { return u.role === 'admin' && String(u.active) !== '0'; });
      if (admins.length <= 1) apiError('VALIDATION', 'ต้องมีผู้ดูแลระบบที่ใช้งานได้อย่างน้อย 1 คน');
    }
    if (params.teacher_id && !(await getBy(db, 'TT_TEACHER', 'teacher_id', String(params.teacher_id)))) apiError('VALIDATION', 'ไม่พบครูที่ผูกไว้');
    if (params.class_id && !(await getBy(db, 'TT_CLASS', 'class_id', String(params.class_id)))) apiError('VALIDATION', 'ไม่พบชั้นเรียนที่ผูกไว้');
    const row = { username: username, display_name: String(params.display_name || username).trim().slice(0, 60), role: params.role,
      teacher_id: params.teacher_id ? String(params.teacher_id) : '', class_id: params.class_id ? String(params.class_id) : '', active: active, updated_at: now() };
    let uid = id;
    if (cur) {
      await updateWhere(db, 'TT_USER', 'user_id', id, row);
      if (active === '0' || row.role !== cur.role) await deleteWhere(db, 'TT_SESSION', 'user_id', id);   // เปลี่ยนสิทธิ์/ปิดบัญชี = ออกจากระบบทันที
    } else {
      checkNewPassword(params.password);
      uid = genId('USR');
      await insertRows(db, 'TT_USER', [Object.assign(row, { user_id: uid, password_hash: await hashPassword(params.password), failed_count: 0, created_at: now() })]);
    }
    await log(db, cur ? 'UPDATE' : 'CREATE', uid, me.username, { role: row.role, active: active });
    return { user_id: uid };
  },

  /** ผู้ดูแลตั้งรหัสผ่านใหม่ให้ผู้ใช้ (ปลดล็อกด้วย) → ออกจากระบบทุกเครื่องของผู้ใช้นั้น */
  user_reset_password: async function (params, ctx) {
    const me = await requireCap(ctx, 'manage_users');
    const u = params.user_id ? await getBy(ctx.db, 'TT_USER', 'user_id', String(params.user_id)) : null;
    if (!u) apiError('NOT_FOUND', 'ไม่พบผู้ใช้');
    checkNewPassword(params.password);
    await updateWhere(ctx.db, 'TT_USER', 'user_id', u.user_id, { password_hash: await hashPassword(params.password), failed_count: 0, locked_until: '', updated_at: now() });
    await deleteWhere(ctx.db, 'TT_SESSION', 'user_id', u.user_id);
    await log(ctx.db, 'RESET_PASSWORD', u.user_id, me.username);
    return { ok: true };
  },
};
