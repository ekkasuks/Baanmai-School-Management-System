# Database Schema — Google Sheets

> Step 2: ออกแบบฐานข้อมูล — Spreadsheet ชื่อ **BaanmaiSMS_DB** (เริ่ม 10 sheets · เพิ่ม GROWTH เป็น **11 sheets**)

ชนิดข้อมูล: ทุกค่าเก็บเป็น text/number ใน cell · วันที่ใช้รูปแบบ `YYYY-MM-DD` (เวลา ISO `YYYY-MM-DDTHH:mm:ss`, timezone Asia/Bangkok)

---

## 1. SETTINGS — ตั้งค่าระบบ (key-value)

| Column | Type | หมายเหตุ |
|---|---|---|
| key | text | **PK** |
| value | text | ค่า (PIN เก็บเป็น hash) |
| updated_at | datetime | |
| updated_by | text | |

**ค่าเริ่มต้น:** `school_name, address, phone, director, email, website,`
`current_year (2569), current_semester (1), pin_bank (hash 127), pin_attendance (hash 127),`
`behavior_start (20), behavior_reset_day (1)`

---

## 2. STUDENTS — ทะเบียนนักเรียน (จาก DMC)

> ✅ Finalized จากไฟล์ DMC จริง (Step 3) — ดู [dmc-field-map.md](dmc-field-map.md)

| Column | Type | DMC | หมายเหตุ |
|---|---|---|---|
| citizen_id | text(13) | C | **PK** (13 อักขระ ไม่ซ้ำ — มีรหัส G ต่างชาติ 26 คน) |
| student_code | text | F | 4 หลัก เก็บเป็น text |
| prefix | text | H | คำนำหน้า (เด็กชาย/เด็กหญิง…) |
| first_name | text | I | |
| last_name | text | J | ⚠️ ว่างได้ (60/103 ไม่มี) |
| gender | enum(ช,ญ) | G | |
| grade | text | D | อ.2 … ป.6 |
| room | int | E | |
| birth_date | text | M | DD/MM/พ.ศ. |
| blood_type | text | P | |
| religion | text | S | |
| nationality | text | Q | |
| guardian_relation | text | AL | |
| guardian_name | text | AN+AO+AP | คำนำหน้า+ชื่อ+สกุล |
| guardian_phone | text | AR | ว่างได้ |
| address | text | BC..BI | ที่อยู่ปัจจุบันประกอบเป็นข้อความเดียว |
| weight_init | number | BK | baseline (kg) |
| height_init | number | BL | baseline (cm) |
| status | enum(active,inactive) | — | default active |
| created_at | datetime | — | |
| updated_at | datetime | — | |

---

## 3. BANK_TRANSACTIONS — รายการฝาก/ถอน

| Column | Type | หมายเหตุ |
|---|---|---|
| txn_id | text | **PK** (TXN-xxxxxxxx) |
| date | date | |
| citizen_id | text(13) | FK → STUDENTS |
| type | enum(deposit,withdraw) | |
| amount | number | บวกเสมอ |
| balance_after | number | ยอดหลังทำรายการ |
| note | text | |
| recorded_by | text | ผู้บันทึก |
| created_at | datetime | |

---

## 4. BANK_BALANCE — ยอดคงเหลือ (cache sheet)

| Column | Type | หมายเหตุ |
|---|---|---|
| citizen_id | text(13) | **PK** |
| balance | number | ยอดปัจจุบัน |
| last_txn_date | datetime | |
| updated_at | datetime | |

> อัปเดตทุกครั้งที่ฝาก/ถอน — Dashboard อ่านจาก sheet นี้ ไม่ต้อง SUM transactions

---

## 5. BEHAVIOR_MASTER — รายการพฤติกรรม (ตั้งค่าได้)

| Column | Type | หมายเหตุ |
|---|---|---|
| item_id | text | **PK** (B001…) |
| type | enum(add,deduct) | เพิ่ม/หักคะแนน |
| name | text | "ช่วยงานครู", "มาสาย" |
| points | int | จำนวนคะแนน (บวกเสมอ) |
| active | boolean | |

