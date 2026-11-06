-- วิชาการ › บันทึกคะแนน (เฟส 2) — ตารางใหม่เท่านั้น ไม่แตะตารางเดิม
-- apply: npx wrangler d1 execute baanmai_sms --remote --file=schema-gradebook.sql  (ก่อน deploy)
-- course_id = term:class_id:subject_id (จาก TT_ASSIGN) · ไม่ลบแถวคะแนน — ลบงาน = active 0

-- ตั้งค่ารายวิชา + ภาพถ่ายชื่อวิชา/ชั้น/ครู ณ ตอนบันทึก (ตารางสอนเปลี่ยนภายหลัง ข้อมูลเก่ายังอ่านออก)
CREATE TABLE IF NOT EXISTS GB_COURSE (
  course_id    TEXT PRIMARY KEY,
  term         TEXT NOT NULL,
  class_id     TEXT,
  subject_id   TEXT,
  teacher_id   TEXT,
  subject_code TEXT,
  subject_name TEXT,
  class_label  TEXT,
  teacher_name TEXT,
  weights      TEXT,              -- น้ำหนัก 4 ช่วง "30,20,20,30" (รวม 100)
  grade_scale  TEXT,              -- เกณฑ์ตัดเกรด (เฟส 3) ว่าง = ค่าเริ่มต้น
  status       TEXT,              -- '' กำลังบันทึก · 'submitted' ส่งผลแล้ว (เฟส 3)
  submitted_at TEXT,
  submitted_by TEXT,
  created_by   TEXT,
  created_at   TEXT,
  updated_by   TEXT,
  updated_at   TEXT
);
CREATE INDEX IF NOT EXISTS idx_gb_course_term ON GB_COURSE(term);

-- รายชื่อนักเรียนของรายวิชา (ถ่าย ณ ภาคนั้น) · left 1 = ออกจากชั้นแล้ว (คะแนนยังเก็บไว้)
CREATE TABLE IF NOT EXISTS GB_ROSTER (
  roster_id   TEXT PRIMARY KEY,   -- course_id:citizen_id
  course_id   TEXT NOT NULL,
  citizen_id  TEXT NOT NULL,
  left_class  INTEGER NOT NULL DEFAULT 0,
  special     TEXT,               -- ผลพิเศษ ร / มส (เฟส 3)
  updated_at  TEXT
);
CREATE INDEX IF NOT EXISTS idx_gb_roster_course ON GB_ROSTER(course_id);
CREATE INDEX IF NOT EXISTS idx_gb_roster_cid ON GB_ROSTER(citizen_id);

-- รายการงาน/ช่องคะแนน · period 1–4 · active 0 = ลบ (กู้คืนได้)
CREATE TABLE IF NOT EXISTS GB_ITEM (
  item_id     TEXT PRIMARY KEY,
  course_id   TEXT NOT NULL,
  period      INTEGER NOT NULL,
  title       TEXT NOT NULL,
  max_score   REAL NOT NULL,
  item_date   TEXT,
  late_pct    REAL,               -- % หักเมื่อส่งช้า (เฟส 3)
  note        TEXT,
  active      INTEGER NOT NULL DEFAULT 1,
  created_by  TEXT,
  created_at  TEXT,
  updated_by  TEXT,
  updated_at  TEXT
);
CREATE INDEX IF NOT EXISTS idx_gb_item_course ON GB_ITEM(course_id);

-- คะแนนรายคนรายงาน · score NULL = ยังไม่บันทึก
CREATE TABLE IF NOT EXISTS GB_SCORE (
  score_id    TEXT PRIMARY KEY,   -- item_id:citizen_id
  item_id     TEXT NOT NULL,
  course_id   TEXT NOT NULL,
  citizen_id  TEXT NOT NULL,
  score       REAL,
  flag        TEXT,               -- late / missing / exempt (เฟส 3)
  recorded_by TEXT,
  updated_at  TEXT
);
CREATE INDEX IF NOT EXISTS idx_gb_score_course ON GB_SCORE(course_id);
CREATE INDEX IF NOT EXISTS idx_gb_score_cid ON GB_SCORE(citizen_id);
