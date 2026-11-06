/**
 * AI Smart Timetable — เฟส 6: ผู้ใช้และสิทธิ์ (โมดูล 12) — เฉพาะผู้ดูแลระบบ
 *   เพิ่ม/แก้ผู้ใช้ · บทบาท 6 ระดับ · ผูกครู (ครู) / ผูกชั้นเรียน (นักเรียน/ผู้ปกครอง) · ตั้งรหัสผ่านใหม่/ปลดล็อก · ปิดใช้งาน
 *   ตั้งค่าการเข้าถึงหน้าดูตาราง (ไม่ต้องเข้าสู่ระบบ / ต้องเข้าสู่ระบบ)
 */
(function () {
  const esc = Utils.esc;
  const host = document.getElementById('tab-users');
  const CAP_LABEL = { view: 'ดูข้อมูล', edit_data: 'แก้ข้อมูลพื้นฐาน', edit_timetable: 'จัด/แก้ตาราง', approve: 'อนุมัติ/เผยแพร่', announce: 'ประกาศ', manage_users: 'จัดการผู้ใช้',
    geo: 'ดูแผนที่บ้านนักเรียน', geo_edit: 'บันทึกพิกัดบ้าน', geo_admin: 'ตั้งพิกัดโรงเรียน',
    acad_admin: 'แก้ผลท่องสูตรคูณภาคก่อน', gb: 'บันทึกคะแนนวิชาที่สอน', gb_admin: 'จัดการคะแนนทุกวิชา', gb_view: 'ดูภาพรวมคะแนน' };
  let users = [];

  function roles() { return TTAuth.roles(); }
  function roleLabel(k) { const r = roles().find(function (x) { return x.key === k; }); return r ? r.label : k; }
  function teacherName(id) { const t = TT.S.teachers.find(function (x) { return x.teacher_id === id; }); return t ? TT.teacherName(t) : ''; }
  function classLabel(id) { const c = TT.S.classes.find(function (x) { return x.class_id === id; }); return c ? TT.classLabel(c) : ''; }

  function shell() {
    host.innerHTML =
      '<div class="card"><div class="flex" style="justify-content:space-between;flex-wrap:wrap;gap:8px;margin-bottom:10px">' +
        '<h3 class="card-title" style="margin:0">👥 ผู้ใช้และสิทธิ์</h3><button class="btn btn-primary" data-add><i class="bi bi-person-plus"></i> เพิ่มผู้ใช้</button></div>' +
        '<div data-list class="text-muted">กำลังโหลด...</div></div>' +
      '<div class="card"><div class="flex" style="justify-content:space-between;flex-wrap:wrap;gap:8px;margin-bottom:10px">' +
        '<h3 class="card-title" style="margin:0">👩‍🏫 บัญชีครูจากตารางสอน</h3><button class="btn btn-primary" data-mk disabled><i class="bi bi-people"></i> สร้างบัญชีให้ครูที่ยังไม่มี</button></div>' +
        '<p class="tt-note" style="margin:0 0 8px">สร้างบัญชีบทบาท "ครู" ผูกกับรายชื่อครูของภาคเรียนปัจจุบัน ใช้เข้า <a href="gradebook.html" target="_blank">บันทึกคะแนน</a> แบบเลือกชื่อ + รหัสผ่าน · รหัสผ่านเริ่มต้นแสดงครั้งเดียว — พิมพ์แจกครูแล้วให้ครูเปลี่ยนเอง</p>' +
        '<div data-tlist class="text-muted">กำลังโหลด...</div></div>' +
      '<div class="card"><h3 class="card-title">🌐 การเข้าถึงหน้าดูตาราง</h3>' +
        '<label class="tt-chip"><input type="checkbox" data-public> เปิดให้ดูตารางที่เผยแพร่แล้วโดยไม่ต้องเข้าสู่ระบบ</label>' +
        '<p class="tt-note" style="margin:8px 0 0">หน้า <a href="timetable-view.html" target="_blank">ดูตารางเรียน / ตารางสอน</a> แสดงเฉพาะฉบับที่ "เผยแพร่แล้ว" (รายห้อง/รายครู — ไม่มีข้อมูลส่วนบุคคลของนักเรียน) · ถ้าปิด ต้องเข้าสู่ระบบด้วยบัญชีใดก็ได้ก่อน</p></div>' +
      '<div class="card"><h3 class="card-title">🛡️ สิทธิ์ของแต่ละบทบาท</h3><div data-matrix></div></div>';
    host.querySelector('[data-add]').onclick = function () { edit(null); };
    host.querySelector('[data-mk]').onclick = createTeacherAccounts;
    host.querySelector('[data-public]').onchange = async function () {
      const cb = this;
      try {
        const r = await api('tt.constraints_save', { config: { public_view: cb.checked } }, { loadingMsg: 'กำลังบันทึก...', noRetry: true });
        TT.S.config = r.config;
        Toast.show(cb.checked ? 'เปิดให้ดูตารางโดยไม่ต้องเข้าสู่ระบบแล้ว' : 'หน้าดูตารางต้องเข้าสู่ระบบแล้ว', 'success');
      } catch (e) { cb.checked = !cb.checked; }
    };
  }

  function renderMatrix() {
    const caps = Object.keys(CAP_LABEL);
    host.querySelector('[data-matrix]').innerHTML = '<div class="table-wrap"><table class="tt-results"><thead><tr><th>บทบาท</th>' +
      caps.map(function (c) { return '<th style="text-align:center">' + CAP_LABEL[c] + '</th>'; }).join('') + '</tr></thead><tbody>' +
      roles().map(function (r) {
        return '<tr><td><strong>' + esc(r.label) + '</strong></td>' + caps.map(function (c) { return '<td style="text-align:center">' + (r.caps.indexOf(c) >= 0 ? '✅' : '—') + '</td>'; }).join('') + '</tr>';
      }).join('') + '</tbody></table></div>' +
      '<p class="tt-note" style="margin:8px 0 0">ครู/นักเรียน/ผู้ปกครองดูตารางที่เผยแพร่แล้วได้ที่หน้าดูตาราง — บัญชีที่ผูกครู/ชั้นเรียนไว้จะเปิดตารางของตัวเองให้อัตโนมัติ</p>';
  }

  async function load() {
    try {
      const r = await api('tt.users_list', {}, { loadingMsg: 'กำลังโหลดผู้ใช้...' });
      users = r.users;
      host.querySelector('[data-public]').checked = !TT.S.config || TT.S.config.public_view !== false;
      renderList();
      renderMatrix();
      loadTeachers();
    } catch (e) { host.querySelector('[data-list]').innerHTML = '<div class="alert alert-danger">' + esc(e.message) + '</div>'; }
  }

  /* ── บัญชีครูจากตารางสอน ── */
  let tAcc = [];
  async function loadTeachers() {
    const box = host.querySelector('[data-tlist]'), btn = host.querySelector('[data-mk]');
    try {
      const r = await api('tt.teacher_accounts', {}, { loading: false });
      tAcc = r.teachers;
      const missing = tAcc.filter(function (t) { return !t.user; }).length;
      btn.disabled = !missing;
      btn.innerHTML = '<i class="bi bi-people"></i> ' + (missing ? 'สร้างบัญชีให้ครูที่ยังไม่มี (' + missing + ' คน)' : 'ครูทุกคนมีบัญชีแล้ว');
      box.innerHTML = !tAcc.length ? '<div class="alert alert-info">ยังไม่มีรายชื่อครูในภาคเรียน ' + esc(r.term) + ' — เพิ่มครูในแท็บข้อมูลพื้นฐานก่อน</div>' :
        '<div class="table-wrap"><table class="tt-results"><thead><tr><th>ครู (ภาค ' + esc(r.term) + ')</th><th>รหัสครู</th><th>บัญชี</th></tr></thead><tbody>' +
        tAcc.map(function (t) {
          return '<tr><td data-no-i18n>' + esc(t.name) + '</td><td>' + esc(t.code || '-') + '</td><td>' +
            (t.user ? '<span class="badge badge-pass">' + esc(t.user.username) + '</span>' + (t.user.active ? '' : ' <span class="tt-note">(ปิดใช้งาน)</span>') + (t.user.current ? '' : ' <span class="tt-note">(ผูกครูภาคก่อน — จะผูกภาคนี้ให้เมื่อกดสร้าง)</span>')
              : '<span class="tt-note">ยังไม่มี</span>') + '</td></tr>';
        }).join('') + '</tbody></table></div>';
      if (tAcc.some(function (t) { return t.user && !t.user.current; })) { btn.disabled = false; if (!missing) btn.innerHTML = '<i class="bi bi-link-45deg"></i> ผูกบัญชีกับครูภาคนี้'; }
    } catch (e) { box.innerHTML = '<div class="alert alert-danger">' + esc(e.message) + '</div>'; }
  }

  async function createTeacherAccounts() {
    const todo = tAcc.filter(function (t) { return !t.user || !t.user.current; });
    if (!todo.length) return;
    const nNew = todo.filter(function (t) { return !t.user; }).length;
    if (!confirm((nNew ? 'สร้างบัญชีครูใหม่ ' + nNew + ' คน' : 'ผูกบัญชีเดิมกับครูภาคนี้') + '?\n\nรหัสผ่านเริ่มต้นจะแสดงครั้งเดียวหลังสร้างเสร็จ — เตรียมพิมพ์หรือจดไว้')) return;
    const made = [], failed = [];
    for (let i = 0; i < todo.length; i++) {
      Loading.show('กำลังสร้างบัญชี ' + (i + 1) + '/' + todo.length + '...');
      try {
        const r = await api('tt.user_create_teacher', { teacher_id: todo[i].teacher_id }, { silent: true, loading: false, noRetry: true });
        if (!r.existed) made.push({ name: r.display_name, username: r.username, password: r.password });
      } catch (e) { failed.push(todo[i].name + ': ' + e.message); }
    }
    Loading.hide();
    if (failed.length) Toast.show('สร้างไม่สำเร็จ ' + failed.length + ' คน: ' + failed.join(' · '), 'error');
    if (made.length) showCredentials(made);
    else Toast.show('ผูกบัญชีกับครูภาคนี้แล้ว', 'success');
    load();
  }

  function showCredentials(rows) {
    const table = '<table class="tt-results" style="width:100%"><thead><tr><th>ครู</th><th>ชื่อผู้ใช้</th><th>รหัสผ่านเริ่มต้น</th></tr></thead><tbody>' +
      rows.map(function (r) { return '<tr><td>' + esc(r.name) + '</td><td><code>' + esc(r.username) + '</code></td><td><code style="font-size:16px">' + esc(r.password) + '</code></td></tr>'; }).join('') + '</tbody></table>';
    const el = document.createElement('div');
    el.className = 'modal-backdrop show';
    el.innerHTML = '<div class="modal wide"><h3 class="modal-title">🔑 บัญชีครูที่สร้างใหม่ (' + rows.length + ' คน)</h3>' +
      '<div class="alert alert-warning" style="font-size:14px">รหัสผ่านจะแสดง <strong>ครั้งนี้ครั้งเดียว</strong> — พิมพ์หรือจดแจกครู แล้วให้ครูเปลี่ยนรหัสเองหลังเข้าสู่ระบบ (เมนูชื่อผู้ใช้ › เปลี่ยนรหัสผ่าน)</div>' +
      '<div class="table-wrap">' + table + '</div>' +
      '<div class="flex" style="justify-content:flex-end;gap:8px;margin-top:12px"><button class="btn btn-secondary" data-print><i class="bi bi-printer"></i> พิมพ์</button><button class="btn btn-primary" data-close>เก็บแล้ว ปิด</button></div></div>';
    document.body.appendChild(el);
    el.querySelector('[data-close]').onclick = function () { if (confirm('ปิดแล้วจะดูรหัสผ่านเหล่านี้ไม่ได้อีก — พิมพ์/จดแล้วใช่ไหม?')) el.remove(); };
    el.querySelector('[data-print]').onclick = function () {
      const w = window.open('', '_blank');
      if (!w) { Toast.show('เบราว์เซอร์บล็อกหน้าต่างพิมพ์', 'error'); return; }
      w.document.write('<!doctype html><meta charset="utf-8"><title>บัญชีครู</title><style>body{font-family:sans-serif;padding:20px}table{border-collapse:collapse;width:100%}td,th{border:1px solid #999;padding:10px;text-align:left}code{font-size:16px}</style>' +
        '<h2>บัญชีเข้าระบบบันทึกคะแนน — โรงเรียนบ้านใหม่</h2><p>เข้าที่เมนู วิชาการ › บันทึกคะแนน → เลือกชื่อ → ใส่รหัสผ่าน แล้วเปลี่ยนรหัสผ่านทันที</p>' + table);
      w.document.close(); w.focus(); w.print();
    };
  }

  function renderList() {
    const me = TTAuth.user();
    host.querySelector('[data-list]').innerHTML = '<div class="table-wrap"><table class="tt-results"><thead><tr><th>ชื่อผู้ใช้</th><th>ชื่อที่แสดง</th><th>บทบาท</th><th>ผูกกับ</th><th>สถานะ</th><th>เข้าใช้ล่าสุด</th><th></th></tr></thead><tbody>' +
      users.map(function (u, i) {
        const link = u.teacher_id ? '👩‍🏫 ' + esc(teacherName(u.teacher_id)) : u.class_id ? '🎒 ' + esc(classLabel(u.class_id)) : '-';
        const st = !u.active ? '<span class="badge" style="background:#ECEFF1;color:#607D8B">ปิดใช้งาน</span>' : u.locked ? '<span class="badge badge-fail">ถูกล็อก</span>' : '<span class="badge badge-pass">ใช้งาน</span>';
        return '<tr' + (u.active ? '' : ' style="opacity:.6"') + '><td data-no-i18n><strong>' + esc(u.username) + '</strong>' + (me && me.user_id === u.user_id ? ' <span class="tt-pill">คุณ</span>' : '') + '</td>' +
          '<td data-no-i18n>' + esc(u.display_name) + '</td><td>' + esc(u.role_label) + '</td><td>' + link + '</td><td>' + st + '</td>' +
          '<td class="tt-note">' + (u.last_login ? esc(Utils.fmtDateTime(u.last_login)) : '-') + '</td>' +
          '<td class="tt-actions"><button class="btn btn-secondary" data-e="' + i + '" title="แก้ไข"><i class="bi bi-pencil"></i></button>' +
          '<button class="btn btn-secondary" data-p="' + i + '" title="ตั้งรหัสผ่านใหม่"><i class="bi bi-key"></i></button></td></tr>';
      }).join('') + '</tbody></table></div>';
    host.querySelectorAll('[data-e]').forEach(function (b) { b.onclick = function () { edit(users[Number(b.dataset.e)]); }; });
    host.querySelectorAll('[data-p]').forEach(function (b) { b.onclick = function () { resetPassword(users[Number(b.dataset.p)]); }; });
  }

  function modal(title, body, onOk) {
    const el = document.createElement('div');
    el.className = 'modal-backdrop show';
    el.innerHTML = '<div class="modal wide"><h3 class="modal-title">' + title + '</h3><form data-form>' + body +
      '<div class="alert alert-danger hidden" data-err style="margin-top:10px"></div>' +
      '<div class="flex" style="justify-content:flex-end;gap:8px;margin-top:12px"><button type="button" class="btn btn-secondary" data-cancel>ยกเลิก</button>' +
      '<button class="btn btn-primary" type="submit"><i class="bi bi-save"></i> บันทึก</button></div></form></div>';
    document.body.appendChild(el);
    const f = el.querySelector('[data-form]');
    el.querySelector('[data-cancel]').onclick = function () { el.remove(); };
    f.onsubmit = async function (e) {
      e.preventDefault();
      const err = el.querySelector('[data-err]');
      try { await onOk(f); el.remove(); } catch (x) { err.textContent = x.message; err.classList.remove('hidden'); }
    };
    return f;
  }

  function edit(u) {
    const opt = function (list, cur) { return list.map(function (o) { return '<option value="' + esc(o[0]) + '"' + (o[0] === cur ? ' selected' : '') + '>' + esc(o[1]) + '</option>'; }).join(''); };
    const f = modal(u ? '✏️ แก้ไขผู้ใช้' : '➕ เพิ่มผู้ใช้',
      '<div class="tt-form">' +
        '<div><label>ชื่อผู้ใช้</label><input class="form-control" name="username" autocapitalize="none" autocomplete="off" placeholder="a-z 0-9 . _ -" required value="' + esc(u ? u.username : '') + '"></div>' +
        '<div><label>ชื่อที่แสดง</label><input class="form-control" name="display_name" required value="' + esc(u ? u.display_name : '') + '"></div>' +
        '<div><label>บทบาท</label><select class="form-control" name="role">' + opt(roles().map(function (r) { return [r.key, r.label]; }), u ? u.role : 'teacher') + '</select></div>' +
        '<div data-link-t><label>ผูกกับครู</label><select class="form-control" name="teacher_id"><option value="">-</option>' + opt(TT.S.teachers.map(function (t) { return [t.teacher_id, TT.teacherName(t)]; }), u ? u.teacher_id : '') + '</select></div>' +
        '<div data-link-c><label>ผูกกับชั้นเรียน</label><select class="form-control" name="class_id"><option value="">-</option>' + opt(TT.S.classes.map(function (c) { return [c.class_id, TT.classLabel(c)]; }), u ? u.class_id : '') + '</select></div>' +
        (u ? '<div><label class="tt-chip" style="margin-top:26px"><input type="checkbox" name="active"' + (u.active ? ' checked' : '') + '> ใช้งาน</label></div>'
          : '<div><label>รหัสผ่าน</label><input class="form-control" name="password" type="password" autocomplete="new-password" placeholder="อย่างน้อย 8 ตัวอักษร" required></div>') +
      '</div><p class="tt-note" style="margin:8px 0 0">เปลี่ยนบทบาทหรือปิดใช้งาน = ผู้ใช้นั้นถูกออกจากระบบทันที</p>',
      async function (f) {
        await api('tt.user_save', {
          user_id: u ? u.user_id : undefined, username: f.username.value, display_name: f.display_name.value, role: f.role.value,
          teacher_id: f.role.value === 'teacher' ? f.teacher_id.value : '', class_id: (f.role.value === 'student' || f.role.value === 'parent') ? f.class_id.value : '',
          active: u ? f.active.checked : true, password: u ? undefined : f.password.value,
        }, { silent: true, loadingMsg: 'กำลังบันทึก...', noRetry: true });
        Toast.show('บันทึกผู้ใช้แล้ว', 'success');
        load();
      });
    const sync = function () {
      const r = f.role.value;
      f.querySelector('[data-link-t]').classList.toggle('hidden', r !== 'teacher');
      f.querySelector('[data-link-c]').classList.toggle('hidden', r !== 'student' && r !== 'parent');
    };
    f.role.onchange = sync;
    sync();
  }

  function resetPassword(u) {
    modal('🔑 ตั้งรหัสผ่านใหม่ · ' + esc(u.username),
      '<label>รหัสผ่านใหม่</label><input class="form-control" name="pw" type="password" autocomplete="new-password" placeholder="อย่างน้อย 8 ตัวอักษร" required>' +
      '<label style="margin-top:8px">ยืนยันรหัสผ่านใหม่</label><input class="form-control" name="pw2" type="password" autocomplete="new-password" required>' +
      '<p class="tt-note" style="margin:8px 0 0">ปลดล็อกบัญชีด้วย · ผู้ใช้นี้จะถูกออกจากระบบทุกเครื่อง แจ้งรหัสใหม่ให้ผู้ใช้ด้วยตัวเอง</p>',
      async function (f) {
        if (f.pw.value !== f.pw2.value) throw new Error('รหัสผ่านไม่ตรงกัน');
        await api('tt.user_reset_password', { user_id: u.user_id, password: f.pw.value }, { silent: true, loadingMsg: 'กำลังบันทึก...', noRetry: true });
        Toast.show('ตั้งรหัสผ่านใหม่แล้ว', 'success');
        load();
      });
  }

  document.querySelectorAll('#tt-tabs .tab').forEach(function (t) {
    t.addEventListener('click', function () {
      if (t.dataset.tab !== 'users') return;
      if (!host.querySelector('[data-list]')) shell();
      load();
    });
  });
})();
