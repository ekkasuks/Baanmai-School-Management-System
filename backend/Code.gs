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
function routerMap() {
  return {
    auth: AuthAPI,
    settings: SettingsAPI,
    students: StudentsAPI,
    bank: BankAPI,
    behavior: BehaviorAPI,
    health: HealthAPI,
    growth: GrowthAPI,
    scholarship: ScholarshipAPI,
    attendance: AttendanceAPI,
    milk: MilkAPI,
    scout: ScoutAPI,
    dashboard: DashboardAPI,
  };
}

function handle(req) {
  const { action, token, params } = req || {};
  if (!action) return jsonResponse(false, null, { code: 'VALIDATION', message: 'ไม่ได้ระบุ action' });

  // รวมหลายคำสั่งใน request เดียว — ลด round trip (Apps Script มี overhead ต่อครั้งสูง)
  if (action === 'batch') return handleBatch(params, token);

  const [moduleName, methodName] = String(action).split('.');
  const router = routerMap();

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

/**
 * batch — เรียกหลาย action ในคำขอเดียว
 * params = { calls: [{ action, params }, ...] }  (สูงสุด 10 รายการ)
 * คืน { results: [{ ok, data, error }, ...] } เรียงตามลำดับที่ส่งมา
 * แต่ละรายการล้มเหลวได้อิสระ ไม่ทำให้ทั้ง batch พัง
 */
function handleBatch(params, token) {
  const calls = params && params.calls;
  if (!Array.isArray(calls) || !calls.length) {
    return jsonResponse(false, null, { code: 'VALIDATION', message: 'batch ต้องมี calls อย่างน้อย 1 รายการ' });
  }
  if (calls.length > 10) {
    return jsonResponse(false, null, { code: 'VALIDATION', message: 'batch ได้สูงสุด 10 รายการต่อครั้ง' });
  }

  const router = routerMap();
  const results = calls.map(function (c) {
    const act = String((c && c.action) || '');
    const parts = act.split('.');
    const mod = router[parts[0]];
    if (!mod || typeof mod[parts[1]] !== 'function') {
      return { ok: false, data: null, error: { code: 'NOT_FOUND', message: 'ไม่รู้จักคำสั่ง: ' + act } };
    }
    try {
      const data = mod[parts[1]]((c && c.params) || {}, { token: token, action: act });
      return { ok: true, data: data, error: null };
    } catch (err) {
      console.error('[batch ' + act + ']', err && err.stack ? err.stack : err);
      return {
        ok: false, data: null,
        error: { code: (err && err.code) || 'INTERNAL', message: (err && err.message) || String(err) },
      };
    }
  });

  return jsonResponse(true, { results: results });
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
