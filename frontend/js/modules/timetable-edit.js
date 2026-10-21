/**
 * AI Smart Timetable — เฟส 3: ตรวจสอบความถูกต้อง (โมดูล 5) + แก้ไขตาราง Drag & Drop (โมดูล 6)
 *   - ลากคาบไปช่องว่าง = ย้าย · ลากทับคาบอื่น = สลับ · ลากวิชาจากแถบด้านข้าง = เพิ่ม · ลากลงถังขยะ = เอาออก
 *   - มือถือ/แท็บเล็ต: แตะคาบเพื่อเลือก แล้วแตะช่องปลายทาง
 *   - ขณะลาก ช่องปลายทางจะเป็นสีเขียว (วางได้) / แดง (ทำให้เกิดข้อผิดพลาดใหม่)
 *   - Undo/Redo (Ctrl+Z / Ctrl+Shift+Z) · Auto Save เฉพาะช่องที่เปลี่ยน (tt.update_slots) · ประวัติฉบับ (ทำสำเนา/สถานะ)
 * แก้ไขต่อหน่วยการเรียน: กลุ่มเรียนควบชั้นแก้ครั้งเดียว บันทึกให้ทุกห้องในกลุ่ม
 */
(function () {
  const esc = Utils.esc;
  const SAVE_DELAY = 2000, RETRY_DELAY = 10000, MAX_UNDO = 100;
  const STATUS = { generated: 'จัดเสร็จ (AI)', edited: 'แก้ไขแล้ว', draft: 'ร่าง', approved: 'อนุมัติแล้ว', published: 'เผยแพร่แล้ว' };
  const ISSUE_ICON = { error: '🔴', warning: '🟡' };

  const ED = {
    vid: null, version: null, rev: 0, cells: {},
    mode: 'unit', unitId: null, teacherId: null, issueScope: 'unit',
    undo: [], redo: [], msgs: [],
    dirty: {}, saving: false, timer: null, retry: null, conflict: false, error: null, lastSaved: null,
    sel: null, check: null,
  };
  const host = document.getElementById('tab-edit');

  /* ════ ข้อมูลอ้างอิง ════ */
  function S() { return TT.S; }
  function units() {
    const subs = S().subjects;
    return ((S().dashboard && S().dashboard.units) || []).filter(function (u) {
      return subs.some(function (s) { return (s.grades || []).some(function (g) { return u.grades.indexOf(g) >= 0; }); }) ||
        Object.keys(ED.cells[u.unit_id] || {}).length;
    });
  }
  function unitById(id) { return ((S().dashboard && S().dashboard.units) || []).find(function (u) { return u.unit_id === id; }); }
  function periods() { return S().periods.slice().sort(function (a, b) { return (a.seq || 0) - (b.seq || 0); }); }
  function teachPeriods() { return periods().filter(function (p) { return String(p.is_break) !== '1'; }); }
  function subj(id) { return S().subjects.find(function (s) { return s.subject_id === id; }); }
  function teacher(id) { return S().teachers.find(function (t) { return t.teacher_id === id; }); }
  function room(id) { return S().rooms.find(function (r) { return r.room_id === id; }); }
  function shortSubject(n) { return String(n || '').replace(/\s*\(ป\.[^)]*\)$/, ''); }
  function shortTeacher(t) { return t ? String(t.name || '').split(/\s+/)[0] : ''; }
  function slotLabel(k) {
    const d = Number(k.split('|')[0]), p = S().periods.find(function (x) { return x.period_id === k.split('|')[1]; });
    return TT.DAY_NAMES[d] + ' ' + (p ? p.label : '');
  }
  function unitSubjects(u) {
    return S().subjects.filter(function (s) { return (s.grades || []).some(function (g) { return u.grades.indexOf(g) >= 0; }); });
  }
  function eligible(sid) {
    const s = subj(sid), set = {};
    ((s && s.teachers) || []).forEach(function (t) { set[t] = 1; });
    S().teachers.forEach(function (t) { if ((t.subjects || []).indexOf(sid) >= 0) set[t.teacher_id] = 1; });
    return set;
  }
  function homeroom(u) {
    const c = u.class_ids.map(function (id) { return S().classes.find(function (x) { return x.class_id === id; }); }).find(function (c) { return c && c.homeroom_teacher_id; });
    return c ? c.homeroom_teacher_id : '';
  }
  function homeRoom(u) {
    const c = u.class_ids.map(function (id) { return S().classes.find(function (x) { return x.class_id === id; }); }).find(function (c) { return c && c.home_room_id; });
    return c ? c.home_room_id : '';
  }

  /* ════ ช่องตาราง ════ */
  function cell(u, k) { const c = (ED.cells[u] || {})[k]; return c && c.subject_id ? c : null; }
  function clone(c) { return c ? { subject_id: c.subject_id, teacher_id: c.teacher_id || '', room_id: c.room_id || '', locked: c.locked ? '1' : '' } : null; }
  function same(a, b) { return JSON.stringify(clone(a)) === JSON.stringify(clone(b)); }
  function setCell(u, k, c) {
    ED.cells[u] = ED.cells[u] || {};
    if (c && c.subject_id) ED.cells[u][k] = clone(c); else delete ED.cells[u][k];
  }

  /** ครู/ห้องเริ่มต้นเมื่อวางวิชาใหม่: ใช้ตามคาบอื่นของวิชาเดียวกันในชั้นนี้ → ครูที่สอนวิชานี้ได้ → ครูประจำชั้น */
  function defaults(uid, sid) {
    const cs = ED.cells[uid] || {};
    const prev = Object.keys(cs).map(function (k) { return cs[k]; }).find(function (c) { return c.subject_id === sid; });
    if (prev) return { teacher_id: prev.teacher_id, room_id: prev.room_id };
    const u = unitById(uid), el = Object.keys(eligible(sid)), home = homeroom(u);
    const t = el.length ? (el.indexOf(home) >= 0 ? home : el[0]) : ((S().config || {}).fallback_homeroom !== false ? home : '');
    const s = subj(sid);
    const r = s && s.room_type ? (S().rooms.find(function (x) { return x.type === s.room_type; }) || {}).room_id : homeRoom(u);
    return { teacher_id: t || '', room_id: r || '' };
  }

  /* ════ ตรวจสอบ ════ */
  function checkInput(cells) {
    return { units: units(), cells: cells, subjects: S().subjects, teachers: S().teachers, rooms: S().rooms, periods: S().periods, config: S().config || {} };
  }
  function runCheck() { ED.check = TTCheck.check(checkInput(ED.cells)); }

  /** ลองเปลี่ยนแล้วตรวจ: คืน null = ไม่เกิดข้อผิดพลาดใหม่ หรือข้อความของข้อผิดพลาดใหม่ที่เกิดจากการเปลี่ยนนี้ */
  function tryChanges(uid, changes) {
    const cells = Object.assign({}, ED.cells);
    cells[uid] = Object.assign({}, ED.cells[uid] || {});
    changes.forEach(function (c) { if (c.after) cells[uid][c.k] = c.after; else delete cells[uid][c.k]; });
    const r = TTCheck.check(checkInput(cells));
    const old = {};
    ED.check.issues.forEach(function (i) { if (i.level === 'error') old[i.msg] = 1; });
    const n = r.issues.find(function (i) { return i.level === 'error' && !old[i.msg]; });
    return n ? n.msg : null;
  }

  /* ════ สิทธิ์ (เฟส 6) — บัญชีที่ไม่มีสิทธิ์จัดตาราง = ดู/ตรวจสอบได้อย่างเดียว ════ */
  function canEdit() { return !window.TTAuth || TTAuth.can('edit_timetable'); }
  function canApprove() { return !window.TTAuth || TTAuth.can('approve'); }
  function readOnly() { Toast.show('บัญชีนี้ดูและตรวจสอบตารางได้อย่างเดียว', 'warning'); }

  /* ════ การแก้ไข + Undo/Redo ════ */
  function apply(op, dir) {
    op.changes.forEach(function (c) {
      setCell(op.u, c.k, dir > 0 ? c.after : c.before);
      ED.dirty[op.u + '|' + c.k] = 1;
    });
  }
  function commit(label, uid, changes) {
    if (!canEdit()) { readOnly(); return; }
    changes = changes.filter(function (c) { return !same(c.before, c.after); });
    if (!changes.length) return;
    const op = { label: label, u: uid, changes: changes };
    apply(op, 1);
    ED.undo.push(op);
    if (ED.undo.length > MAX_UNDO) ED.undo.shift();
    ED.redo = [];
    changed(label);
  }
  function undo() {
    if (!canEdit()) return;
    const op = ED.undo.pop();
    if (!op) return;
    apply(op, -1); ED.redo.push(op);
    changed('ย้อนกลับ: ' + op.label);
    Toast.show('↶ ย้อนกลับ: ' + op.label, 'info');
  }
  function redo() {
    if (!canEdit()) return;
    const op = ED.redo.pop();
    if (!op) return;
    apply(op, 1); ED.undo.push(op);
    changed('ทำซ้ำ: ' + op.label);
    Toast.show('↷ ทำซ้ำ: ' + op.label, 'info');
  }
  function changed(label) {
    ED.msgs.push(label);
    ED.sel = null;
    runCheck();
    render();
    scheduleSave();
  }

  function subjName(c) { const s = c && subj(c.subject_id); return s ? shortSubject(s.name) : '?'; }
  function lockedMsg(c) { Toast.show('คาบ "' + subjName(c) + '" ถูกล็อกไว้ — ปลดล็อกก่อนจึงจะย้าย/แก้ได้', 'warning'); }

  function moveCell(uid, from, to) {
    if (from === to) return;
    const a = cell(uid, from), b = cell(uid, to);
    if (!a) return;
    if (a.locked) return lockedMsg(a);
    if (b && b.locked) return lockedMsg(b);
    const u = unitById(uid);
    commit(b ? 'สลับ ' + subjName(a) + ' ↔ ' + subjName(b) + ' (' + u.label + ')' : 'ย้าย ' + subjName(a) + ' ' + slotLabel(from) + ' → ' + slotLabel(to) + ' (' + u.label + ')',
      uid, [{ k: from, before: a, after: b }, { k: to, before: b, after: a }]);
  }
  function placeSubject(uid, k, sid) {
    const b = cell(uid, k);
    if (b && b.locked) return lockedMsg(b);
    const after = Object.assign({ subject_id: sid, locked: '' }, defaults(uid, sid));
    commit('เพิ่ม ' + shortSubject(subj(sid).name) + ' ' + slotLabel(k) + ' (' + unitById(uid).label + ')', uid, [{ k: k, before: b, after: after }]);
  }
  function removeCell(uid, k) {
    const c = cell(uid, k);
    if (!c) return;
    if (c.locked) return lockedMsg(c);
    commit('เอา ' + subjName(c) + ' ออกจาก ' + slotLabel(k) + ' (' + unitById(uid).label + ')', uid, [{ k: k, before: c, after: null }]);
  }
  function toggleLock(uid, k) {
    const c = cell(uid, k);
    if (!c) return;
    commit((c.locked ? 'ปลดล็อก ' : 'ล็อก ') + subjName(c) + ' ' + slotLabel(k), uid, [{ k: k, before: c, after: Object.assign({}, c, { locked: c.locked ? '' : '1' }) }]);
  }

  /* ════ Auto Save ════ */
  function scheduleSave() {
    clearTimeout(ED.timer);
    if (ED.conflict) return;
    ED.timer = setTimeout(flush, SAVE_DELAY);
    renderStatus();
  }
  function snapshotOf(dk) {
    const parts = dk.split('|');
    return JSON.stringify(clone(cell(parts[0], parts[1] + '|' + parts[2])));
  }
  function slotChanges(keys) {
    const out = [];
    keys.forEach(function (dk) {
      const parts = dk.split('|'), u = unitById(parts[0]);
      if (!u) return;
      const c = cell(parts[0], parts[1] + '|' + parts[2]);
      u.class_ids.forEach(function (cid) {
        out.push({ class_id: cid, day: Number(parts[1]), period_id: parts[2], subject_id: c ? c.subject_id : '',
          teacher_id: c ? c.teacher_id : '', room_id: c ? c.room_id : '', locked: c && c.locked ? '1' : '' });
      });
    });
    return out;
  }
  async function flush() {
    clearTimeout(ED.timer);
    if (ED.saving || ED.conflict || !ED.vid) return;
    const keys = Object.keys(ED.dirty);
    if (!keys.length) return;
    ED.saving = true; ED.error = null;
    renderStatus();
    const snap = {};
    keys.forEach(function (dk) { snap[dk] = snapshotOf(dk); });
    const msgs = ED.msgs.slice();
    try {
      const r = await api('tt.update_slots', {
        version_id: ED.vid, rev: ED.rev, changes: slotChanges(keys), recorded_by: 'admin',
        message: msgs.slice(-5).join(' · ').slice(0, 300),
        stats: { errors: ED.check.summary.errors, warnings: ED.check.summary.warnings },
      }, { loading: false, silent: true, noRetry: true });
      saved(snap, r.rev, msgs.length);
      updateVersionMeta({ status: r.status, conflicts: r.conflicts });
    } catch (e) {
      if (e.code === 'CONFLICT' && await reconcile(snap)) { saved(snap, ED.rev, msgs.length); }
      else if (e.code === 'CONFLICT') { ED.conflict = true; }
      else { ED.error = e.message || 'เชื่อมต่อไม่ได้'; clearTimeout(ED.retry); ED.retry = setTimeout(flush, RETRY_DELAY); }
    } finally {
      ED.saving = false;
      renderStatus();
      if (Object.keys(ED.dirty).length && !ED.conflict && !ED.error) scheduleSave();
    }
  }
  function saved(snap, rev, nMsgs) {
    ED.rev = rev;
    // ช่องที่ถูกแก้อีกระหว่างบันทึก ยังคงค้างไว้บันทึกรอบถัดไป
    Object.keys(snap).forEach(function (dk) { if (snapshotOf(dk) === snap[dk]) delete ED.dirty[dk]; });
    ED.msgs.splice(0, nMsgs);
    ED.lastSaved = new Date();
  }
  /** rev ไม่ตรง: ถ้าข้อมูลบน server ตรงกับที่เราจะบันทึกอยู่แล้ว (เช่น คำขอก่อนหน้าสำเร็จแต่อ่านผลไม่ได้) → รับ rev ใหม่ */
  async function reconcile(snap) {
    try {
      const d = await api('tt.get_version', { version_id: ED.vid }, { loading: false, silent: true });
      const server = buildCells(d.slots);
      const ok = Object.keys(snap).every(function (dk) {
        const parts = dk.split('|'), c = (server[parts[0]] || {})[parts[1] + '|' + parts[2]];
        return JSON.stringify(clone(c && c.subject_id ? c : null)) === snap[dk];
      });
      if (ok) ED.rev = Number(d.version.stats.rev) || 0;
      return ok;
    } catch (e) { return false; }
  }
  function updateVersionMeta(fields) {
    const v = (S().versions || []).find(function (x) { return x.version_id === ED.vid; });
    if (v) { if (fields.status) v.status = fields.status; if (fields.label) v.label = fields.label; if (fields.conflicts !== undefined) v.stats.conflicts = fields.conflicts; }
    if (ED.version) Object.assign(ED.version, fields.status ? { status: fields.status } : {}, fields.label ? { label: fields.label } : {});
    renderVersionBar();
  }
  function hasPending() { return Object.keys(ED.dirty).length > 0 || ED.saving; }

  window.addEventListener('beforeunload', function (e) {
    if (!hasPending()) return;
    flush();
    e.preventDefault();
    e.returnValue = '';
  });
  document.addEventListener('visibilitychange', function () { if (document.visibilityState === 'hidden') flush(); });

  /* ════ โหลดฉบับ ════ */
  function buildCells(slots) {
    const byClass = {};
    slots.forEach(function (s) { (byClass[s.class_id] = byClass[s.class_id] || {})[s.day + '|' + s.period_id] = s; });
    const out = {};
    ((S().dashboard && S().dashboard.units) || []).forEach(function (u) {
      const m = (out[u.unit_id] = {});
      u.class_ids.forEach(function (cid) {
        Object.keys(byClass[cid] || {}).forEach(function (k) { if (!m[k] && byClass[cid][k].subject_id) m[k] = clone(byClass[cid][k]); });
      });
    });
    return out;
  }
  async function open(vid) {
    if (hasPending()) await flush();
    if (hasPending() && !confirm('การแก้ไขล่าสุดยังบันทึกไม่สำเร็จ — เปิดฉบับอื่นและทิ้งการแก้ไขนั้น?')) { renderVersionBar(); return; }
    try {
      const d = await api('tt.get_version', { version_id: vid }, { loadingMsg: 'กำลังโหลดตาราง...' });
      Object.assign(ED, { vid: vid, version: d.version, rev: Number(d.version.stats.rev) || 0, cells: buildCells(d.slots),
        undo: [], redo: [], msgs: [], dirty: {}, conflict: false, error: null, lastSaved: null, sel: null });
      const us = units();
      if (openAt && us.some(function (u) { return u.unit_id === openAt.unit; })) {
        ED.mode = 'unit'; ED.unitId = openAt.unit;
        ED.sel = openAt.k && cell(openAt.unit, openAt.k) ? { k: openAt.k } : null;
      }
      openAt = null;
      if (!us.some(function (u) { return u.unit_id === ED.unitId; })) ED.unitId = us.length ? us[0].unit_id : null;
      runCheck();
      render();
    } catch (e) { /* toast แสดงแล้ว */ }
  }

  /* ════ แสดงผล ════ */
  function shell() {
    host.innerHTML =
      '<div class="card">' +
        '<div class="tt-toolbar" data-vbar></div>' +
        '<div class="tt-toolbar">' +
          '<select class="form-control" data-mode style="max-width:150px"><option value="unit">✏️ รายชั้น</option><option value="teacher">👩‍🏫 รายครู</option></select>' +
          '<select class="form-control" data-key></select>' +
          (canEdit() ? '<button class="btn btn-secondary" data-undo title="ย้อนกลับ (Ctrl+Z)"><i class="bi bi-arrow-counterclockwise"></i></button>' +
          '<button class="btn btn-secondary" data-redo title="ทำซ้ำ (Ctrl+Shift+Z)"><i class="bi bi-arrow-clockwise"></i></button>' : '') +
          '<span class="tt-save" data-status></span>' +
        '</div>' +
        '<div class="tt-summary" data-summary></div>' +
      '</div>' +
      '<div class="tt-ed">' +
        '<div class="card tt-ed-main"><div data-selbar></div><div data-grid></div>' +
          '<div class="tt-note" style="margin-top:8px">' + (canEdit()
            ? 'ลากคาบไปช่องว่าง = ย้าย · ลากทับคาบอื่น = สลับ · แตะคาบแล้วแตะช่องปลายทางก็ได้ · แตะช่องว่างเพื่อเพิ่มวิชา · 🔒 = ล็อกไม่ให้ย้าย'
            : '👁️ ดูและตรวจสอบได้อย่างเดียว (ชี้ที่คาบเพื่อดูผลตรวจ)' + (canApprove() ? ' · เปลี่ยนสถานะฉบับเป็น "อนุมัติแล้ว" / "เผยแพร่แล้ว" ได้ที่ด้านบน' : '')) + '</div></div>' +
        '<div class="card tt-ed-side"><h3 class="card-title" style="font-size:16px">📚 วิชาของชั้นนี้</h3><div data-palette></div>' +
          '<div class="tt-trash" data-trash><i class="bi bi-trash"></i> ลากคาบมาที่นี่เพื่อเอาออก</div></div>' +
      '</div>' +
      '<div class="card"><div class="flex" style="justify-content:space-between;flex-wrap:wrap;gap:8px;margin-bottom:8px">' +
        '<h3 class="card-title" style="margin:0">🩺 ผลการตรวจสอบ</h3>' +
        '<select class="form-control" data-scope style="max-width:200px"><option value="unit">เฉพาะชั้น/ครูที่เลือก</option><option value="all">ทั้งโรงเรียน</option></select></div>' +
        '<div data-issues></div></div>';

    host.querySelector('[data-mode]').onchange = function () { ED.mode = this.value; ED.sel = null; render(); };
    host.querySelector('[data-key]').onchange = function () { if (ED.mode === 'unit') ED.unitId = this.value; else ED.teacherId = this.value; ED.sel = null; render(); };
    if (canEdit()) {
      host.querySelector('[data-undo]').onclick = undo;
      host.querySelector('[data-redo]').onclick = redo;
    }
    host.querySelector('[data-scope]').onchange = function () { ED.issueScope = this.value; renderIssues(); };
    const trash = host.querySelector('[data-trash]');
    trash.addEventListener('dragover', function (e) { if (drag && drag.from) { e.preventDefault(); trash.classList.add('over'); } });
    trash.addEventListener('dragleave', function () { trash.classList.remove('over'); });
    trash.addEventListener('drop', function (e) { e.preventDefault(); trash.classList.remove('over'); if (drag && drag.from) removeCell(ED.unitId, drag.from); });
    trash.onclick = function () { if (ED.sel && ED.sel.k) removeCell(ED.unitId, ED.sel.k); };
  }

  function render() {
    if (!host.querySelector('[data-grid]')) shell();
    renderVersionBar();
    if (!ED.vid) {
      host.querySelector('[data-grid]').innerHTML = '<div class="text-muted">' + ((S().versions || []).length ? 'เลือกฉบับตารางที่จะแก้ไขด้านบน' : 'ยังไม่มีฉบับตาราง — ไปที่แท็บ "🤖 จัดตาราง AI" เพื่อสร้างและบันทึกฉบับแรก') + '</div>';
      ['[data-palette]', '[data-issues]', '[data-summary]', '[data-selbar]'].forEach(function (s) { host.querySelector(s).innerHTML = ''; });
      host.querySelector('[data-key]').innerHTML = '';
      renderStatus();
      return;
    }
    renderKeys();
    renderSummary();
    renderSelBar();
    renderGrid();
    renderPalette();
    renderIssues();
    renderStatus();
  }

  function renderVersionBar() {
    const bar = host.querySelector('[data-vbar]');
    if (!bar) return;
    const vs = S().versions || [];
    const v = ED.version;
    bar.innerHTML =
      '<select class="form-control" data-ver><option value="">— เลือกฉบับตาราง —</option>' + vs.map(function (x) {
        return '<option value="' + esc(x.version_id) + '"' + (x.version_id === ED.vid ? ' selected' : '') + '>' + esc(x.label) + ' · ' + esc(STATUS[x.status] || x.status) + '</option>';
      }).join('') + '</select>' +
      (v ? '<select class="form-control" data-vstatus style="max-width:170px" title="สถานะฉบับ"' + (canEdit() || canApprove() ? '' : ' disabled') + '>' + Object.keys(STATUS).map(function (k) {
        const locked = (k === 'approved' || k === 'published') && !canApprove();   // อนุมัติ/เผยแพร่ = ผู้บริหาร/ผู้ดูแล
        return '<option value="' + k + '"' + (k === v.status ? ' selected' : '') + (locked ? ' disabled' : '') + '>' + STATUS[k] + '</option>';
      }).join('') + '</select>' +
      (canEdit() ? '<button class="btn btn-secondary" data-rename title="เปลี่ยนชื่อฉบับ"><i class="bi bi-pencil"></i></button>' +
      '<button class="btn btn-secondary" data-dup title="ทำสำเนาเป็นฉบับใหม่ (เก็บฉบับนี้ไว้เป็นประวัติ)"><i class="bi bi-files"></i> ทำสำเนา</button>' : '') : '');
    bar.querySelector('[data-ver]').onchange = function () { if (this.value) open(this.value); };
    if (!v) return;
    bar.querySelector('[data-vstatus]').onchange = function () { setMeta({ status: this.value }); };
    if (!canEdit()) return;
    bar.querySelector('[data-rename]').onclick = function () {
      const label = prompt('ชื่อฉบับตาราง', v.label);
      if (label && label.trim() && label.trim() !== v.label) setMeta({ label: label.trim() });
    };
    bar.querySelector('[data-dup]').onclick = duplicate;
  }
  async function setMeta(fields) {
    try {
      if (fields.status === 'published' && ED.check.summary.errors) {
        if (!confirm('ตารางยังมีข้อผิดพลาด ' + ED.check.summary.errors + ' รายการ — ยืนยันเผยแพร่?')) { renderVersionBar(); return; }
      }
      await flush();
      await api('tt.version_meta', Object.assign({ version_id: ED.vid, recorded_by: 'admin' }, fields), { loadingMsg: 'กำลังบันทึก...', noRetry: true });
      updateVersionMeta(fields);
      Toast.show('บันทึกแล้ว', 'success');
    } catch (e) { renderVersionBar(); }
  }
  async function duplicate() {
    await flush();
    if (hasPending()) { Toast.show('ยังบันทึกการแก้ไขล่าสุดไม่สำเร็จ — ลองใหม่อีกครั้ง', 'warning'); return; }
    const label = prompt('ชื่อฉบับใหม่ (สำเนา)', 'สำเนา ' + ED.version.label);
    if (label === null) return;
    try {
      const r = await api('tt.duplicate_version', { version_id: ED.vid, label: label.trim(), recorded_by: 'admin' }, { loadingMsg: 'กำลังทำสำเนา...', noRetry: true });
      Toast.show('ทำสำเนาแล้ว — กำลังแก้ไขฉบับใหม่', 'success');
      await TT.reload({ quiet: true });
      open(r.version_id);
    } catch (e) { /* toast */ }
  }

  function renderKeys() {
    host.querySelector('[data-mode]').value = ED.mode;
    const sel = host.querySelector('[data-key]');
    let opts;
    if (ED.mode === 'unit') {
      const lv = unitLevels();
      opts = units().map(function (u) { return [u.unit_id, (lv[u.unit_id] ? ISSUE_ICON[lv[u.unit_id]] + ' ' : '🟢 ') + u.label + (u.combined ? ' (ควบชั้น)' : '')]; });
      if (!opts.some(function (o) { return o[0] === ED.unitId; })) ED.unitId = opts.length ? opts[0][0] : null;
    } else {
      const load = ED.check.teacherLoad;
      opts = S().teachers.map(function (t) { return [t.teacher_id, TT.teacherName(t) + ' (' + (load[t.teacher_id] || 0) + ' คาบ)']; });
      const none = noTeacherCount();
      if (none) opts.push(['', '— ยังไม่ระบุครู (' + none + ' คาบ) —']);
      if (ED.teacherId === null || !opts.some(function (o) { return o[0] === ED.teacherId; })) ED.teacherId = opts.length ? opts[0][0] : '';
    }
    sel.innerHTML = opts.map(function (o) { return '<option value="' + esc(o[0]) + '">' + esc(o[1]) + '</option>'; }).join('');
    sel.value = ED.mode === 'unit' ? ED.unitId : ED.teacherId;
    if (!canEdit()) return;
    host.querySelector('[data-undo]').disabled = !ED.undo.length;
    host.querySelector('[data-redo]').disabled = !ED.redo.length;
    host.querySelector('[data-undo]').title = ED.undo.length ? 'ย้อนกลับ: ' + ED.undo[ED.undo.length - 1].label + ' (Ctrl+Z)' : 'ย้อนกลับ (Ctrl+Z)';
    host.querySelector('[data-redo]').title = ED.redo.length ? 'ทำซ้ำ: ' + ED.redo[ED.redo.length - 1].label + ' (Ctrl+Shift+Z)' : 'ทำซ้ำ (Ctrl+Shift+Z)';
  }
  function noTeacherCount() {
    return Object.keys(ED.cells).reduce(function (a, u) {
      return a + Object.keys(ED.cells[u]).filter(function (k) { return !ED.cells[u][k].teacher_id; }).length;
    }, 0);
  }
  function unitLevels() {
    const lv = {};
    ED.check.issues.forEach(function (i) {
      const us = i.unit_id ? [i.unit_id] : i.cells.map(function (c) { return c.split('|')[0]; });
      us.forEach(function (u) { if (lv[u] !== 'error') lv[u] = i.level; });
    });
    return lv;
  }

  function renderSummary() {
    const s = ED.check.summary;
    host.querySelector('[data-summary]').innerHTML =
      '<span class="tt-badge err">🔴 ข้อผิดพลาด ' + s.errors + '</span>' +
      '<span class="tt-badge warn">🟡 คำเตือน ' + s.warnings + '</span>' +
      '<span class="tt-badge ok">🟢 คาบที่ผ่าน ' + s.ok + '/' + s.filled + '</span>' +
      '<span class="tt-note">วิชาพื้นฐานช่วงบ่าย ' + s.coreAft + ' · กิจกรรมช่วงเช้า ' + s.actMorn + '</span>';
  }

  function renderStatus() {
    const el = host.querySelector('[data-status]');
    if (!el) return;
    let html;
    if (!ED.vid) html = '';
    else if (ED.conflict) html = '<span class="text-danger">⛔ ฉบับนี้ถูกแก้จากเครื่องอื่น</span> <button class="btn btn-secondary" data-reloadv style="padding:3px 10px;font-size:13px">โหลดฉบับล่าสุด</button>';
    else if (ED.saving) html = '⏳ กำลังบันทึก...';
    else if (ED.error) html = '<span class="text-danger" title="' + esc(ED.error) + '">⚠️ บันทึกไม่สำเร็จ — จะลองใหม่อัตโนมัติ</span>';
    else if (Object.keys(ED.dirty).length) html = '✏️ มีการแก้ไข — กำลังจะบันทึกอัตโนมัติ';
    else if (ED.lastSaved) html = '✅ บันทึกอัตโนมัติแล้ว ' + ED.lastSaved.toLocaleTimeString('th-TH');
    else html = '<span class="tt-note">แก้แล้วบันทึกอัตโนมัติ</span>';
    el.innerHTML = html;
    const b = el.querySelector('[data-reloadv]');
    if (b) b.onclick = function () {
      if (confirm('โหลดฉบับล่าสุดจากเซิร์ฟเวอร์? การแก้ไขที่ยังไม่บันทึกในเครื่องนี้จะหายไป')) { ED.dirty = {}; ED.conflict = false; open(ED.vid); }
    };
  }

  function renderSelBar() {
    const bar = host.querySelector('[data-selbar]');
    if (!ED.sel || ED.mode !== 'unit' || !canEdit()) { bar.innerHTML = ''; return; }
    if (ED.sel.sid) {
      bar.innerHTML = '<div class="tt-selbar">➕ วาง <strong>' + esc(shortSubject(subj(ED.sel.sid).name)) + '</strong> — แตะช่องที่ต้องการ <button class="btn btn-secondary" data-x>ยกเลิก</button></div>';
    } else {
      const c = cell(ED.unitId, ED.sel.k);
      bar.innerHTML = '<div class="tt-selbar">👉 <strong>' + esc(subjName(c)) + '</strong> ' + esc(slotLabel(ED.sel.k)) + ' — แตะช่องปลายทางเพื่อย้าย/สลับ' +
        '<span style="flex:1"></span><button class="btn btn-secondary" data-edit><i class="bi bi-pencil"></i> แก้ไข</button>' +
        '<button class="btn btn-secondary" data-lock>' + (c.locked ? '🔓 ปลดล็อก' : '🔒 ล็อก') + '</button>' +
        '<button class="btn btn-danger" data-del><i class="bi bi-trash"></i></button><button class="btn btn-secondary" data-x>ยกเลิก</button></div>';
      bar.querySelector('[data-edit]').onclick = function () { editCell(ED.unitId, ED.sel.k); };
      bar.querySelector('[data-lock]').onclick = function () { toggleLock(ED.unitId, ED.sel.k); };
      bar.querySelector('[data-del]').onclick = function () { removeCell(ED.unitId, ED.sel.k); };
    }
    bar.querySelector('[data-x]').onclick = function () { ED.sel = null; render(); };
  }

  /** ข้อความปัญหาของแต่ละช่อง (tooltip) */
  function cellMsgs() {
    const m = {};
    ED.check.issues.forEach(function (i) { i.cells.forEach(function (c) { (m[c] = m[c] || []).push(ISSUE_ICON[i.level] + ' ' + i.msg); }); });
    return m;
  }

  function renderGrid() {
    const grid = host.querySelector('[data-grid]');
    const ps = periods(), msgs = cellMsgs(), lv = ED.check.cellLevel;
    const unitMode = ED.mode === 'unit';
    let teacherCells = {};
    if (!unitMode) {
      Object.keys(ED.cells).forEach(function (u) {
        Object.keys(ED.cells[u]).forEach(function (k) {
          const c = ED.cells[u][k];
          if ((c.teacher_id || '') !== (ED.teacherId || '')) return;
          (teacherCells[k] = teacherCells[k] || []).push({ u: u, c: c });
        });
      });
    }
    const u = unitMode ? unitById(ED.unitId) : null;
    if (unitMode && !u) { grid.innerHTML = '<div class="text-muted">ไม่มีชั้นเรียน</div>'; return; }
    let head = '';
    if (!unitMode) {
      const t = teacher(ED.teacherId);
      head = '<div class="tt-note" style="margin-bottom:6px">' + (t ? esc(TT.teacherName(t)) + ' · สอน ' + (ED.check.teacherLoad[ED.teacherId] || 0) + ' คาบ/สัปดาห์' + (t.max_periods != null ? ' (สูงสุด ' + t.max_periods + ')' : '') : 'คาบที่ยังไม่ระบุครู') + ' · แตะคาบเพื่อไปแก้ที่ชั้นเรียนนั้น</div>';
    }
    grid.innerHTML = head + '<div class="table-wrap"><table class="tt-tt tt-edit"><thead><tr><th>วัน</th>' +
      ps.map(function (p) { return '<th>' + esc(p.label) + '<br><span class="tt-note">' + esc((p.start_time || '') + (p.end_time ? '–' + p.end_time : '')) + '</span></th>'; }).join('') +
      '</tr></thead><tbody>' + [1, 2, 3, 4, 5].map(function (d) {
        return '<tr><th>' + TT.DAY_NAMES[d] + '</th>' + ps.map(function (p) {
          if (String(p.is_break) === '1') return '<td class="brk">' + esc(p.label) + '</td>';
          const k = d + '|' + p.period_id;
          if (!unitMode) {
            const list = teacherCells[k] || [];
            if (!list.length) return '<td></td>';
            const bad = list.some(function (x) { return lv[x.u + '|' + k] === 'error'; }) ? 'error' : list.some(function (x) { return lv[x.u + '|' + k]; }) ? 'warning' : 'ok';
            const tip = list.reduce(function (a, x) { return a.concat(msgs[x.u + '|' + k] || []); }, []).join('\n');
            return '<td><div class="tt-cell ' + esc((subj(list[0].c.subject_id) || {}).type || 'core') + ' st-' + bad + '" data-goto="' + esc(list[0].u) + '" data-k="' + esc(k) + '" title="' + esc(tip) + '">' +
              '<div class="s">' + esc(shortSubject((subj(list[0].c.subject_id) || {}).name)) + '</div><div class="t">' +
              list.map(function (x) { return esc(unitById(x.u) ? unitById(x.u).label : x.u); }).join('<br>') + '</div></div></td>';
          }
          const c = cell(u.unit_id, k), key = u.unit_id + '|' + k, st = lv[key] || (c ? 'ok' : '');
          const selCls = ED.sel && ED.sel.k === k ? ' sel' : '';
          if (!c) return '<td data-drop="' + esc(k) + '"><div class="tt-empty' + (st ? ' st-' + st : '') + selCls + '" data-k="' + esc(k) + '" title="' + esc((msgs[key] || ['แตะเพื่อเพิ่มวิชา']).join('\n')) + '">+</div></td>';
          const s = subj(c.subject_id) || {}, t = teacher(c.teacher_id), r = room(c.room_id);
          return '<td data-drop="' + esc(k) + '"><div class="tt-cell ' + esc(s.type || 'core') + ' st-' + st + selCls + '" data-k="' + esc(k) + '"' +
            (c.locked || !canEdit() ? '' : ' draggable="true"') + ' title="' + esc((msgs[key] || ['✅ ไม่มีปัญหา']).join('\n')) + '">' +
            (c.locked ? '<span class="tt-lock">🔒</span>' : '') +
            '<div class="s">' + esc(shortSubject(s.name)) + '</div>' +
            '<div class="t">' + (t ? 'ครู' + esc(shortTeacher(t)) : '<span class="text-danger">ไม่ระบุครู</span>') + (r ? ' · ' + esc(r.name) : '') + '</div></div></td>';
        }).join('') + '</tr>';
      }).join('') + '</tbody></table></div>';

    if (!unitMode) {
      grid.querySelectorAll('[data-goto]').forEach(function (el) {
        el.onclick = function () { ED.mode = 'unit'; ED.unitId = el.dataset.goto; ED.sel = { k: el.dataset.k }; render(); };
      });
      return;
    }
    bindGrid(grid, u.unit_id);
    if (ED.sel && canEdit()) showHints(grid, u.unit_id, ED.sel);
  }

  /* ════ Drag & Drop + แตะเพื่อย้าย ════ */
  let drag = null;
  function bindGrid(grid, uid) {
    if (!canEdit()) return;   // ดูอย่างเดียว: ชี้ที่คาบเพื่อดูผลตรวจได้ แต่ไม่มีการเลือก/ลาก/แก้
    grid.querySelectorAll('.tt-cell[data-k], .tt-empty[data-k]').forEach(function (el) {
      el.addEventListener('click', function () { clickCell(uid, el.dataset.k); });
      el.addEventListener('dblclick', function () { if (cell(uid, el.dataset.k)) editCell(uid, el.dataset.k); });
    });
    grid.querySelectorAll('.tt-cell[draggable]').forEach(function (el) {
      el.addEventListener('dragstart', function (e) {
        drag = { from: el.dataset.k };
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', el.dataset.k);
        setTimeout(function () { showHints(grid, uid, { k: el.dataset.k }); }, 0);
      });
      el.addEventListener('dragend', endDrag);
    });
    grid.querySelectorAll('td[data-drop]').forEach(function (td) {
      td.addEventListener('dragover', function (e) { if (drag) { e.preventDefault(); td.classList.add('over'); } });
      td.addEventListener('dragleave', function () { td.classList.remove('over'); });
      td.addEventListener('drop', function (e) {
        e.preventDefault();
        const d = drag;
        endDrag();
        if (!d) return;
        if (d.from) moveCell(uid, d.from, td.dataset.drop);
        else if (d.sid) placeSubject(uid, td.dataset.drop, d.sid);
      });
    });
  }
  function endDrag() {
    drag = null;
    host.querySelectorAll('.over').forEach(function (x) { x.classList.remove('over'); });
    if (!ED.sel) clearHints();
  }
  function clearHints() {
    host.querySelectorAll('td.drop-ok, td.drop-bad').forEach(function (td) { td.classList.remove('drop-ok', 'drop-bad'); td.removeAttribute('data-why'); });
  }
  /** ระบายสีช่องปลายทาง: เขียว = วางได้, แดง = ทำให้เกิดข้อผิดพลาดใหม่ (ชี้เมาส์เพื่อดูสาเหตุ) */
  function showHints(grid, uid, src) {
    clearHints();
    grid.querySelectorAll('td[data-drop]').forEach(function (td) {
      const k = td.dataset.drop;
      let changes;
      if (src.k) {
        if (k === src.k) return;
        const a = cell(uid, src.k), b = cell(uid, k);
        if (!a || (b && b.locked)) { td.classList.add('drop-bad'); td.dataset.why = 'คาบถูกล็อก'; return; }
        changes = [{ k: src.k, after: b }, { k: k, after: a }];
      } else {
        const b = cell(uid, k);
        if (b && b.locked) { td.classList.add('drop-bad'); td.dataset.why = 'คาบถูกล็อก'; return; }
        changes = [{ k: k, after: Object.assign({ subject_id: src.sid }, defaults(uid, src.sid)) }];
      }
      const why = tryChanges(uid, changes);
      td.classList.add(why ? 'drop-bad' : 'drop-ok');
      if (why) td.dataset.why = why;
      const box = td.firstElementChild;
      if (box && why) box.title = '⛔ ' + why + (box.title ? '\n' + box.title : '');
    });
  }
  function clickCell(uid, k) {
    const c = cell(uid, k);
    if (ED.sel && ED.sel.sid) { placeSubject(uid, k, ED.sel.sid); return; }
    if (ED.sel && ED.sel.k) {
      if (ED.sel.k === k) { ED.sel = null; render(); return; }
      moveCell(uid, ED.sel.k, k);
      return;
    }
    if (!c) { editCell(uid, k); return; }
    if (c.locked) { ED.sel = { k: k }; render(); return; }
    ED.sel = { k: k };
    render();
  }

  function renderPalette() {
    const pal = host.querySelector('[data-palette]');
    const side = host.querySelector('.tt-ed-side');
    if (ED.mode !== 'unit' || !canEdit()) { side.classList.add('hidden'); return; }
    side.classList.remove('hidden');
    const u = unitById(ED.unitId);
    const cnt = ED.check.unitCount[ED.unitId] || {};
    const list = unitSubjects(u);
    pal.innerHTML = list.map(function (s) {
      const have = cnt[s.subject_id] || 0, need = Number(s.periods_week) || 0;
      const st = have === need ? 'full' : have > need ? 'over' : 'need';
      return '<div class="tt-chip2 ' + esc(s.type || 'core') + ' ' + st + (ED.sel && ED.sel.sid === s.subject_id ? ' sel' : '') + '" draggable="true" data-sid="' + esc(s.subject_id) + '" title="ลากไปวางในตาราง หรือแตะแล้วแตะช่องว่าง">' +
        '<span>' + esc(shortSubject(s.name)) + '</span><span class="n">' + (st === 'full' ? '✓ ' : '') + have + '/' + need + '</span></div>';
    }).join('') || '<div class="text-muted">ยังไม่มีวิชาของชั้นนี้</div>';
    pal.querySelectorAll('[data-sid]').forEach(function (el) {
      el.addEventListener('dragstart', function (e) {
        drag = { sid: el.dataset.sid };
        e.dataTransfer.effectAllowed = 'copy';
        e.dataTransfer.setData('text/plain', el.dataset.sid);
        setTimeout(function () { showHints(host.querySelector('[data-grid]'), ED.unitId, { sid: el.dataset.sid }); }, 0);
      });
      el.addEventListener('dragend', endDrag);
      el.addEventListener('click', function () {
        ED.sel = ED.sel && ED.sel.sid === el.dataset.sid ? null : { sid: el.dataset.sid };
        render();
      });
    });
  }

  function renderIssues() {
    const box = host.querySelector('[data-issues]');
    let list = ED.check.issues;
    if (ED.issueScope === 'unit') {
      list = list.filter(function (i) {
        if (ED.mode === 'unit') return i.unit_id === ED.unitId || i.cells.some(function (c) { return c.split('|')[0] === ED.unitId; });
        return i.teacher_id === ED.teacherId || i.cells.some(function (c) {
          const p = c.split('|'), x = cell(p[0], p[1] + '|' + p[2]);
          return x && (x.teacher_id || '') === (ED.teacherId || '');
        });
      });
    }
    if (!list.length) { box.innerHTML = '<div class="alert alert-success">🟢 ไม่พบปัญหา' + (ED.issueScope === 'unit' ? 'ในส่วนที่เลือก' : '') + '</div>'; return; }
    const shown = list.slice(0, 80);
    box.innerHTML = shown.map(function (i, n) {
      return '<div class="tt-issue ' + (i.level === 'error' ? 'alert-danger' : 'alert-warning') + '" data-i="' + n + '" style="cursor:' + (i.cells.length || i.teacher_id ? 'pointer' : 'default') + '">' +
        '<span>' + ISSUE_ICON[i.level] + '</span><span>' + esc(i.msg) + '</span></div>';
    }).join('') + (list.length > shown.length ? '<div class="tt-note">และอีก ' + (list.length - shown.length) + ' รายการ</div>' : '');
    box.querySelectorAll('[data-i]').forEach(function (el) {
      el.onclick = function () {
        const i = shown[Number(el.dataset.i)];
        if (i.cells.length) {
          const p = i.cells[0].split('|');
          ED.mode = 'unit'; ED.unitId = p[0];
          ED.sel = cell(p[0], p[1] + '|' + p[2]) ? { k: p[1] + '|' + p[2] } : null;
        } else if (i.teacher_id) { ED.mode = 'teacher'; ED.teacherId = i.teacher_id; ED.sel = null; }
        else if (i.unit_id) { ED.mode = 'unit'; ED.unitId = i.unit_id; ED.sel = null; }
        render();
        host.querySelector('.tt-ed').scrollIntoView({ behavior: 'smooth', block: 'start' });
      };
    });
  }

  /* ════ แก้ไขรายละเอียดช่อง ════ */
  function editCell(uid, k) {
    const u = unitById(uid), cur = cell(uid, k);
    const busy = {};   // ครู/ห้องที่ติดสอนชั้นอื่นในเวลาเดียวกัน
    Object.keys(ED.cells).forEach(function (o) {
      if (o === uid) return;
      const c = ED.cells[o][k];
      if (!c) return;
      const lbl = unitById(o) ? unitById(o).label : o;
      if (c.teacher_id) busy['t' + c.teacher_id] = lbl;
      if (c.room_id) busy['r' + c.room_id] = lbl;
    });
    const cnt = ED.check.unitCount[uid] || {};
    const mine = unitSubjects(u), others = S().subjects.filter(function (s) { return mine.indexOf(s) < 0; });
    const opt = function (s) { return '<option value="' + esc(s.subject_id) + '">' + esc(shortSubject(s.name)) + ' (' + (cnt[s.subject_id] || 0) + '/' + (s.periods_week || 0) + ')</option>'; };

    const el = document.createElement('div');
    el.className = 'modal-backdrop show';
    el.innerHTML = '<div class="modal wide"><h3 class="modal-title">' + (cur ? '✏️ แก้ไขคาบ' : '➕ เพิ่มคาบ') + ' · ' + esc(u.label) + ' · ' + esc(slotLabel(k)) + '</h3>' +
      '<div class="tt-form">' +
        '<div class="full"><label>วิชา</label><select class="form-control" data-f="subject_id"><option value="">— เลือกวิชา —</option>' +
          '<optgroup label="วิชาของชั้นนี้ (มี/ต้องเรียน)">' + mine.map(opt).join('') + '</optgroup>' +
          (others.length ? '<optgroup label="วิชาอื่น">' + others.map(opt).join('') + '</optgroup>' : '') + '</select></div>' +
        '<div><label>ครูผู้สอน</label><select class="form-control" data-f="teacher_id"></select></div>' +
        '<div><label>ห้อง</label><select class="form-control" data-f="room_id"><option value="">— ไม่ระบุ —</option>' +
          S().rooms.map(function (r) { return '<option value="' + esc(r.room_id) + '">' + esc(r.name) + (busy['r' + r.room_id] ? ' (ใช้อยู่: ' + esc(busy['r' + r.room_id]) + ')' : '') + '</option>'; }).join('') + '</select></div>' +
        '<div class="full"><label class="tt-chip"><input type="checkbox" data-f="locked"> 🔒 ล็อกคาบนี้ (ห้ามย้าย)</label></div>' +
      '</div><div class="alert alert-warning hidden" data-warn style="font-size:14px"></div>' +
      '<div class="flex" style="justify-content:flex-end;gap:8px;flex-wrap:wrap">' +
        (cur ? '<button class="btn btn-danger" data-del style="margin-right:auto"><i class="bi bi-trash"></i> เอาออก</button>' : '') +
        '<button class="btn btn-secondary" data-cancel>ยกเลิก</button><button class="btn btn-primary" data-ok><i class="bi bi-check-lg"></i> ตกลง</button></div></div>';
    document.body.appendChild(el);
    const f = function (n) { return el.querySelector('[data-f="' + n + '"]'); };
    function fillTeachers(sid, keep) {
      const el2 = eligible(sid);
      const tOpt = function (t) { return '<option value="' + esc(t.teacher_id) + '">' + esc(TT.teacherName(t)) + (busy['t' + t.teacher_id] ? ' (ติดสอน ' + esc(busy['t' + t.teacher_id]) + ')' : '') + '</option>'; };
      const can = S().teachers.filter(function (t) { return el2[t.teacher_id]; }), rest = S().teachers.filter(function (t) { return !el2[t.teacher_id]; });
      f('teacher_id').innerHTML = '<option value="">— ยังไม่ระบุ —</option>' +
        (can.length ? '<optgroup label="⭐ สอนวิชานี้ได้">' + can.map(tOpt).join('') + '</optgroup><optgroup label="ครูอื่น">' + rest.map(tOpt).join('') + '</optgroup>' : rest.map(tOpt).join(''));
      f('teacher_id').value = keep !== undefined ? keep : (sid ? defaults(uid, sid).teacher_id : '');
    }
    f('subject_id').value = cur ? cur.subject_id : '';
    fillTeachers(cur ? cur.subject_id : '', cur ? cur.teacher_id : '');
    f('room_id').value = cur ? cur.room_id : '';
    f('locked').checked = !!(cur && cur.locked);
    function preview() {
      const w = el.querySelector('[data-warn]');
      const sid = f('subject_id').value;
      if (!sid) { w.classList.add('hidden'); return; }
      const why = tryChanges(uid, [{ k: k, after: { subject_id: sid, teacher_id: f('teacher_id').value, room_id: f('room_id').value } }]);
      w.textContent = why ? '⚠️ ' + why : '';
      w.classList.toggle('hidden', !why);
    }
    f('subject_id').onchange = function () {
      fillTeachers(this.value);
      if (!cur || !f('room_id').value) f('room_id').value = this.value ? defaults(uid, this.value).room_id : '';
      preview();
    };
    f('teacher_id').onchange = preview;
    f('room_id').onchange = preview;
    preview();
    const close = function () { el.remove(); };
    el.querySelector('[data-cancel]').onclick = close;
    el.addEventListener('click', function (e) { if (e.target === el) close(); });
    if (cur) el.querySelector('[data-del]').onclick = function () {
      close();
      commit('เอา ' + subjName(cur) + ' ออกจาก ' + slotLabel(k) + ' (' + u.label + ')', uid, [{ k: k, before: cur, after: null }]);
    };
    el.querySelector('[data-ok]').onclick = function () {
      const sid = f('subject_id').value;
      if (!sid) { Toast.show('กรุณาเลือกวิชา', 'warning'); return; }
      const after = { subject_id: sid, teacher_id: f('teacher_id').value, room_id: f('room_id').value, locked: f('locked').checked ? '1' : '' };
      close();
      commit((cur ? 'แก้ไข ' : 'เพิ่ม ') + shortSubject(subj(sid).name) + ' ' + slotLabel(k) + ' (' + u.label + ')', uid, [{ k: k, before: cur, after: after }]);
    };
  }

  /* ════ คีย์ลัด ════ */
  document.addEventListener('keydown', function (e) {
    if (host.classList.contains('hidden') || !ED.vid || TT.isBusy()) return;
    if (/^(INPUT|SELECT|TEXTAREA)$/.test((e.target && e.target.tagName) || '')) return;
    const mod = e.ctrlKey || e.metaKey, key = String(e.key).toLowerCase();
    if (mod && key === 'z' && !e.shiftKey) { e.preventDefault(); undo(); }
    else if (mod && ((key === 'z' && e.shiftKey) || key === 'y')) { e.preventDefault(); redo(); }
    else if (e.key === 'Escape' && ED.sel) { ED.sel = null; render(); }
    else if ((e.key === 'Delete' || e.key === 'Backspace') && ED.sel && ED.sel.k) { e.preventDefault(); removeCell(ED.unitId, ED.sel.k); }
  });

  /* ════ เชื่อมกับส่วนอื่นของหน้า ════ */
  // ออกจากแท็บแก้ไข → บันทึกที่ค้างทันที · เข้าแท็บครั้งแรก → เปิดฉบับล่าสุด
  let openOnEnter = null, openAt = null;
  document.querySelectorAll('#tt-tabs .tab').forEach(function (t) {
    t.addEventListener('click', function () {
      if (t.dataset.tab !== 'edit') { flush(); return; }
      const vid = openOnEnter || (!ED.vid && (S().versions || []).length ? S().versions[0].version_id : null);
      openOnEnter = null;
      if (vid && (vid !== ED.vid || openAt)) {
        if (vid === ED.vid && !hasPending()) {   // ฉบับเดิม → แค่ไปที่ช่องนั้น ไม่ต้องโหลดใหม่
          if (cell(openAt.unit, openAt.k)) { ED.mode = 'unit'; ED.unitId = openAt.unit; ED.sel = { k: openAt.k }; }
          openAt = null;
          render();
        } else open(vid);
      } else render();
    });
  });
  window.addEventListener('tt:loaded', function () {
    if (ED.vid && !(S().versions || []).some(function (v) { return v.version_id === ED.vid; })) {
      Object.assign(ED, { vid: null, version: null, cells: {}, undo: [], redo: [], dirty: {}, sel: null });
    }
    if (ED.vid) runCheck();
    if (!host.classList.contains('hidden')) render();
  });

  window.TTEdit = {
    /** เปิดฉบับในแท็บแก้ไข · at = { unit, k:'day|period_id' } เพื่อไปที่ช่องนั้นทันที */
    open: function (vid, at) {
      openOnEnter = vid;
      openAt = at || null;
      document.querySelector('#tt-tabs .tab[data-tab="edit"]').click();
    },
    /** รอให้การแก้ไขที่ค้างบันทึกเสร็จ (ก่อนอ่านข้อมูลจาก server ไปทำรายงาน) — สูงสุด ~8 วินาที */
    whenSaved: async function () {
      if (Object.keys(ED.dirty).length && !ED.saving) await flush();
      for (let i = 0; i < 40 && hasPending() && !ED.conflict && !ED.error; i++) await new Promise(function (r) { setTimeout(r, 200); });
    },
  };
})();
