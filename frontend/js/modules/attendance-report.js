/**
 * รายงานการมาเรียนรายเดือน — รายชั้น / รายคน (ไม่ใช้ PIN)
 * backend: attendance.report_months · attendance.monthly_by_class · attendance.monthly_by_student
 */
(function () {

  let schoolName = 'โรงเรียนบ้านใหม่';
  let lastClass = null, lastStudent = null;
  let classesLoaded = false;

  const TMONTHS = ['', 'มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน', 'พฤษภาคม', 'มิถุนายน',
    'กรกฎาคม', 'สิงหาคม', 'กันยายน', 'ตุลาคม', 'พฤศจิกายน', 'ธันวาคม'];
  function ymLabel(ym) {
    if (!ym) return '';
    const p = String(ym).split('-');
    return TMONTHS[parseInt(p[1], 10)] + ' ' + (parseInt(p[0], 10) + 543);
  }
  function month() { return document.getElementById('r-month').value; }
  function rateCls(r) { return r >= 90 ? 'rate-hi' : (r >= 75 ? 'rate-mid' : 'rate-lo'); }
  function activeTab() { return document.querySelector('.tab.active').dataset.tab; }

  /* ── Tabs ── */
  document.querySelectorAll('.tab').forEach(function (t) {
    t.addEventListener('click', function () {
      document.querySelectorAll('.tab').forEach(function (x) { x.classList.remove('active'); });
      t.classList.add('active');
      document.querySelectorAll('.tab-pane').forEach(function (p) { p.classList.add('hidden'); });
      document.getElementById('tab-' + t.dataset.tab).classList.remove('hidden');
      if (t.dataset.tab === 'class') loadClass(); else loadStudent();
    });
  });

  document.getElementById('r-month').addEventListener('change', function () {
    document.getElementById('r-info').textContent = '';
    if (activeTab() === 'class') loadClass(); else loadStudent();
  });

  /* ════ รายชั้น ════ */
  async function loadClass() {
    const ym = month();
    if (!ym) return;
    const host = document.getElementById('c-result');
    try {
      await Store.swr('attreport:class:' + ym,
        function (had) { return api('attendance.monthly_by_class', { year_month: ym }, { loadingMsg: 'กำลังโหลดรายงาน...', loading: !had, silent: had }); },
        function (d) { lastClass = d; renderClass(d); });
    } catch (e) { host.innerHTML = '<div class="alert alert-danger">' + Utils.esc(e.message) + '</div>'; }
  }

  function renderClass(d) {
    document.getElementById('r-info').textContent =
      '📊 ' + ymLabel(d.year_month) + ' · มีการเช็คชื่อ ' + d.school_days + ' วัน · ' + d.class_count + ' ชั้น';
    const host = document.getElementById('c-result');
    if (!d.rows.length) { host.innerHTML = '<div class="text-muted">ยังไม่มีข้อมูลนักเรียน</div>'; return; }

    const cell = function (c) {
      return '<tr>' +
        '<td>' + Utils.esc(c.grade) + (c.room ? '/' + Utils.esc(c.room) : '') + '</td>' +
        '<td>' + Utils.fmtInt(c.student_count) + '</td>' +
        '<td>' + Utils.fmtInt(c.days_checked) + '</td>' +
        '<td class="grp-a">' + Utils.fmtInt(c.present) + '</td>' +
        '<td class="grp-b">' + Utils.fmtInt(c.late) + '</td>' +
        '<td class="grp-b">' + Utils.fmtInt(c.leave) + '</td>' +
        '<td class="grp-b">' + Utils.fmtInt(c.absent) + '</td>' +
        '<td class="grp-a">' + Utils.fmtInt(c.came) + '</td>' +
        '<td class="' + rateCls(c.rate) + '">' + (c.records ? Utils.fmtNumber(c.rate, 1) + '%' : '-') + '</td>' +
        '</tr>';
    };
    const t = d.totals;
    const foot = '<tr><td>รวมทั้งหมด</td><td>' + Utils.fmtInt(t.student_count) + '</td><td>' + Utils.fmtInt(t.days_checked) + '</td>' +
      '<td>' + Utils.fmtInt(t.present) + '</td><td>' + Utils.fmtInt(t.late) + '</td><td>' + Utils.fmtInt(t.leave) + '</td><td>' + Utils.fmtInt(t.absent) + '</td>' +
      '<td>' + Utils.fmtInt(t.came) + '</td><td>' + (t.records ? Utils.fmtNumber(t.rate, 1) + '%' : '-') + '</td></tr>';

    host.innerHTML = '<div class="table-wrap"><table class="sum-table">' +
      '<thead><tr><th>ชั้น</th><th>นักเรียน</th><th>วันเช็ค</th><th>มา</th><th>สาย</th><th>ลา</th><th>ขาด</th><th>มาโรงเรียน</th><th>อัตรา</th></tr></thead>' +
      '<tbody>' + d.rows.map(cell).join('') + '</tbody>' +
      '<tfoot>' + foot + '</tfoot></table></div>';
  }

  /* ════ รายคน ════ */
  async function loadClasses() {
    if (classesLoaded) return;
    try {
      const d = await api('attendance.classes', {}, { silent: true, loading: false });
      const opts = ['<option value="">— เลือกชั้น —</option>'];
      d.classes.forEach(function (c) {
        opts.push('<option value="' + Utils.esc(c.grade + '|' + c.room) + '">' +
          Utils.esc(c.grade + (c.room ? '/' + c.room : '') + ' (' + c.count + ' คน)') + '</option>');
      });
      document.getElementById('st-class').innerHTML = opts.join('');
      classesLoaded = true;
    } catch (e) { /* ignore */ }
  }

  async function loadStudent() {
    await loadClasses();
    const ym = month();
    const cls = document.getElementById('st-class').value;
    const host = document.getElementById('st-result');
    if (!cls) { host.className = 'text-muted'; host.textContent = 'เลือกชั้นเพื่อแสดงรายงานรายคน'; lastStudent = null; return; }
    const parts = cls.split('|');
    host.className = '';
    try {
      await Store.swr('attreport:stu:' + ym + ':' + cls,
        function (had) { return api('attendance.monthly_by_student', { year_month: ym, grade: parts[0], room: parts[1] }, { loadingMsg: 'กำลังโหลด...', loading: !had, silent: had }); },
        function (d) { lastStudent = d; renderStudent(d); });
    } catch (e) { host.innerHTML = '<div class="alert alert-danger">' + Utils.esc(e.message) + '</div>'; }
  }

  function renderStudent(d) {
    document.getElementById('r-info').textContent =
      '📊 ' + ymLabel(d.year_month) + ' · ชั้น ' + d.grade + (d.room ? '/' + d.room : '') + ' · มีการเช็คชื่อ ' + d.school_days + ' วัน';
    const host = document.getElementById('st-result');
    if (!d.rows.length) { host.innerHTML = '<div class="text-muted">ไม่มีนักเรียนในชั้นนี้</div>'; return; }

    const body = d.rows.map(function (s, i) {
      return '<tr><td style="text-align:center">' + (i + 1) + '</td><td>' + Utils.esc(s.name) + '</td>' +
        '<td class="grp-a">' + Utils.fmtInt(s.present) + '</td>' +
        '<td class="grp-b">' + Utils.fmtInt(s.late) + '</td>' +
        '<td class="grp-b">' + Utils.fmtInt(s.leave) + '</td>' +
        '<td class="grp-b">' + Utils.fmtInt(s.absent) + '</td>' +
        '<td>' + Utils.fmtInt(s.days_checked) + '</td>' +
        '<td class="' + rateCls(s.rate) + '">' + (s.records ? Utils.fmtNumber(s.rate, 1) + '%' : '-') + '</td></tr>';
    }).join('');
    const t = d.totals;
    const foot = '<tr><td></td><td>รวม ' + Utils.fmtInt(t.student_count) + ' คน</td>' +
      '<td>' + Utils.fmtInt(t.present) + '</td><td>' + Utils.fmtInt(t.late) + '</td><td>' + Utils.fmtInt(t.leave) + '</td><td>' + Utils.fmtInt(t.absent) + '</td>' +
      '<td>-</td><td>' + (t.records ? Utils.fmtNumber(t.rate, 1) + '%' : '-') + '</td></tr>';

    host.innerHTML = '<div class="table-wrap"><table class="sum-table">' +
      '<thead><tr><th>#</th><th>ชื่อ</th><th>มา</th><th>สาย</th><th>ลา</th><th>ขาด</th><th>วันบันทึก</th><th>อัตรา</th></tr></thead>' +
      '<tbody>' + body + '</tbody><tfoot>' + foot + '</tfoot></table></div>';
  }

  document.getElementById('st-class').addEventListener('change', loadStudent);

  /* ════ PDF ════ */
  document.getElementById('c-pdf').onclick = async function () {
    if (!lastClass || !lastClass.rows.length) { Toast.show('ยังไม่มีข้อมูล', 'warning'); return; }
    try {
      Loading.show('กำลังสร้าง PDF...');
      const d = lastClass;
      const doc = await PDF.newDoc('l');
      let y = PDF.header(doc, schoolName, 'รายงานการมาเรียนรายเดือน (รายชั้น) · ' + ymLabel(d.year_month));
      doc.setFontSize(11);
      doc.text('มีการเช็คชื่อ ' + d.school_days + ' วัน · ' + d.class_count + ' ชั้น', 14, y + 4);

      const body = d.rows.map(function (c) {
        return [c.grade + (c.room ? '/' + c.room : ''), c.student_count, c.days_checked,
          c.present, c.late, c.leave, c.absent, c.came, c.records ? Utils.fmtNumber(c.rate, 1) + '%' : '-'];
      });
      const t = d.totals;
      body.push(['รวมทั้งหมด', t.student_count, t.days_checked, t.present, t.late, t.leave, t.absent, t.came,
        t.records ? Utils.fmtNumber(t.rate, 1) + '%' : '-']);

      doc.autoTable({
        startY: y + 10,
        head: [['ชั้น', 'นักเรียน', 'วันเช็ค', 'มา', 'สาย', 'ลา', 'ขาด', 'มาโรงเรียน', 'อัตรา']],
        body: body,
        styles: { font: 'Sarabun', fontSize: 10, halign: 'center' },
        headStyles: { font: 'Sarabun', fontStyle: 'bold', fillColor: [79, 195, 247] },
        columnStyles: { 0: { halign: 'left' } },
        didParseCell: function (data) {
          if (data.section === 'body' && data.row.index === body.length - 1) {
            data.cell.styles.fontStyle = 'bold'; data.cell.styles.fillColor = [235, 245, 251];
          }
        },
      });
      doc.save('attendance_month_class_' + d.year_month + '.pdf');
    } catch (e) { Toast.show('สร้าง PDF ไม่สำเร็จ: ' + e.message, 'danger'); }
    finally { Loading.hide(); }
  };

  document.getElementById('st-pdf').onclick = async function () {
    if (!lastStudent || !lastStudent.rows.length) { Toast.show('ยังไม่มีข้อมูล', 'warning'); return; }
    try {
      Loading.show('กำลังสร้าง PDF...');
      const d = lastStudent;
      const doc = await PDF.newDoc('p');
      let y = PDF.header(doc, schoolName,
        'รายงานการมาเรียนรายเดือน (รายคน) · ' + ymLabel(d.year_month));
      doc.setFontSize(11);
      doc.text('ชั้น ' + d.grade + (d.room ? '/' + d.room : '') + ' · มีการเช็คชื่อ ' + d.school_days + ' วัน', 14, y + 4);

      const body = d.rows.map(function (s, i) {
        return [i + 1, s.name, s.present, s.late, s.leave, s.absent, s.days_checked,
          s.records ? Utils.fmtNumber(s.rate, 1) + '%' : '-'];
      });
      const t = d.totals;
      body.push(['', 'รวม ' + t.student_count + ' คน', t.present, t.late, t.leave, t.absent, '-',
        t.records ? Utils.fmtNumber(t.rate, 1) + '%' : '-']);

      doc.autoTable({
        startY: y + 10,
        head: [['#', 'ชื่อ', 'มา', 'สาย', 'ลา', 'ขาด', 'วันบันทึก', 'อัตรา']],
        body: body,
        styles: { font: 'Sarabun', fontSize: 10, halign: 'center' },
        headStyles: { font: 'Sarabun', fontStyle: 'bold', fillColor: [79, 195, 247] },
        columnStyles: { 1: { halign: 'left' } },
        didParseCell: function (data) {
          if (data.section === 'body' && data.row.index === body.length - 1) {
            data.cell.styles.fontStyle = 'bold'; data.cell.styles.fillColor = [235, 245, 251];
          }
        },
      });
      doc.save('attendance_month_student_' + d.grade + (d.room ? '-' + d.room : '') + '_' + d.year_month + '.pdf');
    } catch (e) { Toast.show('สร้าง PDF ไม่สำเร็จ: ' + e.message, 'danger'); }
    finally { Loading.hide(); }
  };

  /* ════ เริ่มต้น ════ */
  (async function () {
    try { schoolName = await AppSettings.schoolName(); } catch (e) { /* default */ }
    try {
      const d = await api('attendance.report_months', {}, { silent: true, loading: false });
      const sel = document.getElementById('r-month');
      sel.innerHTML = (d.months || []).map(function (ym) {
        return '<option value="' + Utils.esc(ym) + '">' + Utils.esc(ymLabel(ym)) + '</option>';
      }).join('');
    } catch (e) { /* ปล่อยว่าง */ }
    loadClass();
  })();

})();
