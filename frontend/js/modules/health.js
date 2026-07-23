/**
 * Module 4 — ตรวจสุขภาพ (ไม่ใช้ PIN)
 * บันทึกผลตรวจรายชั้น (5 ข้อ ผ่าน/ไม่ผ่าน) · ภาพรวม + PDF · ประวัติ
 */
(function () {

  let schoolName = 'โรงเรียนบ้านใหม่';
  let chart = null;
  let lastDash = null;   // ผล dashboard ล่าสุด (สำหรับ PDF)

  const ITEMS = [
    { key: 'hair', label: 'ผม' },
    { key: 'nails', label: 'เล็บ' },
    { key: 'cup', label: 'แก้วน้ำ' },
    { key: 'toothbrush', label: 'แปรงสีฟัน' },
    { key: 'toothpaste', label: 'ยาสีฟัน' },
  ];

  /* ── Tabs ── */
  document.querySelectorAll('.tab').forEach(function (t) {
    t.addEventListener('click', function () {
      document.querySelectorAll('.tab').forEach(function (x) { x.classList.remove('active'); });
      t.classList.add('active');
      document.querySelectorAll('.tab-pane').forEach(function (p) { p.classList.add('hidden'); });
      document.getElementById('tab-' + t.dataset.tab).classList.remove('hidden');
      if (t.dataset.tab === 'record') loadRecClasses();
      else if (t.dataset.tab === 'dashboard') loadDashboard();
    });
  });

  function fillClassSelect(sel, classes) {
    const opts = ['<option value="">— เลือกชั้น/ห้อง —</option>'];
    classes.forEach(function (c) {
      const label = c.grade + (c.room ? '/' + c.room : '') + ' (' + c.count + ' คน)';
      opts.push('<option value="' + Utils.esc(c.grade + '|' + c.room) + '">' + Utils.esc(label) + '</option>');
    });
    sel.innerHTML = opts.join('');
  }

  function fillGrades(byGrade) {
    const grades = byGrade.slice().sort(function (a, b) {
      return Utils.gradeSortKey(a.grade) - Utils.gradeSortKey(b.grade);
    }).map(function (g) { return g.grade; });
    const sel = document.getElementById('h-grade');
    const cur = sel.value;
    sel.innerHTML = '<option value="">ทุกชั้น</option>' + Utils.options(grades, cur);
  }

  /* ════ บันทึกผลตรวจ ════ */
  let recClassesLoaded = false;
  async function loadRecClasses() {
    if (recClassesLoaded) return;
    try {
      const d = await api('health.classes', {}, { silent: true, loading: false });
      fillClassSelect(document.getElementById('rec-class'), d.classes);
      recClassesLoaded = true;
    } catch (e) { /* ignore */ }
  }

  async function loadRecStudents() {
    const cls = document.getElementById('rec-class').value;
    const host = document.getElementById('rec-table');
    const actions = document.getElementById('rec-actions');
    document.getElementById('rec-result').classList.add('hidden');
    if (!cls) { host.innerHTML = 'เลือกชั้นเพื่อแสดงรายชื่อนักเรียน'; host.className = 'text-muted'; actions.classList.add('hidden'); return; }
    const parts = cls.split('|');
    try {
      host.className = '';
      const d = await api('health.by_class', { grade: parts[0], room: parts[1], date: getRecDate() }, { loadingMsg: 'กำลังโหลดรายชื่อ...' });
      renderRecTable(d.results);
      actions.classList.remove('hidden');
    } catch (e) { host.innerHTML = '<div class="alert alert-danger">' + Utils.esc(e.message) + '</div>'; }
  }

  function renderRecTable(students) {
    const host = document.getElementById('rec-table');
    if (!students.length) { host.innerHTML = '<div class="text-muted">ไม่มีนักเรียนในชั้นนี้</div>'; return; }
    const head = '<tr><th>ชื่อ</th>' + ITEMS.map(function (it) { return '<th>' + it.label + '</th>'; }).join('') + '<th>สถานะ</th></tr>';
    const body = students.map(function (s, i) {
      const cells = ITEMS.map(function (it) {
        const pass = s[it.key] !== 'ไม่ผ่าน';
        return '<td><button type="button" class="hc-toggle ' + (pass ? 'pass' : 'fail') + '" data-i="' + i + '" data-k="' + it.key + '">' +
          (pass ? 'ผ่าน' : 'ไม่ผ่าน') + '</button></td>';
      }).join('');
      const tag = s.checked ? '<span class="badge badge-pass">ตรวจแล้ว</span>' : '<span class="text-muted" style="font-size:13px">ใหม่</span>';
      return '<tr data-cid="' + Utils.esc(s.citizen_id) + '"><td>' + Utils.esc(s.name) + '<br><span class="text-muted" style="font-size:12px">' +
        Utils.esc(s.grade) + '/' + Utils.esc(s.room) + '</span></td>' + cells + '<td>' + tag + '</td></tr>';
    }).join('');
    host.innerHTML = '<div class="table-wrap"><table class="hc-table"><thead>' + head + '</thead><tbody>' + body + '</tbody></table></div>';

    host.querySelectorAll('.hc-toggle').forEach(function (b) {
      b.onclick = function () {
        const isPass = b.classList.contains('pass');
        b.classList.toggle('pass', !isPass);
        b.classList.toggle('fail', isPass);
        b.textContent = isPass ? 'ไม่ผ่าน' : 'ผ่าน';
      };
    });
  }

  function getRecDate() {
    return document.getElementById('rec-date').value || Utils.todayYmd();
  }

  document.getElementById('rec-class').addEventListener('change', loadRecStudents);
  document.getElementById('rec-date').addEventListener('change', function () {
    if (document.getElementById('rec-class').value) loadRecStudents();
  });

  document.getElementById('rec-allpass').onclick = function () {
    document.querySelectorAll('#rec-table .hc-toggle').forEach(function (b) {
      b.classList.add('pass'); b.classList.remove('fail'); b.textContent = 'ผ่าน';
    });
  };

  document.getElementById('rec-save').onclick = async function () {
    const rows = document.querySelectorAll('#rec-table tbody tr');
    if (!rows.length) return;
    const records = [];
    rows.forEach(function (tr) {
      const rec = { citizen_id: tr.dataset.cid };
      tr.querySelectorAll('.hc-toggle').forEach(function (b) {
        rec[b.dataset.k] = b.classList.contains('fail') ? 'ไม่ผ่าน' : 'ผ่าน';
      });
      records.push(rec);
    });
    try {
      const r = await api('health.save', {
        date: getRecDate(), records: records, recorded_by: document.getElementById('rec-by').value.trim() || 'admin',
      }, { loadingMsg: 'กำลังบันทึก...' });
      const res = document.getElementById('rec-result');
      res.className = 'alert alert-success mt-2';
      res.textContent = '✅ บันทึกผลตรวจวันที่ ' + Utils.fmtDateThai(r.date) + ' สำเร็จ — บันทึกใหม่ ' + r.inserted + ' คน, อัปเดต ' + r.updated + ' คน';
      res.classList.remove('hidden');
      Store.invalidate('health:');
      Toast.show('บันทึกผลตรวจสำเร็จ', 'success');
      loadRecStudents();
    } catch (e) { /* Toast แสดงแล้ว */ }
  };

  /* ════ ภาพรวม ════ */
  async function loadDashboard() {
    const date = document.getElementById('d-date').value || Utils.todayYmd();
    try {
      await Store.swr('health:dash:' + date,
        function (had) { return api('health.dashboard', { date: date }, { loadingMsg: 'กำลังโหลดภาพรวม...', loading: !had, silent: had }); },
        paintDashboard);
    } catch (e) { /* Toast แสดงแล้ว */ }
  }

  function paintDashboard(d) {
      lastDash = d;
      document.getElementById('d-checked').textContent = Utils.fmtInt(d.checked_count);
      document.getElementById('d-notchecked').textContent = Utils.fmtInt(d.not_checked);
      document.getElementById('d-rate').textContent = Utils.fmtNumber(d.overall_pass_rate, 1) + '%';
      document.getElementById('d-total').textContent = Utils.fmtInt(d.total_students);

      drawChart(d.by_item);
      fillGrades(d.by_grade);

      if (!d.fail_list.length) {
        document.getElementById('d-fail').innerHTML = d.checked_count
          ? '<div class="alert alert-success">🎉 ผ่านทุกคน</div>'
          : '<div class="text-muted">ยังไม่มีการตรวจในวันนี้</div>';
      } else {
        const rows = d.fail_list.map(function (f) {
          const items = f.fails.map(function (k) { return labelOf(k); }).join(', ');
          return '<tr><td>' + Utils.esc(f.name) + '</td><td>' + Utils.esc(f.grade) + '/' + Utils.esc(f.room) + '</td>' +
            '<td><span class="badge badge-fail">' + Utils.esc(items) + '</span></td></tr>';
        }).join('');
        document.getElementById('d-fail').innerHTML =
          '<div class="text-muted" style="margin-bottom:6px">ไม่ผ่าน ' + d.fail_list.length + ' คน</div>' +
          '<div class="table-wrap"><table><thead><tr><th>ชื่อ</th><th>ชั้น</th><th>รายการที่ไม่ผ่าน</th></tr></thead><tbody>' + rows + '</tbody></table></div>';
      }
  }

  function labelOf(key) {
    const f = ITEMS.find(function (i) { return i.key === key; });
    return f ? f.label : key;
  }

  function drawChart(byItem) {
    const ctx = document.getElementById('d-chart').getContext('2d');
    if (chart) chart.destroy();
    chart = new Chart(ctx, {
      type: 'bar',
      data: {
        labels: ITEMS.map(function (it) { return it.label; }),
        datasets: [
          { label: 'ผ่าน', data: ITEMS.map(function (it) { return byItem[it.key].pass; }), backgroundColor: '#66BB6A', borderRadius: 6 },
          { label: 'ไม่ผ่าน', data: ITEMS.map(function (it) { return byItem[it.key].fail; }), backgroundColor: '#EF5350', borderRadius: 6 },
        ],
      },
      options: {
        plugins: { legend: { labels: { font: { family: 'Sarabun' } } } },
        scales: {
          x: { stacked: true, ticks: { font: { family: 'Sarabun' } } },
          y: { stacked: true, beginAtZero: true, ticks: { font: { family: 'Sarabun' } } },
        },
      },
    });
  }

  document.getElementById('d-go').onclick = loadDashboard;

  document.getElementById('d-pdf').onclick = async function () {
    if (!lastDash) { Toast.show('ยังไม่มีข้อมูล', 'warning'); return; }
    try {
      Loading.show('กำลังสร้าง PDF...');
      const d = lastDash;
      const doc = await PDF.newDoc('p');
      let y = PDF.header(doc, schoolName, 'สรุปผลตรวจสุขภาพ วันที่ ' + Utils.fmtDateThai(d.date));
      doc.setFontSize(12);
      doc.text('ตรวจแล้ว ' + d.checked_count + ' คน · ยังไม่ตรวจ ' + d.not_checked + ' คน · ผ่านโดยรวม ' + d.overall_pass_rate + '%', 14, y + 4);

      const itemBody = ITEMS.map(function (it) {
        const o = d.by_item[it.key];
        return [it.label, String(o.pass), String(o.fail)];
      });
      doc.autoTable({
        startY: y + 10,
        head: [['รายการ', 'ผ่าน', 'ไม่ผ่าน']],
        body: itemBody,
        styles: { font: 'Sarabun', fontSize: 11, halign: 'center' },
        headStyles: { font: 'Sarabun', fontStyle: 'bold', fillColor: [79, 195, 247] },
        columnStyles: { 0: { halign: 'left' } },
      });

      const failBody = d.fail_list.map(function (f) {
        return [f.name, f.grade + '/' + f.room, f.fails.map(function (k) { return labelOf(k); }).join(', ')];
      });
      doc.autoTable({
        startY: doc.lastAutoTable.finalY + 8,
        head: [['ชื่อ (ไม่ผ่าน)', 'ชั้น', 'รายการที่ไม่ผ่าน']],
        body: failBody.length ? failBody : [['— ผ่านทุกคน —', '', '']],
        styles: { font: 'Sarabun', fontSize: 11 },
        headStyles: { font: 'Sarabun', fontStyle: 'bold', fillColor: [239, 83, 80] },
        columnStyles: { 1: { halign: 'center' } },
      });
      doc.save('health_' + d.date + '.pdf');
    } catch (e) {
      Toast.show('สร้าง PDF ไม่สำเร็จ: ' + e.message, 'danger');
    } finally { Loading.hide(); }
  };

  /* ════ ประวัติ ════ */
  document.getElementById('h-go').onclick = async function () {
    const host = document.getElementById('h-result');
    try {
      const d = await api('health.history', {
        date_from: document.getElementById('h-from').value || undefined,
        date_to: document.getElementById('h-to').value || undefined,
        grade: document.getElementById('h-grade').value || undefined,
        only_fail: document.getElementById('h-fail').value ? 1 : undefined,
        limit: 400,
      }, { loadingMsg: 'กำลังค้นหา...' });

      if (!d.checks.length) { host.innerHTML = '<div class="text-muted">ไม่พบรายการ</div>'; return; }
      const head = '<tr><th>วันที่</th><th>ชื่อ</th><th>ชั้น</th>' +
        ITEMS.map(function (it) { return '<th>' + it.label + '</th>'; }).join('') + '<th>ผู้ตรวจ</th></tr>';
      const rows = d.checks.map(function (c) {
        const cells = ITEMS.map(function (it) {
          const pass = c[it.key] !== 'ไม่ผ่าน';
          return '<td style="text-align:center;color:' + (pass ? 'var(--green-dark)' : 'var(--red)') + ';font-weight:700">' + (pass ? '✓' : '✗') + '</td>';
        }).join('');
        return '<tr><td>' + Utils.fmtDateThai(c.date) + '</td><td>' + Utils.esc(c.name) + '</td>' +
          '<td>' + Utils.esc(c.grade) + '/' + Utils.esc(c.room) + '</td>' + cells +
          '<td>' + Utils.esc(c.recorded_by) + '</td></tr>';
      }).join('');
      host.innerHTML = '<div class="text-muted mt-2" style="margin-bottom:6px">พบ ' + d.checks.length + ' รายการ</div>' +
        '<div class="table-wrap"><table class="hc-table"><thead>' + head + '</thead><tbody>' + rows + '</tbody></table></div>';
    } catch (e) { host.innerHTML = '<div class="alert alert-danger">' + Utils.esc(e.message) + '</div>'; }
  };

  /* ════ เริ่มต้น ════ */
  document.getElementById('rec-date').value = Utils.todayYmd();
  document.getElementById('d-date').value = Utils.todayYmd();
  (async function () {
    try {
      schoolName = await AppSettings.schoolName();
    } catch (e) { /* ใช้ค่า default */ }
    loadRecClasses();
  })();

})();
