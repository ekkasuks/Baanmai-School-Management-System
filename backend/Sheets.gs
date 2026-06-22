/**
 * Sheet helpers — schema 10 sheets + batch read/write + cache
 *
 * ทุก sheet กำหนด headers ไว้ที่นี่ที่เดียว (single source of truth)
 */

const SHEETS = {
  SETTINGS: {
    name: 'SETTINGS',
    headers: ['key', 'value', 'updated_at', 'updated_by'],
  },
  STUDENTS: {
    name: 'STUDENTS',
    headers: [
      'citizen_id', 'student_code', 'prefix', 'first_name', 'last_name',
      'gender', 'grade', 'room', 'birth_date', 'blood_type', 'religion',
      'nationality', 'guardian_relation', 'guardian_name', 'guardian_phone',
      'address', 'weight_init', 'height_init', 'status', 'created_at', 'updated_at'
    ],
  },
  BANK_TRANSACTIONS: {
    name: 'BANK_TRANSACTIONS',
    headers: ['txn_id', 'date', 'citizen_id', 'type', 'amount',
              'balance_after', 'note', 'recorded_by', 'created_at'],
  },
  BANK_BALANCE: {
    name: 'BANK_BALANCE',
    headers: ['citizen_id', 'balance', 'last_txn_date', 'updated_at'],
  },
  BEHAVIOR_MASTER: {
    name: 'BEHAVIOR_MASTER',
    headers: ['item_id', 'type', 'name', 'points', 'active'],
  },
  BEHAVIOR_LOG: {
    name: 'BEHAVIOR_LOG',
    headers: ['log_id', 'date', 'year_month', 'citizen_id', 'item_id',
              'points_change', 'points_after', 'note', 'recorded_by', 'created_at'],
  },
  HEALTH_CHECK: {
    name: 'HEALTH_CHECK',
    headers: ['check_id', 'date', 'citizen_id', 'hair', 'nails',
              'cup', 'toothbrush', 'toothpaste', 'note', 'recorded_by', 'created_at'],
  },
  ATTENDANCE: {
    name: 'ATTENDANCE',
    headers: ['att_id', 'date', 'citizen_id', 'status', 'note', 'recorded_by', 'created_at'],
  },
  USERS: {
    name: 'USERS',
    headers: ['user_id', 'name', 'role', 'active', 'created_at'],
  },
  AUDIT_LOG: {
    name: 'AUDIT_LOG',
    headers: ['log_id', 'timestamp', 'action', 'module', 'target_id', 'details', 'recorded_by'],
  },
};

function getSS() {
  if (!SHEET_ID) apiError('CONFIG', 'ยังไม่ได้ตั้งค่า SHEET_ID ใน Script Properties');
  return SpreadsheetApp.openById(SHEET_ID);
}

/** คืน sheet object — สร้างพร้อม header ถ้ายังไม่มี */
function getSheet(key) {
  const def = SHEETS[key];
  if (!def) apiError('CONFIG', `ไม่รู้จัก sheet: ${key}`);
  const ss = getSS();
  let sh = ss.getSheetByName(def.name);
  if (!sh) {
    sh = ss.insertSheet(def.name);
    sh.getRange(1, 1, 1, def.headers.length).setValues([def.headers]);
    sh.setFrozenRows(1);
    sh.getRange(1, 1, 1, def.headers.length)
      .setBackground('#4FC3F7').setFontColor('#FFFFFF').setFontWeight('bold');
  }
  return sh;
}

/** อ่านทุกแถวเป็น array ของ object (key = header) — cache 5 นาที */
function readAll(key) {
  const cache = CacheService.getScriptCache();
  const ckey = `sheet:${key}`;
  const cached = cache.get(ckey);
  if (cached) return JSON.parse(cached);

  const sh = getSheet(key);
  const lastRow = sh.getLastRow();
  if (lastRow <= 1) return [];
  const headers = SHEETS[key].headers;
  const values = sh.getRange(2, 1, lastRow - 1, headers.length).getValues();
  const rows = values.map(function (row) {
    const o = {};
    headers.forEach(function (h, i) { o[h] = row[i]; });
    return o;
  });

  try { cache.put(ckey, JSON.stringify(rows), 300); } catch (e) { /* > 100kb: ข้าม cache */ }
  return rows;
}

