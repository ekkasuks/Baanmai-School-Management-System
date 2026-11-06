-- บัญชีบุคลากรสำหรับการบันทึกข้อมูล (เฟส 1) — ตารางใหม่เท่านั้น ไม่แตะตารางเดิม
-- apply: npx wrangler d1 execute baanmai_sms --remote --file=schema-staff.sql  (ก่อน deploy)

-- ครูประจำชั้น: บัญชี (TT_USER) ↔ ชั้น/ห้องตามข้อมูลนักเรียน (STUDENTS.grade/room) · ไม่ผูกภาคเรียน · ครู 1 คนหลายชั้นได้ · ชั้นละหลายคนได้
-- ใช้เป็น "ชั้นเริ่มต้น" ของหน้าบันทึก (ไม่จำกัดสิทธิ์ — ครูบันทึกข้ามชั้นได้)
CREATE TABLE IF NOT EXISTS STAFF_HOMEROOM (
  hr_id       TEXT PRIMARY KEY,   -- user_id|grade|room
  user_id     TEXT NOT NULL,
  grade       TEXT NOT NULL,
  room        TEXT,
  created_by  TEXT,
  created_at  TEXT
);
CREATE INDEX IF NOT EXISTS idx_staff_hr_user ON STAFF_HOMEROOM(user_id);

-- ประวัติการบันทึก: ทุกคำสั่งที่เขียนข้อมูลสำเร็จ (ใคร · เมนู · คำสั่ง · วันที่ของข้อมูล · ชั้น · จำนวน) — เพิ่มอย่างเดียว ไม่แก้/ลบ
CREATE TABLE IF NOT EXISTS WRITE_LOG (
  log_id      TEXT PRIMARY KEY,
  at          TEXT NOT NULL,      -- เวลาไทย YYYY-MM-DDTHH:mm:ss
  user_id     TEXT,               -- ว่าง = ไม่ได้เข้าสู่ระบบ
  user_name   TEXT,
  role        TEXT,
  module      TEXT NOT NULL,
  action      TEXT NOT NULL,
  ref_date    TEXT,
  grade       TEXT,
  room        TEXT,
  n           INTEGER,
  target      TEXT,
  detail      TEXT,
  ip          TEXT
);
CREATE INDEX IF NOT EXISTS idx_write_log_at ON WRITE_LOG(at);
CREATE INDEX IF NOT EXISTS idx_write_log_user ON WRITE_LOG(user_id);
