/**
 * Baanmai SMS — Cloudflare Worker API (แทน Google Apps Script)
 * contract เดิม: POST JSON { action:'module.method', token, params } → { ok, data, error }
 * frontend แค่เปลี่ยน API_URL มาที่ Worker นี้ (response รูปแบบเดิม)
 *
 * โมดูลที่พอร์ตแล้ว: settings, auth, admin(migration)
 * ถัดไป (ทยอยเพิ่ม): students, bank, behavior, attendance, health, growth, milk, scholarship, scout, dashboard
 */
import { SettingsAPI } from './modules/settings.js';
import { AuthAPI } from './modules/auth.js';
import { AdminAPI } from './modules/admin.js';
import { StudentsAPI } from './modules/students.js';
import { BankAPI } from './modules/bank.js';
import { BehaviorAPI } from './modules/behavior.js';
import { AttendanceAPI } from './modules/attendance.js';
import { HealthAPI } from './modules/health.js';
import { GrowthAPI } from './modules/growth.js';
import { MilkAPI } from './modules/milk.js';
import { ScholarshipAPI } from './modules/scholarship.js';
import { ScoutAPI } from './modules/scout.js';
import { DashboardAPI } from './modules/dashboard.js';
import { TimetableAPI } from './modules/timetable.js';
import { now } from './db.js';

const ROUTER = {
  settings: SettingsAPI,
  auth: AuthAPI,
  admin: AdminAPI,
  students: StudentsAPI,
  bank: BankAPI,
  behavior: BehaviorAPI,
  attendance: AttendanceAPI,
  health: HealthAPI,
  growth: GrowthAPI,
  milk: MilkAPI,
  scholarship: ScholarshipAPI,
  scout: ScoutAPI,
  dashboard: DashboardAPI,
  tt: TimetableAPI,          // ระบบจัดตารางสอน (ตาราง TT_* แยกจากข้อมูลเดิม)
};

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Max-Age': '86400',
};

function json(ok, data, error) {
  return new Response(JSON.stringify({ ok: ok, data: data || null, error: error || null }), {
    headers: Object.assign({ 'Content-Type': 'application/json;charset=utf-8' }, CORS),
  });
}

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });

    const url = new URL(request.url);
    if (request.method === 'GET') {
      if (url.searchParams.get('action') === 'ping') return json(true, { pong: true, time: now() });
      return json(false, null, { code: 'METHOD', message: 'ใช้ POST เท่านั้น' });
    }
    if (request.method !== 'POST') return json(false, null, { code: 'METHOD', message: 'ใช้ POST เท่านั้น' });

    let req;
    try { req = JSON.parse(await request.text()); }
    catch (e) { return json(false, null, { code: 'VALIDATION', message: 'รูปแบบข้อมูลไม่ถูกต้อง (JSON)' }); }

    const action = req && req.action;
    if (!action) return json(false, null, { code: 'VALIDATION', message: 'ไม่ได้ระบุ action' });

    const base = { db: env.DB, env: env, token: req.token };

    // batch — เรียกหลาย action ในคำขอเดียว (สูงสุด 10) · แต่ละรายการล้มเหลวอิสระ
    if (action === 'batch') {
      const calls = req.params && req.params.calls;
      if (!Array.isArray(calls) || !calls.length) return json(false, null, { code: 'VALIDATION', message: 'batch ต้องมี calls อย่างน้อย 1 รายการ' });
      if (calls.length > 10) return json(false, null, { code: 'VALIDATION', message: 'batch ได้สูงสุด 10 รายการต่อครั้ง' });
      const results = [];
      for (const c of calls) results.push(await runOne(String((c && c.action) || ''), (c && c.params) || {}, base));
      return json(true, { results: results });
    }

    const r = await runOne(action, req.params || {}, base);
    return new Response(JSON.stringify(r), {
      headers: Object.assign({ 'Content-Type': 'application/json;charset=utf-8' }, CORS),
    });
  },
};

/** dispatch 1 action → { ok, data, error } (ไม่ throw) */
async function runOne(action, params, base) {
  const parts = String(action).split('.');
  const mod = ROUTER[parts[0]];
  const method = mod && mod[parts[1]];
  if (typeof method !== 'function') {
    return { ok: false, data: null, error: { code: 'NOT_FOUND', message: 'ไม่รู้จักคำสั่ง: ' + action } };
  }
  try {
    const data = await method(params, { db: base.db, env: base.env, token: base.token, action: action });
    return { ok: true, data: data === undefined ? null : data, error: null };
  } catch (err) {
    return { ok: false, data: null, error: { code: (err && err.code) || 'INTERNAL', message: (err && err.message) || String(err) } };
  }
}
