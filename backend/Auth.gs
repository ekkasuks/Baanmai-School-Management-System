/**
 * Authentication — ตรวจ PIN + ออก session token
 *
 * PIN เก็บเป็น SHA-256 hash ใน SETTINGS (key: pin_bank, pin_attendance)
 * Token เก็บใน CacheService — หมดอายุเที่ยงคืน หรือ 6 ชม. (เพดาน CacheService)
 * ถ้า token หมดอายุ frontend จะ re-prompt PIN ให้อัตโนมัติ
 */

const PIN_MODULES = ['bank', 'attendance'];

const AuthAPI = {

  /** ตรวจ PIN → คืน token + วินาทีที่เหลือถึงเที่ยงคืน */
  verify_pin: function (params) {
    const mod = params.module;
    const pin = params.pin;
    if (!mod || !pin) apiError('VALIDATION', 'กรุณาระบุ module และ PIN');
    if (PIN_MODULES.indexOf(mod) < 0) apiError('VALIDATION', `module นี้ไม่ต้องใช้ PIN: ${mod}`);

    const stored = SettingsAPI.get_raw('pin_' + mod);
    if (!stored) apiError('NOT_FOUND', `ยังไม่ได้ตั้ง PIN สำหรับ ${mod}`);

    if (hashPin(String(pin)) !== stored) {
      audit('auth', 'PIN_FAIL', mod, { module: mod }, 'anonymous');
      apiError('PIN_INVALID', 'PIN ไม่ถูกต้อง');
    }

    // CacheService จำกัด TTL สูงสุด 21600 วินาที (6 ชม.) — ส่งมากกว่านี้จะ throw
    const ttl = Math.min(secondsUntilMidnight(), 21600);
    const token = Utilities.getUuid();
    CacheService.getScriptCache().put(
      'token:' + token,
      JSON.stringify({ module: mod, issued: now() }),
      ttl
    );
    audit('auth', 'PIN_OK', mod, { module: mod }, 'anonymous');
    return { token: token, expires_in: ttl };
  },

  /** เช็คว่า token ยังใช้ได้กับ module นี้ไหม */
  check: function (params) {
    return { valid: isTokenValid(params.token, params.module) };
  },
};

function isTokenValid(token, requireModule) {
  if (!token) return false;
  const raw = CacheService.getScriptCache().get('token:' + token);
  if (!raw) return false;
  if (!requireModule) return true;
  try {
    return JSON.parse(raw).module === requireModule;
  } catch (e) { return false; }
}

/**
 * เรียกที่ต้น method ที่ต้องใช้ PIN — โยน error ถ้า token ไม่ผ่าน
 * PIN ใช้ร่วมกันทุกโมดูล: token ที่ยืนยันแล้ว (จากโมดูลใดก็ได้) ใช้ได้กับทุกโมดูลที่ต้อง PIN
 * → ผู้ใช้กรอก PIN แค่ครั้งเดียวต่อวัน (moduleName คงไว้เพื่อความเข้ากันได้ของ caller)
 */
function requirePin(ctx, moduleName) {
  if (!isTokenValid(ctx.token)) {
    apiError('TOKEN_EXPIRED', 'กรุณากรอก PIN ใหม่');
  }
}

function hashPin(pin) {
  const raw = Utilities.computeDigest(
    Utilities.DigestAlgorithm.SHA_256,
    'baanmai-salt-2569:' + pin,
    Utilities.Charset.UTF_8
  );
  return raw.map(function (b) {
    return ('0' + (b < 0 ? b + 256 : b).toString(16)).slice(-2);
  }).join('');
}

function secondsUntilMidnight() {
  const tz = 'Asia/Bangkok';
  const nowStr = Utilities.formatDate(new Date(), tz, 'HH:mm:ss').split(':');
  const elapsed = (+nowStr[0]) * 3600 + (+nowStr[1]) * 60 + (+nowStr[2]);
  const remain = 86400 - elapsed;
  return Math.max(remain, 60); // อย่างน้อย 60 วินาที
}
