-- AI Smart Timetable System — ตารางใหม่ทั้งหมดขึ้นต้น TT_ (แยกขาดจากข้อมูลเดิม ไม่แก้/ไม่อ่านเขียนตารางเดิม)
-- ปลอดภัย: CREATE TABLE IF NOT EXISTS เท่านั้น — ไม่มี DROP/ALTER/DELETE ตารางเดิม
-- apply:  cd worker && npx wrangler d1 execute baanmai_sms --remote --file=./schema-timetable.sql
-- ฟิลด์ที่เป็นรายการ (วิชาที่สอนได้, ช่วงเวลาห้ามสอน ฯลฯ) เก็บเป็น JSON text

-- บริบท: โรงเรียน/ปีการศึกษา/ภาคเรียน (รองรับหลายโรงเรียน-หลายปี-หลายภาค)
CREATE TABLE IF NOT EXISTS TT_TERM (
  term_id    TEXT PRIMARY KEY,
  school_id  TEXT,             -- 'default' = โรงเรียนบ้านใหม่
  year       TEXT,             -- พ.ศ.
  semester   TEXT,             -- '1' | '2'
  label      TEXT,
  is_active  TEXT,             -- '1' = ภาคเรียนที่ใช้งานอยู่
  created_at TEXT
);

-- โมดูล 2: ครู
CREATE TABLE IF NOT EXISTS TT_TEACHER (
  teacher_id   TEXT PRIMARY KEY,
  term_id      TEXT,
  code         TEXT,           -- รหัสครู
  title        TEXT,
  name         TEXT,           -- ชื่อ-สกุล
  dept         TEXT,           -- กลุ่มสาระ
  subjects     TEXT,           -- JSON [subject_id] วิชาที่สอนได้
  min_periods  INTEGER,        -- คาบขั้นต่ำ/สัปดาห์
  max_periods  INTEGER,        -- คาบสูงสุด/สัปดาห์
  off_days     TEXT,           -- JSON [1..5] วันหยุดประจำ
  unavailable  TEXT,           -- JSON [{day,period_id}] ช่วงที่สอนไม่ได้
  extra_duty   TEXT,           -- ภาระงานพิเศษ
  prefs        TEXT,           -- JSON {no_first, no_last, max_consecutive}
  active       TEXT,
  updated_at   TEXT
);

-- โมดูล 2: วิชา
CREATE TABLE IF NOT EXISTS TT_SUBJECT (
  subject_id    TEXT PRIMARY KEY,
  term_id       TEXT,
  code          TEXT,          -- รหัสวิชา
  name          TEXT,
  periods_week  INTEGER,       -- จำนวนคาบ/สัปดาห์
  grades        TEXT,          -- JSON [grade] ระดับชั้นที่เรียน
  type          TEXT,          -- core | elective | practical | activity
  teachers      TEXT,          -- JSON [teacher_id] ครูผู้สอนได้
  room_type     TEXT,          -- ต้องใช้ห้องประเภทนี้ (เช่น computer) หรือว่าง
  rules         TEXT,          -- JSON {consecutive, max_per_day, allowed_days}
  active        TEXT,
  updated_at    TEXT
);

-- โมดูล 2: ห้องเรียน/ห้องพิเศษ
CREATE TABLE IF NOT EXISTS TT_ROOM (
  room_id     TEXT PRIMARY KEY,
  term_id     TEXT,
  code        TEXT,            -- รหัสห้อง
  name        TEXT,
  building    TEXT,
  capacity    INTEGER,
  type        TEXT,            -- classroom | computer | science | music | lab | ...
  special     TEXT,            -- '1' = ห้องเฉพาะทาง
  allowed_subjects TEXT,       -- JSON [subject_id] (ว่าง = ทุกวิชา)
  max_concurrent   INTEGER,    -- จำกัดผู้ใช้พร้อมกัน (กลุ่ม)
  active      TEXT,
  updated_at  TEXT
);

-- โมดูล 2: ระดับชั้น/ห้อง (กลุ่มเรียน)
CREATE TABLE IF NOT EXISTS TT_CLASS (
  class_id     TEXT PRIMARY KEY,
  term_id      TEXT,
  grade        TEXT,
  room         TEXT,
  students     INTEGER,        -- จำนวนนักเรียน (กรอกเอง/ดึงสถิติจาก STUDENTS แบบอ่านอย่างเดียว)
  homeroom_teacher_id TEXT,
  home_room_id TEXT,           -- ห้องเรียนประจำ (TT_ROOM)
  active       TEXT,
  updated_at   TEXT
);

-- ช่วงเวลา: คาบเรียน (รายชั่วโมง/รายนาที, Block, เช้า-บ่าย)
CREATE TABLE IF NOT EXISTS TT_PERIOD (
  period_id  TEXT PRIMARY KEY,
  term_id    TEXT,
  seq        INTEGER,
  label      TEXT,
  start_time TEXT,             -- HH:MM
  end_time   TEXT,
  session    TEXT,             -- morning | afternoon
  is_break   TEXT              -- '1' = พัก
);

-- โมดูล 3: เงื่อนไขรวม (ค่าตั้งของ solver ต่อภาคเรียน)
CREATE TABLE IF NOT EXISTS TT_CONSTRAINT (
  term_id   TEXT PRIMARY KEY,
  config    TEXT,              -- JSON น้ำหนัก/กติกา hard-soft
  updated_at TEXT
);

-- ตารางที่จัดแล้ว: 1 แถว = 1 คาบของ 1 ห้องเรียน
CREATE TABLE IF NOT EXISTS TT_SLOT (
  slot_id    TEXT PRIMARY KEY,
  term_id    TEXT,
  version_id TEXT,             -- ฉบับของตาราง (draft/published)
  class_id   TEXT,
  day        INTEGER,          -- 1=จันทร์ ... 5=ศุกร์
  period_id  TEXT,
  subject_id TEXT,
  teacher_id TEXT,
  room_id    TEXT,
  locked     TEXT,             -- '1' = ล็อกไว้ solver ไม่ย้าย
  updated_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_tt_slot_class   ON TT_SLOT(version_id, class_id, day, period_id);
CREATE INDEX IF NOT EXISTS idx_tt_slot_teacher ON TT_SLOT(version_id, teacher_id, day, period_id);
CREATE INDEX IF NOT EXISTS idx_tt_slot_room    ON TT_SLOT(version_id, room_id, day, period_id);

-- Version History: ฉบับตาราง + สถานะการประมวลผล/อนุมัติ
CREATE TABLE IF NOT EXISTS TT_VERSION (
  version_id  TEXT PRIMARY KEY,
  term_id     TEXT,
  label       TEXT,
  status      TEXT,            -- draft | generated | approved | published
  stats       TEXT,            -- JSON ผลประมวลผล (placed, conflicts, score, ms)
  created_by  TEXT,
  created_at  TEXT
);

-- โมดูล 9: บันทึกการเปลี่ยนแปลง → ข้อความวิ่งหน้าหลัก
CREATE TABLE IF NOT EXISTS TT_CHANGE (
  change_id  TEXT PRIMARY KEY,
  term_id    TEXT,
  version_id TEXT,
  message    TEXT,             -- "ป.3/1 วันจันทร์ คาบ 2: คณิต → วิทย์ (ครูสมชาย)"
  detail     TEXT,             -- JSON
  created_by TEXT,
  created_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_tt_change_time ON TT_CHANGE(created_at);
