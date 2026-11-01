/**
 * แผนที่บ้านนักเรียน — พิกัดบ้าน · วิธีเดินทาง · ระยะทางถนนจริง · ลิงก์ผู้ปกครอง · จุดเสี่ยง · ตั้งค่า
 * ข้อมูลอ่อนไหว (ตำแหน่งบ้านเด็ก) → คำสั่งทั้งหมดต้องเข้าสู่ระบบด้วยบัญชีบุคลากร (tt-auth.js) ยกเว้น link_info/link_submit
 * ที่ใช้ token ลิงก์ผู้ปกครอง (สุ่ม 256 บิต · เก็บเฉพาะ SHA-256 · ใช้ครั้งเดียว · หมดอายุ)
 *   geo       : ดูแผนที่ (ผู้ดูแล · ผู้บริหาร · ฝ่ายวิชาการ · ครู)
 *   geo_edit  : บันทึกพิกัด/วิธีเดินทาง · สร้างลิงก์ผู้ปกครอง · จุดเสี่ยง (ผู้ดูแล · ฝ่ายวิชาการ · ครู)
 *   geo_admin : ตั้งพิกัดโรงเรียน/ความเร็วเฉลี่ย/ขอบเขตการมองเห็นของครู/เกณฑ์บ้านไกล (ผู้ดูแล)
 * ครู: ถ้าตั้ง teacher_scope = 'homeroom' เห็น/แก้ได้เฉพาะนักเรียนชั้นที่ตนเป็นครูประจำชั้น (TT_CLASS ของภาคเรียนปัจจุบัน)
 * เขียนเฉพาะ GEO_* · อ่าน STUDENTS / TT_CLASS / SETTINGS แบบอ่านอย่างเดียว (ชั้นเรียนอ่านสดทุกครั้ง → ตามการเลื่อนชั้นอัตโนมัติ)
 */
import { readAll, getBy, selectWhere, insertRows, upsert, updateWhere, deleteWhere, now, genId, apiError } from '../db.js';
import { requireCap } from './tt-auth.js';
import { getSetting } from './settings.js';

const DEFAULT_SPEEDS = { walk: 4, moto: 35, car: 40, road_factor: 1.3 };   // กม./ชม. · ระยะถนน ≈ เส้นตรง × road_factor
const SPEED_RANGE = { walk: [1, 10], moto: [5, 90], car: [5, 120], road_factor: [1, 3] };
const DEFAULT_OPTIONS = { teacher_scope: 'homeroom', far_km: 3 };          // ครูเห็นเฉพาะชั้นตัวเอง · เกณฑ์ "บ้านไกล"
const MODES = ['walk', 'bicycle', 'moto_parent', 'car_parent', 'school_van', 'public', 'dorm', 'other'];
const POINT_TYPES = ['road', 'river', 'flood', 'animal', 'construction', 'other'];
const LINK_DAYS = 14;

function parse(v, def) { try { return v ? JSON.parse(v) : def; } catch (e) { return def; } }
async function getConf(db, key, def) { const r = await getBy(db, 'GEO_CONFIG', 'key', key); return r ? parse(r.value, def) : def; }
async function options(db) { return Object.assign({}, DEFAULT_OPTIONS, await getConf(db, 'options', {})); }
async function speeds(db) { return Object.assign({}, DEFAULT_SPEEDS, await getConf(db, 'speeds', {})); }
function num(v) { return v != null && v !== '' && isFinite(Number(v)) ? Number(v) : null; }
function plusDays(d) { return new Date(Date.now() + 7 * 3600 * 1000 + d * 86400000).toISOString().slice(0, 19); }
async function sha256hex(s) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return Array.prototype.map.call(new Uint8Array(buf), function (b) { return ('0' + b.toString(16)).slice(-2); }).join('');
}
function homeOut(h) {
  return h ? { lat: Number(h.lat), lng: Number(h.lng), accuracy: num(h.accuracy), source: h.source || '', note: h.note || '', updated_by: h.updated_by || '', updated_at: h.updated_at || '',
    road_km: num(h.road_km), road_walk_min: num(h.road_walk_min), road_car_min: num(h.road_car_min), road_at: h.road_at || '' } : null;
}
function studentOut(s, h, t) {
  return { citizen_id: String(s.citizen_id), student_code: s.student_code || '', prefix: s.prefix || '', first_name: s.first_name || '', last_name: s.last_name || '',
    gender: s.gender || '', grade: s.grade || '', room: s.room != null ? String(s.room) : '', address: s.address || '',
    guardian_name: s.guardian_name || '', guardian_phone: s.guardian_phone || '', home: homeOut(h), travel: t ? t.mode : '' };
}
function checkLatLng(lat, lng) {
  if (!isFinite(lat) || !isFinite(lng) || lat < -90 || lat > 90 || lng < -180 || lng > 180) apiError('VALIDATION', 'พิกัดไม่ถูกต้อง');
}
const r6 = function (x) { return Math.round(x * 1e6) / 1e6; };

