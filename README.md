# 🏫 ระบบบริหารงานนักเรียน โรงเรียนบ้านใหม่

Web App บริหารงานนักเรียนสำหรับโรงเรียนประถม — น่ารัก สดใส ใช้ง่าย โหลดเร็ว รองรับมือถือ

## เทคโนโลยี
HTML/CSS/JS + Bootstrap 5 · Google Sheets (DB) · Google Apps Script (API) · GitHub Pages + Actions · jsPDF · Chart.js · ฟอนต์ Sarabun

## เมนู
1. ตั้งค่าระบบ (Import DMC, Backup/Restore)
2. ธนาคารโรงเรียน (PIN 127)
3. พฤติกรรมนักเรียน (เริ่ม 20 คะแนน)
4. ตรวจสุขภาพ
5. เช็คการมาเรียน (PIN)
6. ข้อมูลนักเรียน

## โครงสร้าง
```
backend/    Google Apps Script (.gs) — API layer
frontend/   HTML/CSS/JS — deploy ไป GitHub Pages
  assets/fonts/   ฟอนต์ Sarabun (เก็บในรีโป)
docs/       เอกสารโปรเจกต์
```

## เอกสาร
- [project-spec.md](docs/project-spec.md) — วิเคราะห์ระบบ
- [database-schema.md](docs/database-schema.md) — โครงสร้าง 10 sheets
- [api-spec.md](docs/api-spec.md) — API
- [todo.md](docs/todo.md) — roadmap

> ⚠️ **PDPA:** ไฟล์ DMC มีเลขบัตรประชาชนเด็ก — `.gitignore` กันไม่ให้ commit `*.xlsx/*.xls/*.csv`
