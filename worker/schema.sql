-- Baanmai SMS — Cloudflare D1 (SQLite) schema
-- มิเรอร์จาก SHEETS ใน backend/Sheets.gs (18 ตาราง) + SESSIONS (เก็บ PIN token)
-- วันที่เก็บเป็น TEXT 'YYYY-MM-DD' / ISO — SQLite ไม่ coerce เป็น Date (ต่างจาก Sheets)

CREATE TABLE IF NOT EXISTS SETTINGS (
  key         TEXT PRIMARY KEY,
  value       TEXT,
  updated_at  TEXT,
  updated_by  TEXT
);

CREATE TABLE IF NOT EXISTS STUDENTS (
  citizen_id   TEXT PRIMARY KEY,
  student_code TEXT,
  prefix       TEXT,
  first_name   TEXT,
  last_name    TEXT,
  gender       TEXT,
  grade        TEXT,
  room         TEXT,
  birth_date   TEXT,
  blood_type   TEXT,
  religion     TEXT,
  nationality  TEXT,
  guardian_relation TEXT,
  guardian_name     TEXT,
  guardian_phone    TEXT,
  address      TEXT,
  weight_init  REAL,
  height_init  REAL,
  status       TEXT,
  created_at   TEXT,
  updated_at   TEXT
);
CREATE INDEX IF NOT EXISTS idx_students_grade ON STUDENTS(grade, room);
CREATE INDEX IF NOT EXISTS idx_students_status ON STUDENTS(status);

CREATE TABLE IF NOT EXISTS BANK_TRANSACTIONS (
  txn_id        TEXT PRIMARY KEY,
  date          TEXT,
  citizen_id    TEXT,
  type          TEXT,
  amount        REAL,
  balance_after REAL,
  note          TEXT,
  recorded_by   TEXT,
  created_at    TEXT
);
CREATE INDEX IF NOT EXISTS idx_bank_txn_cid  ON BANK_TRANSACTIONS(citizen_id);
CREATE INDEX IF NOT EXISTS idx_bank_txn_date ON BANK_TRANSACTIONS(date);

CREATE TABLE IF NOT EXISTS BANK_BALANCE (
  citizen_id    TEXT PRIMARY KEY,
  balance       REAL,
  last_txn_date TEXT,
  updated_at    TEXT
);

CREATE TABLE IF NOT EXISTS BEHAVIOR_MASTER (
  item_id TEXT PRIMARY KEY,
  type    TEXT,
  name    TEXT,
  points  INTEGER,
  active   TEXT
);

CREATE TABLE IF NOT EXISTS BEHAVIOR_LOG (
  log_id        TEXT PRIMARY KEY,
  date          TEXT,
  year_month    TEXT,
  citizen_id    TEXT,
  item_id       TEXT,
  points_change INTEGER,
  points_after  INTEGER,
  note          TEXT,
  recorded_by   TEXT,
  created_at    TEXT
);
CREATE INDEX IF NOT EXISTS idx_beh_cid ON BEHAVIOR_LOG(citizen_id);
CREATE INDEX IF NOT EXISTS idx_beh_ym  ON BEHAVIOR_LOG(year_month);

CREATE TABLE IF NOT EXISTS HEALTH_CHECK (
  check_id    TEXT PRIMARY KEY,
  date        TEXT,
  citizen_id  TEXT,
  hair        TEXT,
  nails       TEXT,
  cup         TEXT,
  toothbrush  TEXT,
  toothpaste  TEXT,
  note        TEXT,
  recorded_by TEXT,
  created_at  TEXT
);
CREATE INDEX IF NOT EXISTS idx_health_date ON HEALTH_CHECK(date);
CREATE INDEX IF NOT EXISTS idx_health_cid  ON HEALTH_CHECK(citizen_id);

CREATE TABLE IF NOT EXISTS GROWTH (
  growth_id   TEXT PRIMARY KEY,
  date        TEXT,
  citizen_id  TEXT,
  weight      REAL,
  height      REAL,
  bmi         REAL,
  zscore      REAL,
  bmi_label   TEXT,
  note        TEXT,
  recorded_by TEXT,
  created_at  TEXT
);
CREATE INDEX IF NOT EXISTS idx_growth_cid ON GROWTH(citizen_id);