function invalidateCache(key) {
  CacheService.getScriptCache().remove(`sheet:${key}`);
}

/** เพิ่มหลายแถว (array of objects) แบบ batch ครั้งเดียว */
function appendRows(key, objects) {
  if (!objects || !objects.length) return 0;
  const sh = getSheet(key);
  const headers = SHEETS[key].headers;
  const values = objects.map(function (o) {
    return headers.map(function (h) { return o[h] !== undefined && o[h] !== null ? o[h] : ''; });
  });
  sh.getRange(sh.getLastRow() + 1, 1, values.length, headers.length).setValues(values);
  invalidateCache(key);
  return values.length;
}

/** หาเลขแถว (1-based) ของ record ที่ column = value */
function findRowIndex(key, columnName, value) {
  const sh = getSheet(key);
  const headers = SHEETS[key].headers;
  const colIdx = headers.indexOf(columnName);
  if (colIdx < 0) apiError('CONFIG', `ไม่มีคอลัมน์ ${columnName} ใน ${key}`);
  const lastRow = sh.getLastRow();
  if (lastRow <= 1) return -1;
  const data = sh.getRange(2, colIdx + 1, lastRow - 1, 1).getValues();
  for (let i = 0; i < data.length; i++) {
    if (String(data[i][0]) === String(value)) return i + 2;
  }
  return -1;
}

/** อัปเดตเฉพาะ field ที่ส่งมา (merge กับแถวเดิม) */
function updateRow(key, rowIndex, partialObject) {
  const sh = getSheet(key);
  const headers = SHEETS[key].headers;
  const current = sh.getRange(rowIndex, 1, 1, headers.length).getValues()[0];
  headers.forEach(function (h, i) {
    if (partialObject[h] !== undefined) current[i] = partialObject[h];
  });
  sh.getRange(rowIndex, 1, 1, headers.length).setValues([current]);
  invalidateCache(key);
}

/** insert ถ้าไม่มี, update ถ้ามี (อิง lookupColumn) */
function upsertRow(key, lookupColumn, partialObject) {
  const rowIdx = findRowIndex(key, lookupColumn, partialObject[lookupColumn]);
  if (rowIdx > 0) {
    updateRow(key, rowIdx, partialObject);
    return { action: 'update', rowIndex: rowIdx };
  }
  appendRows(key, [partialObject]);
  return { action: 'insert' };
}

/** สร้าง index map { lookupValue -> object } — เร็วกว่าเรียก findRowIndex หลายครั้ง */
function buildIndex(key, lookupColumn) {
  const map = {};
  readAll(key).forEach(function (r) { map[String(r[lookupColumn])] = r; });
  return map;
}

/* ── helpers วันที่/เวลา/id (timezone ไทย) ── */

function now() {
  return Utilities.formatDate(new Date(), 'Asia/Bangkok', "yyyy-MM-dd'T'HH:mm:ss");
}

/**
 * แปลงค่าวันที่ให้เป็น 'YYYY-MM-DD' (โซนเวลาไทย) เสมอ
 * รองรับ Date object / ISO string / 'YYYY-MM-DD'
 * ⚠️ จำเป็นเพราะ Google Sheets แปลง string วันที่เป็น Date เอง แล้วอ่านกลับมาเป็น ISO (UTC)
 */
function toYmd(v) {
  if (v === null || v === undefined || v === '') return '';
  if (Object.prototype.toString.call(v) === '[object Date]') {
    return Utilities.formatDate(v, 'Asia/Bangkok', 'yyyy-MM-dd');
  }
  const s = String(v);
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const d = new Date(s);
  if (!isNaN(d.getTime())) return Utilities.formatDate(d, 'Asia/Bangkok', 'yyyy-MM-dd');
  return s;
}

/** แปลงค่าวันที่ → 'YYYY-MM' (เดือน) */
function toYm(v) {
  const s = toYmd(v);
  return s ? s.substring(0, 7) : '';
}

function today() {
  return Utilities.formatDate(new Date(), 'Asia/Bangkok', 'yyyy-MM-dd');
}

function yearMonth() {
  return Utilities.formatDate(new Date(), 'Asia/Bangkok', 'yyyy-MM');
}

function genId(prefix) {
  return prefix + '-' + Utilities.getUuid().substring(0, 8).toUpperCase();
}
