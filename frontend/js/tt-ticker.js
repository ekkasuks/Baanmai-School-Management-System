/**
 * ข้อความวิ่ง (โมดูล 9) — ตัวแสดงผลที่ใช้ร่วมกันระหว่างหน้าหลัก (index.html) และหน้าจัดการ (timetable.html)
 * ข้อมูลจาก tt.ticker: [{ kind: announce|publish|edit, text, at }]
 * วิ่งวนต่อเนื่อง (ใส่เนื้อหา 2 ชุด แล้วเลื่อน -50%) · หยุดเมื่อชี้เมาส์/แตะ · ผู้ใช้ที่ตั้งค่าลดการเคลื่อนไหว = แสดงนิ่ง
 */
const TTTicker = {
  ICON: { announce: '📢', publish: '✅', edit: '✏️' },
  SPEED: 60,   // px ต่อวินาที

  itemHtml: function (it) {
    const at = it.at ? Utils.fmtDateTime(it.at) : '';
    return '<span class="ticker-item">' + (TTTicker.ICON[it.kind] || '•') + ' ' + Utils.esc(it.text) +
      (at ? ' <span class="ticker-at">(' + Utils.esc(at) + ')</span>' : '') + '</span>';
  },

  /** แสดงข้อความวิ่งใน el (ซ่อน el ถ้าไม่มีรายการ) · link = หน้าเมื่อคลิกป้าย */
  mount: function (el, items, link) {
    if (!el) return;
    if (!items || !items.length) { el.innerHTML = ''; el.classList.add('hidden'); return; }
    const one = items.map(TTTicker.itemHtml).join('<span class="ticker-sep">•</span>') + '<span class="ticker-sep">•</span>';
    el.classList.remove('hidden');
    el.innerHTML = '<div class="ticker" role="marquee" aria-label="ข้อความประกาศ">' +
      (link ? '<a class="ticker-label" href="' + link + '">' : '<span class="ticker-label">') + '<i class="bi bi-megaphone-fill"></i> ประกาศ' + (link ? '</a>' : '</span>') +
      '<div class="ticker-viewport"><div class="ticker-track"><span class="ticker-run">' + one + '</span><span class="ticker-run" aria-hidden="true">' + one + '</span></div></div></div>';
    const track = el.querySelector('.ticker-track');
    const w = track.scrollWidth / 2;   // อ่านความกว้างทันที (บังคับ layout) — ความเร็วคงที่ไม่ว่าข้อความยาวเท่าไร
    track.style.setProperty('--ticker-dur', Math.max(12, Math.round(w / TTTicker.SPEED)) + 's');
  },
};
