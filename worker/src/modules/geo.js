/**
 * แผนที่บ้านนักเรียน — พิกัดบ้าน · พิกัดโรงเรียน · ความเร็วเฉลี่ยสำหรับประมาณเวลาเดินทาง
 * ข้อมูลอ่อนไหว (ตำแหน่งบ้านเด็ก) → ทุกคำสั่งต้องเข้าสู่ระบบด้วยบัญชีผู้ใช้ (ระบบเดียวกับจัดตารางสอน — tt-auth.js)
 *   geo       : ดูแผนที่ (ผู้ดูแล · ผู้บริหาร · ฝ่ายวิชาการ · ครู)
 *   geo_edit  : บันทึก/ลบพิกัดบ้าน (ผู้ดูแล · ฝ่ายวิชาการ · ครู — เช่น ตอนเยี่ยมบ้าน)
 *   geo_admin : ตั้งพิกัดโรงเรียน/ความเร็วเฉลี่ย (ผู้ดูแล)
 * เขียนเฉพาะ GEO_HOME / GEO_CONFIG · อ่าน STUDENTS แบบอ่านอย่างเดียว (ชั้นเรียนอ่านสดทุกครั้ง → ตามการเลื่อนชั้นอัตโนมัติ)
 */
import { readAll, getBy, upsert, deleteWhere, now, apiError } from '../db.js';
import { requireCap } from './tt-auth.js';

const DEFAULT_SPEEDS = { walk: 4, moto: 35, car: 40, road_factor: 1.3 };   // กม./ชม. · ระยะทางถนน ≈ เส้นตรง × road_factor
const SPEED_RANGE = { walk: [1, 10], moto: [5, 90], car: [5, 120], road_factor: [1, 3] };

function parse(v, def) { try { return v ? JSON.parse(v) : def; } catch (e) { return def; } }
async function getConf(db, key, def) { const r = await getBy(db, 'GEO_CONFIG', 'key', key); return r ? parse(r.value, def) : def; }
function homeOut(h) {
  return h ? { lat: Number(h.lat), lng: Number(h.lng), accuracy: h.accuracy != null && h.accuracy !== '' ? Number(h.accuracy) : null, source: h.source || '', note: h.note || '', updated_by: h.updated_by || '', updated_at: h.updated_at || '' } : null;
}
function studentOut(s, h) {
  return { citizen_id: String(s.citizen_id), student_code: s.student_code || '', prefix: s.prefix || '', first_name: s.first_name || '', last_name: s.last_name || '',
    gender: s.gender || '', grade: s.grade || '', room: s.room != null ? String(s.room) : '', address: s.address || '',
    guardian_name: s.guardian_name || '', guardian_phone: s.guardian_phone || '', home: homeOut(h) };
}
function checkLatLng(lat, lng) {
  if (!isFinite(lat) || !isFinite(lng) || lat < -90 || lat > 90 || lng < -180 || lng > 180) apiError('VALIDATION', 'พิกัดไม่ถูกต้อง');
}

