/**
 * Settings module — ข้อมูลโรงเรียน + PIN + init + Backup/Restore
 */

const SettingsAPI = {

  /** อ่านค่าตั้งทั้งหมด (ซ่อน PIN hash) */
  get: function () {
    const out = {};
    readAll('SETTINGS').forEach(function (r) {
      out[r.key] = String(r.key).indexOf('pin_') === 0 ? '***' : r.value;
    });
    return { settings: out };
  },

  /** อ่านค่าดิบ 1 key (ใช้ภายใน เช่น ดึง PIN hash) */
  get_raw: function (key) {
    const found = readAll('SETTINGS').find(function (r) { return r.key === key; });
    return found ? String(found.value) : null;
  },

  /** แก้ค่าตั้ง 1 key (PIN จะถูก hash ก่อนเก็บ) */
  update: function (params) {
    const key = params.key;
    if (!key) apiError('VALIDATION', 'ไม่ได้ระบุ key');
    let value = params.value;

    if (String(key).indexOf('pin_') === 0) {
      if (String(value).length < 3) apiError('VALIDATION', 'PIN ต้องมีอย่างน้อย 3 หลัก');
      value = hashPin(String(value));
    }

    upsertRow('SETTINGS', 'key', {
      key: key, value: value, updated_at: now(), updated_by: params.recorded_by || 'admin',
    });
    audit('settings', 'UPDATE', key, { key: key }, params.recorded_by || 'admin');
    return { ok: true };
  },

  /**
   * สร้างทุก sheet + ค่า default — รันซ้ำได้ ไม่ลบข้อมูลเดิม (idempotent)
   */
  init: function () {
    Object.keys(SHEETS).forEach(function (k) { getSheet(k); });

    const defaults = {
      school_code: '73010118',
      school_name: 'โรงเรียนบ้านใหม่',
      address: '',
      phone: '',
      email: '',
      website: '',
      director: '',
      current_year: '2569',
      current_semester: '1',
      pin_bank: hashPin('127'),
      pin_attendance: hashPin('127'),
      behavior_start: '20',
      behavior_reset_day: '1',
    };

    const existing = {};
    readAll('SETTINGS').forEach(function (r) { existing[r.key] = true; });

    const toInsert = [];
    Object.keys(defaults).forEach(function (k) {
      if (!existing[k]) {
        toInsert.push({ key: k, value: defaults[k], updated_at: now(), updated_by: 'system' });
      }
    });
    if (toInsert.length) appendRows('SETTINGS', toInsert);

    return { sheets: Object.keys(SHEETS).length, settings_inserted: toInsert.length };
  },

  /**
   * Backup — คืนข้อมูลทุก sheet เป็น JSON ให้ frontend ดาวน์โหลดเก็บไว้
   */
  backup: function () {
    const dump = {};
    Object.keys(SHEETS).forEach(function (k) {
      dump[k] = readAll(k);
    });
    audit('settings', 'BACKUP', 'all', { sheets: Object.keys(SHEETS).length }, 'admin');
    return {
      version: 1,
      created_at: now(),
      school: SettingsAPI.get_raw('school_name'),
      data: dump,
    };
  },

  /**
   * Restore — เขียนทับข้อมูลจากไฟล์ backup
   * params = { backup: {version,data:{SHEET:[...]}}, confirm: true }
   * ⚠️ ลบข้อมูลเดิมในแต่ละ sheet ที่อยู่ใน backup แล้วเขียนใหม่
   */
  restore: function (params) {
    const backup = params.backup;
    if (!backup || !backup.data) apiError('VALIDATION', 'ไฟล์ backup ไม่ถูกต้อง');
    if (params.confirm !== true) apiError('VALIDATION', 'ต้องยืนยันก่อน restore (confirm=true)');

    const result = {};
    Object.keys(backup.data).forEach(function (k) {
      if (!SHEETS[k]) return; // ข้าม sheet ที่ไม่รู้จัก
      const rows = backup.data[k] || [];
      const sh = getSheet(k);
      const headers = SHEETS[k].headers;

      // ลบข้อมูลเดิม (เก็บ header)
      if (sh.getLastRow() > 1) {
        sh.getRange(2, 1, sh.getLastRow() - 1, headers.length).clearContent();
      }
      // เขียนใหม่
      if (rows.length) {
        const values = rows.map(function (o) {
          return headers.map(function (h) { return o[h] !== undefined && o[h] !== null ? o[h] : ''; });
        });
        sh.getRange(2, 1, values.length, headers.length).setValues(values);
      }
      invalidateCache(k);
      result[k] = rows.length;
    });

    audit('settings', 'RESTORE', 'all', result, params.recorded_by || 'admin');
    return { ok: true, restored: result };
  },
};

/** รันครั้งเดียวจาก Apps Script editor หลังตั้ง Script Property SHEET_ID */
function setup() {
  const r = SettingsAPI.init();
  console.log('Setup complete:', JSON.stringify(r));
}
