/**
 * ตั้งค่าระบบ › ประวัติการบันทึก (WRITE_LOG) — ผู้ดูแล/ฝ่ายวิชาการ (audit_view)
 * กรองช่วงวันที่ · ผู้บันทึก · เมนู · สรุปจำนวนต่อคน/ต่อเมนู · โหลดเพิ่ม · ส่งออก CSV
 * เป้าหมายที่เป็นนักเรียนแสดงเป็นชื่อ+ชั้น (server ไม่ส่งเลขประจำตัวมา)
 */
(function () {
  const esc = Utils.esc;
  const host = document.getElementById('tab-log');
  if (!host) return;
  const MODULE = { attendance: 'เช็คชื่อ', behavior: 'พฤติกรรม', health: 'สุขภาพ', growth: 'น้ำหนักส่วนสูง', milk: 'นม', scholarship: 'ทุน', scout: 'ลูกเสือ',
    students: 'ข้อมูลนักเรียน', bank: 'ธนาคาร', settings: 'ตั้งค่าระบบ', acad: 'วิชาการ', geo: 'แผนที่บ้าน', tt: 'ผู้ใช้/บัญชี' };
  const ACTION = {
    'attendance.save': 'บันทึกเช็คชื่อ', 'attendance.remove_day': 'ลบเช็คชื่อทั้งวัน', 'attendance.move_day': 'ย้ายวันเช็คชื่อ', 'attendance.trash_restore': 'กู้คืนเช็คชื่อ',
    'attendance.holiday_save': 'ตั้งวันหยุด', 'attendance.holiday_delete': 'ลบวันหยุด',
    'behavior.record': 'บันทึกพฤติกรรม', 'behavior.master_save': 'แก้รายการพฤติกรรม', 'behavior.master_delete': 'ลบรายการพฤติกรรม',
    'health.save': 'บันทึกตรวจสุขภาพ', 'growth.save': 'บันทึกน้ำหนักส่วนสูง', 'milk.mark_received': 'บันทึกรับนม', 'milk.reset_all': 'รีเซ็ตนม',
    'scholarship.record': 'บันทึกทุน', 'scholarship.delete': 'ลบทุน',
    'scout.score_save': 'บันทึกคะแนนลูกเสือ', 'scout.group_save': 'แก้กลุ่มลูกเสือ', 'scout.group_delete': 'ลบกลุ่มลูกเสือ', 'scout.member_add': 'เพิ่มสมาชิกลูกเสือ',
    'scout.member_remove': 'ลบสมาชิกลูกเสือ', 'scout.member_role': 'ตั้งตำแหน่งลูกเสือ', 'scout.activity_save': 'แก้กิจกรรมลูกเสือ', 'scout.activity_delete': 'ลบกิจกรรมลูกเสือ',
    'students.update': 'แก้ข้อมูลนักเรียน', 'students.create': 'เพิ่มนักเรียน', 'students.remove': 'ตั้งพ้นสภาพ', 'students.restore': 'คืนสถานะนักเรียน',
    'students.purge': 'ลบนักเรียนถาวร', 'students.import_dmc': 'นำเข้า DMC',
    'bank.deposit': 'ฝากเงิน', 'bank.withdraw': 'ถอนเงิน',
    'settings.update': 'แก้ค่าตั้งระบบ', 'settings.init': 'ตั้งค่าเริ่มต้น', 'settings.backup': 'สำรองข้อมูล', 'settings.restore': 'กู้คืนข้อมูล', 'settings.promote': 'เลื่อนชั้น',
    'acad.mult_set': 'ท่องสูตรคูณ', 'acad.mult_set_many': 'ท่องสูตรคูณ (หลายคน)', 'acad.gb_course_save': 'ตั้งค่าวิชา', 'acad.gb_item_save': 'เพิ่ม/แก้งาน', 'acad.gb_item_remove': 'ลบงาน',
    'acad.gb_score_save': 'บันทึกคะแนน', 'acad.gb_special_save': 'กำหนดผลพิเศษ', 'acad.gb_deduct_add': 'หักคะแนน', 'acad.gb_deduct_void': 'ยกเลิกการหักคะแนน',
    'acad.gb_submit': 'ส่งผลการเรียน', 'acad.gb_unlock': 'ปลดล็อกรายวิชา',
    'geo.save_home': 'บันทึกพิกัดบ้าน', 'geo.delete_home': 'ลบพิกัดบ้าน', 'geo.save_travel': 'บันทึกการเดินทาง', 'geo.link_create': 'สร้างลิงก์ผู้ปกครอง', 'geo.link_submit': 'ผู้ปกครองส่งพิกัด',
    'geo.point_save': 'แก้จุดสำคัญ', 'geo.point_delete': 'ลบจุดสำคัญ', 'geo.save_config': 'ตั้งค่าแผนที่',
    'tt.user_save': 'เพิ่ม/แก้ผู้ใช้', 'tt.user_reset_password': 'ตั้งรหัสผ่านใหม่', 'tt.user_create_teacher': 'สร้างบัญชีครู', 'tt.homeroom_save': 'กำหนดครูประจำชั้น',
    'tt.homeroom_import': 'ดึงครูประจำชั้น', 'tt.write_policy_save': 'เปิด/ปิดบังคับเข้าสู่ระบบ',
  };
  const DETAIL = { amount: 'จำนวนเงิน', type: 'ประเภท', status: 'สถานะ', points: 'คะแนน', month: 'เดือน', year: 'ปี', reason: 'เหตุผล', title: 'ชื่อ', table_no: 'แม่', passed: 'ผ่าน',
    role: 'บทบาท', username: 'ชื่อผู้ใช้', required: 'บังคับ', saved: 'บันทึก', from: 'จาก', to: 'ถึง', to_date: 'ไปวันที่' };
  let rows = [], next = '', started = false, lastParams = null;

  function ymd(d) { return new Date(d.getTime() + 7 * 3600e3).toISOString().slice(0, 10); }
  function actLabel(r) { return ACTION[r.module + '.' + r.action] || (r.module + '.' + r.action); }
  function detailText(r) {
    const d = r.detail || {};
    return Object.keys(d).map(function (k) { return (DETAIL[k] || k) + ' ' + d[k]; }).join(' · ');
  }
  function cls(r) { return r.grade ? r.grade + (r.room ? '/' + r.room : '') : ''; }

  async function start() {
    if (started) return;
    started = true;
    host.innerHTML = '<div class="card text-muted">กำลังตรวจสอบผู้ใช้...</div>';
    const u = await TTAuth.require({});
    if (!TTAuth.can('audit_view')) {
      host.innerHTML = '<div class="card"><div class="alert alert-warning" style="margin:0">ประวัติการบันทึกดูได้เฉพาะ <strong>ผู้ดูแลระบบ / ฝ่ายวิชาการ</strong> — ตอนนี้เข้าสู่ระบบในชื่อ ' + esc(u.display_name) + ' (' + esc(u.role_label) + ')</div></div>';
      return;
    }
    const today = new Date(), wk = new Date(Date.now() - 6 * 864e5);
    host.innerHTML =
      '<div class="card"><h3 class="card-title">📜 ประวัติการบันทึก</h3>' +
        '<p class="su-note" style="margin-top:-6px">ทุกการบันทึก/แก้/ลบในระบบ — ใคร · เมนู · รายการ · วันที่ของข้อมูล · ชั้น · จำนวน · "ไม่ได้เข้าสู่ระบบ" = บันทึกก่อนเปิดบังคับเข้าสู่ระบบ (ไม่รู้ตัวผู้บันทึก)</p>' +
        '<div class="lg-filters">' +
          '<label>จาก <input class="form-control" type="date" data-f="from" value="' + ymd(wk) + '"></label>' +
          '<label>ถึง <input class="form-control" type="date" data-f="to" value="' + ymd(today) + '"></label>' +
          '<label>ผู้บันทึก <select class="form-control" data-f="user"><option value="">ทุกคน</option><option value="-">(ไม่ได้เข้าสู่ระบบ)</option></select></label>' +
          '<label>เมนู <select class="form-control" data-f="module"><option value="">ทุกเมนู</option>' + Object.keys(MODULE).map(function (k) { return '<option value="' + k + '">' + MODULE[k] + '</option>'; }).join('') + '</select></label>' +
          '<button class="btn btn-primary" data-go><i class="bi bi-search"></i> ค้นหา</button>' +
          '<button class="btn btn-secondary" data-csv><i class="bi bi-filetype-csv"></i> CSV</button>' +
        '</div></div>' +
      '<div class="card" data-sum></div>' +
      '<div class="card"><div data-list class="text-muted">กำลังโหลด...</div><div style="text-align:center;margin-top:10px"><button class="btn btn-secondary hidden" data-more>โหลดเพิ่ม</button></div></div>';
    host.querySelector('[data-go]').onclick = function () { search(); };
    host.querySelector('[data-more]').onclick = function () { search(true); };
    host.querySelector('[data-csv]').onclick = exportCsv;
    host.querySelectorAll('[data-f]').forEach(function (el) { el.addEventListener('change', function () { search(); }); });
    search();
  }

  function params() {
    const f = function (k) { return host.querySelector('[data-f="' + k + '"]').value; };
    return { from: f('from'), to: f('to'), user_id: f('user'), module: f('module') };
  }

  async function search(more) {
    const p = more ? Object.assign({}, lastParams, { before: next }) : params();
    if (!more) lastParams = p;
    let r;
    try { r = await api('tt.write_log_list', Object.assign({ limit: 200 }, p), { loadingMsg: 'กำลังโหลดประวัติ...' }); }
    catch (e) { host.querySelector('[data-list]').innerHTML = '<div class="alert alert-danger">' + esc(e.message) + '</div>'; return; }
    rows = more ? rows.concat(r.rows) : r.rows;
    next = r.next;
    if (!more) { fillUsers(r.users); renderSummary(r); }
    renderList();
  }

  function fillUsers(users) {
    const sel = host.querySelector('[data-f="user"]'), cur = sel.value;
    sel.innerHTML = '<option value="">ทุกคน</option><option value="-">(ไม่ได้เข้าสู่ระบบ)</option>' + users.map(function (u) { return '<option value="' + esc(u.user_id) + '">' + esc(u.name) + '</option>'; }).join('');
    sel.value = cur;
  }

  function renderSummary(r) {
    const tot = r.by_module.reduce(function (a, x) { return a + x.n; }, 0);
    const chip = function (label, n, attr) { return '<button class="lg-chip" ' + attr + '><span data-no-i18n>' + esc(label) + '</span> <b>' + n + '</b></button>'; };
    host.querySelector('[data-sum]').innerHTML = '<div class="lg-sum"><div><strong>' + tot + '</strong> รายการ' + (tot ? ' ในช่วงที่เลือก' : '') + '</div>' +
      (r.by_user.length ? '<div class="lg-chips"><span class="su-note">ผู้บันทึก:</span> ' + r.by_user.map(function (u) { return chip(u.user_id ? (u.user_name || '-') : '(ไม่ได้เข้าสู่ระบบ)', u.n, 'data-u="' + esc(u.user_id || '-') + '"'); }).join('') + '</div>' : '') +
      (r.by_module.length ? '<div class="lg-chips"><span class="su-note">เมนู:</span> ' + r.by_module.map(function (m) { return chip(MODULE[m.module] || m.module, m.n, 'data-m="' + esc(m.module) + '"'); }).join('') + '</div>' : '') + '</div>';
    host.querySelectorAll('[data-sum] [data-u]').forEach(function (b) { b.onclick = function () { host.querySelector('[data-f="user"]').value = b.dataset.u; search(); }; });
    host.querySelectorAll('[data-sum] [data-m]').forEach(function (b) { b.onclick = function () { host.querySelector('[data-f="module"]').value = b.dataset.m; search(); }; });
  }

  function renderList() {
    const box = host.querySelector('[data-list]');
    host.querySelector('[data-more]').classList.toggle('hidden', !next);
    if (!rows.length) { box.innerHTML = '<div class="alert alert-info" style="margin:0">ไม่มีประวัติการบันทึกในช่วงนี้</div>'; return; }
    box.innerHTML = '<div class="table-wrap"><table class="su-table lg-table"><thead><tr><th>เวลา</th><th>ผู้บันทึก</th><th>เมนู</th><th>รายการ</th><th>วันที่ข้อมูล</th><th>ชั้น</th><th>จำนวน</th><th>เป้าหมาย / รายละเอียด</th></tr></thead><tbody>' +
      rows.map(function (r) {
        return '<tr><td class="nw">' + esc(Utils.fmtDateTime(r.at)) + '</td>' +
          '<td>' + (r.user_id ? '<span data-no-i18n>' + esc(r.user_name) + '</span><div class="su-note">' + esc(r.role) + '</div>' : '<span class="su-badge off">ไม่ได้เข้าสู่ระบบ</span>') + '</td>' +
          '<td class="nw">' + esc(MODULE[r.module] || r.module) + '</td><td>' + esc(actLabel(r)) + '</td>' +
          '<td class="nw">' + (r.ref_date ? esc(Utils.fmtDateThai(r.ref_date)) : '') + '</td><td class="nw">' + esc(cls(r)) + '</td><td>' + (r.n > 1 ? r.n : '') + '</td>' +
          '<td><span data-no-i18n>' + esc(r.target_label || r.target) + '</span>' + (detailText(r) ? '<div class="su-note">' + esc(detailText(r)) + '</div>' : '') + '</td></tr>';
      }).join('') + '</tbody></table></div>' +
      '<p class="su-note" style="margin:8px 0 0">แสดง ' + rows.length + ' รายการ' + (next ? ' (ยังมีอีก — กด "โหลดเพิ่ม")' : '') + '</p>';
  }

  /** CSV: ดึงต่อจนครบ (สูงสุด 5,000 รายการ) ตามตัวกรองปัจจุบัน */
  async function exportCsv() {
    const p = params(); let all = [], cur = '';
    Loading.show('กำลังเตรียม CSV...');
    try {
      do {
        const r = await api('tt.write_log_list', Object.assign({ limit: 500 }, p, cur ? { before: cur } : {}), { loading: false, silent: true });
        all = all.concat(r.rows); cur = r.next;
      } while (cur && all.length < 5000);
    } catch (e) { Loading.hide(); Toast.show('ส่งออกไม่สำเร็จ: ' + e.message, 'danger'); return; }
    Loading.hide();
    const head = ['เวลา', 'ผู้บันทึก', 'บทบาท', 'เมนู', 'รายการ', 'วันที่ข้อมูล', 'ชั้น', 'จำนวน', 'เป้าหมาย', 'รายละเอียด'];
    const lines = [head].concat(all.map(function (r) {
      return [r.at.replace('T', ' '), r.user_id ? r.user_name : '(ไม่ได้เข้าสู่ระบบ)', r.role, MODULE[r.module] || r.module, actLabel(r), r.ref_date, cls(r), r.n, r.target_label || r.target, detailText(r)];
    }));
    const csv = '﻿' + lines.map(function (row) { return row.map(function (v) { v = v == null ? '' : String(v); return /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; }).join(','); }).join('\r\n');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    a.download = 'ประวัติการบันทึก ' + p.from + ' ถึง ' + p.to + '.csv';
    document.body.appendChild(a); a.click(); setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 500);
    if (all.length >= 5000) Toast.show('ส่งออก 5,000 รายการแรก — เลือกช่วงวันที่ให้แคบลงเพื่อดูส่วนที่เหลือ', 'warning', 6000);
  }

  document.querySelectorAll('.tab[data-tab="log"]').forEach(function (t) { t.addEventListener('click', start); });
  if (location.hash === '#log') { const t = document.querySelector('.tab[data-tab="log"]'); if (t) t.click(); }
})();
