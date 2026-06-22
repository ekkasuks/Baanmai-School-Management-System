# TODO — Roadmap (ทำทีละ Module → ทดสอบ → แก้ → ทำต่อ)

## ลำดับงาน

- [x] **Step 1** วิเคราะห์ระบบ → [project-spec.md](project-spec.md)
- [x] **Step 2** ออกแบบฐานข้อมูล (10 sheets) → [database-schema.md](database-schema.md)
- [x] **Step 3** ขอไฟล์ DMC ตัวอย่าง → finalize STUDENTS (21 คอลัมน์) → [dmc-field-map.md](dmc-field-map.md)
- [x] **Step 4** Module 1 — ตั้งค่าระบบ + Import DMC + Backup/Restore (โค้ดเสร็จ + ผ่าน local test) → รอผู้ใช้ deploy + import จริง ([setup-guide.md](setup-guide.md))
- [~] **Step 5** Module 2 — ธนาคารโรงเรียน (PIN 127): ฝาก/ถอน, Dashboard (ยอดรวม/Top10/เฉลี่ยรายชั้น/ฝาก-ถอนวันนี้), ประวัติ, สมุดบัญชี + Export PDF (jsPDF+Sarabun) + สลิป — โค้ดเสร็จ + ผ่าน syntax check → รอผู้ใช้ deploy + ทดสอบจริง
- [~] **Step 6** Module 3 — พฤติกรรม (รีเซ็ตรายเดือนโดยปริยาย): เริ่ม 20 คะแนน, รายการพฤติกรรม (จัดการ add/deduct), บันทึก, คะแนน/ประวัติรายคน, ภาพรวม (เฉลี่ย/การกระจาย/เฉลี่ยรายชั้น/สูงสุด-ต่ำสุด), อันดับรายเดือน + Export PDF, เลือกดูย้อนหลัง 12 เดือน — โค้ดเสร็จ → รอผู้ใช้ deploy + ทดสอบจริง
- [~] **Step 7** Module 4 — ตรวจสุขภาพ: บันทึกรายชั้น (5 ข้อ ผ่าน/ไม่ผ่าน · toggle ทั้งห้อง · กันซ้ำ date+citizen_id), ภาพรวมรายวัน (ผ่าน/ไม่ผ่านรายข้อ · รายชั้น · รายชื่อไม่ผ่าน) + Export PDF, ประวัติ — โค้ดเสร็จ → รอผู้ใช้ deploy + ทดสอบจริง
- [~] **Step 8** Module 5 — เช็คการมาเรียน (PIN: attendance 127): เช็คชื่อรายชั้น (มา/ขาด/ลา/สาย · กันซ้ำ date+citizen_id), ภาพรวมรายวัน (สรุปสถานะ · รายชั้น · รายชื่อไม่มา) + Export PDF, ประวัติ — โค้ดเสร็จ → รอผู้ใช้ deploy + ทดสอบจริง
- [~] **Step 9** Module 6 — ข้อมูลนักเรียน: รายชื่อ + ค้นหา/กรองรายชั้น, โปรไฟล์รายบุคคล (รวมข้ามโมดูล: เงินฝาก/พฤติกรรม/สุขภาพล่าสุด/มาเรียนเดือนนี้), แก้ไขข้อมูล, ภาพรวม (จำนวน/เพศ/รายชั้น) — โค้ดเสร็จ → รอผู้ใช้ deploy + ทดสอบจริง
- [~] **Step 10** Dashboard หลัก — `dashboard.summary` (ไม่ใช้ PIN): นักเรียน·เงินฝากรวม·คะแนนพฤติกรรมเฉลี่ย·ตรวจสุขภาพล่าสุด·มาเรียนวันนี้ → แสดงบน index.html — โค้ดเสร็จ → รอ deploy
- [x] **Step 11** GitHub Actions workflow + Deploy GitHub Pages → [deploy.yml](../.github/workflows/deploy.yml)
- [ ] **Step 12** คู่มือใช้งาน

## Definition of Done (แต่ละ Module)

- ✅ Backend API ทำงานได้จริงผ่าน Apps Script
- ✅ Frontend แสดงผลถูกต้อง Desktop + Mobile (Sarabun 16/18px)
- ✅ มี loading state + ข้อความ error ภาษาไทยที่เข้าใจง่าย
- ✅ Validation ทั้ง frontend + backend
- ✅ เขียน AUDIT_LOG
- ✅ ผู้ใช้ทดสอบฟีเจอร์หลักผ่าน

## เทคนิคที่ต้องครบ

- [ ] CacheService cache การอ่าน sheet
- [ ] PIN session (token หมดเที่ยงคืน)
- [ ] Batch read/write
- [ ] Trigger: สรุป+รีเซ็ตคะแนนพฤติกรรม (วันที่ 1), Backup รายคืน
- [ ] Bundle ฟอนต์ Sarabun ใน repo
