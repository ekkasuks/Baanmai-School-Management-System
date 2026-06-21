# คู่มือติดตั้ง & ทดสอบ Module 1

ทำตามลำดับ 1 → 6 จะได้ระบบที่นำเข้านักเรียน 103 คนจาก DMC ได้จริง

---

## 1. สร้าง Google Spreadsheet (ฐานข้อมูล)

1. ไปที่ [sheets.new](https://sheets.new) สร้างไฟล์ใหม่ ตั้งชื่อ **BaanmaiSMS_DB**
2. คัดลอก **Spreadsheet ID** จาก URL — ส่วนระหว่าง `/d/` กับ `/edit`
   `https://docs.google.com/spreadsheets/d/`**`<<นี่คือ ID>>`**`/edit`

## 2. สร้าง Apps Script (Backend / API)

1. ในไฟล์ Sheet → เมนู **Extensions → Apps Script**
2. ลบไฟล์ `Code.gs` เดิมทิ้ง แล้วสร้างไฟล์ตามนี้ (กดเครื่องหมาย + → Script) วางโค้ดจากโฟลเดอร์ `backend/`:
   - `Code.gs` · `Sheets.gs` · `Auth.gs` · `Settings.gs` · `Students.gs` · `Audit.gs`
   - (ถ้าใช้ **clasp** ดูข้อ 2.1 — push ทีเดียว)
3. ตั้งค่า **Script Property**:
   - ⚙️ **Project Settings → Script Properties → Add script property**
   - Property = `SHEET_ID` · Value = ID จากข้อ 1 → **Save**
4. รัน `setup` ครั้งเดียว: เลือกฟังก์ชัน **setup** ด้านบน → **Run** → อนุญาตสิทธิ์ (ครั้งแรก)
   - จะสร้าง 10 sheets + ค่าเริ่มต้น (PIN ธนาคาร/เช็คชื่อ = 127)

### 2.1 (ทางเลือก) ใช้ clasp push ทั้งโฟลเดอร์
```bash
npm i -g @google/clasp
clasp login
clasp clone <SCRIPT_ID>      # หรือ clasp create
# คัดลอกไฟล์ backend/*.gs + appsscript.json เข้าโฟลเดอร์ clasp แล้ว
clasp push
```

## 3. Deploy เป็น Web App

1. ใน Apps Script → **Deploy → New deployment**
2. Type = **Web app**
3. ตั้งค่า:
   - **Execute as:** Me
   - **Who has access:** Anyone
4. **Deploy** → คัดลอก **Web App URL** (ลงท้าย `/exec`)

> เปลี่ยนโค้ดภายหลัง ต้อง **Deploy → Manage deployments → ✏️ → Version: New → Deploy** ทุกครั้ง

## 4. ตั้งค่า Frontend

แก้ไฟล์ [frontend/js/config.js](../frontend/js/config.js):
```js
window.API_URL = "วาง Web App URL /exec ที่ได้จากข้อ 3";
```

## 5. ทดสอบ Module 1 🎯

เปิด `frontend/index.html` (ดับเบิลคลิก หรือผ่าน GitHub Pages — ดูข้อ 6):

1. **เชื่อมต่อ:** หน้าแรกต้องขึ้น `✅ เชื่อมต่อ Apps Script สำเร็จ`
2. **ตั้งค่า → ระบบ →** กด **ทดสอบเชื่อมต่อ** (เห็นเวลา) แล้วกด **สร้าง Sheet ทั้งหมด**
3. **ตั้งค่า → ข้อมูลโรงเรียน:** กรอกชื่อ/ผอ./ปีการศึกษา → บันทึก
4. **ตั้งค่า → นำเข้า DMC:** เลือกไฟล์ `2569-1-studentInSchoolList.xlsx` → เห็น “พบ 103 แถว / 91 คอลัมน์” → **เริ่มนำเข้า**
   - ✅ ผลลัพธ์ควรเป็น: **เพิ่มใหม่ 103 คน** (รวมนักเรียนรหัส G 26 คน)
5. กลับหน้าแรก → การ์ด “นักเรียนทั้งหมด” = **103**, ชาย/หญิง = **59 / 44**
6. **ตั้งค่า → สำรองข้อมูล:** กด ดาวน์โหลดไฟล์สำรอง (ได้ไฟล์ `.json`)

> ⚠️ ไฟล์ DMC ห้ามอัปขึ้น GitHub (`.gitignore` กันไว้แล้ว — PDPA)

## 6. Deploy ขึ้น GitHub Pages (อัตโนมัติด้วย GitHub Actions)

1. Push โค้ดขึ้น GitHub (branch `main`)
2. **Settings → Pages → Build and deployment → Source = GitHub Actions**
3. ทุกครั้งที่แก้ไฟล์ใน `frontend/` แล้ว push → workflow [deploy.yml](../.github/workflows/deploy.yml) จะ deploy ให้เอง
4. ได้ URL: `https://<username>.github.io/<repo>/`

---

## แก้ปัญหาที่พบบ่อย

| อาการ | วิธีแก้ |
|---|---|
| `ยังไม่ได้ตั้งค่า API_URL` | ใส่ URL ใน `js/config.js` |
| `SHEET_ID not set` | เพิ่ม Script Property `SHEET_ID` |
| กดอะไรก็ Failed to fetch | Deploy ตั้ง Who has access = **Anyone**; แก้โค้ดแล้วต้อง re-deploy version ใหม่ |
| Import แล้วข้ามบางแถว | รหัสประชาชนไม่ครบ 13 อักขระ — ตรวจไฟล์ DMC |
