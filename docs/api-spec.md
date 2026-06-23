# API Spec — Apps Script Web App

> โครงร่าง API · จะเติมรายละเอียดทีละ Module ตอนสร้างจริง

## รูปแบบกลาง

ทุก request เป็น **POST** ไปยัง Web App URL เดียว body เป็น JSON (ส่งแบบ `text/plain` เพื่อเลี่ยง CORS preflight)

**Request**
```json
{ "action": "module.method", "token": "<pin-token|null>", "params": { } }
```

**Response**
```json
{ "ok": true,  "data": { },   "error": null }
{ "ok": false, "data": null,  "error": { "code": "PIN_INVALID", "message": "PIN ไม่ถูกต้อง" } }
```

`GET ?action=ping` → health check

## Error codes

`VALIDATION` · `NOT_FOUND` · `PIN_INVALID` · `TOKEN_EXPIRED` · `INSUFFICIENT_FUNDS` · `DUPLICATE` · `CONFIG` · `INTERNAL`

## Endpoints (วางแผนตาม Module)

| action | PIN | คำอธิบาย |
|---|---|---|
| `settings.init` | — | สร้าง sheet ทั้งหมด + ค่า default |
| `settings.get` / `settings.update` | — | อ่าน/แก้ตั้งค่าโรงเรียน |
| `settings.backup` / `settings.restore` | admin | สำรอง/กู้คืนข้อมูล |
| `students.import_dmc` | — | นำเข้า DMC (ทีละ chunk) |
| `students.list` / `students.get` / `students.update` / `students.stats` | — | ทะเบียนนักเรียน |
| `students.profile` | — | โปรไฟล์รายบุคคล (รวมข้ามโมดูล: ธนาคาร/พฤติกรรม/สุขภาพ/มาเรียน) |
| `auth.verify_pin` / `auth.check` | — | ตรวจ PIN → ออก token |
| `bank.deposit` / `bank.withdraw` / `bank.history` / `bank.passbook` / `bank.dashboard` | 127 | ธนาคาร |
| `bank.classes` / `bank.by_class` | 127 | เลือกชั้น → รายชื่อนักเรียน+ยอดเงิน (แทนการพิมพ์ค้นหา) |
| `behavior.master_list` / `behavior.master_save` / `behavior.master_delete` | — | จัดการรายการพฤติกรรม (add/deduct) |
| `behavior.classes` / `behavior.by_class` | — | เลือกชั้น → รายชื่อนักเรียน+คะแนน (แทนการพิมพ์ค้นหา) |
| `behavior.record` / `behavior.student_score` | — | บันทึก · คะแนน+ประวัติรายคน (รายเดือน) |
| `behavior.history` / `behavior.ranking` / `behavior.dashboard` | — | ประวัติ · อันดับรายเดือน · ภาพรวม (รับ `year_month`) |
| `health.classes` / `health.by_class` | — | เลือกชั้น → รายชื่อ+ผลตรวจของวันนั้น (pre-fill) |
| `health.save` / `health.history` / `health.dashboard` | — | บันทึกรายชั้น (upsert date+citizen_id) · ประวัติ · ภาพรวมรายวัน |
| `growth.classes` / `growth.by_class` / `growth.save` | — | การเจริญเติบโต: เลือกชั้น · บันทึกน้ำหนัก/ส่วนสูง (คำนวณ BMI + แปลผล WHO BMI-for-age z-score · upsert date+citizen_id) |
| `growth.dashboard` / `growth.student` / `growth.search` | — | ภาพรวม BMI (ค่าล่าสุด/รายชั้น) · ประวัติรายบุคคล (กราฟแนวโน้ม) |
| `scholarship.classes` / `scholarship.years` / `scholarship.by_class` | — | ทุนการศึกษา: เลือกชั้น+ปี → รายชื่อ+ยอดทุนรวมปีนั้น |
| `scholarship.record` / `scholarship.delete` / `scholarship.student` | — | บันทึก/ลบทุน · รายการทุนของนักเรียน |
| `scholarship.history` / `scholarship.dashboard` | — | ประวัติ · สรุปรายปี (รวมเงิน/รายชั้น/ผู้รับสูงสุด) |
| `attendance.classes` / `attendance.by_class` | 127 | เลือกชั้น → รายชื่อ+สถานะของวันนั้น (pre-fill) |
| `attendance.save` / `attendance.history` / `attendance.dashboard` | 127 | บันทึกรายชั้น (upsert date+citizen_id) · ประวัติ · ภาพรวมรายวัน |
| `dashboard.summary` | — | Dashboard หลัก (รวมตัวเลขทุกโมดูล อ่าน sheet ตรง ไม่ผ่าน PIN) |