CREATE TABLE IF NOT EXISTS SCHOLARSHIP (
  scholarship_id TEXT PRIMARY KEY,
  date        TEXT,
  year        TEXT,
  citizen_id  TEXT,
  name        TEXT,
  amount      REAL,
  note        TEXT,
  recorded_by TEXT,
  created_at  TEXT
);
CREATE INDEX IF NOT EXISTS idx_scholar_cid  ON SCHOLARSHIP(citizen_id);
CREATE INDEX IF NOT EXISTS idx_scholar_year ON SCHOLARSHIP(year);

CREATE TABLE IF NOT EXISTS ATTENDANCE (
  att_id      TEXT PRIMARY KEY,
  date        TEXT,
  citizen_id  TEXT,
  status      TEXT,
  note        TEXT,
  recorded_by TEXT,
  created_at  TEXT
);
CREATE INDEX IF NOT EXISTS idx_att_date ON ATTENDANCE(date);
CREATE INDEX IF NOT EXISTS idx_att_cid  ON ATTENDANCE(citizen_id);
CREATE INDEX IF NOT EXISTS idx_att_date_cid ON ATTENDANCE(date, citizen_id);

CREATE TABLE IF NOT EXISTS MILK_LOG (
  milk_id     TEXT PRIMARY KEY,
  date        TEXT,
  citizen_id  TEXT,
  boxes       INTEGER,
  type        TEXT,
  note        TEXT,
  recorded_by TEXT,
  created_at  TEXT
);
CREATE INDEX IF NOT EXISTS idx_milk_cid ON MILK_LOG(citizen_id);

CREATE TABLE IF NOT EXISTS SCOUT_GROUP (
  group_id   TEXT PRIMARY KEY,
  name       TEXT,
  year       TEXT,
  note       TEXT,
  created_at TEXT,
  updated_at TEXT
);

CREATE TABLE IF NOT EXISTS SCOUT_MEMBER (
  member_id  TEXT PRIMARY KEY,
  group_id   TEXT,
  citizen_id TEXT,
  created_at TEXT,
  role       TEXT
);
CREATE INDEX IF NOT EXISTS idx_scoutmem_group ON SCOUT_MEMBER(group_id);
CREATE INDEX IF NOT EXISTS idx_scoutmem_cid   ON SCOUT_MEMBER(citizen_id);

CREATE TABLE IF NOT EXISTS SCOUT_ACTIVITY (
  activity_id TEXT PRIMARY KEY,
  name       TEXT,
  task       TEXT,
  max_score  INTEGER,
  year       TEXT,
  date       TEXT,
  note       TEXT,
  created_at TEXT,
  updated_at TEXT
);

CREATE TABLE IF NOT EXISTS SCOUT_SCORE (
  score_id    TEXT PRIMARY KEY,
  activity_id TEXT,
  group_id    TEXT,
  score       REAL,
  note        TEXT,
  recorded_by TEXT,
  date        TEXT,
  created_at  TEXT
);
CREATE INDEX IF NOT EXISTS idx_scoutscore_act ON SCOUT_SCORE(activity_id);
CREATE INDEX IF NOT EXISTS idx_scoutscore_grp ON SCOUT_SCORE(group_id);

CREATE TABLE IF NOT EXISTS USERS (
  user_id    TEXT PRIMARY KEY,
  name       TEXT,
  role       TEXT,
  active     TEXT,
  created_at TEXT
);

CREATE TABLE IF NOT EXISTS AUDIT_LOG (
  log_id      TEXT PRIMARY KEY,
  timestamp   TEXT,
  action      TEXT,
  module      TEXT,
  target_id   TEXT,
  details     TEXT,
  recorded_by TEXT
);
CREATE INDEX IF NOT EXISTS idx_audit_module ON AUDIT_LOG(module);
CREATE INDEX IF NOT EXISTS idx_audit_time   ON AUDIT_LOG(timestamp);

-- ใหม่: เก็บ PIN session token (แทน CacheService ของ Apps Script)
CREATE TABLE IF NOT EXISTS SESSIONS (
  token      TEXT PRIMARY KEY,
  module     TEXT,
  issued_at  TEXT,
  expires_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_sessions_exp ON SESSIONS(expires_at);
