/**
 * AI Smart Timetable — เฟส 6: ผู้ใช้ + สิทธิ์ 6 ระดับ (โมดูล 12)
 * ใช้ตาราง TT_USER / TT_SESSION ของตัวเอง — ไม่แตะ USERS/SESSIONS/PIN เดิม (อ่าน pin_bank แบบอ่านอย่างเดียวตอนตั้งผู้ดูแลคนแรกเท่านั้น)
 *
 * รหัสผ่าน: PBKDF2-SHA256 + salt สุ่มต่อคน (รูปแบบ pbkdf2$รอบ$salt$hash — เพิ่มรอบภายหลังได้โดยไม่ต้องรีเซ็ต)
 * session: token สุ่ม 256 บิต ส่งให้เบราว์เซอร์ · ฐานข้อมูลเก็บเฉพาะ SHA-256 ของ token
 * กันเดารหัส: ผิด 5 ครั้ง ล็อก 10 นาที
 */
import { getBy, selectWhere, readAll, insertRows, updateWhere, deleteWhere, upsert, now, genId, hashPin, apiError } from '../db.js';
import { getSetting } from './settings.js';
import { listClasses } from '../shared.js';

const PBKDF2_ITER = 10000;          // Worker ฟรีจำกัด CPU ~10ms/คำขอ — ปรับเพิ่มได้ (เก็บรอบไว้ในค่า hash)
const MAX_FAILS = 5, LOCK_MIN = 10;
const SESSION_HOURS = 12, REMEMBER_DAYS = 30;
const MIN_PASSWORD = 8;

/** บทบาท → ความสามารถ */
export const ROLES = {
  admin:    { label: 'ผู้ดูแลระบบ',              caps: ['view', 'edit_data', 'edit_timetable', 'approve', 'announce', 'manage_users', 'geo', 'geo_edit', 'geo_admin', 'acad_admin', 'gb', 'gb_admin', 'gb_view', 'audit_view'] },
  director: { label: 'ผู้บริหาร',                 caps: ['view', 'approve', 'announce', 'geo', 'gb_view'] },
  academic: { label: 'ฝ่ายวิชาการ (ผู้จัดตาราง)', caps: ['view', 'edit_data', 'edit_timetable', 'announce', 'geo', 'geo_edit', 'acad_admin', 'gb', 'gb_admin', 'gb_view', 'audit_view'] },
  teacher:  { label: 'ครู',                       caps: ['view', 'geo', 'geo_edit', 'gb'] },
  student:  { label: 'นักเรียน',                  caps: [] },
  parent:   { label: 'ผู้ปกครอง',                 caps: [] },
};
const STAFF_ROLES = ['admin', 'director', 'academic', 'teacher'];

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

/* ── ครูข้ามภาคเรียน: TT_TEACHER เป็นรายภาค (คัดลอกภาค = teacher_id ใหม่) → จับคู่ด้วย teacher_id / รหัสครู / ชื่อ ── */
function normName(n) { return String(n || '').replace(/\s+/g, ' ').trim(); }
export function sameTeacher(a, b) {
  if (!a || !b) return false;
  if (a.teacher_id === b.teacher_id) return true;
  const ca = String(a.code || '').trim().toLowerCase(), cb = String(b.code || '').trim().toLowerCase();
  if (ca && cb) return ca === cb;
  return !!normName(a.name) && normName(a.name) === normName(b.name);
}
/** แถว TT_TEACHER ของภาค term ที่ตรงกับครูที่บัญชีนี้ผูกไว้ (หรือ null) */
export async function teacherForTerm(db, user, term) {
  if (!user || !user.teacher_id) return null;
  const linked = await getBy(db, 'TT_TEACHER', 'teacher_id', String(user.teacher_id));
  if (!linked) return null;
  if (String(linked.term_id) === String(term)) return linked;
  const list = await selectWhere(db, 'TT_TEACHER', 'term_id', String(term));
  return list.find(function (t) { return sameTeacher(t, linked); }) || null;
}
async function activeTerm(db) {
  const year = String((await getSetting(db, 'current_year')) || '').trim(), sem = String((await getSetting(db, 'current_semester')) || '1').trim();
  return year + '-' + sem;
}
/** รหัสผ่านเริ่มต้น 8 ตัว (ตัดตัวที่สับสนง่าย เช่น 0/O 1/l) */
function initialPassword() {
  const ch = 'abcdefghjkmnpqrstuvwxyz23456789', r = crypto.getRandomValues(new Uint8Array(8));
  return Array.prototype.map.call(r, function (b) { return ch[b % ch.length]; }).join('');
}

