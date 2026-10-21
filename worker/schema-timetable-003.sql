-- AI Smart Timetable — เฟส 6: ผู้ใช้ + สิทธิ์ 6 ระดับ (ตารางใหม่เท่านั้น ไม่แตะตารางเดิม/USERS/SESSIONS)
-- apply: npx wrangler d1 execute baanmai_sms --remote --file=schema-timetable-003.sql
--
-- รหัสผ่านเก็บเป็น PBKDF2-SHA256 (pbkdf2$รอบ$salt$hash) · session เก็บเฉพาะ SHA-256 ของ token (ไม่เก็บ token จริง)
-- ทั้งสองตาราง "secret" — settings.backup/restore ข้าม (ดู db.js TABLES)

CREATE TABLE IF NOT EXISTS TT_USER (
  user_id       TEXT PRIMARY KEY,
  username      TEXT NOT NULL,
  display_name  TEXT,
  role          TEXT NOT NULL,          -- admin | director | academic | teacher | student | parent
  password_hash TEXT NOT NULL,
  teacher_id    TEXT,                   -- ครู: ผูกกับ TT_TEACHER (ดูตารางสอนของตัวเอง)
  class_id      TEXT,                   -- นักเรียน/ผู้ปกครอง: ผูกกับ TT_CLASS (ดูตารางเรียนของห้อง)
  active        TEXT DEFAULT '1',
  failed_count  INTEGER DEFAULT 0,
  locked_until  TEXT,
  last_login    TEXT,
  created_at    TEXT,
  updated_at    TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_tt_user_username ON TT_USER(username);

CREATE TABLE IF NOT EXISTS TT_SESSION (
  token_hash TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL,
  created_at TEXT,
  expires_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_tt_session_user ON TT_SESSION(user_id);
