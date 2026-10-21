-- AI Smart Timetable — มอบหมายการสอน: วิชา × ชั้นเรียน → ครู (ตารางใหม่ ไม่แตะตารางเดิม)
-- เช่น คณิตศาสตร์ ป.1 = ครูอารยา, คณิตศาสตร์ ป.2 = ครูเบญจมาภรณ์ · AI Engine ใช้ครูตามนี้ก่อนเสมอ
-- apply: npx wrangler d1 execute baanmai_sms --remote --file=schema-timetable-004.sql

CREATE TABLE IF NOT EXISTS TT_ASSIGN (
  assign_id  TEXT PRIMARY KEY,
  term_id    TEXT NOT NULL,
  class_id   TEXT NOT NULL,
  subject_id TEXT NOT NULL,
  teacher_id TEXT NOT NULL,
  updated_at TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_tt_assign_pair ON TT_ASSIGN(term_id, class_id, subject_id);
