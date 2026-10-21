/**
 * Data-access layer สำหรับ Cloudflare D1 — แทน helper ใน backend/Sheets.gs
 * โมดูลเรียกผ่าน helper เหล่านี้ (readAll / getBy / insertRows / upsert / updateWhere / deleteWhere)
 * เหมือน Apps Script เดิม แต่คุยกับ SQLite แทน Google Sheets
 */

/** คอลัมน์ของแต่ละตาราง + primary key (single source of truth, ตรงกับ schema.sql) */
export const TABLES = {
  SETTINGS:          { pk: 'key',           cols: ['key', 'value', 'updated_at', 'updated_by'] },
  STUDENTS:          { pk: 'citizen_id',    cols: ['citizen_id', 'student_code', 'prefix', 'first_name', 'last_name', 'gender', 'grade', 'room', 'birth_date', 'blood_type', 'religion', 'nationality', 'guardian_relation', 'guardian_name', 'guardian_phone', 'address', 'weight_init', 'height_init', 'status', 'created_at', 'updated_at'] },
  BANK_TRANSACTIONS: { pk: 'txn_id',        cols: ['txn_id', 'date', 'citizen_id', 'type', 'amount', 'balance_after', 'note', 'recorded_by', 'created_at'] },
  BANK_BALANCE:      { pk: 'citizen_id',    cols: ['citizen_id', 'balance', 'last_txn_date', 'updated_at'] },
  BEHAVIOR_MASTER:   { pk: 'item_id',       cols: ['item_id', 'type', 'name', 'points', 'active'] },
  BEHAVIOR_LOG:      { pk: 'log_id',        cols: ['log_id', 'date', 'year_month', 'citizen_id', 'item_id', 'points_change', 'points_after', 'note', 'recorded_by', 'created_at'] },
  HEALTH_CHECK:      { pk: 'check_id',      cols: ['check_id', 'date', 'citizen_id', 'hair', 'nails', 'cup', 'toothbrush', 'toothpaste', 'note', 'recorded_by', 'created_at'] },
  GROWTH:            { pk: 'growth_id',     cols: ['growth_id', 'date', 'citizen_id', 'weight', 'height', 'bmi', 'zscore', 'bmi_label', 'note', 'recorded_by', 'created_at'] },
  SCHOLARSHIP:       { pk: 'scholarship_id',cols: ['scholarship_id', 'date', 'year', 'citizen_id', 'name', 'amount', 'note', 'recorded_by', 'created_at'] },
  ATTENDANCE:        { pk: 'att_id',        cols: ['att_id', 'date', 'citizen_id', 'status', 'note', 'recorded_by', 'created_at'] },
  MILK_LOG:          { pk: 'milk_id',       cols: ['milk_id', 'date', 'citizen_id', 'boxes', 'type', 'note', 'recorded_by', 'created_at'] },
  SCOUT_GROUP:       { pk: 'group_id',      cols: ['group_id', 'name', 'year', 'note', 'created_at', 'updated_at'] },
  SCOUT_MEMBER:      { pk: 'member_id',     cols: ['member_id', 'group_id', 'citizen_id', 'created_at', 'role'] },
  SCOUT_ACTIVITY:    { pk: 'activity_id',   cols: ['activity_id', 'name', 'task', 'max_score', 'year', 'date', 'note', 'created_at', 'updated_at'] },
  SCOUT_SCORE:       { pk: 'score_id',      cols: ['score_id', 'activity_id', 'group_id', 'score', 'note', 'recorded_by', 'date', 'created_at'] },
  USERS:             { pk: 'user_id',       cols: ['user_id', 'name', 'role', 'active', 'created_at'] },
  AUDIT_LOG:         { pk: 'log_id',        cols: ['log_id', 'timestamp', 'action', 'module', 'target_id', 'details', 'recorded_by'] },
  SESSIONS:          { pk: 'token',         cols: ['token', 'module', 'issued_at', 'expires_at'] },

  // ── ระบบจัดตารางสอน (schema-timetable.sql) — แยกจากข้อมูลเดิมทั้งหมด ──
  TT_TERM:       { pk: 'term_id',    cols: ['term_id', 'school_id', 'year', 'semester', 'label', 'is_active', 'created_at'] },
  TT_TEACHER:    { pk: 'teacher_id', cols: ['teacher_id', 'term_id', 'code', 'title', 'name', 'dept', 'subjects', 'min_periods', 'max_periods', 'off_days', 'unavailable', 'extra_duty', 'prefs', 'active', 'updated_at'] },
  TT_SUBJECT:    { pk: 'subject_id', cols: ['subject_id', 'term_id', 'code', 'name', 'periods_week', 'grades', 'type', 'teachers', 'room_type', 'rules', 'active', 'updated_at'] },
  TT_ROOM:       { pk: 'room_id',    cols: ['room_id', 'term_id', 'code', 'name', 'building', 'capacity', 'type', 'special', 'allowed_subjects', 'max_concurrent', 'active', 'updated_at'] },
  TT_CLASS:      { pk: 'class_id',   cols: ['class_id', 'term_id', 'grade', 'room', 'students', 'homeroom_teacher_id', 'home_room_id', 'active', 'updated_at', 'combine_group'] },
  TT_PERIOD:     { pk: 'period_id',  cols: ['period_id', 'term_id', 'seq', 'label', 'start_time', 'end_time', 'session', 'is_break'] },
  TT_CONSTRAINT: { pk: 'term_id',    cols: ['term_id', 'config', 'updated_at'] },
  TT_SLOT:       { pk: 'slot_id',    cols: ['slot_id', 'term_id', 'version_id', 'class_id', 'day', 'period_id', 'subject_id', 'teacher_id', 'room_id', 'locked', 'updated_at'] },
  TT_VERSION:    { pk: 'version_id', cols: ['version_id', 'term_id', 'label', 'status', 'stats', 'created_by', 'created_at'] },
  TT_CHANGE:     { pk: 'change_id',  cols: ['change_id', 'term_id', 'version_id', 'message', 'detail', 'created_by', 'created_at'] },
};

