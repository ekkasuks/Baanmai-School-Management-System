/**
 * แถบบัญชีบุคลากรบนหน้าบันทึกข้อมูล (เช็คชื่อ พฤติกรรม สุขภาพ น้ำหนักส่วนสูง นม ทุน ลูกเสือ ข้อมูลนักเรียน ธนาคาร)
 *  - ปุ่ม "เข้าสู่ระบบ" / ชื่อผู้ใช้ (เมนู: ครูประจำชั้น · เปลี่ยนรหัสผ่าน · ออกจากระบบ) บนแถบหัว
 *  - เข้าสู่ระบบแล้ว: ช่อง "ผู้บันทึก" ใช้ชื่อจากบัญชี (แก้ไม่ได้) · server ก็ใส่ชื่อจากบัญชีเอง (index.js)
 *  - ครูประจำชั้น: เลือกชั้นของตัวเองในช่องเลือกชั้นของหน้าบันทึกให้อัตโนมัติ (เปลี่ยนชั้นได้ตามปกติ)
 * ต้องโหลดหลัง js/tt-session.js · ส่ง token บัญชีกับคำสั่งผ่าน Auth.getToken (js/auth.js)
 */
(function () {
  if (!window.TTAuth) return;
  const esc = Utils.esc;
  const RECORDER_IDS = ['rec-by', 'fx-by', 'txn-by', 'p-by', 's-by', 'sc-by'];
  const CLASS_IDS = ['rec-class', 'p-class'];          // ช่องเลือกชั้นของแท็บบันทึก (ธนาคารยังใช้ PIN — ไม่เลือกให้อัตโนมัติ)
  let user = null;

  // สไตล์หน้าเข้าสู่ระบบ/ปุ่มบนแถบหัว (css/tt-common.css) — หน้าเหล่านี้ไม่ได้โหลดไว้
  if (!document.querySelector('link[href$="tt-common.css"]')) {
    const l = document.createElement('link'); l.rel = 'stylesheet'; l.href = 'css/tt-common.css'; document.head.appendChild(l);
  }
  const st = document.createElement('style');
  st.textContent = '.sb-tools{margin-left:auto;position:relative}.sb-tools .tt-hdr-btn{white-space:nowrap}.sb-tools .tt-user-menu .sb-hr{padding:4px 14px 8px;font-size:13px;color:var(--muted)}' +
    'input[data-staff-locked]{background:var(--primary-light,#E1F5FE)!important;color:var(--primary-dark,#0288D1)!important;font-weight:600}' +
    '@media (max-width:520px){.sb-tools .sb-name{max-width:90px;overflow:hidden;text-overflow:ellipsis;display:inline-block;vertical-align:bottom}}';
  document.head.appendChild(st);
  if (!document.body.dataset.ttLogin) document.body.dataset.ttLogin = 'pick';

  function classLabel(h) { return h.grade + (h.room ? '/' + h.room : ''); }

  function render() {
    const hdr = document.querySelector('.app-header');
    if (!hdr) return;
    let box = hdr.querySelector('.sb-tools');
    if (!box) { box = document.createElement('div'); box.className = 'sb-tools'; hdr.appendChild(box); }
    if (!user) {
      box.innerHTML = '<button class="tt-hdr-btn" type="button" data-in title="เข้าสู่ระบบเพื่อบันทึกข้อมูลในชื่อของคุณ"><i class="bi bi-box-arrow-in-right"></i> เข้าสู่ระบบ</button>';
      box.querySelector('[data-in]').onclick = signIn;
      return;
    }
    const hr = (user.homeroom || []).map(classLabel).join(', ');
    box.innerHTML = '<button class="tt-hdr-btn" type="button" data-um><i class="bi bi-person-circle"></i> <span class="sb-name" data-no-i18n>' + esc(user.display_name) + '</span></button>' +
      '<div class="tt-user-menu hidden"><div class="tt-note" style="padding:8px 14px 2px">' + esc(user.username) + ' · ' + esc(user.role_label) + '</div>' +
      '<div class="sb-hr">' + (hr ? '🏫 ครูประจำชั้น ' + esc(hr) : 'บันทึกในชื่อของคุณ') + '</div>' +
      '<button type="button" data-pw><i class="bi bi-key"></i> เปลี่ยนรหัสผ่าน</button><button type="button" data-out><i class="bi bi-box-arrow-right"></i> ออกจากระบบ</button></div>';
    const menu = box.querySelector('.tt-user-menu');
    box.querySelector('[data-um]').onclick = function (e) { e.stopPropagation(); menu.classList.toggle('hidden'); };
    document.addEventListener('click', function () { menu.classList.add('hidden'); });
    box.querySelector('[data-pw]').onclick = function () { TTAuth.changePassword(); };
    box.querySelector('[data-out]').onclick = function () { TTAuth.logout(); };
  }

  /** ช่องผู้บันทึก = ชื่อจากบัญชี (แก้ไม่ได้) */
  function applyRecorder() {
    RECORDER_IDS.forEach(function (id) {
      const el = document.getElementById(id);
      if (!el) return;
      if (user) {
        el.value = user.display_name;
        el.readOnly = true;
        el.setAttribute('data-staff-locked', '');
        el.title = 'ใช้ชื่อจากบัญชีที่เข้าสู่ระบบ';
      } else if (el.hasAttribute('data-staff-locked')) {
        el.readOnly = false; el.removeAttribute('data-staff-locked'); el.title = ''; el.value = '';
      }
    });
  }

  /** ครูประจำชั้น → เลือกชั้นแรกของตัวเองให้ (ครั้งเดียวต่อช่อง · ถ้าผู้ใช้เลือกชั้นเองแล้วไม่ยุ่ง) */
  function applyHomeroom() {
    const keys = (user && user.homeroom || []).map(function (h) { return h.grade + '|' + h.room; });
    if (!keys.length) return;
    CLASS_IDS.forEach(function (id) {
      const sel = document.getElementById(id);
      if (!sel || sel.dataset.sbHr) return;
      let obs = null;
      const done = function () { sel.dataset.sbHr = '1'; if (obs) obs.disconnect(); };
      const tryPick = function () {
        if (sel.dataset.sbHr) return;
        if (sel.value) { done(); return; }   // มีชั้นถูกเลือกไว้แล้ว
        const k = keys.find(function (x) { return Array.prototype.some.call(sel.options, function (o) { return o.value === x; }); });
        if (!k) return;                       // ยังไม่โหลดรายชื่อชั้น — รอ
        sel.value = k; done();
        sel.dispatchEvent(new Event('change', { bubbles: true }));
      };
      sel.addEventListener('change', function (e) { if (e.isTrusted) done(); });
      obs = new MutationObserver(tryPick);
      obs.observe(sel, { childList: true });
      tryPick();
    });
  }

  async function signIn(msg) {
    const u = await TTAuth.signIn(typeof msg === 'string' ? msg : undefined);
    if (u) Toast.show('เข้าสู่ระบบแล้ว — บันทึกในชื่อ ' + u.display_name, 'success');
    return u;
  }
  // เข้าสู่ระบบจากที่ใดก็ตาม (ปุ่มบนแถบ / ธนาคาร / ตั้งค่า / บันทึกที่ถูกปฏิเสธ) → อัปเดตแถบ + ช่องผู้บันทึก + ชั้นเริ่มต้น
  document.addEventListener('tt:signin', function (e) {
    if (!e.detail) return;
    user = e.detail;
    render(); applyRecorder(); applyHomeroom();
    document.dispatchEvent(new CustomEvent('staff:change', { detail: user }));
  });

  // เปิดสวิตช์บังคับแล้ว: บันทึกโดยไม่ได้เข้าสู่ระบบ → server ตอบ AUTH_REQUIRED → เปิดหน้าเข้าสู่ระบบ แล้วส่งคำสั่งเดิมซ้ำให้ 1 ครั้ง
  const baseApi = window.api;
  let prompting = null;
  window.api = async function (action, params, opts) {
    try { return await baseApi(action, params, opts); }
    catch (e) {
      if (e.code !== 'AUTH_REQUIRED' || /^(tt|geo|acad)\./.test(String(action)) || TTAuth.token()) throw e;
      prompting = prompting || signIn('กรุณาเข้าสู่ระบบก่อนบันทึกข้อมูล').finally(function () { prompting = null; });
      const u = await prompting;
      if (!u) throw e;
      return await baseApi(action, params, Object.assign({}, opts || {}, { token: undefined }));
    }
  };

  const ready = TTAuth.peek().then(function (u) {
    user = u;
    render(); applyRecorder(); applyHomeroom();
    document.dispatchEvent(new CustomEvent('staff:change', { detail: user }));
    return user;
  });

  window.StaffBar = { user: function () { return user; }, ready: ready, signIn: signIn };
})();
