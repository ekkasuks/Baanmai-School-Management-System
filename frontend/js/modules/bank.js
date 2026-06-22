/**
 * Module 2 — ธนาคารโรงเรียน (PIN: bank)
 * Dashboard · ฝาก/ถอน · ประวัติ · สมุดบัญชี + Export PDF
 */
(function () {

  let schoolName = 'โรงเรียนบ้านใหม่';
  let chart = null;
  let selTxn = null;   // นักเรียนที่เลือกในแท็บฝาก/ถอน
  let selPb = null;    // ข้อมูลสมุดบัญชีที่กำลังเปิด

  /* ── เรียก API ของ bank พร้อม retry เมื่อ PIN หมดอายุ ── */
  async function bankApi(action, params, opts) {
    try {
      return await api(action, params, opts);
    } catch (e) {
      if (e.code === 'TOKEN_EXPIRED') {
        Auth.clear('bank');
        await Auth.requirePin('bank');
        return await api(action, params, opts);
      }
      throw e;
    }
  }

  /* ── Tabs ── */
  document.querySelectorAll('.tab').forEach(function (t) {
    t.addEventListener('click', function () {
      document.querySelectorAll('.tab').forEach(function (x) { x.classList.remove('active'); });
      t.classList.add('active');
      document.querySelectorAll('.tab-pane').forEach(function (p) { p.classList.add('hidden'); });
      document.getElementById('tab-' + t.dataset.tab).classList.remove('hidden');
      if (t.dataset.tab === 'dashboard') loadDashboard();
      else if (t.dataset.tab === 'txn') loadTxnClasses();
    });
  });

  /* ── เติม dropdown ชั้น/ห้อง ── */
  function fillClassSelect(sel, classes) {
    const opts = ['<option value="">— เลือกชั้น/ห้อง —</option>'];
    classes.forEach(function (c) {
      const label = c.grade + (c.room ? '/' + c.room : '') + ' (' + c.count + ' คน)';
      opts.push('<option value="' + Utils.esc(c.grade + '|' + c.room) + '">' + Utils.esc(label) + '</option>');
    });
    sel.innerHTML = opts.join('');
  }

  /* ── render รายการผลค้นหานักเรียน ── */
  function renderResults(host, results, onPick) {
    if (!results.length) { host.innerHTML = '<div class="text-muted">ไม่พบนักเรียน</div>'; return; }
    const rows = results.map(function (r, i) {
      return '<tr data-i="' + i + '" style="cursor:pointer">' +
        '<td>' + Utils.esc(r.name) + '</td>' +
        '<td>' + Utils.esc(r.grade) + '/' + Utils.esc(r.room) + '</td>' +
        '<td style="text-align:right;color:var(--green-dark);font-weight:700">' + Utils.fmtMoney(r.balance) + '</td>' +
        '</tr>';
    }).join('');
    host.innerHTML = '<div class="table-wrap"><table><thead><tr><th>ชื่อ</th><th>ชั้น</th><th style="text-align:right">คงเหลือ</th></tr></thead><tbody>' + rows + '</tbody></table></div>';
    host.querySelectorAll('tbody tr').forEach(function (tr) {
      tr.onclick = function () { onPick(results[parseInt(tr.dataset.i, 10)]); };
    });
  }

  /* ════ Dashboard ════ */
  async function loadDashboard() {
    try {
      const d = await bankApi('bank.dashboard', {}, { loadingMsg: 'กำลังโหลดภาพรวม...' });
      document.getElementById('d-total').textContent = Utils.fmtMoney(d.total_balance);
      document.getElementById('d-dep').textContent = Utils.fmtMoney(d.today_deposit) + ' (' + d.today_deposit_count + ')';
      document.getElementById('d-wd').textContent = Utils.fmtMoney(d.today_withdraw) + ' (' + d.today_withdraw_count + ')';
      document.getElementById('d-acc').textContent = Utils.fmtInt(d.account_count);

      // Top 10
      if (!d.top10.length) {
        document.getElementById('d-top10').innerHTML = '<div class="text-muted">ยังไม่มีข้อมูล</div>';
      } else {
        const rows = d.top10.map(function (r, i) {
          return '<tr><td>' + (i + 1) + '</td><td>' + Utils.esc(r.name) + '</td><td>' +
            Utils.esc(r.grade) + '/' + Utils.esc(r.room) + '</td>' +
            '<td style="text-align:right;font-weight:700;color:var(--green-dark)">' + Utils.fmtMoney(r.balance) + '</td></tr>';
        }).join('');
        document.getElementById('d-top10').innerHTML =
          '<div class="table-wrap"><table><thead><tr><th>#</th><th>ชื่อ</th><th>ชั้น</th><th style="text-align:right">ยอดเงิน</th></tr></thead><tbody>' + rows + '</tbody></table></div>';
      }

      // กราฟค่าเฉลี่ยรายชั้น
      const byGrade = d.by_grade.slice().sort(function (a, b) {
        return Utils.gradeSortKey(a.grade) - Utils.gradeSortKey(b.grade);
      });
      drawChart(byGrade.map(function (g) { return g.grade; }), byGrade.map(function (g) { return g.avg; }));
    } catch (e) { /* Toast แสดงแล้ว */ }
  }

  function drawChart(labels, data) {
    const ctx = document.getElementById('d-chart').getContext('2d');
    if (chart) chart.destroy();
    chart = new Chart(ctx, {
      type: 'bar',
      data: { labels: labels, datasets: [{ label: 'ค่าเฉลี่ย (บาท)', data: data, backgroundColor: '#4FC3F7', borderRadius: 8 }] },
      options: {
        plugins: { legend: { display: false } },
        scales: { y: { beginAtZero: true, ticks: { font: { family: 'Sarabun' } } }, x: { ticks: { font: { family: 'Sarabun' } } } },
      },
    });
  }

  /* ════ ฝาก/ถอน ════ */
  let txnClassesLoaded = false;
  async function loadTxnClasses() {
    if (txnClassesLoaded) return;
    try {
      const d = await bankApi('bank.classes', {}, { silent: true, loading: false });
      fillClassSelect(document.getElementById('txn-class'), d.classes);
      txnClassesLoaded = true;
    } catch (e) { /* Toast แสดงแล้ว */ }
  }

  document.getElementById('txn-class').addEventListener('change', async function () {
    const host = document.getElementById('txn-results');
    document.getElementById('txn-panel').classList.add('hidden');
    selTxn = null;
    if (!this.value) { host.innerHTML = 'เลือกชั้นเพื่อแสดงรายชื่อนักเรียน'; host.className = 'text-muted'; return; }
    const parts = this.value.split('|');
    try {
      host.className = '';
      const d = await bankApi('bank.by_class', { grade: parts[0], room: parts[1] }, { loadingMsg: 'กำลังโหลดรายชื่อ...' });
      renderResults(host, d.results, pickTxnStudent);
    } catch (e) { host.innerHTML = '<div class="alert alert-danger">' + Utils.esc(e.message) + '</div>'; }
  });

  function pickTxnStudent(r) {
    selTxn = r;
    document.getElementById('txn-panel').classList.remove('hidden');
    document.getElementById('txn-student').innerHTML =
      '<strong>' + Utils.esc(r.name) + '</strong> · ชั้น ' + Utils.esc(r.grade) + '/' + Utils.esc(r.room) +
      ' · รหัส ' + Utils.esc(r.student_code);
    document.getElementById('txn-balance').textContent = Utils.fmtMoney(r.balance);
    document.getElementById('txn-result').classList.add('hidden');
    document.getElementById('txn-amount').value = '';
    document.getElementById('txn-note').value = '';
    document.getElementById('txn-panel').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  async function doTxn(type) {
    if (!selTxn) { Toast.show('กรุณาเลือกนักเรียนก่อน', 'warning'); return; }
    const amount = parseFloat(document.getElementById('txn-amount').value);
    const by = document.getElementById('txn-by').value.trim();
    const note = document.getElementById('txn-note').value.trim();
    if (!(amount > 0)) { Toast.show('กรุณากรอกจำนวนเงินมากกว่า 0', 'warning'); return; }

    try {
      const r = await bankApi('bank.' + type, {
        citizen_id: selTxn.citizen_id, amount: amount, note: note, recorded_by: by || 'admin',
      }, { loadingMsg: 'กำลังบันทึก...' });

      selTxn.balance = r.balance_after;
      document.getElementById('txn-balance').textContent = Utils.fmtMoney(r.balance_after);
      const res = document.getElementById('txn-result');
      res.className = 'alert alert-success mt-2';
      res.innerHTML = (type === 'deposit' ? '✅ ฝากเงิน ' : '✅ ถอนเงิน ') + Utils.fmtMoney(amount) +
        ' สำเร็จ — ยอดคงเหลือ <strong>' + Utils.fmtMoney(r.balance_after) + '</strong> ' +
        '<button class="btn btn-secondary" style="padding:4px 12px;font-size:14px;margin-left:8px" id="slip-btn"><i class="bi bi-printer"></i> พิมพ์สลิป</button>';
      res.classList.remove('hidden');
      document.getElementById('slip-btn').onclick = function () { printSlip(type, amount, r); };
      Toast.show('บันทึกรายการสำเร็จ', 'success');
    } catch (e) { /* Toast แสดงแล้ว */ }
  }
  document.getElementById('btn-deposit').onclick = function () { doTxn('deposit'); };
  document.getElementById('btn-withdraw').onclick = function () { doTxn('withdraw'); };

  /* ════ ประวัติ ════ */
  document.getElementById('h-go').onclick = async function () {
    const host = document.getElementById('h-result');
    try {
      const d = await bankApi('bank.history', {
        search: undefined,
        type: document.getElementById('h-type').value || undefined,
        date_from: document.getElementById('h-from').value || undefined,
        date_to: document.getElementById('h-to').value || undefined,
        limit: 300,
      }, { loadingMsg: 'กำลังค้นหา...' });

      // กรองด้วยคำค้น (ชื่อ/รหัส) ฝั่ง client
      const q = document.getElementById('h-search').value.trim().toLowerCase();
      let list = d.transactions;
      if (q) list = list.filter(function (t) { return (t.name + ' ' + t.citizen_id).toLowerCase().indexOf(q) >= 0; });

      if (!list.length) { host.innerHTML = '<div class="text-muted">ไม่พบรายการ</div>'; return; }
      const rows = list.map(function (t) {
        const isDep = t.type === 'deposit';
        return '<tr><td>' + Utils.fmtDateThai(t.date) + '</td><td>' + Utils.esc(t.name) + '</td>' +
          '<td><span class="badge ' + (isDep ? 'badge-pass' : 'badge-fail') + '">' + (isDep ? 'ฝาก' : 'ถอน') + '</span></td>' +
          '<td style="text-align:right">' + Utils.fmtMoney(t.amount) + '</td>' +
          '<td style="text-align:right">' + Utils.fmtMoney(t.balance_after) + '</td>' +
          '<td>' + Utils.esc(t.recorded_by) + '</td></tr>';
      }).join('');
      host.innerHTML = '<div class="text-muted mt-2" style="margin-bottom:6px">พบ ' + list.length + ' รายการ</div>' +
        '<div class="table-wrap"><table><thead><tr><th>วันที่</th><th>ชื่อ</th><th>ประเภท</th><th style="text-align:right">จำนวน</th><th style="text-align:right">คงเหลือ</th><th>ผู้บันทึก</th></tr></thead><tbody>' + rows + '</tbody></table></div>';
    } catch (e) { host.innerHTML = '<div class="alert alert-danger">' + Utils.esc(e.message) + '</div>'; }
  };

  /* ════ สมุดบัญชี ════ */
  const pbSearch = document.getElementById('pb-search');
  pbSearch.addEventListener('input', Utils.debounce(async function () {
    const q = pbSearch.value.trim();
    const host = document.getElementById('pb-results');
    if (q.length < 1) { host.innerHTML = ''; return; }
    try {
      const d = await bankApi('bank.search', { q: q }, { silent: true, loading: false });
      renderResults(host, d.results, openPassbook);
    } catch (e) { host.innerHTML = '<div class="alert alert-danger">' + Utils.esc(e.message) + '</div>'; }
  }, 350));

  async function openPassbook(r) {
    try {
      const d = await bankApi('bank.passbook', { citizen_id: r.citizen_id }, { loadingMsg: 'กำลังเปิดสมุดบัญชี...' });
      selPb = d;
      document.getElementById('pb-panel').classList.remove('hidden');
      document.getElementById('pb-name').textContent =
        '📒 ' + d.student.name + ' (ชั้น ' + d.student.grade + '/' + d.student.room + ')';
      document.getElementById('pb-balance').textContent = Utils.fmtMoney(d.balance);
      if (!d.transactions.length) {
        document.getElementById('pb-table').innerHTML = '<div class="text-muted">ยังไม่มีรายการ</div>';
      } else {
        const rows = d.transactions.map(function (t) {
          const isDep = t.type === 'deposit';
          return '<tr><td>' + Utils.fmtDateThai(t.date) + '</td>' +
            '<td>' + (isDep ? 'ฝาก' : 'ถอน') + '</td>' +
            '<td style="text-align:right;color:var(--green-dark)">' + (isDep ? Utils.fmtMoney(t.amount) : '-') + '</td>' +
            '<td style="text-align:right;color:var(--red)">' + (!isDep ? Utils.fmtMoney(t.amount) : '-') + '</td>' +
            '<td style="text-align:right;font-weight:700">' + Utils.fmtMoney(t.balance_after) + '</td></tr>';
        }).join('');
        document.getElementById('pb-table').innerHTML =
          '<div class="table-wrap"><table><thead><tr><th>วันที่</th><th>รายการ</th><th style="text-align:right">ฝาก</th><th style="text-align:right">ถอน</th><th style="text-align:right">คงเหลือ</th></tr></thead><tbody>' + rows + '</tbody></table></div>';
      }
      document.getElementById('pb-panel').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    } catch (e) { /* Toast */ }
  }

  document.getElementById('pb-pdf').onclick = async function () {
    if (!selPb) return;
    try {
      Loading.show('กำลังสร้าง PDF...');
      const doc = await PDF.newDoc('p');
      let y = PDF.header(doc, schoolName, 'สมุดบัญชีเงินฝาก ธนาคารโรงเรียน');
      doc.setFontSize(12);
      doc.text('ชื่อ: ' + selPb.student.name, 14, y + 4);
      doc.text('ชั้น: ' + selPb.student.grade + '/' + selPb.student.room, 14, y + 11);
      doc.text('รหัสนักเรียน: ' + selPb.student.student_code, 14, y + 18);
      doc.setFont('Sarabun', 'bold');
      doc.text('ยอดคงเหลือ: ' + Utils.fmtMoney(selPb.balance), 140, y + 4);
      doc.setFont('Sarabun', 'normal');

      const body = selPb.transactions.map(function (t) {
        const isDep = t.type === 'deposit';
        return [Utils.fmtDateThai(t.date), isDep ? 'ฝาก' : 'ถอน',
          isDep ? Utils.fmtNumber(t.amount) : '', !isDep ? Utils.fmtNumber(t.amount) : '',
          Utils.fmtNumber(t.balance_after)];
      });
      doc.autoTable({
        startY: y + 24,
        head: [['วันที่', 'รายการ', 'ฝาก', 'ถอน', 'คงเหลือ']],
        body: body.length ? body : [['-', '-', '-', '-', '-']],
        styles: { font: 'Sarabun', fontSize: 11, halign: 'right' },
        headStyles: { font: 'Sarabun', fontStyle: 'bold', fillColor: [79, 195, 247], halign: 'center' },
        columnStyles: { 0: { halign: 'left' }, 1: { halign: 'center' } },
      });
      doc.save('passbook_' + selPb.student.student_code + '.pdf');
    } catch (e) {
      Toast.show('สร้าง PDF ไม่สำเร็จ: ' + e.message, 'danger');
    } finally { Loading.hide(); }
  };

  /* ── สลิปฝาก/ถอน ── */
  async function printSlip(type, amount, r) {
    try {
      Loading.show('กำลังสร้างสลิป...');
      const doc = await PDF.newDoc('p');
      const w = doc.internal.pageSize.getWidth();
      let y = PDF.header(doc, schoolName, 'สลิป' + (type === 'deposit' ? 'ฝากเงิน' : 'ถอนเงิน'));
      doc.setFontSize(12);
      const lines = [
        ['วันที่', Utils.fmtDateThai(r.date)],
        ['ชื่อ', r.student.name],
        ['ชั้น', r.student.grade + '/' + r.student.room],
        ['ประเภท', type === 'deposit' ? 'ฝากเงิน' : 'ถอนเงิน'],
        ['จำนวนเงิน', Utils.fmtMoney(amount)],
        ['ยอดคงเหลือ', Utils.fmtMoney(r.balance_after)],
        ['เลขที่รายการ', r.txn_id],
      ];
      y += 6;
      lines.forEach(function (l) {
        doc.setFont('Sarabun', 'normal'); doc.text(l[0], 20, y);
        doc.setFont('Sarabun', 'bold'); doc.text(String(l[1]), 80, y);
        y += 9;
      });
      doc.setFont('Sarabun', 'normal'); doc.setFontSize(11);
      doc.text('ผู้บันทึก: ' + (r.recorded_by || 'admin'), 20, y + 6);
      doc.save('slip_' + r.txn_id + '.pdf');
    } catch (e) { Toast.show('สร้างสลิปไม่สำเร็จ: ' + e.message, 'danger'); }
    finally { Loading.hide(); }
  }

  /* ════ เริ่มต้น — ต้องผ่าน PIN ก่อน ════ */
  Auth.requirePin('bank').then(async function () {
    try {
      const cfg = await api('settings.get', {}, { silent: true, loading: false });
      if (cfg.settings && cfg.settings.school_name) schoolName = cfg.settings.school_name;
    } catch (e) { /* ใช้ค่า default */ }
    loadDashboard();
  }).catch(function () {
    document.querySelector('.container').innerHTML =
      '<div class="card"><div class="alert alert-warning">ต้องกรอก PIN เพื่อเข้าใช้ธนาคารโรงเรียน</div>' +
      '<a class="btn btn-primary" href="index.html">‹ กลับหน้าหลัก</a> ' +
      '<button class="btn btn-secondary" onclick="location.reload()">ลองอีกครั้ง</button></div>';
  });

})();
