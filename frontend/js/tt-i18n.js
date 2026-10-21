/**
 * ภาษาไทย / English สำหรับหน้าระบบจัดตารางสอน (timetable*.html)
 * แปลข้อความ "ส่วนติดต่อผู้ใช้" ด้วยพจนานุกรม (ข้อความเดิมเป็นไทย) — ข้อมูลที่ผู้ใช้กรอก (ชื่อวิชา/ครู) คงเดิม
 * ทำงานกับ DOM ทุกครั้งที่มีการวาดใหม่ (MutationObserver) จึงไม่ต้องแก้โค้ดของแต่ละโมดูล
 * ข้อความที่ยังไม่มีในพจนานุกรมจะแสดงเป็นภาษาไทยตามเดิม
 */
const TTi18n = (function () {
  const KEY = 'tt_lang';
  function lang() { try { return localStorage.getItem(KEY) === 'en' ? 'en' : 'th'; } catch (e) { return 'th'; } }

  const D = {
    // ── ส่วนหัว / แท็บ ──
    'จัดตารางสอนอัจฉริยะ': 'Smart Timetable', 'AI Smart Timetable System': 'AI Smart Timetable System',
    'จัดตารางสอนอัจฉริยะ — โรงเรียนบ้านใหม่': 'Smart Timetable — Baanmai School',
    'ตารางเรียน / ตารางสอน': 'Class & Teaching Timetables', 'ดูตารางเรียน / ตารางสอน': 'View timetables',
    'ตารางเรียน / ตารางสอน — โรงเรียนบ้านใหม่': 'Timetables — Baanmai School', 'วันนี้': 'Today', 'ควบชั้น': 'combined', 'คุณ': 'you',
    'ภาพรวมระบบจัดตาราง': 'Timetable overview', 'ครู': 'Teachers', 'วิชา': 'Subjects', 'ห้องเรียน': 'Rooms', 'ชั้นเรียน / ควบชั้น': 'Classes / Combined',
    'คาบเรียน': 'Periods', 'เงื่อนไข': 'Constraints', 'จัดตาราง AI': 'AI scheduler', 'ตรวจสอบ / แก้ไขตาราง': 'Check / Edit',
    'ค้นหา': 'Search', 'รายงาน / ส่งออก': 'Reports / Export', 'นำเข้า': 'Import', 'ข้อความวิ่ง': 'Announcements', 'ผู้ใช้': 'Users',
    // ── เข้าสู่ระบบ / ผู้ใช้ ──
    'เข้าสู่ระบบ': 'Sign in', 'ออกจากระบบ': 'Sign out', 'ชื่อผู้ใช้': 'Username', 'รหัสผ่าน': 'Password', 'จดจำการเข้าสู่ระบบ 30 วัน': 'Keep me signed in for 30 days',
    'เข้าสู่ระบบจัดตารางสอน': 'Sign in to Smart Timetable', 'ดูตารางเรียน (ไม่ต้องเข้าสู่ระบบ)': 'View timetables (no sign-in)',
    'ตั้งค่าผู้ดูแลระบบคนแรก': 'Create the first administrator', 'PIN ธนาคารโรงเรียน (ยืนยันว่าเป็นผู้ดูแลโรงเรียน)': 'School bank PIN (to confirm you manage this school)',
    'ชื่อที่แสดง': 'Display name', 'ยืนยันรหัสผ่าน': 'Confirm password', 'สร้างบัญชีผู้ดูแลระบบ': 'Create administrator',
    'เปลี่ยนรหัสผ่าน': 'Change password', 'รหัสผ่านเดิม': 'Current password', 'รหัสผ่านใหม่': 'New password', 'ยืนยันรหัสผ่านใหม่': 'Confirm new password',
    'อย่างน้อย 8 ตัวอักษร': 'At least 8 characters', 'รหัสผ่านไม่ตรงกัน': 'Passwords do not match',
    'ผู้ดูแลระบบ': 'Administrator', 'ผู้บริหาร': 'Director', 'ฝ่ายวิชาการ (ผู้จัดตาราง)': 'Academic (scheduler)', 'นักเรียน': 'Student', 'ผู้ปกครอง': 'Parent',
    'บัญชีนี้ใช้ดูตารางเรียนเท่านั้น': 'This account can only view timetables', 'ไปหน้าดูตาราง': 'Go to timetable view',
    'ผู้ใช้และสิทธิ์': 'Users & permissions', 'เพิ่มผู้ใช้': 'Add user', 'แก้ไขผู้ใช้': 'Edit user', 'บทบาท': 'Role', 'ผูกกับครู': 'Linked teacher', 'ผูกกับชั้นเรียน': 'Linked class',
    'ใช้งาน': 'Active', 'ปิดใช้งาน': 'Disabled', 'ถูกล็อก': 'Locked', 'เข้าใช้ล่าสุด': 'Last sign-in', 'ตั้งรหัสผ่านใหม่': 'Reset password', 'สิทธิ์ของแต่ละบทบาท': 'Role permissions',
    'การเข้าถึงหน้าดูตาราง': 'Timetable view access', 'เปิดให้ดูตารางที่เผยแพร่แล้วโดยไม่ต้องเข้าสู่ระบบ': 'Allow viewing published timetables without signing in',
    'ดูข้อมูล': 'View', 'แก้ข้อมูลพื้นฐาน': 'Edit data', 'จัด/แก้ตาราง': 'Edit timetables', 'อนุมัติ/เผยแพร่': 'Approve/publish', 'ประกาศ': 'Announce', 'จัดการผู้ใช้': 'Manage users',
    // ── ปุ่ม/คำทั่วไป ──
    'บันทึก': 'Save', 'ยกเลิก': 'Cancel', 'ตกลง': 'OK', 'แก้ไข': 'Edit', 'ลบ': 'Delete', 'เพิ่ม': 'Add', 'ปิด': 'Close', 'พิมพ์': 'Print', 'ทำสำเนา': 'Duplicate',
    'คืนค่าเริ่มต้น': 'Reset to defaults', 'บันทึกเงื่อนไข': 'Save constraints', 'บันทึกการตั้งค่า': 'Save settings', 'บันทึกเป็นฉบับใหม่': 'Save as new version',
    'จัดใหม่อีกแบบ': 'Try another', 'เริ่มจัดตารางอัตโนมัติ': 'Generate timetable', 'ดาวน์โหลดแม่แบบ Excel': 'Download Excel template', 'อ่านจากลิงก์': 'Read from link',
    'ล้างเงื่อนไข': 'Clear filters', 'เอาออก': 'Remove', 'ล็อก': 'Lock', 'ปลดล็อก': 'Unlock', 'แสดง': 'Show', 'ซ่อน': 'Hide', 'ดูตาราง': 'View',
    'ตรวจสอบ / แก้ไข': 'Check / Edit', 'เปิดในตัวตรวจสอบ / แก้ไข': 'Open in editor', 'โหลดฉบับล่าสุด': 'Load latest', 'จัดเป็นกลุ่มควบชั้น': 'Combine classes',
    'ดึงชั้นเรียนจากข้อมูลนักเรียน': 'Import classes from student data', 'สร้างคาบมาตรฐาน (7 คาบ + พักเที่ยง)': 'Create standard periods (7 + lunch)',
    'ทั้งหมด': 'All', 'ไม่มีข้อมูล': 'No data', 'กำลังโหลด...': 'Loading...', 'กำลังโหลดข้อมูล...': 'Loading data...', 'กำลังบันทึก...': 'Saving...',
    'ยังไม่มี': 'None yet', 'ยังไม่ระบุครู': 'No teacher', 'ไม่ระบุครู': 'No teacher', 'ยังไม่ระบุ': 'Not set', 'ไม่บังคับ': 'optional',
    // ── หัวการ์ด ──
    'ความพร้อมก่อนจัดตาราง': 'Readiness check', 'กราฟ': 'Charts', 'เรียนควบชั้น': 'Combined classes', 'เงื่อนไขการจัดตาราง': 'Scheduling constraints',
    'AI จัดตารางอัตโนมัติ': 'AI auto-scheduling', 'ฉบับตารางที่บันทึกไว้': 'Saved versions', 'วิชาของชั้นนี้': 'Subjects of this class', 'ผลการตรวจสอบ': 'Validation results',
    'ค้นหาในตาราง': 'Search the timetable', 'หาครูว่าง (หาครูสอนแทน)': 'Find a free teacher (substitute)', 'หาเวลาว่างร่วม (นัดประชุม)': 'Find common free time (meeting)',
    'นำเข้าข้อมูล': 'Import data', 'ข้อความวิ่งที่หน้าหลัก': 'Home page announcements', 'เพิ่มประกาศ': 'New announcement', 'ข้อความทั้งหมด': 'All messages',
    'ข้อขัดแย้งที่ต้องแก้': 'Conflicts to fix', 'ข้อสังเกต': 'Notes', 'จัดตารางสำเร็จ': 'Timetable generated', 'จัดตารางได้บางส่วน': 'Partially scheduled',
    // ── หัวตาราง / ป้าย ──
    'วัน': 'Day', 'คาบ': 'Period', 'เวลา': 'Time', 'ชั้น': 'Class', 'ห้อง': 'Room', 'สถานะ': 'Status', 'ฉบับ': 'Version', 'คุณภาพ': 'Quality',
    'ข้อขัดแย้ง': 'Conflicts', 'บันทึกเมื่อ': 'Saved at', 'แถว': 'Row', 'รายการ': 'Item', 'หมายเหตุ': 'Notes', 'ประเภท': 'Type', 'ข้อความ': 'Message',
    'คำค้น': 'Keyword', 'กลุ่มสาระ (ของครู)': 'Department (teacher)', 'ประเภทวิชา': 'Subject type', 'รายชั้น': 'By class', 'รายครู': 'By teacher',
    'รายชั้นเรียน': 'By class', 'ครูผู้สอน': 'Teacher', 'ชื่อฉบับ': 'Version name', 'ชื่อฉบับ (ไม่บังคับ)': 'Version name (optional)', 'สถานะฉบับ': 'Version status',
    'แสดงชื่อครู': 'Show teachers', 'แสดงห้อง': 'Show rooms', 'ช่องลงชื่อ': 'Signature lines', 'เปิดใช้ข้อความวิ่ง': 'Enable announcements',
    'คาบที่จัดได้': 'Scheduled', 'คุณภาพตาราง': 'Quality', 'วิชาพื้นฐานช่วงบ่าย': 'Core subjects in afternoon', 'ประมวลผล': 'Processing',
    'พักกลางวัน': 'Lunch break', 'พัก': 'Break', 'ภาคเช้า': 'Morning', 'ภาคบ่าย': 'Afternoon', 'ทุกวิชา': 'All subjects',
    // ── วัน ──
    'จันทร์': 'Monday', 'อังคาร': 'Tuesday', 'พุธ': 'Wednesday', 'พฤหัสบดี': 'Thursday', 'ศุกร์': 'Friday',
    'วันจันทร์': 'Monday', 'วันอังคาร': 'Tuesday', 'วันพุธ': 'Wednesday', 'วันพฤหัสบดี': 'Thursday', 'วันศุกร์': 'Friday',
    // ── สถานะฉบับ ──
    'ร่าง': 'Draft', 'จัดเสร็จ': 'Generated', 'จัดเสร็จ (AI)': 'Generated (AI)', 'แก้ไขแล้ว': 'Edited', 'อนุมัติแล้ว': 'Approved', 'เผยแพร่แล้ว': 'Published',
    'แสดงอยู่': 'Showing', 'หมดอายุ': 'Expired', 'ใหม่': 'New', 'อัปเดต': 'Update', 'ข้าม': 'Skip', 'ผิดพลาด': 'Error', 'ถูกต้อง': 'Valid',
    // ── หน้าดูตาราง ──
    'ตารางเรียน': 'Class timetable', 'ตารางสอน': 'Teaching timetable', 'เลือกชั้นเรียน': 'Choose a class', 'เลือกครู': 'Choose a teacher',
    'ตารางของฉัน': 'My timetable', 'คัดลอกลิงก์': 'Copy link', 'คัดลอกลิงก์แล้ว': 'Link copied', 'ยังไม่มีตารางที่เผยแพร่': 'No published timetable yet',
    'ตารางนี้ยังไม่มีคาบ': 'No periods in this timetable', 'สำหรับเจ้าหน้าที่': 'Staff sign-in', 'ปรับปรุงล่าสุด': 'Last updated',
    'ต้องเข้าสู่ระบบเพื่อดูตาราง': 'Please sign in to view timetables', 'กลับหน้าหลัก': 'Back to home',
    'วิชาพื้นฐาน': 'Core', 'วิชาเพิ่มเติม': 'Elective', 'วิชาปฏิบัติ': 'Practical', 'กิจกรรม': 'Activity',
  };
  // ข้อความที่มีตัวเลข/ชื่อแทรก
  const PATTERNS = [
    [/^ปีการศึกษา (\d+) ภาคเรียนที่ (\d+)$/, 'Academic year $1, semester $2'],
    [/^คาบ (\d+)$/, 'Period $1'],
    [/^(\d+) คาบ\/สัปดาห์$/, '$1 periods/week'],
    [/^พบ ([\d,]+) คาบ$/, 'Found $1 periods'],
    [/^ตารางเรียน ชั้น (.+)$/, 'Class timetable: $1'],
    [/^ตารางสอน (.+)$/, 'Teaching timetable: $1'],
    [/^ครูประจำชั้น (.+)$/, 'Homeroom: $1'],
    [/^สอน (\d+) คาบ\/สัปดาห์$/, 'Teaches $1 periods/week'],
    [/^ทั้งหมด \((\d+)\)$/, 'All ($1)'],
    [/^ข้อผิดพลาด (\d+)$/, 'Errors $1'],
    [/^คำเตือน (\d+)$/, 'Warnings $1'],
    [/^คาบที่ผ่าน (\d+)\/(\d+)$/, 'Passed $1/$2'],
    [/^ปรับปรุงล่าสุด (.+)$/, 'Last updated $1'],
    [/^ฉบับ "(.+)"$/, 'Version "$1"'],
    [/^(.+) · (จัดเสร็จ \(AI\)|จัดเสร็จ|แก้ไขแล้ว|ร่าง|อนุมัติแล้ว|เผยแพร่แล้ว)$/, function (m, a, b) { return a + ' · ' + D[b]; }],
    [/^วิชาพื้นฐานช่วงบ่าย (\d+) · กิจกรรมช่วงเช้า (\d+)$/, 'Core subjects in afternoon $1 · activities in morning $2'],
    [/^บันทึกอัตโนมัติแล้ว (.+)$/, 'Auto-saved $1'],
    [/^ว่าง (\d+) คน/, '$1 free'],
    [/^ไม่ว่าง (\d+) คน$/, '$1 busy'],
    [/^วันนี้สอน (\d+) คาบ/, 'Teaching $1 periods today'],
  ];
  Object.assign(D, {
    'แก้แล้วบันทึกอัตโนมัติ': 'Changes save automatically', 'มีการแก้ไข — กำลังจะบันทึกอัตโนมัติ': 'Unsaved changes — saving shortly',
    'กำลังบันทึก...': 'Saving...', 'บันทึกไม่สำเร็จ — จะลองใหม่อัตโนมัติ': 'Save failed — retrying automatically', 'ฉบับนี้ถูกแก้จากเครื่องอื่น': 'Edited on another device',
    'เฉพาะชั้น/ครูที่เลือก': 'Selected class/teacher', 'ทั้งโรงเรียน': 'Whole school', 'เลือกฉบับตาราง': 'Choose a version', '— เลือกฉบับตาราง —': '— Choose a version —',
    'ลากคาบมาที่นี่เพื่อเอาออก': 'Drop here to remove', 'ดูและตรวจสอบได้อย่างเดียว (ชี้ที่คาบเพื่อดูผลตรวจ)': 'View & check only (hover a period to see results)',
    'ครูทั้งหมด': 'Teachers', 'จำนวนรายวิชา': 'Subjects', 'ระดับชั้น': 'Grades', 'คาบเรียนต่อวัน': 'Periods per day', 'ฉบับตาราง': 'Versions',
    'ตารางเรียนรายชั้น': 'Class timetables', 'ตารางสอนรายครู': 'Teacher timetables', 'ตารางการใช้ห้อง': 'Room usage', 'ตารางรวมทั้งโรงเรียน (รายวัน)': 'Whole school (by day)',
    'สรุปภาระงานสอนครู': 'Teacher workload', 'คาบรายวิชาเทียบหลักสูตร': 'Periods vs curriculum', 'รายงานผลการตรวจสอบ': 'Validation report', 'ประวัติการเปลี่ยนแปลง': 'Change history',
    'ล้างเงื่อนไข': 'Clear filters', 'ยังไม่ระบุครู (': 'No teacher (',
  });

  const SPLIT = /^([^฀-๿A-Za-z0-9"(]*)([\s\S]*?)([\s:*]*)$/;
  function tr(text) {
    const m = SPLIT.exec(text);
    if (!m || !m[2]) return null;
    const core = m[2];
    if (D[core]) return m[1] + D[core] + m[3];
    for (let i = 0; i < PATTERNS.length; i++) {
      if (PATTERNS[i][0].test(core)) return m[1] + core.replace(PATTERNS[i][0], PATTERNS[i][1]) + m[3];
    }
    return null;
  }
  const THAI = /[฀-๿]/;
  function walk(root) {
    if (root.nodeType === 3) { fixText(root); return; }
    if (root.nodeType !== 1 || root.hasAttribute && root.hasAttribute('data-no-i18n')) return;
    if (/^(SCRIPT|STYLE|TEXTAREA)$/.test(root.tagName)) return;
    ['placeholder', 'title', 'aria-label'].forEach(function (a) {
      const v = root.getAttribute && root.getAttribute(a);
      if (v && THAI.test(v)) { const t = tr(v.trim()); if (t) root.setAttribute(a, t); }
    });
    if (root.tagName === 'OPTION' || root.tagName === 'OPTGROUP') {
      if (root.label && THAI.test(root.label) && root.tagName === 'OPTGROUP') { const t = tr(root.label.trim()); if (t) root.label = t; }
    }
    const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, null);
    const list = [];
    while (w.nextNode()) list.push(w.currentNode);
    list.forEach(fixText);
    root.querySelectorAll && root.querySelectorAll('[placeholder],[title],[aria-label],optgroup').forEach(function (el) {
      if (el.closest('[data-no-i18n]')) return;
      ['placeholder', 'title', 'aria-label'].forEach(function (a) {
        const v = el.getAttribute(a);
        if (v && THAI.test(v)) { const t = tr(v.trim()); if (t) el.setAttribute(a, t); }
      });
      if (el.tagName === 'OPTGROUP' && THAI.test(el.label)) { const t = tr(el.label.trim()); if (t) el.label = t; }
    });
  }
  function fixText(n) {
    const v = n.nodeValue;
    if (!v || !THAI.test(v)) return;
    const p = n.parentNode;
    if (p && (p.closest && p.closest('[data-no-i18n],script,style,textarea'))) return;
    const lead = v.match(/^\s*/)[0], trail = v.match(/\s*$/)[0];
    const t = tr(v.trim());
    if (t && t !== v.trim()) n.nodeValue = lead + t + trail;
  }

  let observer = null;
  function start() {
    if (lang() !== 'en') return;
    document.documentElement.lang = 'en';
    const t = tr(document.title); if (t) document.title = t;
    walk(document.body);
    observer = new MutationObserver(function (muts) {
      muts.forEach(function (m) {
        if (m.type === 'characterData') fixText(m.target);
        else m.addedNodes.forEach(walk);
      });
    });
    observer.observe(document.body, { childList: true, subtree: true, characterData: true });
  }

  function updateButtons() {
    document.querySelectorAll('[data-lang-btn]').forEach(function (b) { b.textContent = lang() === 'en' ? 'ไทย' : 'EN'; b.title = lang() === 'en' ? 'เปลี่ยนเป็นภาษาไทย' : 'Switch to English'; b.setAttribute('data-no-i18n', ''); });
  }
  document.addEventListener('DOMContentLoaded', function () { updateButtons(); start(); });

  return {
    lang: lang,
    t: function (s) { return lang() === 'en' ? (tr(s) || s) : s; },
    toggle: function () {
      try { localStorage.setItem(KEY, lang() === 'en' ? 'th' : 'en'); } catch (e) { /* ignore */ }
      location.reload();   // วาดใหม่ทั้งหน้าด้วยภาษาที่เลือก
    },
    updateButtons: updateButtons,
  };
})();
