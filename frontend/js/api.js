/**
 * API helper — POST JSON แบบ text/plain (เลี่ยง CORS preflight) + Loading + Toast
 */

const Loading = {
  el: null,
  show: function (msg) {
    if (!this.el) {
      this.el = document.createElement('div');
      this.el.className = 'loading-overlay';
      this.el.innerHTML = '<div class="spinner"></div><div class="loading-msg"></div>';
      document.body.appendChild(this.el);
    }
    this.el.querySelector('.loading-msg').textContent = msg || 'กำลังโหลด...';
    this.el.classList.add('show');
  },
  hide: function () { if (this.el) this.el.classList.remove('show'); },
};

const Toast = {
  show: function (message, type, duration) {
    type = type || 'success';
    let host = document.getElementById('toast-host');
    if (!host) {
      host = document.createElement('div');
      host.id = 'toast-host';
      host.style.cssText = 'position:fixed;top:18px;right:18px;z-index:9999;display:flex;flex-direction:column;gap:8px;max-width:90vw';
      document.body.appendChild(host);
    }
    const t = document.createElement('div');
    t.className = 'alert alert-' + type;
    t.style.cssText = 'min-width:240px;box-shadow:0 6px 18px rgba(0,0,0,.12);animation:slideIn .2s;margin:0';
    t.textContent = message;
    host.appendChild(t);
    setTimeout(function () { t.remove(); }, duration || 3500);
  },
};

/**
 * เรียก API
 * @param {string} action  เช่น "settings.get"
 * @param {object} params
 * @param {object} opts    { loading, loadingMsg, silent }
 */
async function api(action, params, opts) {
  params = params || {};
  opts = opts || {};
  if (!window.API_URL || window.API_URL.indexOf('PASTE_YOUR') >= 0) {
    const e = new Error('ยังไม่ได้ตั้งค่า API_URL — แก้ในไฟล์ js/config.js');
    if (!opts.silent) Toast.show(e.message, 'warning');
    throw e;
  }
  if (opts.loading !== false) Loading.show(opts.loadingMsg);

  const body = { action: action, token: Auth.getToken(action), params: params };

  try {
    const res = await fetch(window.API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(body),
      redirect: 'follow',
    });
    const json = await res.json();
    if (!json.ok) {
      const err = new Error((json.error && json.error.message) || 'เกิดข้อผิดพลาด');
      err.code = json.error && json.error.code;
      throw err;
    }
    return json.data;
  } catch (e) {
    if (!opts.silent) Toast.show(e.message || 'เชื่อมต่อไม่ได้', 'danger');
    throw e;
  } finally {
    if (opts.loading !== false) Loading.hide();
  }
}