export function apiError(code, message) {
  const err = new Error(message);
  err.code = code;
  throw err;
}

function def(table) {
  const d = TABLES[table];
  if (!d) apiError('CONFIG', 'ไม่รู้จักตาราง: ' + table);
  return d;
}

/** อ่านทุกแถว → array ของ object */
export async function readAll(db, table) {
  def(table);
  const res = await db.prepare('SELECT * FROM ' + table).all();
  return res.results || [];
}

/** หา 1 แถวที่ column = value (หรือ null) */
export async function getBy(db, table, col, val) {
  def(table);
  return await db.prepare('SELECT * FROM ' + table + ' WHERE ' + col + ' = ?').bind(val).first();
}

/** ทุกแถวที่ column = value (ใช้ index — เร็วกว่าอ่านทั้งตารางแล้ว filter) */
export async function selectWhere(db, table, col, val) {
  def(table);
  const res = await db.prepare('SELECT * FROM ' + table + ' WHERE ' + col + ' = ?').bind(val).all();
  return res.results || [];
}

/** INSERT หลายแถว (batch atomic) — คืนจำนวนที่เพิ่ม · orReplace=true → INSERT OR REPLACE (กัน PK ซ้ำตอน import) */
export async function insertRows(db, table, objects, orReplace) {
  if (!objects || !objects.length) return 0;
  await db.batch(insertStmts(db, table, objects, orReplace));
  return objects.length;
}

/** statement INSERT ของแต่ละแถว (ยังไม่รัน) — ใช้รวมกับ statement อื่นใน db.batch เดียวให้ atomic */
export function insertStmts(db, table, objects, orReplace) {
  const d = def(table);
  const placeholders = '(' + d.cols.map(function () { return '?'; }).join(',') + ')';
  const verb = orReplace ? 'INSERT OR REPLACE INTO ' : 'INSERT INTO ';
  const sql = verb + table + ' (' + d.cols.join(',') + ') VALUES ' + placeholders;
  return objects.map(function (o) {
    const st = db.prepare(sql);
    return st.bind.apply(st, d.cols.map(function (c) { return norm(o[c]); }));
  });
}

/** INSERT ... ON CONFLICT(pk) DO UPDATE — upsert ตาม primary key */
export async function upsert(db, table, obj) {
  const d = def(table);
  const cols = d.cols;
  const setCols = cols.filter(function (c) { return c !== d.pk; });
  const sql = 'INSERT INTO ' + table + ' (' + cols.join(',') + ') VALUES (' +
    cols.map(function () { return '?'; }).join(',') + ') ' +
    'ON CONFLICT(' + d.pk + ') DO UPDATE SET ' +
    setCols.map(function (c) { return c + '=excluded.' + c; }).join(',');
  const st = db.prepare(sql);
  await st.bind.apply(st, cols.map(function (c) { return norm(obj[c]); })).run();
}

