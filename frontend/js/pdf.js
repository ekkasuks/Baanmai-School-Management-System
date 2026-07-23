/**
 * PDF helper — jsPDF + ฟอนต์ Sarabun (ฝังจาก repo) เพื่อให้พิมพ์ภาษาไทยได้
 *
 * ⚡ โหลดไลบรารี jsPDF (~400KB) แบบ lazy — ดึงตอนกด Export PDF ครั้งแรกเท่านั้น
 *    ทำให้เปิดหน้าเว็บเร็วขึ้น ไม่ต้องรอไลบรารีที่อาจไม่ได้ใช้
 *
 * ใช้:  const doc = await PDF.newDoc('p'); ... doc.save('x.pdf');
 */
const PDF = {
  _reg: null,         // base64 ฟอนต์ปกติ
  _bold: null,        // base64 ฟอนต์หนา
  _libPromise: null,  // กันโหลดซ้ำเมื่อกดรัว ๆ

  _JSPDF_URL: 'https://cdn.jsdelivr.net/npm/jspdf@2.5.1/dist/jspdf.umd.min.js',
  _AUTOTABLE_URL: 'https://cdn.jsdelivr.net/npm/jspdf-autotable@3.8.2/dist/jspdf.plugin.autotable.min.js',

  _libReady: function () {
    try {
      return !!(window.jspdf && window.jspdf.jsPDF &&
        window.jspdf.jsPDF.API && window.jspdf.jsPDF.API.autoTable);
    } catch (e) { return false; }
  },

  _loadScript: function (src) {
    return new Promise(function (resolve, reject) {
      const s = document.createElement('script');
      s.src = src;
      s.onload = function () { resolve(); };
      s.onerror = function () { reject(new Error('โหลดไลบรารี PDF ไม่สำเร็จ (ตรวจสอบอินเทอร์เน็ต)')); };
      document.head.appendChild(s);
    });
  },

  /** โหลด jsPDF + autotable เมื่อจำเป็น (เรียกซ้ำได้ ปลอดภัย) */
  _ensureLib: function () {
    if (PDF._libReady()) return Promise.resolve();
    if (!PDF._libPromise) {
      PDF._libPromise = PDF._loadScript(PDF._JSPDF_URL)
        .then(function () { return PDF._loadScript(PDF._AUTOTABLE_URL); })
        .catch(function (e) { PDF._libPromise = null; throw e; });   // ล้มเหลว → ให้ลองใหม่ได้
    }
    return PDF._libPromise;
  },

  _toBase64: function (buf) {
    let binary = '';
    const bytes = new Uint8Array(buf);
    const chunk = 0x8000;
    for (let i = 0; i < bytes.length; i += chunk) {
      binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
    }
    return btoa(binary);
  },

  _load: async function () {
    if (PDF._reg) return;
    const [a, b] = await Promise.all([
      fetch('assets/fonts/Sarabun-Regular.ttf').then(function (r) { return r.arrayBuffer(); }),
      fetch('assets/fonts/Sarabun-Bold.ttf').then(function (r) { return r.arrayBuffer(); }),
    ]);
    PDF._reg = PDF._toBase64(a);
    PDF._bold = PDF._toBase64(b);
  },

  /** สร้าง jsPDF doc ที่ตั้งฟอนต์ Sarabun พร้อมใช้ */
  newDoc: async function (orientation) {
    await PDF._ensureLib();                    // โหลดไลบรารีตอนใช้จริง
    if (!window.jspdf || !window.jspdf.jsPDF) throw new Error('ไม่พบไลบรารี jsPDF');
    await PDF._load();
    const doc = new window.jspdf.jsPDF({ orientation: orientation || 'p', unit: 'mm', format: 'a4' });
    doc.addFileToVFS('Sarabun-Regular.ttf', PDF._reg);
    doc.addFont('Sarabun-Regular.ttf', 'Sarabun', 'normal');
    doc.addFileToVFS('Sarabun-Bold.ttf', PDF._bold);
    doc.addFont('Sarabun-Bold.ttf', 'Sarabun', 'bold');
    doc.setFont('Sarabun', 'normal');
    return doc;
  },

  /** หัวกระดาษมาตรฐาน — คืนค่า y ถัดไป */
  header: function (doc, title, subtitle) {
    const w = doc.internal.pageSize.getWidth();
    doc.setFont('Sarabun', 'bold'); doc.setFontSize(16);
    doc.text(title || 'โรงเรียนบ้านใหม่', w / 2, 16, { align: 'center' });
    if (subtitle) {
      doc.setFontSize(13); doc.text(subtitle, w / 2, 24, { align: 'center' });
    }
    doc.setFont('Sarabun', 'normal');
    return subtitle ? 32 : 24;
  },
};
