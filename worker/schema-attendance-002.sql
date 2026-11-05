-- เช็คการมาเรียน: แก้วันที่เช็คผิด — ตารางใหม่เท่านั้น ไม่แตะ ATTENDANCE เดิม
-- apply: npx wrangler d1 execute baanmai_sms --remote --file=schema-attendance-002.sql  (ก่อน deploy)

-- วันหยุดโรงเรียน (นักขัตฤกษ์/หยุดพิเศษ) — วันที่อยู่ในนี้ไม่นับในรายงานรายเดือน (ข้อมูลเช็คชื่อยังอยู่ครบ)
CREATE TABLE IF NOT EXISTS ATT_HOLIDAY (
  date       TEXT PRIMARY KEY,   -- YYYY-MM-DD
  name       TEXT,
  created_by TEXT,
  created_at TEXT
);

-- ถังกู้คืน: แถวเช็คชื่อที่ถูกลบ (เช็ควันผิด) ย้ายมาเก็บที่นี่ กู้คืนได้
CREATE TABLE IF NOT EXISTS ATTENDANCE_TRASH (
  trash_id    TEXT PRIMARY KEY,  -- batch_id:att_id
  batch_id    TEXT NOT NULL,     -- การลบ 1 ครั้ง (กู้คืนทั้งชุดได้)
  att_id      TEXT,
  date        TEXT,
  citizen_id  TEXT,
  status      TEXT,
  note        TEXT,
  recorded_by TEXT,
  created_at  TEXT,
  deleted_at  TEXT,
  deleted_by  TEXT,
  reason      TEXT
);
CREATE INDEX IF NOT EXISTS idx_att_trash_batch ON ATTENDANCE_TRASH(batch_id);
