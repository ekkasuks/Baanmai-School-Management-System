/**
 * PDF helper — jsPDF + ฟอนต์ Sarabun (ฝังจาก repo) เพื่อให้พิมพ์ภาษาไทยได้
 * ต้องโหลด jspdf + jspdf-autotable ก่อน
 *
 * ใช้:  const doc = await PDF.newDoc('p'); ... doc.save('x.pdf');
 */
const PDF = {
  _reg: null,         // base64 ฟอนต์ปกติ
  _bold: null,        // base64 ฟอนต์หนา

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