---

## 6. BEHAVIOR_LOG — บันทึกพฤติกรรม

| Column | Type | หมายเหตุ |
|---|---|---|
| log_id | text | **PK** |
| date | date | |
| year_month | text | YYYY-MM (ใช้คิดคะแนนรายเดือน) |
| citizen_id | text(13) | |
| item_id | text | FK → BEHAVIOR_MASTER |
| points_change | int | +/- |
| points_after | int | คะแนนหลังบันทึก (ในเดือนนั้น) |
| note | text | |
| recorded_by | text | |
| created_at | datetime | |

> **คะแนนเดือนปัจจุบัน** = `behavior_start (20)` + ผลรวม `points_change` ของ `year_month` ปัจจุบัน
> วันที่ 1 ของเดือนใหม่ → ยังไม่มี log → คะแนน = 20 อัตโนมัติ (รีเซ็ตโดยปริยาย)

---

## 7. HEALTH_CHECK — ตรวจสุขภาพ (สุขอนามัย)

| Column | Type | หมายเหตุ |
|---|---|---|
| check_id | text | **PK** |
| date | date | |
| citizen_id | text(13) | |
| hair | enum(ผ่าน,ไม่ผ่าน) | ผม |
| nails | enum(ผ่าน,ไม่ผ่าน) | เล็บ |
| cup | enum(ผ่าน,ไม่ผ่าน) | แก้วน้ำ |
| toothbrush | enum(ผ่าน,ไม่ผ่าน) | แปรงสีฟัน |
| toothpaste | enum(ผ่าน,ไม่ผ่าน) | ยาสีฟัน |
| note | text | |
| recorded_by | text | |
| created_at | datetime | |

> Unique: (date, citizen_id) — กันบันทึกซ้ำในวันเดียว

---

## 7b. GROWTH — การเจริญเติบโต (น้ำหนัก/ส่วนสูง/BMI)

| Column | Type | หมายเหตุ |
|---|---|---|
| growth_id | text | **PK** (GRW-xxxxxxxx) |
| date | date | วันที่ชั่ง/วัด |
| citizen_id | text(13) | FK → STUDENTS |
| weight | number | กก. |
| height | number | ซม. |
| bmi | number | คำนวณ = weight / (height_m)^2 |
| zscore | number | BMI-for-age z-score (WHO) — คำนวณจากเพศ+อายุ |
| bmi_label | text | แปลผล: ผอมมาก/ผอม/สมส่วน/น้ำหนักเกิน/อ้วน |
| note | text | |
| recorded_by | text | |
| created_at | datetime | |

> เก็บได้หลายครั้งต่อคน (ติดตามแนวโน้ม) · Unique = (date, citizen_id) กันซ้ำในวันเดียว
> **แปลผลด้วยเกณฑ์ WHO BMI-for-age z-score** (WHO 2006 อายุ 0-5 + WHO 2007 อายุ 5-19) อิงเพศ+อายุ
> ค่า LMS เก็บใน `backend/GrowthData.gs` (+ `frontend/js/growth-lms.js`) — สร้างจากไฟล์ทางการ WHO

---

## 7c. SCHOLARSHIP — ทุนการศึกษา

| Column | Type | หมายเหตุ |
|---|---|---|
| scholarship_id | text | **PK** (SCH-xxxxxxxx) |
| date | date | วันที่ได้รับทุน |
| year | text | ปีการศึกษา (พ.ศ. จาก SETTINGS.current_year) — ใช้สรุปรายปี |
| citizen_id | text(13) | FK → STUDENTS |
| name | text | ชื่อทุน |
| amount | number | จำนวนเงิน |
| note | text | |
| recorded_by | text | |
| created_at | datetime | |

> บันทึกได้หลายทุนต่อคน · สรุปตามปีการศึกษา + รายชั้น · แสดงในโปรไฟล์นักเรียนด้วย

