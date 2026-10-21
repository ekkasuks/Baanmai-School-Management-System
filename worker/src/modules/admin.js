/**
 * Admin — ย้ายข้อมูล (migration) จาก Google Sheets เข้ามา D1
 * รับ JSON รูปแบบเดียวกับ settings.backup เดิม: { data: { TABLE: [rowObjs...] } }
 * ป้องกันด้วย admin_key (ตั้งผ่าน `wrangler secret put ADMIN_KEY`)
 */
import { TABLES, insertRows, clearTable, readAll, apiError } from '../db.js';

function requireAdmin(params, ctx) {
  const key = ctx.env && ctx.env.ADMIN_KEY;
  if (!key) apiError('CONFIG', 'ยังไม่ได้ตั้ง ADMIN_KEY (wrangler secret put ADMIN_KEY)');
  if (!params.admin_key || params.admin_key !== key) apiError('PIN_INVALID', 'admin_key ไม่ถูกต้อง');
}

export const AdminAPI = {

  /**
   * import ข้อมูลทั้งก้อน — ลบของเดิมในตารางที่ส่งมาแล้วเขียนใหม่ (ทับ)
   * params = { admin_key, backup:{data:{TABLE:[...]}}, tables?:[...] (เลือกเฉพาะบางตาราง) }
   */
  import: async function (params, ctx) {
    requireAdmin(params, ctx);
    const data = params.backup && params.backup.data;
    if (!data || typeof data !== 'object') apiError('VALIDATION', 'ไม่พบ backup.data');

    const only = Array.isArray(params.tables) ? params.tables : null;
    const report = {};
    for (const table of Object.keys(data)) {
      if (!TABLES[table]) { report[table] = 'ข้าม (ไม่รู้จักตาราง)'; continue; }
      if (TABLES[table].secret) { report[table] = 'ข้าม (ข้อมูลผู้ใช้/รหัสผ่าน)'; continue; }
      if (only && only.indexOf(table) < 0) continue;
      const rows = data[table] || [];
      await clearTable(ctx.db, table);
      let n = 0;
      for (let i = 0; i < rows.length; i += 50) {   // chunk กัน batch ใหญ่เกิน · OR REPLACE กัน PK ซ้ำในต้นทาง
        n += await insertRows(ctx.db, table, rows.slice(i, i + 50), true);
      }
      report[table] = n;
    }
    return { imported: report };
  },

  /** นับจำนวนแถวแต่ละตาราง — ไว้ตรวจหลัง import ว่าครบ */
  stats: async function (params, ctx) {
    requireAdmin(params, ctx);
    const out = {};
    for (const table of Object.keys(TABLES)) {
      out[table] = (await readAll(ctx.db, table)).length;
    }
    return { counts: out };
  },
};
