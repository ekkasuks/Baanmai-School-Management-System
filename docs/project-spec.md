# Project Spec — ระบบบริหารงานนักเรียน โรงเรียนบ้านใหม่

> Step 1: วิเคราะห์ระบบ — เอกสารนี้คือข้อกำหนดหลักของโปรเจกต์

## 1. ภาพรวม

Web App สำหรับโรงเรียนประถม **บ้านใหม่** ใช้บริหารงานนักเรียน 6 ด้าน
ออกแบบให้ **น่ารัก สดใส ใช้ง่าย โหลดเร็ว** รองรับทั้งมือถือและคอมพิวเตอร์

- ขนาดข้อมูลโดยประมาณ: ~100 นักเรียน (อนุบาล–ป.6)
- ผู้ใช้: ครู / เจ้าหน้าที่ธนาคารโรงเรียน / ผู้บริหาร / ผู้ดูแลระบบ

## 2. สถาปัตยกรรม (Architecture)

```
[ Browser / มือถือ ]
        │  (HTTPS, fetch POST text/plain)
        ▼
[ GitHub Pages ]  ──静态──  HTML + CSS + JS (Bootstrap 5)
        │  เรียก API
        ▼
[ Google Apps Script Web App ]  ── API Layer (doPost) ──
        │  Batch read/write + CacheService
        ▼
[ Google Sheets ]  ── Database (10 sheets) ──
```

**หลักการสำคัญ:** Frontend **ไม่อ่าน Google Sheet โดยตรง** — ทุกอย่างผ่าน Apps Script API เท่านั้น

## 3. เทคโนโลยี

| ส่วน | เทคโนโลยี |
|---|---|
| Frontend | HTML, CSS, JavaScript, Bootstrap 5 |
| Database | Google Sheets |
| API | Google Apps Script (doPost / doGet) |
| Hosting | GitHub Pages |
| Build & Deploy | GitHub Actions |
| PDF Export | jsPDF |
| Chart | Chart.js |
| Font | Sarabun (เก็บไฟล์ฟอนต์ใน repo `frontend/assets/fonts/`) |
| ตัวอ่าน Excel (DMC) | SheetJS (xlsx) |

**ตัวอักษร:** เนื้อหา 16px · หัวข้อ 18px · ฟอนต์ Sarabun

## 4. เมนูระบบ (6 เมนู + Dashboard หลัก)

| # | เมนู | PIN | ฟีเจอร์หลัก |
|---|---|---|---|
| 1 | ตั้งค่าระบบ | (admin) | ปี/ภาคเรียน, ข้อมูลโรงเรียน, Import DMC, Backup/Restore |
| 2 | ธนาคารโรงเรียน | **127** (วันละ 1 ครั้ง) | ฝาก/ถอน, ประวัติ, ค้นหา, สมุดบัญชี, Dashboard, PDF |
| 3 | พฤติกรรมนักเรียน | — | เริ่ม 20 คะแนน, รีเซ็ตทุกวันที่ 1, บันทึก/ประวัติ, อันดับรายเดือน, PDF |
| 4 | ตรวจสุขภาพ | ไม่ใช้ | ผม/เล็บ/แก้วน้ำ/แปรงสีฟัน/ยาสีฟัน (ผ่าน/ไม่ผ่าน), Dashboard, PDF |
| 5 | เช็คการมาเรียน | **ใช้ PIN** | มา/ขาด/ลา/สาย, Dashboard, PDF |
| 6 | ข้อมูลนักเรียน | — | ดึงจาก DMC, ค้นหา, แก้ไข, ดูรายชั้น/รายบุคคล, Dashboard |

### Dashboard หลัก
จำนวนนักเรียนทั้งหมด · เงินฝากรวม · คะแนนพฤติกรรมเฉลี่ย · ผลตรวจสุขภาพล่าสุด · สถิติมาเรียนวันนี้

## 5. กฎเชิงธุรกิจ (Business Rules)

- **ธนาคาร:** ถอนเกินยอดคงเหลือไม่ได้ · ยอดคงเหลือเก็บแยกใน `BANK_BALANCE` (ไม่ SUM ทุกครั้ง)
- **พฤติกรรม:** ทุกคนเริ่ม 20 คะแนน/เดือน · คะแนนเดือนปัจจุบัน = 20 + ผลรวมรายการในเดือนนั้น · วันที่ 1 ของเดือนใหม่จึงเริ่มที่ 20 อัตโนมัติ (สรุปเดือนเก่าเก็บเป็นประวัติ)
- **ตรวจสุขภาพ / เช็คชื่อ:** กันบันทึกซ้ำ 1 รายการ/คน/วัน (unique = date + citizen_id)
- **PIN:** กรอกวันละ 1 ครั้ง (token หมดอายุเที่ยงคืน) · เก็บเป็น hash ฝั่ง backend เท่านั้น

## 6. Performance (เป้าหมาย: โหลด ≤ 3 วินาที)

- ใช้ Apps Script เป็น API layer เดียว — ลดจำนวน API call ให้น้อยที่สุด
- Batch read/write ด้วย `getValues()` / `setValues()` ครั้งเดียว
- `CacheService` cache ผลอ่าน sheet
- `BANK_BALANCE` เป็น cache sheet ของยอดเงิน
- Dashboard ดึงข้อมูลแบบสรุป (aggregate) ก่อน แล้วค่อย lazy-load ตารางละเอียด
- โหลดข้อมูลเฉพาะที่จำเป็น + Lazy loading ตาราง

## 7. ความปลอดภัย / PDPA

- ไฟล์ DMC มีเลขบัตรประชาชนเด็ก → **ห้าม commit** (อยู่ใน `.gitignore`: `*.xlsx *.xls *.csv`)
- PIN ตรวจฝั่ง backend ทุก request ที่อ่อนไหว (ธนาคาร, เช็คชื่อ)
- ทุกการเขียนข้อมูลบันทึกลง `AUDIT_LOG`

## 8. ลำดับการพัฒนา (ห้ามสร้างพร้อมกันทั้งหมด)

ดู [todo.md](todo.md) — ทำทีละ Module → ทดสอบ → แก้ไข → จึงทำ Module ถัดไป
```
Step 1 วิเคราะห์ → Step 2 ออกแบบ DB → Step 3 ขอไฟล์ DMC →
Step 4 Module 1 ตั้งค่า/Import → ... → Dashboard หลัก → Deploy
```
