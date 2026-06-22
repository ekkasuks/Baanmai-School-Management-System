/**
 * Baanmai School Management System — Main Router
 *
 * Web App entry point. รับ POST (JSON ส่งแบบ text/plain) → แยกไปยัง module.method
 * ทุก response อยู่ในรูป { ok, data, error }
 *
 * ตั้งค่า Script Property: SHEET_ID = id ของ Google Spreadsheet "BaanmaiSMS_DB"
 */

const SHEET_ID = PropertiesService.getScriptProperties().getProperty('SHEET_ID');

function doPost(e) {
  let req;
  try {
    req = JSON.parse(e.postData.contents);
  } catch (err) {
    return jsonResponse(false, null, { code: 'VALIDATION', message: 'รูปแบบข้อมูลไม่ถูกต้อง (JSON)' });
  }
  return handle(req);
}

function doGet(e) {
  if (e.parameter && e.parameter.action === 'ping') {
    return jsonResponse(true, { pong: true, time: now() });
  }
  return jsonResponse(false, null, { code: 'METHOD', message: 'ใช้ POST เท่านั้น' });
}

/** ตารางเส้นทาง — เพิ่ม module ใหม่ที่นี่เมื่อสร้าง Module ถัดไป */
function handle(req) {
  const { action, token, params } = req || {};
  if (!action) return jsonResponse(false, null, { code: 'VALIDATION', message: 'ไม่ได้ระบุ action' });

  const [moduleName, methodName] = String(action).split('.');
  const router = {
    auth: AuthAPI,
    settings: SettingsAPI,
    students: StudentsAPI,
    bank: BankAPI,
    behavior: BehaviorAPI,
    health: HealthAPI,
  };

  const mod = router[moduleName];
  if (!mod || typeof mod[methodName] !== 'function') {
    return jsonResponse(false, null, { code: 'NOT_FOUND', message: `ไม่รู้จักคำสั่ง: ${action}` });
  }

  try {
    const ctx = { token: token, action: action };
    const result = mod[methodName](params || {}, ctx);
    return jsonResponse(true, result);
  } catch (err) {
    console.error(`[${action}]`, err && err.stack ? err.stack : err);
    const code = err && err.code ? err.code : 'INTERNAL';
    const message = err && err.message ? err.message : String(err);
    return jsonResponse(false, null, { code: code, message: message });
  }
}

function jsonResponse(ok, data, error) {
  const body = { ok: ok, data: data || null, error: error || null };
  return ContentService
    .createTextOutput(JSON.stringify(body))
    .setMimeType(ContentService.MimeType.JSON);
}

/** โยน error พร้อม code เพื่อให้ response สะอาด */
function apiError(code, message) {
  const err = new Error(message);
  err.code = code;
  throw err;
}
