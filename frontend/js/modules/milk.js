/**
 * Module — นมโรงเรียน (ไม่ใช้ PIN)
 * ภาพรวมนมค้างรับตามชั้น · รายชื่อค้างรับ + ปุ่ม "ได้รับนมแล้ว" · ตั้งค่า (ล้างทั้งโรงเรียน)
 */
(function () {

  let schoolName = 'โรงเรียนบ้านใหม่';
  let chart = null;
  let lastPending = null;   // ผลรายชื่อค้างล่าสุด (สำหรับ PDF)

  /* ── ล้าง cache SWR ของนมโรงเรียน — เรียกเมื่อเครื่องตัวเองแจกนม/ล้างยอด ── */
  function clearDashCache() { Store.invalidate('milk:'); }

  /* ── Tabs ── */
  document.querySelectorAll('.tab').forEach(function (t) {
    t.addEventListener('click', function () {
      document.querySelectorAll('.tab').forEach(function (x) { x.classList.remove('active'); });
      t.classList.add('active');
      document.querySelectorAll('.tab-pane').forEach(function (p) { p.classList.add('hidden'); });
      document.getElementById('tab-' + t.dataset.tab).classList.remove('hidden');
      if (t.dataset.tab === 'dashboard') loadDashboard();
      else if (t.dataset.tab === 'pending') { loadClasses(); loadPending(); }
    });
  });

  /* ════ ภาพรวม ════ */
  async function loadDashboard() {
    try {
      await Store.swr('milk:dash',
        function (had) { return api('milk.dashboard', {}, { loadingMsg: 'กำลังโหลดภาพรวม...', loading: !had, silent: had }); },
        paintDashboard);
    } catch (e) { /* Toast แสดงแล้ว */ }
  }

  function paintDashboard(d) {
    document.getElementById('d-students').textContent = Utils.fmtInt(d.total_pending_students);
    document.getElementById('d-boxes').textContent = Utils.fmtInt(d.total_pending_boxes) + ' กล่อง';
    document.getElementById('d-date').textContent = Utils.fmtDateThai(d.date);

    const host = document.getElementById('d-byclass');
    if (!d.by_class.length) {
      host.innerHTML = '<div class="alert alert-success">🎉 ไม่มีนักเรียนค้างรับนม — จ่ายครบทุกคน</div>';
    } else {
      const rows = d.by_class.map(function (c) {
        return '<tr><td>' + Utils.esc(c.grade) + (c.room ? '/' + Utils.esc(c.room) : '') + '</td>' +
          '<td style="text-align:right;font-weight:700;color:var(--pink)">' + Utils.fmtInt(c.students) + '</td>' +
          '<td style="text-align:right;color:#EF6C00">' + Utils.fmtInt(c.boxes) + '</td></tr>';
      }).join('');
      host.innerHTML = '<div class="table-wrap"><table><thead><tr><th>ชั้น</th>' +
        '<th style="text-align:right">นักเรียนค้างรับ</th><th style="text-align:right">กล่องค้าง</th></tr></thead><tbody>' + rows + '</tbody></table></div>';
    }

    const byClass = d.by_class.slice().sort(function (a, b) {
      return Utils.gradeSortKey(a.grade) - Utils.gradeSortKey(b.grade);
    });
    drawChart(
      byClass.map(function (c) { return c.grade + (c.room ? '/' + c.room : ''); }),
      byClass.map(function (c) { return c.boxes; })
    );
  }

  function drawChart(labels, data) {
    const ctx = document.getElementById('d-chart').getContext('2d');
    if (chart) chart.destroy();
    chart = new Chart(ctx, {
      type: 'bar',
      data: { labels: labels, datasets: [{ label: 'กล่องค้าง', data: data, backgroundColor: '#FFB74D', borderRadius: 8 }] },
      options: {
        plugins: { legend: { display: false } },
        scales: { y: { beginAtZero: true, ticks: { precision: 0, font: { family: 'Sarabun' } } }, x: { ticks: { font: { family: 'Sarabun' } } } },
      },
    });
  }

  /* ════ ค้างรับนม ════ */
  let classesLoaded = false;
  async function loadClasses() {
    if (classesLoaded) return;
    try {
      const d = await api('milk.classes', {}, { silent: true, loading: false });
      const opts = ['<option value="">ทุกชั้น</option>'];
      d.classes.forEach(function (c) {
        const label = c.grade + (c.room ? '/' + c.room : '') + ' (' + c.count + ' คน)';
        opts.push('<option value="' + Utils.esc(c.grade + '|' + c.room) + '">' + Utils.esc(label) + '</option>');
      });
      document.getElementById('p-class').innerHTML = opts.join('');
      classesLoaded = true;
    } catch (e) { /* ignore */ }
  }
  document.getElementById('p-class').addEventListener('change', loadPending);

  async function loadPending() {
    const sel = document.getElementById('p-class').value;
    const parts = sel ? sel.split('|') : ['', ''];
    const key = 'milk:pending:' + (parts[0] || '') + ':' + (parts[1] || '');
    try {
      await Store.swr(key,
        function (had) {
          return api('milk.pending', { grade: parts[0] || undefined, room: parts[1] || undefined },
            { loadingMsg: 'กำลังโหลดรายชื่อ...', loading: !had, silent: had });
        },
        paintPending);
    } catch (e) {
      document.getElementById('p-result').innerHTML = '<div class="alert alert-danger">' + Utils.esc(e.message) + '</div>';
    }
  }

  function paintPending(d) {
    lastPending = d;
    document.getElementById('p-summary').textContent =
      'ค้างรับ ' + d.count + ' คน · รวม ' + d.boxes + ' กล่อง';
    const host = document.getElementById('p-result');
    if (!d.students.length) {
      host.innerHTML = '<div class="alert alert-success">🎉 ไม่มีนักเรียนค้างรับนมในกลุ่มนี้</div>';
      return;
    }
    const rows = d.students.map(function (s, i) {
      return '<tr data-i="' + i + '">' +
        '<td>' + Utils.esc(s.name) + '<br><span class="text-muted" style="font-size:12px">' + Utils.esc(s.grade) + '/' + Utils.esc(s.room) + '</span></td>' +
        '<td style="text-align:center">' + (s.last_absent ? Utils.fmtDateThai(s.last_absent) : '-') + '</td>' +
        '<td style="text-align:center;font-weight:700;color:#EF6C00;font-size:17px">' + s.pending_boxes + '</td>' +
        '<td style="text-align:right"><button class="btn btn-success" style="padding:5px 12px;font-size:14px" data-i="' + i + '"><i class="bi bi-check2-circle"></i> ได้รับแล้ว</button></td></tr>';
    }).join('');
    host.innerHTML = '<div class="table-wrap"><table><thead><tr><th>ชื่อ</th><th style="text-align:center">ไม่มาล่าสุด</th>' +
      '<th style="text-align:center">กล่องค้าง</th><th></th></tr></thead><tbody>' + rows + '</tbody></table></div>';
    host.querySelectorAll('button[data-i]').forEach(function (b) {
      b.onclick = function () { markReceived(d.students[parseInt(b.dataset.i, 10)], b); };
    });
  }

  async function markReceived(s, btn) {
    if (!confirm('ยืนยันว่า "' + s.name + '" ได้รับนมค้าง ' + s.pending_boxes + ' กล่องแล้ว?')) return;
    btn.disabled = true;
    try {
      const r = await api('milk.mark_received', {
        citizen_id: s.citizen_id, recorded_by: document.getElementById('p-by').value.trim() || 'admin',
      }, { loadingMsg: 'กำลังบันทึก...' });
      Toast.show('บันทึกรับนม ' + r.cleared_boxes + ' กล่องแล้ว', 'success');
      clearDashCache();       // ยอดค้างเปลี่ยน → รายชื่อ/ภาพรวม โหลดใหม่
      loadPending();
    } catch (e) { btn.disabled = false; /* Toast */ }
  }

  document.getElementById('p-pdf').onclick = async function () {
    if (!lastPending || !lastPending.students.length) { Toast.show('ไม่มีรายชื่อค้างรับนม', 'warning'); return; }
    try {
      Loading.show('กำลังสร้าง PDF...');
      const doc = await PDF.newDoc('p');
      let y = PDF.header(doc, schoolName, 'รายชื่อนักเรียนค้างรับนม');
      doc.setFontSize(11);
      doc.text('รวม ' + lastPending.count + ' คน · ' + lastPending.boxes + ' กล่อง · ณ ' + Utils.fmtDateThai(new Date()), 14, y + 4);
      const body = lastPending.students.map(function (s, i) {
        return [String(i + 1), s.name, s.grade + '/' + s.room, s.last_absent ? Utils.fmtDateThai(s.last_absent) : '-', String(s.pending_boxes)];
      });
      doc.autoTable({
        startY: y + 10,
        head: [['#', 'ชื่อ-สกุล', 'ชั้น', 'ไม่มาล่าสุด', 'กล่องค้าง']],
        body: body,
        styles: { font: 'Sarabun', fontSize: 11 },
        headStyles: { font: 'Sarabun', fontStyle: 'bold', fillColor: [255, 183, 77], halign: 'center' },
        columnStyles: { 0: { halign: 'center' }, 2: { halign: 'center' }, 3: { halign: 'center' }, 4: { halign: 'center' } },
      });
      doc.save('milk_pending_' + Utils.todayYmd() + '.pdf');
    } catch (e) {
      Toast.show('สร้าง PDF ไม่สำเร็จ: ' + e.message, 'danger');
    } finally { Loading.hide(); }
  };

  /* ════ ตั้งค่า — ล้างยอดทั้งโรงเรียน ════ */
  document.getElementById('s-reset').onclick = async function () {
    if (!confirm('ยืนยันล้างยอดนมค้างทั้งโรงเรียน?\nทุกคนจะถือว่ารับนมครบถึงวันนี้ — ยอดค้างก่อนหน้าจะถูกล้างทั้งหมด (ย้อนกลับไม่ได้)')) return;
    try {
      const r = await api('milk.reset_all', {
        recorded_by: document.getElementById('s-by').value.trim() || 'admin',
      }, { loadingMsg: 'กำลังล้างยอด...' });
      clearDashCache();
      const res = document.getElementById('s-result');
      res.className = 'alert alert-success mt-2';
      res.textContent = '✅ ล้างยอดนมค้างทั้งโรงเรียนแล้ว (ถึงวันที่ ' + Utils.fmtDateThai(r.through) + ')';
      res.classList.remove('hidden');
      Toast.show('ล้างยอดนมค้างสำเร็จ', 'success');
    } catch (e) { /* Toast */ }
  };

  /* ════ เริ่มต้น ════ */
  document.getElementById('d-date').textContent = Utils.fmtDateThai(new Date());
  (async function () {
    try {
      const cfg = await api('settings.get', {}, { silent: true, loading: false });
      if (cfg.settings && cfg.settings.school_name) schoolName = cfg.settings.school_name;
    } catch (e) { /* ใช้ค่า default */ }
    loadDashboard();
  })();

})();
