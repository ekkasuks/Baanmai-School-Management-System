/**
 * Module — คะแนนกิจกรรมลูกเสือ (ไม่ใช้ PIN)
 * แดชบอร์ดสรุปคะแนนตามหมู่ · สร้างกิจกรรม · บันทึกคะแนนรายหมู่ · สร้าง/จัดการหมู่ลูกเสือ
 */
(function () {

  let currentYear = '';
  let chart = null;
  let selGroup = null;      // หมู่ที่กำลังจัดการสมาชิก
  let curActivity = null;   // กิจกรรมที่กำลังให้คะแนน

  function clearCache() { Store.invalidate('scout:'); }

  /* ── ปีการศึกษา ── */
  async function buildYears() {
    try {
      const d = await api('scout.years', {}, { silent: true, loading: false });
      const years = (d.years && d.years.length) ? d.years : [d.current];
      const sel = document.getElementById('year-select');
      sel.innerHTML = years.map(function (y) {
        return '<option value="' + Utils.esc(y) + '"' + (String(y) === String(d.current) ? ' selected' : '') + '>' +
          Utils.esc(y) + (String(y) === String(d.current) ? ' (ปัจจุบัน)' : '') + '</option>';
      }).join('');
      currentYear = sel.value;
      sel.addEventListener('change', function () {
        currentYear = sel.value;
        selGroup = null; curActivity = null;
        document.getElementById('mem-panel').classList.add('hidden');
        document.getElementById('sc-table').innerHTML = 'เลือกกิจกรรมเพื่อกรอกคะแนน';
        document.getElementById('sc-actions').classList.add('hidden');
        reloadActive();
      });
    } catch (e) { /* ignore */ }
  }

  function reloadActive() {
    const a = document.querySelector('.tab.active');
    const t = a ? a.dataset.tab : 'dashboard';
    if (t === 'dashboard') loadDashboard();
    else if (t === 'activity') loadActivities();
    else if (t === 'score') loadActivityOptions();
    else if (t === 'group') loadGroups();
  }

  /* ── Tabs ── */
  document.querySelectorAll('.tab').forEach(function (t) {
    t.addEventListener('click', function () {
      document.querySelectorAll('.tab').forEach(function (x) { x.classList.remove('active'); });
      t.classList.add('active');
      document.querySelectorAll('.tab-pane').forEach(function (p) { p.classList.add('hidden'); });
      document.getElementById('tab-' + t.dataset.tab).classList.remove('hidden');
      if (t.dataset.tab === 'dashboard') loadDashboard();
      else if (t.dataset.tab === 'activity') loadActivities();
      else if (t.dataset.tab === 'score') loadActivityOptions();
      else if (t.dataset.tab === 'group') loadGroups();
    });
  });

  /* ════════ แดชบอร์ด ════════ */
  async function loadDashboard() {
    try {
      await Store.swr('scout:dash:' + currentYear,
        function (had) { return api('scout.dashboard', { year: currentYear }, { loadingMsg: 'กำลังโหลดสรุป...', loading: !had, silent: had }); },
        renderDashboard);
    } catch (e) { /* Toast แสดงแล้ว */ }
  }

  function renderDashboard(d) {
    document.getElementById('year-note').textContent = 'ปีการศึกษา ' + d.year;
    document.getElementById('d-groups').textContent = Utils.fmtInt(d.group_count);
    document.getElementById('d-acts').textContent = Utils.fmtInt(d.activity_count);
    document.getElementById('d-max').textContent = Utils.fmtNumber(d.max_total, 0);
    document.getElementById('d-awarded').textContent = Utils.fmtNumber(d.total_awarded, 0);

    const host = document.getElementById('d-table');
    if (!d.groups.length) {
      host.innerHTML = '<div class="alert alert-warning">ยังไม่มีหมู่ลูกเสือ — สร้างได้ที่แท็บ "หมู่ลูกเสือ"</div>';
      drawChart([], []);
      return;
    }
    const rows = d.groups.map(function (g) {
      const medal = g.rank <= 3 ? ['🥇', '🥈', '🥉'][g.rank - 1] : g.rank;
      return '<tr><td style="text-align:center" class="rank-medal">' + medal + '</td>' +
        '<td><strong>' + Utils.esc(g.name) + '</strong></td>' +
        '<td style="text-align:center">' + g.members + '</td>' +
        '<td style="text-align:center">' + g.scored_activities + '/' + d.activity_count + '</td>' +
        '<td style="text-align:right;font-weight:700;color:var(--green-dark);font-size:17px">' + Utils.fmtNumber(g.total, 0) + '</td>' +
        '<td style="text-align:right">' + Utils.fmtNumber(g.percent, 1) + '%</td></tr>';
    }).join('');
    host.innerHTML = '<div class="table-wrap"><table class="sc-table"><thead><tr>' +
      '<th style="text-align:center">อันดับ</th><th>หมู่</th><th style="text-align:center">สมาชิก</th>' +
      '<th style="text-align:center">ให้คะแนนแล้ว</th><th style="text-align:right">คะแนนรวม</th><th style="text-align:right">คิดเป็น</th>' +
      '</tr></thead><tbody>' + rows + '</tbody></table></div>';

    drawChart(d.groups.map(function (g) { return g.name; }), d.groups.map(function (g) { return g.total; }));
  }

  function drawChart(labels, data) {
    const ctx = document.getElementById('d-chart').getContext('2d');
    if (chart) chart.destroy();
    chart = new Chart(ctx, {
      type: 'bar',
      data: {
        labels: labels,
        datasets: [{
          label: 'คะแนนรวม', data: data,
          backgroundColor: ['#4FC3F7', '#66BB6A', '#FFB74D', '#BA68C8', '#FF8FB1', '#4DB6AC', '#9575CD', '#F06292'],
          borderRadius: 8,
        }],
      },
      options: {
        plugins: { legend: { display: false } },
        scales: {
          y: { beginAtZero: true, ticks: { font: { family: 'Sarabun' }, precision: 0 } },
          x: { ticks: { font: { family: 'Sarabun' } } },
        },
      },
    });
  }

  /* ════════ สร้างกิจกรรม ════════ */
  async function loadActivities() {
    const host = document.getElementById('act-list');
    try {
      const d = await api('scout.activities', { year: currentYear }, { loadingMsg: 'กำลังโหลดกิจกรรม...' });
      if (!d.activities.length) { host.innerHTML = '<div class="text-muted">ยังไม่มีกิจกรรมในปีนี้</div>'; return; }
      const rows = d.activities.map(function (a, i) {
        return '<tr><td><strong>' + Utils.esc(a.name) + '</strong><br><span class="text-muted" style="font-size:13px">' + Utils.esc(a.task) + '</span></td>' +
          '<td style="text-align:center">' + (a.date ? Utils.fmtDateThai(a.date) : '-') + '</td>' +
          '<td style="text-align:right;font-weight:700">' + Utils.fmtNumber(a.max_score, 0) + '</td>' +
          '<td style="text-align:center">' + a.scored_groups + ' หมู่</td>' +
          '<td style="text-align:right;white-space:nowrap">' +
            '<button class="btn btn-secondary act-edit" data-i="' + i + '" style="padding:4px 10px;font-size:13px"><i class="bi bi-pencil"></i></button>' +
            '<button class="btn btn-danger act-del" data-id="' + Utils.esc(a.activity_id) + '" style="padding:4px 10px;font-size:13px"><i class="bi bi-trash"></i></button>' +
          '</td></tr>';
      }).join('');
      host.innerHTML = '<div class="table-wrap"><table class="sc-table"><thead><tr><th>กิจกรรม / งานที่มอบหมาย</th><th style="text-align:center">วันที่</th><th style="text-align:right">คะแนนเต็ม</th><th style="text-align:center">ให้คะแนนแล้ว</th><th></th></tr></thead><tbody>' + rows + '</tbody></table></div>';
      host.querySelectorAll('.act-edit').forEach(function (b) {
        b.onclick = function () { editActivity(d.activities[parseInt(b.dataset.i, 10)]); };
      });
      host.querySelectorAll('.act-del').forEach(function (b) {
        b.onclick = function () { delActivity(b.dataset.id); };
      });
    } catch (e) { host.innerHTML = '<div class="alert alert-danger">' + Utils.esc(e.message) + '</div>'; }
  }

  function editActivity(a) {
    document.getElementById('act-id').value = a.activity_id;
    document.getElementById('act-name').value = a.name;
    document.getElementById('act-task').value = a.task;
    document.getElementById('act-max').value = a.max_score;
    document.getElementById('act-date').value = a.date || '';
    document.getElementById('act-cancel').classList.remove('hidden');
    document.getElementById('act-form').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  function resetActivityForm() {
    document.getElementById('act-id').value = '';
    document.getElementById('act-form').reset();
    document.getElementById('act-date').value = Utils.todayYmd();
    document.getElementById('act-cancel').classList.add('hidden');
  }
  document.getElementById('act-cancel').onclick = resetActivityForm;

  document.getElementById('act-form').addEventListener('submit', async function (e) {
    e.preventDefault();
    const name = document.getElementById('act-name').value.trim();
    const task = document.getElementById('act-task').value.trim();
    const max = parseFloat(document.getElementById('act-max').value);
    if (!name) { Toast.show('กรุณากรอกชื่อกิจกรรม', 'warning'); return; }
    if (!task) { Toast.show('กรุณากรอกชื่องานที่มอบหมาย', 'warning'); return; }
    if (!(max > 0)) { Toast.show('คะแนนเต็มต้องมากกว่า 0', 'warning'); return; }
    try {
      await api('scout.activity_save', {
        activity_id: document.getElementById('act-id').value || undefined,
        name: name, task: task, max_score: max,
        date: document.getElementById('act-date').value || undefined,
        year: currentYear, recorded_by: 'admin',
      }, { loadingMsg: 'กำลังบันทึก...' });
      Toast.show('บันทึกกิจกรรมสำเร็จ', 'success');
      clearCache(); resetActivityForm(); loadActivities();
    } catch (err) { /* Toast แสดงแล้ว */ }
  });

  async function delActivity(id) {
    if (!confirm('ลบกิจกรรมนี้?\n⚠️ คะแนนที่บันทึกไว้ของกิจกรรมนี้จะถูกลบด้วย')) return;
    try {
      await api('scout.activity_delete', { activity_id: id, recorded_by: 'admin' }, { loadingMsg: 'กำลังลบ...' });
      Toast.show('ลบกิจกรรมแล้ว', 'success');
      clearCache(); loadActivities();
    } catch (e) { /* Toast */ }
  }

  /* ════════ บันทึกคะแนน ════════ */
  async function loadActivityOptions() {
    const sel = document.getElementById('sc-activity');
    try {
      const d = await api('scout.activities', { year: currentYear }, { silent: true, loading: false });
      const keep = sel.value;
      sel.innerHTML = '<option value="">— เลือกกิจกรรม —</option>' + d.activities.map(function (a) {
        return '<option value="' + Utils.esc(a.activity_id) + '">' + Utils.esc(a.name + ' · ' + a.task + ' (เต็ม ' + a.max_score + ')') + '</option>';
      }).join('');
      if (keep) sel.value = keep;
    } catch (e) { /* ignore */ }
  }

  document.getElementById('sc-activity').addEventListener('change', async function () {
    const host = document.getElementById('sc-table');
    const actions = document.getElementById('sc-actions');
    const info = document.getElementById('sc-info');
    document.getElementById('sc-result').classList.add('hidden');
    if (!this.value) {
      host.innerHTML = 'เลือกกิจกรรมเพื่อกรอกคะแนน'; host.className = 'text-muted';
      actions.classList.add('hidden'); info.classList.add('hidden'); curActivity = null; return;
    }
    try {
      host.className = '';
      const d = await api('scout.score_sheet', { activity_id: this.value }, { loadingMsg: 'กำลังโหลด...' });
      curActivity = d.activity;
      info.innerHTML = '🎯 <strong>' + Utils.esc(d.activity.name) + '</strong> · งาน: ' + Utils.esc(d.activity.task) +
        ' · คะแนนเต็ม <strong>' + d.activity.max_score + '</strong>';
      info.classList.remove('hidden');
      renderScoreTable(d.groups, d.activity.max_score);
      actions.classList.remove('hidden');
    } catch (e) { host.innerHTML = '<div class="alert alert-danger">' + Utils.esc(e.message) + '</div>'; }
  });

  function renderScoreTable(groups, max) {
    const host = document.getElementById('sc-table');
    if (!groups.length) {
      host.innerHTML = '<div class="alert alert-warning">ยังไม่มีหมู่ลูกเสือในปีนี้ — สร้างที่แท็บ "หมู่ลูกเสือ" ก่อน</div>';
      document.getElementById('sc-actions').classList.add('hidden');
      return;
    }
    const rows = groups.map(function (g) {
      return '<tr data-gid="' + Utils.esc(g.group_id) + '">' +
        '<td><strong>' + Utils.esc(g.name) + '</strong></td>' +
        '<td style="text-align:center">' + g.members + ' คน</td>' +
        '<td style="text-align:center"><input class="sc-input" type="number" min="0" max="' + max + '" step="1" inputmode="decimal" value="' + (g.score === null ? '' : g.score) + '" placeholder="0"></td>' +
        '<td style="text-align:center;color:var(--muted)">/ ' + max + '</td></tr>';
    }).join('');
    host.innerHTML = '<div class="table-wrap"><table class="sc-table"><thead><tr><th>หมู่</th><th style="text-align:center">สมาชิก</th><th style="text-align:center">คะแนนที่ได้</th><th style="text-align:center">เต็ม</th></tr></thead><tbody>' + rows + '</tbody></table></div>';
  }

  document.getElementById('sc-full').onclick = function () {
    if (!curActivity) return;
    document.querySelectorAll('#sc-table tbody input').forEach(function (i) { i.value = curActivity.max_score; });
  };

  document.getElementById('sc-save').onclick = async function () {
    if (!curActivity) return;
    const rows = document.querySelectorAll('#sc-table tbody tr');
    const scores = [];
    rows.forEach(function (tr) {
      const v = tr.querySelector('input').value;
      if (v !== '') scores.push({ group_id: tr.dataset.gid, score: v });
    });
    if (!scores.length) { Toast.show('ยังไม่ได้กรอกคะแนน', 'warning'); return; }
    try {
      const r = await api('scout.score_save', {
        activity_id: curActivity.activity_id, scores: scores,
        recorded_by: document.getElementById('sc-by').value.trim() || 'admin',
      }, { loadingMsg: 'กำลังบันทึก...' });
      const res = document.getElementById('sc-result');
      res.className = 'alert alert-success mt-2';
      res.textContent = '✅ บันทึกคะแนนสำเร็จ — ใหม่ ' + r.inserted + ' หมู่, อัปเดต ' + r.updated + ' หมู่';
      res.classList.remove('hidden');
      Toast.show('บันทึกคะแนนสำเร็จ', 'success');
      clearCache();
    } catch (e) { /* Toast */ }
  };

  /* ════════ หมู่ลูกเสือ ════════ */
  async function loadGroups() {
    const host = document.getElementById('grp-list');
    try {
      const d = await api('scout.groups', { year: currentYear }, { loadingMsg: 'กำลังโหลดหมู่...' });
      if (!d.groups.length) {
        host.innerHTML = '<div class="text-muted">ยังไม่มีหมู่ — สร้างหมู่แรกได้จากฟอร์มด้านบน</div>';
        return;
      }
      host.innerHTML = d.groups.map(function (g) {
        return '<div class="group-card" data-id="' + Utils.esc(g.group_id) + '" data-name="' + Utils.esc(g.name) + '">' +
          '<div style="font-weight:700;font-size:17px">⚜️ ' + Utils.esc(g.name) + '</div>' +
          '<div class="text-muted" style="font-size:13px">' + g.members + ' คน' + (g.note ? ' · ' + Utils.esc(g.note) : '') + '</div>' +
          (g.leader ? '<div style="font-size:12px;color:#EF6C00;font-weight:600">นายหมู่: ' + Utils.esc(g.leader) + '</div>' : '') +
          (g.deputy ? '<div style="font-size:12px;color:#0288D1;font-weight:600">รองนายหมู่: ' + Utils.esc(g.deputy) + '</div>' : '') +
          '</div>';
      }).join('');
      host.querySelectorAll('.group-card').forEach(function (c) {
        c.onclick = function () {
          host.querySelectorAll('.group-card').forEach(function (x) { x.classList.remove('active'); });
          c.classList.add('active');
          openGroup({ group_id: c.dataset.id, name: c.dataset.name });
        };
      });
    } catch (e) { host.innerHTML = '<div class="alert alert-danger">' + Utils.esc(e.message) + '</div>'; }
  }

  document.getElementById('grp-form').addEventListener('submit', async function (e) {
    e.preventDefault();
    const name = document.getElementById('grp-name').value.trim();
    if (!name) { Toast.show('กรุณากรอกชื่อหมู่', 'warning'); return; }
    try {
      await api('scout.group_save', {
        group_id: document.getElementById('grp-id').value || undefined,
        name: name, note: document.getElementById('grp-note').value.trim(),
        year: currentYear, recorded_by: 'admin',
      }, { loadingMsg: 'กำลังบันทึก...' });
      Toast.show('บันทึกหมู่สำเร็จ', 'success');
      clearCache(); resetGroupForm(); loadGroups();
    } catch (err) { /* Toast */ }
  });

  function resetGroupForm() {
    document.getElementById('grp-id').value = '';
    document.getElementById('grp-form').reset();
    document.getElementById('grp-cancel').classList.add('hidden');
  }
  document.getElementById('grp-cancel').onclick = resetGroupForm;

  async function openGroup(g) {
    selGroup = g;
    document.getElementById('mem-panel').classList.remove('hidden');
    document.getElementById('mem-title').textContent = '⚜️ สมาชิกหมู่ ' + g.name;
    document.getElementById('pick-panel').classList.add('hidden');
    // เติมฟอร์มแก้ไขชื่อหมู่
    document.getElementById('grp-id').value = g.group_id;
    document.getElementById('grp-name').value = g.name;
    document.getElementById('grp-cancel').classList.remove('hidden');
    await loadMembers();
    document.getElementById('mem-panel').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  async function loadMembers() {
    if (!selGroup) return;
    const host = document.getElementById('mem-list');
    try {
      const d = await api('scout.members', { group_id: selGroup.group_id }, { silent: true, loading: false });
      if (!d.members.length) { host.innerHTML = '<div class="text-muted">ยังไม่มีสมาชิก — กด "เพิ่มสมาชิก"</div>'; return; }
      const rows = d.members.map(function (m) {
        const badge = m.role === 'leader' ? '<span class="role-badge lead">นายหมู่</span>'
          : m.role === 'deputy' ? '<span class="role-badge dep">รองนายหมู่</span>' : '';
        const roleBtn = function (role, label) {
          const on = m.role === role;
          return '<button class="role-btn' + (on ? ' on-' + role : '') + '" data-cid="' + Utils.esc(m.citizen_id) +
            '" data-role="' + role + '" data-on="' + (on ? '1' : '') + '" title="' +
            (on ? 'กดเพื่อยกเลิกตำแหน่ง' : 'กดเพื่อกำหนดเป็น' + label) + '">' + label + '</button>';
        };
        return '<tr><td>' + Utils.esc(m.name) + badge + '</td>' +
          '<td style="text-align:center">' + Utils.esc(m.grade) + '/' + Utils.esc(m.room) + '</td>' +
          '<td style="text-align:center">' + Utils.esc(m.student_code) + '</td>' +
          '<td style="text-align:center;white-space:nowrap">' + roleBtn('leader', 'นายหมู่') + roleBtn('deputy', 'รองนายหมู่') + '</td>' +
          '<td style="text-align:right"><button class="btn btn-danger mem-del" data-cid="' + Utils.esc(m.citizen_id) + '" style="padding:3px 10px;font-size:13px"><i class="bi bi-x-lg"></i></button></td></tr>';
      }).join('');
      host.innerHTML = '<div class="text-muted" style="margin-bottom:6px">ทั้งหมด ' + d.members.length + ' คน · ' +
        'นายหมู่แสดงเป็นลำดับแรก · รองนายหมู่แสดงลำดับสุดท้าย</div>' +
        '<div class="table-wrap"><table class="sc-table"><thead><tr><th>ชื่อ</th><th style="text-align:center">ชั้น</th><th style="text-align:center">รหัส</th><th style="text-align:center">กำหนดตำแหน่ง</th><th></th></tr></thead><tbody>' + rows + '</tbody></table></div>';
      host.querySelectorAll('.mem-del').forEach(function (b) {
        b.onclick = function () { removeMember(b.dataset.cid); };
      });
      host.querySelectorAll('.role-btn').forEach(function (b) {
        b.onclick = function () { setRole(b.dataset.cid, b.dataset.role, !!b.dataset.on); };
      });
    } catch (e) { host.innerHTML = '<div class="alert alert-danger">' + Utils.esc(e.message) + '</div>'; }
  }

  /** กำหนด/ยกเลิกตำแหน่งนายหมู่-รองนายหมู่ (กดซ้ำที่ปุ่มเดิม = ยกเลิก) */
  async function setRole(cid, role, isOn) {
    if (!selGroup) return;
    const label = role === 'leader' ? 'นายหมู่' : 'รองนายหมู่';
    try {
      await api('scout.member_role', {
        group_id: selGroup.group_id, citizen_id: cid,
        role: isOn ? '' : role, recorded_by: 'admin',
      }, { loadingMsg: 'กำลังบันทึกตำแหน่ง...' });
      Toast.show(isOn ? 'ยกเลิกตำแหน่ง' + label + 'แล้ว' : 'กำหนด' + label + 'เรียบร้อย', 'success');
      clearCache();
      loadMembers();   // โหลดใหม่ → เรียงนายหมู่ขึ้นบนสุด / รองนายหมู่ล่างสุด
      loadGroups();
    } catch (e) { /* Toast แสดงแล้ว */ }
  }

  async function removeMember(cid) {
    if (!selGroup || !confirm('เอานักเรียนคนนี้ออกจากหมู่?')) return;
    try {
      await api('scout.member_remove', { group_id: selGroup.group_id, citizen_id: cid, recorded_by: 'admin' }, { loadingMsg: 'กำลังลบ...' });
      Toast.show('เอาออกจากหมู่แล้ว', 'success');
      clearCache(); loadMembers(); loadGroups();
    } catch (e) { /* Toast */ }
  }

  document.getElementById('grp-del-btn').onclick = async function () {
    if (!selGroup) return;
    if (!confirm('ลบหมู่ "' + selGroup.name + '"?\n⚠️ สมาชิกและคะแนนของหมู่นี้จะถูกลบด้วย')) return;
    try {
      await api('scout.group_delete', { group_id: selGroup.group_id, recorded_by: 'admin' }, { loadingMsg: 'กำลังลบ...' });
      Toast.show('ลบหมู่แล้ว', 'success');
      selGroup = null;
      document.getElementById('mem-panel').classList.add('hidden');
      clearCache(); resetGroupForm(); loadGroups();
    } catch (e) { /* Toast */ }
  };

  /* ── ตัวเลือกนักเรียนเข้าหมู่ ── */
  document.getElementById('mem-add-btn').onclick = function () {
    document.getElementById('pick-panel').classList.remove('hidden');
    loadPickList();
  };
  document.getElementById('pick-cancel').onclick = function () {
    document.getElementById('pick-panel').classList.add('hidden');
  };
  document.getElementById('pick-search').addEventListener('input', Utils.debounce(loadPickList, 300));
  document.getElementById('pick-grade').addEventListener('change', loadPickList);

  async function loadPickList() {
    const host = document.getElementById('pick-list');
    try {
      const d = await api('scout.available_students', {
        year: currentYear,
        grade: document.getElementById('pick-grade').value || undefined,
        q: document.getElementById('pick-search').value.trim() || undefined,
      }, { silent: true, loading: false });

      // เติม dropdown ชั้น (ครั้งแรก)
      const gsel = document.getElementById('pick-grade');
      if (!gsel.dataset.filled) {
        const grades = [];
        d.students.forEach(function (s) { if (s.grade && grades.indexOf(s.grade) < 0) grades.push(s.grade); });
        grades.sort(function (a, b) { return Utils.gradeSortKey(a) - Utils.gradeSortKey(b); });
        gsel.innerHTML = '<option value="">ทุกชั้น</option>' + Utils.options(grades, '');
        gsel.dataset.filled = '1';
      }

      if (!d.students.length) { host.innerHTML = '<div class="text-muted">ไม่พบนักเรียนที่ยังไม่อยู่หมู่ใด</div>'; return; }
      host.innerHTML = d.students.map(function (s) {
        return '<label class="pick-row"><input type="checkbox" value="' + Utils.esc(s.citizen_id) + '">' +
          '<span>' + Utils.esc(s.name) + ' <span class="text-muted" style="font-size:13px">· ' + Utils.esc(s.grade) + '/' + Utils.esc(s.room) + '</span></span></label>';
      }).join('');
    } catch (e) { host.innerHTML = '<div class="alert alert-danger">' + Utils.esc(e.message) + '</div>'; }
  }

  document.getElementById('pick-save').onclick = async function () {
    if (!selGroup) return;
    const cids = [];
    document.querySelectorAll('#pick-list input:checked').forEach(function (i) { cids.push(i.value); });
    if (!cids.length) { Toast.show('ยังไม่ได้เลือกนักเรียน', 'warning'); return; }
    try {
      const r = await api('scout.member_add', { group_id: selGroup.group_id, citizen_ids: cids, recorded_by: 'admin' }, { loadingMsg: 'กำลังเพิ่ม...' });
      Toast.show('เพิ่มสมาชิก ' + r.added + ' คน' + (r.skipped ? ' (ข้าม ' + r.skipped + ')' : ''), 'success');
      clearCache(); loadMembers(); loadGroups(); loadPickList();
    } catch (e) { /* Toast */ }
  };

  /* ════════ เริ่มต้น ════════ */
  document.getElementById('act-date').value = Utils.todayYmd();
  (async function () {
    await buildYears();
    loadDashboard();
  })();

})();
