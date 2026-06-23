/**
 * Module — ทุนการศึกษา (ไม่ใช้ PIN)
 * บันทึกการรับทุน (เลือกชั้น→นักเรียน) · สรุปรายปี/รายชั้น · ประวัติ
 */
(function () {

  let currentYear = '';
  let selStu = null;   // นักเรียนที่เลือกในแท็บบันทึก
  let classCache = null;

  /* ── ตัวเลือกปี ── */
  async function buildYears() {
    try {
      const d = await api('scholarship.years', {}, { silent: true, loading: false });
      const years = (d.years && d.years.length) ? d.years : [d.current || String(new Date().getFullYear() + 543)];
      const sel = document.getElementById('year-select');
      sel.innerHTML = years.map(function (y) {
        return '<option value="' + Utils.esc(y) + '"' + (String(y) === String(d.current) ? ' selected' : '') + '>' + Utils.esc(y) + (String(y) === String(d.current) ? ' (ปัจจุบัน)' : '') + '</option>';
      }).join('');
      currentYear = sel.value;
      sel.addEventListener('change', function () {
        currentYear = sel.value;
        selStu = null;
        document.getElementById('rec-panel').classList.add('hidden');
        document.getElementById('rec-class').value = '';
        document.getElementById('rec-results').innerHTML = 'เลือกชั้นเพื่อแสดงรายชื่อนักเรียน';
        reloadActiveTab();
      });
    } catch (e) { /* ignore */ }
  }

  function reloadActiveTab() {
    const a = document.querySelector('.tab.active');
    const t = a ? a.dataset.tab : 'record';
    if (t === 'dashboard') loadDashboard();
  }

  /* ── Tabs ── */
  document.querySelectorAll('.tab').forEach(function (t) {
    t.addEventListener('click', function () {
      document.querySelectorAll('.tab').forEach(function (x) { x.classList.remove('active'); });
      t.classList.add('active');
      document.querySelectorAll('.tab-pane').forEach(function (p) { p.classList.add('hidden'); });
      document.getElementById('tab-' + t.dataset.tab).classList.remove('hidden');
      if (t.dataset.tab === 'record') ensureClasses('rec-class');
      else if (t.dataset.tab === 'dashboard') loadDashboard();
      else if (t.dataset.tab === 'history') ensureClasses('h-grade-src');
    });
  });

  async function ensureClasses(which) {
    if (!classCache) {
      try { classCache = (await api('scholarship.classes', {}, { silent: true, loading: false })).classes; }
      catch (e) { return; }
    }
    const sel = document.getElementById('rec-class');
    if (!sel.dataset.filled) {
      const opts = ['<option value="">— เลือกชั้น/ห้อง —</option>'];
      classCache.forEach(function (c) {
        opts.push('<option value="' + Utils.esc(c.grade + '|' + c.room) + '">' + Utils.esc(c.grade + (c.room ? '/' + c.room : '') + ' (' + c.count + ' คน)') + '</option>');
      });
      sel.innerHTML = opts.join('');
      sel.dataset.filled = '1';
    }
    fillGradeFilter();
  }

  function fillGradeFilter() {
    if (!classCache) return;
    const grades = [];
    classCache.forEach(function (c) { if (grades.indexOf(c.grade) < 0) grades.push(c.grade); });
    grades.sort(function (a, b) { return Utils.gradeSortKey(a) - Utils.gradeSortKey(b); });
    const sel = document.getElementById('h-grade');
    const cur = sel.value;
    sel.innerHTML = '<option value="">ทุกชั้น</option>' + Utils.options(grades, cur);
  }

  /* ════ บันทึก ════ */
  document.getElementById('rec-class').addEventListener('change', async function () {
    const host = document.getElementById('rec-results');
    document.getElementById('rec-panel').classList.add('hidden');
    selStu = null;
    if (!this.value) { host.innerHTML = 'เลือกชั้นเพื่อแสดงรายชื่อนักเรียน'; host.className = 'text-muted'; return; }
    const parts = this.value.split('|');
    try {
      host.className = '';
      const d = await api('scholarship.by_class', { grade: parts[0], room: parts[1], year: currentYear }, { loadingMsg: 'กำลังโหลดรายชื่อ...' });
      if (!d.results.length) { host.innerHTML = '<div class="text-muted">ไม่มีนักเรียน</div>'; return; }
      const rows = d.results.map(function (r, i) {
        return '<tr data-i="' + i + '" style="cursor:pointer"><td>' + Utils.esc(r.name) + '</td>' +
          '<td>' + Utils.esc(r.grade) + '/' + Utils.esc(r.room) + '</td>' +
          '<td style="text-align:right;font-weight:700;color:var(--green-dark)">' + (r.total ? Utils.fmtMoney(r.total) : '-') + '</td>' +
          '<td style="text-align:center">' + (r.count || '') + '</td></tr>';
      }).join('');
      host.innerHTML = '<div class="table-wrap"><table><thead><tr><th>ชื่อ</th><th>ชั้น</th><th style="text-align:right">ทุนปีนี้</th><th style="text-align:center">จำนวน</th></tr></thead><tbody>' + rows + '</tbody></table></div>';
      host.querySelectorAll('tbody tr').forEach(function (tr) {
        tr.onclick = function () { pickStudent(d.results[parseInt(tr.dataset.i, 10)]); };
      });
    } catch (e) { host.innerHTML = '<div class="alert alert-danger">' + Utils.esc(e.message) + '</div>'; }
  });

  function pickStudent(r) {
    selStu = r;
    document.getElementById('rec-panel').classList.remove('hidden');
    document.getElementById('rec-student').innerHTML = '<strong>' + Utils.esc(r.name) + '</strong> · ชั้น ' + Utils.esc(r.grade) + '/' + Utils.esc(r.room);
    document.getElementById('rec-result').classList.add('hidden');
    document.getElementById('rec-name').value = '';
    document.getElementById('rec-amount').value = '';
    document.getElementById('rec-note').value = '';
    if (!document.getElementById('rec-date').value) document.getElementById('rec-date').value = Utils.todayYmd();
    loadStudentList();
    document.getElementById('rec-panel').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  async function loadStudentList() {
    if (!selStu) return;
    try {
      const d = await api('scholarship.student', { citizen_id: selStu.citizen_id, year: currentYear }, { silent: true, loading: false });
      document.getElementById('rec-yeartotal').textContent = Utils.fmtMoney(d.total);
      const host = document.getElementById('rec-list');
      if (!d.records.length) { host.innerHTML = '<div class="text-muted">ยังไม่มีรายการในปีนี้</div>'; return; }
      const rows = d.records.map(function (r) {
        return '<tr><td>' + Utils.fmtDateThai(r.date) + '</td><td>' + Utils.esc(r.name) + '</td>' +
          '<td style="text-align:right;font-weight:700">' + Utils.fmtMoney(r.amount) + '</td>' +
          '<td style="text-align:center"><button class="btn btn-danger sch-del" data-id="' + Utils.esc(r.scholarship_id) + '" style="padding:3px 10px;font-size:13px"><i class="bi bi-trash"></i></button></td></tr>';
      }).join('');
      host.innerHTML = '<div class="table-wrap"><table><thead><tr><th>วันที่</th><th>ชื่อทุน</th><th style="text-align:right">จำนวน</th><th></th></tr></thead><tbody>' + rows + '</tbody></table></div>';
      host.querySelectorAll('.sch-del').forEach(function (b) {
        b.onclick = function () { delScholarship(b.dataset.id); };
      });
    } catch (e) { /* ignore */ }
  }

  document.getElementById('rec-save').onclick = async function () {
    if (!selStu) { Toast.show('กรุณาเลือกนักเรียนก่อน', 'warning'); return; }
    const name = document.getElementById('rec-name').value.trim();
    const amount = parseFloat(document.getElementById('rec-amount').value);
    if (!name) { Toast.show('กรุณากรอกชื่อทุน', 'warning'); return; }
    if (!(amount > 0)) { Toast.show('จำนวนเงินต้องมากกว่า 0', 'warning'); return; }
    try {
      const r = await api('scholarship.record', {
        citizen_id: selStu.citizen_id, name: name, amount: amount,
        date: document.getElementById('rec-date').value || undefined,
        year: currentYear, note: document.getElementById('rec-note').value.trim(),
        recorded_by: document.getElementById('rec-by').value.trim() || 'admin',
      }, { loadingMsg: 'กำลังบันทึก...' });
      const res = document.getElementById('rec-result');
      res.className = 'alert alert-success mt-2';
      res.textContent = '✅ บันทึกทุน "' + r.name + '" ' + Utils.fmtMoney(r.amount) + ' วันที่ ' + Utils.fmtDateThai(r.date) + ' สำเร็จ';
      res.classList.remove('hidden');
      document.getElementById('rec-name').value = '';
      document.getElementById('rec-amount').value = '';
      document.getElementById('rec-note').value = '';
      Toast.show('บันทึกทุนสำเร็จ', 'success');
      loadStudentList();
    } catch (e) { /* Toast แสดงแล้ว */ }
  };

  async function delScholarship(id) {
    if (!confirm('ลบรายการทุนนี้?')) return;
    try {
      await api('scholarship.delete', { scholarship_id: id, recorded_by: 'admin' }, { loadingMsg: 'กำลังลบ...' });
      Toast.show('ลบรายการแล้ว', 'success');
      loadStudentList();
    } catch (e) { /* Toast */ }
  }

  /* ════ ภาพรวม ════ */
  async function loadDashboard() {
    try {
      const d = await api('scholarship.dashboard', { year: currentYear }, { loadingMsg: 'กำลังโหลดสรุป...' });
      document.getElementById('year-note').textContent = 'สรุปปีการศึกษา ' + d.year;
      document.getElementById('d-total').textContent = Utils.fmtMoney(d.total_amount);
      document.getElementById('d-count').textContent = Utils.fmtInt(d.record_count);
      document.getElementById('d-students').textContent = Utils.fmtInt(d.student_count);

      const byGrade = d.by_grade.slice().sort(function (a, b) { return Utils.gradeSortKey(a.grade) - Utils.gradeSortKey(b.grade); });
      if (!byGrade.length) {
        document.getElementById('d-bygrade').innerHTML = '<div class="text-muted">ยังไม่มีข้อมูลในปีนี้</div>';
      } else {
        const rows = byGrade.map(function (g) {
          return '<tr><td>' + Utils.esc(g.grade) + '</td>' +
            '<td style="text-align:right;font-weight:700;color:var(--green-dark)">' + Utils.fmtMoney(g.total) + '</td>' +
            '<td style="text-align:center">' + g.count + '</td><td style="text-align:center">' + g.students + '</td></tr>';
        }).join('');
        document.getElementById('d-bygrade').innerHTML =
          '<div class="table-wrap"><table><thead><tr><th>ชั้น</th><th style="text-align:right">เงินทุนรวม</th><th style="text-align:center">จำนวนทุน</th><th style="text-align:center">นักเรียน</th></tr></thead><tbody>' + rows + '</tbody></table></div>';
      }

      if (!d.top.length) {
        document.getElementById('d-top').innerHTML = '<div class="text-muted">ยังไม่มีข้อมูล</div>';
      } else {
        const rows = d.top.map(function (e, i) {
          return '<tr><td>' + (i + 1) + '</td><td>' + Utils.esc(e.name) + '</td><td>' + Utils.esc(e.grade) + '/' + Utils.esc(e.room) + '</td>' +
            '<td style="text-align:right;font-weight:700;color:var(--green-dark)">' + Utils.fmtMoney(e.total) + '</td><td style="text-align:center">' + e.count + '</td></tr>';
        }).join('');
        document.getElementById('d-top').innerHTML =
          '<div class="table-wrap"><table><thead><tr><th>#</th><th>ชื่อ</th><th>ชั้น</th><th style="text-align:right">รวม</th><th style="text-align:center">ทุน</th></tr></thead><tbody>' + rows + '</tbody></table></div>';
      }
    } catch (e) { /* Toast แสดงแล้ว */ }
  }

  /* ════ ประวัติ ════ */
  document.getElementById('h-go').onclick = async function () {
    const host = document.getElementById('h-result');
    try {
      const d = await api('scholarship.history', {
        year: currentYear, grade: document.getElementById('h-grade').value || undefined, limit: 500,
      }, { loadingMsg: 'กำลังค้นหา...' });
      const q = document.getElementById('h-search').value.trim().toLowerCase();
      let list = d.records;
      if (q) list = list.filter(function (r) { return (r.student_name + ' ' + r.name).toLowerCase().indexOf(q) >= 0; });
      if (!list.length) { host.innerHTML = '<div class="text-muted">ไม่พบรายการ</div>'; return; }
      const rows = list.map(function (r) {
        return '<tr><td>' + Utils.fmtDateThai(r.date) + '</td><td>' + Utils.esc(r.student_name) + '</td>' +
          '<td>' + Utils.esc(r.grade) + '/' + Utils.esc(r.room) + '</td><td>' + Utils.esc(r.name) + '</td>' +
          '<td style="text-align:right;font-weight:700">' + Utils.fmtMoney(r.amount) + '</td></tr>';
      }).join('');
      host.innerHTML = '<div class="text-muted mt-2" style="margin-bottom:6px">พบ ' + list.length + ' รายการ</div>' +
        '<div class="table-wrap"><table><thead><tr><th>วันที่</th><th>ชื่อ</th><th>ชั้น</th><th>ชื่อทุน</th><th style="text-align:right">จำนวน</th></tr></thead><tbody>' + rows + '</tbody></table></div>';
    } catch (e) { host.innerHTML = '<div class="alert alert-danger">' + Utils.esc(e.message) + '</div>'; }
  };

  /* ════ เริ่มต้น ════ */
  document.getElementById('rec-date').value = Utils.todayYmd();
  (async function () {
    await buildYears();
    ensureClasses('rec-class');
  })();

})();
