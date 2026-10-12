/**
 * ตั้งค่า URL ของ Backend API
 * ปัจจุบัน: Cloudflare Worker + D1 (เร็วกว่า Apps Script)
 *
 * Rollback: ถ้า Worker มีปัญหา ให้สลับกลับไปใช้ Apps Script (บรรทัดที่ comment ไว้)
 */
window.API_URL = "https://baanmai-sms-api.ekkasuks.workers.dev";
// window.API_URL = "https://script.google.com/macros/s/AKfycbyw5ha2DmNmMVsVrOqdim9f6MxvCMhi-qaSFLVE-JJz4lsU7-K1LlxJWbvifErbeC4vuQ/exec"; // Apps Script เดิม (สำรอง)
window.APP_VERSION = "2.0.0";
