/**
 * AI Smart Timetable — เฟส 5: จัดการข้อความวิ่ง (โมดูล 9)
 *   ข้อความที่หน้าหลักมาจาก: ประกาศที่พิมพ์เอง (มีวันหมดอายุ) + การประกาศใช้ตารางฉบับ "เผยแพร่แล้ว" + การแก้ไขฉบับนั้นหลังเผยแพร่
 *   ตั้งค่าเปิด/ปิด และจำนวนวันย้อนหลัง (TT_CONSTRAINT.config) · ซ่อน/แสดงทีละข้อความ
 */
(function () {
  const esc = Utils.esc;
  const host = document.getElementById('tab-ticker');
  const KIND = { announce: '📢 ประกาศ', publish: '✅ ประกาศใช้ตาราง', edit: '✏️ แก้ไขตาราง' };

  function shell() {
    host.innerHTML =
      '<div class="card"><h3 class="card-title">📢 ข้อความวิ่งที่หน้าหลัก</h3>' +
        '<p class="tt-note" style="margin-top:-6px">แสดงเฉพาะ<strong>ตารางฉบับที่ "เผยแพร่แล้ว"</strong> (การประกาศใช้ และการแก้ไขหลังเผยแพร่) กับประกาศที่พิมพ์เอง — การแก้ไขฉบับร่างจะไม่แสดง</p>' +
        '<div class="tt-note" style="margin-bottom:6px">ตัวอย่างที่ผู้ใช้จะเห็นตอนนี้:</div><div data-live></div>' +
        '<div class="tt-toolbar"><label class="tt-chip"><input type="checkbox" data-enabled> เปิดใช้ข้อความวิ่ง</label>' +
          '<span class="tt-note">แสดงการเปลี่ยนแปลงย้อนหลัง</span><input type="number" class="form-control" data-days min="1" max="60" style="max-width:90px"><span class="tt-note">วัน</span>' +
          '<button class="btn btn-primary" data-savecfg><i class="bi bi-save"></i> บันทึกการตั้งค่า</button></div>' +
      '</div>' +
      '<div class="card"><h3 class="card-title">✍️ เพิ่มประกาศ</h3>' +
        '<textarea class="form-control" data-msg maxlength="200" rows="2" placeholder="เช่น วันศุกร์นี้งดเรียนคาบ 7 เนื่องจากประชุมผู้ปกครอง"></textarea>' +
        '<div class="tt-toolbar" style="margin-top:8px"><span class="tt-note" data-len>0/200</span><span style="flex:1"></span><span class="tt-note">แสดง</span>' +
          '<select class="form-control" data-adays style="max-width:120px">' + [1, 3, 7, 14, 30, 60].map(function (d) { return '<option value="' + d + '"' + (d === 7 ? ' selected' : '') + '>' + d + ' วัน</option>'; }).join('') + '</select>' +
          '<button class="btn btn-success" data-add><i class="bi bi-megaphone"></i> ประกาศ</button></div></div>' +
      '<div class="card"><h3 class="card-title">🗂️ ข้อความทั้งหมด</h3><div data-list class="text-muted">กำลังโหลด...</div></div>';
    const msg = host.querySelector('[data-msg]');
    msg.oninput = function () { host.querySelector('[data-len]').textContent = msg.value.length + '/200'; };
    host.querySelector('[data-add]').onclick = add;
    host.querySelector('[data-savecfg]').onclick = saveCfg;
  }

  async function load() {
    try {
      const [live, all] = await Promise.all([
        api('tt.ticker', {}, { loading: false, silent: true }),
        api('tt.ticker', { all: true }, { loadingMsg: 'กำลังโหลด...' }),
      ]);
      host.querySelector('[data-enabled]').checked = all.enabled;
      host.querySelector('[data-days]').value = all.days;
      const lv = host.querySelector('[data-live]');
      TTTicker.mount(lv, live.items);
      if (!live.items.length) { lv.classList.remove('hidden'); lv.innerHTML = '<div class="alert alert-info" style="font-size:14px">' + (all.enabled ? 'ตอนนี้ไม่มีข้อความ — แถบประกาศจะถูกซ่อนที่หน้าหลัก' : 'ปิดใช้ข้อความวิ่งอยู่') + '</div>'; }
      renderList(all.items);
    } catch (e) { host.querySelector('[data-list]').innerHTML = '<div class="alert alert-danger">' + esc(e.message) + '</div>'; }
  }

  function renderList(items) {
    const box = host.querySelector('[data-list]');
    if (!items.length) { box.innerHTML = '<div class="text-muted">ยังไม่มีข้อความ</div>'; return; }
    box.innerHTML = '<div class="table-wrap"><table class="tt-results"><thead><tr><th>ประเภท</th><th>ข้อความ</th><th>เวลา</th><th>สถานะ</th><th></th></tr></thead><tbody>' +
      items.map(function (it) {
        const st = it.hidden ? '<span class="badge" style="background:#ECEFF1;color:#607D8B">ซ่อน</span>' : it.expired ? '<span class="badge" style="background:#ECEFF1;color:#607D8B">หมดอายุ</span>' : '<span class="badge badge-pass">แสดงอยู่</span>';
        return '<tr' + (it.hidden || it.expired ? ' style="opacity:.6"' : '') + '><td style="white-space:nowrap">' + (KIND[it.kind] || it.kind) + '</td><td>' + esc(it.text) + '</td>' +
          '<td class="tt-note" style="white-space:nowrap">' + esc(Utils.fmtDateTime(it.at)) + (it.expires_at ? '<br>ถึง ' + esc(Utils.fmtDateTime(it.expires_at)) : '') + '</td><td>' + st + '</td>' +
          '<td class="tt-actions"><button class="btn btn-secondary" data-hide="' + esc(it.id) + '" data-h="' + (it.hidden ? '0' : '1') + '">' + (it.hidden ? '<i class="bi bi-eye"></i> แสดง' : '<i class="bi bi-eye-slash"></i> ซ่อน') + '</button></td></tr>';
      }).join('') + '</tbody></table></div>';
    box.querySelectorAll('[data-hide]').forEach(function (b) {
      b.onclick = async function () {
        try { await api('tt.ticker_hide', { change_id: b.dataset.hide, hidden: b.dataset.h === '1' }, { loadingMsg: 'กำลังบันทึก...', noRetry: true }); load(); } catch (e) { /* toast */ }
      };
    });
  }

  async function add() {
    const m = host.querySelector('[data-msg]');
    if (!m.value.trim()) { Toast.show('กรุณาพิมพ์ข้อความ', 'warning'); return; }
    try {
      await api('tt.announce', { message: m.value.trim(), days: Number(host.querySelector('[data-adays]').value), recorded_by: 'admin' }, { loadingMsg: 'กำลังประกาศ...', noRetry: true });
      m.value = ''; host.querySelector('[data-len]').textContent = '0/200';
      Toast.show('ประกาศแล้ว — แสดงที่หน้าหลัก', 'success');
      load();
    } catch (e) { /* toast */ }
  }

  async function saveCfg() {
    try {
      const r = await api('tt.constraints_save', { config: { ticker_enabled: host.querySelector('[data-enabled]').checked, ticker_days: Number(host.querySelector('[data-days]').value) }, recorded_by: 'admin' },
        { loadingMsg: 'กำลังบันทึก...', noRetry: true });
      TT.S.config = r.config;
      Toast.show('บันทึกการตั้งค่าแล้ว', 'success');
      load();
    } catch (e) { /* toast */ }
  }

  document.querySelectorAll('#tt-tabs .tab').forEach(function (t) {
    t.addEventListener('click', function () {
      if (t.dataset.tab !== 'ticker') return;
      if (!host.querySelector('[data-list]')) shell();
      load();
    });
  });
})();
