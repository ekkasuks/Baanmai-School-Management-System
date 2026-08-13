/**
 * Audit log — บันทึกทุกการเขียนข้อมูล
 */
function audit(moduleName, action, targetId, details, recordedBy) {
  try {
    appendRows('AUDIT_LOG', [{
      log_id: genId('LOG'),
      timestamp: now(),
      action: action,
      module: moduleName,
      target_id: targetId || '',
      details: typeof details === 'string' ? details : JSON.stringify(details || {}),
      recorded_by: recordedBy || 'system',
    }]);
    maybeTrimAuditLog();
  } catch (e) {
    // อย่าให้ audit ล้มเหลวทำให้ทั้ง request พัง
    console.error('audit failed:', e);
  }
}

const AUDIT_MAX = 5000;   // ถ้าเกินจำนวนนี้ → ตัดแถวเก่าออก
const AUDIT_KEEP = 3000;  // เหลือแถวล่าสุดไว้เท่านี้

/**
 * ตัด AUDIT_LOG ไม่ให้บวมเกินไป (ไฟล์ใหญ่ = เปิด/อ่าน spreadsheet ช้าลงทั้งระบบ)
 * - สุ่มตรวจ ~3% ของการเขียน เพื่อไม่ให้เพิ่ม overhead (getLastRow) ทุกครั้ง
 * - ⚠️ ไม่ใช้ script lock: audit() มักถูกเรียกขณะ caller ถือ lock อยู่ (เช่น deposit)
 *   ถ้าปลดล็อกที่นี่จะทำให้ caller เสียการป้องกัน race — AUDIT_LOG เป็น log จึงยอมรับความเสี่ยงเล็กน้อยได้
 */
function maybeTrimAuditLog() {
  if (Math.random() > 0.03) return;
  try {
    const sh = getSheet('AUDIT_LOG');
    const rows = sh.getLastRow() - 1;   // ไม่นับ header
    if (rows <= AUDIT_MAX) return;
    sh.deleteRows(2, rows - AUDIT_KEEP); // ลบแถวเก่าสุด (บนสุด) ทีเดียว
    invalidateCache('AUDIT_LOG');
  } catch (e) {
    console.error('trim audit failed:', e);
  }
}

/** ตัด AUDIT_LOG ด้วยมือ (เรียกจาก editor ได้ทันที ถ้าอยากล้างเดี๋ยวนั้น) */
function trimAuditLogNow() {
  const sh = getSheet('AUDIT_LOG');
  const rows = sh.getLastRow() - 1;
  if (rows > AUDIT_KEEP) { sh.deleteRows(2, rows - AUDIT_KEEP); invalidateCache('AUDIT_LOG'); }
  return { before: rows, after: Math.min(rows, AUDIT_KEEP) };
}
