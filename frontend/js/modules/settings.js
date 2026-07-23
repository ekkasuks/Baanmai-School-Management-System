/**
 * Module 1 — ตั้งค่าระบบ: ข้อมูลโรงเรียน · นำเข้า DMC · PIN · Backup/Restore · ระบบ
 */
(function () {

  // ── Tabs ──
  document.querySelectorAll('.tab').forEach(function (t) {
    t.addEventListener('click', function () {
      document.querySelectorAll('.tab').forEach(function (x) { x.classList.remove('active'); });
      t.classList.add('active');
      document.querySelectorAll('.tab-pane').forEach(function (p) { p.classList.add('hidden'); });
      document.getElementById('tab-' + t.dataset.tab).classList.remove('hidden');
    });
  });

  const SCHOOL_KEYS = ['school_code','school_name','address','phone','email','website','director','current_year','current_semester'];

  // ── โหลดค่าตั้งต้น ──
  async function loadSettings() {
    try {
      const data = await api('settings.get', {}, { silent: true });
      const s = data.settings || {};
      const form = document.getElementById('school-form');
      SCHOOL_KEYS.forEach(function (k) { if (form[k] && s[k] !== undefined) form[k].value = s[k]; });

      const out = Object.keys(s).sort().map(function (k) {
        return '<tr><td><code>' + Utils.esc(k) + '</code></td><td>' + Utils.esc(String(s[k])) + '</td></tr>';
      }).join('');
      document.getElementById('all-settings').innerHTML =
        '<div class="table-wrap"><table><thead><tr><th>Key</th><th>Value</th></tr></thead><tbody>' + out + '</tbody></table></div>';
    } catch (e) {
      document.getElementById('all-settings').innerHTML =
        '<div class="alert alert-warning">ยังไม่ได้ init ระบบ — ไปแท็บ "ระบบ" แล้วกด "สร้าง Sheet ทั้งหมด"</div>';
    }
  }

  // ── บันทึกข้อมูลโรงเรียน ──
  document.getElementById('school-form').addEventListener('submit', async function (e) {
    e.preventDefault();
    const form = e.target;
    try {
      for (const k of SCHOOL_KEYS) {
        await api('settings.update', { key: k, value: form[k].value, recorded_by: 'admin' }, { loading: false, silent: true });
      }
      AppSettings.clear();   // ล้าง cache ชื่อโรงเรียน เพื่อให้หน้าอื่นดึงค่าใหม่
      Toast.show('บันทึกข้อมูลโรงเรียนเรียบร้อย', 'success');
      loadSettings();
    } catch (err) { Toast.show('บันทึกไม่สำเร็จ: ' + err.message, 'danger'); }
  });

  // ── บันทึก PIN ──
  document.getElementById('pin-form').addEventListener('submit', async function (e) {
    e.preventDefault();
    const form = e.target;
    const updated = [];
    try {
      for (const k of ['pin_bank','pin_attendance']) {
        const v = form[k].value.trim();
        if (v) { await api('settings.update', { key: k, value: v, recorded_by: 'admin' }, { loading: false, silent: true }); updated.push(k); }
      }
      if (updated.length) {
        Toast.show('อัปเดต PIN เรียบร้อย (' + updated.length + ' รายการ)', 'success');
        form.reset(); Auth.clear();
      } else { Toast.show('ไม่ได้กรอก PIN ใหม่', 'warning'); }
    } catch (err) { Toast.show('บันทึก PIN ไม่สำเร็จ: ' + err.message, 'danger'); }
  });

  // ── ระบบ: ping / init ──
  document.getElementById('btn-ping').addEventListener('click', async function () {
    try {
      const r = await fetch(window.API_URL + '?action=ping');
      const j = await r.json();
      showSystem('✅ Backend ตอบกลับ — เวลา ' + j.data.time, 'success');
    } catch (e) { showSystem('❌ เชื่อมต่อไม่ได้ — ตรวจ API_URL ใน js/config.js', 'danger'); }
  });

  document.getElementById('btn-init').addEventListener('click', async function () {
    if (!confirm('สร้าง/ตรวจสอบ Sheet ทั้งหมดและตั้งค่าเริ่มต้น?\nคำสั่งนี้รันซ้ำได้ ไม่ลบข้อมูลเดิม')) return;
    try {
      const d = await api('settings.init', {}, { loadingMsg: 'กำลังสร้าง Sheet...' });
      showSystem('✅ สร้าง Sheet เสร็จ (' + d.sheets + ' sheets, ตั้งค่า default ' + d.settings_inserted + ' รายการ)', 'success');
      loadSettings();
    } catch (e) { showSystem('❌ ' + e.message, 'danger'); }
  });

  function showSystem(msg, type) {
    const el = document.getElementById('system-result');
    el.className = 'alert alert-' + type; el.textContent = msg; el.classList.remove('hidden');
  }

  // ── นำเข้า DMC ──
  let dmcRows = null;
  document.getElementById('dmc-file').addEventListener('change', function (e) {
    const file = e.target.files[0];
    if (!file) return;
    Loading.show('กำลังอ่านไฟล์...');
    const reader = new FileReader();
    reader.onload = function (ev) {
      try {
        const wb = XLSX.read(ev.target.result, { type: 'array' });
        const ws = wb.Sheets[wb.SheetNames[0]];
        dmcRows = XLSX.utils.sheet_to_json(ws, { defval: '', raw: false });
        document.getElementById('dmc-rows').textContent = dmcRows.length;
        document.getElementById('dmc-cols').textContent = dmcRows.length ? Object.keys(dmcRows[0]).length : 0;
        document.getElementById('dmc-preview').classList.remove('hidden');
      } catch (err) { Toast.show('อ่านไฟล์ไม่ได้: ' + err.message, 'danger'); }
      finally { Loading.hide(); }
    };
    reader.readAsArrayBuffer(file);
  });

  document.getElementById('dmc-import').addEventListener('click', async function () {
    if (!dmcRows || !dmcRows.length) return;
    if (!confirm('ยืนยันนำเข้า ' + dmcRows.length + ' แถว?\nรหัสประชาชนที่ซ้ำจะถูกอัปเดต')) return;

    const CHUNK = 50;
    const totalChunks = Math.ceil(dmcRows.length / CHUNK);
    let ins = 0, upd = 0, skip = 0;

    document.getElementById('dmc-progress').classList.remove('hidden');
    document.getElementById('dmc-result').classList.add('hidden');

    for (let i = 0; i < totalChunks; i++) {
      const chunk = dmcRows.slice(i * CHUNK, (i + 1) * CHUNK);
      const pct = Math.round(((i + 1) / totalChunks) * 100);
      document.getElementById('dmc-bar').style.width = pct + '%';
      document.getElementById('dmc-status').textContent = 'กำลังนำเข้า ชุด ' + (i + 1) + '/' + totalChunks + ' (' + chunk.length + ' แถว)...';
      try {
        const r = await api('students.import_dmc', {
          rows: chunk, chunk_index: i + 1, total_chunks: totalChunks, recorded_by: 'admin',
        }, { silent: true, loading: false });
        ins += r.inserted || 0; upd += r.updated || 0; skip += r.skipped || 0;
      } catch (err) {
        document.getElementById('dmc-status').textContent = '❌ ผิดพลาดที่ชุด ' + (i + 1) + ': ' + err.message;
        return;
      }
    }

    document.getElementById('dmc-status').textContent = '✅ เสร็จสิ้น';
    const res = document.getElementById('dmc-result');
    res.textContent = 'นำเข้าสำเร็จ — เพิ่มใหม่ ' + ins + ' คน, อัปเดต ' + upd + ' คน' + (skip ? ', ข้าม ' + skip + ' (รหัสไม่ครบ 13)' : '');
    res.classList.remove('hidden');
    Toast.show('นำเข้า DMC สำเร็จ', 'success');
  });

  // ── Backup ──
  document.getElementById('btn-backup').addEventListener('click', async function () {
    try {
      const d = await api('settings.backup', {}, { loadingMsg: 'กำลังสำรองข้อมูล...' });
      const blob = new Blob([JSON.stringify(d, null, 2)], { type: 'application/json' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'baanmai-backup-' + Utils.todayYmd() + '.json';
      a.click();
      URL.revokeObjectURL(a.href);
      Toast.show('ดาวน์โหลดไฟล์สำรองแล้ว', 'success');
    } catch (e) { /* toast แสดงแล้ว */ }
  });

  // ── Restore ──
  document.getElementById('restore-file').addEventListener('change', function (e) {
    const file = e.target.files[0];
    if (!file) return;
    if (!confirm('⚠️ การกู้คืนจะเขียนทับข้อมูลปัจจุบันทั้งหมด\nยืนยันหรือไม่?')) { e.target.value = ''; return; }
    const reader = new FileReader();
    reader.onload = async function (ev) {
      try {
        const backup = JSON.parse(ev.target.result);
        const d = await api('settings.restore', { backup: backup, confirm: true, recorded_by: 'admin' }, { loadingMsg: 'กำลังกู้คืน...' });
        const summary = Object.keys(d.restored).map(function (k) { return k + ': ' + d.restored[k]; }).join(', ');
        Toast.show('กู้คืนสำเร็จ — ' + summary, 'success');
        loadSettings();
      } catch (err) { Toast.show('กู้คืนไม่สำเร็จ: ' + err.message, 'danger'); }
      finally { e.target.value = ''; }
    };
    reader.readAsText(file);
  });

  loadSettings();
})();
