-- แผนที่บ้านนักเรียน ส่วนขยาย — ตาราง/คอลัมน์ใหม่เท่านั้น ไม่แตะตารางเดิม
-- apply: npx wrangler d1 execute baanmai_sms --remote --file=schema-geo-002.sql  (ก่อน deploy)

-- (2) วิธีเดินทางมาโรงเรียนจริง — แยกจากพิกัด (รู้วิธีเดินทางได้แม้ยังไม่มีพิกัด)
CREATE TABLE IF NOT EXISTS GEO_TRAVEL (
  citizen_id TEXT PRIMARY KEY,
  mode       TEXT NOT NULL,     -- walk | bicycle | moto_parent | car_parent | school_van | public | dorm | other
  updated_by TEXT,
  updated_at TEXT
);

-- (3) ระยะทาง/เวลาตามถนนจริง (คำนวณครั้งเดียวแล้วเก็บไว้ ใช้ทำรายงานบ้านไกล/ค่าพาหนะ)
ALTER TABLE GEO_HOME ADD COLUMN road_km REAL;
ALTER TABLE GEO_HOME ADD COLUMN road_walk_min REAL;
ALTER TABLE GEO_HOME ADD COLUMN road_car_min REAL;
ALTER TABLE GEO_HOME ADD COLUMN road_at TEXT;

-- (4) ลิงก์ให้ผู้ปกครองส่งพิกัดเอง — เก็บเฉพาะ SHA-256 ของ token · ใช้ได้ครั้งเดียว · มีวันหมดอายุ
CREATE TABLE IF NOT EXISTS GEO_LINK (
  token_hash TEXT PRIMARY KEY,
  citizen_id TEXT NOT NULL,
  created_by TEXT,
  created_at TEXT,
  expires_at TEXT,
  used_at    TEXT
);
CREATE INDEX IF NOT EXISTS idx_geo_link_cid ON GEO_LINK(citizen_id);

-- (6) จุดเสี่ยงบนเส้นทาง (ถนนใหญ่ แม่น้ำ จุดน้ำท่วม ฯลฯ)
CREATE TABLE IF NOT EXISTS GEO_POINT (
  point_id   TEXT PRIMARY KEY,
  type       TEXT,              -- road | river | flood | animal | construction | other
  name       TEXT,
  note       TEXT,
  lat        REAL NOT NULL,
  lng        REAL NOT NULL,
  radius_m   REAL,
  updated_by TEXT,
  updated_at TEXT
);