/* ════ actions (เรียกผ่าน tt.*) ════ */
/** บัญชีที่มีในประวัติการบันทึก (ลบถาวรไม่ได้) → { user_id: true } */
async function usedUserIds(db) {
  const o = {};
  ((await db.prepare("SELECT DISTINCT user_id FROM WRITE_LOG WHERE user_id IS NOT NULL AND user_id <> ''").all()).results || []).forEach(function (r) { o[r.user_id] = true; });
  return o;
}

/** ชั้นที่บัญชีนี้เป็นครูประจำชั้น (STAFF_HOMEROOM) → [{grade, room}] เรียงตามชั้น */
export async function homeroomsOf(db, userId) {
  if (!userId) return [];
  return (await selectWhere(db, 'STAFF_HOMEROOM', 'user_id', userId)).map(function (r) { return { grade: r.grade, room: r.room == null ? '' : String(r.room) }; })
    .sort(function (a, b) { return String(a.grade).localeCompare(String(b.grade), 'th', { numeric: true }) || String(a.room).localeCompare(String(b.room), undefined, { numeric: true }); });
}
function roomKey(r) { const x = String(r == null ? '' : r).trim(); return x === '' || x === '0' ? '1' : x; }

export const AuthActions = {

  /** สถานะ: ต้องตั้งผู้ดูแลคนแรกไหม + ผู้ใช้ปัจจุบัน (ถ้ามี token ที่ใช้ได้) */
  auth_status: async function (params, ctx) {
    const n = (await readAll(ctx.db, 'TT_USER')).length;
    const u = await currentUser(ctx);
    const pu = u ? Object.assign(publicUser(u), { homeroom: await homeroomsOf(ctx.db, u.user_id) }) : null;
    const req = String((await getSetting(ctx.db, 'staff_login_required')) || '') === '1';
    return { setup_required: n === 0, user: pu, write_login_required: req, roles: Object.keys(ROLES).map(function (k) { return { key: k, label: ROLES[k].label, caps: ROLES[k].caps }; }) };
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
    const username = normUser(params.username), password = String(params.password || ''), uid = String(params.user_id || '');
    // เข้าสู่ระบบแบบ "เลือกชื่อ" ส่ง user_id มาแทนชื่อผู้ใช้ (เฉพาะบัญชีบุคลากร)
    let u = uid ? await getBy(db, 'TT_USER', 'user_id', uid) : username ? await getBy(db, 'TT_USER', 'username', username) : null;
    if (u && uid && STAFF_ROLES.indexOf(u.role) < 0) u = null;
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
    const me = await requireCap(ctx, 'manage_users');
    const used = await usedUserIds(ctx.db);
    const users = (await readAll(ctx.db, 'TT_USER')).map(function (u) {
      return Object.assign(publicUser(u), { active: String(u.active) !== '0', last_login: u.last_login || '', locked: !!(u.locked_until && String(u.locked_until) > now()), created_at: u.created_at,
        deletable: u.user_id !== me.user_id && !u.last_login && !used[u.user_id] });
    }).sort(function (a, b) { return Object.keys(ROLES).indexOf(a.role) - Object.keys(ROLES).indexOf(b.role) || a.username.localeCompare(b.username); });
    return { users: users };
  },

  /**
   * ลบบัญชีถาวร — เฉพาะบัญชีที่ "ไม่เคยใช้งาน" (ไม่เคยเข้าสู่ระบบ และไม่มีในประวัติการบันทึก) เช่น สร้างผิด/ซ้ำ
   * บัญชีที่เคยใช้แล้วให้ปิดใช้งานแทน (ประวัติยังอ้างชื่อได้) · ลบครูประจำชั้น/เซสชันของบัญชีนั้นด้วย
   */
  user_delete: async function (params, ctx) {
    const me = await requireCap(ctx, 'manage_users');
    const db = ctx.db, id = String(params.user_id || '');
    const u = await getBy(db, 'TT_USER', 'user_id', id);
    if (!u) apiError('NOT_FOUND', 'ไม่พบผู้ใช้');
    if (u.user_id === me.user_id) apiError('VALIDATION', 'ลบบัญชีของตัวเองไม่ได้');
    if (u.last_login || (await usedUserIds(db))[u.user_id]) apiError('VALIDATION', 'บัญชีนี้เคยใช้งานแล้ว — ลบไม่ได้ (ประวัติการบันทึกอ้างถึงบัญชีนี้) ให้ปิดใช้งานแทน');
    if (u.role === 'admin' && String(u.active) !== '0') {
      const admins = (await readAll(db, 'TT_USER')).filter(function (x) { return x.role === 'admin' && String(x.active) !== '0'; });
      if (admins.length <= 1) apiError('VALIDATION', 'ต้องมีผู้ดูแลระบบที่ใช้งานได้อย่างน้อย 1 คน');
    }
    await db.batch([db.prepare('DELETE FROM TT_SESSION WHERE user_id = ?').bind(id), db.prepare('DELETE FROM STAFF_HOMEROOM WHERE user_id = ?').bind(id),
      db.prepare('DELETE FROM TT_USER WHERE user_id = ?').bind(id)]);
    params.username = u.username;   // ให้ประวัติการบันทึกเก็บชื่อผู้ใช้ที่ถูกลบ (write-log DETAIL_KEYS)
    await log(db, 'DELETE', id, me.username, { username: u.username, role: u.role });
    return { user_id: id, username: u.username };
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

  /** หน้าเข้าสู่ระบบแบบเลือกชื่อ (สาธารณะ) — ส่งเฉพาะ user_id + ชื่อที่แสดงของบุคลากรที่ใช้งานอยู่ (ไม่ส่งชื่อผู้ใช้) */
  login_choices: async function (params, ctx) {
    const users = (await readAll(ctx.db, 'TT_USER')).filter(function (u) { return String(u.active) !== '0' && STAFF_ROLES.indexOf(u.role) >= 0; });
    return { users: users.map(function (u) { return { user_id: u.user_id, display_name: u.display_name || u.username }; })
      .sort(function (a, b) { return a.display_name.localeCompare(b.display_name, 'th'); }) };
  },

  /** ครูในตารางสอนภาคปัจจุบัน + บัญชีที่ผูกไว้ (ถ้ามี) — สำหรับปุ่มสร้างบัญชีครูทั้งหมด */
  /**
   * ข้อมูลประกอบหน้าจัดการผู้ใช้ (ตั้งค่าระบบ › ผู้ใช้) — ครู/ชั้นเรียนของภาคปัจจุบัน (ไว้ผูกบัญชี) · ชั้นจากข้อมูลนักเรียน · ครูประจำชั้นทั้งหมด
   * → { term, teachers[{teacher_id,name}], tt_classes[{class_id,label}], classes[{grade,room,count}], homerooms[{user_id,grade,room}] }
   */
  staff_admin_data: async function (params, ctx) {
    await requireCap(ctx, 'manage_users');
    const db = ctx.db, term = await activeTerm(db);
    const [teachers, ttc, classes, hr] = await Promise.all([selectWhere(db, 'TT_TEACHER', 'term_id', term), selectWhere(db, 'TT_CLASS', 'term_id', term), listClasses(db), readAll(db, 'STAFF_HOMEROOM')]);
    return {
      term: term,
      teachers: teachers.filter(function (t) { return String(t.active) !== '0'; }).map(function (t) { return { teacher_id: t.teacher_id, name: normName((t.title || '') + ' ' + (t.name || '')) || t.name || '' }; })
        .sort(function (a, b) { return a.name.localeCompare(b.name, 'th'); }),
      tt_classes: ttc.filter(function (c) { return String(c.active) !== '0'; }).map(function (c) { return { class_id: c.class_id, label: String(c.grade || '') + (c.room && String(c.room) !== '1' ? '/' + c.room : '') }; }),
      classes: classes,
      homerooms: hr.map(function (r) { return { user_id: r.user_id, grade: r.grade, room: r.room == null ? '' : String(r.room) }; }),
    };
  },

  /** กำหนดชั้นที่เป็นครูประจำชั้นของบัญชี 1 บัญชี (แทนที่ทั้งชุด) · params { user_id, classes:[{grade, room}] } (ว่าง = ไม่เป็นครูประจำชั้น) */
  homeroom_save: async function (params, ctx) {
    const me = await requireCap(ctx, 'manage_users');
    const db = ctx.db, u = await getBy(db, 'TT_USER', 'user_id', String(params.user_id || ''));
    if (!u) apiError('NOT_FOUND', 'ไม่พบผู้ใช้');
    if (STAFF_ROLES.indexOf(u.role) < 0 || u.role === 'director') apiError('VALIDATION', 'กำหนดครูประจำชั้นได้เฉพาะบัญชีครู/ฝ่ายวิชาการ/ผู้ดูแล');
    const list = Array.isArray(params.classes) ? params.classes : [];
    if (list.length > 12) apiError('VALIDATION', 'เลือกได้ไม่เกิน 12 ชั้น');
    const valid = {}; (await listClasses(db)).forEach(function (c) { valid[c.grade + '|' + c.room] = true; });
    const seen = {}, rows = [];
    list.forEach(function (c) {
      const g = String((c && c.grade) || '').trim(), r = String((c && c.room) == null ? '' : c.room).trim(), k = g + '|' + r;
      if (!valid[k]) apiError('VALIDATION', 'ไม่พบชั้น ' + g + (r ? '/' + r : '') + ' ในข้อมูลนักเรียน');
      if (!seen[k]) { seen[k] = 1; rows.push({ hr_id: u.user_id + '|' + k, user_id: u.user_id, grade: g, room: r, created_by: me.username, created_at: now() }); }
    });
    const stmts = [db.prepare('DELETE FROM STAFF_HOMEROOM WHERE user_id = ?').bind(u.user_id)];
    rows.forEach(function (r) { stmts.push(db.prepare('INSERT INTO STAFF_HOMEROOM (hr_id, user_id, grade, room, created_by, created_at) VALUES (?,?,?,?,?,?)').bind(r.hr_id, r.user_id, r.grade, r.room, r.created_by, r.created_at)); });
    await db.batch(stmts);
    return { user_id: u.user_id, classes: rows.map(function (r) { return { grade: r.grade, room: r.room }; }) };
  },

  /**
   * ดึงครูประจำชั้นจากตารางสอนภาคปัจจุบัน (TT_CLASS.homeroom_teacher_id) → บัญชีที่ผูกครูคนเดียวกัน (sameTeacher) · เพิ่มอย่างเดียว ไม่ลบของเดิม
   * → { added, skipped[ชั้นที่ไม่มีบัญชีครู/ไม่พบในข้อมูลนักเรียน] }
   */
  homeroom_import: async function (params, ctx) {
    const me = await requireCap(ctx, 'manage_users');
    const db = ctx.db, term = await activeTerm(db);
    const [ttc, teachers, users, classes, have] = await Promise.all([selectWhere(db, 'TT_CLASS', 'term_id', term), selectWhere(db, 'TT_TEACHER', 'term_id', term),
      readAll(db, 'TT_USER'), listClasses(db), readAll(db, 'STAFF_HOMEROOM')]);
    const T = {}; teachers.forEach(function (t) { T[t.teacher_id] = t; });
    const linked = [];
    for (const u of users) {
      if (!u.teacher_id || String(u.active) === '0' || STAFF_ROLES.indexOf(u.role) < 0 || u.role === 'director') continue;
      const t = T[u.teacher_id] || await getBy(db, 'TT_TEACHER', 'teacher_id', String(u.teacher_id));
      if (t) linked.push({ u: u, t: t });
    }
    const exists = {}; have.forEach(function (r) { exists[r.hr_id] = true; });
    const stmts = [], skipped = [];
    ttc.forEach(function (c) {
      if (String(c.active) === '0' || !c.homeroom_teacher_id) return;
      const label = String(c.grade || '') + (c.room && String(c.room) !== '1' ? '/' + c.room : '');
      const ht = T[c.homeroom_teacher_id];
      const acc = ht && linked.find(function (x) { return sameTeacher(x.t, ht); });
      const sc = classes.find(function (k) { return k.grade === String(c.grade || '') && roomKey(k.room) === roomKey(c.room); });
      if (!acc || !sc) { skipped.push(label + (acc ? ' (ไม่พบในข้อมูลนักเรียน)' : ' (ครูยังไม่มีบัญชี)')); return; }
      const id = acc.u.user_id + '|' + sc.grade + '|' + sc.room;
      if (exists[id]) return;
      exists[id] = true;
      stmts.push(db.prepare('INSERT OR IGNORE INTO STAFF_HOMEROOM (hr_id, user_id, grade, room, created_by, created_at) VALUES (?,?,?,?,?,?)').bind(id, acc.u.user_id, sc.grade, sc.room, me.username, now()));
    });
    if (stmts.length) await db.batch(stmts);
    return { added: stmts.length, skipped: skipped };
  },

  /** สวิตช์ "บังคับเข้าสู่ระบบเมื่อบันทึก" + ความพร้อม (บัญชีบุคลากรที่เคยเข้าสู่ระบบแล้ว) */
  write_policy: async function (params, ctx) {
    await requireCap(ctx, 'manage_users');
    const db = ctx.db, users = (await readAll(db, 'TT_USER')).filter(function (u) { return String(u.active) !== '0' && ['admin', 'academic', 'teacher'].indexOf(u.role) >= 0; });
    return { required: String((await getSetting(db, 'staff_login_required')) || '') === '1', writers: users.length,
      signed_in: users.filter(function (u) { return !!u.last_login; }).length,
      never: users.filter(function (u) { return !u.last_login; }).map(function (u) { return u.display_name || u.username; }).sort(function (a, b) { return a.localeCompare(b, 'th'); }) };
  },
  /** เปิด/ปิดสวิตช์ · params { required: true|false } — เปิดแล้ว: บันทึกทุกเมนูต้องเข้าสู่ระบบ, PIN ธนาคาร/ตั้งค่าใช้ไม่ได้ */
  write_policy_save: async function (params, ctx) {
    const me = await requireCap(ctx, 'manage_users');
    const v = params.required === true ? '1' : '0';
    await upsert(ctx.db, 'SETTINGS', { key: 'staff_login_required', value: v, updated_at: now(), updated_by: me.username });
    return { required: v === '1' };
  },

  /**
   * ประวัติการบันทึก (WRITE_LOG) — ผู้ดูแล/ฝ่ายวิชาการ (audit_view)
   * params { from:'YYYY-MM-DD', to, user_id? ('-' = ไม่ได้เข้าสู่ระบบ), module?, limit? (≤500), before? (cursor "at|log_id") }
   * → { rows[{log_id, at, user_id, user_name, role, module, action, ref_date, grade, room, n, target, target_label, detail}], next, by_user[], by_module[], users[] }
   * เป้าหมายที่เป็นเลขประจำตัวนักเรียน → แสดงชื่อ+ชั้นแทน (ไม่ส่งเลขประจำตัว) · user_id → ชื่อบัญชี
   */
  write_log_list: async function (params, ctx) {
    await requireCap(ctx, 'audit_view');
    const db = ctx.db, ymd = /^\d{4}-\d{2}-\d{2}$/;
    const from = ymd.test(String(params.from || '')) ? String(params.from) : '0000-00-00';
    const to = ymd.test(String(params.to || '')) ? String(params.to) : '9999-12-31';
    const where = ['at >= ?', 'at <= ?'], binds = [from + 'T00:00:00', to + 'T23:59:59'];
    if (params.module) { where.push('module = ?'); binds.push(String(params.module)); }
    const base = where.slice(), baseB = binds.slice();     // สรุปใช้ช่วงวันที่ + เมนู (ไม่กรองผู้ใช้)
    if (params.user_id === '-') where.push("(user_id IS NULL OR user_id = '')");
    else if (params.user_id) { where.push('user_id = ?'); binds.push(String(params.user_id)); }
    const m = /^(.{19})\|(.+)$/.exec(String(params.before || ''));
    if (m) { where.push('(at < ? OR (at = ? AND log_id < ?))'); binds.push(m[1], m[1], m[2]); }
    const limit = Math.max(1, Math.min(500, Number(params.limit) || 200));
    const q = function (sql, b) { const st = db.prepare(sql); return st.bind.apply(st, b).all().then(function (r) { return r.results || []; }); };
    const [rows, byUser, byMod, users] = await Promise.all([
      q('SELECT * FROM WRITE_LOG WHERE ' + where.join(' AND ') + ' ORDER BY at DESC, log_id DESC LIMIT ' + (limit + 1), binds),
      m ? Promise.resolve(null) : q("SELECT COALESCE(user_id, '') AS user_id, MAX(user_name) AS user_name, COUNT(*) AS n FROM WRITE_LOG WHERE " + base.join(' AND ') + " GROUP BY COALESCE(user_id, '') ORDER BY n DESC", baseB),
      m ? Promise.resolve(null) : q('SELECT module, COUNT(*) AS n FROM WRITE_LOG WHERE ' + base.join(' AND ') + ' GROUP BY module ORDER BY n DESC', baseB),
      readAll(db, 'TT_USER'),
    ]);
    const more = rows.length > limit; if (more) rows.pop();
    const U = {}; users.forEach(function (u) { U[u.user_id] = u.display_name || u.username; });
    // ชื่อนักเรียนของเป้าหมาย (เลขประจำตัว) — ไม่ส่งเลขประจำตัวออกไป
    const ids = rows.map(function (r) { return r.target; }).filter(function (t, i, a) { return t && !U[t] && /^[0-9A-Z]\d{12}$/.test(t) && a.indexOf(t) === i; });
    const S = {};
    for (let i = 0; i < ids.length; i += 90) {
      const part = ids.slice(i, i + 90), st = db.prepare('SELECT citizen_id, prefix, first_name, last_name, grade, room FROM STUDENTS WHERE citizen_id IN (' + part.map(function () { return '?'; }).join(',') + ')');
      ((await st.bind.apply(st, part).all()).results || []).forEach(function (x) { S[x.citizen_id] = normName((x.prefix || '') + (x.first_name || '') + ' ' + (x.last_name || '')) + ' (' + (x.grade || '') + (x.room ? '/' + x.room : '') + ')'; });
    }
    const out = rows.map(function (r) {
      const t = r.target || '', isCid = !!S[t] || (/^[0-9A-Z]\d{12}$/.test(t) && !U[t]);
      let detail = null; try { detail = r.detail ? JSON.parse(r.detail) : null; } catch (e) { detail = null; }
      return { log_id: r.log_id, at: r.at, user_id: r.user_id || '', user_name: r.user_name || '', role: r.role || '', module: r.module, action: r.action,
        ref_date: r.ref_date || '', grade: r.grade || '', room: r.room || '', n: Number(r.n) || 0,
        target: isCid ? '' : t, target_label: S[t] || (U[t] ? '👤 ' + U[t] : (isCid ? '(นักเรียนที่ไม่มีในระบบแล้ว)' : '')), detail: detail };
    });
    const last = out[out.length - 1];
    return { rows: out, next: more && last ? last.at + '|' + last.log_id : '', by_user: byUser, by_module: byMod,
      users: users.filter(function (u) { return STAFF_ROLES.indexOf(u.role) >= 0; }).map(function (u) { return { user_id: u.user_id, name: u.display_name || u.username }; })
        .sort(function (a, b) { return a.name.localeCompare(b.name, 'th'); }) };
  },

  teacher_accounts: async function (params, ctx) {
    await requireCap(ctx, 'manage_users');
    const db = ctx.db, term = await activeTerm(db);
    const teachers = (await selectWhere(db, 'TT_TEACHER', 'term_id', term)).filter(function (t) { return String(t.active) !== '0'; });
    const users = (await readAll(db, 'TT_USER')).filter(function (u) { return u.teacher_id; });
    const linkedRows = {};
    for (const u of users) { const t = await getBy(db, 'TT_TEACHER', 'teacher_id', String(u.teacher_id)); if (t) linkedRows[u.user_id] = t; }
    return { term: term, teachers: teachers.map(function (t) {
      const u = users.find(function (x) { return sameTeacher(t, linkedRows[x.user_id]); });
      return { teacher_id: t.teacher_id, code: t.code || '', name: normName((t.title || '') + ' ' + (t.name || '')) || t.name || '',
        user: u ? { user_id: u.user_id, username: u.username, active: String(u.active) !== '0', current: u.teacher_id === t.teacher_id } : null };
    }) };
  },

  /**
   * สร้างบัญชีครู 1 คนจากรายชื่อครูในตารางสอน (หน้าเว็บเรียกทีละคน — PBKDF2 ใช้ CPU มาก)
   * ชื่อผู้ใช้ = รหัสครู (ถ้าใช้ได้) ไม่งั้น t01, t02, … · รหัสผ่านเริ่มต้นสุ่ม คืนให้ครั้งเดียว · ถ้าบัญชีผูกครูภาคก่อนอยู่ → ผูกภาคนี้ให้แทน
   */
  user_create_teacher: async function (params, ctx) {
    const me = await requireCap(ctx, 'manage_users');
    const db = ctx.db;
    const t = params.teacher_id ? await getBy(db, 'TT_TEACHER', 'teacher_id', String(params.teacher_id)) : null;
    if (!t) apiError('NOT_FOUND', 'ไม่พบครูในตารางสอน');
    const all = await readAll(db, 'TT_USER');
    for (const u of all.filter(function (x) { return x.teacher_id; })) {
      const lt = u.teacher_id === t.teacher_id ? t : await getBy(db, 'TT_TEACHER', 'teacher_id', String(u.teacher_id));
      if (!sameTeacher(t, lt)) continue;
      if (u.teacher_id !== t.teacher_id) {
        await updateWhere(db, 'TT_USER', 'user_id', u.user_id, { teacher_id: t.teacher_id, updated_at: now() });
        await log(db, 'RELINK_TEACHER', u.user_id, me.username, { teacher_id: t.teacher_id });
      }
      return { existed: true, user_id: u.user_id, username: u.username };
    }
    const taken = {}; all.forEach(function (u) { taken[u.username] = 1; });
    let username = normUser(t.code);
    if (!validUsername(username) || taken[username]) {
      for (let i = 1; i < 1000; i++) { const c = 't' + (i < 10 ? '0' : '') + i; if (!taken[c]) { username = c; break; } }
    }
    const password = initialPassword();
    const uid = genId('USR');
    const display = normName((t.title || '') + ' ' + (t.name || '')).slice(0, 60) || username;
    await insertRows(db, 'TT_USER', [{ user_id: uid, username: username, display_name: display, role: 'teacher', password_hash: await hashPassword(password),
      teacher_id: t.teacher_id, class_id: '', active: '1', failed_count: 0, created_at: now(), updated_at: now() }]);
    await log(db, 'CREATE', uid, me.username, { role: 'teacher', active: '1', from_teacher: t.teacher_id });
    return { existed: false, user_id: uid, username: username, display_name: display, password: password };
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