/** UPDATE เฉพาะ field ที่ส่งมา WHERE col=val */
export async function updateWhere(db, table, col, val, fields) {
  const d = def(table);
  const keys = Object.keys(fields).filter(function (k) { return d.cols.indexOf(k) >= 0; });
  if (!keys.length) return;
  const sql = 'UPDATE ' + table + ' SET ' + keys.map(function (k) { return k + '=?'; }).join(',') +
    ' WHERE ' + col + '=?';
  const binds = keys.map(function (k) { return norm(fields[k]); });
  binds.push(val);
  const st = db.prepare(sql);
  await st.bind.apply(st, binds).run();
}

export async function deleteWhere(db, table, col, val) {
  def(table);
  await db.prepare('DELETE FROM ' + table + ' WHERE ' + col + '=?').bind(val).run();
}

/** ลบทุกแถวในตาราง (ใช้ตอน restore/import ทับ) */
export async function clearTable(db, table) {
  def(table);
  await db.prepare('DELETE FROM ' + table).run();
}

/** { lookupValue -> object } จาก rows ที่อ่านมาแล้ว */
export function buildIndex(rows, col) {
  const map = {};
  (rows || []).forEach(function (r) { map[String(r[col])] = r; });
  return map;
}

/** ค่าที่ bind ลง SQLite ต้องเป็น primitive — แปลง undefined/boolean/object ให้เรียบร้อย */
function norm(v) {
  if (v === undefined || v === null) return null;
  if (typeof v === 'boolean') return v ? 1 : 0;
  // ⚠️ number → string: กัน SQLite เติม ".0" ให้คอลัมน์ TEXT (เช่น citizen_id/current_year ที่ต้นทางเก็บเป็นตัวเลข)
  //    คอลัมน์ REAL/INTEGER จะถูกแปลงกลับเป็นตัวเลขด้วย column affinity ตอน INSERT เอง
  if (typeof v === 'number') return String(v);
  if (typeof v === 'object') return JSON.stringify(v);
  return v;
}

/* ── วันที่/เวลา/id (โซนเวลาไทย UTC+7) ── */
function bkk() { return new Date(Date.now() + 7 * 3600 * 1000); }
export function now() { return bkk().toISOString().slice(0, 19); }       // YYYY-MM-DDTHH:mm:ss
export function today() { return bkk().toISOString().slice(0, 10); }     // YYYY-MM-DD
export function yearMonth() { return bkk().toISOString().slice(0, 7); }  // YYYY-MM

export function toYmd(v) {
  if (v === null || v === undefined || v === '') return '';
  const s = String(v);
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;   // วันที่ล้วน 10 ตัว → ใช้ตามนั้น (ต้อง anchored $ เหมือน Apps Script)
  const d = new Date(s);                          // ISO ที่มีเวลา (UTC) → แปลงเป็นวันที่โซนไทย (+7) ให้ตรงระบบเดิม
  return isNaN(d.getTime()) ? s : new Date(d.getTime() + 7 * 3600 * 1000).toISOString().slice(0, 10);
}
export function toYm(v) { const s = toYmd(v); return s ? s.slice(0, 7) : ''; }

export function genId(prefix) {
  return prefix + '-' + crypto.randomUUID().replace(/-/g, '').slice(0, 8).toUpperCase();
}

/** SHA-256 hex ของ 'baanmai-salt-2569:'+pin — ต้องตรงกับ Apps Script เดิม เพื่อให้ PIN ที่ migrate มายังใช้ได้ */
export async function hashPin(pin) {
  const data = new TextEncoder().encode('baanmai-salt-2569:' + String(pin));
  const buf = await crypto.subtle.digest('SHA-256', data);
  return Array.prototype.map.call(new Uint8Array(buf), function (b) {
    return ('0' + b.toString(16)).slice(-2);
  }).join('');
}

/** เขียน AUDIT_LOG (ไม่ throw ถ้าพลาด) */
export async function audit(db, moduleName, action, targetId, details, recordedBy) {
  try {
    await insertRows(db, 'AUDIT_LOG', [{
      log_id: genId('LOG'), timestamp: now(), action: action, module: moduleName,
      target_id: targetId || '', details: typeof details === 'string' ? details : JSON.stringify(details || {}),
      recorded_by: recordedBy || 'system',
    }]);
  } catch (e) { /* audit ไม่ควรทำให้ request หลักล้ม */ }
}
