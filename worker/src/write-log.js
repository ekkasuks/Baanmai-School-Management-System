/**
 * ประวัติการบันทึก (WRITE_LOG) — บันทึกทุกคำสั่งที่ "เขียนข้อมูล" สำเร็จ: ใคร (จากบัญชีที่เข้าสู่ระบบ) · เมนู · คำสั่ง · วันที่ของข้อมูล · ชั้น · จำนวน
 * เรียกจาก router (index.js) หลังคำสั่งทำงานสำเร็จ — ถ้าบันทึกประวัติล้มเหลวจะไม่ทำให้คำสั่งหลักล้มเหลว
 * ไม่เก็บรหัสผ่าน/PIN/ค่าตั้งค่า — เก็บเฉพาะฟิลด์ในรายการอนุญาต (DETAIL_KEYS)
 */
import { now, genId } from './db.js';
import { currentUser, ROLES } from './modules/tt-auth.js';

/** คำสั่งที่เขียนข้อมูล (module → actions) */
export const WRITE_ACTIONS = {
  students: ['update', 'create', 'remove', 'restore', 'purge', 'import_dmc'],
  bank: ['deposit', 'withdraw'],
  behavior: ['master_save', 'master_delete', 'record'],
  attendance: ['save', 'remove_day', 'move_day', 'trash_restore', 'holiday_save', 'holiday_delete'],
  health: ['save'],
  growth: ['save'],
  milk: ['mark_received', 'reset_all'],
  scholarship: ['record', 'delete'],
  scout: ['group_save', 'group_delete', 'member_role', 'member_add', 'member_remove', 'activity_save', 'activity_delete', 'score_save'],
  settings: ['update', 'init', 'backup', 'restore', 'promote'],
  acad: ['mult_set', 'mult_set_many', 'gb_course_save', 'gb_item_save', 'gb_item_remove', 'gb_score_save', 'gb_special_save', 'gb_deduct_add', 'gb_deduct_void', 'gb_submit', 'gb_unlock'],
  geo: ['save_home', 'delete_home', 'save_travel', 'link_create', 'link_submit', 'point_save', 'point_delete', 'save_config'],
  tt: ['user_save', 'user_reset_password', 'user_create_teacher', 'homeroom_save', 'homeroom_import', 'write_policy_save'],
};

export function isWrite(action) {
  const p = String(action).split('.');
  return !!(WRITE_ACTIONS[p[0]] && WRITE_ACTIONS[p[0]].indexOf(p[1]) >= 0);
}

const LIST_KEYS = ['records', 'items', 'scores', 'rows', 'citizen_ids', 'students', 'members', 'entries', 'classes'];
const TARGET_KEYS = ['citizen_id', 'course_id', 'item_id', 'group_id', 'activity_id', 'deduct_id', 'user_id', 'teacher_id', 'point_id', 'key'];
const DETAIL_KEYS = ['required', 'amount', 'type', 'status', 'points', 'month', 'year', 'reason', 'title', 'table_no', 'passed', 'from', 'to', 'to_date', 'role', 'username'];

function str(v, n) { return v == null ? '' : String(v).slice(0, n || 60); }

/** บันทึก 1 แถว — ctx เดียวกับที่ส่งให้คำสั่ง (ใช้ผู้ใช้ที่ cache ไว้แล้ว ไม่ query ซ้ำ) */
export async function logWrite(ctx, action, params, data) {
  try {
    const p = String(action).split('.'), params0 = params || {};
    const u = await currentUser(ctx);
    let n = 1;
    for (const k of LIST_KEYS) if (Array.isArray(params0[k])) { n = params0[k].length; break; }
    let target = '';
    for (const k of TARGET_KEYS) if (params0[k] != null && params0[k] !== '' && typeof params0[k] !== 'object') { target = str(params0[k], 80); break; }
    const detail = {};
    DETAIL_KEYS.forEach(function (k) { if (params0[k] != null && params0[k] !== '' && typeof params0[k] !== 'object') detail[k] = str(params0[k], 100); });
    if (data && typeof data === 'object' && data.saved != null) detail.saved = data.saved;
    await ctx.db.prepare('INSERT INTO WRITE_LOG (log_id, at, user_id, user_name, role, module, action, ref_date, grade, room, n, target, detail, ip) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)')
      .bind(genId('WL'), now(), u ? u.user_id : '', u ? (u.display_name || u.username) : '', u ? ((ROLES[u.role] && ROLES[u.role].label) || u.role) : '',
        p[0], p[1] || '', str(params0.date || params0.to_date || '', 10), str(params0.grade, 20), str(params0.room, 10), n, target,
        Object.keys(detail).length ? JSON.stringify(detail) : '', str(ctx.ip, 45))
      .run();
  } catch (e) { /* ประวัติล้มเหลวไม่ทำให้คำสั่งหลักล้มเหลว */ }
}
