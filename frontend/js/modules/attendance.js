/**
 * Module 5 — เช็คการมาเรียน (ไม่ใช้ PIN)
 * เช็คชื่อรายชั้น (มา/ขาด/ลา/สาย) · ภาพรวม + PDF · ประวัติ
 */
(function () {

  let schoolName = 'โรงเรียนบ้านใหม่';
  let chart = null;
  let lastDash = null;

  /* ── ล้าง cache SWR ของเช็คชื่อ — เรียกเมื่อเครื่องตัวเองบันทึกเช็คชื่อ ── */
  function clearDashCache() { Store.invalidate('attendance:'); }

  const STATUSES = [
    { label: 'มา', color: '#2E7D32', bg: '#E8F5E9', border: '#A5D6A7' },
    { label: 'ขาด', color: '#C62828', bg: '#FFEBEE', border: '#EF9A9A' },
    { label: 'ลา', color: '#EF6C00', bg: '#FFF8E1', border: '#FFE0B2' },
    { label: 'สาย', color: '#E65100', bg: '#FFF3E0', border: '#FFCC80' },
  ];
  const metaOf = {};
  STATUSES.forEach(function (s) { metaOf[s.label] = s; });

  /* ── เรียก API (โมดูลนี้ไม่ใช้ PIN แล้ว) ── */
  function attApi(action, params, opts) {
    return api(action, params, opts);
  }

  /* ── Tabs ── */
  document.querySelectorAll('.tab').forEach(function (t) {
    t.addEventListener('click', function () {
      document.querySelectorAll('.tab').forEach(function (x) { x.classList.remove('active'); });
      t.classList.add('active');
      document.querySelectorAll('.tab-pane').forEach(function (p) { p.classList.add('hidden'); });
      document.getElementById('tab-' + t.dataset.tab).classList.remove('hidden');
      if (t.dataset.tab === 'summary') loadSummary();
      else if (t.dataset.tab === 'record') loadRecClasses();
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

  function applyBtn(btn, active) {
    const m = metaOf[btn.dataset.status];
    if (active) {
      btn.style.background = m.bg; btn.style.borderColor = m.border; btn.style.color = m.color;
      btn.classList.add('active');
    } else {
      btn.style.background = '#fff'; btn.style.borderColor = 'var(--border)'; btn.style.color = 'var(--muted)';
      btn.classList.remove('active');
    }
  }

  /* ════ สรุปรายวัน ════ */
  let lastSummary = null;

  function getSumDate() {
    return document.getElementById('s-date').value || Utils.todayYmd();
  }

  async function loadSummary() {
    const host = document.getElementById('s-result');
    const date = getSumDate();
    try {
      await Store.swr('attendance:summary:' + date,
        function (had) { return attApi('attendance.daily_summary', { date: date }, { loadingMsg: 'กำลังโหลดสรุป...', loading: !had, silent: had }); },
        function (d) { lastSummary = d; renderSummary(d); });
    } catch (e) { host.innerHTML = '<div class="alert alert-danger">' + Utils.esc(e.message) + '</div>'; }
  }

  function renderSummary(d) {
    const host = document.getElementById('s-result');
    const note = document.getElementById('s-summary-note');
    note.innerHTML = '📅 ' + Utils.fmtDateThai(d.date) +
      ' · เช็คชื่อแล้ว ' + d.totals.classes_checked + '/' + d.class_count + ' ชั้น';

    if (!d.rows.length) { host.innerHTML = '<div class="text-muted">ยังไม่มีข้อมูลนักเรียน</div>'; return; }

    // แถวข้อมูลรายชั้น — ชั้นที่ยังไม่เช็คใส่ '-' ในคอลัมน์มาเรียน/ไม่มา
    const body = d.rows.map(function (c) {
      const on = c.checked > 0;
      const v = function (x) { return on ? Utils.fmtInt(x) : '-'; };
      return '<tr class="' + (on ? '' : 'unchecked') + '">' +
        '<td>' + Utils.esc(c.grade) + (c.room ? '/' + Utils.esc(c.room) : '') + '</td>' +
        '<td>' + Utils.fmtInt(c.male) + '</td><td>' + Utils.fmtInt(c.female) + '</td><td>' + Utils.fmtInt(c.total) + '</td>' +
        '<td class="grp-a">' + v(c.male_present) + '</td><td class="grp-a">' + v(c.female_present) + '</td><td class="grp-a">' + v(c.present) + '</td>' +
        '<td class="grp-b">' + v(c.absent) + '</td><td class="grp-b">' + v(c.leave) + '</td><td class="grp-b">' + v(c.late) + '</td><td class="grp-b">' + v(c.not_present) + '</td>' +
        '</tr>';
    }).join('');

    const t = d.totals;
    const foot = '<tr><td>รวมทั้งหมด</td>' +
      '<td>' + Utils.fmtInt(t.male) + '</td><td>' + Utils.fmtInt(t.female) + '</td><td>' + Utils.fmtInt(t.total) + '</td>' +
      '<td>' + Utils.fmtInt(t.male_present) + '</td><td>' + Utils.fmtInt(t.female_present) + '</td><td>' + Utils.fmtInt(t.present) + '</td>' +
      '<td>' + Utils.fmtInt(t.absent) + '</td><td>' + Utils.fmtInt(t.leave) + '</td><td>' + Utils.fmtInt(t.late) + '</td><td>' + Utils.fmtInt(t.not_present) + '</td></tr>';

    host.innerHTML =
      '<div class="table-wrap"><table class="sum-table">' +
      '<thead>' +
      '<tr><th rowspan="2">ชั้น</th><th colspan="3">จำนวนนักเรียน</th><th colspan="3">มาเรียน</th><th colspan="4">ไม่มาเรียน</th></tr>' +
      '<tr><th>ชาย</th><th>หญิง</th><th>รวม</th><th>ชาย</th><th>หญิง</th><th>รวม</th><th>ขาด</th><th>ลา</th><th>สาย</th><th>รวม</th></tr>' +
      '</thead>' +
      '<tbody>' + body + '</tbody>' +
      '<tfoot>' + foot + '</tfoot>' +
      '</table></div>' +
      '<div class="text-muted" style="font-size:13px;margin-top:8px">หมายเหตุ: เครื่องหมาย “-” หมายถึงชั้นที่ยังไม่ได้เช็คชื่อในวันนี้</div>';
  }

  document.getElementById('s-go').onclick = loadSummary;
  document.getElementById('s-date').addEventListener('change', loadSummary);

  document.getElementById('s-pdf').onclick = async function () {
    if (!lastSummary) { Toast.show('ยังไม่มีข้อมูล', 'warning'); return; }
    try {
      Loading.show('กำลังสร้าง PDF...');
      const d = lastSummary;
      const doc = await PDF.newDoc('l');
      let y = PDF.header(doc, schoolName, 'สรุปการมาเรียนรายวัน · ' + Utils.fmtDateThai(d.date));
      doc.setFontSize(11);
      doc.text('เช็คชื่อแล้ว ' + d.totals.classes_checked + '/' + d.class_count + ' ชั้น', 14, y + 4);

      const dash = function (c, x) { return c.checked > 0 ? String(x) : '-'; };
      const body = d.rows.map(function (c) {
        return [
          c.grade + (c.room ? '/' + c.room : ''),
          c.male, c.female, c.total,
          dash(c, c.male_present), dash(c, c.female_present), dash(c, c.present),
          dash(c, c.absent), dash(c, c.leave), dash(c, c.late), dash(c, c.not_present),
        ];
      });
      const t = d.totals;
      body.push(['รวมทั้งหมด', t.male, t.female, t.total, t.male_present, t.female_present, t.present,
        t.absent, t.leave, t.late, t.not_present]);

      doc.autoTable({
        startY: y + 10,
        head: [
          [{ content: 'ชั้น', rowSpan: 2 }, { content: 'จำนวนนักเรียน', colSpan: 3 },
            { content: 'มาเรียน', colSpan: 3 }, { content: 'ไม่มาเรียน', colSpan: 4 }],
          ['ชาย', 'หญิง', 'รวม', 'ชาย', 'หญิง', 'รวม', 'ขาด', 'ลา', 'สาย', 'รวม'],
        ],
        body: body,
        styles: { font: 'Sarabun', fontSize: 10, halign: 'center' },
        headStyles: { font: 'Sarabun', fontStyle: 'bold', fillColor: [79, 195, 247], halign: 'center' },
        columnStyles: { 0: { halign: 'left' } },
        didParseCell: function (data) {
          if (data.section === 'body' && data.row.index === body.length - 1) {
            data.cell.styles.fontStyle = 'bold';
            data.cell.styles.fillColor = [235, 245, 251];
          }
        },
      });
      doc.save('attendance_summary_' + d.date + '.pdf');
    } catch (e) {
      Toast.show('สร้าง PDF ไม่สำเร็จ: ' + e.message, 'danger');
    } finally { Loading.hide(); }
  };

  /* ════ เช็คชื่อ ════ */
  let recClassesLoaded = false;
  async function loadRecClasses() {
    if (recClassesLoaded) return;
    try {
      const d = await attApi('attendance.classes', {}, { silent: true, loading: false });
      fillClassSelect(document.getElementById('rec-class'), d.classes);
      recClassesLoaded = true;
    } catch (e) { /* ignore */ }
  }

  function getRecDate() {
    return document.getElementById('rec-date').value || Utils.todayYmd();
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
      const d = await attApi('attendance.by_class', { grade: parts[0], room: parts[1], date: getRecDate() }, { loadingMsg: 'กำลังโหลดรายชื่อ...' });
      renderRecTable(d.results);
      actions.classList.remove('hidden');
    } catch (e) { host.innerHTML = '<div class="alert alert-danger">' + Utils.esc(e.message) + '</div>'; }
  }

  function renderRecTable(students) {
    const host = document.getElementById('rec-table');
    if (!students.length) { host.innerHTML = '<div class="text-muted">ไม่มีนักเรียนในชั้นนี้</div>'; return; }
    const body = students.map(function (s) {
      const btns = STATUSES.map(function (st) {
        return '<button type="button" class="att-btn" data-status="' + st.label + '">' + st.label + '</button>';
      }).join('');
      const tag = s.checked ? '<span class="badge badge-pass">เช็คแล้ว</span>' : '<span class="text-muted" style="font-size:13px">ใหม่</span>';
      return '<tr data-cid="' + Utils.esc(s.citizen_id) + '" data-cur="' + Utils.esc(s.status) + '">' +
        '<td>' + Utils.esc(s.name) + '<br><span class="text-muted" style="font-size:12px">' + Utils.esc(s.grade) + '/' + Utils.esc(s.room) + '</span></td>' +
        '<td><div class="att-seg">' + btns + '</div></td><td>' + tag + '</td></tr>';
    }).join('');
    host.innerHTML = '<div class="table-wrap"><table class="att-table"><thead><tr><th>ชื่อ</th><th>สถานะ</th><th></th></tr></thead><tbody>' + body + '</tbody></table></div>';

    host.querySelectorAll('tbody tr').forEach(function (tr) {
      const cur = tr.dataset.cur || 'มา';
      tr.querySelectorAll('.att-btn').forEach(function (b) {
        applyBtn(b, b.dataset.status === cur);
        b.onclick = function () {
          tr.querySelectorAll('.att-btn').forEach(function (x) { applyBtn(x, false); });
          applyBtn(b, true);
        };
      });
    });
  }

  document.getElementById('rec-class').addEventListener('change', loadRecStudents);
  document.getElementById('rec-date').addEventListener('change', function () {
    if (document.getElementById('rec-class').value) loadRecStudents();
  });

  document.getElementById('rec-allpresent').onclick = function () {
    document.querySelectorAll('#rec-table tbody tr').forEach(function (tr) {
      tr.querySelectorAll('.att-btn').forEach(function (b) { applyBtn(b, b.dataset.status === 'มา'); });
    });
  };

  document.getElementById('rec-save').onclick = async function () {
    const rows = document.querySelectorAll('#rec-table tbody tr');
    if (!rows.length) return;
    const records = [];
    rows.forEach(function (tr) {
      const active = tr.querySelector('.att-btn.active');
      records.push({ citizen_id: tr.dataset.cid, status: active ? active.dataset.status : 'มา' });
    });
    try {
      const r = await attApi('attendance.save', {
        date: getRecDate(), records: records, recorded_by: document.getElementById('rec-by').value.trim() || 'admin',
      }, { loadingMsg: 'กำลังบันทึก...' });
      const res = document.getElementById('rec-result');
      res.className = 'alert alert-success mt-2';
      res.textContent = '✅ บันทึกการเช็คชื่อวันที่ ' + Utils.fmtDateThai(r.date) + ' สำเร็จ — บันทึกใหม่ ' + r.inserted + ' คน, อัปเดต ' + r.updated + ' คน';
      res.classList.remove('hidden');
      clearDashCache();  // สถานะเปลี่ยน → สรุปรายวัน/ภาพรวม ต้องโหลดใหม่
      Toast.show('บันทึกการเช็คชื่อสำเร็จ', 'success');
      loadRecStudents();
    } catch (e) { /* Toast แสดงแล้ว */ }
  };

  /* ════ ภาพรวม ════ */
  async function loadDashboard() {
    const date = document.getElementById('d-date').value || Utils.todayYmd();
    try {
      await Store.swr('attendance:dash:' + date,
        function (had) { return attApi('attendance.dashboard', { date: date }, { loadingMsg: 'กำลังโหลดภาพรวม...', loading: !had, silent: had }); },
        paintDashboard);
    } catch (e) { /* Toast แสดงแล้ว */ }
  }

  function paintDashboard(d) {
      lastDash = d;
      document.getElementById('d-present').textContent = Utils.fmtInt(d.counts['มา']);
      document.getElementById('d-absent').textContent = Utils.fmtInt(d.counts['ขาด']);
      document.getElementById('d-leave').textContent = Utils.fmtInt(d.counts['ลา']);
      document.getElementById('d-late').textContent = Utils.fmtInt(d.counts['สาย']);
      document.getElementById('d-rate').textContent = Utils.fmtNumber(d.present_rate, 1) + '%';
      document.getElementById('d-notchecked').textContent = Utils.fmtInt(d.not_checked);

      drawChart(d.counts);
      fillGrades(d.by_grade);

      if (!d.absent_list.length) {
        document.getElementById('d-absent-list').innerHTML = d.checked_count
          ? '<div class="alert alert-success">🎉 มาเรียนครบทุกคน</div>'
          : '<div class="text-muted">ยังไม่มีการเช็คชื่อในวันนี้</div>';
      } else {
        const rows = d.absent_list.map(function (a) {
          const m = metaOf[a.status] || {};
          return '<tr><td>' + Utils.esc(a.name) + '</td><td>' + Utils.esc(a.grade) + '/' + Utils.esc(a.room) + '</td>' +
            '<td><span class="badge" style="background:' + (m.bg || '#eee') + ';color:' + (m.color || '#333') + '">' + Utils.esc(a.status) + '</span></td></tr>';
        }).join('');
        document.getElementById('d-absent-list').innerHTML =
          '<div class="text-muted" style="margin-bottom:6px">ไม่มา ' + d.absent_list.length + ' คน</div>' +
          '<div class="table-wrap"><table><thead><tr><th>ชื่อ</th><th>ชั้น</th><th>สถานะ</th></tr></thead><tbody>' + rows + '</tbody></table></div>';
      }
  }

  function drawChart(counts) {
    const ctx = document.getElementById('d-chart').getContext('2d');
    if (chart) chart.destroy();
    chart = new Chart(ctx, {
      type: 'bar',
      data: {
        labels: STATUSES.map(function (s) { return s.label; }),
        datasets: [{
          label: 'จำนวน',
          data: STATUSES.map(function (s) { return counts[s.label] || 0; }),
          backgroundColor: STATUSES.map(function (s) { return s.color; }),
          borderRadius: 8,
        }],
      },
      options: {
        plugins: { legend: { display: false } },
        scales: { y: { beginAtZero: true, ticks: { font: { family: 'Sarabun' }, precision: 0 } }, x: { ticks: { font: { family: 'Sarabun' } } } },
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
      let y = PDF.header(doc, schoolName, 'สรุปการมาเรียน วันที่ ' + Utils.fmtDateThai(d.date));
      doc.setFontSize(12);
      doc.text('เช็คแล้ว ' + d.checked_count + ' คน · ยังไม่เช็ค ' + d.not_checked + ' คน · อัตรามาเรียน ' + d.present_rate + '%', 14, y + 4);

      doc.autoTable({
        startY: y + 10,
        head: [['สถานะ', 'จำนวน']],
        body: STATUSES.map(function (s) { return [s.label, String(d.counts[s.label] || 0)]; }),
        styles: { font: 'Sarabun', fontSize: 11, halign: 'center' },
        headStyles: { font: 'Sarabun', fontStyle: 'bold', fillColor: [79, 195, 247] },
        columnStyles: { 0: { halign: 'left' } },
      });

      const absBody = d.absent_list.map(function (a) { return [a.name, a.grade + '/' + a.room, a.status]; });
      doc.autoTable({
        startY: doc.lastAutoTable.finalY + 8,
        head: [['ชื่อ (ไม่มา)', 'ชั้น', 'สถานะ']],
        body: absBody.length ? absBody : [['— มาครบทุกคน —', '', '']],
        styles: { font: 'Sarabun', fontSize: 11 },
        headStyles: { font: 'Sarabun', fontStyle: 'bold', fillColor: [239, 83, 80] },
        columnStyles: { 1: { halign: 'center' }, 2: { halign: 'center' } },
      });
      doc.save('attendance_' + d.date + '.pdf');
    } catch (e) {
      Toast.show('สร้าง PDF ไม่สำเร็จ: ' + e.message, 'danger');
    } finally { Loading.hide(); }
  };

  /* ════ ประวัติ ════ */
  document.getElementById('h-go').onclick = async function () {
    const host = document.getElementById('h-result');
    try {
      const d = await attApi('attendance.history', {
        date_from: document.getElementById('h-from').value || undefined,
        date_to: document.getElementById('h-to').value || undefined,
        grade: document.getElementById('h-grade').value || undefined,
        status: document.getElementById('h-status').value || undefined,
        limit: 400,
      }, { loadingMsg: 'กำลังค้นหา...' });

      if (!d.records.length) { host.innerHTML = '<div class="text-muted">ไม่พบรายการ</div>'; return; }
      const rows = d.records.map(function (a) {
        const m = metaOf[a.status] || {};
        return '<tr><td>' + Utils.fmtDateThai(a.date) + '</td><td>' + Utils.esc(a.name) + '</td>' +
          '<td>' + Utils.esc(a.grade) + '/' + Utils.esc(a.room) + '</td>' +
          '<td><span class="badge" style="background:' + (m.bg || '#eee') + ';color:' + (m.color || '#333') + '">' + Utils.esc(a.status) + '</span></td>' +
          '<td>' + Utils.esc(a.recorded_by) + '</td></tr>';
      }).join('');
      host.innerHTML = '<div class="text-muted mt-2" style="margin-bottom:6px">พบ ' + d.records.length + ' รายการ</div>' +
        '<div class="table-wrap"><table><thead><tr><th>วันที่</th><th>ชื่อ</th><th>ชั้น</th><th>สถานะ</th><th>ผู้บันทึก</th></tr></thead><tbody>' + rows + '</tbody></table></div>';
    } catch (e) { host.innerHTML = '<div class="alert alert-danger">' + Utils.esc(e.message) + '</div>'; }
  };

  /* ════ เริ่มต้น ════ */
  document.getElementById('s-date').value = Utils.todayYmd();
  document.getElementById('rec-date').value = Utils.todayYmd();
  document.getElementById('d-date').value = Utils.todayYmd();
  (async function () {
    try {
      const cfg = await api('settings.get', {}, { silent: true, loading: false });
      if (cfg.settings && cfg.settings.school_name) schoolName = cfg.settings.school_name;
    } catch (e) { /* ใช้ค่า default */ }
    loadSummary();
  })();

})();
