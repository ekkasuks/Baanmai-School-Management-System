/** Helper ที่หลายโมดูลใช้ร่วม (พอร์ตจาก Students.gs / Bank.gs ฝั่ง Apps Script) */
import { readAll, getBy } from './db.js';

/** ชื่อเต็มนักเรียน */
export function studentName(s) {
  return [s.prefix, s.first_name, s.last_name]
    .map(function (x) { return x === undefined || x === null ? '' : String(x).trim(); })
    .filter(Boolean).join(' ') || '(ไม่มีชื่อ)';
}

/** เรียงชั้น: อ.2 < อ.3 < ป.1 < ... < ป.6 */
export function gradeSortKey(g) {
  g = String(g || '');
  if (g.indexOf('อ.') === 0) return parseInt(g.slice(2), 10) || 0;
  if (g.indexOf('ป.') === 0) return 10 + (parseInt(g.slice(2), 10) || 0);
  if (g.indexOf('ม.') === 0) return 20 + (parseInt(g.slice(2), 10) || 0);
  return 99;
}

/** รายชื่อชั้น/ห้อง (distinct) ของนักเรียน active เรียงตามชั้น→ห้อง */
export async function listClasses(db) {
  const map = {};
  (await readAll(db, 'STUDENTS')).forEach(function (s) {
    if (s.status === 'inactive') return;
    const grade = s.grade || '-';
    const room = (s.room === undefined || s.room === null) ? '' : String(s.room);
    const key = grade + '|' + room;
    if (!map[key]) map[key] = { grade: grade, room: room, count: 0 };
    map[key].count++;
  });
  return Object.keys(map).map(function (k) { return map[k]; }).sort(function (a, b) {
    const d = gradeSortKey(a.grade) - gradeSortKey(b.grade);
    return d !== 0 ? d : (parseInt(a.room, 10) || 0) - (parseInt(b.room, 10) || 0);
  });
}

/** นักเรียน active ตามชั้น (+ห้อง ถ้าระบุ) */
export async function studentsInClass(db, grade, room) {
  return (await readAll(db, 'STUDENTS')).filter(function (s) {
    if (s.status === 'inactive') return false;
    if (String(s.grade) !== String(grade)) return false;
    if (room !== undefined && room !== null && room !== '' && String(s.room) !== String(room)) return false;
    return true;
  });
}

/** คะแนนพฤติกรรมเริ่มต้นต่อเดือน (จาก SETTINGS behavior_start, default 20) */
export async function behaviorStart(db) {
  const r = await getBy(db, 'SETTINGS', 'key', 'behavior_start');
  const n = r ? Number(r.value) : NaN;
  return isFinite(n) && n > 0 ? n : 20;
}

/** map 1 แถว DMC (object key = หัวคอลัมน์ไทย) → STUDENTS (ดู docs/dmc-field-map.md) */
export function mapDmcStudent(r) {
  const get = function (k) { return r[k] !== undefined && r[k] !== null ? String(r[k]).trim() : ''; };
  const num = function (k) {
    const v = get(k);
    if (!v) return '';
    const n = parseFloat(v);
    return isNaN(n) || n === 0 ? '' : n;
  };
  let lastName = get('นามสกุล');
  if (lastName === '-') lastName = '';
  const guardian = [get('คำนำหน้าชื่อผู้ปกครอง'), get('ชื่อผู้ปกครอง'), get('นามสกุลผู้ปกครอง')].filter(Boolean).join(' ');
  const address = [
    get('เลขที่บ้าน (ที่อยู่ปัจจุบัน)') ? 'เลขที่ ' + get('เลขที่บ้าน (ที่อยู่ปัจจุบัน)') : '',
    get('หมู่ (ที่อยู่ปัจจุบัน)') ? 'หมู่ ' + get('หมู่ (ที่อยู่ปัจจุบัน)') : '',
    get('ตำบล (ที่อยู่ปัจจุบัน)') ? 'ต.' + get('ตำบล (ที่อยู่ปัจจุบัน)') : '',
    get('อำเภอ (ที่อยู่ปัจจุบัน)') ? 'อ.' + get('อำเภอ (ที่อยู่ปัจจุบัน)') : '',
    get('จังหวัด (ที่อยู่ปัจจุบัน)') ? 'จ.' + get('จังหวัด (ที่อยู่ปัจจุบัน)') : '',
    get('รหัสไปรษณีย์ (ที่อยู่ปัจจุบัน)'),
  ].filter(Boolean).join(' ');
  return {
    citizen_id: get('เลขประจำตัวประชาชน'), student_code: get('รหัสนักเรียน'),
    prefix: get('คำนำหน้าชื่อ'), first_name: get('ชื่อ'), last_name: lastName,
    gender: get('เพศ'), grade: get('ชั้น'), room: parseInt(get('ห้อง'), 10) || 1,
    birth_date: get('วันเกิด'), blood_type: get('หมู่โลหิต'), religion: get('ศาสนา'),
    nationality: get('สัญชาติ'), guardian_relation: get('ความเกี่ยวข้องของผู้ปกครองกับนักเรียน'),
    guardian_name: guardian, guardian_phone: get('หมายเลขโทรศัพท์ของผู้ปกครอง'),
    address: address, weight_init: num('น้ำหนัก'), height_init: num('ส่วนสูง'),
  };
}
