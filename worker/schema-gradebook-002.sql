-- วิชาการ › บันทึกคะแนน (เฟส 3) — หักคะแนนจากคะแนนรวม · ตารางใหม่เท่านั้น
-- apply: npx wrangler d1 execute baanmai_sms --remote --file=schema-gradebook-002.sql  (ก่อน deploy)
-- ยกเลิกการหัก = ตั้ง voided_at (ไม่ลบแถว — เก็บประวัติ)
CREATE TABLE IF NOT EXISTS GB_DEDUCT (
  deduct_id   TEXT PRIMARY KEY,
  course_id   TEXT NOT NULL,
  citizen_id  TEXT NOT NULL,
  points      REAL NOT NULL,
  reason      TEXT NOT NULL,
  deduct_date TEXT,
  created_by  TEXT,
  created_at  TEXT,
  voided_at   TEXT,
  voided_by   TEXT,
  void_reason TEXT
);
CREATE INDEX IF NOT EXISTS idx_gb_deduct_course ON GB_DEDUCT(course_id);
CREATE INDEX IF NOT EXISTS idx_gb_deduct_cid ON GB_DEDUCT(citizen_id);
