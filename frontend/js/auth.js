/**
 * PIN session — token แยกต่อโมดูล (backend ผูก token กับโมดูลที่กรอก PIN)
 * โมดูลที่ต้อง PIN: bank, settings · กรอก PIN แค่ครั้งเดียวต่อวัน (หมดอายุเที่ยงคืน)
 * settings ใช้ PIN ของตัวเอง (pin_settings) — ถ้ายังไม่ตั้ง backend ใช้ PIN ธนาคารแทน
 */

const PIN_MODULES = ['bank', 'settings'];
const TOKEN_KEY = 'baanmai_token';   // bank ใช้คีย์เดิม · โมดูลอื่น = baanmai_token_<module>

// action ของ settings ที่อ่านได้โดยไม่ต้อง PIN (หน้าหลักใช้ settings.get ดึงชื่อโรงเรียน)
const PUBLIC_ACTIONS = ['settings.get', 'settings.init', 'settings.promote_preview'];

function tokenKey(mod) { return mod === 'bank' ? TOKEN_KEY : TOKEN_KEY + '_' + mod; }

function actionToModule(action) {
  if (!action || PUBLIC_ACTIONS.indexOf(String(action)) >= 0) return null;
  const prefix = String(action).split('.')[0];
  return PIN_MODULES.indexOf(prefix) >= 0 ? prefix : null;
}

/** อ่าน token ของโมดูล — คืน null ถ้าไม่มีหรือหมดอายุ (ลบทิ้งให้ด้วย) */
function readToken(mod) {
  const key = tokenKey(mod);
  const raw = localStorage.getItem(key);
  if (!raw) return null;
  try {
    const data = JSON.parse(raw);
    if (new Date(data.expires_at).getTime() <= Date.now()) {
      localStorage.removeItem(key);
      return null;
    }
    return data.token;
  } catch (e) { return null; }
}

const Auth = {

  getToken: function (action) {
    // ระบบจัดตารางสอน (tt.*) ใช้ session ผู้ใช้ของตัวเอง (js/tt-session.js) — แยกจาก PIN เดิม
    if (String(action).indexOf('tt.') === 0) return window.TTAuth ? TTAuth.token() : null;
    // ส่ง token เฉพาะ action ของโมดูลที่ต้อง PIN
    const mod = actionToModule(action);
    return mod ? readToken(mod) : null;
  },

  setToken: function (mod, token, ttlSec) {
    const midnight = new Date(); midnight.setHours(24, 0, 0, 0);
    const byTtl = Date.now() + (ttlSec || 43200) * 1000;
    const expires_at = new Date(Math.min(midnight.getTime(), byTtl)).toISOString();
    localStorage.setItem(tokenKey(mod), JSON.stringify({ token: token, expires_at: expires_at }));
  },

  /** ล้าง token ของโมดูล · ไม่ระบุ = ล้างทุกโมดูล */
  clear: function (mod) {
    (mod ? [mod] : PIN_MODULES).forEach(function (m) { localStorage.removeItem(tokenKey(m)); });
  },

  hasValid: function (mod) { return !!readToken(mod || 'bank'); },

  /** เรียก action ที่ต้อง PIN — ถามก่อนถ้ายังไม่มี token · token หมดอายุกลางทาง → ถามใหม่แล้วลองอีกครั้ง */
  withPin: async function (mod, fn) {
    await this.requirePin(mod);
    try { return await fn(); }
    catch (e) {
      if (e.code !== 'TOKEN_EXPIRED') throw e;
      this.clear(mod);
      await this.requirePin(mod);
      return await fn();
    }
  },

  /** เปิด modal กรอก PIN ถ้ายังไม่มี token — คืน Promise */
  requirePin: function (mod) {
    const self = this;
    return new Promise(function (resolve, reject) {
      if (self.hasValid(mod)) { resolve(); return; }
      self.openPinModal(mod, resolve, reject);
    });
  },

  openPinModal: function (mod, onSuccess, onCancel) {
    const labels = { bank: 'ธนาคารโรงเรียน', attendance: 'เช็คการมาเรียน', settings: 'ตั้งค่าระบบ' };
    const el = document.createElement('div');
    el.className = 'modal-backdrop show';
    el.innerHTML =
      '<div class="modal">' +
      '<h3 class="modal-title">🔒 กรอก PIN — ' + (labels[mod] || mod) + '</h3>' +
      '<div class="form-group"><input type="password" inputmode="numeric" maxlength="6" id="pin-input" class="form-control" placeholder="PIN" style="font-size:24px;text-align:center;letter-spacing:8px"></div>' +
      '<div id="pin-error" class="alert alert-danger hidden"></div>' +
      '<div class="flex" style="justify-content:flex-end;gap:8px"><button class="btn btn-secondary" id="pin-cancel">ยกเลิก</button><button class="btn btn-primary" id="pin-ok">ตกลง</button></div>' +
      '</div>';
    document.body.appendChild(el);

    const input = el.querySelector('#pin-input');
    const err = el.querySelector('#pin-error');
    setTimeout(function () { input.focus(); }, 100);

    const close = function () { el.remove(); };
    const self = this;
    const submit = async function () {
      const pin = input.value.trim();
      if (!pin) { err.textContent = 'กรุณากรอก PIN'; err.classList.remove('hidden'); return; }
      try {
        const data = await api('auth.verify_pin', { module: mod, pin: pin }, { silent: true, loadingMsg: 'กำลังตรวจสอบ...' });
        self.setToken(mod, data.token, data.expires_in);
        close();
        onSuccess();
      } catch (e) {
        err.textContent = e.message || 'PIN ไม่ถูกต้อง';
        err.classList.remove('hidden');
        input.value = ''; input.focus();
      }
    };

    el.querySelector('#pin-ok').onclick = submit;
    el.querySelector('#pin-cancel').onclick = function () { close(); if (onCancel) onCancel(new Error('ผู้ใช้ยกเลิก')); };
    input.onkeydown = function (e) { if (e.key === 'Enter') submit(); };
  },
};
