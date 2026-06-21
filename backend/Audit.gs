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
  } catch (e) {
    // อย่าให้ audit ล้มเหลวทำให้ทั้ง request พัง
    console.error('audit failed:', e);
  }
}
