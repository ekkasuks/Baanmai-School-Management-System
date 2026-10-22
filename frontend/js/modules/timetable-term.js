/**
 * ขึ้นปีการศึกษา/ภาคเรียนใหม่ — ดึงข้อมูลจัดตารางจากภาคเรียนก่อนมาใช้ (tt.terms · tt.copy_term)
 *   เลือกภาคต้นทาง + สิ่งที่จะดึง: ข้อมูลพื้นฐาน (ครู/วิชา/ห้อง/ชั้น/คาบ) · เงื่อนไข+คาบว่างร่วม · มอบหมายการสอน · ตารางสอนฉบับที่ต้องการ (เป็นฉบับร่าง)
 *   รายการที่ภาคปัจจุบันมีอยู่แล้วใช้ของเดิม ไม่เขียนทับ · การ์ดในแท็บ "นำเข้า" + แถบแจ้งที่ Dashboard เมื่อภาคปัจจุบันยังว่าง
 */
(function () {
  const esc = Utils.esc;
  const host = document.getElementById('tt-term-copy');
  const banner = document.getElementById('tt-newterm');
  const STATUS = { generated: 'จัดเสร็จ (AI)', edited: 'แก้ไขแล้ว', draft: 'ร่าง', approved: 'อนุมัติแล้ว', published: 'เผยแพร่แล้ว' };
  let terms = null, versions = {}, from = '', lastReport = null;

  function S() { return TT.S; }
  function can(c) { return !window.TTAuth || TTAuth.can(c); }
  function others() { return (terms || []).filter(function (t) { return !t.current && (t.counts.teachers || t.counts.subjects || t.counts.classes || t.counts.versions); }); }
  function countText(c) {
    return ['ครู ' + c.teachers, 'วิชา ' + c.subjects, 'ชั้น ' + c.classes, 'คาบ ' + c.periods, c.assignments ? 'มอบหมาย ' + c.assignments : '', 'ตาราง ' + c.versions + ' ฉบับ'].filter(Boolean).join(' · ');
  }
  async function loadTerms(force) {
    if (terms && !force) return terms;
    const r = await api('tt.terms', {}, { loading: false, silent: true });
    terms = r.terms;
    return terms;
  }
  async function loadVersions(term) {
    if (!versions[term]) versions[term] = (await api('tt.versions', { term_id: term }, { loading: false, silent: true })).versions;
    return versions[term];
  }

  async function render() {
    if (!host) return;
    if (!can('edit_data')) { host.classList.add('hidden'); return; }
    host.innerHTML = '<div class="text-muted">กำลังโหลด...</div>';
    try { await loadTerms(); } catch (e) { host.innerHTML = '<div class="alert alert-danger">' + esc(e.message) + '</div>'; return; }
    const cur = (terms.find(function (t) { return t.current; }) || {});
    const list = others();
    if (!list.some(function (t) { return t.term_id === from; })) from = list[0] ? list[0].term_id : '';
    const vs = from ? await loadVersions(from) : [];
    const pub = vs.find(function (v) { return v.status === 'published'; });
    host.innerHTML =
      '<h3 class="card-title">📦 ดึงข้อมูลจากปีการศึกษา / ภาคเรียนก่อน</h3>' +
      '<p class="tt-note" style="margin-top:-6px">ภาคเรียนปัจจุบัน: <strong>' + esc(cur.label || (S().term && S().term.label) || '-') + '</strong> (เปลี่ยนได้ที่หน้าตั้งค่าระบบ) — ข้อมูลจัดตารางแยกตามภาคเรียน ใช้ส่วนนี้ดึงของภาคก่อนมาใช้ต่อ</p>' +
      (!list.length ? '<div class="alert alert-info">ยังไม่มีภาคเรียนอื่นที่มีข้อมูล</div>' :
        '<div class="tt-form">' +
          '<div class="full"><label>ดึงจาก</label><select class="form-control" data-from>' + list.map(function (t) {
            return '<option value="' + esc(t.term_id) + '"' + (t.term_id === from ? ' selected' : '') + '>' + esc(t.label || t.term_id) + ' — ' + esc(countText(t.counts)) + '</option>';
          }).join('') + '</select></div>' +
          '<div class="full tt-checks">' +
            '<label class="tt-chip"><input type="checkbox" data-p="data" checked> ข้อมูลพื้นฐาน (ครู วิชา ห้อง ชั้น คาบ)</label>' +
            '<label class="tt-chip"><input type="checkbox" data-p="config" checked> เงื่อนไข + คาบว่างร่วม</label>' +
            '<label class="tt-chip"><input type="checkbox" data-p="assign" checked> มอบหมายการสอน</label>' +
          '</div>' +
          '<div class="full"><label>ตารางสอน (ไม่บังคับ — จะได้เป็นฉบับ "ร่าง" ในภาคนี้ แก้ต่อหรือเผยแพร่ได้)</label><select class="form-control" data-ver>' +
            '<option value="">— ไม่ดึงตาราง (จัดใหม่ด้วย AI) —</option>' + vs.map(function (v) {
              return '<option value="' + esc(v.version_id) + '"' + (pub && v.version_id === pub.version_id ? ' selected' : '') + '>' + esc(v.label) + ' · ' + esc(STATUS[v.status] || v.status) + ' · ' + (v.stats && v.stats.slots ? v.stats.slots + ' ช่อง' : '') + '</option>';
            }).join('') + '</select></div>' +
          '<div class="full"><label class="tt-chip"><input type="checkbox" data-overwrite> เขียนทับเงื่อนไขของภาคนี้ (ถ้าเคยตั้งไว้แล้ว)</label></div>' +
        '</div>' +
        '<div class="alert alert-info" style="font-size:14px;margin-top:10px">รายการที่ภาคนี้มีอยู่แล้ว (ชื่อครู · รหัส/ชื่อวิชา · ชั้น/ห้อง · ชื่อคาบ ตรงกัน) จะใช้ของเดิม <strong>ไม่เขียนทับ</strong> · ขึ้นปีการศึกษาใหม่ควรตรวจ "มอบหมายการสอน" และครูประจำชั้นอีกครั้ง</div>' +
        '<button class="btn btn-primary" data-go><i class="bi bi-box-arrow-in-down"></i> ดึงข้อมูลมาใช้</button>') +
      '<div data-result>' + (lastReport ? resultHtml(lastReport) : '') + '</div>';
    if (!list.length) return;
    host.querySelector('[data-from]').onchange = function () { from = this.value; lastReport = null; render(); };
    host.querySelector('[data-go]').onclick = go;
    bindResult();
  }

  async function go() {
    const parts = {};
    host.querySelectorAll('[data-p]').forEach(function (c) { parts[c.dataset.p] = c.checked; });
    parts.version_id = host.querySelector('[data-ver]').value || undefined;
    if (!parts.data && !parts.config && !parts.assign && !parts.version_id) { Toast.show('เลือกอย่างน้อย 1 รายการ', 'warning'); return; }
    if (parts.version_id && !can('edit_timetable')) { Toast.show('บัญชีนี้ดึงตารางสอนไม่ได้ (ต้องมีสิทธิ์จัดตาราง)', 'warning'); return; }
    const t = terms.find(function (x) { return x.term_id === from; });
    if (!confirm('ดึงข้อมูลจาก ' + (t.label || from) + ' มาใช้ในภาคเรียนปัจจุบัน?\n\nรายการที่มีอยู่แล้วจะไม่ถูกเขียนทับ')) return;
    try {
      const r = await api('tt.copy_term', { from_term: from, parts: parts, overwrite_config: host.querySelector('[data-overwrite]').checked },
        { loadingMsg: 'กำลังดึงข้อมูล...', noRetry: true });
      lastReport = r.report;
      Toast.show('ดึงข้อมูลแล้ว', 'success');
      terms = null; versions = {};
      await TT.reload({ quiet: true });
      render();
    } catch (e) { /* toast แสดงแล้ว */ }
  }

  function resultHtml(rp) {
    const L = { teacher: 'ครู', subject: 'วิชา', room: 'ห้อง', class: 'ชั้นเรียน', period: 'คาบเรียน' };
    return '<div class="alert alert-success" style="margin-top:12px"><strong>✅ ดึงข้อมูลแล้ว</strong><ul style="margin:6px 0 0 18px">' +
      Object.keys(L).filter(function (k) { return rp[k]; }).map(function (k) {
        return '<li>' + L[k] + ': เพิ่มใหม่ ' + rp[k].created + (rp[k].matched ? ' · ใช้ของเดิม ' + rp[k].matched : '') + '</li>';
      }).join('') +
      (rp.config ? '<li>เงื่อนไข: ' + (rp.config === 'copied' ? 'ดึงมาแล้ว' : 'ข้าม (ภาคนี้ตั้งไว้แล้ว — ติ๊ก "เขียนทับ" ถ้าต้องการ)') + '</li>' : '') +
      (rp.assign !== undefined ? '<li>มอบหมายการสอน: เพิ่ม ' + rp.assign + ' คู่</li>' : '') +
      (rp.version ? '<li>ตารางสอน: ฉบับร่างใหม่ ' + rp.version.slots + ' ช่อง <button class="btn btn-primary" data-openv="' + esc(rp.version.version_id) + '" style="padding:3px 10px;font-size:13px;margin-left:6px">เปิดตรวจสอบ / แก้ไข</button></li>' : '') +
      '</ul></div>';
  }
  function bindResult() {
    const b = host.querySelector('[data-openv]');
    if (b) b.onclick = function () { window.TTEdit.open(b.dataset.openv); };
  }

  /** Dashboard: ภาคปัจจุบันยังว่าง แต่มีภาคอื่นที่มีข้อมูล → แนะนำให้ดึงข้อมูล */
  async function renderBanner() {
    if (!banner) return;
    banner.innerHTML = '';
    if (!can('edit_data') || S().teachers.length || S().subjects.length) return;
    try { await loadTerms(true); } catch (e) { return; }
    const list = others();
    if (!list.length) return;
    banner.innerHTML = '<div class="alert alert-info" style="display:flex;gap:10px;align-items:center;flex-wrap:wrap">' +
      '<span>🆕 ภาคเรียนนี้ยังไม่มีข้อมูลจัดตาราง — ดึงครู วิชา ชั้น คาบ เงื่อนไข และตารางเดิมจาก <strong>' + esc(list[0].label || list[0].term_id) + '</strong> มาใช้ได้ในคลิกเดียว</span>' +
      '<button class="btn btn-primary" data-jump style="margin:0"><i class="bi bi-box-arrow-in-down"></i> ดึงข้อมูลจากภาคก่อน</button></div>';
    banner.querySelector('[data-jump]').onclick = function () {
      document.querySelector('#tt-tabs .tab[data-tab="import"]').click();
      setTimeout(function () { host.scrollIntoView({ behavior: 'smooth', block: 'start' }); }, 100);
    };
  }

  document.querySelectorAll('#tt-tabs .tab').forEach(function (t) {
    t.addEventListener('click', function () { if (t.dataset.tab === 'import') render(); });
  });
  window.addEventListener('tt:loaded', renderBanner);
})();
