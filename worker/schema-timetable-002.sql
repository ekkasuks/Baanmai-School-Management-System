-- Timetable migration 002: เรียนควบชั้น (Combined classes)
-- ห้องที่มี combine_group เดียวกัน = เรียนรวมกันทุกวิชา → จัดตารางเป็นหน่วยเดียว (วิชา/ครู/ห้อง/เวลาเดียวกัน)
-- แก้เฉพาะตารางใหม่ TT_CLASS เท่านั้น (ไม่แตะตารางเดิมของระบบ)
-- รันครั้งเดียวหลัง schema-timetable.sql:
--   cd worker && npx wrangler d1 execute baanmai_sms --remote --file=./schema-timetable-002.sql

ALTER TABLE TT_CLASS ADD COLUMN combine_group TEXT;
CREATE INDEX IF NOT EXISTS idx_tt_class_group ON TT_CLASS(term_id, combine_group);
