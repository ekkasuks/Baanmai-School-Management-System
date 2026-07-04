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
 * action ที่ "เขียนข้อมูล" — ห้าม retry อัตโนมัติเมื่อเจอ error ชั่วคราว (เช่น 404 ตอน redirect)
 * เพราะ doPost อาจทำงานไปแล้วแต่เราอ่านผลไม่ได้ → retry จะบันทึกซ้ำ
 * (ยกเว้น error code 'METHOD' ที่การันตีว่า doPost ไม่ได้ทำงาน — retry ได้เสมอ)
 */
function isWriteAction(action) {
  return /\.(deposit|withdraw|save|record|create|update|remove|restore|delete|master_save|master_delete|import_dmc)$/.test(String(action));
}

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
  const MAX_ATTEMPTS = 3;
  const canRetryTransient = !isWriteAction(action);  // เขียนข้อมูล = ไม่ retry error ชั่วคราว (กันบันทึกซ้ำ)

  try {
    for (let attempt = 1; ; attempt++) {
      let transient = false;   // error จาก redirect ของ Apps Script สะดุด (404 / ไม่ใช่ JSON / เครือข่าย)
      try {
        const res = await fetch(window.API_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'text/plain;charset=utf-8' },
          body: JSON.stringify(body),
          redirect: 'follow',
        });
        if (!res.ok) { transient = true; throw new Error('เชื่อมต่อเซิร์ฟเวอร์ไม่สำเร็จ (HTTP ' + res.status + ')'); }
        let json;
        try { json = await res.json(); }
        catch (pe) { transient = true; throw new Error('เซิร์ฟเวอร์ตอบกลับไม่สมบูรณ์'); }
        if (!json.ok) {
          const err = new Error((json.error && json.error.message) || 'เกิดข้อผิดพลาด');
          err.code = json.error && json.error.code;
          throw err;
        }
        return json.data;
      } catch (e) {
        // 'METHOD' = POST ไปตกที่ doGet → doPost ไม่ได้ทำงาน → retry ได้เสมอ (แม้เป็นการเขียน)
        // error ชั่วคราวอื่น (404 redirect / ไม่ใช่ JSON / เครือข่ายหลุด) → retry เฉพาะการ"อ่าน"
        const isMethod = e.code === 'METHOD';
        const isNetwork = (e instanceof TypeError);   // fetch เครือข่ายล้มเหลว
        const retriable = isMethod || ((transient || isNetwork) && canRetryTransient);
        if (retriable && attempt < MAX_ATTEMPTS) {
          await new Promise(function (r) { setTimeout(r, attempt * 400); });
          continue;
        }
        throw e;
      }
    }
  } catch (e) {
    if (!opts.silent) Toast.show(e.message || 'เชื่อมต่อไม่ได้', 'danger');
    throw e;
  } finally {
    if (opts.loading !== false) Loading.hide();
  }
}
