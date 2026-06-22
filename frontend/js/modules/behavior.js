/**
 * Module 3 — พฤติกรรมนักเรียน (ไม่ใช้ PIN)
 * ภาพรวม · บันทึก · อันดับ + Export PDF · ประวัติ · จัดการรายการพฤติกรรม
 */
(function () {

  let schoolName = 'โรงเรียนบ้านใหม่';
  let currentYm = '';     // YYYY-MM ที่กำลังดู
  let chart = null;
  let selRec = null;      // นักเรียนที่เลือกในแท็บบันทึก
  let masterItems = [];   // รายการพฤติกรรม active (cache สำหรับปุ่มบันทึก)
  let lastRanking = null; // ผลอันดับล่าสุด (สำหรับ PDF)

  const TH_MONTHS = ['ม.ค.','ก.พ.','มี.ค.','เม.ย.','พ.ค.','มิ.ย.','ก.ค.','ส.ค.','ก.ย.','ต.ค.','พ.ย.','ธ.ค.'];

  /* ── ป้ายเดือนภาษาไทยจาก YYYY-MM ── */
  function ymLabel(ym) {
    const p = String(ym).split('-');
    const mi = parseInt(p[1], 10) - 1;
    return (TH_MONTHS[mi] || '?') + ' ' + (parseInt(p[0], 10) + 543);
  }

  /* ── สร้างตัวเลือกเดือนย้อนหลัง 12 เดือน ── */
  function buildMonths() {
    const sel = document.getElementById('month-select');
    const d = new Date();
    const opts = [];
    for (let i = 0; i < 12; i++) {
      const ym = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
      opts.push('<option value="' + ym + '">' + ymLabel(ym) + (i === 0 ? ' (เดือนนี้)' : '') + '</option>');
      d.setMonth(d.getMonth() - 1);
    }
    sel.innerHTML = opts.join('');
    currentYm = sel.value;
    sel.addEventListener('change', function () {
      currentYm = sel.value;
      selRec = null;
      document.getElementById('rec-panel').classList.add('hidden');
      document.getElementById('rec-search').value = '';
      document.getElementById('rec-results').innerHTML = '';
      reloadActiveTab();
    });
  }

  function reloadActiveTab() {
    const active = document.querySelector('.tab.active');
    const tab = active ? active.dataset.tab : 'dashboard';
    if (tab === 'dashboard') loadDashboard();
    else if (tab === 'ranking') loadRanking();
  }

  /* ── Tabs ── */
  document.querySelectorAll('.tab').forEach(function (t) {
    t.addEventListener('click', function () {
      document.querySelectorAll('.tab').forEach(function (x) { x.classList.remove('active'); });
      t.classList.add('active');
      document.querySelectorAll('.tab-pane').forEach(function (p) { p.classList.add('hidden'); });
      document.getElementById('tab-' + t.dataset.tab).classList.remove('hidden');
      if (t.dataset.tab === 'dashboard') loadDashboard();
      else if (t.dataset.tab === 'master') loadMaster();
      else if (t.dataset.tab === 'record') ensureItems();
    });
  });

  /* ── เติม dropdown ชั้น (จาก dashboard.by_grade) ── */
  function fillGrades(byGrade) {
    const grades = byGrade.slice().sort(function (a, b) {
      return Utils.gradeSortKey(a.grade) - Utils.gradeSortKey(b.grade);
    }).map(function (g) { return g.grade; });
    ['rk-grade', 'h-grade'].forEach(function (id) {
      const sel = document.getElementById(id);
      const cur = sel.value;
      sel.innerHTML = '<option value="">ทุกชั้น</option>' + Utils.options(grades, cur);
    });
  }

  /* ── render รายการผลค้นหานักเรียน ── */
  function renderResults(host, results, onPick) {
    if (!results.length) { host.innerHTML = '<div class="text-muted">ไม่พบนักเรียน</div>'; return; }
    const rows = results.map(function (r, i) {
      return '<tr data-i="' + i + '" style="cursor:pointer">' +
        '<td>' + Utils.esc(r.name) + '</td>' +
        '<td>' + Utils.esc(r.grade) + '/' + Utils.esc(r.room) + '</td>' +
        '<td style="text-align:right;font-weight:700;color:var(--pink)">' + Utils.fmtInt(r.score) + '</td>' +
        '</tr>';
    }).join('');
    host.innerHTML = '<div class="table-wrap"><table><thead><tr><th>ชื่อ</th><th>ชั้น</th><th style="text-align:right">คะแนน</th></tr></thead><tbody>' + rows + '</tbody></table></div>';
    host.querySelectorAll('tbody tr').forEach(function (tr) {
      tr.onclick = function () { onPick(results[parseInt(tr.dataset.i, 10)]); };
    });
  }

  /* ════ Dashboard ════ */
  async function loadDashboard() {
    try {
      const d = await api('behavior.dashboard', { year_month: currentYm }, { loadingMsg: 'กำลังโหลดภาพรวม...' });
      document.getElementById('month-note').textContent = 'ข้อมูลเดือน ' + ymLabel(d.year_month);
      document.getElementById('d-avg').textContent = Utils.fmtNumber(d.avg_score, 1);
      document.getElementById('d-count').textContent = Utils.fmtInt(d.student_count);
      document.getElementById('d-records').textContent = Utils.fmtInt(d.record_count);
      document.getElementById('d-start').textContent = Utils.fmtInt(d.start);

      document.getElementById('d-excellent').textContent = Utils.fmtInt(d.distribution.excellent);
      document.getElementById('d-good').textContent = Utils.fmtInt(d.distribution.good);
      document.getElementById('d-fair').textContent = Utils.fmtInt(d.distribution.fair);
      document.getElementById('d-watch').textContent = Utils.fmtInt(d.distribution.watch);

      renderMini('d-top', d.top, 'var(--green-dark)');
      renderMini('d-bottom', d.bottom, 'var(--red)');

      fillGrades(d.by_grade);
      const byGrade = d.by_grade.slice().sort(function (a, b) {
        return Utils.gradeSortKey(a.grade) - Utils.gradeSortKey(b.grade);
      });
      drawChart(byGrade.map(function (g) { return g.grade; }), byGrade.map(function (g) { return g.avg; }));
    } catch (e) { /* Toast แสดงแล้ว */ }
  }

  function renderMini(id, list, color) {
    if (!list || !list.length) { document.getElementById(id).innerHTML = '<div class="text-muted">ยังไม่มีข้อมูล</div>'; return; }
    const rows = list.map(function (r, i) {
      return '<tr><td>' + (i + 1) + '</td><td>' + Utils.esc(r.name) + '</td><td>' +
        Utils.esc(r.grade) + '/' + Utils.esc(r.room) + '</td>' +
        '<td style="text-align:right;font-weight:700;color:' + color + '">' + Utils.fmtInt(r.score) + '</td></tr>';
    }).join('');
    document.getElementById(id).innerHTML =
      '<div class="table-wrap"><table><thead><tr><th>#</th><th>ชื่อ</th><th>ชั้น</th><th style="text-align:right">คะแนน</th></tr></thead><tbody>' + rows + '</tbody></table></div>';
  }

  function drawChart(labels, data) {
    const ctx = document.getElementById('d-chart').getContext('2d');
    if (chart) chart.destroy();
    chart = new Chart(ctx, {
      type: 'bar',
      data: { labels: labels, datasets: [{ label: 'คะแนนเฉลี่ย', data: data, backgroundColor: '#FF8FB1', borderRadius: 8 }] },
      options: {
        plugins: { legend: { display: false } },
        scales: { y: { beginAtZero: true, ticks: { font: { family: 'Sarabun' } } }, x: { ticks: { font: { family: 'Sarabun' } } } },
      },
    });
  }

  /* ════ บันทึก ════ */
  async function ensureItems() {
    if (masterItems.length) { renderItemButtons(); return; }
    try {
      const d = await api('behavior.master_list', {}, { silent: true, loading: false });
      masterItems = d.items;
      renderItemButtons();
    } catch (e) { /* ignore */ }
  }

  function renderItemButtons() {
    const host = document.getElementById('rec-items');
    if (!masterItems.length) { host.innerHTML = '<div class="text-muted">ยังไม่มีรายการ — เพิ่มที่แท็บ "รายการพฤติกรรม"</div>'; return; }
    host.innerHTML = masterItems.map(function (it) {
      const isAdd = it.type === 'add';
      const cls = isAdd ? 'btn-success' : 'btn-warning';
      const sign = isAdd ? '+' : '−';
      return '<button type="button" class="btn ' + cls + '" data-id="' + Utils.esc(it.item_id) + '">' +
        Utils.esc(it.name) + ' (' + sign + it.points + ')</button>';
    }).join('');
    host.querySelectorAll('button').forEach(function (b) {
      b.onclick = function () { doRecord(b.dataset.id); };
    });
  }

  const recSearch = document.getElementById('rec-search');
  recSearch.addEventListener('input', Utils.debounce(async function () {
    const q = recSearch.value.trim();
    const host = document.getElementById('rec-results');
    if (q.length < 1) { host.innerHTML = ''; return; }
    try {
      const d = await api('behavior.search', { q: q, year_month: currentYm }, { silent: true, loading: false });
      renderResults(host, d.results, pickRecStudent);
    } catch (e) { host.innerHTML = '<div class="alert alert-danger">' + Utils.esc(e.message) + '</div>'; }
  }, 350));

  async function pickRecStudent(r) {
    selRec = r;
    document.getElementById('rec-panel').classList.remove('hidden');
    document.getElementById('rec-student').innerHTML =
      '<strong>' + Utils.esc(r.name) + '</strong> · ชั้น ' + Utils.esc(r.grade) + '/' + Utils.esc(r.room) +
      ' · รหัส ' + Utils.esc(r.student_code);
    document.getElementById('rec-result').classList.add('hidden');
    document.getElementById('rec-note').value = '';
    await ensureItems();
    await refreshStudentScore();
    document.getElementById('rec-panel').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  async function refreshStudentScore() {
    if (!selRec) return;
    try {
      const d = await api('behavior.student_score', { citizen_id: selRec.citizen_id, year_month: currentYm }, { silent: true, loading: false });
      selRec.score = d.score;
      document.getElementById('rec-score').textContent = Utils.fmtInt(d.score);
      renderRecLogs(d.logs);
    } catch (e) { /* ignore */ }
  }

  function renderRecLogs(logs) {
    const host = document.getElementById('rec-logs');
    if (!logs || !logs.length) { host.innerHTML = '<div class="text-muted">ยังไม่มีรายการในเดือนนี้</div>'; return; }
    const rows = logs.slice().reverse().map(function (l) {
      const up = l.points_change > 0;
      return '<tr><td>' + Utils.fmtDateThai(l.date) + '</td><td>' + Utils.esc(l.item_name) + '</td>' +
        '<td style="text-align:right;font-weight:700;color:' + (up ? 'var(--green-dark)' : 'var(--red)') + '">' +
        (up ? '+' : '') + l.points_change + '</td>' +
        '<td style="text-align:right">' + Utils.fmtInt(l.points_after) + '</td>' +
        '<td>' + Utils.esc(l.recorded_by) + '</td></tr>';
    }).join('');
    host.innerHTML = '<div class="table-wrap"><table><thead><tr><th>วันที่</th><th>รายการ</th><th style="text-align:right">+/−</th><th style="text-align:right">คะแนน</th><th>ผู้บันทึก</th></tr></thead><tbody>' + rows + '</tbody></table></div>';
  }

  async function doRecord(itemId) {
    if (!selRec) { Toast.show('กรุณาเลือกนักเรียนก่อน', 'warning'); return; }
    if (currentYm !== thisMonth()) {
      if (!confirm('คุณกำลังบันทึกย้อนหลังในเดือน ' + ymLabel(currentYm) + ' — ยืนยันหรือไม่?')) return;
    }
    const by = document.getElementById('rec-by').value.trim();
    const note = document.getElementById('rec-note').value.trim();
    try {
      const r = await api('behavior.record', {
        citizen_id: selRec.citizen_id, item_id: itemId, note: note,
        recorded_by: by || 'admin', date: currentYm === thisMonth() ? undefined : currentYm + '-01',
      }, { loadingMsg: 'กำลังบันทึก...' });

      const up = r.points_change > 0;
      const res = document.getElementById('rec-result');
      res.className = 'alert alert-success mt-2';
      res.innerHTML = (up ? '✅ เพิ่ม ' : '✅ หัก ') + Math.abs(r.points_change) + ' คะแนน — "' +
        Utils.esc(r.item_name) + '" · คะแนนรวม <strong>' + Utils.fmtInt(r.points_after) + '</strong>';
      res.classList.remove('hidden');
      document.getElementById('rec-note').value = '';
      Toast.show('บันทึกพฤติกรรมสำเร็จ', 'success');
      await refreshStudentScore();
    } catch (e) { /* Toast แสดงแล้ว */ }
  }

  function thisMonth() {
    const d = new Date();
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
  }

  /* ════ อันดับ ════ */
  async function loadRanking() {
    const host = document.getElementById('rk-result');
    try {
      const d = await api('behavior.ranking', {
        year_month: currentYm, grade: document.getElementById('rk-grade').value || undefined,
      }, { loadingMsg: 'กำลังจัดอันดับ...' });
      lastRanking = d;
      if (!d.ranking.length) { host.innerHTML = '<div class="text-muted">ไม่มีข้อมูล</div>'; return; }
      const rows = d.ranking.map(function (r) {
        const medal = r.rank <= 3 ? ['🥇', '🥈', '🥉'][r.rank - 1] : r.rank;
        const color = r.score >= 20 ? 'var(--green-dark)' : r.score < 10 ? 'var(--red)' : 'var(--ink)';
        return '<tr><td style="text-align:center">' + medal + '</td><td>' + Utils.esc(r.name) + '</td>' +
          '<td>' + Utils.esc(r.grade) + '/' + Utils.esc(r.room) + '</td>' +
          '<td style="text-align:right;font-weight:700;color:' + color + '">' + Utils.fmtInt(r.score) + '</td></tr>';
      }).join('');
      host.innerHTML = '<div class="text-muted" style="margin:6px 0">อันดับเดือน ' + ymLabel(d.year_month) + ' · ' + d.ranking.length + ' คน</div>' +
        '<div class="table-wrap"><table><thead><tr><th style="text-align:center">อันดับ</th><th>ชื่อ</th><th>ชั้น</th><th style="text-align:right">คะแนน</th></tr></thead><tbody>' + rows + '</tbody></table></div>';
    } catch (e) { host.innerHTML = '<div class="alert alert-danger">' + Utils.esc(e.message) + '</div>'; }
  }
  document.getElementById('rk-go').onclick = loadRanking;

  document.getElementById('rk-pdf').onclick = async function () {
    if (!lastRanking || !lastRanking.ranking.length) { Toast.show('ยังไม่มีข้อมูลอันดับ', 'warning'); return; }
    try {
      Loading.show('กำลังสร้าง PDF...');
      const doc = await PDF.newDoc('p');
      let y = PDF.header(doc, schoolName, 'อันดับคะแนนพฤติกรรม เดือน ' + ymLabel(lastRanking.year_month));
      const body = lastRanking.ranking.map(function (r) {
        return [String(r.rank), r.name, r.grade + '/' + r.room, Utils.fmtInt(r.score)];
      });
      doc.autoTable({
        startY: y + 4,
        head: [['อันดับ', 'ชื่อ', 'ชั้น', 'คะแนน']],
        body: body,
        styles: { font: 'Sarabun', fontSize: 11 },
        headStyles: { font: 'Sarabun', fontStyle: 'bold', fillColor: [255, 143, 177], halign: 'center' },
        columnStyles: { 0: { halign: 'center' }, 2: { halign: 'center' }, 3: { halign: 'right' } },
      });
      doc.save('behavior_ranking_' + lastRanking.year_month + '.pdf');
    } catch (e) {
      Toast.show('สร้าง PDF ไม่สำเร็จ: ' + e.message, 'danger');
    } finally { Loading.hide(); }
  };

  /* ════ ประวัติ ════ */
  document.getElementById('h-go').onclick = async function () {
    const host = document.getElementById('h-result');
    try {
      const d = await api('behavior.history', {
        year_month: currentYm,
        type: document.getElementById('h-type').value || undefined,
        grade: document.getElementById('h-grade').value || undefined,
        limit: 300,
      }, { loadingMsg: 'กำลังค้นหา...' });

      const q = document.getElementById('h-search').value.trim().toLowerCase();
      let list = d.logs;
      if (q) list = list.filter(function (l) { return (l.name + ' ' + l.citizen_id).toLowerCase().indexOf(q) >= 0; });

      if (!list.length) { host.innerHTML = '<div class="text-muted">ไม่พบรายการ</div>'; return; }
      const rows = list.map(function (l) {
        const up = l.points_change > 0;
        return '<tr><td>' + Utils.fmtDateThai(l.date) + '</td><td>' + Utils.esc(l.name) + '</td>' +
          '<td>' + Utils.esc(l.grade) + '/' + Utils.esc(l.room) + '</td>' +
          '<td>' + Utils.esc(l.item_name) + '</td>' +
          '<td style="text-align:right;font-weight:700;color:' + (up ? 'var(--green-dark)' : 'var(--red)') + '">' + (up ? '+' : '') + l.points_change + '</td>' +
          '<td>' + Utils.esc(l.recorded_by) + '</td></tr>';
      }).join('');
      host.innerHTML = '<div class="text-muted mt-2" style="margin-bottom:6px">พบ ' + list.length + ' รายการ (เดือน ' + ymLabel(currentYm) + ')</div>' +
        '<div class="table-wrap"><table><thead><tr><th>วันที่</th><th>ชื่อ</th><th>ชั้น</th><th>รายการ</th><th style="text-align:right">+/−</th><th>ผู้บันทึก</th></tr></thead><tbody>' + rows + '</tbody></table></div>';
    } catch (e) { host.innerHTML = '<div class="alert alert-danger">' + Utils.esc(e.message) + '</div>'; }
  };

  /* ════ รายการพฤติกรรม (Master) ════ */
  async function loadMaster() {
    const host = document.getElementById('m-list');
    try {
      const d = await api('behavior.master_list', { include_inactive: true }, { silent: true, loading: false });
      const active = d.items.filter(function (i) { return i.active; });
      masterItems = active;  // อัปเดต cache ปุ่มบันทึก
      if (!d.items.length) { host.innerHTML = '<div class="text-muted">ยังไม่มีรายการ</div>'; return; }
      const rows = d.items.map(function (it, i) {
        const up = it.type === 'add';
        return '<tr' + (it.active ? '' : ' style="opacity:.5"') + '>' +
          '<td><span class="badge ' + (up ? 'badge-pass' : 'badge-fail') + '">' + (up ? 'เพิ่ม' : 'หัก') + '</span></td>' +
          '<td>' + Utils.esc(it.name) + '</td>' +
          '<td style="text-align:right;font-weight:700;color:' + (up ? 'var(--green-dark)' : 'var(--red)') + '">' + (up ? '+' : '−') + it.points + '</td>' +
          '<td style="text-align:right">' +
            '<button class="btn btn-secondary m-edit" data-i="' + i + '" style="padding:4px 12px;font-size:14px"><i class="bi bi-pencil"></i></button>' +
            (it.active ? '<button class="btn btn-danger m-del" data-id="' + Utils.esc(it.item_id) + '" style="padding:4px 12px;font-size:14px"><i class="bi bi-trash"></i></button>' : '') +
          '</td></tr>';
      }).join('');
      host.innerHTML = '<div class="table-wrap"><table><thead><tr><th>ประเภท</th><th>ชื่อรายการ</th><th style="text-align:right">คะแนน</th><th></th></tr></thead><tbody>' + rows + '</tbody></table></div>';
      host.querySelectorAll('.m-edit').forEach(function (b) {
        b.onclick = function () { editItem(d.items[parseInt(b.dataset.i, 10)]); };
      });
      host.querySelectorAll('.m-del').forEach(function (b) {
        b.onclick = function () { delItem(b.dataset.id); };
      });
    } catch (e) { host.innerHTML = '<div class="alert alert-danger">' + Utils.esc(e.message) + '</div>'; }
  }

  function editItem(it) {
    document.getElementById('m-id').value = it.item_id;
    document.getElementById('m-type').value = it.type;
    document.getElementById('m-points').value = it.points;
    document.getElementById('m-name').value = it.name;
    document.getElementById('m-cancel').classList.remove('hidden');
    document.getElementById('m-form').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  function resetMasterForm() {
    document.getElementById('m-id').value = '';
    document.getElementById('m-form').reset();
    document.getElementById('m-cancel').classList.add('hidden');
  }
  document.getElementById('m-cancel').onclick = resetMasterForm;

  document.getElementById('m-form').addEventListener('submit', async function (e) {
    e.preventDefault();
    const name = document.getElementById('m-name').value.trim();
    const points = parseInt(document.getElementById('m-points').value, 10);
    if (!name) { Toast.show('กรุณากรอกชื่อรายการ', 'warning'); return; }
    if (!(points > 0)) { Toast.show('คะแนนต้องมากกว่า 0', 'warning'); return; }
    try {
      await api('behavior.master_save', {
        item_id: document.getElementById('m-id').value || undefined,
        type: document.getElementById('m-type').value,
        name: name, points: points, recorded_by: 'admin',
      }, { loadingMsg: 'กำลังบันทึก...' });
      Toast.show('บันทึกรายการสำเร็จ', 'success');
      resetMasterForm();
      loadMaster();
    } catch (err) { /* Toast แสดงแล้ว */ }
  });

  async function delItem(id) {
    if (!confirm('ปิดการใช้งานรายการนี้?\n(ประวัติที่บันทึกไว้จะยังคงอยู่)')) return;
    try {
      await api('behavior.master_delete', { item_id: id, recorded_by: 'admin' }, { loadingMsg: 'กำลังลบ...' });
      Toast.show('ปิดการใช้งานรายการแล้ว', 'success');
      loadMaster();
    } catch (e) { /* Toast แสดงแล้ว */ }
  }

  /* ════ เริ่มต้น ════ */
  buildMonths();
  (async function () {
    try {
      const cfg = await api('settings.get', {}, { silent: true, loading: false });
      if (cfg.settings && cfg.settings.school_name) schoolName = cfg.settings.school_name;
    } catch (e) { /* ใช้ค่า default */ }
    loadDashboard();
    ensureItems();
  })();

})();
