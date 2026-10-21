/**
 * ผู้ใช้ของระบบจัดตารางสอน (เฟส 6) — session · หน้าเข้าสู่ระบบ/ตั้งผู้ดูแลคนแรก · เมนูผู้ใช้บนแถบหัว · ปุ่มโหมดมืด/ภาษา
 * token เก็บในเครื่อง (localStorage) และส่งไปกับทุกคำสั่ง tt.* ผ่าน Auth.getToken (js/auth.js)
 *
 * ใช้: TTAuth.require({ caps:['view'] })  → Promise ได้ผู้ใช้ (แสดงหน้าเข้าสู่ระบบจนกว่าจะผ่าน)
 *      TTAuth.peek()                      → ผู้ใช้ปัจจุบันหรือ null (ไม่บังคับเข้าสู่ระบบ — หน้าดูตาราง)
 *      TTAuth.can('edit_timetable')
 */
const TTAuth = (function () {
  const KEY = 'baanmai_tt_session';
  let user = null, gate = null, roles = [];
  const esc = function (s) { return Utils.esc(s); };

  function load() {
    try {
      const s = JSON.parse(localStorage.getItem(KEY) || 'null');
      if (s && s.token && s.expires_at && s.expires_at > bkkNow()) return s;
    } catch (e) { /* ignore */ }
    return null;
  }
  function save(s) { try { localStorage.setItem(KEY, JSON.stringify(s)); } catch (e) { /* ignore */ } }
  function clear() { try { localStorage.removeItem(KEY); } catch (e) { /* ignore */ } user = null; }
  function bkkNow() { return new Date(Date.now() + 7 * 3600 * 1000).toISOString().slice(0, 19); }

  /* ── หน้าเต็มจอ: เข้าสู่ระบบ / ตั้งผู้ดูแลคนแรก ── */
  function screen(html) {
    let el = document.getElementById('tt-auth');
    if (!el) { el = document.createElement('div'); el.id = 'tt-auth'; el.className = 'tt-auth'; document.body.appendChild(el); }
    el.innerHTML = '<div class="tt-auth-card card">' + html + '</div>';
    document.body.classList.add('tt-locked');
    return el;
  }
  function closeScreen() { const el = document.getElementById('tt-auth'); if (el) el.remove(); document.body.classList.remove('tt-locked'); }
  function errBox(el, msg) { const e = el.querySelector('[data-err]'); e.textContent = msg; e.classList.toggle('hidden', !msg); }

  function loginScreen(resolve, msg) {
    const el = screen(
      '<div class="tt-auth-logo">🗓️</div><h3 class="card-title" style="text-align:center">เข้าสู่ระบบจัดตารางสอน</h3>' +
      (msg ? '<div class="alert alert-warning" style="font-size:14px">' + esc(msg) + '</div>' : '') +
      '<form data-form autocomplete="on"><label>ชื่อผู้ใช้</label><input class="form-control" name="username" autocomplete="username" autocapitalize="none" required>' +
      '<label style="margin-top:8px">รหัสผ่าน</label><input class="form-control" name="password" type="password" autocomplete="current-password" required>' +
      '<label class="tt-chip" style="margin-top:10px"><input type="checkbox" name="remember"> จดจำการเข้าสู่ระบบ 30 วัน</label>' +
      '<div class="alert alert-danger hidden" data-err style="margin-top:10px"></div>' +
      '<button class="btn btn-primary" style="width:100%;margin-top:12px" type="submit"><i class="bi bi-box-arrow-in-right"></i> เข้าสู่ระบบ</button></form>' +
      '<div class="tt-auth-links"><a href="timetable-view.html">ดูตารางเรียน (ไม่ต้องเข้าสู่ระบบ)</a> · <a href="index.html">กลับหน้าหลัก</a></div>');
    const f = el.querySelector('[data-form]');
    setTimeout(function () { f.username.focus(); }, 50);
    f.onsubmit = async function (e) {
      e.preventDefault();
      errBox(el, '');
      try {
        const r = await api('tt.login', { username: f.username.value, password: f.password.value, remember: f.remember.checked }, { silent: true, loadingMsg: 'กำลังเข้าสู่ระบบ...', noRetry: true, token: null });
        signedIn(r, resolve);
      } catch (err) { errBox(el, err.message); f.password.value = ''; f.password.focus(); }
    };
  }

  function setupScreen(resolve) {
    const el = screen(
      '<div class="tt-auth-logo">🔐</div><h3 class="card-title" style="text-align:center">ตั้งค่าผู้ดูแลระบบคนแรก</h3>' +
      '<p class="tt-note">ระบบจัดตารางสอนยังไม่มีผู้ใช้ — สร้างบัญชีผู้ดูแลระบบ (ทำได้ครั้งเดียว) แล้วเพิ่มผู้ใช้อื่นในแท็บ "ผู้ใช้"</p>' +
      '<form data-form><label>PIN ธนาคารโรงเรียน (ยืนยันว่าเป็นผู้ดูแลโรงเรียน)</label><input class="form-control" name="pin" type="password" inputmode="numeric" autocomplete="off" required>' +
      '<label style="margin-top:8px">ชื่อผู้ใช้</label><input class="form-control" name="username" autocomplete="username" autocapitalize="none" placeholder="a-z 0-9 . _ -" required>' +
      '<label style="margin-top:8px">ชื่อที่แสดง</label><input class="form-control" name="display_name" required>' +
      '<label style="margin-top:8px">รหัสผ่าน</label><input class="form-control" name="password" type="password" autocomplete="new-password" placeholder="อย่างน้อย 8 ตัวอักษร" required>' +
      '<label style="margin-top:8px">ยืนยันรหัสผ่าน</label><input class="form-control" name="password2" type="password" autocomplete="new-password" required>' +
      '<div class="alert alert-danger hidden" data-err style="margin-top:10px"></div>' +
      '<button class="btn btn-primary" style="width:100%;margin-top:12px" type="submit"><i class="bi bi-shield-check"></i> สร้างบัญชีผู้ดูแลระบบ</button></form>' +
      '<div class="tt-auth-links"><a href="index.html">กลับหน้าหลัก</a></div>');
    const f = el.querySelector('[data-form]');
    f.onsubmit = async function (e) {
      e.preventDefault();
      errBox(el, '');
      if (f.password.value !== f.password2.value) { errBox(el, 'รหัสผ่านไม่ตรงกัน'); return; }
      try {
        const r = await api('tt.setup_admin', { pin: f.pin.value, username: f.username.value, display_name: f.display_name.value, password: f.password.value },
          { silent: true, loadingMsg: 'กำลังสร้างบัญชี...', noRetry: true, token: null });
        signedIn(r, resolve);
        Toast.show('สร้างบัญชีผู้ดูแลระบบแล้ว', 'success');
      } catch (err) { errBox(el, err.message); }
    };
  }

  function signedIn(r, resolve) {
    save({ token: r.token, expires_at: r.expires_at, user: r.user });
    user = r.user;
    closeScreen();
    renderHeader();
    if (resolve) resolve(user);
  }

  /** บัญชีที่ไม่มีสิทธิ์ใช้หน้านี้ (นักเรียน/ผู้ปกครอง) */
  function noAccessScreen(msg) {
    screen('<div class="tt-auth-logo">👋</div><h3 class="card-title" style="text-align:center">' + esc(user.display_name) + '</h3>' +
      '<div class="alert alert-info">' + esc(msg || 'บัญชีนี้ใช้ดูตารางเรียนเท่านั้น') + '</div>' +
      '<a class="btn btn-primary" style="width:100%" href="timetable-view.html"><i class="bi bi-calendar3-week"></i> ไปหน้าดูตาราง</a>' +
      '<div class="tt-auth-links"><a href="#" data-out>ออกจากระบบ</a></div>');
    document.querySelector('#tt-auth [data-out]').onclick = function (e) { e.preventDefault(); logout(); };
  }

  /* ── แถบหัว: โหมดมืด · ภาษา · ผู้ใช้ ── */
  function renderHeader() {
    const hdr = document.querySelector('.app-header');
    if (!hdr) return;
    let box = hdr.querySelector('.tt-hdr-tools');
    if (!box) { box = document.createElement('div'); box.className = 'tt-hdr-tools'; hdr.appendChild(box); }
    box.innerHTML = '<button class="tt-hdr-btn" data-theme-btn type="button"></button><button class="tt-hdr-btn" data-lang-btn type="button"></button>' +
      (user ? '<div class="tt-user"><button class="tt-hdr-btn tt-user-btn" type="button" data-umenu><i class="bi bi-person-circle"></i> <span data-no-i18n>' + esc(user.display_name) + '</span></button>' +
        '<div class="tt-user-menu hidden"><div class="tt-note" style="padding:8px 12px">' + esc(user.username) + ' · ' + esc(user.role_label) + '</div>' +
        '<button type="button" data-pw><i class="bi bi-key"></i> เปลี่ยนรหัสผ่าน</button><button type="button" data-out><i class="bi bi-box-arrow-right"></i> ออกจากระบบ</button></div></div>'
        : (document.body.dataset.ttPage === 'view' ? '<a class="tt-hdr-btn" href="timetable.html" title="สำหรับเจ้าหน้าที่"><i class="bi bi-person-lock"></i></a>' : ''));
    box.querySelector('[data-theme-btn]').onclick = function () { TTTheme.toggle(); };
    box.querySelector('[data-lang-btn]').onclick = function () { TTi18n.toggle(); };
    TTTheme.refresh();
    TTi18n.updateButtons();
    if (!user) return;
    const menu = box.querySelector('.tt-user-menu');
    box.querySelector('[data-umenu]').onclick = function (e) { e.stopPropagation(); menu.classList.toggle('hidden'); };
    document.addEventListener('click', function () { menu.classList.add('hidden'); });
    box.querySelector('[data-out]').onclick = logout;
    box.querySelector('[data-pw]').onclick = changePassword;
  }

  async function logout() {
    try { await api('tt.logout', {}, { silent: true, loading: false, noRetry: true }); } catch (e) { /* ออกฝั่งเครื่องอยู่ดี */ }
    clear();
    location.reload();
  }

  function changePassword() {
    const el = document.createElement('div');
    el.className = 'modal-backdrop show';
    el.innerHTML = '<div class="modal"><h3 class="modal-title">🔑 เปลี่ยนรหัสผ่าน</h3><form data-form>' +
      '<label>รหัสผ่านเดิม</label><input class="form-control" name="old" type="password" autocomplete="current-password" required>' +
      '<label style="margin-top:8px">รหัสผ่านใหม่</label><input class="form-control" name="pw" type="password" autocomplete="new-password" placeholder="อย่างน้อย 8 ตัวอักษร" required>' +
      '<label style="margin-top:8px">ยืนยันรหัสผ่านใหม่</label><input class="form-control" name="pw2" type="password" autocomplete="new-password" required>' +
      '<div class="alert alert-danger hidden" data-err style="margin-top:10px"></div>' +
      '<div class="flex" style="justify-content:flex-end;gap:8px;margin-top:12px"><button type="button" class="btn btn-secondary" data-cancel>ยกเลิก</button><button class="btn btn-primary" type="submit">บันทึก</button></div></form></div>';
    document.body.appendChild(el);
    const f = el.querySelector('[data-form]');
    el.querySelector('[data-cancel]').onclick = function () { el.remove(); };
    f.onsubmit = async function (e) {
      e.preventDefault();
      if (f.pw.value !== f.pw2.value) { errBox(el, 'รหัสผ่านไม่ตรงกัน'); return; }
      try {
        const r = await api('tt.change_password', { old_password: f.old.value, new_password: f.pw.value }, { silent: true, loadingMsg: 'กำลังบันทึก...', noRetry: true });
        el.remove();
        Toast.show('เปลี่ยนรหัสผ่านแล้ว' + (r.signed_out_others ? ' (ออกจากระบบเครื่องอื่น ' + r.signed_out_others + ' เครื่อง)' : ''), 'success');
      } catch (err) { errBox(el, err.message); }
    };
  }

  /* ── session หมดอายุระหว่างใช้งาน → ให้เข้าสู่ระบบใหม่ (หน้าที่ require เท่านั้น) ── */
  const rawApi = window.api;
  window.api = async function (action, params, opts) {
    try { return await rawApi(action, params, opts); }
    catch (e) {
      if (gate && String(action).indexOf('tt.') === 0 && (e.code === 'AUTH_REQUIRED' || e.code === 'SETUP_REQUIRED') && action !== 'tt.login') {
        clear();
        if (!document.getElementById('tt-auth')) loginScreen(function () { location.reload(); }, 'หมดเวลาการเข้าสู่ระบบ — กรุณาเข้าสู่ระบบอีกครั้ง');
      }
      throw e;
    }
  };

  return {
    token: function () { const s = load(); return s ? s.token : null; },
    user: function () { return user; },
    roles: function () { return roles; },
    can: function (cap) { return !!(user && (user.caps || []).indexOf(cap) >= 0); },
    renderHeader: renderHeader,
    logout: logout,

    /** ตรวจสถานะกับ server (ไม่บังคับเข้าสู่ระบบ) → ผู้ใช้หรือ null */
    peek: async function () {
      const s = load();
      try {
        const st = await api('tt.auth_status', {}, { silent: true, loading: false });
        roles = st.roles || [];
        user = st.user;
        if (user && s) save(Object.assign(s, { user: user }));
        if (!user && s) clear();
        return user;
      } catch (e) { user = null; return null; }
      finally { renderHeader(); }
    },

    /** บังคับเข้าสู่ระบบ + ตรวจความสามารถ (มีอย่างใดอย่างหนึ่งใน caps) */
    require: function (opts) {
      const caps = (opts && opts.caps) || [];
      gate = gate || new Promise(function (resolve) {
        (async function () {
          let st;
          try { st = await api('tt.auth_status', {}, { silent: true, loadingMsg: 'กำลังตรวจสอบผู้ใช้...' }); }
          catch (e) { screen('<div class="alert alert-danger">เชื่อมต่อเซิร์ฟเวอร์ไม่ได้: ' + esc(e.message) + '</div><button class="btn btn-primary" onclick="location.reload()">ลองใหม่</button>'); return; }
          roles = st.roles || [];
          renderHeader();
          if (st.setup_required) { clear(); setupScreen(resolve); return; }
          if (!st.user) { clear(); loginScreen(resolve); return; }
          user = st.user;
          const s = load();
          if (s) save(Object.assign(s, { user: user }));
          renderHeader();
          resolve(user);
        })();
      }).then(function (u) {
        if (caps.length && !caps.some(function (c) { return (u.caps || []).indexOf(c) >= 0; })) {
          noAccessScreen();
          return new Promise(function () { /* ค้างไว้ — ไม่โหลดหน้าต่อ */ });
        }
        return u;
      });
      return gate;
    },
  };
})();

// const ระดับบนสุดไม่กลายเป็น window.* — ประกาศให้โมดูลอื่นตรวจ window.TTAuth ได้
window.TTAuth = TTAuth;