---

## 7d. SCOUT_* — คะแนนกิจกรรมลูกเสือ (4 sheets)

**SCOUT_GROUP** — หมู่ลูกเสือ

| Column | Type | หมายเหตุ |
|---|---|---|
| group_id | text | **PK** (SG-xxxxxxxx) |
| name | text | ชื่อหมู่ (ไม่ซ้ำในปีเดียวกัน) |
| year | text | ปีการศึกษา (พ.ศ.) |
| note / created_at / updated_at | | |

**SCOUT_MEMBER** — สมาชิกในหมู่

| Column | Type | หมายเหตุ |
|---|---|---|
| member_id | text | **PK** (SM-xxxxxxxx) |
| group_id | text | FK → SCOUT_GROUP |
| citizen_id | text(13) | FK → STUDENTS · 1 คน อยู่ได้ 1 หมู่/ปี |
| created_at | datetime | |

**SCOUT_ACTIVITY** — กิจกรรมให้คะแนน

| Column | Type | หมายเหตุ |
|---|---|---|
| activity_id | text | **PK** (SA-xxxxxxxx) |
| name | text | ชื่อกิจกรรม |
| task | text | ชื่องานที่มอบหมาย |
| max_score | number | คะแนนเต็ม |
| year / date / note / created_at / updated_at | | |

**SCOUT_SCORE** — คะแนนรายหมู่

| Column | Type | หมายเหตุ |
|---|---|---|
| score_id | text | **PK** (SS-xxxxxxxx) |
| activity_id | text | FK → SCOUT_ACTIVITY |
| group_id | text | FK → SCOUT_GROUP |
| score | number | ≤ คะแนนเต็มของกิจกรรม |
| note / recorded_by / date / created_at | | |

> Unique = (activity_id, group_id) — บันทึกซ้ำ = อัปเดต
> **สมาชิกทุกคนในหมู่ได้คะแนนเท่ากัน** (เก็บคะแนนระดับหมู่ ไม่เก็บรายคน)

---

## 8. ATTENDANCE — เช็คการมาเรียน

| Column | Type | หมายเหตุ |
|---|---|---|
| att_id | text | **PK** |
| date | date | |
| citizen_id | text(13) | |
| status | enum(มา,ขาด,ลา,สาย) | |
| note | text | |
| recorded_by | text | |
| created_at | datetime | |

> Unique: (date, citizen_id) — กันเช็คซ้ำ

---

## 9. USERS — ผู้ใช้งาน / ผู้บันทึก

| Column | Type | หมายเหตุ |
|---|---|---|
| user_id | text | **PK** (U001…) |
| name | text | ชื่อผู้ใช้/ครู |
| role | enum(admin,teacher,bank,viewer) | สิทธิ์ |
| active | boolean | |
| created_at | datetime | |

> ใช้เป็นรายชื่อ "ผู้บันทึก" (recorded_by) และกำหนดบทบาท · PIN ของแต่ละโมดูลเก็บใน SETTINGS

---

## 10. AUDIT_LOG — บันทึกการใช้งาน

| Column | Type | หมายเหตุ |
|---|---|---|
| log_id | text | **PK** |
| timestamp | datetime | |
| action | text | CREATE/UPDATE/DELETE/LOGIN/IMPORT |
| module | text | settings/bank/behavior/health/attendance/students |
| target_id | text | id ของ record |
| details | text | JSON |
| recorded_by | text | |

---

## ความสัมพันธ์ (Relationships)

```
STUDENTS (citizen_id) ─┬─< BANK_TRANSACTIONS
                       ├─── BANK_BALANCE (1:1)
                       ├─< BEHAVIOR_LOG
                       ├─< HEALTH_CHECK
                       └─< ATTENDANCE
BEHAVIOR_MASTER (item_id) ─< BEHAVIOR_LOG
USERS (name) ─ recorded_by ─ ทุก sheet ที่มีการบันทึก
```
