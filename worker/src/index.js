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
import { now } from './db.js';

const ROUTER = {
  settings: SettingsAPI,
  auth: AuthAPI,
  admin: AdminAPI,
  students: StudentsAPI,
  bank: BankAPI,
  behavior: BehaviorAPI,
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

    const parts = String(action).split('.');
    const mod = ROUTER[parts[0]];
    const method = mod && mod[parts[1]];
    if (typeof method !== 'function') {
      return json(false, null, { code: 'NOT_FOUND', message: 'ไม่รู้จักคำสั่ง: ' + action });
    }

    const ctx = { db: env.DB, env: env, token: req.token, action: action };
    try {
      const result = await method(req.params || {}, ctx);
      return json(true, result);
    } catch (err) {
      return json(false, null, { code: (err && err.code) || 'INTERNAL', message: (err && err.message) || String(err) });
    }
  },
};
