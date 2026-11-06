/**
 * ตารางสอน › แท็บผู้ใช้ — การจัดการผู้ใช้ย้ายไปที่ ตั้งค่าระบบ › ผู้ใช้ (js/modules/settings-users.js)
 *   เหลือ: ลิงก์ไปหน้าใหม่ + ตั้งค่าการเข้าถึงหน้าดูตาราง (ไม่ต้องเข้าสู่ระบบ / ต้องเข้าสู่ระบบ)
 */
(function () {
  const host = document.getElementById('tab-users');
  function shell() {
    host.innerHTML =
      '<div class="card"><h3 class="card-title">👥 ผู้ใช้และสิทธิ์ย้ายไปที่ตั้งค่าระบบแล้ว</h3>' +
        '<p class="tt-note" style="margin:0 0 10px">เพิ่ม/แก้ผู้ใช้ ตั้งรหัสผ่าน สร้างบัญชีครูจากตารางสอน และกำหนดครูประจำชั้น ทำได้ที่ <strong>ตั้งค่าระบบ › ผู้ใช้</strong> (เข้าด้วยบัญชีผู้ดูแลระบบ)</p>' +
        '<a class="btn btn-primary" href="settings.html#users"><i class="bi bi-gear"></i> ไปที่ ตั้งค่าระบบ › ผู้ใช้</a></div>' +
      '<div class="card"><h3 class="card-title">🌐 การเข้าถึงหน้าดูตาราง</h3>' +
        '<label class="tt-chip"><input type="checkbox" data-public> เปิดให้ดูตารางที่เผยแพร่แล้วโดยไม่ต้องเข้าสู่ระบบ</label>' +
        '<p class="tt-note" style="margin:8px 0 0">หน้า <a href="timetable-view.html" target="_blank">ดูตารางเรียน / ตารางสอน</a> แสดงเฉพาะฉบับที่ "เผยแพร่แล้ว" (รายห้อง/รายครู — ไม่มีข้อมูลส่วนบุคคลของนักเรียน) · ถ้าปิด ต้องเข้าสู่ระบบด้วยบัญชีใดก็ได้ก่อน</p></div>';
    host.querySelector('[data-public]').onchange = async function () {
      const cb = this;
      try {
        const r = await api('tt.constraints_save', { config: { public_view: cb.checked } }, { loadingMsg: 'กำลังบันทึก...', noRetry: true });
        TT.S.config = r.config;
        Toast.show(cb.checked ? 'เปิดให้ดูตารางโดยไม่ต้องเข้าสู่ระบบแล้ว' : 'หน้าดูตารางต้องเข้าสู่ระบบแล้ว', 'success');
      } catch (e) { cb.checked = !cb.checked; }
    };
  }
  function load() { host.querySelector('[data-public]').checked = !TT.S.config || TT.S.config.public_view !== false; }

  document.querySelectorAll('#tt-tabs .tab').forEach(function (t) {
    t.addEventListener('click', function () {
      if (t.dataset.tab !== 'users') return;
      if (!host.querySelector('[data-public]')) shell();
      load();
    });
  });
})();
