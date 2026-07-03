/**
 * PIN session — เก็บ token ร่วมกัน 1 ค่า (ทุกโมดูลใช้ token เดียวกัน)
 * โมดูลที่ต้อง PIN: bank, attendance · กรอก PIN แค่ครั้งเดียวต่อวัน (หมดอายุเที่ยงคืน)
 * ปลดล็อกโมดูลใดก็ได้ครั้งเดียว → เข้าโมดูลอื่นที่ต้อง PIN ได้เลยโดยไม่ถามซ้ำ
 */

const PIN_MODULES = ['bank', 'attendance'];
const TOKEN_KEY = 'baanmai_token';

function actionToModule(action) {
  if (!action) return null;
  const prefix = String(action).split('.')[0];
  return PIN_MODULES.indexOf(prefix) >= 0 ? prefix : null;
}

/** อ่าน token ร่วม — คืน null ถ้าไม่มีหรือหมดอายุ (ลบทิ้งให้ด้วย) */
function readSharedToken() {
  const raw = localStorage.getItem(TOKEN_KEY);
  if (!raw) return null;
  try {
    const data = JSON.parse(raw);
    if (new Date(data.expires_at).getTime() <= Date.now()) {
      localStorage.removeItem(TOKEN_KEY);
      return null;
    }
    return data.token;
  } catch (e) { return null; }
}

const Auth = {

  getToken: function (action) {
    // ส่ง token เฉพาะ action ของโมดูลที่ต้อง PIN
    if (!actionToModule(action)) return null;
    return readSharedToken();
  },

  setToken: function (mod, token, ttlSec) {
    const midnight = new Date(); midnight.setHours(24, 0, 0, 0);
    const byTtl = Date.now() + (ttlSec || 43200) * 1000;
    const expires_at = new Date(Math.min(midnight.getTime(), byTtl)).toISOString();
    localStorage.setItem(TOKEN_KEY, JSON.stringify({ token: token, expires_at: expires_at }));
  },

  clear: function () { localStorage.removeItem(TOKEN_KEY); },

  hasValid: function () { return !!readSharedToken(); },

  /** เปิด modal กรอก PIN ถ้ายังไม่มี token — คืน Promise */
  requirePin: function (mod) {
    const self = this;
    return new Promise(function (resolve, reject) {
      if (self.hasValid(mod)) { resolve(); return; }
      self.openPinModal(mod, resolve, reject);
    });
  },

  openPinModal: function (mod, onSuccess, onCancel) {
    const labels = { bank: 'ธนาคารโรงเรียน', attendance: 'เช็คการมาเรียน' };
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
