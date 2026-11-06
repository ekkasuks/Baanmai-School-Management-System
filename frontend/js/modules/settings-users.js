/**
 * ตั้งค่าระบบ › ผู้ใช้ — จัดการบัญชีบุคลากร (ย้ายมาจาก ตารางสอน › ผู้ใช้) · ต้องเข้าสู่ระบบด้วยบัญชีที่มีสิทธิ์ manage_users (ผู้ดูแลระบบ)
 *   เพิ่ม/แก้ผู้ใช้ · ตั้งรหัสผ่านใหม่/ปลดล็อก · สร้างบัญชีครูจากตารางสอน · ครูประจำชั้น (STAFF_HOMEROOM — ชั้นเริ่มต้นของหน้าบันทึก ไม่จำกัดสิทธิ์)
 * ใช้ js/tt-session.js (TTAuth) — แยกจาก PIN ของแท็บอื่นในหน้านี้
 */
(function () {
  const esc = Utils.esc;
  const host = document.getElementById('tab-users');
  if (!host) return;
  const CAP_LABEL = { view: 'ดูข้อมูล', edit_data: 'แก้ข้อมูลตารางสอน', edit_timetable: 'จัด/แก้ตาราง', approve: 'อนุมัติ/เผยแพร่', announce: 'ประกาศ', manage_users: 'จัดการผู้ใช้',
    geo: 'ดูแผนที่บ้าน', geo_edit: 'บันทึกพิกัดบ้าน', geo_admin: 'ตั้งพิกัดโรงเรียน',
    acad_admin: 'แก้ผลท่องสูตรคูณภาคก่อน', gb: 'บันทึกคะแนนวิชาที่สอน', gb_admin: 'จัดการคะแนนทุกวิชา', gb_view: 'ดูภาพรวมคะแนน' };
  let users = [], A = null, tAcc = [], started = false;

  function roles() { return TTAuth.roles(); }
  function classLabel(c) { return c.grade + (c.room ? '/' + c.room : ''); }
  function hrOf(uid) { return A ? A.homerooms.filter(function (h) { return h.user_id === uid; }) : []; }
  function teacherName(id) { const t = A && A.teachers.find(function (x) { return x.teacher_id === id; }); return t ? t.name : ''; }
  function ttClassLabel(id) { const c = A && A.tt_classes.find(function (x) { return x.class_id === id; }); return c ? c.label : ''; }

  async function start() {
    if (started) { load(); return; }
    started = true;
    host.innerHTML = '<div class="card text-muted">กำลังตรวจสอบผู้ใช้...</div>';
    const u = await TTAuth.require({});
    if (!TTAuth.can('manage_users')) {
      host.innerHTML = '<div class="card"><div class="alert alert-warning" style="margin:0">แท็บนี้ใช้ได้เฉพาะบัญชี <strong>ผู้ดูแลระบบ</strong> — ตอนนี้เข้าสู่ระบบในชื่อ ' + esc(u.display_name) + ' (' + esc(u.role_label) + ')</div>' +
        '<button class="btn btn-secondary" data-out style="margin-top:10px"><i class="bi bi-box-arrow-right"></i> ออกจากระบบเพื่อเข้าด้วยบัญชีอื่น</button></div>';
      host.querySelector('[data-out]').onclick = function () { TTAuth.logout(); };
      return;
    }
    shell(u);
    load();
  }

  function shell(me) {
    host.innerHTML =
      '<div class="su-who"><span>👤 เข้าสู่ระบบในชื่อ <strong data-no-i18n>' + esc(me.display_name) + '</strong> · ' + esc(me.role_label) + '</span><button class="btn btn-secondary btn-sm" data-out><i class="bi bi-box-arrow-right"></i> ออกจากระบบ</button></div>' +
      '<div class="card"><div class="su-head"><h3 class="card-title" style="margin:0">👥 ผู้ใช้และสิทธิ์</h3><button class="btn btn-primary" data-add><i class="bi bi-person-plus"></i> เพิ่มผู้ใช้</button></div>' +
        '<div data-list class="text-muted">กำลังโหลด...</div></div>' +
      '<div class="card"><div class="su-head"><h3 class="card-title" style="margin:0">🏫 ครูประจำชั้น</h3><button class="btn btn-secondary" data-import><i class="bi bi-download"></i> ดึงจากตารางสอน</button></div>' +
        '<p class="su-note">ใช้เป็น <strong>ชั้นเริ่มต้น</strong> ของหน้าบันทึกข้อมูล (เช็คชื่อ พฤติกรรม สุขภาพ ฯลฯ) — ไม่จำกัดสิทธิ์ ครูบันทึกชั้นอื่นได้ตามปกติ · ครู 1 คนเป็นครูประจำชั้นได้หลายชั้น และชั้นหนึ่งมีได้หลายคน · กำหนดได้ที่ปุ่ม 🏫 ในตารางผู้ใช้</p>' +
        '<div data-hr class="text-muted">กำลังโหลด...</div></div>' +
      '<div class="card"><div class="su-head"><h3 class="card-title" style="margin:0">👩‍🏫 บัญชีครูจากตารางสอน</h3><button class="btn btn-primary" data-mk disabled><i class="bi bi-people"></i> สร้างบัญชีให้ครูที่ยังไม่มี</button></div>' +
        '<p class="su-note">สร้างบัญชีบทบาท "ครู" ผูกกับรายชื่อครูของภาคเรียนปัจจุบัน · ครูเข้าสู่ระบบแบบเลือกชื่อ + รหัสผ่าน · รหัสผ่านเริ่มต้นแสดงครั้งเดียว — พิมพ์แจกครูแล้วให้ครูเปลี่ยนเอง</p>' +
        '<div data-tlist class="text-muted">กำลังโหลด...</div></div>' +
      '<div class="card"><h3 class="card-title">🛡️ สิทธิ์ของแต่ละบทบาท</h3><div data-matrix></div></div>';
    host.querySelector('[data-out]').onclick = function () { TTAuth.logout(); };
    host.querySelector('[data-add]').onclick = function () { edit(null); };
    host.querySelector('[data-mk]').onclick = createTeacherAccounts;
    host.querySelector('[data-import]').onclick = importHomeroom;
  }

  async function load() {
    try {
      const [r, a] = await Promise.all([api('tt.users_list', {}, { loadingMsg: 'กำลังโหลดผู้ใช้...' }), api('tt.staff_admin_data', {}, { loading: false })]);
      users = r.users; A = a;
      renderList(); renderHomerooms(); renderMatrix();
      loadTeachers();
    } catch (e) { host.querySelector('[data-list]').innerHTML = '<div class="alert alert-danger">' + esc(e.message) + '</div>'; }
  }

  function renderMatrix() {
    const caps = Object.keys(CAP_LABEL);
    host.querySelector('[data-matrix]').innerHTML = '<div class="table-wrap"><table class="su-table"><thead><tr><th>บทบาท</th>' +
      caps.map(function (c) { return '<th style="text-align:center">' + CAP_LABEL[c] + '</th>'; }).join('') + '</tr></thead><tbody>' +
      roles().map(function (r) { return '<tr><td><strong>' + esc(r.label) + '</strong></td>' + caps.map(function (c) { return '<td style="text-align:center">' + (r.caps.indexOf(c) >= 0 ? '✅' : '—') + '</td>'; }).join('') + '</tr>'; }).join('') +
      '</tbody></table></div>';
  }

  function renderList() {
    const me = TTAuth.user();
    host.querySelector('[data-list]').innerHTML = '<div class="table-wrap"><table class="su-table"><thead><tr><th>ชื่อผู้ใช้</th><th>ชื่อที่แสดง</th><th>บทบาท</th><th>ครูประจำชั้น</th><th>ผูกกับ</th><th>สถานะ</th><th>เข้าใช้ล่าสุด</th><th></th></tr></thead><tbody>' +
      users.map(function (u, i) {
        const link = u.teacher_id ? '👩‍🏫 ' + esc(teacherName(u.teacher_id) || '(ครูภาคก่อน)') : u.class_id ? '🎒 ' + esc(ttClassLabel(u.class_id)) : '-';
        const st = !u.active ? '<span class="su-badge off">ปิดใช้งาน</span>' : u.locked ? '<span class="su-badge bad">ถูกล็อก</span>' : '<span class="su-badge ok">ใช้งาน</span>';
        const hr = hrOf(u.user_id).map(function (h) { return '<span class="su-chip">' + esc(classLabel(h)) + '</span>'; }).join(' ');
        const canHr = ['admin', 'academic', 'teacher'].indexOf(u.role) >= 0;
        return '<tr' + (u.active ? '' : ' style="opacity:.6"') + '><td data-no-i18n><strong>' + esc(u.username) + '</strong>' + (me && me.user_id === u.user_id ? ' <span class="su-chip">คุณ</span>' : '') + '</td>' +
          '<td data-no-i18n>' + esc(u.display_name) + '</td><td>' + esc(u.role_label) + '</td><td>' + (hr || (canHr ? '<span class="su-note">-</span>' : '')) + '</td><td>' + link + '</td><td>' + st + '</td>' +
          '<td class="su-note">' + (u.last_login ? esc(Utils.fmtDateTime(u.last_login)) : '-') + '</td>' +
          '<td class="su-actions"><button class="btn btn-secondary" data-e="' + i + '" title="แก้ไข"><i class="bi bi-pencil"></i></button>' +
          (canHr ? '<button class="btn btn-secondary" data-h="' + i + '" title="ครูประจำชั้น">🏫</button>' : '') +
          '<button class="btn btn-secondary" data-p="' + i + '" title="ตั้งรหัสผ่านใหม่"><i class="bi bi-key"></i></button></td></tr>';
      }).join('') + '</tbody></table></div>';
    host.querySelectorAll('[data-e]').forEach(function (b) { b.onclick = function () { edit(users[Number(b.dataset.e)]); }; });
    host.querySelectorAll('[data-h]').forEach(function (b) { b.onclick = function () { editHomeroom(users[Number(b.dataset.h)]); }; });
    host.querySelectorAll('[data-p]').forEach(function (b) { b.onclick = function () { resetPassword(users[Number(b.dataset.p)]); }; });
  }

  /* ── ครูประจำชั้น ── */
  function renderHomerooms() {
    const name = function (uid) { const u = users.find(function (x) { return x.user_id === uid; }); return u ? u.display_name : '(บัญชีถูกลบ)'; };
    host.querySelector('[data-hr]').innerHTML = !A.classes.length ? '<div class="alert alert-info" style="margin:0">ยังไม่มีข้อมูลนักเรียน</div>' :
      '<div class="table-wrap"><table class="su-table"><thead><tr><th>ชั้น</th><th>นักเรียน</th><th>ครูประจำชั้น</th></tr></thead><tbody>' +
      A.classes.map(function (c) {
        const hs = A.homerooms.filter(function (h) { return h.grade === c.grade && h.room === c.room; });
        return '<tr><td><strong>' + esc(classLabel(c)) + '</strong></td><td>' + c.count + '</td><td>' +
          (hs.length ? hs.map(function (h) { return '<span class="su-chip" data-no-i18n>' + esc(name(h.user_id)) + '</span>'; }).join(' ') : '<span class="su-note">ยังไม่กำหนด</span>') + '</td></tr>';
      }).join('') + '</tbody></table></div>';
  }
  function editHomeroom(u) {
    const cur = hrOf(u.user_id).map(function (h) { return h.grade + '|' + h.room; });
    modal('🏫 ครูประจำชั้น · ' + esc(u.display_name),
      '<p class="su-note" style="margin-top:0">เลือกชั้นที่บัญชีนี้เป็นครูประจำชั้น (เลือกได้หลายชั้น) — หน้าบันทึกจะเปิดชั้นแรกเป็นค่าเริ่มต้น</p>' +
      '<div class="su-classes">' + A.classes.map(function (c) {
        const k = c.grade + '|' + c.room;
        return '<label class="su-check"><input type="checkbox" name="c" value="' + esc(k) + '"' + (cur.indexOf(k) >= 0 ? ' checked' : '') + '> ' + esc(classLabel(c)) + ' <span class="su-note">(' + c.count + ')</span></label>';
      }).join('') + '</div>',
      async function (f) {
        const classes = Array.prototype.filter.call(f.querySelectorAll('input[name=c]'), function (x) { return x.checked; })
          .map(function (x) { const ix = x.value.indexOf('|'); return { grade: x.value.slice(0, ix), room: x.value.slice(ix + 1) }; });
        await api('tt.homeroom_save', { user_id: u.user_id, classes: classes }, { silent: true, loadingMsg: 'กำลังบันทึก...', noRetry: true });
        Toast.show(classes.length ? 'กำหนดครูประจำชั้นแล้ว' : 'ยกเลิกการเป็นครูประจำชั้นแล้ว', 'success');
        load();
      });
  }
  async function importHomeroom() {
    if (!confirm('ดึงครูประจำชั้นจากตารางสอนภาคเรียนปัจจุบัน?\n(เพิ่มอย่างเดียว ไม่ลบที่กำหนดไว้แล้ว · ครูต้องมีบัญชีที่ผูกกับรายชื่อครูก่อน)')) return;
    try {
      const r = await api('tt.homeroom_import', {}, { loadingMsg: 'กำลังดึงข้อมูล...', noRetry: true });
      Toast.show('เพิ่มครูประจำชั้น ' + r.added + ' รายการ' + (r.skipped.length ? ' · ข้าม: ' + r.skipped.join(', ') : ''), r.skipped.length ? 'warning' : 'success', 7000);
      load();
    } catch (e) { }
  }

  /* ── บัญชีครูจากตารางสอน ── */
  async function loadTeachers() {
    const box = host.querySelector('[data-tlist]'), btn = host.querySelector('[data-mk]');
    try {
      const r = await api('tt.teacher_accounts', {}, { loading: false });
      tAcc = r.teachers;
      const missing = tAcc.filter(function (t) { return !t.user; }).length;
      btn.disabled = !missing;
      btn.innerHTML = '<i class="bi bi-people"></i> ' + (missing ? 'สร้างบัญชีให้ครูที่ยังไม่มี (' + missing + ' คน)' : 'ครูทุกคนมีบัญชีแล้ว');
      box.innerHTML = !tAcc.length ? '<div class="alert alert-info" style="margin:0">ยังไม่มีรายชื่อครูในภาคเรียน ' + esc(r.term) + ' — เพิ่มครูใน ตารางสอน › ข้อมูลพื้นฐาน ก่อน</div>' :
        '<div class="table-wrap"><table class="su-table"><thead><tr><th>ครู (ภาค ' + esc(r.term) + ')</th><th>รหัสครู</th><th>บัญชี</th></tr></thead><tbody>' +
        tAcc.map(function (t) {
          return '<tr><td data-no-i18n>' + esc(t.name) + '</td><td>' + esc(t.code || '-') + '</td><td>' +
            (t.user ? '<span class="su-badge ok">' + esc(t.user.username) + '</span>' + (t.user.active ? '' : ' <span class="su-note">(ปิดใช้งาน)</span>') + (t.user.current ? '' : ' <span class="su-note">(ผูกครูภาคก่อน — จะผูกภาคนี้ให้เมื่อกดสร้าง)</span>')
              : '<span class="su-note">ยังไม่มี</span>') + '</td></tr>';
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
    if (failed.length) Toast.show('สร้างไม่สำเร็จ ' + failed.length + ' คน: ' + failed.join(' · '), 'danger', 8000);
    if (made.length) showCredentials(made);
    else Toast.show('ผูกบัญชีกับครูภาคนี้แล้ว', 'success');
    load();
  }

  function showCredentials(rows) {
    const table = '<table class="su-table" style="width:100%"><thead><tr><th>ครู</th><th>ชื่อผู้ใช้</th><th>รหัสผ่านเริ่มต้น</th></tr></thead><tbody>' +
      rows.map(function (r) { return '<tr><td>' + esc(r.name) + '</td><td><code>' + esc(r.username) + '</code></td><td><code style="font-size:16px">' + esc(r.password) + '</code></td></tr>'; }).join('') + '</tbody></table>';
    const el = document.createElement('div');
    el.className = 'modal-backdrop show';
    el.innerHTML = '<div class="modal su-modal"><h3 class="modal-title">🔑 บัญชีครูที่สร้างใหม่ (' + rows.length + ' คน)</h3>' +
      '<div class="alert alert-warning" style="font-size:14px">รหัสผ่านจะแสดง <strong>ครั้งนี้ครั้งเดียว</strong> — พิมพ์หรือจดแจกครู แล้วให้ครูเปลี่ยนรหัสเองหลังเข้าสู่ระบบ (เมนูชื่อผู้ใช้ › เปลี่ยนรหัสผ่าน)</div>' +
      '<div class="table-wrap">' + table + '</div>' +
      '<div class="su-foot"><button class="btn btn-secondary" data-print><i class="bi bi-printer"></i> พิมพ์</button><button class="btn btn-primary" data-close>เก็บแล้ว ปิด</button></div></div>';
    document.body.appendChild(el);
    el.querySelector('[data-close]').onclick = function () { if (confirm('ปิดแล้วจะดูรหัสผ่านเหล่านี้ไม่ได้อีก — พิมพ์/จดแล้วใช่ไหม?')) el.remove(); };
    el.querySelector('[data-print]').onclick = function () {
      const w = window.open('', '_blank');
      if (!w) { Toast.show('เบราว์เซอร์บล็อกหน้าต่างพิมพ์', 'danger'); return; }
      w.document.write('<!doctype html><meta charset="utf-8"><title>บัญชีครู</title><style>body{font-family:sans-serif;padding:20px}table{border-collapse:collapse;width:100%}td,th{border:1px solid #999;padding:10px;text-align:left}code{font-size:16px}</style>' +
        '<h2>บัญชีเข้าระบบ — โรงเรียนบ้านใหม่</h2><p>เลือกชื่อตัวเองในหน้าเข้าสู่ระบบ → ใส่รหัสผ่าน แล้วเปลี่ยนรหัสผ่านทันที (เมนูชื่อผู้ใช้ › เปลี่ยนรหัสผ่าน)</p>' + table);
      w.document.close(); w.focus(); w.print();
    };
  }

  function modal(title, body, onOk) {
    const el = document.createElement('div');
    el.className = 'modal-backdrop show';
    el.innerHTML = '<div class="modal su-modal"><h3 class="modal-title">' + title + '</h3><form data-form>' + body +
      '<div class="alert alert-danger hidden" data-err style="margin-top:10px"></div>' +
      '<div class="su-foot"><button type="button" class="btn btn-secondary" data-cancel>ยกเลิก</button>' +
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
      '<div class="su-form">' +
        '<div><label>ชื่อผู้ใช้</label><input class="form-control" name="username" autocapitalize="none" autocomplete="off" placeholder="a-z 0-9 . _ -" required value="' + esc(u ? u.username : '') + '"></div>' +
        '<div><label>ชื่อที่แสดง</label><input class="form-control" name="display_name" required value="' + esc(u ? u.display_name : '') + '"></div>' +
        '<div><label>บทบาท</label><select class="form-control" name="role">' + opt(roles().map(function (r) { return [r.key, r.label]; }), u ? u.role : 'teacher') + '</select></div>' +
        '<div data-link-t><label>ผูกกับครู (ภาค ' + esc(A.term) + ')</label><select class="form-control" name="teacher_id"><option value="">-</option>' + opt(A.teachers.map(function (t) { return [t.teacher_id, t.name]; }), u ? u.teacher_id : '') + '</select></div>' +
        '<div data-link-c><label>ผูกกับชั้นเรียน</label><select class="form-control" name="class_id"><option value="">-</option>' + opt(A.tt_classes.map(function (c) { return [c.class_id, c.label]; }), u ? u.class_id : '') + '</select></div>' +
        (u ? '<div><label class="su-check" style="margin-top:26px"><input type="checkbox" name="active"' + (u.active ? ' checked' : '') + '> ใช้งาน</label></div>'
          : '<div><label>รหัสผ่าน</label><input class="form-control" name="password" type="password" autocomplete="new-password" placeholder="อย่างน้อย 8 ตัวอักษร" required></div>') +
      '</div><p class="su-note" style="margin:8px 0 0">เปลี่ยนบทบาทหรือปิดใช้งาน = ผู้ใช้นั้นถูกออกจากระบบทันที</p>',
      async function (f) {
        await api('tt.user_save', {
          user_id: u ? u.user_id : undefined, username: f.username.value, display_name: f.display_name.value, role: f.role.value,
          teacher_id: f.role.value === 'teacher' ? f.teacher_id.value : '', class_id: (f.role.value === 'student' || f.role.value === 'parent') ? f.class_id.value : '',
          active: u ? f.active.checked : true, password: u ? undefined : f.password.value,
        }, { silent: true, loadingMsg: 'กำลังบันทึก...', noRetry: true });
        Toast.show('บันทึกผู้ใช้แล้ว', 'success');
        load();
      });
    // คงค่าผูกครูภาคก่อนไว้ (ไม่อยู่ในรายการภาคนี้)
    if (u && u.teacher_id && !A.teachers.some(function (t) { return t.teacher_id === u.teacher_id; })) {
      f.teacher_id.insertAdjacentHTML('beforeend', '<option value="' + esc(u.teacher_id) + '" selected>(ครูภาคก่อน — คงไว้)</option>');
    }
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
      '<p class="su-note" style="margin:8px 0 0">ปลดล็อกบัญชีด้วย · ผู้ใช้นี้จะถูกออกจากระบบทุกเครื่อง แจ้งรหัสใหม่ให้ผู้ใช้ด้วยตัวเอง</p>',
      async function (f) {
        if (f.pw.value !== f.pw2.value) throw new Error('รหัสผ่านไม่ตรงกัน');
        await api('tt.user_reset_password', { user_id: u.user_id, password: f.pw.value }, { silent: true, loadingMsg: 'กำลังบันทึก...', noRetry: true });
        Toast.show('ตั้งรหัสผ่านใหม่แล้ว', 'success');
        load();
      });
  }

  document.querySelectorAll('.tab[data-tab="users"]').forEach(function (t) { t.addEventListener('click', start); });
  if (location.hash === '#users') { const t = document.querySelector('.tab[data-tab="users"]'); if (t) t.click(); }
})();
