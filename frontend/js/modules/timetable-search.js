/**
 * AI Smart Timetable — เฟส 4: ค้นหา (โมดูล 10)
 *   - ค้นหาหลายเงื่อนไข: คำค้น · ชั้น · ครู · วิชา · ห้อง · กลุ่มสาระ · ประเภทวิชา · วัน · คาบ · สถานะ → ส่งออก CSV/Excel · คลิกเพื่อไปแก้
 *   - หาครูว่าง (หาครูสอนแทน) ณ วัน/คาบที่เลือก เรียงจากภาระวันนั้นน้อยสุด
 *   - หาเวลาว่างร่วมของครูหลายคน (นัดประชุม)
 * อ่านอย่างเดียว · ใช้ข้อมูลจาก window.TTData (timetable-report.js)
 */
(function () {
  const esc = Utils.esc;
  const STATUS = { generated: 'จัดเสร็จ (AI)', edited: 'แก้ไขแล้ว', draft: 'ร่าง', approved: 'อนุมัติแล้ว', published: 'เผยแพร่แล้ว' };
  const TYPES = { core: 'วิชาพื้นฐาน', elective: 'วิชาเพิ่มเติม', practical: 'วิชาปฏิบัติ', activity: 'กิจกรรม' };
  const LEVEL = { error: '🔴', warning: '🟡', '': '🟢' };
  const MAX_ROWS = 300;
  const host = document.getElementById('tab-search');
  const F = { q: '', unit: '', teacher: '', subject: '', room: '', dept: '', type: '', day: '', period: '', status: '' };
  let results = [], picked = {};

  function S() { return TT.S; }
  function opts(list, cur) { return list.map(function (o) { return '<option value="' + esc(o[0]) + '"' + (o[0] === cur ? ' selected' : '') + '>' + esc(o[1]) + '</option>'; }).join(''); }

  function shell() {
    host.innerHTML =
      '<div class="card">' +
        '<div class="flex" style="justify-content:space-between;flex-wrap:wrap;gap:8px;margin-bottom:10px">' +
          '<h3 class="card-title" style="margin:0">🔎 ค้นหาในตาราง</h3><select class="form-control" data-ver style="max-width:320px"></select></div>' +
        '<div class="tt-filters" data-filters></div>' +
        '<div class="tt-toolbar" style="margin-top:10px"><span data-count class="tt-note"></span><span style="flex:1"></span>' +
          '<button class="btn btn-secondary" data-clear><i class="bi bi-x-circle"></i> ล้างเงื่อนไข</button>' +
          '<button class="btn btn-secondary" data-csv><i class="bi bi-filetype-csv"></i> CSV</button>' +
          '<button class="btn btn-success" data-xlsx><i class="bi bi-file-earmark-excel"></i> Excel</button></div>' +
        '<div data-results></div>' +
      '</div>' +
      '<div class="card"><h3 class="card-title">🙋 หาครูว่าง (หาครูสอนแทน)</h3>' +
        '<div class="tt-toolbar"><select class="form-control" data-fday></select><select class="form-control" data-fper></select></div>' +
        '<div data-free></div></div>' +
      '<div class="card"><h3 class="card-title">📅 หาเวลาว่างร่วม (นัดประชุม)</h3>' +
        '<div class="tt-note" style="margin-bottom:6px">เลือกครูตั้งแต่ 1 คนขึ้นไป — ช่องสีเขียวคือเวลาที่ทุกคนว่าง</div>' +
        '<div class="tt-checks" data-pick></div><div data-common style="margin-top:10px"></div></div>';

    host.querySelector('[data-ver]').onchange = function () { if (this.value) TTData.load(this.value).catch(function () {}); };
    host.querySelector('[data-clear]').onclick = function () { Object.keys(F).forEach(function (k) { F[k] = ''; }); renderFilters(); search(); };
    host.querySelector('[data-csv]').onclick = function () { exportResults('csv'); };
    host.querySelector('[data-xlsx]').onclick = function () { exportResults('xlsx'); };
    host.querySelector('[data-fday]').onchange = renderFree;
    host.querySelector('[data-fper]').onchange = renderFree;
  }

  function renderVersions() {
    const vs = S().versions || [];
    host.querySelector('[data-ver]').innerHTML = vs.length ? vs.map(function (v) {
      return '<option value="' + esc(v.version_id) + '"' + (v.version_id === TTData.vid ? ' selected' : '') + '>' + esc(v.label) + ' · ' + esc(STATUS[v.status] || v.status) + '</option>';
    }).join('') : '<option value="">— ยังไม่มีฉบับตาราง —</option>';
  }

  function renderFilters() {
    const d = TTData.data;
    const depts = {};
    S().teachers.forEach(function (t) { if (t.dept) depts[t.dept] = 1; });
    const ps = TTData.teachPeriods();
    const all = [['', 'ทั้งหมด']];
    const fields = [
      ['q', 'คำค้น', '<input class="form-control" data-f="q" placeholder="วิชา ครู ชั้น ห้อง..." value="' + esc(F.q) + '">'],
      ['unit', 'ชั้นเรียน', '<select class="form-control" data-f="unit">' + opts(all.concat(((d && d.units) || []).map(function (u) { return [u.unit_id, u.label]; })), F.unit) + '</select>'],
      ['teacher', 'ครู', '<select class="form-control" data-f="teacher">' + opts(all.concat(S().teachers.map(function (t) { return [t.teacher_id, TT.teacherName(t)]; })).concat([['__none', '— ยังไม่ระบุครู —']]), F.teacher) + '</select>'],
      ['subject', 'วิชา', '<select class="form-control" data-f="subject">' + opts(all.concat(S().subjects.map(function (s) { return [s.subject_id, s.name]; })), F.subject) + '</select>'],
      ['room', 'ห้อง', '<select class="form-control" data-f="room">' + opts(all.concat(S().rooms.map(function (r) { return [r.room_id, r.name]; })).concat([['__none', '— ไม่ระบุห้อง —']]), F.room) + '</select>'],
      ['dept', 'กลุ่มสาระ (ของครู)', '<select class="form-control" data-f="dept">' + opts(all.concat(Object.keys(depts).map(function (x) { return [x, x]; })), F.dept) + '</select>'],
      ['type', 'ประเภทวิชา', '<select class="form-control" data-f="type">' + opts(all.concat(Object.keys(TYPES).map(function (k) { return [k, TYPES[k]]; })), F.type) + '</select>'],
      ['day', 'วัน', '<select class="form-control" data-f="day">' + opts(all.concat([1, 2, 3, 4, 5].map(function (x) { return [String(x), TT.DAY_NAMES[x]]; })), F.day) + '</select>'],
      ['period', 'คาบ', '<select class="form-control" data-f="period">' + opts(all.concat(ps.map(function (p) { return [p.period_id, p.label + ' (' + TTData.pTime(p) + ')']; })), F.period) + '</select>'],
      ['status', 'สถานะ', '<select class="form-control" data-f="status">' + opts([['', 'ทั้งหมด'], ['problem', 'มีปัญหา (แดง/เหลือง)'], ['error', '🔴 ข้อผิดพลาด'], ['warning', '🟡 คำเตือน'], ['ok', '🟢 ผ่าน'], ['locked', '🔒 ล็อกไว้']], F.status) + '</select>'],
    ];
    host.querySelector('[data-filters]').innerHTML = fields.map(function (f) { return '<div><label>' + f[1] + '</label>' + f[2] + '</div>'; }).join('');
    const go = Utils.debounce(search, 200);
    host.querySelectorAll('[data-f]').forEach(function (el) {
      el.addEventListener(el.tagName === 'INPUT' ? 'input' : 'change', function () { F[el.dataset.f] = el.value; go(); });
    });
  }

  function match(e) {
    if (F.unit && e.u.unit_id !== F.unit) return false;
    if (F.teacher && (F.teacher === '__none' ? !!e.t : !e.t || e.t.teacher_id !== F.teacher)) return false;
    if (F.subject && (!e.s || e.s.subject_id !== F.subject)) return false;
    if (F.room && (F.room === '__none' ? !!e.r : !e.r || e.r.room_id !== F.room)) return false;
    if (F.dept && (!e.t || e.t.dept !== F.dept)) return false;
    if (F.type && (!e.s || (e.s.type || 'core') !== F.type)) return false;
    if (F.day && e.day !== Number(F.day)) return false;
    if (F.period && e.pid !== F.period) return false;
    if (F.status === 'problem' && !e.level) return false;
    if ((F.status === 'error' || F.status === 'warning') && e.level !== F.status) return false;
    if (F.status === 'ok' && e.level) return false;
    if (F.status === 'locked' && !e.locked) return false;
    if (F.q) {
      const hay = [e.s && e.s.name, e.s && e.s.code, e.t && TT.teacherName(e.t), e.t && e.t.code, e.u.label, e.r && e.r.name, TT.DAY_NAMES[e.day], e.p.label].join(' ').toLowerCase();
      if (!F.q.toLowerCase().split(/\s+/).filter(Boolean).every(function (w) { return hay.indexOf(w) >= 0; })) return false;
    }
    return true;
  }

  function search() {
    const box = host.querySelector('[data-results]');
    const d = TTData.data;
    if (!d) { box.innerHTML = '<div class="text-muted">' + ((S().versions || []).length ? 'กำลังโหลด...' : 'ยังไม่มีฉบับตาราง') + '</div>'; host.querySelector('[data-count]').textContent = ''; return; }
    results = d.entries.filter(match);
    host.querySelector('[data-count]').textContent = 'พบ ' + Utils.fmtInt(results.length) + ' คาบ' + (results.length > MAX_ROWS ? ' (แสดง ' + MAX_ROWS + ' รายการแรก — ส่งออกได้ครบ)' : '');
    if (!results.length) { box.innerHTML = '<div class="text-muted" style="padding:10px 0">ไม่พบคาบที่ตรงเงื่อนไข</div>'; return; }
    const shown = results.slice(0, MAX_ROWS);
    box.innerHTML = '<div class="table-wrap"><table class="tt-results"><thead><tr><th>วัน</th><th>คาบ</th><th>เวลา</th><th>ชั้น</th><th>วิชา</th><th>ครู</th><th>ห้อง</th><th>สถานะ</th></tr></thead><tbody>' +
      shown.map(function (e, i) {
        return '<tr data-i="' + i + '" title="คลิกเพื่อไปแก้ไขคาบนี้"><td>' + TT.DAY_NAMES[e.day] + '</td><td>' + esc(e.p.label) + '</td><td class="tt-note">' + esc(TTData.pTime(e.p)) + '</td>' +
          '<td>' + esc(e.u.label) + '</td><td><span class="tt-dot ty-' + esc((e.s && e.s.type) || 'core') + '"></span>' + esc(e.s ? e.s.name : '?') + '</td>' +
          '<td>' + (e.t ? esc(TT.teacherName(e.t)) : '<span class="text-danger">ยังไม่ระบุ</span>') + '</td><td>' + (e.r ? esc(e.r.name) : '-') + '</td>' +
          '<td>' + LEVEL[e.level] + (e.locked ? ' 🔒' : '') + '</td></tr>';
      }).join('') + '</tbody></table></div>';
    box.querySelectorAll('[data-i]').forEach(function (tr) {
      tr.onclick = function () { const e = shown[Number(tr.dataset.i)]; window.TTEdit.open(TTData.vid, { unit: e.u.unit_id, k: e.k }); };
    });
  }

  async function exportResults(kind) {
    if (!results.length) { Toast.show('ไม่มีผลการค้นหาให้ส่งออก', 'warning'); return; }
    const head = ['วัน', 'คาบ', 'เวลา', 'ชั้น', 'วิชา', 'ครู', 'กลุ่มสาระ', 'ห้อง', 'สถานะ', 'ล็อก'];
    const lv = { error: 'ข้อผิดพลาด', warning: 'คำเตือน', '': 'ผ่าน' };
    const rows = results.map(function (e) {
      return [TT.DAY_NAMES[e.day], e.p.label, TTData.pTime(e.p), e.u.label, e.s ? e.s.name : '', e.t ? TT.teacherName(e.t) : '', (e.t && e.t.dept) || '', e.r ? e.r.name : '', lv[e.level], e.locked ? 'ล็อก' : ''];
    });
    const file = 'timetable_search_' + new Date().toISOString().slice(0, 10);
    if (kind === 'csv') { TTData.download(new Blob([TTData.csvText([head].concat(rows))], { type: 'text/csv;charset=utf-8' }), file + '.csv'); return; }
    try {
      Loading.show('กำลังสร้าง Excel...');
      await LazyLib.xlsx();
      const wb = XLSX.utils.book_new(), ws = XLSX.utils.aoa_to_sheet([head].concat(rows));
      ws['!cols'] = [8, 8, 12, 14, 30, 28, 22, 14, 10, 6].map(function (w) { return { wch: w }; });
      XLSX.utils.book_append_sheet(wb, ws, 'ผลการค้นหา');
      XLSX.writeFile(wb, file + '.xlsx');
    } catch (e) { Toast.show('ส่งออกไม่สำเร็จ: ' + e.message, 'danger'); }
    finally { Loading.hide(); }
  }

  /* ════ ความว่างของครู ════ */
  /** สถานะของครู ณ ช่อง → { free:bool, why } */
  function teacherAt(t, day, pid, byKey) {
    const list = byKey[t.teacher_id + '|' + day + '|' + pid];
    if (list) return { free: false, why: 'สอน ' + TTData.shortSubject(list[0].s && list[0].s.name) + ' ' + list.map(function (e) { return e.u.label; }).join(', ') };
    if ((t.off_days || []).map(Number).indexOf(day) >= 0) return { free: false, why: 'วันหยุดประจำ' };
    if ((t.unavailable || []).some(function (x) { return Number(x.day) === day && x.period_id === pid; })) return { free: false, why: 'ช่วงที่แจ้งว่าไม่ว่าง' };
    return { free: true };
  }
  function teacherIndex() {
    const m = {}, perDay = {};
    TTData.data.entries.forEach(function (e) {
      if (!e.t) return;
      (m[e.t.teacher_id + '|' + e.day + '|' + e.pid] = m[e.t.teacher_id + '|' + e.day + '|' + e.pid] || []).push(e);
    });
    Object.keys(m).forEach(function (k) { const p = k.split('|'); perDay[p[0] + '|' + p[1]] = (perDay[p[0] + '|' + p[1]] || 0) + 1; });
    return { byKey: m, perDay: perDay };
  }

  function renderFree() {
    const box = host.querySelector('[data-free]');
    const dSel = host.querySelector('[data-fday]'), pSel = host.querySelector('[data-fper]');
    const ps = TTData.teachPeriods();
    if (!dSel.options.length) {
      dSel.innerHTML = [1, 2, 3, 4, 5].map(function (x) { return '<option value="' + x + '">วัน' + TT.DAY_NAMES[x] + '</option>'; }).join('');
      const today = new Date().getDay();
      if (today >= 1 && today <= 5) dSel.value = String(today);
    }
    if (pSel.options.length !== ps.length) pSel.innerHTML = ps.map(function (p) { return '<option value="' + esc(p.period_id) + '">' + esc(p.label + ' (' + TTData.pTime(p) + ')') + '</option>'; }).join('');
    if (!TTData.data) { box.innerHTML = ''; return; }
    const day = Number(dSel.value), pid = pSel.value, ix = teacherIndex();
    const free = [], busy = [];
    S().teachers.forEach(function (t) {
      const st = teacherAt(t, day, pid, ix.byKey), n = ix.perDay[t.teacher_id + '|' + day] || 0;
      (st.free ? free : busy).push({ t: t, why: st.why, n: n });
    });
    free.sort(function (a, b) { return a.n - b.n; });
    box.innerHTML = '<div class="tt-free">' +
      '<div><div class="tt-note" style="margin-bottom:6px">✅ ว่าง ' + free.length + ' คน (เรียงจากสอนน้อยสุดในวันนั้น)</div>' +
        (free.map(function (x, i) { return '<div class="tt-person ok">' + (i === 0 ? '⭐ ' : '') + '<strong>' + esc(TT.teacherName(x.t)) + '</strong><span class="tt-note">วันนี้สอน ' + x.n + ' คาบ' + (x.t.dept ? ' · ' + esc(x.t.dept) : '') + '</span></div>'; }).join('') || '<div class="text-muted">ไม่มีครูว่าง</div>') + '</div>' +
      '<div><div class="tt-note" style="margin-bottom:6px">⛔ ไม่ว่าง ' + busy.length + ' คน</div>' +
        (busy.map(function (x) { return '<div class="tt-person busy"><strong>' + esc(TT.teacherName(x.t)) + '</strong><span class="tt-note">' + esc(x.why) + '</span></div>'; }).join('') || '<div class="text-muted">-</div>') + '</div>' +
      '</div>';
  }

  function renderCommon() {
    const pick = host.querySelector('[data-pick]');
    pick.innerHTML = S().teachers.map(function (t) {
      return '<label class="tt-chip"><input type="checkbox" value="' + esc(t.teacher_id) + '"' + (picked[t.teacher_id] ? ' checked' : '') + '> ' + esc(TT.teacherName(t)) + '</label>';
    }).join('') || '<span class="text-muted">ยังไม่มีข้อมูลครู</span>';
    pick.querySelectorAll('input').forEach(function (c) { c.onchange = function () { if (c.checked) picked[c.value] = 1; else delete picked[c.value]; drawCommon(); }; });
    drawCommon();
  }
  function drawCommon() {
    const box = host.querySelector('[data-common]');
    const ts = S().teachers.filter(function (t) { return picked[t.teacher_id]; });
    if (!TTData.data || !ts.length) { box.innerHTML = ''; return; }
    const ix = teacherIndex(), ps = TTData.periods();
    let nFree = 0;
    box.innerHTML = '<div class="table-wrap"><table class="tt-tt tt-common"><thead><tr><th>วัน</th>' +
      ps.map(function (p) { return '<th>' + esc(p.label) + '<br><span class="tt-note">' + esc(TTData.pTime(p)) + '</span></th>'; }).join('') + '</tr></thead><tbody>' +
      [1, 2, 3, 4, 5].map(function (day) {
        return '<tr><th>' + TT.DAY_NAMES[day] + '</th>' + ps.map(function (p) {
          if (String(p.is_break) === '1') return '<td class="free" title="ช่วงพัก — ทุกคนว่าง">' + esc(p.label) + '</td>';
          const bs = ts.map(function (t) { const st = teacherAt(t, day, p.period_id, ix.byKey); return st.free ? null : TTData.shortTeacher(t) + ': ' + st.why; }).filter(Boolean);
          if (!bs.length) nFree++;
          return bs.length ? '<td class="busy" title="' + esc(bs.join('\n')) + '">ไม่ว่าง ' + bs.length + '/' + ts.length + '</td>' : '<td class="free">✓ ว่าง</td>';
        }).join('') + '</tr>';
      }).join('') + '</tbody></table></div><div class="tt-note" style="margin-top:6px">ว่างพร้อมกัน ' + nFree + ' คาบเรียนต่อสัปดาห์ (ไม่นับช่วงพัก) · ชี้ที่ช่องเพื่อดูว่าใครไม่ว่าง</div>';
  }

  function renderAll() {
    renderVersions();
    renderFilters();
    search();
    renderFree();
    renderCommon();
  }

  document.querySelectorAll('#tt-tabs .tab').forEach(function (t) {
    t.addEventListener('click', function () {
      if (t.dataset.tab !== 'search') return;
      if (!host.querySelector('[data-ver]')) shell();
      const vid = TTData.vid && (S().versions || []).some(function (v) { return v.version_id === TTData.vid; }) ? TTData.vid : TTData.defaultVersion();
      renderAll();
      if (vid) TTData.load(vid).catch(function () {});
    });
  });
  window.addEventListener('tt:data', function () { if (host.querySelector('[data-ver]')) renderAll(); });
  window.addEventListener('tt:loaded', function () { if (host.querySelector('[data-ver]')) renderVersions(); });
})();
