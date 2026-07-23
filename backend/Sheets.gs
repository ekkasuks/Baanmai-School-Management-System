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
  GROWTH: {
    name: 'GROWTH',
    headers: ['growth_id', 'date', 'citizen_id', 'weight', 'height',
              'bmi', 'zscore', 'bmi_label', 'note', 'recorded_by', 'created_at'],
  },
  SCHOLARSHIP: {
    name: 'SCHOLARSHIP',
    headers: ['scholarship_id', 'date', 'year', 'citizen_id', 'name',
              'amount', 'note', 'recorded_by', 'created_at'],
  },
  ATTENDANCE: {
    name: 'ATTENDANCE',
    headers: ['att_id', 'date', 'citizen_id', 'status', 'note', 'recorded_by', 'created_at'],
  },
  MILK_LOG: {
    name: 'MILK_LOG',
    // type: 'clear' (นักเรียนรับนมค้างแล้ว) | 'reset_all' (ล้างทั้งโรงเรียน)
    // date = วัน "เคลียร์ถึง" (through-date); วันไม่มาที่ date > watermark = ยังค้าง
    headers: ['milk_id', 'date', 'citizen_id', 'boxes', 'type', 'note', 'recorded_by', 'created_at'],
  },
  SCOUT_GROUP: {
    name: 'SCOUT_GROUP',
    headers: ['group_id', 'name', 'year', 'note', 'created_at', 'updated_at'],
  },
  SCOUT_MEMBER: {
    name: 'SCOUT_MEMBER',
    // role: '' (สมาชิก) | 'leader' (นายหมู่) | 'deputy' (รองนายหมู่) — 1 ตำแหน่ง/หมู่
    headers: ['member_id', 'group_id', 'citizen_id', 'created_at', 'role'],
  },
  SCOUT_ACTIVITY: {
    name: 'SCOUT_ACTIVITY',
    headers: ['activity_id', 'name', 'task', 'max_score', 'year', 'date', 'note', 'created_at', 'updated_at'],
  },
  SCOUT_SCORE: {
    name: 'SCOUT_SCORE',
    // 1 แถว = 1 (กิจกรรม × หมู่) — สมาชิกทุกคนในหมู่ได้คะแนนเท่ากันโดยปริยาย
    headers: ['score_id', 'activity_id', 'group_id', 'score', 'note', 'recorded_by', 'date', 'created_at'],
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
  } else {
    // มีคอลัมน์ใหม่เพิ่มใน schema ภายหลัง → เติมเฉพาะหัวตารางที่ยังขาด (ไม่แตะข้อมูล/หัวเดิม)
    const lastCol = sh.getLastColumn();
    if (lastCol > 0 && lastCol < def.headers.length) {
      sh.getRange(1, lastCol + 1, 1, def.headers.length - lastCol)
        .setValues([def.headers.slice(lastCol)])
        .setBackground('#4FC3F7').setFontColor('#FFFFFF').setFontWeight('bold');
    }
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
  const cache = CacheService.getScriptCache();
  cache.remove(`sheet:${key}`);
  // bump เวอร์ชันข้อมูล → cache ผลลัพธ์ที่คำนวณแล้ว (dashboard/summary) ที่อิงชีตนี้จะถือว่าเก่าทันที
  cache.put(`ver:${key}`, String(Date.now()) + Math.random().toString(36).slice(2, 6), 21600);
}

/** เวอร์ชันข้อมูลรวมของชีตที่ระบุ — เปลี่ยนทุกครั้งที่มีการเขียนชีตใดชีตหนึ่ง */
function dataVersion(keys) {
  const vkeys = keys.map(function (k) { return 'ver:' + k; });
  const map = CacheService.getScriptCache().getAll(vkeys);
  return vkeys.map(function (vk) { return map[vk] || '0'; }).join('|');
}

/**
 * cache ผลลัพธ์ที่คำนวณแล้ว (เช่น dashboard/summary) — เรียก fn เฉพาะเมื่อ cache พลาด
 * cache key ผูกกับ dataVersion ของ sheets ที่พึ่งพา → เขียนข้อมูลใหม่แล้วคำนวณใหม่อัตโนมัติ
 * ttl เป็นเพดานความเก่าสูงสุด (วินาที) เผื่อกรณี version key หมดอายุ
 */
function cachedResult(baseKey, sheets, ttlSeconds, fn) {
  const cache = CacheService.getScriptCache();
  const ckey = 'calc:' + baseKey + ':' + dataVersion(sheets);
  const hit = cache.get(ckey);
  if (hit) return JSON.parse(hit);
  const result = fn();
  try { cache.put(ckey, JSON.stringify(result), ttlSeconds); } catch (e) { /* > 100kb: ข้าม cache */ }
  return result;
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

/** ลบแถวตามเลขแถว (1-based) */
function deleteRow(key, rowIndex) {
  const sh = getSheet(key);
  sh.deleteRow(rowIndex);
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
