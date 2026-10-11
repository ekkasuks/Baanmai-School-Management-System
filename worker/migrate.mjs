/**
 * ย้ายข้อมูลจาก Google Sheets (Apps Script) → Cloudflare D1 (Worker)
 * ดึง backup จาก API เดิม แล้วส่งเข้า Worker ใหม่ผ่าน admin.import
 *
 * วิธีรัน (ในเครื่อง):
 *   OLD_API_URL="https://script.google.com/.../exec" \
 *   NEW_API_URL="https://baanmai-sms-api.<subdomain>.workers.dev" \
 *   ADMIN_KEY="<คีย์ที่ตั้งไว้>" \
 *   node worker/migrate.mjs
 */
const OLD = process.env.OLD_API_URL;
const NEW = process.env.NEW_API_URL;
const ADMIN_KEY = process.env.ADMIN_KEY;

if (!OLD || !NEW || !ADMIN_KEY) {
  console.error('ต้องตั้ง env: OLD_API_URL, NEW_API_URL, ADMIN_KEY');
  process.exit(1);
}

async function callApi(url, body) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify(body),
  });
  const json = await res.json();
  if (!json.ok) throw new Error((json.error && json.error.message) || 'API error');
  return json.data;
}

(async function () {
  console.log('1) ดึง backup จาก Google Sheets...');
  const backup = await callApi(OLD, { action: 'settings.backup', params: {} });
  const tables = Object.keys(backup.data || {});
  console.log('   ได้ ' + tables.length + ' ตาราง:', tables.map(function (t) { return t + '(' + backup.data[t].length + ')'; }).join(', '));

  console.log('2) ส่งเข้า Cloudflare D1...');
  const r = await callApi(NEW, { action: 'admin.import', params: { admin_key: ADMIN_KEY, backup: backup } });
  console.log('   import สำเร็จ:', JSON.stringify(r.imported, null, 2));

  console.log('3) ตรวจจำนวนแถวใน D1...');
  const s = await callApi(NEW, { action: 'admin.stats', params: { admin_key: ADMIN_KEY } });
  console.log('   ', JSON.stringify(s.counts, null, 2));
  console.log('✅ เสร็จสิ้น');
})().catch(function (e) { console.error('❌', e.message); process.exit(1); });
