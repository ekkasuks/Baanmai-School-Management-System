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
| `auth.verify_pin` / `auth.check` | — | ตรวจ PIN → ออก token |
| `bank.deposit` / `bank.withdraw` / `bank.history` / `bank.passbook` / `bank.dashboard` | 127 | ธนาคาร |
| `behavior.master_list` / `behavior.master_save` / `behavior.master_delete` | — | จัดการรายการพฤติกรรม (add/deduct) |
| `behavior.search` / `behavior.record` / `behavior.student_score` | — | ค้นหา · บันทึก · คะแนน+ประวัติรายคน (รายเดือน) |
| `behavior.history` / `behavior.ranking` / `behavior.dashboard` | — | ประวัติ · อันดับรายเดือน · ภาพรวม (รับ `year_month`) |
| `health.record` / `health.list` / `health.dashboard` | — | ตรวจสุขภาพ |
| `attendance.record` / `attendance.list` / `attendance.dashboard` | ✓ | เช็คชื่อ |
| `dashboard.summary` | — | Dashboard หลัก |
