# ย้ายฐานข้อมูล: Google Sheets → Cloudflare Workers + D1

เป้าหมาย: เร็วขึ้น (edge ~50ms, ไม่มี cold start แบบ Apps Script) · ฟรี · ไม่พักตอนปิดเทอม · **ข้อมูลเดิมไม่หาย**

> หลักการ: Worker (JavaScript) = API layer แทน Apps Script · D1 (SQLite) = ฐานข้อมูลแทน Sheets ·
> frontend ใช้ contract เดิม `{ok,data,error}` → แค่เปลี่ยน `API_URL` ตอนจบ

## สถานะการพอร์ต (ทำทีละโมดูล · ทดสอบก่อนไปต่อ)

- [x] โครงสร้าง: `schema.sql` (18 ตาราง), Worker scaffold, data-access layer (`db.js`)
- [x] โมดูล **settings** (get/update/init) + **auth** (PIN → SESSIONS table)
- [x] **admin.import** — ย้ายข้อมูลจาก backup ของ Sheets (lossless) + `admin.stats`
- [ ] students · bank · behavior · attendance · (+report) · health · growth · milk · scholarship · scout · dashboard
- [ ] สลับ `frontend/js/config.js` → Worker URL (หลังพอร์ตครบ + ทดสอบ)

ระหว่างนี้ **ระบบเดิม (Sheets) ยังทำงานปกติ** — Worker สร้างคู่ขนาน ยังไม่แตะของเดิม

## ขั้นตอนติดตั้ง (ครั้งเดียว)

ต้องมีบัญชี Cloudflare (ฟรี) และ Node (มีแล้ว) ทำในเครื่อง:

```bash
cd worker
npx wrangler login                      # เปิดเบราว์เซอร์ให้อนุญาต Cloudflare
npx wrangler d1 create baanmai_sms      # สร้างฐานข้อมูล → คัดลอก database_id ที่ได้
```
เอา `database_id` ที่ได้ไปวางใน `worker/wrangler.toml` (แทน `PASTE_DATABASE_ID_HERE`)

```bash
npm run db:init                         # สร้าง 18 ตารางจาก schema.sql (--remote)
npx wrangler secret put ADMIN_KEY       # ตั้งรหัสลับสำหรับ migration (พิมพ์อะไรก็ได้ที่เดา-ยาก จำไว้)
npx wrangler deploy                     # deploy → ได้ URL เช่น https://baanmai-sms-api.<ชื่อ>.workers.dev
```

ทดสอบว่า Worker มีชีวิต: เปิด `https://baanmai-sms-api.<ชื่อ>.workers.dev/?action=ping` ต้องได้ `{"ok":true,...}`

## ย้ายข้อมูลจริง (ไม่หาย)

ดึง backup จาก Apps Script เดิม → ยัดเข้า D1 อัตโนมัติ:

```bash
OLD_API_URL="<URL Apps Script เดิม /exec>" \
NEW_API_URL="https://baanmai-sms-api.<ชื่อ>.workers.dev" \
ADMIN_KEY="<รหัสที่ตั้งไว้>" \
node worker/migrate.mjs
```
สคริปต์จะ: ดึง `settings.backup` → `admin.import` (ลบของเดิมใน D1 แล้วเขียนใหม่) → `admin.stats` โชว์จำนวนแถวแต่ละตารางให้ตรวจว่าครบ
รันซ้ำได้ (import = เขียนทับ) · PIN ที่ migrate มายังใช้ได้ (hash สูตรเดียวกับเดิม)

## ทดสอบหลังย้าย

- `?action=ping` → ok
- `settings.get` → เห็นชื่อโรงเรียน (PIN โชว์เป็น `***`)
- `auth.verify_pin` ด้วย module `bank`, pin `127` → ได้ token
- `admin.stats` → จำนวนแถวตรงกับใน Sheets

## เมื่อพอร์ตครบทุกโมดูล

แก้ `frontend/js/config.js` → `window.API_URL = "https://baanmai-sms-api.<ชื่อ>.workers.dev"`
ทดสอบทุกเมนู เทียบกับ Sheets → ผ่านแล้วค่อยปลด Apps Script (เก็บ Sheets เป็น backup ได้)

## โครงไฟล์

```
worker/
  schema.sql          18 ตาราง + index (+ SESSIONS)
  wrangler.toml       ตั้งค่า D1 binding
  package.json        type:module + scripts
  migrate.mjs         ย้ายข้อมูล Sheets → D1
  src/
    index.js          fetch + router + CORS + {ok,data,error}
    db.js             readAll/getBy/insertRows/upsert/updateWhere/deleteWhere + date/id/hashPin
    modules/
      settings.js  auth.js  admin.js
```
