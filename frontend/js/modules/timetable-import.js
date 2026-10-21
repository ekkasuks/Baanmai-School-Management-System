/**
 * AI Smart Timetable — เฟส 5: นำเข้าข้อมูล (โมดูล 7)
 *   ประเภท: ครู · วิชา · ห้อง · ชั้นเรียน · คาบเรียน · ตารางสอน (สร้างเป็นฉบับใหม่สถานะ "ร่าง")
 *   แหล่ง: Excel (.xlsx/.xls) · CSV · JSON (ไฟล์ที่ส่งออกจากระบบนี้) · ลิงก์ Google Sheets
 *   ขั้นตอน: เลือกไฟล์ → ตรวจทุกแถวก่อน (ใหม่/อัปเดต/ข้าม/ผิดพลาด) → ยืนยัน → บันทึกครั้งเดียว (server ตรวจซ้ำ ผิดแถวเดียว = ไม่บันทึกเลย)
 *   เพิ่ม/อัปเดตเท่านั้น ไม่ลบข้อมูลเดิม · ช่องว่างในไฟล์ = คงค่าเดิม
 */
(function () {
  const esc = Utils.esc;
  const host = document.getElementById('tab-import');
  const DAY_ALIASES = { 'จันทร์': 1, 'จ': 1, 'mon': 1, 'monday': 1, 'อังคาร': 2, 'อ': 2, 'tue': 2, 'tuesday': 2, 'พุธ': 3, 'พ': 3, 'wed': 3, 'wednesday': 3,
    'พฤหัสบดี': 4, 'พฤหัส': 4, 'พฤ': 4, 'thu': 4, 'thursday': 4, 'ศุกร์': 5, 'ศ': 5, 'fri': 5, 'friday': 5 };
  const GRADES = ['อ.1', 'อ.2', 'อ.3', 'ป.1', 'ป.2', 'ป.3', 'ป.4', 'ป.5', 'ป.6'];
  const SUBJECT_TYPES = { core: 'วิชาพื้นฐาน', elective: 'วิชาเพิ่มเติม', practical: 'วิชาปฏิบัติ', activity: 'กิจกรรม' };
  const ROOM_TYPES = { classroom: 'ห้องเรียนปกติ', computer: 'ห้องคอมพิวเตอร์', science: 'ห้องวิทยาศาสตร์', music: 'ห้องดนตรี',
    lab: 'ห้องปฏิบัติการ', library: 'ห้องสมุด', gym: 'ลาน/โรงยิม', other: 'อื่น ๆ' };

  function S() { return TT.S; }
  function norm(s) { return String(s === null || s === undefined ? '' : s).replace(/[\s*_]/g, '').toLowerCase(); }
  function noTitle(n) { return norm(String(n || '').replace(/^(นาย|นางสาว|นาง|ว่าที่ร้อยตรี|ว่าที่ ร\.ต\.|ด\.ช\.|ด\.ญ\.|mr\.?|mrs\.?|ms\.?)\s*/i, '')); }
  function shortSubject(n) { return String(n || '').replace(/\s*\(ป\.[^)]*\)$/, ''); }
  function splitList(v) { return String(v || '').split(/[,;\n、]+/).map(function (x) { return x.trim(); }).filter(Boolean); }
  function bad(msg) { const e = new Error(msg); e.bad = true; throw e; }

  /* ── ตัวแปลงค่าในเซลล์ ── */
  const P = {
    text: function (v) { return String(v).trim(); },
    int: function (v, c) { const n = Number(String(v).replace(/,/g, '')); if (!isFinite(n) || n < 0) bad(c.h + ' ต้องเป็นตัวเลขไม่ติดลบ'); return Math.round(n); },
    bool: function (v) { return /^(1|true|yes|y|ใช่|มี|✓|✔|x)$/i.test(String(v).trim()) ? '1' : ''; },
    days: function (v, c) {
      return splitList(v).map(function (x) {
        const d = DAY_ALIASES[x.toLowerCase().replace(/^วัน/, '').replace(/\.$/, '')] || Number(x);
        if (!(d >= 1 && d <= 5)) bad(c.h + ': ไม่รู้จักวัน "' + x + '"');
        return d;
      });
    },
    grades: function (v, c) {
      const out = [];
      splitList(v).forEach(function (x) {
        const m = x.replace(/\s/g, '').match(/^([อป])\.?(\d)(?:[-–~]([อป])?\.?(\d))?$/);
        if (!m) bad(c.h + ': ไม่รู้จักชั้น "' + x + '" (ตัวอย่าง ป.1, ป.4-ป.6)');
        const a = GRADES.indexOf(m[1] + '.' + m[2]), b = m[4] ? GRADES.indexOf((m[3] || m[1]) + '.' + m[4]) : a;
        if (a < 0 || b < 0 || b < a) bad(c.h + ': ช่วงชั้น "' + x + '" ไม่ถูกต้อง');
        for (let i = a; i <= b; i++) if (out.indexOf(GRADES[i]) < 0) out.push(GRADES[i]);
      });
      return out;
    },
    grade: function (v, c) { const g = P.grades(v, c); if (g.length !== 1) bad(c.h + ' ต้องระบุชั้นเดียว'); return g[0]; },
    time: function (v, c) {
      const m = String(v).trim().match(/^(\d{1,2})[:.](\d{2})(?::\d{2})?\s*(am|pm)?$/i);
      if (!m) bad(c.h + ' ต้องเป็นเวลา เช่น 08:30');
      let h = Number(m[1]);
      if (m[3] && /pm/i.test(m[3]) && h < 12) h += 12;
      if (m[3] && /am/i.test(m[3]) && h === 12) h = 0;
      if (h > 23 || Number(m[2]) > 59) bad(c.h + ' ไม่ถูกต้อง');
      return (h < 10 ? '0' : '') + h + ':' + m[2];
    },
    pick: function (map) {
      return function (v, c) {
        const x = norm(v);
        const k = Object.keys(map).find(function (k) { return norm(k) === x || norm(map[k]) === x; });
        if (!k) bad(c.h + ': ไม่รู้จัก "' + v + '" (ใช้ได้: ' + Object.keys(map).map(function (k) { return map[k]; }).join(', ') + ')');
        return k;
      };
    },
    session: function (v, c) { const x = norm(v); if (/เช้า|morning|am/.test(x)) return 'morning'; if (/บ่าย|afternoon|pm/.test(x)) return 'afternoon'; bad(c.h + ' ต้องเป็น เช้า หรือ บ่าย'); },
    teacherRef: function (v, c, ctx) { const t = findTeacher(v); if (!t) { ctx.warn(c.h + ': ไม่พบครู "' + v + '" — ข้าม'); return ''; } return t.teacher_id; },
    teacherRefs: function (v, c, ctx) { return splitList(v).map(function (x) { const t = findTeacher(x); if (!t) ctx.warn(c.h + ': ไม่พบครู "' + x + '" — ข้าม'); return t && t.teacher_id; }).filter(Boolean); },
    subjectRefs: function (v, c, ctx) {
      const out = [];
      splitList(v).forEach(function (x) {
        const list = findSubjects(x);
        if (!list.length) ctx.warn(c.h + ': ไม่พบวิชา "' + x + '" — ข้าม');
        else if (list.length > 1) ctx.warn(c.h + ': "' + x + '" ตรงกับ ' + list.length + ' วิชา — ใส่ทั้งหมด');
        list.forEach(function (s) { if (out.indexOf(s.subject_id) < 0) out.push(s.subject_id); });
      });
      return out;
    },
    roomRef: function (v, c, ctx) { const r = findRoom(v); if (!r) { ctx.warn(c.h + ': ไม่พบห้อง "' + v + '" — ข้าม'); return ''; } return r.room_id; },
  };
  function findTeacher(v) {
    const x = norm(v), y = noTitle(v);
    return S().teachers.find(function (t) { return (t.code && norm(t.code) === x) || norm(TT.teacherName(t)) === x || noTitle(t.name) === y; });
  }
  function findSubjects(v) {
    const x = norm(v);
    const exact = S().subjects.filter(function (s) { return (s.code && norm(s.code) === x) || norm(s.name) === x; });
    return exact.length ? exact : S().subjects.filter(function (s) { return norm(shortSubject(s.name)) === x; });
  }
  function findRoom(v) { const x = norm(v); return S().rooms.find(function (r) { return (r.code && norm(r.code) === x) || norm(r.name) === x; }); }

  /* ── นิยามคอลัมน์ของแต่ละประเภท (h = หัวคอลัมน์ในแม่แบบ, a = ชื่อเรียกอื่นที่รับได้) ── */
  const KINDS = {
    teacher: {
      label: '👩‍🏫 ครู', pk: 'teacher_id', list: 'teachers',
      cols: [
        { k: 'code', h: 'รหัสครู', a: ['code', 'รหัส'], p: P.text, ex: 'T01' },
        { k: 'title', h: 'คำนำหน้า', a: ['title', 'คำนำหน้าชื่อ'], p: P.text, ex: 'นางสาว' },
        { k: 'name', h: 'ชื่อ-สกุล', a: ['name', 'ชื่อ', 'ชื่อสกุล', 'ชื่อ-นามสกุล'], p: P.text, req: 1, ex: 'สมใจ ใจดี' },
        { k: 'dept', h: 'กลุ่มสาระ', a: ['dept', 'กลุ่มสาระการเรียนรู้'], p: P.text, ex: 'คณิตศาสตร์' },
        { k: 'subjects', h: 'วิชาที่สอนได้', a: ['subjects', 'วิชา', 'วิชาที่สอน'], p: P.subjectRefs, ex: 'คณิตศาสตร์, วิทยาศาสตร์และเทคโนโลยี', note: 'ชื่อหรือรหัสวิชา คั่นด้วย ,' },
        { k: 'min_periods', h: 'คาบขั้นต่ำ', a: ['min', 'min_periods'], p: P.int, ex: '18' },
        { k: 'max_periods', h: 'คาบสูงสุด', a: ['max', 'max_periods'], p: P.int, ex: '25' },
        { k: 'off_days', h: 'วันหยุดประจำ', a: ['off_days', 'วันหยุด'], p: P.days, ex: '', note: 'เช่น ศุกร์ หรือ จันทร์,ศุกร์' },
        { k: 'extra_duty', h: 'ภาระงานพิเศษ', a: ['extra_duty'], p: P.text, ex: '' },
      ],
      // "นางสาวสมใจ ใจดี" ในช่องชื่อ → แยกคำนำหน้าไปไว้ช่องคำนำหน้า (ถ้าไฟล์ไม่ได้ระบุ)
      post: function (r) {
        const m = String(r.name || '').match(/^(นางสาว|นาง|นาย|ว่าที่ร้อยตรี|ว่าที่ ร\.ต\.)\s*(.+)$/);
        if (m) { if (!r.title) r.title = m[1]; r.name = m[2].trim(); }
      },
      key: function (r) { return r.code ? 'c:' + norm(r.code) : 'n:' + noTitle(r.name); },
      match: function (r) { return (r.code && S().teachers.find(function (t) { return t.code && norm(t.code) === norm(r.code); })) || (r.name && S().teachers.find(function (t) { return noTitle(t.name) === noTitle(r.name); })); },
      label1: function (r) { return (r.title || '') + (r.name || ''); },
    },
    subject: {
      label: '📚 วิชา', pk: 'subject_id', list: 'subjects',
      cols: [
        { k: 'code', h: 'รหัสวิชา', a: ['code', 'รหัส'], p: P.text, ex: 'ค11101' },
        { k: 'name', h: 'ชื่อวิชา', a: ['name', 'วิชา'], p: P.text, req: 1, ex: 'คณิตศาสตร์ (ป.1–3)' },
        { k: 'periods_week', h: 'คาบต่อสัปดาห์', a: ['periods_week', 'คาบ/สัปดาห์', 'ชั่วโมง/สัปดาห์', 'จำนวนคาบ'], p: P.int, req: 1, ex: '5' },
        { k: 'grades', h: 'ระดับชั้น', a: ['grades', 'ชั้น'], p: P.grades, ex: 'ป.1-ป.3', note: 'เช่น ป.1,ป.2 หรือ ป.4-ป.6' },
        { k: 'type', h: 'ประเภทวิชา', a: ['type', 'ประเภท'], p: P.pick(SUBJECT_TYPES), ex: 'วิชาพื้นฐาน', note: Object.keys(SUBJECT_TYPES).map(function (k) { return SUBJECT_TYPES[k]; }).join(' / ') },
        { k: 'teachers', h: 'ครูผู้สอน', a: ['teachers', 'ครู'], p: P.teacherRefs, ex: '', note: 'ชื่อหรือรหัสครู คั่นด้วย ,' },
        { k: 'room_type', h: 'ต้องใช้ห้องประเภท', a: ['room_type', 'ห้อง'], p: P.pick(ROOM_TYPES), ex: '' },
        { k: 'rules.consecutive', h: 'เรียนต่อเนื่องครั้งละ', a: ['consecutive'], p: P.int, ex: '' },
        { k: 'rules.max_per_day', h: 'ไม่เกินวันละ', a: ['max_per_day'], p: P.int, ex: '' },
        { k: 'rules.allowed_days', h: 'จัดได้เฉพาะวัน', a: ['allowed_days'], p: P.days, ex: '' },
      ],
      key: function (r) { return r.code ? 'c:' + norm(r.code) : 'n:' + norm(r.name); },
      match: function (r) { return (r.code && S().subjects.find(function (s) { return s.code && norm(s.code) === norm(r.code); })) || (r.name && S().subjects.find(function (s) { return norm(s.name) === norm(r.name); })); },
      label1: function (r) { return r.name; },
    },
    room: {
      label: '🏫 ห้องเรียน', pk: 'room_id', list: 'rooms',
      cols: [
        { k: 'code', h: 'รหัสห้อง', a: ['code', 'รหัส'], p: P.text, ex: 'R101' },
        { k: 'name', h: 'ชื่อห้อง', a: ['name', 'ห้อง'], p: P.text, req: 1, ex: 'ห้องคอมพิวเตอร์' },
        { k: 'building', h: 'อาคาร', a: ['building'], p: P.text, ex: 'อาคาร 1' },
        { k: 'type', h: 'ประเภทห้อง', a: ['type', 'ประเภท'], p: P.pick(ROOM_TYPES), ex: 'ห้องคอมพิวเตอร์', note: Object.keys(ROOM_TYPES).map(function (k) { return ROOM_TYPES[k]; }).join(' / ') },
        { k: 'capacity', h: 'ความจุ', a: ['capacity'], p: P.int, ex: '30' },
        { k: 'max_concurrent', h: 'ใช้พร้อมกันได้', a: ['max_concurrent'], p: P.int, ex: '1' },
        { k: 'special', h: 'ห้องเฉพาะทาง', a: ['special'], p: P.bool, ex: 'ใช่' },
      ],
      key: function (r) { return r.code ? 'c:' + norm(r.code) : 'n:' + norm(r.name); },
      match: function (r) { return (r.code && S().rooms.find(function (x) { return x.code && norm(x.code) === norm(r.code); })) || (r.name && S().rooms.find(function (x) { return norm(x.name) === norm(r.name); })); },
      label1: function (r) { return r.name; },
    },
    class: {
      label: '🎒 ชั้นเรียน', pk: 'class_id', list: 'classes',
      cols: [
        { k: 'grade', h: 'ชั้น', a: ['grade', 'ระดับชั้น'], p: P.grade, req: 1, ex: 'ป.1' },
        { k: 'room', h: 'ห้อง', a: ['room'], p: P.text, ex: '1' },
        { k: 'students', h: 'จำนวนนักเรียน', a: ['students', 'นักเรียน'], p: P.int, ex: '20' },
        { k: 'homeroom_teacher_id', h: 'ครูประจำชั้น', a: ['homeroom', 'homeroom_teacher'], p: P.teacherRef, ex: '' },
        { k: 'home_room_id', h: 'ห้องเรียนประจำ', a: ['home_room'], p: P.roomRef, ex: '' },
      ],
      key: function (r) { return norm(r.grade) + '/' + norm(r.room); },
      match: function (r) { return S().classes.find(function (c) { return c.grade === r.grade && norm(c.room) === norm(r.room); }); },
      label1: function (r) { return r.grade + (r.room ? '/' + r.room : ''); },
    },
    period: {
      label: '⏰ คาบเรียน', pk: 'period_id', list: 'periods',
      cols: [
        { k: 'seq', h: 'ลำดับ', a: ['seq', 'ที่'], p: P.int, ex: '1' },
        { k: 'label', h: 'ชื่อคาบ', a: ['label', 'คาบ', 'ชื่อ'], p: P.text, req: 1, ex: 'คาบ 1' },
        { k: 'start_time', h: 'เวลาเริ่ม', a: ['start', 'start_time', 'เริ่ม'], p: P.time, ex: '08:30' },
        { k: 'end_time', h: 'เวลาสิ้นสุด', a: ['end', 'end_time', 'สิ้นสุด'], p: P.time, ex: '09:20' },
        { k: 'session', h: 'ช่วง', a: ['session'], p: P.session, ex: 'เช้า', note: 'เช้า / บ่าย' },
        { k: 'is_break', h: 'เป็นช่วงพัก', a: ['is_break', 'พัก'], p: P.bool, ex: '' },
      ],
      key: function (r) { return norm(r.label); },
      match: function (r) { return S().periods.find(function (p) { return norm(p.label) === norm(r.label); }); },
      label1: function (r) { return r.label; },
    },
    slots: {
      label: '🗓️ ตารางสอน (สร้างเป็นฉบับใหม่)', slots: true,
      cols: [
        { k: 'class', h: 'ชั้น', a: ['class', 'ห้องเรียน'], ex: 'ป.1/1', req: 1, note: 'เช่น ป.1/1 (หรือ ป.1 ถ้ามีห้องเดียว)' },
        { k: 'day', h: 'วัน', a: ['day'], ex: 'จันทร์', req: 1, note: 'จันทร์–ศุกร์ หรือ 1–5' },
        { k: 'period', h: 'คาบ', a: ['period'], ex: 'คาบ 1', req: 1, note: 'ชื่อคาบ เลขคาบ (1,2,..) หรือเวลาเริ่ม 08:30' },
        { k: 'subject', h: 'วิชา', a: ['subject'], ex: 'คณิตศาสตร์', req: 1, note: 'ชื่อหรือรหัสวิชา' },
        { k: 'teacher', h: 'ครู', a: ['teacher', 'ครูผู้สอน'], ex: '', note: 'ไม่บังคับ' },
        { k: 'room', h: 'ห้อง', a: ['room'], ex: '', note: 'ไม่บังคับ' },
      ],
    },
  };

  /* ── อ่านไฟล์ / ลิงก์ → ตาราง (array of arrays) หรือ JSON ── */
  async function readFile(file) {
    const name = file.name.toLowerCase();
    if (/\.json$/.test(name)) return { json: JSON.parse(await file.text()) };
    await LazyLib.xlsx();
    let wb;
    if (/\.(csv|txt)$/.test(name)) wb = XLSX.read(await file.text(), { type: 'string', raw: true });
    else wb = XLSX.read(await file.arrayBuffer(), { type: 'array' });
    return { aoa: XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, raw: false, defval: '' }), sheet: wb.SheetNames[0] };
  }
  /** ลิงก์ Google Sheets (แชร์แบบทุกคนที่มีลิงก์ หรือ เผยแพร่ไปยังเว็บ) → URL CSV */
  function sheetsCsvUrl(url) {
    const u = String(url || '').trim();
    if (!/^https:\/\/docs\.google\.com\/spreadsheets\//.test(u)) return null;
    const gid = (u.match(/[#&?]gid=(\d+)/) || [])[1];
    const pub = (u.match(/\/d\/e\/([a-zA-Z0-9-_]+)/) || [])[1];          // เผยแพร่ไปยังเว็บ
    if (pub) return 'https://docs.google.com/spreadsheets/d/e/' + pub + '/pub?output=csv' + (gid ? '&gid=' + gid : '');
    const id = (u.match(/\/d\/([a-zA-Z0-9-_]+)/) || [])[1];              // แชร์แบบทุกคนที่มีลิงก์
    if (!id) return null;
    return 'https://docs.google.com/spreadsheets/d/' + id + '/export?format=csv' + (gid ? '&gid=' + gid : '');
  }
  async function readSheetsUrl(url) {
    const csv = sheetsCsvUrl(url);
    if (!csv) throw new Error('ลิงก์ไม่ใช่ Google Sheets');
    let text;
    try {
      const r = await fetch(csv);
      if (!r.ok) throw new Error('HTTP ' + r.status);
      text = await r.text();
    } catch (e) { throw new Error('อ่าน Google Sheets ไม่ได้ (' + e.message + ') — ตั้งค่าแชร์เป็น "ทุกคนที่มีลิงก์" หรือ ไฟล์ > แชร์ > เผยแพร่ไปยังเว็บ (CSV)'); }
    if (/^\s*<(!doctype|html)/i.test(text)) throw new Error('Google Sheets ยังไม่เปิดให้อ่าน — ตั้งค่าแชร์เป็น "ทุกคนที่มีลิงก์" หรือเผยแพร่ไปยังเว็บ');
    await LazyLib.xlsx();
    const wb = XLSX.read(text, { type: 'string', raw: true });
    return { aoa: XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, raw: false, defval: '' }), sheet: 'Google Sheets' };
  }

  /** หาแถวหัวตาราง (แถวแรกที่จับคู่คอลัมน์ได้ ≥ 2 หรือครบคอลัมน์บังคับ) → { header row index, map: colIndex→spec } */
  function mapHeader(aoa, cols) {
    for (let i = 0; i < Math.min(aoa.length, 15); i++) {
      const map = {};
      (aoa[i] || []).forEach(function (h, j) {
        const x = norm(h);
        if (!x) return;
        const c = cols.find(function (c) { return norm(c.h) === x || norm(c.k) === x || (c.a || []).some(function (a) { return norm(a) === x; }); });
        if (c && !Object.keys(map).some(function (m) { return map[m] === c; })) map[j] = c;
      });
      const got = Object.keys(map).map(function (j) { return map[j]; });
      if (got.length >= 2 && cols.filter(function (c) { return c.req; }).every(function (c) { return got.indexOf(c) >= 0; })) return { row: i, map: map };
    }
    return null;
  }

  /* ── ตรวจข้อมูลพื้นฐาน ── */
  function setPath(o, path, v) { const ks = path.split('.'); let cur = o; for (let i = 0; i < ks.length - 1; i++) cur = cur[ks[i]] = cur[ks[i]] || {}; cur[ks[ks.length - 1]] = v; }
  function analyzeEntities(kind, aoa) {
    const def = KINDS[kind];
    const hm = mapHeader(aoa, def.cols);
    if (!hm) throw new Error('ไม่พบหัวคอลัมน์ที่ต้องมี: ' + def.cols.filter(function (c) { return c.req; }).map(function (c) { return c.h; }).join(', ') + ' — ดาวน์โหลดแม่แบบเพื่อดูรูปแบบ');
    const seen = {}, rows = [];
    for (let i = hm.row + 1; i < aoa.length; i++) {
      const line = aoa[i] || [];
      if (!line.some(function (v) { return String(v).trim() !== ''; })) continue;
      const res = { no: i + 1, rec: {}, errors: [], warnings: [], status: 'new' };
      const ctx = { warn: function (m) { res.warnings.push(m); } };
      Object.keys(hm.map).forEach(function (j) {
        const c = hm.map[j], v = line[j];
        if (v === undefined || String(v).trim() === '') return;      // ว่าง = คงค่าเดิม
        try { setPath(res.rec, c.k, c.p(v, c, ctx)); } catch (e) { res.errors.push(e.message); }
      });
      if (def.post) def.post(res.rec);
      const cur = def.match(res.rec);
      if (cur) {
        res.status = 'update'; res.cur = cur;
        res.rec[def.pk] = cur[def.pk];
        // rules.* เป็น object เดียว → รวมกับค่าเดิมไม่ให้กฎอื่นหาย
        if (res.rec.rules) res.rec.rules = Object.assign({}, cur.rules || {}, res.rec.rules);
      } else {
        def.cols.forEach(function (c) { if (c.req && (res.rec[c.k] === undefined || res.rec[c.k] === '')) res.errors.push('ไม่มี' + c.h); });
      }
      const key = def.key(Object.assign({}, cur || {}, res.rec));
      if (seen[key]) res.errors.push('ซ้ำกับแถว ' + seen[key] + ' ในไฟล์');
      else seen[key] = res.no;
      if (res.errors.length) res.status = 'error';
      res.label = def.label1(Object.assign({}, cur || {}, res.rec));
      rows.push(res);
    }
    return { kind: kind, rows: rows, headers: Object.keys(hm.map).map(function (j) { return hm.map[j].h; }) };
  }

  /* ── ตรวจตารางสอน ── */
  function classByLabel(v) {
    const x = String(v || '').replace(/\s/g, '');
    const m = x.match(/^([อป])\.?(\d)(?:\/(.+))?$/);
    if (!m) return null;
    const g = m[1] + '.' + m[2];
    const list = S().classes.filter(function (c) { return c.grade === g; });
    if (m[3] !== undefined) return list.find(function (c) { return norm(c.room) === norm(m[3]); }) || null;
    return list.length === 1 ? list[0] : null;
  }
  function periodBy(v, tp) {
    const x = String(v || '').trim();
    if (/^\d+$/.test(x) && tp[Number(x) - 1]) return tp[Number(x) - 1];
    const t = x.match(/^(\d{1,2})[:.](\d{2})/);
    if (t) { const hh = (t[1].length < 2 ? '0' : '') + t[1] + ':' + t[2]; const p = tp.find(function (p) { return p.start_time === hh; }); if (p) return p; }
    return tp.find(function (p) { return norm(p.label) === norm(x); }) || null;
  }
  function analyzeSlots(src) {
    const tp = S().periods.filter(function (p) { return String(p.is_break) !== '1'; }).sort(function (a, b) { return (a.seq || 0) - (b.seq || 0); });
    const raw = [];   // { no, class, day, period, subject, teacher, room } (ค่าที่จับคู่แล้วเป็น object)
    if (src.json) {
      const j = src.json;
      if (j.format !== 'baanmai-timetable' || !Array.isArray(j.slots)) throw new Error('ไฟล์ JSON นี้ไม่ใช่ไฟล์ตารางที่ส่งออกจากระบบ (format: baanmai-timetable)');
      const byId = function (list, pk) { const m = {}; (list || []).forEach(function (x) { m[x[pk]] = x; }); return m; };
      const C = byId(j.classes, 'class_id'), Pd = byId(j.periods, 'period_id'), Sb = byId(j.subjects, 'subject_id'), T = byId(j.teachers, 'teacher_id'), R = byId(j.rooms, 'room_id');
      const same = function (list, pk, id) { return id ? list.find(function (x) { return x[pk] === id; }) : null; };
      j.slots.forEach(function (s, i) {
        const c = same(S().classes, 'class_id', s.class_id) || (C[s.class_id] && classByLabel(C[s.class_id].grade + '/' + C[s.class_id].room));
        const p = same(tp, 'period_id', s.period_id) || (Pd[s.period_id] && (tp.find(function (x) { return norm(x.label) === norm(Pd[s.period_id].label); }) || null));
        const sb = same(S().subjects, 'subject_id', s.subject_id) || (Sb[s.subject_id] && (findSubjects(Sb[s.subject_id].code || Sb[s.subject_id].name)[0] || findSubjects(Sb[s.subject_id].name)[0]));
        const t = s.teacher_id ? (same(S().teachers, 'teacher_id', s.teacher_id) || (T[s.teacher_id] && (findTeacher(T[s.teacher_id].code || '') || findTeacher(TT.teacherName(T[s.teacher_id]))))) : null;
        const r = s.room_id ? (same(S().rooms, 'room_id', s.room_id) || (R[s.room_id] && findRoom(R[s.room_id].code || R[s.room_id].name))) : null;
        raw.push({ no: i + 1, c: c, day: Number(s.day), p: p, s: sb, t: t, r: r,
          src: { c: C[s.class_id] ? C[s.class_id].grade + '/' + C[s.class_id].room : s.class_id, p: Pd[s.period_id] ? Pd[s.period_id].label : s.period_id,
            s: Sb[s.subject_id] ? Sb[s.subject_id].name : s.subject_id, t: s.teacher_id ? (T[s.teacher_id] ? TT.teacherName(T[s.teacher_id]) : s.teacher_id) : '', r: s.room_id ? (R[s.room_id] ? R[s.room_id].name : s.room_id) : '' } });
      });
    } else {
      const hm = mapHeader(src.aoa, KINDS.slots.cols);
      if (!hm) throw new Error('ไม่พบหัวคอลัมน์ ชั้น / วัน / คาบ / วิชา — ดาวน์โหลดแม่แบบเพื่อดูรูปแบบ');
      for (let i = hm.row + 1; i < src.aoa.length; i++) {
        const line = src.aoa[i] || [];
        if (!line.some(function (v) { return String(v).trim() !== ''; })) continue;
        const v = {};
        Object.keys(hm.map).forEach(function (j) { v[hm.map[j].k] = String(line[j] || '').trim(); });
        const dk = v.day.toLowerCase().replace(/^วัน/, '');
        raw.push({ no: i + 1, c: classByLabel(v.class), day: DAY_ALIASES[dk] || Number(v.day), p: periodBy(v.period, tp), s: v.subject ? findSubjects(v.subject)[0] : null,
          t: v.teacher ? findTeacher(v.teacher) : null, r: v.room ? findRoom(v.room) : null, src: { c: v.class, p: v.period, s: v.subject, t: v.teacher, r: v.room, d: v.day } });
      }
    }
    const seen = {}, rows = [];
    raw.forEach(function (x) {
      const res = { no: x.no, errors: [], warnings: [], status: 'new', x: x };
      if (!x.c) res.errors.push('ไม่พบชั้น "' + x.src.c + '"');
      if (!(x.day >= 1 && x.day <= 5)) res.errors.push('วันไม่ถูกต้อง' + (x.src.d ? ' "' + x.src.d + '"' : ''));
      if (!x.p) res.errors.push('ไม่พบคาบ "' + x.src.p + '"');
      if (!x.s) res.errors.push('ไม่พบวิชา "' + x.src.s + '"');
      if (x.src.t && !x.t) res.warnings.push('ไม่พบครู "' + x.src.t + '" — เว้นว่าง');
      if (x.src.r && !x.r) res.warnings.push('ไม่พบห้อง "' + x.src.r + '" — เว้นว่าง');
      if (x.c && x.p && x.day) {
        const k = x.c.class_id + '|' + x.day + '|' + x.p.period_id;
        if (seen[k]) res.errors.push('ชั้นนี้มีคาบซ้ำเวลาเดียวกับแถว ' + seen[k]);
        else seen[k] = x.no;
      }
      if (res.errors.length) res.status = 'error';
      res.label = (x.c ? TT.classLabel(x.c) : x.src.c) + ' · ' + (TT.DAY_NAMES[x.day] || '?') + ' ' + (x.p ? x.p.label : '?') + ' · ' + (x.s ? x.s.name : x.src.s) + (x.t ? ' · ' + TT.teacherName(x.t) : '');
      rows.push(res);
    });
    // ห้องในกลุ่มเรียนควบชั้นที่ไม่มีแถวของตัวเอง → ใช้ตามห้องแรกของกลุ่ม
    const slots = rows.filter(function (r) { return r.status !== 'error'; }).map(function (r) {
      return { class_id: r.x.c.class_id, day: r.x.day, period_id: r.x.p.period_id, subject_id: r.x.s.subject_id, teacher_id: r.x.t ? r.x.t.teacher_id : '', room_id: r.x.r ? r.x.r.room_id : '' };
    });
    let copied = 0;
    ((S().dashboard && S().dashboard.units) || []).filter(function (u) { return u.combined; }).forEach(function (u) {
      const has = {};
      slots.forEach(function (s) { if (u.class_ids.indexOf(s.class_id) >= 0) (has[s.day + '|' + s.period_id] = has[s.day + '|' + s.period_id] || {})[s.class_id] = s; });
      Object.keys(has).forEach(function (k) {
        const first = has[k][Object.keys(has[k])[0]];
        u.class_ids.forEach(function (cid) { if (!has[k][cid]) { slots.push(Object.assign({}, first, { class_id: cid })); copied++; } });
      });
    });
    // ตรวจทั้งตารางด้วยกติกาเดียวกับตัวแก้ไข
    const units = (S().dashboard && S().dashboard.units) || [], cells = {};
    units.forEach(function (u) {
      cells[u.unit_id] = {};
      slots.forEach(function (s) { if (u.class_ids.indexOf(s.class_id) >= 0 && !cells[u.unit_id][s.day + '|' + s.period_id]) cells[u.unit_id][s.day + '|' + s.period_id] = s; });
    });
    const check = TTCheck.check({ units: units, cells: cells, subjects: S().subjects, teachers: S().teachers, rooms: S().rooms, periods: S().periods, config: S().config || {} });
    return { kind: 'slots', rows: rows, slots: slots, copied: copied, check: check, fromJson: !!src.json, srcLabel: src.json && src.json.version ? src.json.version.label : '' };
  }

  /* ════ หน้าจอ ════ */
  const ST = { kind: 'teacher', result: null, onMatch: 'update', fileName: '' };
  function shell() {
    host.innerHTML =
      '<div class="card"><h3 class="card-title">📥 นำเข้าข้อมูล</h3>' +
        '<p class="tt-note" style="margin-top:-6px">รองรับ Excel (.xlsx) · CSV · JSON (ไฟล์ที่ส่งออกจากระบบนี้) · ลิงก์ Google Sheets — ระบบจะ<strong>ตรวจทุกแถวให้ดูก่อน</strong>แล้วจึงบันทึก · เพิ่ม/อัปเดตเท่านั้น ไม่ลบข้อมูลเดิม · ช่องว่างในไฟล์ = คงค่าเดิม</p>' +
        '<div class="tt-toolbar"><select class="form-control" data-kind style="max-width:320px">' +
          Object.keys(KINDS).map(function (k) { return '<option value="' + k + '">' + KINDS[k].label + '</option>'; }).join('') + '</select>' +
          '<button class="btn btn-secondary" data-tpl><i class="bi bi-download"></i> ดาวน์โหลดแม่แบบ Excel</button></div>' +
        '<div class="tt-drop" data-drop><i class="bi bi-cloud-arrow-up" style="font-size:28px"></i><div>ลากไฟล์มาวางที่นี่ หรือ <label class="tt-link">เลือกไฟล์<input type="file" data-file accept=".xlsx,.xls,.csv,.txt,.json" hidden></label></div>' +
          '<div class="tt-note">.xlsx · .xls · .csv · .json</div></div>' +
        '<div class="tt-toolbar" style="margin-top:10px"><input class="form-control" data-url placeholder="หรือวางลิงก์ Google Sheets (แชร์แบบทุกคนที่มีลิงก์)"><button class="btn btn-secondary" data-load-url><i class="bi bi-link-45deg"></i> อ่านจากลิงก์</button></div>' +
        '<div class="tt-note" data-colhelp></div>' +
      '</div>' +
      '<div data-preview></div>';
    host.querySelector('[data-kind]').onchange = function () { ST.kind = this.value; ST.result = null; renderHelp(); renderPreview(); };
    host.querySelector('[data-tpl]').onclick = downloadTemplate;
    host.querySelector('[data-file]').onchange = function () { if (this.files[0]) loadFile(this.files[0]); this.value = ''; };
    host.querySelector('[data-load-url]').onclick = function () { loadUrl(host.querySelector('[data-url]').value); };
    const drop = host.querySelector('[data-drop]');
    drop.addEventListener('dragover', function (e) { e.preventDefault(); drop.classList.add('over'); });
    drop.addEventListener('dragleave', function () { drop.classList.remove('over'); });
    drop.addEventListener('drop', function (e) { e.preventDefault(); drop.classList.remove('over'); if (e.dataTransfer.files[0]) loadFile(e.dataTransfer.files[0]); });
    renderHelp();
  }
  function renderHelp() {
    const def = KINDS[ST.kind];
    host.querySelector('[data-colhelp]').innerHTML = 'คอลัมน์: ' + def.cols.map(function (c) { return (c.req ? '<strong>' + esc(c.h) + '*</strong>' : esc(c.h)) + (c.note ? ' <span class="tt-note">(' + esc(c.note) + ')</span>' : ''); }).join(' · ') +
      (ST.kind === 'slots' ? '<br>หรือใช้ไฟล์ JSON ที่ส่งออกจากแท็บ "รายงาน / ส่งออก" (จับคู่ชั้น/วิชา/ครูให้อัตโนมัติ)' : '');
  }

  async function loadFile(file) {
    ST.fileName = file.name.replace(/\.[^.]+$/, '');
    try {
      Loading.show('กำลังอ่านไฟล์...');
      const src = await readFile(file);
      if (src.json) {
        if (ST.kind !== 'slots') { ST.kind = 'slots'; host.querySelector('[data-kind]').value = 'slots'; renderHelp(); Toast.show('ไฟล์ JSON = ตารางสอน → เปลี่ยนเป็นนำเข้าตารางสอนให้แล้ว', 'info'); }
      }
      analyze(src);
    } catch (e) { Toast.show('อ่านไฟล์ไม่สำเร็จ: ' + e.message, 'danger'); }
    finally { Loading.hide(); }
  }
  async function loadUrl(url) {
    ST.fileName = 'Google Sheets';
    try { Loading.show('กำลังอ่าน Google Sheets...'); analyze(await readSheetsUrl(url)); }
    catch (e) { Toast.show(e.message, 'danger'); }
    finally { Loading.hide(); }
  }
  function analyze(src) {
    try {
      if (ST.kind === 'slots') ST.result = analyzeSlots(src);
      else {
        if (src.json) throw new Error('ไฟล์ JSON ใช้กับการนำเข้าตารางสอนเท่านั้น');
        ST.result = analyzeEntities(ST.kind, src.aoa);
      }
    } catch (e) { ST.result = { fail: e.message }; }
    renderPreview();
  }

  function renderPreview() {
    const box = host.querySelector('[data-preview]');
    const r = ST.result;
    if (!r) { box.innerHTML = ''; return; }
    if (r.fail) { box.innerHTML = '<div class="card"><div class="alert alert-danger">⛔ ' + esc(r.fail) + '</div></div>'; return; }
    const cnt = function (s) { return r.rows.filter(function (x) { return x.status === s; }).length; };
    const nErr = cnt('error'), nNew = cnt('new'), nUpd = cnt('update'), nWarn = r.rows.filter(function (x) { return x.warnings.length; }).length;
    const slots = r.kind === 'slots';
    const willSave = slots ? r.slots.length : nNew + (ST.onMatch === 'update' ? nUpd : 0);
    const badge = { new: '<span class="badge badge-pass">ใหม่</span>', update: ST.onMatch === 'update' ? '<span class="badge" style="background:#E3F2FD;color:#0277BD">อัปเดต</span>' : '<span class="badge" style="background:#ECEFF1;color:#607D8B">ข้าม</span>', error: '<span class="badge badge-fail">ผิดพลาด</span>' };
    const shown = r.rows.slice(0, 200);
    box.innerHTML = '<div class="card"><h3 class="card-title">🔍 ตรวจสอบก่อนนำเข้า · ' + esc(ST.fileName) + '</h3>' +
      '<div class="tt-summary" style="margin-bottom:10px">' +
        '<span class="tt-badge ok">' + (slots ? '✅ ถูกต้อง ' + (nNew) + ' แถว' : '🆕 ใหม่ ' + nNew) + '</span>' +
        (slots ? '' : '<span class="tt-badge" style="background:#E3F2FD;color:#0277BD">🔄 ตรงกับข้อมูลเดิม ' + nUpd + '</span>') +
        '<span class="tt-badge err">⛔ ผิดพลาด ' + nErr + '</span>' + (nWarn ? '<span class="tt-badge warn">⚠️ มีหมายเหตุ ' + nWarn + '</span>' : '') +
      '</div>' +
      (slots ? '<div class="alert alert-info" style="font-size:14px">จะสร้าง<strong>ฉบับตารางใหม่ (สถานะร่าง)</strong> ' + r.slots.length + ' ช่อง' + (r.copied ? ' (รวมห้องเรียนควบชั้นที่คัดลอกให้ ' + r.copied + ' ช่อง)' : '') +
          ' — ผลตรวจทั้งตาราง: 🔴 ' + r.check.summary.errors + ' · 🟡 ' + r.check.summary.warnings + ' (แก้ต่อได้ในแท็บตรวจสอบ/แก้ไข)</div>' +
          '<div class="tt-toolbar"><input class="form-control" data-vlabel value="' + esc('นำเข้า: ' + (r.srcLabel || ST.fileName)) + '" placeholder="ชื่อฉบับ"></div>'
        : (nUpd ? '<div class="tt-toolbar"><span class="tt-note">แถวที่ตรงกับข้อมูลเดิม (รหัส/ชื่อซ้ำ):</span>' +
          '<label class="tt-chip"><input type="radio" name="tt-onmatch" value="update"' + (ST.onMatch === 'update' ? ' checked' : '') + '> อัปเดตเฉพาะช่องที่มีค่า</label>' +
          '<label class="tt-chip"><input type="radio" name="tt-onmatch" value="skip"' + (ST.onMatch === 'skip' ? ' checked' : '') + '> ข้าม (ไม่แก้ข้อมูลเดิม)</label></div>' : '')) +
      '<div class="table-wrap" style="max-height:420px;overflow:auto"><table class="tt-results"><thead><tr><th>แถว</th><th>สถานะ</th><th>รายการ</th><th>หมายเหตุ</th></tr></thead><tbody>' +
        shown.map(function (x) {
          return '<tr class="' + (x.status === 'error' ? 'row-err' : '') + '"><td>' + x.no + '</td><td>' + (slots && x.status === 'new' ? '<span class="badge badge-pass">ถูกต้อง</span>' : badge[x.status]) + '</td><td>' + esc(x.label || '') + '</td>' +
            '<td>' + x.errors.map(function (m) { return '<div class="text-danger">⛔ ' + esc(m) + '</div>'; }).join('') + x.warnings.map(function (m) { return '<div class="tt-note">⚠️ ' + esc(m) + '</div>'; }).join('') + '</td></tr>';
        }).join('') + '</tbody></table></div>' +
      (r.rows.length > shown.length ? '<div class="tt-note">แสดง ' + shown.length + ' จาก ' + r.rows.length + ' แถว</div>' : '') +
      '<div class="tt-toolbar" style="margin-top:12px">' +
        (nErr ? '<span class="text-danger" style="font-size:14px">แถวที่ผิดพลาด ' + nErr + ' แถวจะไม่ถูกนำเข้า — แก้ในไฟล์แล้วนำเข้าใหม่ได้</span>' : '') + '<span style="flex:1"></span>' +
        '<button class="btn btn-secondary" data-cancel>ยกเลิก</button>' +
        '<button class="btn btn-primary" data-save' + (willSave ? '' : ' disabled') + '><i class="bi bi-check2-circle"></i> ' + (slots ? 'สร้างฉบับตาราง (' + willSave + ' ช่อง)' : 'นำเข้า ' + willSave + ' รายการ') + '</button></div></div>';
    box.querySelectorAll('[name=tt-onmatch]').forEach(function (rb) { rb.onchange = function () { ST.onMatch = rb.value; renderPreview(); }; });
    box.querySelector('[data-cancel]').onclick = function () { ST.result = null; renderPreview(); };
    box.querySelector('[data-save]').onclick = save;
  }

  async function save() {
    const r = ST.result;
    try {
      if (r.kind === 'slots') {
        const label = (host.querySelector('[data-vlabel]').value || '').trim();
        const res = await api('tt.save_version', { label: label, slots: r.slots, status: 'draft', recorded_by: 'admin',
          stats: { source: 'import', periods_placed: r.slots.length, check_errors: r.check.summary.errors, check_warnings: r.check.summary.warnings } },
          { loadingMsg: 'กำลังสร้างฉบับตาราง...', noRetry: true });
        await TT.reload({ quiet: true });
        ST.result = null;
        host.querySelector('[data-preview]').innerHTML = '<div class="card"><div class="alert alert-success">✅ สร้างฉบับ "' + esc(label || res.label) + '" แล้ว (' + res.slots + ' ช่อง' + (res.conflicts ? ', ครู/ห้องชน ' + res.conflicts + ' จุด' : '') + ')</div>' +
          '<button class="btn btn-primary" data-open><i class="bi bi-pencil-square"></i> เปิดในตัวตรวจสอบ / แก้ไข</button></div>';
        host.querySelector('[data-open]').onclick = function () { TTEdit.open(res.version_id); };
        return;
      }
      const rows = r.rows.filter(function (x) { return x.status === 'new' || (x.status === 'update' && ST.onMatch === 'update'); })
        .map(function (x) { return Object.assign({ __row: x.no }, x.rec); });
      const res = await api('tt.import_entities', { entity: r.kind, rows: rows, recorded_by: 'admin' }, { loadingMsg: 'กำลังนำเข้า...', noRetry: true });
      await TT.reload({ quiet: true });
      ST.result = null;
      host.querySelector('[data-preview]').innerHTML = '<div class="card"><div class="alert alert-success">✅ นำเข้า' + KINDS[r.kind].label.replace(/^\S+\s/, '') + 'แล้ว: เพิ่มใหม่ ' + res.created + ' · อัปเดต ' + res.updated + ' รายการ</div></div>';
    } catch (e) { /* toast แสดงแล้ว (ข้อความจาก server ระบุแถวที่ผิด) */ }
  }

  /* ── แม่แบบ Excel: ชีตข้อมูล (หัวคอลัมน์ + ตัวอย่าง/ข้อมูลปัจจุบัน) + ชีตคำอธิบาย ── */
  async function downloadTemplate() {
    try {
      Loading.show('กำลังสร้างแม่แบบ...');
      await LazyLib.xlsx();
      const def = KINDS[ST.kind];
      const head = def.cols.map(function (c) { return c.h + (c.req ? '*' : ''); });
      let rows;
      if (def.slots) {
        const tp = S().periods.filter(function (p) { return String(p.is_break) !== '1'; }).sort(function (a, b) { return (a.seq || 0) - (b.seq || 0); });
        const c = S().classes[0], s = S().subjects[0];
        rows = [[c ? TT.classLabel(c) : 'ป.1/1', 'จันทร์', tp[0] ? tp[0].label : 'คาบ 1', s ? s.name : 'คณิตศาสตร์', '', ''],
          [c ? TT.classLabel(c) : 'ป.1/1', 'จันทร์', tp[1] ? tp[1].label : 'คาบ 2', 'ภาษาไทย', '', '']];
      } else {
        // ใส่ข้อมูลปัจจุบันให้แก้ต่อได้เลย (ถ้ามี) ไม่งั้นใช้ตัวอย่าง
        const cur = S()[def.list] || [];
        rows = cur.length ? cur.map(function (x) { return def.cols.map(function (c) { return exportCell(x, c); }); }) : [def.cols.map(function (c) { return c.ex || ''; })];
      }
      const wb = XLSX.utils.book_new();
      const ws = XLSX.utils.aoa_to_sheet([head].concat(rows));
      ws['!cols'] = def.cols.map(function (c) { return { wch: Math.max(12, c.h.length + 6) }; });
      XLSX.utils.book_append_sheet(wb, ws, 'ข้อมูล');
      const help = [['คอลัมน์', 'บังคับ', 'คำอธิบาย / ตัวอย่าง']].concat(def.cols.map(function (c) { return [c.h, c.req ? 'ใช่' : '', (c.note || '') + (c.ex ? (c.note ? ' · ' : '') + 'เช่น ' + c.ex : '')]; }))
        .concat([[], ['หมายเหตุ'], ['• แถวที่รหัส/ชื่อตรงกับข้อมูลเดิม = อัปเดต (ช่องว่าง = คงค่าเดิม) · ไม่ตรง = เพิ่มใหม่'], ['• ระบบไม่ลบข้อมูลเดิม และจะแสดงผลตรวจทุกแถวให้ยืนยันก่อนบันทึก']]);
      const hs = XLSX.utils.aoa_to_sheet(help);
      hs['!cols'] = [{ wch: 22 }, { wch: 8 }, { wch: 70 }];
      XLSX.utils.book_append_sheet(wb, hs, 'คำอธิบาย');
      XLSX.writeFile(wb, 'template_' + ST.kind + '.xlsx');
    } catch (e) { Toast.show('สร้างแม่แบบไม่สำเร็จ: ' + e.message, 'danger'); }
    finally { Loading.hide(); }
  }
  function exportCell(x, c) {
    const v = c.k.split('.').reduce(function (a, k) { return a == null ? undefined : a[k]; }, x);
    if (v === null || v === undefined || v === '') return '';
    const nameOf = function (list, pk, id, fmt) { const o = list.find(function (y) { return y[pk] === id; }); return o ? (fmt ? fmt(o) : o.name) : ''; };
    if (c.p === P.days) return v.map(function (d) { return TT.DAY_NAMES[d]; }).join(', ');
    if (c.p === P.grades) return v.join(', ');
    if (c.p === P.subjectRefs) return v.map(function (id) { return nameOf(S().subjects, 'subject_id', id); }).filter(Boolean).join(', ');
    if (c.p === P.teacherRefs) return v.map(function (id) { return nameOf(S().teachers, 'teacher_id', id, TT.teacherName); }).filter(Boolean).join(', ');
    if (c.p === P.teacherRef) return nameOf(S().teachers, 'teacher_id', v, TT.teacherName);
    if (c.p === P.roomRef) return nameOf(S().rooms, 'room_id', v);
    if (c.p === P.bool) return String(v) === '1' ? 'ใช่' : '';
    if (c.p === P.session) return v === 'afternoon' ? 'บ่าย' : 'เช้า';
    if (c.k === 'type' && ST.kind === 'subject') return SUBJECT_TYPES[v] || v;
    if (c.k === 'type' || c.k === 'room_type') return ROOM_TYPES[v] || v;
    return v;
  }

  document.querySelectorAll('#tt-tabs .tab').forEach(function (t) {
    t.addEventListener('click', function () { if (t.dataset.tab === 'import' && !host.querySelector('[data-kind]')) shell(); });
  });
  // ใช้ในการทดสอบ/ตัวช่วยอื่น
  window.TTImport = { analyzeEntities: analyzeEntities, analyzeSlots: analyzeSlots, sheetsCsvUrl: sheetsCsvUrl };
})();
