/**
 * Module 6 — ข้อมูลนักเรียน (ไม่ใช้ PIN)
 * รายชื่อ + ค้นหา/กรอง · โปรไฟล์รายบุคคล (ข้ามโมดูล) · แก้ไข · ภาพรวม
 */
(function () {

  let allStudents = [];   // โหลดครั้งเดียว แล้วกรองฝั่ง client
  let chart = null;
  let editingCid = null;

  /* ── ล้าง cache SWR ของโมดูลนี้ — เรียกเมื่อเครื่องตัวเองเพิ่ม/แก้ไข/ลบนักเรียน ── */
  function clearDashCache() { Store.invalidate('students:'); }

  const HEALTH_LABELS = { hair: 'ผม', nails: 'เล็บ', cup: 'แก้วน้ำ', toothbrush: 'แปรงสีฟัน', toothpaste: 'ยาสีฟัน' };
  const EDIT_FIELDS = ['prefix', 'first_name', 'last_name', 'gender', 'grade', 'room', 'birth_date',
    'blood_type', 'religion', 'nationality', 'guardian_name', 'guardian_phone', 'address',
    'weight_init', 'height_init', 'status'];

  /* ── Tabs ── */
  document.querySelectorAll('.tab').forEach(function (t) {
    t.addEventListener('click', function () {
      document.querySelectorAll('.tab').forEach(function (x) { x.classList.remove('active'); });
      t.classList.add('active');
      document.querySelectorAll('.tab-pane').forEach(function (p) { p.classList.add('hidden'); });
      document.getElementById('tab-' + t.dataset.tab).classList.remove('hidden');
      if (t.dataset.tab === 'dashboard') loadDashboard();
    });
  });

  /* ════ โหลดรายชื่อทั้งหมด ════ */
  function applyStudentList(d) {
    allStudents = d.students || [];
    // เติม dropdown ชั้น (คงค่าที่เลือกไว้)
    const grades = [];
    allStudents.forEach(function (s) { if (s.grade && grades.indexOf(s.grade) < 0) grades.push(s.grade); });
    grades.sort(function (a, b) { return Utils.gradeSortKey(a) - Utils.gradeSortKey(b); });
    const sel = document.getElementById('f-grade');
    sel.innerHTML = '<option value="">ทุกชั้น</option>' + Utils.options(grades, sel.value);
    renderList();
  }

  async function loadAll() {
    try {
      await Store.swr('students:list',
        function (had) { return api('students.list', {}, { loadingMsg: 'กำลังโหลดรายชื่อ...', loading: !had, silent: had }); },
        applyStudentList);
    } catch (e) {
      document.getElementById('list-result').innerHTML = '<div class="alert alert-warning">ยังไม่มีข้อมูลนักเรียน — นำเข้า DMC ที่เมนูตั้งค่าระบบก่อน</div>';
    }
  }

  function renderList() {
    const q = document.getElementById('f-search').value.trim().toLowerCase();
    const grade = document.getElementById('f-grade').value;
    const status = document.getElementById('f-status').value;
    let list = allStudents.slice();
    if (grade) list = list.filter(function (s) { return s.grade === grade; });
    if (status) list = list.filter(function (s) { return (status === 'inactive') === (s.status === 'inactive'); });
    if (q) list = list.filter(function (s) {
      return (Utils.fullName(s) + ' ' + s.student_code + ' ' + s.citizen_id).toLowerCase().indexOf(q) >= 0;
    });
    list.sort(function (a, b) {
      const g = Utils.gradeSortKey(a.grade) - Utils.gradeSortKey(b.grade);
      if (g !== 0) return g;
      if (String(a.room) !== String(b.room)) return (parseInt(a.room, 10) || 0) - (parseInt(b.room, 10) || 0);
      return Utils.fullName(a).localeCompare(Utils.fullName(b), 'th');
    });

    document.getElementById('list-count').textContent = 'พบ ' + list.length + ' คน (จากทั้งหมด ' + allStudents.length + ' คน)';
    const host = document.getElementById('list-result');
    if (!list.length) { host.innerHTML = '<div class="text-muted">ไม่พบนักเรียน</div>'; return; }
    const rows = list.map(function (s, i) {
      const inactive = s.status === 'inactive';
      return '<tr data-cid="' + Utils.esc(s.citizen_id) + '" style="cursor:pointer' + (inactive ? ';opacity:.5' : '') + '">' +
        '<td>' + Utils.esc(s.student_code) + '</td>' +
        '<td>' + Utils.esc(Utils.fullName(s)) + '</td>' +
        '<td>' + Utils.esc(s.grade) + '/' + Utils.esc(s.room) + '</td>' +
        '<td style="text-align:center">' + Utils.esc(s.gender) + '</td></tr>';
    }).join('');
    host.innerHTML = '<div class="table-wrap"><table><thead><tr><th>รหัส</th><th>ชื่อ-สกุล</th><th>ชั้น</th><th style="text-align:center">เพศ</th></tr></thead><tbody>' + rows + '</tbody></table></div>';
    host.querySelectorAll('tbody tr').forEach(function (tr) {
      tr.onclick = function () { openProfile(tr.dataset.cid); };
    });
  }

  document.getElementById('f-search').addEventListener('input', Utils.debounce(renderList, 250));
  document.getElementById('f-grade').addEventListener('change', renderList);
  document.getElementById('f-status').addEventListener('change', renderList);

  /* ════ โปรไฟล์รายบุคคล ════ */
  async function openProfile(cid) {
    try {
      const d = await api('students.profile', { citizen_id: cid }, { loadingMsg: 'กำลังโหลดโปรไฟล์...' });
      const s = d.student;
      editingCid = cid;
      document.getElementById('profile-panel').classList.remove('hidden');
      document.getElementById('p-name').textContent = '🧑‍🎓 ' + Utils.fullName(s) + ' (ชั้น ' + s.grade + '/' + s.room + ')';

      // summary
      document.getElementById('p-bank').textContent = Utils.fmtMoney(d.bank.balance);
      document.getElementById('p-behavior').textContent = Utils.fmtInt(d.behavior.score);

      // ทุนการศึกษาปีนี้
      if (d.scholarship) {
        document.getElementById('p-scholarship').innerHTML = Utils.fmtMoney(d.scholarship.year_total) +
          (d.scholarship.year_count ? '<div style="font-size:12px;color:var(--muted);font-weight:400">' + d.scholarship.year_count + ' ทุน · ปี ' + d.scholarship.year + '</div>' : '');
      } else { document.getElementById('p-scholarship').textContent = '-'; }

      // การเจริญเติบโต (BMI/แปลผล WHO)
      if (d.growth && d.growth.bmi) {
        document.getElementById('p-growth').innerHTML = 'BMI ' + d.growth.bmi +
          (d.growth.bmi_label ? '<div style="font-size:13px;font-weight:400;color:var(--muted)">' + Utils.esc(d.growth.bmi_label) + ' · ' + Utils.fmtDateThai(d.growth.date) + '</div>' : '');
      } else {
        document.getElementById('p-growth').innerHTML = '<span class="text-muted" style="font-size:14px">ยังไม่วัด</span>';
      }
      if (d.health) {
        const fails = Object.keys(HEALTH_LABELS).filter(function (k) { return d.health[k] === 'ไม่ผ่าน'; });
        document.getElementById('p-health').innerHTML = Utils.fmtDateThai(d.health.date) + '<br>' +
          (fails.length ? '<span style="color:var(--red);font-size:14px">ไม่ผ่าน: ' + fails.map(function (k) { return HEALTH_LABELS[k]; }).join(', ') + '</span>'
                        : '<span style="color:var(--green-dark);font-size:14px">ผ่านทุกข้อ</span>');
      } else {
        document.getElementById('p-health').innerHTML = '<span class="text-muted" style="font-size:14px">ยังไม่ตรวจ</span>';
      }
      const ac = d.attendance.counts;
      document.getElementById('p-att').innerHTML = '<span style="font-size:14px">มา ' + ac['มา'] + ' · ขาด ' + ac['ขาด'] + ' · ลา ' + ac['ลา'] + ' · สาย ' + ac['สาย'] + '</span>';

      // info grid
      const age = Utils.ageFromBuddhist(s.birth_date);
      const info = [
        ['รหัสนักเรียน', s.student_code], ['เลขบัตรประชาชน', s.citizen_id],
        ['เพศ', s.gender], ['วันเกิด', (s.birth_date || '-') + (age != null ? ' (อายุ ' + age + ' ปี)' : '')],
        ['หมู่เลือด', s.blood_type || '-'], ['ศาสนา', s.religion || '-'], ['สัญชาติ', s.nationality || '-'],
        ['ผู้ปกครอง', s.guardian_name || '-'], ['เบอร์ผู้ปกครอง', s.guardian_phone || '-'],
        ['น้ำหนักแรกเข้า', s.weight_init ? s.weight_init + ' กก.' : '-'], ['ส่วนสูงแรกเข้า', s.height_init ? s.height_init + ' ซม.' : '-'],
        ['สถานะ', s.status === 'inactive' ? 'พ้นสภาพ' : 'กำลังศึกษา'], ['ที่อยู่', s.address || '-'],
      ];
      document.getElementById('p-info').innerHTML = info.map(function (r) {
        return '<div><div class="k">' + Utils.esc(r[0]) + '</div><div class="v">' + Utils.esc(String(r[1])) + '</div></div>';
      }).join('');

      // ปุ่มลบ/กู้คืน ตามสถานะปัจจุบัน
      const isInactive = s.status === 'inactive';
      document.getElementById('p-delete').classList.toggle('hidden', isInactive);
      document.getElementById('p-restore').classList.toggle('hidden', !isInactive);

      // recent behavior
      const bl = d.behavior.recent;
      if (!bl.length) {
        document.getElementById('p-bhv-list').innerHTML = '<div class="text-muted">ยังไม่มีรายการเดือนนี้</div>';
      } else {
        const rows = bl.map(function (l) {
          const up = l.points_change > 0;
          return '<tr><td>' + Utils.fmtDateThai(l.date) + '</td><td>' + Utils.esc(l.item_name) + '</td>' +
            '<td style="text-align:right;font-weight:700;color:' + (up ? 'var(--green-dark)' : 'var(--red)') + '">' + (up ? '+' : '') + l.points_change + '</td></tr>';
        }).join('');
        document.getElementById('p-bhv-list').innerHTML =
          '<div class="table-wrap"><table><thead><tr><th>วันที่</th><th>รายการ</th><th style="text-align:right">+/−</th></tr></thead><tbody>' + rows + '</tbody></table></div>';
      }

      // ทุนการศึกษาล่าสุด
      const sl = d.scholarship && d.scholarship.recent ? d.scholarship.recent : [];
      if (!sl.length) {
        document.getElementById('p-sch-list').innerHTML = '<div class="text-muted">ยังไม่มีข้อมูลการรับทุน</div>';
      } else {
        const rows = sl.map(function (r) {
          return '<tr><td>' + Utils.fmtDateThai(r.date) + '</td><td>' + Utils.esc(r.name) + '</td>' +
            '<td style="text-align:center">' + Utils.esc(r.year) + '</td>' +
            '<td style="text-align:right;font-weight:700;color:var(--green-dark)">' + Utils.fmtMoney(r.amount) + '</td></tr>';
        }).join('');
        document.getElementById('p-sch-list').innerHTML =
          '<div class="table-wrap"><table><thead><tr><th>วันที่</th><th>ชื่อทุน</th><th style="text-align:center">ปี</th><th style="text-align:right">จำนวน</th></tr></thead><tbody>' + rows + '</tbody></table></div>';
      }
      document.getElementById('profile-panel').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    } catch (e) { /* Toast แสดงแล้ว */ }
  }

  /* ════ พิกัดบ้าน (แผนที่บ้านนักเรียน · ต้องเข้าสู่ระบบ — js/geo.js) ════ */
  document.getElementById('p-geo').onclick = function () {
    if (!editingCid) return;
    const s = allStudents.find(function (x) { return String(x.citizen_id) === String(editingCid); });
    GeoPicker.open({ mode: 'home', citizen_id: String(editingCid), label: s ? Utils.fullName(s) : '' });
  };

  /* ════ แก้ไข ════ */
  document.getElementById('p-edit').onclick = function () {
    if (!editingCid) return;
    const s = allStudents.find(function (x) { return String(x.citizen_id) === String(editingCid); });
    if (!s) return;
    const form = document.getElementById('edit-form');
    EDIT_FIELDS.forEach(function (k) { if (form[k]) form[k].value = s[k] !== undefined && s[k] !== null ? s[k] : ''; });
    form.citizen_id.value = String(s.citizen_id || '');
    document.getElementById('edit-modal').classList.add('show');
  };
  document.getElementById('edit-cancel').onclick = function () { document.getElementById('edit-modal').classList.remove('show'); };

  document.getElementById('edit-form').addEventListener('submit', async function (e) {
    e.preventDefault();
    const form = e.target;
    const fields = {};
    EDIT_FIELDS.forEach(function (k) { fields[k] = form[k].value; });
    const oldCid = String(editingCid);
    const newCid = String(form.citizen_id.value || '').replace(/[\s-]/g, '').toUpperCase();
    if (!/^[0-9A-Z]\d{12}$/.test(newCid)) {
      Toast.show('เลขประจำตัวต้องมี 13 หลัก: ตัวเลข 13 หลัก หรือตัวอักษรอังกฤษ 1 ตัว + ตัวเลข 12 หลัก (เช่น G123456789012)', 'error');
      form.citizen_id.focus();
      return;
    }
    const changing = newCid !== oldCid.toUpperCase();
    if (changing && allStudents.some(function (x) { return String(x.citizen_id).toUpperCase() === newCid; })) {
      Toast.show('เลขประจำตัว ' + newCid + ' เป็นของนักเรียนอีกคนแล้ว', 'error');
      form.citizen_id.focus();
      return;
    }
    if (changing && !confirm('ยืนยันเปลี่ยนเลขประจำตัว?\n\nเดิม: ' + oldCid + '\nใหม่: ' + newCid +
        '\n\nข้อมูลทุกโมดูลของนักเรียนคนนี้จะย้ายไปใช้เลขใหม่ (ข้อมูลไม่หาย และเปลี่ยนกลับได้)')) return;
    if (changing) fields.citizen_id = newCid;
    try {
      const d = await api('students.update', { citizen_id: oldCid, fields: fields, recorded_by: 'admin' }, { loadingMsg: changing ? 'กำลังเปลี่ยนเลขประจำตัว...' : 'กำลังบันทึก...' });
      const cid = String((d && d.citizen_id) || oldCid);
      clearDashCache();
      Toast.show(changing ? 'บันทึกและเปลี่ยนเลขประจำตัวสำเร็จ' : 'บันทึกข้อมูลนักเรียนสำเร็จ', 'success');
      document.getElementById('edit-modal').classList.remove('show');
      // อัปเดต cache ในหน่วยความจำ
      const idx = allStudents.findIndex(function (x) { return String(x.citizen_id) === oldCid; });
      if (idx >= 0) { EDIT_FIELDS.forEach(function (k) { allStudents[idx][k] = fields[k]; }); allStudents[idx].citizen_id = cid; }
      editingCid = cid;
      renderList();
      openProfile(cid);
    } catch (err) { /* Toast แสดงแล้ว */ }
  });

  /* ════ ลบ / กู้คืน ════ */
  async function setStudentStatus(action, status, confirmMsg) {
    if (!editingCid) return;
    if (confirmMsg && !confirm(confirmMsg)) return;
    try {
      await api('students.' + action, { citizen_id: editingCid, recorded_by: 'admin' }, { loadingMsg: 'กำลังบันทึก...' });
      clearDashCache();
      Toast.show(action === 'remove' ? 'ลบนักเรียนสำเร็จ' : 'กู้คืนสถานะสำเร็จ', 'success');
      const idx = allStudents.findIndex(function (x) { return String(x.citizen_id) === String(editingCid); });
      if (idx >= 0) allStudents[idx].status = status;
      renderList();
      openProfile(editingCid);
    } catch (err) { /* Toast แสดงแล้ว */ }
  }
  document.getElementById('p-delete').onclick = function () {
    setStudentStatus('remove', 'inactive', 'ยืนยันลบนักเรียนคนนี้? (ระบบจะตั้งสถานะเป็น "พ้นสภาพ" — ประวัติข้อมูลเดิมยังคงอยู่ และกู้คืนได้ภายหลัง)');
  };
  document.getElementById('p-restore').onclick = function () {
    setStudentStatus('restore', 'active', 'ยืนยันกู้คืนสถานะนักเรียนคนนี้เป็น "กำลังศึกษา"?');
  };

  /* ════ ลบออกจากฐานข้อมูลถาวร (PIN ตั้งค่าระบบ) — เช่น เพิ่มนักเรียนผิด/ซ้ำ ════ */
  document.getElementById('p-purge').onclick = function () {
    if (!editingCid) return;
    const s = allStudents.find(function (x) { return String(x.citizen_id) === String(editingCid); });
    if (!s) return;
    const cid = String(editingCid), name = Utils.fullName(s);
    const el = document.createElement('div');
    el.className = 'modal-backdrop show';
    el.innerHTML = '<div class="modal" style="max-width:460px"><h3 class="modal-title" style="color:#B71C1C">🗑️ ลบออกจากฐานข้อมูลถาวร</h3>' +
      '<p><strong>' + Utils.esc(name) + '</strong> · ' + Utils.esc(s.grade + (s.room ? '/' + s.room : '')) + '</p>' +
      '<div class="alert alert-danger" style="font-size:14px">ข้อมูลทั้งหมดของนักเรียนคนนี้จะถูกลบ <strong>กู้คืนไม่ได้</strong>: ทะเบียน · เช็คชื่อ · พฤติกรรม · สุขภาพ · การเจริญเติบโต · นม · ทุน · ลูกเสือ · ประวัติธนาคาร · พิกัดบ้าน · ท่องสูตรคูณ<br>' +
        'ถ้านักเรียนแค่ย้ายออก/จบ ให้ใช้ปุ่ม <strong>ลบนักเรียน (พ้นสภาพ)</strong> แทน (ข้อมูลยังอยู่)</div>' +
      '<div class="text-muted" style="font-size:13px;margin-bottom:8px">ยังมีเงินฝากคงเหลือ → ลบไม่ได้ (ถอนให้เป็น 0 ก่อน) · ระบบจะดาวน์โหลดไฟล์สำเนาข้อมูลที่ลบเก็บไว้ให้</div>' +
      '<label>พิมพ์ชื่อ <strong>' + Utils.esc(s.first_name) + '</strong> เพื่อยืนยัน</label><input class="form-control" data-confirm autocomplete="off">' +
      '<div class="flex" style="justify-content:flex-end;gap:8px;margin-top:14px"><button class="btn btn-secondary" data-cancel>ยกเลิก</button>' +
      '<button class="btn btn-danger" data-ok style="background:#B71C1C" disabled>ลบถาวร</button></div></div>';
    document.body.appendChild(el);
    const input = el.querySelector('[data-confirm]'), ok = el.querySelector('[data-ok]');
    setTimeout(function () { input.focus(); }, 100);
    input.oninput = function () { ok.disabled = input.value.trim() !== String(s.first_name).trim(); };
    el.querySelector('[data-cancel]').onclick = function () { el.remove(); };
    ok.onclick = async function () {
      el.remove();
      try {
        const r = await Auth.withPin('settings', function () {
          return api('students.purge', { citizen_id: cid, confirm: true, recorded_by: 'admin' }, { loadingMsg: 'กำลังลบถาวร...', noRetry: true });
        });
        // สำเนาข้อมูลที่ลบ (หลักฐาน) — ไม่ใช่ไฟล์สำรองทั้งระบบ นำไปกู้คืนผ่านหน้าตั้งค่าไม่ได้
        const blob = new Blob([JSON.stringify(r.record, null, 1)], { type: 'application/json' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = 'deleted_student_' + (s.student_code || cid.slice(-4)) + '_' + Utils.todayYmd() + '.json';
        document.body.appendChild(a); a.click(); setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
        const total = Object.keys(r.deleted).reduce(function (t, k) { return t + r.deleted[k]; }, 0);
        clearDashCache();
        allStudents = allStudents.filter(function (x) { return String(x.citizen_id) !== cid; });
        editingCid = null;
        document.getElementById('profile-panel').classList.add('hidden');
        renderList();
        Toast.show('ลบ ' + r.name + ' ออกจากฐานข้อมูลแล้ว (' + total + ' รายการ)', 'success', 5000);
      } catch (e) { /* api แสดง Toast แล้ว (เช่น ยังมีเงินฝาก) · กดยกเลิก PIN = ไม่ทำอะไร */ }
    };
  };

  /* ════ เพิ่มนักเรียนใหม่ ════ */
  const CREATE_FIELDS = ['citizen_id', 'student_code', 'prefix', 'first_name', 'last_name', 'gender',
    'grade', 'room', 'birth_date', 'blood_type', 'religion', 'nationality', 'guardian_name',
    'guardian_phone', 'address', 'weight_init', 'height_init'];

  document.getElementById('btn-add-student').onclick = function () {
    document.getElementById('create-form').reset();
    document.getElementById('create-modal').classList.add('show');
  };
  document.getElementById('create-cancel').onclick = function () { document.getElementById('create-modal').classList.remove('show'); };

  document.getElementById('create-form').addEventListener('submit', async function (e) {
    e.preventDefault();
    const form = e.target;
    const fields = {};
    CREATE_FIELDS.forEach(function (k) { fields[k] = form[k].value; });
    // เลขประจำตัว: ตัวเลข 13 หลัก หรือ ตัวอักษรอังกฤษ 1 ตัว + ตัวเลข 12 หลัก (รหัส G นักเรียนต่างด้าว)
    fields.citizen_id = String(fields.citizen_id || '').replace(/[\s-]/g, '').toUpperCase();
    if (!/^[0-9A-Z]\d{12}$/.test(fields.citizen_id)) {
      Toast.show('เลขประจำตัวต้องมี 13 หลัก: ตัวเลขทั้งหมด หรือตัวอักษรอังกฤษ 1 ตัว (เช่น G) + ตัวเลข 12 หลัก', 'warning', 6000);
      form.citizen_id.focus();
      return;
    }
    try {
      const d = await api('students.create', { fields: fields, recorded_by: 'admin' }, { loadingMsg: 'กำลังบันทึก...' });
      clearDashCache();
      Toast.show('เพิ่มนักเรียนใหม่สำเร็จ', 'success');
      document.getElementById('create-modal').classList.remove('show');
      allStudents.push(d.student);
      if (d.student.grade) {
        const grades = [];
        allStudents.forEach(function (s) { if (s.grade && grades.indexOf(s.grade) < 0) grades.push(s.grade); });
        grades.sort(function (a, b) { return Utils.gradeSortKey(a) - Utils.gradeSortKey(b); });
        document.getElementById('f-grade').innerHTML = '<option value="">ทุกชั้น</option>' + Utils.options(grades, document.getElementById('f-grade').value);
      }
      renderList();
      openProfile(d.student.citizen_id);
    } catch (err) { /* Toast แสดงแล้ว */ }
  });

  /* ════ ภาพรวม ════ */
  function paintStats(st) {
    document.getElementById('d-total').textContent = Utils.fmtInt(st.total);
    document.getElementById('d-male').textContent = Utils.fmtInt(st.male);
    document.getElementById('d-female').textContent = Utils.fmtInt(st.female);

    // รวมรายชั้น (ยุบห้อง) จาก by_grade ที่เป็น grade/room
    const gradeTotals = {};
    Object.keys(st.by_grade || {}).forEach(function (key) {
      const grade = key.split('/')[0];
      gradeTotals[grade] = (gradeTotals[grade] || 0) + st.by_grade[key];
    });
    const grades = Object.keys(gradeTotals).sort(function (a, b) { return Utils.gradeSortKey(a) - Utils.gradeSortKey(b); });
    drawChart(grades, grades.map(function (g) { return gradeTotals[g]; }));
  }

  async function loadDashboard() {
    try {
      await Store.swr('students:stats',
        function (had) { return api('students.stats', {}, { loadingMsg: 'กำลังโหลด...', loading: !had, silent: had }); },
        paintStats);
    } catch (e) { /* Toast แสดงแล้ว */ }
  }

  function drawChart(labels, data) {
    if (!window.Chart) { LazyLib.chart().then(function () { drawChart(labels, data); }).catch(function () {}); return; }
    const ctx = document.getElementById('d-chart').getContext('2d');
    if (chart) chart.destroy();
    chart = new Chart(ctx, {
      type: 'bar',
      data: { labels: labels, datasets: [{ label: 'จำนวน (คน)', data: data, backgroundColor: '#4FC3F7', borderRadius: 8 }] },
      options: {
        plugins: { legend: { display: false } },
        scales: { y: { beginAtZero: true, ticks: { font: { family: 'Sarabun' }, precision: 0 } }, x: { ticks: { font: { family: 'Sarabun' } } } },
      },
    });
  }

  /* ════ เริ่มต้น ════ */
  loadAll();

})();
