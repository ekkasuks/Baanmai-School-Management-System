/**
 * Utility — จัดรูปแบบตัวเลข/วันที่/ภาษาไทย
 */
const Utils = {

  fmtNumber: function (n, decimals) {
    if (n === null || n === undefined || n === '') return '-';
    decimals = decimals === undefined ? 2 : decimals;
    return Number(n).toLocaleString('th-TH', { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
  },

  fmtMoney: function (n) { return '฿' + this.fmtNumber(n, 2); },

  fmtInt: function (n) { return this.fmtNumber(n, 0); },

  /** วันที่ไทย เช่น 21 มิ.ย. 2569 */
  fmtDateThai: function (v) {
    if (!v) return '-';
    const d = new Date(v);
    if (isNaN(d.getTime())) return String(v);
    const m = ['ม.ค.','ก.พ.','มี.ค.','เม.ย.','พ.ค.','มิ.ย.','ก.ค.','ส.ค.','ก.ย.','ต.ค.','พ.ย.','ธ.ค.'];
    return d.getDate() + ' ' + m[d.getMonth()] + ' ' + (d.getFullYear() + 543);
  },

  fmtDateTime: function (v) {
    if (!v) return '-';
    const d = new Date(v);
    if (isNaN(d.getTime())) return String(v);
    return this.fmtDateThai(v) + ' ' +
      String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
  },

  /** YYYY-MM-DD ของวันนี้ */
  todayYmd: function () {
    const d = new Date();
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  },

  /** อายุจากวันเกิด DD/MM/พ.ศ. */
  ageFromBuddhist: function (s) {
    if (!s) return null;
    const m = String(s).match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/);
    if (!m) return null;
    const birth = new Date(parseInt(m[3], 10) - 543, parseInt(m[2], 10) - 1, parseInt(m[1], 10));
    const now = new Date();
    let age = now.getFullYear() - birth.getFullYear();
    if (now.getMonth() < birth.getMonth() || (now.getMonth() === birth.getMonth() && now.getDate() < birth.getDate())) age--;
    return age;
  },

  /** เรียงชั้น: อ.2 < อ.3 < ป.1 < ... < ป.6 */
  gradeSortKey: function (g) {
    if (!g) return 99;
    if (g.indexOf('อ.') === 0) return parseInt(g.slice(2), 10) || 0;
    if (g.indexOf('ป.') === 0) return 10 + (parseInt(g.slice(2), 10) || 0);
    if (g.indexOf('ม.') === 0) return 20 + (parseInt(g.slice(2), 10) || 0);
    return 99;
  },

  debounce: function (fn, ms) {
    let t;
    ms = ms || 300;
    return function () {
      const args = arguments, self = this;
      clearTimeout(t);
      t = setTimeout(function () { fn.apply(self, args); }, ms);
    };
  },

  /** กัน XSS */
  esc: function (s) {
    if (s === null || s === undefined) return '';
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  },

  fullName: function (st) {
    return [st.prefix, st.first_name, st.last_name].filter(Boolean).join(' ').trim() || '(ไม่มีชื่อ)';
  },

  options: function (arr, selected) {
    return arr.map(function (v) {
      return '<option value="' + Utils.esc(v) + '"' + (String(v) === String(selected) ? ' selected' : '') + '>' + Utils.esc(v) + '</option>';
    }).join('');
  },
};

/**
 * AppSettings — ค่าตั้งที่เปลี่ยนไม่บ่อย (ชื่อโรงเรียน) cache ไว้ใน localStorage 24 ชม.
 * เดิมทุกโมดูลยิง settings.get ตอนเปิดหน้า ทั้งที่ใช้แค่ชื่อโรงเรียนไปขึ้นหัว PDF
 */
const AppSettings = {
  _KEY: 'baanmai_school',
  _TTL: 24 * 3600 * 1000,
  _DEFAULT: 'โรงเรียนบ้านใหม่',

  /** ชื่อโรงเรียน — คืนจาก cache ทันทีถ้ายังไม่หมดอายุ (ไม่ยิง API เลย) */
  schoolName: async function () {
    try {
      const raw = localStorage.getItem(AppSettings._KEY);
      if (raw) {
        const o = JSON.parse(raw);
        if (o && o.name && (Date.now() - o.ts) < AppSettings._TTL) return o.name;
      }
    } catch (e) { /* localStorage ปิด/เสีย: ข้ามไปดึงสด */ }

    try {
      const cfg = await api('settings.get', {}, { silent: true, loading: false });
      const name = (cfg.settings && cfg.settings.school_name) || AppSettings._DEFAULT;
      try { localStorage.setItem(AppSettings._KEY, JSON.stringify({ name: name, ts: Date.now() })); } catch (e) { /* ignore */ }
      return name;
    } catch (e) {
      return AppSettings._DEFAULT;
    }
  },

  /** ล้าง cache — เรียกหลังแก้ข้อมูลโรงเรียนในหน้าตั้งค่า */
  clear: function () {
    try { localStorage.removeItem(AppSettings._KEY); } catch (e) { /* ignore */ }
  },
};