/**
 * (5) ขอบเขตนักเรียนที่ผู้ใช้นี้เห็นได้ → null = ทั้งโรงเรียน · { keys:{'ชั้น|ห้อง':1}, labels:[] } = เฉพาะชั้นครูประจำชั้น
 * ใช้กับครูเมื่อ teacher_scope = 'homeroom' · ห้องจาก TT_CLASS ภาคเรียนปัจจุบันที่ homeroom_teacher_id = บัญชีที่ผูกครูไว้
 */
async function scopeOf(db, u) {
  if (u.role !== 'teacher') return null;
  if ((await options(db)).teacher_scope !== 'homeroom') return null;
  const term = String((await getSetting(db, 'current_year')) || '').trim() + '-' + String((await getSetting(db, 'current_semester')) || '1').trim();
  const keys = {}, labels = [];
  if (u.teacher_id) {
    (await selectWhere(db, 'TT_CLASS', 'term_id', term)).forEach(function (c) {
      if (String(c.active) === '0' || c.homeroom_teacher_id !== u.teacher_id) return;
      keys[classKey(c.grade, c.room)] = 1;
      labels.push(c.grade + (c.room ? '/' + c.room : ''));
    });
  }
  return { keys: keys, labels: labels };
}
/** ห้องว่าง/0 ถือเป็นห้อง 1 (ข้อมูลนักเรียนบางชั้นไม่ได้กรอกห้อง) */
function classKey(grade, room) { const r = String(room == null ? '' : room).trim(); return String(grade || '').trim() + '|' + (r === '' || r === '0' ? '1' : r); }
function inScope(scope, s) { return !scope || !!scope.keys[classKey(s.grade, s.room)]; }
/** ตรวจว่านักเรียนมีจริง กำลังศึกษา และอยู่ในขอบเขตของผู้ใช้ */
async function studentFor(db, u, cid) {
  const s = cid ? await getBy(db, 'STUDENTS', 'citizen_id', String(cid)) : null;
  if (!s) apiError('NOT_FOUND', 'ไม่พบนักเรียน');
  if (!inScope(await scopeOf(db, u), s)) apiError('FORBIDDEN', 'ดู/แก้ได้เฉพาะนักเรียนในชั้นที่เป็นครูประจำชั้น');
  return s;
}