export const GeoAPI = {

  /** ข้อมูลทั้งหน้าแผนที่: พิกัดโรงเรียน + นักเรียนที่กำลังศึกษาทั้งหมด (พร้อมพิกัดบ้านถ้ามี) */
  bootstrap: async function (params, ctx) {
    await requireCap(ctx, 'geo');
    const db = ctx.db;
    const homes = {};
    (await readAll(db, 'GEO_HOME')).forEach(function (h) { homes[String(h.citizen_id)] = h; });
    const students = (await readAll(db, 'STUDENTS')).filter(function (s) { return s.status !== 'inactive'; })
      .map(function (s) { return studentOut(s, homes[String(s.citizen_id)]); });
    return {
      school: await getConf(db, 'school', null),
      speeds: Object.assign({}, DEFAULT_SPEEDS, await getConf(db, 'speeds', {})),
      students: students,
    };
  },

  /** นักเรียน 1 คน + พิกัดบ้าน + พิกัดโรงเรียน (หน้าข้อมูลนักเรียน) */
  home: async function (params, ctx) {
    await requireCap(ctx, 'geo');
    const db = ctx.db;
    const s = params.citizen_id ? await getBy(db, 'STUDENTS', 'citizen_id', String(params.citizen_id)) : null;
    if (!s) apiError('NOT_FOUND', 'ไม่พบนักเรียน');
    return { student: studentOut(s, await getBy(db, 'GEO_HOME', 'citizen_id', String(s.citizen_id))), school: await getConf(db, 'school', null),
      speeds: Object.assign({}, DEFAULT_SPEEDS, await getConf(db, 'speeds', {})) };
  },

  /** บันทึกพิกัดบ้าน — params = { citizen_id, lat, lng, accuracy?, source?, note? } */
  save_home: async function (params, ctx) {
    const u = await requireCap(ctx, 'geo_edit');
    const db = ctx.db;
    const s = params.citizen_id ? await getBy(db, 'STUDENTS', 'citizen_id', String(params.citizen_id)) : null;
    if (!s) apiError('NOT_FOUND', 'ไม่พบนักเรียน');
    const lat = Number(params.lat), lng = Number(params.lng);
    checkLatLng(lat, lng);
    const acc = params.accuracy != null && params.accuracy !== '' && isFinite(Number(params.accuracy)) ? Math.round(Number(params.accuracy)) : null;
    const source = ['gps', 'map', 'manual'].indexOf(params.source) >= 0 ? params.source : 'map';
    const row = { citizen_id: String(s.citizen_id), lat: Math.round(lat * 1e6) / 1e6, lng: Math.round(lng * 1e6) / 1e6, accuracy: acc, source: source,
      note: String(params.note || '').trim().slice(0, 200), updated_by: u.username, updated_at: now() };
    await upsert(db, 'GEO_HOME', row);
    return { home: homeOut(row) };
  },

  delete_home: async function (params, ctx) {
    await requireCap(ctx, 'geo_edit');
    if (!params.citizen_id) apiError('VALIDATION', 'ไม่ได้ระบุนักเรียน');
    await deleteWhere(ctx.db, 'GEO_HOME', 'citizen_id', String(params.citizen_id));
    return { ok: true };
  },

  /** ตั้งพิกัดโรงเรียน และ/หรือ ความเร็วเฉลี่ย — params = { school?:{lat,lng,name}, speeds?:{walk,moto,car,road_factor} } */
  save_config: async function (params, ctx) {
    const u = await requireCap(ctx, 'geo_admin');
    const db = ctx.db, ts = now(), out = {};
    if (params.school) {
      const lat = Number(params.school.lat), lng = Number(params.school.lng);
      checkLatLng(lat, lng);
      out.school = { lat: Math.round(lat * 1e6) / 1e6, lng: Math.round(lng * 1e6) / 1e6, name: String(params.school.name || '').trim().slice(0, 80) };
      await upsert(db, 'GEO_CONFIG', { key: 'school', value: JSON.stringify(out.school), updated_by: u.username, updated_at: ts });
    }
    if (params.speeds) {
      const sp = Object.assign({}, DEFAULT_SPEEDS);
      Object.keys(SPEED_RANGE).forEach(function (k) {
        if (params.speeds[k] === undefined) return;
        const n = Number(params.speeds[k]);
        if (!isFinite(n) || n < SPEED_RANGE[k][0] || n > SPEED_RANGE[k][1]) apiError('VALIDATION', 'ค่า ' + k + ' ต้องอยู่ระหว่าง ' + SPEED_RANGE[k][0] + '–' + SPEED_RANGE[k][1]);
        sp[k] = n;
      });
      out.speeds = sp;
      await upsert(db, 'GEO_CONFIG', { key: 'speeds', value: JSON.stringify(sp), updated_by: u.username, updated_at: ts });
    }
    if (!Object.keys(out).length) apiError('VALIDATION', 'ไม่มีข้อมูลที่จะบันทึก');
    return out;
  },
};
