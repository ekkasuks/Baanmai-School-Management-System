/**
 * Module — การเจริญเติบโต (ไม่ใช้ PIN)
 * บันทึกน้ำหนัก/ส่วนสูงรายชั้น → คำนวณ BMI · ภาพรวม · รายชั้น · รายบุคคล (กราฟแนวโน้ม)
 */
(function () {

  let distChart = null;
  let psChart = null;

  /* ── BMI + WHO BMI-for-age helpers (mirror backend Growth.gs) ── */
  function bmiOf(w, h) {
    w = Number(w); h = Number(h) / 100;
    if (!(w > 0) || !(h > 0)) return 0;
    return Math.round((w / (h * h)) * 10) / 10;
  }
  function ageMonthsAt(birthDate, atYmd) {
    const m = String(birthDate || '').match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/);
    if (!m) return null;
    const by = parseInt(m[3], 10) - 543, bm = parseInt(m[2], 10), bd = parseInt(m[1], 10);
    const p = String(atYmd).split('-');
    const ay = parseInt(p[0], 10), am = parseInt(p[1], 10), ad = parseInt(p[2], 10);
    if (!by || !ay) return null;
    let months = (ay - by) * 12 + (am - bm);
    if (ad < bd) months -= 1;
    return months >= 0 ? months : null;
  }
  function sexCode(g) { return g === 'ช' ? '1' : g === 'ญ' ? '2' : null; }
  function whoZ(bmi, sex, ageM) {
    const T = window.WHO_BMI_LMS;
    if (!(bmi > 0) || !sex || ageM == null || !T || !T[sex]) return null;
    let mo = ageM; if (mo < 24) mo = 24; if (mo > 228) mo = 228;
    const lms = T[sex][String(mo)];
    if (!lms) return null;
    const L = lms[0], M = lms[1], S = lms[2];
    const z = (Math.abs(L) < 1e-9) ? Math.log(bmi / M) / S : (Math.pow(bmi / M, L) - 1) / (L * S);
    return Math.round(z * 100) / 100;
  }
  function whoLabel(z, ageM) {
    if (z == null) return '';
    if (z < -3) return 'ผอมมาก';
    if (z < -2) return 'ผอม';
    if (ageM != null && ageM < 60) { if (z <= 2) return 'สมส่วน'; if (z <= 3) return 'น้ำหนักเกิน'; return 'อ้วน'; }
    if (z <= 1) return 'สมส่วน'; if (z <= 2) return 'น้ำหนักเกิน'; return 'อ้วน';
  }
  const LABEL_STYLE = {
    'ผอมมาก': { color: '#B71C1C', bg: '#FFEBEE' },
    'ผอม': { color: '#EF6C00', bg: '#FFF3E0' },
    'สมส่วน': { color: '#2E7D32', bg: '#E8F5E9' },
    'น้ำหนักเกิน': { color: '#F9A825', bg: '#FFF8E1' },
    'อ้วน': { color: '#C62828', bg: '#FFEBEE' },
  };
  const DIST_ORDER = ['ผอมมาก', 'ผอม', 'สมส่วน', 'น้ำหนักเกิน', 'อ้วน'];
  function pill(label) {
    if (!label) return '<span class="text-muted">-</span>';
    const st = LABEL_STYLE[label] || { color: '#333', bg: '#eee' };
    return '<span class="bmi-pill" style="background:' + st.bg + ';color:' + st.color + '">' + Utils.esc(label) + '</span>';
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
      else if (t.dataset.tab === 'byclass') ensureClasses('bc-class');
      else if (t.dataset.tab === 'person') ensureClasses('ps-class');
    });
  });

  /* ── เติม dropdown ชั้น (โหลดครั้งเดียว ใช้ร่วมกัน) ── */
  let classCache = null;
  async function ensureClasses(selId) {
    const sel = document.getElementById(selId);
    if (sel.dataset.filled) return;
    if (!classCache) {
      try { classCache = (await api('growth.classes', {}, { silent: true, loading: false })).classes; }
      catch (e) { return; }
    }
    const opts = ['<option value="">— เลือกชั้น/ห้อง —</option>'];
    classCache.forEach(function (c) {
      const label = c.grade + (c.room ? '/' + c.room : '') + ' (' + c.count + ' คน)';
      opts.push('<option value="' + Utils.esc(c.grade + '|' + c.room) + '">' + Utils.esc(label) + '</option>');
    });
    sel.innerHTML = opts.join('');
    sel.dataset.filled = '1';
  }

  function getRecDate() { return document.getElementById('rec-date').value || Utils.todayYmd(); }

  /* ════ บันทึก ════ */
  async function loadRecStudents() {
    const cls = document.getElementById('rec-class').value;
    const host = document.getElementById('rec-table');
    const actions = document.getElementById('rec-actions');
    document.getElementById('rec-result').classList.add('hidden');
    if (!cls) { host.innerHTML = 'เลือกชั้นเพื่อแสดงรายชื่อนักเรียน'; host.className = 'text-muted'; actions.classList.add('hidden'); return; }
    const parts = cls.split('|');
    try {
      host.className = '';
      const d = await api('growth.by_class', { grade: parts[0], room: parts[1], date: getRecDate() }, { loadingMsg: 'กำลังโหลดรายชื่อ...' });
      renderRecTable(d.results);
      actions.classList.remove('hidden');
    } catch (e) { host.innerHTML = '<div class="alert alert-danger">' + Utils.esc(e.message) + '</div>'; }
  }

  function renderRecTable(students) {
    const host = document.getElementById('rec-table');
    if (!students.length) { host.innerHTML = '<div class="text-muted">ไม่มีนักเรียนในชั้นนี้</div>'; return; }
    const body = students.map(function (s) {
      const w = s.on_date ? s.on_date.weight : '';
      const h = s.on_date ? s.on_date.height : '';
      const hint = s.latest ? ('ล่าสุด ' + Utils.fmtDateThai(s.latest.date) + ': ' + s.latest.weight + ' กก. / ' + s.latest.height + ' ซม. (BMI ' + s.latest.bmi + ')') : 'ยังไม่เคยวัด';
      return '<tr data-cid="' + Utils.esc(s.citizen_id) + '" data-sex="' + Utils.esc(s.gender || '') + '" data-birth="' + Utils.esc(s.birth_date || '') + '">' +
        '<td>' + Utils.esc(s.name) + '<br><span class="text-muted" style="font-size:12px">' + Utils.esc(hint) + '</span></td>' +
        '<td><input class="gr-input gr-w" type="number" min="0" step="0.1" inputmode="decimal" value="' + (w || '') + '" placeholder="กก."></td>' +
        '<td><input class="gr-input gr-h" type="number" min="0" step="0.1" inputmode="decimal" value="' + (h || '') + '" placeholder="ซม."></td>' +
        '<td style="text-align:center" class="gr-bmi">-</td>' +
        '<td style="text-align:center" class="gr-label">-</td></tr>';
    }).join('');
    host.innerHTML = '<div class="table-wrap"><table class="gr-table"><thead><tr><th>ชื่อ</th><th>น้ำหนัก</th><th>ส่วนสูง</th><th style="text-align:center">BMI</th><th style="text-align:center">แปลผล</th></tr></thead><tbody>' + body + '</tbody></table></div>';

    host.querySelectorAll('tbody tr').forEach(function (tr) {
      const calc = function () {
        const bmi = bmiOf(tr.querySelector('.gr-w').value, tr.querySelector('.gr-h').value);
        const ageM = ageMonthsAt(tr.dataset.birth, getRecDate());
        const z = whoZ(bmi, sexCode(tr.dataset.sex), ageM);
        const label = whoLabel(z, ageM);
        tr.querySelector('.gr-bmi').textContent = bmi > 0 ? bmi + (z != null ? ' (z ' + (z > 0 ? '+' : '') + z + ')' : '') : '-';
        tr.querySelector('.gr-label').innerHTML = bmi > 0 ? (label ? pill(label) : '<span class="text-muted" style="font-size:12px">ไม่มีวันเกิด</span>') : '-';
      };
      tr.querySelector('.gr-w').addEventListener('input', calc);
      tr.querySelector('.gr-h').addEventListener('input', calc);
      calc();
    });
  }

  document.getElementById('rec-class').addEventListener('change', loadRecStudents);
  document.getElementById('rec-date').addEventListener('change', function () {
    if (document.getElementById('rec-class').value) loadRecStudents();
  });

  document.getElementById('rec-save').onclick = async function () {
    const rows = document.querySelectorAll('#rec-table tbody tr');
    if (!rows.length) return;
    const records = [];
    rows.forEach(function (tr) {
      const w = tr.querySelector('.gr-w').value, h = tr.querySelector('.gr-h').value;
      if (Number(w) > 0 && Number(h) > 0) records.push({ citizen_id: tr.dataset.cid, weight: w, height: h });
    });
    if (!records.length) { Toast.show('ยังไม่ได้กรอกน้ำหนัก/ส่วนสูง', 'warning'); return; }
    try {
      const r = await api('growth.save', { date: getRecDate(), records: records, recorded_by: document.getElementById('rec-by').value.trim() || 'admin' }, { loadingMsg: 'กำลังบันทึก...' });
      const res = document.getElementById('rec-result');
      res.className = 'alert alert-success mt-2';
      res.textContent = '✅ บันทึกวันที่ ' + Utils.fmtDateThai(r.date) + ' สำเร็จ — ใหม่ ' + r.inserted + ' คน, อัปเดต ' + r.updated + ' คน' + (r.skipped ? ', ข้าม ' + r.skipped : '');
      res.classList.remove('hidden');
      Toast.show('บันทึกข้อมูลสำเร็จ', 'success');
      loadRecStudents();
    } catch (e) { /* Toast แสดงแล้ว */ }
  };

  /* ════ ภาพรวม ════ */
  async function loadDashboard() {
    try {
      const d = await api('growth.dashboard', {}, { loadingMsg: 'กำลังโหลดภาพรวม...' });
      document.getElementById('d-measured').textContent = Utils.fmtInt(d.measured);
      document.getElementById('d-notmeasured').textContent = Utils.fmtInt(d.not_measured);
      document.getElementById('d-avg').textContent = d.avg_bmi || '-';
      document.getElementById('d-total').textContent = Utils.fmtInt(d.student_count);

      drawDist(d.distribution);

      const byGrade = d.by_grade.slice().sort(function (a, b) { return Utils.gradeSortKey(a.grade) - Utils.gradeSortKey(b.grade); });
      if (!byGrade.length) {
        document.getElementById('d-bygrade').innerHTML = '<div class="text-muted">ยังไม่มีข้อมูล</div>';
      } else {
        const rows = byGrade.map(function (g) {
          return '<tr><td>' + Utils.esc(g.grade) + '</td>' +
            '<td style="text-align:right;font-weight:700">' + (g.avg_bmi || '-') + '</td>' +
            '<td style="text-align:right">' + g.measured + '/' + g.total + '</td></tr>';
        }).join('');
        document.getElementById('d-bygrade').innerHTML =
          '<div class="table-wrap"><table><thead><tr><th>ชั้น</th><th style="text-align:right">BMI เฉลี่ย</th><th style="text-align:right">วัดแล้ว/ทั้งหมด</th></tr></thead><tbody>' + rows + '</tbody></table></div>';
      }
    } catch (e) { /* Toast แสดงแล้ว */ }
  }

  function drawDist(dist) {
    const ctx = document.getElementById('d-chart').getContext('2d');
    if (distChart) distChart.destroy();
    distChart = new Chart(ctx, {
      type: 'bar',
      data: {
        labels: DIST_ORDER,
        datasets: [{ label: 'จำนวน (คน)', data: DIST_ORDER.map(function (k) { return dist[k] || 0; }),
          backgroundColor: DIST_ORDER.map(function (k) { return LABEL_STYLE[k].color; }), borderRadius: 8 }],
      },
      options: { plugins: { legend: { display: false } },
        scales: { y: { beginAtZero: true, ticks: { font: { family: 'Sarabun' }, precision: 0 } }, x: { ticks: { font: { family: 'Sarabun' } } } } },
    });
  }

  /* ════ รายชั้น ════ */
  document.getElementById('bc-class').addEventListener('change', async function () {
    const host = document.getElementById('bc-table');
    if (!this.value) { host.innerHTML = 'เลือกชั้นเพื่อแสดงข้อมูล'; host.className = 'text-muted'; return; }
    const parts = this.value.split('|');
    try {
      host.className = '';
      const d = await api('growth.by_class', { grade: parts[0], room: parts[1] }, { loadingMsg: 'กำลังโหลด...' });
      const rows = d.results.map(function (s) {
        const l = s.latest;
        return '<tr><td>' + Utils.esc(s.name) + '</td>' +
          '<td style="text-align:center">' + (l ? Utils.fmtDateThai(l.date) : '-') + '</td>' +
          '<td style="text-align:right">' + (l ? l.weight : '-') + '</td>' +
          '<td style="text-align:right">' + (l ? l.height : '-') + '</td>' +
          '<td style="text-align:right;font-weight:700">' + (l && l.bmi ? l.bmi : '-') + '</td>' +
          '<td style="text-align:right">' + (l && l.zscore != null ? (l.zscore > 0 ? '+' : '') + l.zscore : '-') + '</td>' +
          '<td style="text-align:center">' + (l && l.bmi_label ? pill(l.bmi_label) : '-') + '</td></tr>';
      }).join('');
      host.innerHTML = '<div class="table-wrap"><table class="gr-table"><thead><tr><th>ชื่อ</th><th style="text-align:center">วัดล่าสุด</th><th style="text-align:right">น้ำหนัก</th><th style="text-align:right">ส่วนสูง</th><th style="text-align:right">BMI</th><th style="text-align:right">z-score</th><th style="text-align:center">แปลผล</th></tr></thead><tbody>' + rows + '</tbody></table></div>';
    } catch (e) { host.innerHTML = '<div class="alert alert-danger">' + Utils.esc(e.message) + '</div>'; }
  });

  /* ════ รายบุคคล ════ */
  document.getElementById('ps-class').addEventListener('change', async function () {
    const host = document.getElementById('ps-list');
    document.getElementById('ps-panel').classList.add('hidden');
    if (!this.value) { host.innerHTML = ''; return; }
    const parts = this.value.split('|');
    try {
      const d = await api('growth.by_class', { grade: parts[0], room: parts[1] }, { loadingMsg: 'กำลังโหลดรายชื่อ...' });
      if (!d.results.length) { host.innerHTML = '<div class="text-muted">ไม่มีนักเรียน</div>'; return; }
      const rows = d.results.map(function (s, i) {
        return '<tr data-i="' + i + '" style="cursor:pointer"><td>' + Utils.esc(s.name) + '</td>' +
          '<td style="text-align:right;font-weight:700">' + (s.latest && s.latest.bmi ? s.latest.bmi : '-') + '</td>' +
          '<td style="text-align:center">' + (s.latest && s.latest.bmi_label ? pill(s.latest.bmi_label) : '-') + '</td></tr>';
      }).join('');
      host.innerHTML = '<div class="table-wrap"><table><thead><tr><th>ชื่อ</th><th style="text-align:right">BMI ล่าสุด</th><th style="text-align:center">แปลผล</th></tr></thead><tbody>' + rows + '</tbody></table></div>';
      host.querySelectorAll('tbody tr').forEach(function (tr) {
        tr.onclick = function () { openPerson(d.results[parseInt(tr.dataset.i, 10)].citizen_id); };
      });
    } catch (e) { host.innerHTML = '<div class="alert alert-danger">' + Utils.esc(e.message) + '</div>'; }
  });

  async function openPerson(cid) {
    try {
      const d = await api('growth.student', { citizen_id: cid }, { loadingMsg: 'กำลังโหลดประวัติ...' });
      document.getElementById('ps-panel').classList.remove('hidden');
      document.getElementById('ps-name').textContent = '🧒 ' + d.student.name + ' (ชั้น ' + d.student.grade + '/' + d.student.room + ')';
      const last = d.records.length ? d.records[d.records.length - 1] : null;
      document.getElementById('ps-weight').textContent = last ? last.weight + ' กก.' : '-';
      document.getElementById('ps-height').textContent = last ? last.height + ' ซม.' : '-';
      document.getElementById('ps-bmi').innerHTML = last && last.bmi
        ? last.bmi + (last.zscore != null ? '<div style="font-size:12px;color:var(--muted);font-weight:400">z ' + (last.zscore > 0 ? '+' : '') + last.zscore + '</div>' : '')
        : '-';
      document.getElementById('ps-label').innerHTML = last && last.bmi_label ? pill(last.bmi_label) : '-';

      drawTrend(d.records);

      if (!d.records.length) {
        document.getElementById('ps-table').innerHTML = '<div class="text-muted">ยังไม่มีประวัติการวัด</div>';
      } else {
        const rows = d.records.slice().reverse().map(function (r) {
          return '<tr><td>' + Utils.fmtDateThai(r.date) + '</td>' +
            '<td style="text-align:right">' + r.weight + '</td><td style="text-align:right">' + r.height + '</td>' +
            '<td style="text-align:right;font-weight:700">' + (r.bmi || '-') + '</td>' +
            '<td style="text-align:right">' + (r.zscore != null ? (r.zscore > 0 ? '+' : '') + r.zscore : '-') + '</td>' +
            '<td style="text-align:center">' + (r.bmi_label ? pill(r.bmi_label) : '-') + '</td></tr>';
        }).join('');
        document.getElementById('ps-table').innerHTML =
          '<div class="table-wrap"><table class="gr-table"><thead><tr><th>วันที่</th><th style="text-align:right">น้ำหนัก</th><th style="text-align:right">ส่วนสูง</th><th style="text-align:right">BMI</th><th style="text-align:right">z-score</th><th style="text-align:center">แปลผล</th></tr></thead><tbody>' + rows + '</tbody></table></div>';
      }
      document.getElementById('ps-panel').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    } catch (e) { /* Toast */ }
  }

  function drawTrend(records) {
    const ctx = document.getElementById('ps-chart').getContext('2d');
    if (psChart) psChart.destroy();
    psChart = new Chart(ctx, {
      type: 'line',
      data: {
        labels: records.map(function (r) { return Utils.fmtDateThai(r.date); }),
        datasets: [
          { label: 'BMI', data: records.map(function (r) { return r.bmi; }), borderColor: '#0288D1', backgroundColor: 'rgba(2,136,209,.15)', tension: .3, yAxisID: 'y' },
          { label: 'น้ำหนัก (กก.)', data: records.map(function (r) { return r.weight; }), borderColor: '#66BB6A', tension: .3, yAxisID: 'y1' },
        ],
      },
      options: {
        plugins: { legend: { labels: { font: { family: 'Sarabun' } } } },
        scales: {
          x: { ticks: { font: { family: 'Sarabun' } } },
          y: { position: 'left', title: { display: true, text: 'BMI', font: { family: 'Sarabun' } }, ticks: { font: { family: 'Sarabun' } } },
          y1: { position: 'right', grid: { drawOnChartArea: false }, title: { display: true, text: 'กก.', font: { family: 'Sarabun' } }, ticks: { font: { family: 'Sarabun' } } },
        },
      },
    });
  }

  /* ════ เริ่มต้น ════ */
  document.getElementById('rec-date').value = Utils.todayYmd();
  ensureClasses('rec-class');

})();