export const GeoAPI = {

  /** ข้อมูลทั้งหน้าแผนที่ (เฉพาะนักเรียนในขอบเขตของผู้ใช้) */
  bootstrap: async function (params, ctx) {
    const u = await requireCap(ctx, 'geo');
    const db = ctx.db;
    const scope = await scopeOf(db, u);
    const homes = {}, travel = {};
    (await readAll(db, 'GEO_HOME')).forEach(function (h) { homes[String(h.citizen_id)] = h; });
    (await readAll(db, 'GEO_TRAVEL')).forEach(function (t) { travel[String(t.citizen_id)] = t; });
    const students = (await readAll(db, 'STUDENTS')).filter(function (s) { return s.status !== 'inactive' && inScope(scope, s); })
      .map(function (s) { return studentOut(s, homes[String(s.citizen_id)], travel[String(s.citizen_id)]); });
    return {
      school: await getConf(db, 'school', null), speeds: await speeds(db), options: await options(db),
      points: (await readAll(db, 'GEO_POINT')).map(function (p) { return Object.assign({}, p, { lat: Number(p.lat), lng: Number(p.lng), radius_m: num(p.radius_m) }); }),
      students: students,
      scope: scope ? { limited: true, classes: scope.labels } : { limited: false },
    };
  },

  home: async function (params, ctx) {
    const u = await requireCap(ctx, 'geo');
    const db = ctx.db;
    const s = await studentFor(db, u, params.citizen_id);
    return { student: studentOut(s, await getBy(db, 'GEO_HOME', 'citizen_id', String(s.citizen_id)), await getBy(db, 'GEO_TRAVEL', 'citizen_id', String(s.citizen_id))),
      school: await getConf(db, 'school', null), speeds: await speeds(db) };
  },

  /** บันทึกพิกัดบ้าน (+ วิธีเดินทางถ้าส่งมา) — ล้างระยะถนนจริงที่เก็บไว้ (พิกัดเปลี่ยน) */
  save_home: async function (params, ctx) {
    const u = await requireCap(ctx, 'geo_edit');
    const db = ctx.db;
    const s = await studentFor(db, u, params.citizen_id);
    const lat = Number(params.lat), lng = Number(params.lng);
    checkLatLng(lat, lng);
    const acc = num(params.accuracy) != null ? Math.round(Number(params.accuracy)) : null;
    const source = ['gps', 'map', 'manual', 'parent'].indexOf(params.source) >= 0 ? params.source : 'map';
    const row = { citizen_id: String(s.citizen_id), lat: r6(lat), lng: r6(lng), accuracy: acc, source: source, note: String(params.note || '').trim().slice(0, 200),
      updated_by: u.username, updated_at: now(), road_km: null, road_walk_min: null, road_car_min: null, road_at: '' };
    await upsert(db, 'GEO_HOME', row);
    if (params.travel !== undefined) await saveTravel(db, u, s.citizen_id, params.travel);
    return { home: homeOut(row) };
  },

  delete_home: async function (params, ctx) {
    const u = await requireCap(ctx, 'geo_edit');
    const s = await studentFor(ctx.db, u, params.citizen_id);
    await deleteWhere(ctx.db, 'GEO_HOME', 'citizen_id', String(s.citizen_id));
    return { ok: true };
  },

  /** (2) วิธีเดินทางมาโรงเรียน — params = { citizen_id, mode ('' = ล้าง) } */
  save_travel: async function (params, ctx) {
    const u = await requireCap(ctx, 'geo_edit');
    const s = await studentFor(ctx.db, u, params.citizen_id);
    await saveTravel(ctx.db, u, s.citizen_id, params.mode);
    return { mode: params.mode || '' };
  },

  /** (3) เก็บระยะทาง/เวลาตามถนนจริง (คำนวณจาก OSRM ที่หน้าเว็บ) — params = { items:[{citizen_id, road_km, walk_min, car_min}] } */
  save_road: async function (params, ctx) {
    const u = await requireCap(ctx, 'geo_edit');
    const db = ctx.db;
    const items = Array.isArray(params.items) ? params.items.slice(0, 50) : [];
    if (!items.length) apiError('VALIDATION', 'ไม่มีข้อมูล');
    const scope = await scopeOf(db, u), ts = now();
    let n = 0;
    for (const it of items) {
      const km = num(it.road_km), w = num(it.walk_min), c = num(it.car_min);
      if (km == null || km < 0 || km > 500) continue;
      const s = await getBy(db, 'STUDENTS', 'citizen_id', String(it.citizen_id || ''));
      if (!s || !inScope(scope, s) || !(await getBy(db, 'GEO_HOME', 'citizen_id', String(s.citizen_id)))) continue;
      await updateWhere(db, 'GEO_HOME', 'citizen_id', String(s.citizen_id), { road_km: Math.round(km * 100) / 100, road_walk_min: w != null ? Math.round(w) : null, road_car_min: c != null ? Math.round(c) : null, road_at: ts });
      n++;
    }
    return { saved: n };
  },

  /** (4) สร้างลิงก์ให้ผู้ปกครองส่งพิกัดเอง — params = { citizen_ids:[], days? } → token (แสดงครั้งเดียว) */
  link_create: async function (params, ctx) {
    const u = await requireCap(ctx, 'geo_edit');
    const db = ctx.db;
    const ids = Array.isArray(params.citizen_ids) ? params.citizen_ids.slice(0, 200) : [];
    if (!ids.length) apiError('VALIDATION', 'เลือกนักเรียนอย่างน้อย 1 คน');
    const days = Math.min(60, Math.max(1, Math.round(Number(params.days) || LINK_DAYS)));
    const scope = await scopeOf(db, u), ts = now(), exp = plusDays(days), rows = [], out = [];
    for (const cid of ids) {
      const s = await getBy(db, 'STUDENTS', 'citizen_id', String(cid));
      if (!s || s.status === 'inactive' || !inScope(scope, s)) continue;
      const token = crypto.randomUUID().replace(/-/g, '') + crypto.randomUUID().replace(/-/g, '');
      rows.push({ token_hash: await sha256hex(token), citizen_id: String(s.citizen_id), created_by: u.username, created_at: ts, expires_at: exp, used_at: '' });
      out.push({ citizen_id: String(s.citizen_id), token: token });
    }
    if (!rows.length) apiError('VALIDATION', 'ไม่มีนักเรียนที่สร้างลิงก์ได้');
    // ลิงก์เดิมของนักเรียนคนเดียวกันที่ยังไม่ใช้ → ยกเลิก (ใช้ได้เฉพาะลิงก์ล่าสุด)
    const stmts = rows.map(function (r) { return db.prepare("DELETE FROM GEO_LINK WHERE citizen_id=? AND COALESCE(used_at,'')=''").bind(r.citizen_id); });
    await db.batch(stmts);
    await insertRows(db, 'GEO_LINK', rows);
    return { expires_at: exp, links: out };
  },

  /** (4) สาธารณะ: ข้อมูลที่หน้าลิงก์ต้องใช้ — เปิดเผยเฉพาะชื่อเล่น/ชื่อจริงและชั้น (ไม่มีนามสกุล/ที่อยู่/พิกัดเดิม) */
  link_info: async function (params, ctx) {
    const l = await linkRow(ctx.db, params.token);
    const s = await getBy(ctx.db, 'STUDENTS', 'citizen_id', l.citizen_id);
    if (!s) apiError('NOT_FOUND', 'ลิงก์ไม่ถูกต้อง');
    const school = await getConf(ctx.db, 'school', null);
    return { first_name: s.first_name || '', grade: s.grade || '', room: s.room != null ? String(s.room) : '', school: school ? { lat: school.lat, lng: school.lng, name: school.name || '' } : null,
      school_name: (await getSetting(ctx.db, 'school_name')) || '', expires_at: l.expires_at };
  },

  /** (4) สาธารณะ: ผู้ปกครองส่งพิกัด — ใช้ token ได้ครั้งเดียว · บันทึกเป็น source 'parent' (ครูตรวจสอบได้บนแผนที่) */
  link_submit: async function (params, ctx) {
    const db = ctx.db;
    const l = await linkRow(db, params.token);
    const lat = Number(params.lat), lng = Number(params.lng);
    checkLatLng(lat, lng);
    const acc = num(params.accuracy) != null ? Math.round(Number(params.accuracy)) : null;
    const ts = now();
    await upsert(db, 'GEO_HOME', { citizen_id: l.citizen_id, lat: r6(lat), lng: r6(lng), accuracy: acc, source: 'parent', note: String(params.note || '').trim().slice(0, 200),
      updated_by: 'ผู้ปกครอง (ลิงก์)', updated_at: ts, road_km: null, road_walk_min: null, road_car_min: null, road_at: '' });
    if (params.travel && MODES.indexOf(params.travel) >= 0) await upsert(db, 'GEO_TRAVEL', { citizen_id: l.citizen_id, mode: params.travel, updated_by: 'ผู้ปกครอง (ลิงก์)', updated_at: ts });
    await updateWhere(db, 'GEO_LINK', 'token_hash', l.token_hash, { used_at: ts });
    return { ok: true };
  },

  /** (6) จุดเสี่ยง — params = { point_id?, type, name, note?, lat, lng, radius_m? } */
  point_save: async function (params, ctx) {
    const u = await requireCap(ctx, 'geo_edit');
    const lat = Number(params.lat), lng = Number(params.lng);
    checkLatLng(lat, lng);
    const name = String(params.name || '').trim().slice(0, 80);
    if (!name) apiError('VALIDATION', 'กรุณาตั้งชื่อจุดเสี่ยง');
    const radius = Math.min(2000, Math.max(20, Math.round(Number(params.radius_m) || 150)));
    const row = { point_id: params.point_id ? String(params.point_id) : genId('GPT'), type: POINT_TYPES.indexOf(params.type) >= 0 ? params.type : 'other', name: name,
      note: String(params.note || '').trim().slice(0, 300), lat: r6(lat), lng: r6(lng), radius_m: radius, updated_by: u.username, updated_at: now() };
    await upsert(ctx.db, 'GEO_POINT', row);
    return { point: row };
  },
  point_delete: async function (params, ctx) {
    await requireCap(ctx, 'geo_edit');
    if (!params.point_id) apiError('VALIDATION', 'ไม่ได้ระบุจุด');
    await deleteWhere(ctx.db, 'GEO_POINT', 'point_id', String(params.point_id));
    return { ok: true };
  },

  /** ตั้งค่า — params = { school?:{lat,lng,name}, speeds?:{...}, options?:{ teacher_scope:'all'|'homeroom', far_km } } */
  save_config: async function (params, ctx) {
    const u = await requireCap(ctx, 'geo_admin');
    const db = ctx.db, ts = now(), out = {};
    if (params.school) {
      const lat = Number(params.school.lat), lng = Number(params.school.lng);
      checkLatLng(lat, lng);
      out.school = { lat: r6(lat), lng: r6(lng), name: String(params.school.name || '').trim().slice(0, 80) };
      await upsert(db, 'GEO_CONFIG', { key: 'school', value: JSON.stringify(out.school), updated_by: u.username, updated_at: ts });
      // พิกัดโรงเรียนเปลี่ยน → ระยะถนนจริงที่เก็บไว้ใช้ไม่ได้แล้ว
      await db.prepare("UPDATE GEO_HOME SET road_km=NULL, road_walk_min=NULL, road_car_min=NULL, road_at=''").run();
    }
    if (params.speeds) {
      const sp = await speeds(db);
      Object.keys(SPEED_RANGE).forEach(function (k) {
        if (params.speeds[k] === undefined) return;
        const n = Number(params.speeds[k]);
        if (!isFinite(n) || n < SPEED_RANGE[k][0] || n > SPEED_RANGE[k][1]) apiError('VALIDATION', 'ค่า ' + k + ' ต้องอยู่ระหว่าง ' + SPEED_RANGE[k][0] + '–' + SPEED_RANGE[k][1]);
        sp[k] = n;
      });
      out.speeds = sp;
      await upsert(db, 'GEO_CONFIG', { key: 'speeds', value: JSON.stringify(sp), updated_by: u.username, updated_at: ts });
    }
    if (params.options) {
      const op = await options(db);
      if (params.options.teacher_scope !== undefined) {
        if (['all', 'homeroom'].indexOf(params.options.teacher_scope) < 0) apiError('VALIDATION', 'ขอบเขตครูไม่ถูกต้อง');
        op.teacher_scope = params.options.teacher_scope;
      }
      if (params.options.far_km !== undefined) {
        const f = Number(params.options.far_km);
        if (!isFinite(f) || f < 0.5 || f > 50) apiError('VALIDATION', 'เกณฑ์บ้านไกลต้องอยู่ระหว่าง 0.5–50 กม.');
        op.far_km = f;
      }
      out.options = op;
      await upsert(db, 'GEO_CONFIG', { key: 'options', value: JSON.stringify(op), updated_by: u.username, updated_at: ts });
    }
    if (!Object.keys(out).length) apiError('VALIDATION', 'ไม่มีข้อมูลที่จะบันทึก');
    return out;
  },
};

