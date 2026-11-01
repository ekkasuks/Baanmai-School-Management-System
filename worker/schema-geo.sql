-- แผนที่บ้านนักเรียน — ตารางใหม่ ไม่แตะตารางเดิม (STUDENTS อ่านอย่างเดียว)
-- apply: npx wrangler d1 execute baanmai_sms --remote --file=schema-geo.sql
--
-- GEO_HOME   : พิกัดบ้านนักเรียน 1 แถว/คน (ผูก citizen_id) — ชั้นเรียนอ่านจาก STUDENTS ทุกครั้ง จึงตามการเลื่อนชั้นอัตโนมัติ
-- GEO_CONFIG : ค่าตั้งของโมดูล (key = 'school' พิกัดโรงเรียน · 'speeds' ความเร็วเฉลี่ยใช้ประมาณเวลาเดินทาง)

CREATE TABLE IF NOT EXISTS GEO_HOME (
  citizen_id TEXT PRIMARY KEY,
  lat        REAL NOT NULL,
  lng        REAL NOT NULL,
  accuracy   REAL,            -- ความแม่นยำ (เมตร) เมื่ออ่านจาก GPS
  source     TEXT,            -- gps | map | manual
  note       TEXT,            -- จุดสังเกต เช่น "บ้านหลังที่ 2 ซ้ายมือหลังวัด"
  updated_by TEXT,
  updated_at TEXT
);

CREATE TABLE IF NOT EXISTS GEO_CONFIG (
  key        TEXT PRIMARY KEY,
  value      TEXT,
  updated_by TEXT,
  updated_at TEXT
);
