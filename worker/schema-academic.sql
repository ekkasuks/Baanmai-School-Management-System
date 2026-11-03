-- วิชาการ › ท่องสูตรคูณ — ตารางใหม่เท่านั้น ไม่แตะตารางเดิม
-- apply: npx wrangler d1 execute baanmai_sms --remote --file=schema-academic.sql  (ก่อน deploy)
-- term = 'ปีการศึกษา-ภาคเรียน' เช่น '2569-1' (รูปแบบเดียวกับ TT_TERM)

-- ผลการท่องรายคน รายแม่ รายภาคเรียน — 1 แถว/นักเรียน/แม่/ภาค · ยกเลิกการเช็ค = passed 0 (ไม่ลบแถว)
CREATE TABLE IF NOT EXISTS ACAD_MULT (
  rec_id      TEXT PRIMARY KEY,   -- term:citizen_id:table_no
  term        TEXT NOT NULL,
  citizen_id  TEXT NOT NULL,
  table_no    INTEGER NOT NULL,   -- แม่ 2–12
  passed      INTEGER NOT NULL,   -- 1 ท่องได้ · 0 ยกเลิก
  passed_date TEXT,               -- วันที่ท่องผ่าน (YYYY-MM-DD)
  recorded_by TEXT,
  updated_at  TEXT
);
CREATE INDEX IF NOT EXISTS idx_acad_mult_term ON ACAD_MULT(term);
CREATE INDEX IF NOT EXISTS idx_acad_mult_cid ON ACAD_MULT(citizen_id);

-- ชั้น/ห้องของนักเรียนในแต่ละภาคเรียน (ภาพถ่าย ณ ภาคนั้น) — เลื่อนชั้นแล้วสถิติภาคเก่ายังอยู่ชั้นเดิม
CREATE TABLE IF NOT EXISTS ACAD_MULT_ROSTER (
  roster_id   TEXT PRIMARY KEY,   -- term:citizen_id
  term        TEXT NOT NULL,
  citizen_id  TEXT NOT NULL,
  grade       TEXT,
  room        TEXT,
  updated_at  TEXT
);
CREATE INDEX IF NOT EXISTS idx_acad_roster_term ON ACAD_MULT_ROSTER(term);