async function saveTravel(db, u, cid, mode) {
  if (!mode) { await deleteWhere(db, 'GEO_TRAVEL', 'citizen_id', String(cid)); return; }
  if (MODES.indexOf(mode) < 0) apiError('VALIDATION', 'วิธีเดินทางไม่ถูกต้อง');
  await upsert(db, 'GEO_TRAVEL', { citizen_id: String(cid), mode: mode, updated_by: u.username, updated_at: now() });
}
async function linkRow(db, token) {
  if (!token || typeof token !== 'string' || token.length < 32) apiError('NOT_FOUND', 'ลิงก์ไม่ถูกต้อง');
  const l = await getBy(db, 'GEO_LINK', 'token_hash', await sha256hex(token));
  if (!l) apiError('NOT_FOUND', 'ลิงก์ไม่ถูกต้องหรือถูกยกเลิกแล้ว — ขอลิงก์ใหม่จากครู');
  if (l.used_at) apiError('LINK_USED', 'ลิงก์นี้ใช้ส่งพิกัดไปแล้ว — ถ้าต้องการแก้ ขอลิงก์ใหม่จากครู');
  if (String(l.expires_at) < now()) apiError('LINK_EXPIRED', 'ลิงก์หมดอายุแล้ว — ขอลิงก์ใหม่จากครู');
  return l;
}
