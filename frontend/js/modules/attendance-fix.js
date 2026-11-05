/**
 * เช็คการมาเรียน › แก้วันที่เช็คผิด (แท็บ 🛠️ ใน attendance.html)
 *   วันที่มีการเช็คในเดือน (ธงเตือน เสาร์–อาทิตย์ / วันหยุด / อนาคต) → ย้ายไปวันที่ถูกต้อง หรือ ลบ (ไปถังกู้คืน)
 *   วันหยุดโรงเรียน: ไม่นับในรายงานรายเดือน (ไม่ลบข้อมูล) · ถังกู้คืน: กู้คืนทั้งชุด
 * window.AttFix.move / remove ใช้จากแท็บเช็คชื่อด้วย (ปุ่มใต้ตารางรายชื่อ)
 */
(function () {
  const esc = Utils.esc;
  const byEl = document.getElementById('fx-by');
  let monthsLoaded = false;

  /* ── ชื่อผู้แก้ไข (จำไว้ในเครื่อง ใช้ร่วมกับช่องผู้บันทึกในแท็บเช็คชื่อ) ── */
  try { byEl.value = Store.get('att:by') || ''; } catch (e) { /* ignore */ }
  function rememberBy(v) { try { Store.set('att:by', v); } catch (e) { /* ignore */ } }
  byEl.onchange = function () { byEl.value = byEl.value.trim(); rememberBy(byEl.value); };
  function by() {
    let v = byEl.value.trim() || (document.getElementById('rec-by').value || '').trim();
    if (!v) {
      v = (prompt('พิมพ์ชื่อครูผู้แก้ไข (บันทึกไว้ในประวัติการแก้ไข)') || '').trim();
      if (v) { byEl.value = v; rememberBy(v); }
    }
    return v;
  }
  function clsLabel(g, r) { return g + (r ? '/' + r : ''); }
  function dayLabel(d) { return Utils.fmtDateThai(d); }
  function invalidate() { try { Store.invalidate('attendance:'); Store.invalidate('attreport:'); } catch (e) { /* ignore */ } }

  function modal(html) {
    const el = document.createElement('div');
    el.className = 'modal-backdrop show';
    el.innerHTML = '<div class="modal" style="max-width:440px">' + html + '</div>';
    document.body.appendChild(el);
    el.close = function () { el.remove(); };
    el.querySelectorAll('[data-x]').forEach(function (b) { b.onclick = el.close; });
    return el;
  }

  /** ย้ายการเช็คชื่อ — o = { date, grade?, room? } (ไม่มี grade = ทั้งวัน) */
  function move(o, done) {
    const who = by();
    if (!who) return;
    const scope = o.grade ? 'ชั้น ' + clsLabel(o.grade, o.room) : 'ทุกชั้น';
    const el = modal('<h3 class="modal-title">📅 ย้ายการเช็คชื่อ</h3>' +
      '<p>จาก <strong>' + esc(dayLabel(o.date)) + '</strong> · ' + esc(scope) + '</p>' +
      '<label>ไปวันที่ (วันที่ถูกต้อง)</label><input class="form-control" type="date" data-to value="' + esc(o.date) + '" max="' + Utils.todayYmd() + '">' +
      '<div class="text-muted" style="font-size:13px;margin-top:6px">สถานะ มา/ขาด/ลา/สาย ของแต่ละคนย้ายไปตามเดิม</div>' +
      '<div class="flex" style="justify-content:flex-end;gap:8px;margin-top:14px"><button class="btn btn-secondary" data-x>ยกเลิก</button><button class="btn btn-primary" data-ok>ย้าย</button></div>');
    el.querySelector('[data-ok]').onclick = async function () {
      const to = el.querySelector('[data-to]').value;
      if (!to || to === o.date) { Toast.show('เลือกวันที่ใหม่ที่ต่างจากเดิม', 'warning'); return; }
      const p = { date: o.date, to_date: to, grade: o.grade || '', room: o.room || '', all: !o.grade, by: who };
      try {
        let r;
        try { r = await api('attendance.move_day', p, { loadingMsg: 'กำลังย้าย...', noRetry: true, silent: true }); }
        catch (e) {
          if (e.code !== 'CONFLICT') throw e;
          if (!confirm(e.message + '\n\nกด OK เพื่อเขียนทับ')) return;
          r = await api('attendance.move_day', Object.assign(p, { overwrite: true }), { loadingMsg: 'กำลังย้าย...', noRetry: true, silent: true });
        }
        el.close(); invalidate();
        Toast.show('ย้ายแล้ว ' + r.moved + ' คน → ' + dayLabel(r.to) + (r.overwritten ? ' (ข้อมูลเดิมของวันนั้น ' + r.overwritten + ' คนอยู่ในถังกู้คืน)' : ''), 'success', 5000);
        if (done) done();
      } catch (e) { Toast.show(e.message || 'ย้ายไม่สำเร็จ', 'danger'); }
    };
  }

  /** ลบการเช็คชื่อ → ถังกู้คืน — o = { date, grade?, room?, count? } */
  async function remove(o, done) {
    const who = by();
    if (!who) return;
    const scope = o.grade ? 'ชั้น ' + clsLabel(o.grade, o.room) : 'ทุกชั้น';
    if (!confirm('ลบการเช็คชื่อวันที่ ' + dayLabel(o.date) + ' · ' + scope + (o.count ? ' (' + o.count + ' คน)' : '') + '?\n\nข้อมูลจะย้ายไปถังกู้คืน กู้คืนได้ภายหลัง')) return;
    try {
      const r = await api('attendance.remove_day', { date: o.date, grade: o.grade || '', room: o.room || '', all: !o.grade, by: who, reason: 'เช็ควันผิด' }, { loadingMsg: 'กำลังลบ...', noRetry: true });
      invalidate();
      Toast.show('ลบแล้ว ' + r.removed + ' คน (อยู่ในถังกู้คืน)', 'success');
      if (done) done();
    } catch (e) { /* toast */ }
  }
  window.AttFix = { move: move, remove: remove };

  /* ════ แท็บแก้วันที่เช็คผิด ════ */
  async function loadMonths() {
    if (monthsLoaded) return;
    const sel = document.getElementById('fx-month');
    try {
      const d = await api('attendance.report_months', {}, { silent: true, loading: false });
      sel.innerHTML = (d.months || []).map(function (ym) {
        return '<option value="' + ym + '">' + Utils.fmtDateThai(ym + '-01').replace(/^1 /, '') + '</option>';
      }).join('');
      monthsLoaded = true;
    } catch (e) { /* ignore */ }
  }

  async function loadDays() {
    const host = document.getElementById('fx-days');
    const ym = document.getElementById('fx-month').value;
    if (!ym) { host.innerHTML = '<div class="text-muted">ยังไม่มีข้อมูล</div>'; return; }
    host.innerHTML = '<div class="text-muted">กำลังโหลด...</div>';
    let d;
    try { d = await api('attendance.days', { year_month: ym }, { loading: false }); } catch (e) { host.innerHTML = ''; return; }
    const flagged = d.days.filter(function (x) { return x.weekend || x.holiday || x.future; }).length;
    host.innerHTML = (flagged ? '<div class="alert alert-warning" style="font-size:14px">⚠️ พบ ' + flagged + ' วันที่น่าจะเช็คผิด (แถบสีส้ม/เทา) — ตรวจแล้วย้ายหรือลบ</div>' : '') +
      (!d.days.length ? '<div class="text-muted">ไม่มีการเช็คชื่อในเดือนนี้</div>' : d.days.map(function (x, i) {
        const flags = (x.weekend ? '<span class="fx-flag we">วัน' + esc(x.weekday) + '</span>' : '') + (x.holiday ? '<span class="fx-flag ho">วันหยุด: ' + esc(x.holiday) + '</span>' : '') + (x.future ? '<span class="fx-flag fu">วันในอนาคต</span>' : '');
        return '<div class="fx-day' + (x.holiday ? ' hol' : (x.weekend || x.future ? ' warn' : '')) + '" data-i="' + i + '"><div class="hd"><div><strong>' + esc(dayLabel(x.date)) + '</strong> <span class="text-muted">วัน' + esc(x.weekday) + '</span>' + flags +
          ' <span class="text-muted" style="font-size:13px">· ' + x.count + ' คน · ' + x.classes.length + ' ชั้น</span></div>' +
          '<div class="fx-bar"><button class="btn btn-secondary" data-mv style="padding:4px 10px;font-size:13px"><i class="bi bi-calendar-event"></i> ย้ายทั้งวัน</button>' +
          '<button class="btn btn-danger" data-rm style="padding:4px 10px;font-size:13px"><i class="bi bi-trash"></i> ลบทั้งวัน</button></div></div>' +
          '<div class="fx-cls">' + x.classes.map(function (c, j) {
            return '<span title="' + esc('ผู้เช็ค: ' + (c.recorded_by || '-')) + '">' + esc(clsLabel(c.grade, c.room)) + ' (' + c.count + ')' +
              '<button data-cmv="' + j + '" title="ย้ายชั้นนี้" aria-label="ย้าย ' + esc(clsLabel(c.grade, c.room)) + '">📅</button><button data-crm="' + j + '" title="ลบชั้นนี้" aria-label="ลบ ' + esc(clsLabel(c.grade, c.room)) + '">🗑️</button></span>';
          }).join('') + '</div></div>';
      }).join(''));
    const refresh = function () { loadDays(); loadTrash(); };
    host.querySelectorAll('.fx-day').forEach(function (box) {
      const x = d.days[Number(box.dataset.i)];
      box.querySelector('[data-mv]').onclick = function () { move({ date: x.date }, refresh); };
      box.querySelector('[data-rm]').onclick = function () { remove({ date: x.date, count: x.count }, refresh); };
      box.querySelectorAll('[data-cmv]').forEach(function (b) { const c = x.classes[Number(b.dataset.cmv)]; b.onclick = function () { move({ date: x.date, grade: c.grade, room: c.room }, refresh); }; });
      box.querySelectorAll('[data-crm]').forEach(function (b) { const c = x.classes[Number(b.dataset.crm)]; b.onclick = function () { remove({ date: x.date, grade: c.grade, room: c.room, count: c.count }, refresh); }; });
    });
  }

  async function loadHolidays() {
    const host = document.getElementById('hol-list');
    let d;
    try { d = await api('attendance.holidays', {}, { loading: false, silent: true }); } catch (e) { host.innerHTML = ''; return; }
    const list = d.holidays.slice().reverse();
    host.innerHTML = !list.length ? '<div class="text-muted">ยังไม่ได้ตั้งวันหยุด</div>' :
      '<div class="table-wrap" style="max-height:320px;overflow:auto"><table><thead><tr><th>วันที่</th><th>ชื่อ</th><th></th></tr></thead><tbody>' +
      list.map(function (h, i) { return '<tr><td>' + esc(dayLabel(h.date)) + '</td><td>' + esc(h.name) + '</td><td style="text-align:right"><button class="btn btn-secondary" data-del="' + i + '" style="padding:3px 10px;font-size:13px;margin:0">ลบ</button></td></tr>'; }).join('') +
      '</tbody></table></div>';
    host.querySelectorAll('[data-del]').forEach(function (b) {
      const h = list[Number(b.dataset.del)];
      b.onclick = async function () {
        const who = by();
        if (!who || !confirm('ยกเลิกวันหยุด ' + dayLabel(h.date) + ' (' + h.name + ')?\nการเช็คชื่อของวันนั้น (ถ้ามี) จะกลับมานับในรายงาน')) return;
        try { await api('attendance.holiday_delete', { date: h.date, by: who }, { loadingMsg: 'กำลังลบ...', noRetry: true }); invalidate(); loadHolidays(); loadDays(); } catch (e) { /* toast */ }
      };
    });
  }
  document.getElementById('hol-add').onclick = async function () {
    const from = document.getElementById('hol-from').value, to = document.getElementById('hol-to').value, name = document.getElementById('hol-name').value.trim();
    if (!from) { Toast.show('เลือกวันที่', 'warning'); return; }
    if (!name) { Toast.show('พิมพ์ชื่อวันหยุด', 'warning'); return; }
    const who = by();
    if (!who) return;
    try {
      const r = await api('attendance.holiday_save', { date: from, to_date: to || from, name: name, by: who }, { loadingMsg: 'กำลังบันทึก...', noRetry: true });
      invalidate();
      Toast.show('ตั้งวันหยุดแล้ว ' + r.saved + ' วัน', 'success');
      document.getElementById('hol-to').value = ''; document.getElementById('hol-name').value = '';
      loadHolidays(); loadDays();
    } catch (e) { /* toast */ }
  };

  async function loadTrash() {
    const host = document.getElementById('fx-trash');
    let d;
    try { d = await api('attendance.trash_list', {}, { loading: false, silent: true }); } catch (e) { host.innerHTML = ''; return; }
    host.innerHTML = !d.batches.length ? '<div class="text-muted">ถังกู้คืนว่าง</div>' :
      '<div class="table-wrap"><table><thead><tr><th>ลบเมื่อ</th><th>วันที่เช็ค</th><th>ชั้น</th><th>จำนวน</th><th>โดย</th><th></th></tr></thead><tbody>' +
      d.batches.map(function (b, i) {
        return '<tr><td>' + esc(Utils.fmtDateTime(b.deleted_at)) + '<div class="text-muted" style="font-size:12px">' + esc(b.reason || '') + '</div></td><td>' + esc(b.dates.map(dayLabel).join(', ')) + '</td><td>' + esc(b.classes.join(', ') || '-') + '</td>' +
          '<td>' + b.count + '</td><td>' + esc(b.deleted_by || '') + '</td><td style="text-align:right"><button class="btn btn-secondary" data-rs="' + i + '" style="padding:3px 10px;font-size:13px;margin:0"><i class="bi bi-arrow-counterclockwise"></i> กู้คืน</button></td></tr>';
      }).join('') + '</tbody></table></div>';
    host.querySelectorAll('[data-rs]').forEach(function (btn) {
      const b = d.batches[Number(btn.dataset.rs)];
      btn.onclick = async function () {
        const who = by();
        if (!who || !confirm('กู้คืนการเช็คชื่อ ' + b.count + ' รายการ?\n(คนที่ตอนนี้มีการเช็คในวันเดียวกันอยู่แล้วจะถูกข้าม ไม่เขียนทับ)')) return;
        try {
          const r = await api('attendance.trash_restore', { batch_id: b.batch_id, by: who }, { loadingMsg: 'กำลังกู้คืน...', noRetry: true });
          invalidate();
          Toast.show('กู้คืนแล้ว ' + r.restored + ' รายการ' + (r.skipped ? ' · ข้าม ' + r.skipped + ' (มีข้อมูลวันเดียวกันอยู่แล้ว)' : ''), r.skipped ? 'warning' : 'success', 5000);
          loadTrash(); loadDays();
        } catch (e) { /* toast */ }
      };
    });
  }

  document.getElementById('fx-month').onchange = loadDays;
  document.querySelector('.tab[data-tab=fix]').addEventListener('click', async function () {
    await loadMonths();
    loadDays(); loadHolidays(); loadTrash();
  });
  if (location.hash === '#fix') document.querySelector('.tab[data-tab=fix]').click();   // ลิงก์จากหน้ารายงาน
})();
