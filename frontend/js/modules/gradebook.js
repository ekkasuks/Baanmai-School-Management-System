/**
 * วิชาการ › บันทึกคะแนน — เฟส 1: วิชาของฉัน (จากการมอบหมายในตารางสอน) + รายชื่อนักเรียนรายวิชา
 * เฟส 2: ตั้งค่าน้ำหนัก 4 ช่วง · เพิ่ม/แก้/ลบ(กู้คืนได้) งาน · ตารางคะแนน + บันทึกทีละงาน (บันทึกอัตโนมัติ)
 * เฟส 3: ป้าย ช้า/ไม่ส่ง/ยกเว้น · หักคะแนนจากคะแนนรวม · ตัดเกรด 0–4 / ผ–มผ · ร/มส · ส่งผล (ล็อก) / ปลดล็อก
 * เข้าสู่ระบบแบบเลือกชื่อ + รหัสผ่าน (body data-tt-login="pick" · js/tt-session.js)
 * ดีไซน์: docs/superpowers/specs/2026-11-06-gradebook-design.md
 */
(function () {
  const esc = Utils.esc;
  const $ = function (id) { return document.getElementById(id); };
  const KEY_VIEW = 'gb:view';
  let me = null, data = null, homeStale = false;

  function termLabel(t) { const m = /^(\d{4})-(\d)$/.exec(t || ''); return m ? 'ปีการศึกษา ' + m[1] + ' ภาคเรียนที่ ' + m[2] : t; }

  /* ════ วิชาของฉัน ════ */
  async function loadHome() {
    const sel = $('gb-teacher');
    const params = {};
    const v = (data && data.can_view_all && sel.value) || Store.get(KEY_VIEW) || '';   // server ไม่สนค่านี้ถ้าบัญชีไม่ใช่ผู้ดูภาพรวม
    if (v === '*') params.all = true; else if (v) params.teacher_id = v;
    try { data = await api('acad.gb_my_courses', params, { loadingMsg: 'กำลังโหลดวิชา...' }); }
    catch (e) { $('gb-courses').innerHTML = '<div class="alert alert-danger">' + esc(e.message) + '</div>'; return; }
    $('gb-sub').textContent = 'วิชาการ · ' + termLabel(data.term);
    renderWho();
    renderCourses();
  }

  function renderWho() {
    $('gb-who').innerHTML = '👩‍🏫 <strong>' + esc(data.me ? data.me.name : me.display_name) + '</strong> <span class="tt-note">· ' + esc(termLabel(data.term)) + '</span>';
    const sel = $('gb-teacher'), note = $('gb-note');
    if (data.can_view_all) {
      sel.classList.remove('hidden');
      sel.innerHTML = '<option value="*">ทุกวิชา (ทุกครู)</option>' +
        (data.me ? '<option value="' + esc(data.me.teacher_id) + '">วิชาของฉัน</option>' : '') +
        data.teachers.map(function (t) { return '<option value="' + esc(t.teacher_id) + '">ครู: ' + esc(t.name) + ' (' + t.courses + ' วิชา)</option>'; }).join('');
      sel.value = data.viewing;
    }
    note.innerHTML = !data.me && !data.can_view_all
      ? '<div class="alert alert-warning" style="margin:10px 0 0">บัญชีนี้ยังไม่ได้ผูกกับรายชื่อครูในตารางสอนของภาคเรียนนี้ — แจ้งผู้ดูแลระบบให้ผูกบัญชี (ตารางสอน › ผู้ใช้)</div>'
      : (!data.me && data.can_view_all ? '<p class="tt-note" style="margin:8px 0 0">บัญชีนี้ไม่ได้ผูกกับครู — แสดงทุกวิชาในฐานะ' + (data.can_admin ? 'ฝ่ายวิชาการ/ผู้ดูแล' : 'ผู้บริหาร') + '</p>' : '');
  }

  function renderCourses() {
    const box = $('gb-courses'), list = data.courses;
    if (!list.length) {
      box.innerHTML = '<div class="alert alert-info" style="margin:0">' + (data.viewing === '*' ? 'ยังไม่มีการมอบหมายการสอนในภาคเรียนนี้' : 'ยังไม่มีวิชาที่ได้รับมอบหมายในภาคเรียนนี้') +
        ' — ฝ่ายวิชาการกำหนดได้ที่ ตารางสอน › มอบหมายการสอน</div>';
      return;
    }
    const showTeacher = data.viewing === '*';
    // จัดกลุ่มตามชั้น
    const groups = [];
    list.forEach(function (c) {
      let g = groups.find(function (x) { return x.key === c.class_id; });
      if (!g) { g = { key: c.class_id, label: c.class_label, items: [] }; groups.push(g); }
      g.items.push(c);
    });
    box.innerHTML = '<h3 class="card-title">📚 ' + (data.viewing === '*' ? 'ทุกวิชา' : 'วิชาที่ได้รับมอบหมาย') + ' <span class="tt-note">' + list.length + ' รายวิชา</span></h3>' +
      groups.map(function (g) {
        return '<div class="gb-group"><h4>ชั้น ' + esc(g.label) + '</h4><div class="gb-grid">' + g.items.map(function (c) {
          return '<button class="gb-course" data-c="' + esc(c.course_id) + '">' +
            '<span class="cls">' + esc(c.class_label) + '</span>' +
            '<span class="sub">' + esc(c.subject_name) + '</span>' +
            '<span class="meta">' + (c.subject_code ? '<span>' + esc(c.subject_code) + '</span>' : '') + (c.type_label ? '<span class="gb-tag">' + esc(c.type_label) + '</span>' : '') +
              '<span><i class="bi bi-people"></i> ' + c.students + ' คน</span>' + (c.periods_week ? '<span>' + c.periods_week + ' คาบ/สัปดาห์</span>' : '') +
              '<span><i class="bi bi-journal-text"></i> ' + (c.items ? c.items + ' งาน' : 'ยังไม่มีงาน') + '</span>' +
              (c.status === 'submitted' ? '<span class="gb-tag gb-status-tag">✓ ส่งผลแล้ว</span>' : '') + '</span>' +
            (showTeacher ? '<span class="meta"><span>👩‍🏫 ' + esc(c.teacher_name || '-') + '</span></span>' : '') +
          '</button>';
        }).join('') + '</div></div>';
      }).join('');
    box.querySelectorAll('[data-c]').forEach(function (b) { b.onclick = function () { location.hash = 'c=' + encodeURIComponent(b.dataset.c); }; });
  }

  /* ════ รายวิชา ════ */
  let C = null;                 // ข้อมูลรายวิชาที่เปิดอยู่ (จาก acad.gb_course)
  let pending = {};             // 'item_id|citizen_id' → { v: คะแนน|null, f: ป้าย } ที่ยังไม่ได้ส่ง
  let saving = false, saveTimer = null, saveErr = '';
  let curTab = 'grid';
  const GRADE_STEPS = [4, 3.5, 3, 2.5, 2, 1.5, 1];
  const FLAG_LABEL = { '': '–', late: 'ช้า', missing: 'ไม่ส่ง', exempt: 'ยกเว้น' };
  const SPECIAL = { grade: ['ร', 'มส'], pass: ['ผ', 'มผ'] };

  function fmt(n) { return n == null || n === '' ? '' : String(Math.round(Number(n) * 100) / 100); }
  function activeStudents() { return C.students.filter(function (s) { return !s.left; }); }
  function studentBy(cid) { return C.students.find(function (s) { return s.citizen_id === cid; }); }
  function itemsOf(p) { return C.items.filter(function (i) { return i.period === p; }); }
  function scoreOf(cid, iid) { const r = C.scores[cid]; return r && r[iid] != null ? r[iid] : null; }
  function flagOf(cid, iid) { const r = C.flags[cid]; return (r && r[iid]) || ''; }
  function setScore(cid, iid, v) { if (!C.scores[cid]) C.scores[cid] = {}; if (v == null) delete C.scores[cid][iid]; else C.scores[cid][iid] = v; }
  function setFlag(cid, iid, f) { if (!C.flags[cid]) C.flags[cid] = {}; if (!f) delete C.flags[cid][iid]; else C.flags[cid][iid] = f; }
  function deductOf(cid) { return C.deductions.reduce(function (a, d) { return a + (!d.voided && d.citizen_id === cid ? d.points : 0); }, 0); }
  function editable() { return C.can_edit; }

  /** สูตรเดียวกับ worker/src/modules/gradebook.js calcStudent */
  function calc(cid) {
    const s = studentBy(cid) || {}, sc = C.scores[cid] || {}, fl = C.flags[cid] || {};
    let exW = 0, any = false;
    const per = C.periods.map(function (p) {
      const its = itemsOf(p.no);
      if (!its.length || !p.weight) return null;
      any = true;
      let e = 0, m = 0;
      its.forEach(function (i) {
        const f = fl[i.item_id] || '';
        if (f === 'exempt') return;
        m += i.max_score;
        if (f === 'missing') return;
        let v = Number(sc[i.item_id]) || 0;
        if (f === 'late' && i.late_pct > 0) v = v * (1 - i.late_pct / 100);
        e += v;
      });
      if (!m) { exW += p.weight; return null; }
      return e / m * p.weight;
    });
    let raw = per.reduce(function (a, b) { return a + (b || 0); }, 0);
    if (exW > 0 && exW < 100) raw = raw * 100 / (100 - exW);
    const ded = deductOf(cid), total = Math.max(0, raw - ded);
    let auto = '';
    if (any) {
      const t = Math.round(total + 1e-9), sc2 = C.scale;
      if (sc2.mode === 'pass') auto = t >= sc2.pass ? 'ผ' : 'มผ';
      else { auto = '0'; for (let i = 0; i < 7; i++) if (t >= sc2.th[i]) { auto = String(GRADE_STEPS[i]); break; } }
    }
    return { per: per, raw: raw, ded: ded, total: total, auto: auto, result: s.special || auto };
  }

  async function openCourse(id) {
    $('gb-home').classList.add('hidden');
    $('gb-course').classList.remove('hidden');
    $('gb-c-title').textContent = 'กำลังโหลด...';
    $('gb-c-info').innerHTML = ''; $('gb-c-status').innerHTML = ''; $('gb-tab-grid').innerHTML = ''; $('gb-tab-items').innerHTML = ''; $('gb-tab-ded').innerHTML = '';
    $('gb-c-actions').classList.add('hidden');
    C = null; pending = {}; saveErr = ''; renderSave();
    let r;
    try { r = await api('acad.gb_course', { course_id: id }, { loadingMsg: 'กำลังโหลดรายวิชา...' }); }
    catch (e) { $('gb-c-title').textContent = 'เปิดรายวิชาไม่ได้'; $('gb-tab-grid').innerHTML = '<div class="alert alert-danger">' + esc(e.message) + '</div>'; return; }
    C = r;
    const c = r.course;
    $('gb-sub').textContent = 'วิชาการ · ' + termLabel(c.term);
    $('gb-c-title').textContent = c.subject_name + ' · ' + c.class_label;
    $('gb-c-info').innerHTML = [c.subject_code && '<span>รหัสวิชา ' + esc(c.subject_code) + '</span>', c.type_label && '<span class="gb-tag">' + esc(c.type_label) + '</span>',
      '<span>👩‍🏫 ' + esc(c.teacher_name || '-') + '</span>', '<span>' + esc(termLabel(c.term)) + '</span>',
      '<span><i class="bi bi-people"></i> ' + activeStudents().length + ' คน</span>',
      '<span class="gb-tag">' + (r.scale.mode === 'pass' ? 'ผ่าน/ไม่ผ่าน' : 'เกรด 0–4') + '</span>',
      !r.can_edit && !r.locked && '<span class="gb-tag">ดูอย่างเดียว</span>'].filter(Boolean).join('');
    $('gb-c-actions').classList.toggle('hidden', !r.can_edit);
    $('gb-c-status').innerHTML = r.locked ? '<div class="gb-banner"><i class="bi bi-lock-fill"></i><span style="flex:1">ส่งผลการเรียนแล้ว' +
      (r.submitted && r.submitted.at ? ' เมื่อ ' + esc(Utils.fmtDateTime ? Utils.fmtDateTime(r.submitted.at) : r.submitted.at) : '') + (r.submitted && r.submitted.by ? ' โดย ' + esc(r.submitted.by) : '') +
      ' — รายวิชาถูกล็อก' + (r.can_unlock ? '' : ' (แก้ไขต้องให้ฝ่ายวิชาการปลดล็อก)') + '</span>' +
      (r.can_unlock ? '<button class="btn btn-secondary btn-sm" id="gb-btn-unlock"><i class="bi bi-unlock"></i> ปลดล็อก</button>' : '') + '</div>' : '';
    if ($('gb-btn-unlock')) $('gb-btn-unlock').onclick = unlockCourse;
    setTab(C.items.length || C.scale.mode === 'pass' || curTab === 'ded' ? curTab : 'items');
    renderAll();
  }

  function renderAll() {
    renderGrid(); renderItems(); renderDed();
    $('gb-n-items').textContent = C.items.length ? '(' + C.items.length + ')' : '';
    const nd = C.deductions.filter(function (d) { return !d.voided; }).length;
    $('gb-n-ded').textContent = nd ? '(' + nd + ')' : '';
  }

  function setTab(t) {
    curTab = t;
    document.querySelectorAll('[data-tab]').forEach(function (b) { b.classList.toggle('active', b.dataset.tab === t); b.setAttribute('aria-selected', b.dataset.tab === t); });
    ['grid', 'items', 'ded'].forEach(function (k) { $('gb-tab-' + k).classList.toggle('hidden', t !== k); });
    if (t === 'grid') fixHeader();
  }
  function fixHeader() { const tr = document.querySelector('.gb-grid-t thead tr'); if (tr) tr.parentNode.parentNode.style.setProperty('--gb-h1', tr.offsetHeight + 'px'); }

  /* ── ตารางคะแนน ── */
  function cellHtml(cid, it, ed) {
    const v = scoreOf(cid, it.item_id), f = flagOf(cid, it.item_id);
    if (f === 'missing' || f === 'exempt') {
      return ed ? '<button class="gb-flag' + (f === 'missing' ? ' miss' : '') + '" data-open="' + esc(it.item_id) + '" title="แก้ป้ายได้ที่ บันทึกคะแนน ของงานนี้">' + FLAG_LABEL[f] + '</button>'
        : '<span class="gb-flag' + (f === 'missing' ? ' miss' : '') + '">' + FLAG_LABEL[f] + '</span>';
    }
    const lateT = f === 'late' ? 'ส่งช้า' + (it.late_pct ? ' หัก ' + fmt(it.late_pct) + '%' : '') : '';
    if (!ed) return '<span' + (f === 'late' ? ' style="color:var(--orange)" title="' + lateT + '"' : '') + '>' + fmt(v) + (f === 'late' ? '<small>*</small>' : '') + '</span>';
    return '<input class="gb-cell' + (f === 'late' ? ' late' : '') + (pending[it.item_id + '|' + cid] !== undefined ? ' dirty' : '') + '" inputmode="decimal" autocomplete="off" data-i="' + esc(it.item_id) + '" data-s="' + esc(cid) + '" value="' + esc(fmt(v)) + '" aria-label="' + esc(it.title) + '"' + (lateT ? ' title="' + lateT + '"' : '') + '>';
  }
  function resHtml(s, r) {
    if (C.can_edit && !s.left) {
      return '<select class="gb-sp' + (s.special ? ' special' : '') + '" data-sp="' + esc(s.citizen_id) + '" aria-label="ผลการเรียน">' +
        '<option value="">' + esc(r.auto || '–') + '</option>' + SPECIAL[C.scale.mode].map(function (x) { return '<option' + (s.special === x ? ' selected' : '') + '>' + x + '</option>'; }).join('') + '</select>';
    }
    return '<span' + (s.special ? ' style="color:#C62828"' : '') + '>' + esc(r.result || '–') + '</span>';
  }
  function visiblePeriods() { return C.periods.filter(function (p) { return p.weight > 0 || itemsOf(p.no).length; }); }
  function renderGrid() {
    const box = $('gb-tab-grid');
    if (!C.students.length) { box.innerHTML = '<div class="alert alert-info" style="margin:0">ไม่พบนักเรียนที่กำลังศึกษาในชั้น ' + esc(C.course.class_label) + '</div>'; return; }
    const ps = visiblePeriods(), resLabel = C.scale.mode === 'pass' ? 'ผล' : 'เกรด';
    let h1 = '<tr><th class="c-no" rowspan="2">ที่</th><th class="c-name" rowspan="2">ชื่อ-สกุล</th>', h2 = '<tr>';
    ps.forEach(function (p) {
      const its = itemsOf(p.no);
      h1 += '<th colspan="' + (its.length + 1) + '">' + esc(p.label) + ' <span class="gb-w">' + p.weight + '</span></th>';
      its.forEach(function (i) { h2 += '<th class="it" title="' + esc(i.title) + '">' + esc(i.title) + '<small>เต็ม ' + fmt(i.max_score) + (i.late_pct ? ' · ช้า −' + fmt(i.late_pct) + '%' : '') + '</small></th>'; });
      h2 += '<th class="sum">รวม<small style="display:block;font-weight:400">/' + p.weight + '</small></th>';
    });
    h1 += '<th class="ded" rowspan="2">หัก</th><th class="tot" rowspan="2">รวม<small style="display:block;font-weight:400">/100</small></th><th class="res" rowspan="2">' + resLabel + '</th></tr>'; h2 += '</tr>';
    const body = C.students.map(function (s) {
      const ed = C.can_edit && !s.left, r = calc(s.citizen_id);
      let tds = '<td class="c-no">' + (s.no || '') + '</td><td class="c-name" data-no-i18n title="' + esc(s.name) + '">' + esc(s.name) + (s.left ? ' <small>(ออกจากชั้น)</small>' : '') + '</td>';
      ps.forEach(function (p) {
        itemsOf(p.no).forEach(function (i) { tds += '<td>' + cellHtml(s.citizen_id, i, ed) + '</td>'; });
        tds += '<td class="sum" data-sum="' + p.no + '">' + (r.per[p.no - 1] == null ? '–' : fmt(r.per[p.no - 1])) + '</td>';
      });
      tds += '<td class="ded">' + dedCell(s, r) + '</td><td class="tot">' + (r.auto || r.raw ? fmt(r.total) : '–') + '</td><td class="res">' + resHtml(s, r) + '</td>';
      return '<tr data-row="' + esc(s.citizen_id) + '"' + (s.left ? ' class="left"' : '') + '>' + tds + '</tr>';
    }).join('');
    box.innerHTML = (!C.items.length ? '<div class="alert alert-info" style="margin:0 0 10px">ยังไม่มีงาน/ช่องคะแนน' + (C.can_edit ? ' — กด <strong>เพิ่มงาน</strong> เพื่อสร้างช่องบันทึกคะแนน' + (C.scale.mode === 'pass' ? ' หรือเลือก ผ/มผ ในช่อง "ผล" รายคนได้เลย' : '') : '') + '</div>' : '') +
      (C.can_edit && C.scale.mode === 'pass' ? '<div style="margin:0 0 10px"><button class="btn btn-secondary btn-sm" id="gb-pass-all" style="margin:0"><i class="bi bi-check2-all"></i> กำหนด ผ ให้ทุกคนที่ยังไม่มีผล</button></div>' : '') +
      '<div class="gb-gridwrap"><table class="gb-grid-t"><thead>' + h1 + h2 + '</thead><tbody>' + body + '</tbody><tfoot>' + footHtml(ps) + '</tfoot></table></div>' +
      '<p class="tt-note" style="margin:8px 0 0">' + (C.can_edit ? 'พิมพ์คะแนนในช่องได้เลย บันทึกอัตโนมัติ · Enter/↓ = คนถัดไป · ' : '') + 'คะแนนแต่ละช่วงย่อตามน้ำหนัก · ช่องว่าง/ไม่ส่ง = 0 · * = ส่งช้า · ' +
      (C.scale.mode === 'pass' ? 'ผ่านเมื่อคะแนนรวม ≥ ' + C.scale.pass : 'ตัดเกรดจากคะแนนรวมปัดเป็นจำนวนเต็ม (เกรด 1 ≥ ' + C.scale.th[6] + ')') + '</p>';
    box.querySelectorAll('[data-open]').forEach(function (b) { b.onclick = function () { openEntry(b.dataset.open); }; });
    if ($('gb-pass-all')) $('gb-pass-all').onclick = function () {
      const ids = activeStudents().filter(function (x) { return !x.special && !calc(x.citizen_id).auto; }).map(function (x) { return x.citizen_id; });
      if (!ids.length) { Toast.show('ทุกคนมีผลแล้ว', 'info'); return; }
      if (confirm('กำหนดผล "ผ" ให้ ' + ids.length + ' คนที่ยังไม่มีผล?')) saveSpecial(ids, 'ผ');
    };
    if (curTab === 'grid') fixHeader();
  }
  function dedCell(s, r) {
    if (!r.ded) return C.can_edit && !s.left ? '<button data-dedfor="' + esc(s.citizen_id) + '" title="หักคะแนน" style="color:var(--muted);text-decoration:none">+</button>' : '';
    return '<button data-dedlist="' + esc(s.citizen_id) + '" title="ดูรายการหัก">−' + fmt(r.ded) + '</button>';
  }
  function avg(list) { const v = list.filter(function (x) { return x != null; }); return v.length ? v.reduce(function (a, b) { return a + b; }, 0) / v.length : null; }
  function footHtml(ps) {
    const st = activeStudents();
    let f = '<tr><td class="c-no"></td><td class="c-name">เฉลี่ย</td>';
    const rs = st.map(function (s) { return calc(s.citizen_id); });
    ps.forEach(function (p) {
      itemsOf(p.no).forEach(function (i) { f += '<td>' + fmt(avg(st.map(function (s) { return scoreOf(s.citizen_id, i.item_id); }))) + '</td>'; });
      f += '<td class="sum">' + (itemsOf(p.no).length && p.weight ? fmt(avg(rs.map(function (r) { return r.per[p.no - 1]; }))) : '–') + '</td>';
    });
    const gp = rs.map(function (r) { return C.scale.mode === 'grade' && /^[0-9.]+$/.test(r.result) ? Number(r.result) : null; });
    return f + '<td class="ded"></td><td class="tot">' + (C.items.length ? fmt(avg(rs.map(function (r) { return r.total; }))) : '') + '</td><td class="res">' + (C.scale.mode === 'grade' ? fmt(avg(gp)) : passCount(rs)) + '</td></tr>';
  }
  function passCount(rs) { const p = rs.filter(function (r) { return r.result === 'ผ'; }).length; return rs.length ? 'ผ ' + p + '/' + rs.length : ''; }
  function updateRow(cid) {
    const tr = document.querySelector('tr[data-row="' + CSS.escape(cid) + '"]');
    if (!tr) return;
    const r = calc(cid), s = studentBy(cid);
    tr.querySelectorAll('[data-sum]').forEach(function (td) { const v = r.per[Number(td.dataset.sum) - 1]; td.textContent = v == null ? '–' : fmt(v); });
    tr.querySelector('.tot').textContent = r.auto || r.raw ? fmt(r.total) : '–';
    tr.querySelector('td.ded').innerHTML = dedCell(s, r);
    tr.querySelector('td.res').innerHTML = resHtml(s, r);
    const tf = document.querySelector('.gb-grid-t tfoot');
    if (tf) tf.innerHTML = footHtml(visiblePeriods());
  }

  /* ── รับค่าคะแนน (ใช้ร่วมกันทั้งตาราง + บันทึกทีละงาน) ── */
  function itemById(id) { return C.items.find(function (i) { return i.item_id === id; }); }
  function queueCell(it, cid) {
    pending[it.item_id + '|' + cid] = { v: scoreOf(cid, it.item_id), f: flagOf(cid, it.item_id) };
    document.querySelectorAll('.gb-cell[data-i="' + CSS.escape(it.item_id) + '"][data-s="' + CSS.escape(cid) + '"]').forEach(function (x) { x.classList.add('dirty'); });
    updateRow(cid);
    if (entryItem && entryItem.item_id === it.item_id) updateEntrySub();
    queueSave();
  }
  function onCellInput(el) {
    const it = itemById(el.dataset.i), cid = el.dataset.s;
    if (!it) return;
    const raw = el.value.trim().replace(',', '.');
    let v = null, bad = false;
    if (raw !== '') { v = Number(raw); bad = !isFinite(v) || v < 0 || v > it.max_score; }
    el.classList.toggle('bad', bad);
    el.title = bad ? 'คะแนนต้องอยู่ระหว่าง 0–' + fmt(it.max_score) : (flagOf(cid, it.item_id) === 'late' ? 'ส่งช้า' : '');
    if (bad) return;
    if (v != null) v = Math.round(v * 100) / 100;
    setScore(cid, it.item_id, v);
    document.querySelectorAll('.gb-cell[data-i="' + CSS.escape(it.item_id) + '"][data-s="' + CSS.escape(cid) + '"]').forEach(function (x) { if (x !== el) x.value = fmt(v); });
    const eff = document.querySelector('#gb-e-list [data-eff="' + CSS.escape(cid) + '"]');
    if (eff) eff.textContent = effText(cid, it);
    queueCell(it, cid);
  }
  function onCellKey(e) {
    const el = e.target;
    if (!el.classList || !el.classList.contains('gb-cell')) return;
    let dir = 0;
    if (e.key === 'Enter' || e.key === 'ArrowDown') dir = 1; else if (e.key === 'ArrowUp') dir = -1;
    if (!dir) return;
    e.preventDefault();
    const scope = el.closest('#gb-e-list') || el.closest('tbody');
    const col = Array.prototype.filter.call(scope.querySelectorAll('.gb-cell'), function (x) { return x.dataset.i === el.dataset.i && !x.disabled; });
    const nx = col[col.indexOf(el) + dir];
    if (nx) { nx.focus(); nx.select(); } else if (dir === 1 && el.closest('#gb-e-list')) el.blur();
  }
  document.addEventListener('input', function (e) { if (e.target.classList && e.target.classList.contains('gb-cell')) onCellInput(e.target); });
  document.addEventListener('keydown', onCellKey);
  document.addEventListener('focusin', function (e) { if (e.target.classList && e.target.classList.contains('gb-cell')) e.target.select(); });
  // ผลพิเศษ (ร/มส · ผ/มผ) + ปุ่มหักคะแนนในตาราง
  document.addEventListener('change', function (e) { if (e.target.dataset && e.target.dataset.sp !== undefined) saveSpecial([e.target.dataset.sp], e.target.value); });
  document.addEventListener('click', function (e) {
    const b = e.target.closest && e.target.closest('[data-dedfor],[data-dedlist]');
    if (!b || !C) return;
    if (b.dataset.dedfor) openDeduct([b.dataset.dedfor]);
    else { setTab('ded'); const row = document.querySelector('#gb-tab-ded [data-cid="' + CSS.escape(b.dataset.dedlist) + '"]'); if (row) row.scrollIntoView({ block: 'center' }); }
  });

  async function saveSpecial(cids, v) {
    const old = {};
    cids.forEach(function (c) { const s = studentBy(c); old[c] = s.special; s.special = v; });
    try {
      await api('acad.gb_special_save', { course_id: C.course.course_id, items: cids.map(function (c) { return { citizen_id: c, special: v }; }) }, { loading: false });
      Toast.show(v ? 'กำหนดผล "' + v + '" แล้ว' + (cids.length > 1 ? ' ' + cids.length + ' คน' : '') : 'ใช้ผลตามคะแนนแล้ว');
    } catch (e) { cids.forEach(function (c) { studentBy(c).special = old[c]; }); }
    cids.forEach(updateRow);
  }

  /* ── บันทึกอัตโนมัติ ── */
  function renderSave() {
    const n = Object.keys(pending).length;
    let cls = '', txt = '';
    if (saveErr) { cls = 'err'; txt = '⚠️ บันทึกไม่สำเร็จ — แตะเพื่อลองใหม่'; }
    else if (saving || n) { cls = 'pending'; txt = saving ? 'กำลังบันทึก...' : 'รอบันทึก ' + n + ' ช่อง'; }
    else if (C && C._saved) { cls = 'ok'; txt = '✓ บันทึกแล้ว'; }
    ['gb-save', 'gb-save2'].forEach(function (id) { const el = $(id); el.className = 'gb-save ' + cls + (txt ? '' : ' hidden'); el.textContent = txt; el.title = saveErr; });
  }
  function queueSave() { saveErr = ''; renderSave(); clearTimeout(saveTimer); saveTimer = setTimeout(flush, 900); }
  async function flush() {
    clearTimeout(saveTimer);
    if (saving || !C) return;
    const keys = Object.keys(pending);
    if (!keys.length) { renderSave(); return; }
    saving = true; renderSave();
    const courseId = C.course.course_id;
    try {
      for (let i = 0; i < keys.length; i += 200) {
        const part = keys.slice(i, i + 200), sent = {};
        const scores = part.map(function (k) { const ix = k.indexOf('|'); sent[k] = pending[k]; return { item_id: k.slice(0, ix), citizen_id: k.slice(ix + 1), score: pending[k].v, flag: pending[k].f }; });
        await api('acad.gb_score_save', { course_id: courseId, scores: scores }, { loading: false, silent: true });
        if (!C || C.course.course_id !== courseId) return;
        part.forEach(function (k) {
          if (pending[k] === sent[k]) {
            delete pending[k];
            const ix = k.indexOf('|');
            document.querySelectorAll('.gb-cell[data-i="' + CSS.escape(k.slice(0, ix)) + '"][data-s="' + CSS.escape(k.slice(ix + 1)) + '"]').forEach(function (x) { x.classList.remove('dirty'); });
          }
        });
      }
      C._saved = true; saveErr = '';
    } catch (e) {
      saveErr = e.message || 'เชื่อมต่อไม่ได้';
      Toast.show('บันทึกคะแนนไม่สำเร็จ: ' + saveErr, 'danger', 6000);
    } finally {
      saving = false; renderSave();
      if (!saveErr && Object.keys(pending).length) queueSave();
    }
  }
  ['gb-save', 'gb-save2'].forEach(function (id) { $(id).onclick = function () { if (saveErr) { saveErr = ''; flush(); } }; });
  window.addEventListener('beforeunload', function (e) { if (saving || Object.keys(pending).length) { flush(); e.preventDefault(); e.returnValue = ''; } });

  /* ── งาน/ช่องคะแนน ── */
  function entered(it) { return activeStudents().filter(function (s) { return scoreOf(s.citizen_id, it.item_id) != null || flagOf(s.citizen_id, it.item_id); }).length; }
  function renderItems() {
    const box = $('gb-tab-items'), n = activeStudents().length, ed = C.can_edit;
    let h = C.periods.map(function (p) {
      const its = itemsOf(p.no);
      if (!p.weight && !its.length) return '';
      return '<div class="gb-period' + (p.weight ? '' : ' zero') + '"><div class="gb-period-h"><strong>' + esc(p.label) + '</strong><span class="gb-w">' + p.weight + ' คะแนน</span>' +
        '<span class="tt-note">' + its.length + ' งาน · เต็มรวม ' + fmt(its.reduce(function (a, i) { return a + i.max_score; }, 0)) + '</span><span style="flex:1"></span>' +
        (ed && p.weight ? '<button class="btn-link" data-add="' + p.no + '"><i class="bi bi-plus-lg"></i> เพิ่มงานในช่วงนี้</button>' : '') + '</div>' +
        (its.length ? its.map(function (i) {
          const k = entered(i), pct = n ? Math.round(k / n * 100) : 0;
          return '<div class="gb-item"><div class="t"><b>' + esc(i.title) + '</b><small>เต็ม ' + fmt(i.max_score) + (i.late_pct ? ' · ส่งช้าหัก ' + fmt(i.late_pct) + '%' : '') + (i.item_date ? ' · ' + esc(Utils.fmtDateThai(i.item_date)) : '') + (i.note ? ' · ' + esc(i.note) : '') + '</small></div>' +
            '<span class="tt-note" title="บันทึกแล้ว ' + k + ' จาก ' + n + ' คน">' + k + '/' + n + '</span><span class="gb-bar-p"><i style="width:' + pct + '%"></i></span>' +
            (ed ? '<button class="btn btn-primary" data-entry="' + esc(i.item_id) + '"><i class="bi bi-pencil-square"></i> บันทึกคะแนน</button>' +
              '<button class="btn btn-secondary" data-edit="' + esc(i.item_id) + '" aria-label="แก้ไขงาน"><i class="bi bi-gear"></i></button>' +
              '<button class="btn btn-secondary" data-del="' + esc(i.item_id) + '" aria-label="ลบงาน"><i class="bi bi-trash"></i></button>'
              : '<button class="btn btn-secondary" data-entry="' + esc(i.item_id) + '">ดูคะแนน</button>') + '</div>';
        }).join('') : '<p class="tt-note" style="margin:4px 0 0">ยังไม่มีงานในช่วงนี้</p>') + '</div>';
    }).join('');
    if (C.removed_items.length && ed) {
      h += '<details style="margin-top:6px"><summary class="tt-note" style="cursor:pointer">งานที่ลบแล้ว (' + C.removed_items.length + ') — กู้คืนพร้อมคะแนนเดิมได้</summary>' +
        C.removed_items.map(function (i) {
          return '<div class="gb-item"><div class="t"><b>' + esc(i.title) + '</b><small>' + esc(C.periods[i.period - 1].label) + ' · เต็ม ' + fmt(i.max_score) + '</small></div><button class="btn btn-secondary" data-restore="' + esc(i.item_id) + '"><i class="bi bi-arrow-counterclockwise"></i> กู้คืน</button></div>';
        }).join('') + '</details>';
    }
    box.innerHTML = h || '<div class="alert alert-info" style="margin:0">ยังไม่มีงาน</div>';
    box.querySelectorAll('[data-add]').forEach(function (b) { b.onclick = function () { openItem(null, Number(b.dataset.add)); }; });
    box.querySelectorAll('[data-edit]').forEach(function (b) { b.onclick = function () { openItem(itemById(b.dataset.edit)); }; });
    box.querySelectorAll('[data-entry]').forEach(function (b) { b.onclick = function () { openEntry(b.dataset.entry); }; });
    box.querySelectorAll('[data-del]').forEach(function (b) { b.onclick = function () { removeItem(itemById(b.dataset.del)); }; });
    box.querySelectorAll('[data-restore]').forEach(function (b) { b.onclick = function () { restoreItem(b.dataset.restore); }; });
  }
  function sortItems() { C.items.sort(function (a, b) { return a.period - b.period || String(a.item_date || '9').localeCompare(String(b.item_date || '9')); }); }

  /* modal */
  function showModal(id) { $(id).classList.add('show'); }
  function hideModal(id) { $(id).classList.remove('show'); if (id === 'gb-m-entry') { entryItem = null; flush(); renderAll(); } }
  document.querySelectorAll('.modal-backdrop').forEach(function (m) {
    m.addEventListener('click', function (e) { if (e.target === m || e.target.closest('[data-close]')) hideModal(m.id); });
  });
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape') { const m = document.querySelector('.modal-backdrop.show'); if (m) hideModal(m.id); } });

  let editingItem = null;
  function openItem(it, period) {
    editingItem = it;
    $('gb-i-title').textContent = it ? '✏️ แก้ไขงาน' : '➕ เพิ่มงาน';
    $('gb-i-period').innerHTML = C.periods.filter(function (p) { return p.weight > 0 || (it && it.period === p.no); })
      .map(function (p) { return '<option value="' + p.no + '">' + esc(p.label) + ' (' + p.weight + ' คะแนน)</option>'; }).join('');
    $('gb-i-period').value = String(it ? it.period : (period || lastPeriod()));
    if (!$('gb-i-period').value) $('gb-i-period').selectedIndex = 0;
    $('gb-i-name').value = it ? it.title : '';
    $('gb-i-max').value = it ? fmt(it.max_score) : '10';
    $('gb-i-late').value = it ? fmt(it.late_pct) : '0';
    $('gb-i-date').value = it ? it.item_date : '';
    $('gb-i-note').value = it ? it.note : '';
    showModal('gb-m-item');
    setTimeout(function () { $('gb-i-name').focus(); }, 50);
  }
  function lastPeriod() { const l = C.items[C.items.length - 1]; return l ? l.period : (C.periods.find(function (p) { return p.weight > 0; }) || { no: 1 }).no; }
  $('gb-i-save').onclick = async function () {
    const p = { course_id: C.course.course_id, period: Number($('gb-i-period').value), title: $('gb-i-name').value.trim(), max_score: Number($('gb-i-max').value),
      late_pct: Number($('gb-i-late').value || 0), item_date: $('gb-i-date').value, note: $('gb-i-note').value.trim() };
    if (!p.title) { Toast.show('กรอกชื่องาน', 'warning'); $('gb-i-name').focus(); return; }
    if (!(p.max_score > 0 && p.max_score <= 1000)) { Toast.show('คะแนนเต็มต้องมากกว่า 0 และไม่เกิน 1000', 'warning'); $('gb-i-max').focus(); return; }
    if (!(p.late_pct >= 0 && p.late_pct <= 100)) { Toast.show('% หักเมื่อส่งช้าต้องอยู่ระหว่าง 0–100', 'warning'); $('gb-i-late').focus(); return; }
    if (editingItem) p.item_id = editingItem.item_id;
    try {
      const r = await api('acad.gb_item_save', p, { loadingMsg: 'กำลังบันทึกงาน...', noRetry: true });
      const ix = C.items.findIndex(function (i) { return i.item_id === r.item.item_id; });
      if (ix >= 0) C.items[ix] = r.item; else C.items.push(r.item);
      sortItems(); homeStale = true;
      hideModal('gb-m-item');
      renderAll();
      Toast.show(editingItem ? 'แก้ไขงานแล้ว' : 'เพิ่มงาน "' + r.item.title + '" แล้ว');
    } catch (e) { /* api แสดงข้อความแล้ว */ }
  };
  $('gb-i-name').addEventListener('keydown', function (e) { if (e.key === 'Enter') $('gb-i-save').click(); });

  async function removeItem(it) {
    if (!it) return;
    const k = entered(it);
    if (!confirm('ลบงาน "' + it.title + '" ?' + (k ? '\n(มีคะแนนแล้ว ' + k + ' คน — คะแนนยังเก็บไว้ กู้คืนได้ที่ "งานที่ลบแล้ว")' : ''))) return;
    await flush();
    try {
      await api('acad.gb_item_remove', { course_id: C.course.course_id, item_id: it.item_id }, { loadingMsg: 'กำลังลบ...' });
      C.items = C.items.filter(function (i) { return i.item_id !== it.item_id; });
      it.active = false; C.removed_items.push(it); homeStale = true;
      Object.keys(pending).forEach(function (key) { if (key.indexOf(it.item_id + '|') === 0) delete pending[key]; });
      renderAll(); renderSave();
    } catch (e) { }
  }
  async function restoreItem(id) {
    try {
      const r = await api('acad.gb_item_save', { course_id: C.course.course_id, item_id: id, active: true }, { loadingMsg: 'กำลังกู้คืน...' });
      C.removed_items = C.removed_items.filter(function (i) { return i.item_id !== id; });
      C.items.push(r.item); sortItems(); homeStale = true;
      renderAll();
      Toast.show('กู้คืน "' + r.item.title + '" แล้ว');
    } catch (e) { }
  }

  /* ── ตั้งค่าวิชา (น้ำหนัก + ผลการเรียน) ── */
  function openSettings() {
    $('gb-w-rows').innerHTML = C.periods.map(function (p) {
      return '<div class="gb-wrow"><label for="gb-w-' + p.no + '">' + esc(p.label) + ' <span class="tt-note">(' + itemsOf(p.no).length + ' งาน)</span></label><input class="form-control" id="gb-w-' + p.no + '" type="number" inputmode="numeric" min="0" max="100" step="1" value="' + p.weight + '"></div>';
    }).join('');
    $('gb-w-rows').oninput = wSum; wSum();
    $('gb-s-mode').value = C.scale.mode;
    $('gb-s-th').innerHTML = GRADE_STEPS.map(function (g, i) { return '<div><label for="gb-s-t' + i + '">เกรด ' + g + ' ≥</label><input class="form-control" id="gb-s-t' + i + '" type="number" inputmode="numeric" min="1" max="100" value="' + C.scale.th[i] + '"></div>'; }).join('');
    $('gb-s-passv').value = C.scale.pass;
    modeUi();
    showModal('gb-m-settings');
  }
  function modeUi() { const g = $('gb-s-mode').value === 'grade'; $('gb-s-grade').classList.toggle('hidden', !g); $('gb-s-pass').classList.toggle('hidden', g); }
  $('gb-s-mode').onchange = modeUi;
  function wVals() { return C.periods.map(function (p) { return Number($('gb-w-' + p.no).value || 0); }); }
  function wSum() { const s = wVals().reduce(function (a, b) { return a + b; }, 0); $('gb-w-sum').textContent = s; $('gb-w-sum').style.color = s === 100 ? 'var(--green-dark)' : 'var(--red)'; }
  $('gb-w-save').onclick = async function () {
    const w = wVals();
    if (w.reduce(function (a, b) { return a + b; }, 0) !== 100) { Toast.show('น้ำหนักรวมต้องเท่ากับ 100', 'warning'); return; }
    const th = GRADE_STEPS.map(function (g, i) { return Number($('gb-s-t' + i).value); });
    if (th.some(function (n, i) { return !(n > 0 && n <= 100) || (i && n >= th[i - 1]); })) { Toast.show('เกณฑ์เกรดต้องเป็น 1–100 และเรียงจากมากไปน้อย', 'warning'); return; }
    const scale = { mode: $('gb-s-mode').value, th: th, pass: Number($('gb-s-passv').value) };
    try {
      const r = await api('acad.gb_course_save', { course_id: C.course.course_id, weights: w, scale: scale }, { loadingMsg: 'กำลังบันทึก...' });
      C.periods.forEach(function (p, i) { p.weight = r.weights[i]; });
      const modeChanged = r.scale.mode !== C.scale.mode;
      C.scale = r.scale;
      hideModal('gb-m-settings');
      if (modeChanged) openCourse(C.course.course_id); else renderAll();
      Toast.show('บันทึกการตั้งค่าแล้ว');
    } catch (e) { }
  };

  /* ── บันทึกทีละงาน ── */
  let entryItem = null;
  function effText(cid, it) {
    const v = scoreOf(cid, it.item_id);
    return flagOf(cid, it.item_id) === 'late' && it.late_pct > 0 && v != null ? 'ได้จริง ' + fmt(v * (1 - it.late_pct / 100)) + ' (หัก ' + fmt(it.late_pct) + '%)' : '';
  }
  function openEntry(id) {
    const it = itemById(id); if (!it) return;
    entryItem = it;
    const ed = C.can_edit;
    $('gb-e-title').textContent = it.title;
    $('gb-e-fill').classList.toggle('hidden', !ed);
    $('gb-e-list').innerHTML = activeStudents().map(function (s) {
      const v = scoreOf(s.citizen_id, it.item_id), f = flagOf(s.citizen_id, it.item_id), off = f === 'missing' || f === 'exempt';
      return '<li><span class="n">' + s.no + '</span><span class="nm"><span data-no-i18n>' + esc(s.name) + '</span><span class="eff" data-eff="' + esc(s.citizen_id) + '">' + esc(effText(s.citizen_id, it)) + '</span></span>' +
        (ed ? cellHtml(s.citizen_id, it, true) +
          '<select data-flag="' + esc(s.citizen_id) + '" aria-label="ป้าย">' + Object.keys(FLAG_LABEL).map(function (k) { return '<option value="' + k + '"' + (f === k ? ' selected' : '') + '>' + FLAG_LABEL[k] + '</option>'; }).join('') + '</select>'
          : '<strong style="width:84px;text-align:center">' + (off ? FLAG_LABEL[f] : (v == null ? '–' : fmt(v))) + '</strong>') +
        '<span class="mx">/ ' + fmt(it.max_score) + '</span></li>';
    }).join('') || '<li class="tt-note">ไม่มีนักเรียน</li>';
    // ช่องที่ติดป้ายไม่ส่ง/ยกเว้น: แสดงเป็นช่องว่างที่ปิดไว้ (แทนปุ่มในตาราง)
    $('gb-e-list').querySelectorAll('button.gb-flag').forEach(function (b) {
      const inp = document.createElement('input'); inp.className = 'gb-cell'; inp.disabled = true; inp.value = b.textContent; inp.dataset.i = it.item_id;
      inp.dataset.s = b.closest('li').querySelector('[data-flag]').dataset.flag; b.replaceWith(inp);
    });
    $('gb-e-list').querySelectorAll('[data-flag]').forEach(function (sel) { sel.onchange = function () { onFlag(it, sel.dataset.flag, sel.value, sel.closest('li')); }; });
    updateEntrySub(); renderSave();
    showModal('gb-m-entry');
    if (ed && window.matchMedia('(min-width:641px)').matches) { const f = $('gb-e-list').querySelector('.gb-cell:not([disabled])'); if (f) setTimeout(function () { f.focus(); }, 50); }
  }
  function onFlag(it, cid, f, li) {
    setFlag(cid, it.item_id, f);
    const inp = li.querySelector('.gb-cell');
    if (f === 'missing' || f === 'exempt') { setScore(cid, it.item_id, null); inp.value = FLAG_LABEL[f]; inp.disabled = true; inp.classList.remove('bad'); }
    else { if (inp.disabled) inp.value = ''; inp.disabled = false; inp.classList.toggle('late', f === 'late'); }
    li.querySelector('[data-eff]').textContent = effText(cid, it);
    queueCell(it, cid);
  }
  function updateEntrySub() {
    const it = entryItem; if (!it) return;
    const p = C.periods[it.period - 1];
    $('gb-e-sub').textContent = p.label + ' · เต็ม ' + fmt(it.max_score) + (it.late_pct ? ' · ส่งช้าหัก ' + fmt(it.late_pct) + '%' : '') + ' · บันทึกแล้ว ' + entered(it) + '/' + activeStudents().length + ' คน';
  }
  $('gb-e-fill').onclick = function () {
    let n = 0;
    $('gb-e-list').querySelectorAll('.gb-cell:not([disabled])').forEach(function (el) { if (el.value.trim() === '') { el.value = fmt(entryItem.max_score); onCellInput(el); n++; } });
    Toast.show(n ? 'เติมคะแนนเต็มให้ ' + n + ' คน' : 'ไม่มีช่องว่าง', n ? 'success' : 'info');
  };

  /* ── หักคะแนนจากคะแนนรวม ── */
  function renderDed() {
    const box = $('gb-tab-ded'), list = C.deductions, ed = C.can_edit;
    const name = function (cid) { const s = studentBy(cid); return s ? s.name : '(ไม่พบนักเรียน)'; };
    box.innerHTML = (ed ? '<div style="margin-bottom:10px"><button class="btn btn-danger btn-sm" id="gb-d-new" style="margin:0"><i class="bi bi-dash-circle"></i> หักคะแนน</button></div>' : '') +
      (!list.length ? '<div class="alert alert-info" style="margin:0">ยังไม่มีการหักคะแนนจากคะแนนรวม</div>' :
        '<div class="table-wrap"><table class="tt-results gb-ded-t"><thead><tr><th>วันที่</th><th>นักเรียน</th><th>หัก</th><th>เหตุผล</th><th>ผู้บันทึก</th>' + (ed ? '<th></th>' : '') + '</tr></thead><tbody>' +
        list.map(function (d) {
          return '<tr data-cid="' + esc(d.citizen_id) + '"' + (d.voided ? ' class="void"' : '') + '><td>' + esc(Utils.fmtDateThai(d.deduct_date)) + '</td><td data-no-i18n>' + esc(name(d.citizen_id)) + '</td>' +
            '<td style="color:#C62828;font-weight:700">−' + fmt(d.points) + '</td><td>' + esc(d.reason) + '</td><td>' + esc(d.by || '-') + '</td>' +
            (ed ? '<td class="vr">' + (d.voided ? '<span class="tt-note">ยกเลิกแล้ว' + (d.void_reason ? ': ' + esc(d.void_reason) : '') + '</span>' : '<button class="btn btn-secondary btn-sm" data-void="' + esc(d.deduct_id) + '" style="margin:0">ยกเลิก</button>') + '</td>'
              : '') + '</tr>';
        }).join('') + '</tbody></table></div>');
    if ($('gb-d-new')) $('gb-d-new').onclick = function () { openDeduct([]); };
    box.querySelectorAll('[data-void]').forEach(function (b) { b.onclick = function () { voidDeduct(b.dataset.void); }; });
  }
  function openDeduct(pre) {
    $('gb-d-pick').innerHTML = activeStudents().map(function (s) {
      return '<label><input type="checkbox" value="' + esc(s.citizen_id) + '"' + (pre.indexOf(s.citizen_id) >= 0 ? ' checked' : '') + '> <span class="tt-note" style="width:22px">' + s.no + '</span> <span data-no-i18n>' + esc(s.name) + '</span></label>';
    }).join('');
    $('gb-d-pts').value = ''; $('gb-d-reason').value = ''; $('gb-d-date').value = Utils.todayYmd();
    showModal('gb-m-ded');
    setTimeout(function () { $('gb-d-pts').focus(); }, 50);
  }
  $('gb-d-all').onclick = function () {
    const boxes = $('gb-d-pick').querySelectorAll('input'), all = Array.prototype.every.call(boxes, function (b) { return b.checked; });
    boxes.forEach(function (b) { b.checked = !all; });
  };
  $('gb-d-save').onclick = async function () {
    const ids = Array.prototype.map.call($('gb-d-pick').querySelectorAll('input:checked'), function (b) { return b.value; });
    const pts = Number($('gb-d-pts').value), reason = $('gb-d-reason').value.trim();
    if (!ids.length) { Toast.show('เลือกนักเรียนอย่างน้อย 1 คน', 'warning'); return; }
    if (!(pts > 0 && pts <= 100)) { Toast.show('คะแนนที่หักต้องมากกว่า 0 และไม่เกิน 100', 'warning'); $('gb-d-pts').focus(); return; }
    if (!reason) { Toast.show('กรอกเหตุผลที่หักคะแนน', 'warning'); $('gb-d-reason').focus(); return; }
    try {
      const r = await api('acad.gb_deduct_add', { course_id: C.course.course_id, citizen_ids: ids, points: pts, reason: reason, deduct_date: $('gb-d-date').value }, { loadingMsg: 'กำลังบันทึก...', noRetry: true });
      C.deductions = r.deductions.concat(C.deductions);
      hideModal('gb-m-ded'); renderAll();
      Toast.show('หักคะแนน ' + fmt(pts) + ' คะแนน ' + ids.length + ' คนแล้ว');
    } catch (e) { }
  };
  async function voidDeduct(id) {
    const d = C.deductions.find(function (x) { return x.deduct_id === id; }); if (!d) return;
    const why = prompt('ยกเลิกการหัก −' + fmt(d.points) + ' (' + d.reason + ')\nเหตุผลที่ยกเลิก (ไม่บังคับ):', '');
    if (why === null) return;
    try {
      const r = await api('acad.gb_deduct_void', { course_id: C.course.course_id, deduct_id: id, reason: why }, { loadingMsg: 'กำลังยกเลิก...' });
      d.voided = true; d.voided_at = r.voided_at; d.void_reason = r.void_reason;
      renderAll();
      Toast.show('ยกเลิกการหักแล้ว');
    } catch (e) { }
  }

  /* ── ส่งผล / ปลดล็อก ── */
  async function submitCourse() {
    await flush();
    if (Object.keys(pending).length || saveErr) { Toast.show('ยังบันทึกคะแนนไม่ครบ — ลองใหม่อีกครั้ง', 'warning'); return; }
    const st = activeStudents(), rs = st.map(function (s) { return calc(s.citizen_id); });
    const noRes = rs.filter(function (r) { return !r.result; }).length;
    if (noRes) { Toast.show('ยังไม่มีผลการเรียน ' + noRes + ' คน — เพิ่มงาน/คะแนน หรือกำหนดผลรายคนก่อนส่ง', 'warning', 6000); return; }
    let blanks = 0;
    st.forEach(function (s) { C.items.forEach(function (i) { if (scoreOf(s.citizen_id, i.item_id) == null && !flagOf(s.citizen_id, i.item_id)) blanks++; }); });
    const dist = {}; rs.forEach(function (r) { dist[r.result] = (dist[r.result] || 0) + 1; });
    const order = C.scale.mode === 'pass' ? ['ผ', 'มผ', 'ร', 'มส'] : ['4', '3.5', '3', '2.5', '2', '1.5', '1', '0', 'ร', 'มส'];
    const sum = order.filter(function (k) { return dist[k]; }).map(function (k) { return (C.scale.mode === 'pass' || isNaN(k) ? k : 'เกรด ' + k) + ': ' + dist[k] + ' คน'; }).join('\n');
    if (!confirm('ส่งผลการเรียน ' + C.course.subject_name + ' · ' + C.course.class_label + ' (' + st.length + ' คน)\n\n' + sum +
      (blanks ? '\n\n⚠️ ยังมีช่องคะแนนว่าง ' + blanks + ' ช่อง (นับเป็น 0)' : '') + '\n\nส่งแล้วรายวิชาจะถูกล็อก แก้ไขต้องให้ฝ่ายวิชาการปลดล็อก — ยืนยัน?')) return;
    try {
      await api('acad.gb_submit', { course_id: C.course.course_id, confirm: true }, { loadingMsg: 'กำลังส่งผล...', noRetry: true });
      homeStale = true;
      Toast.show('ส่งผลการเรียนแล้ว');
      openCourse(C.course.course_id);
    } catch (e) { }
  }
  async function unlockCourse() {
    if (!confirm('ปลดล็อกรายวิชานี้ให้ครูแก้ไขคะแนนได้อีกครั้ง?\n(ครูต้องกดส่งผลใหม่หลังแก้ไข)')) return;
    try {
      await api('acad.gb_unlock', { course_id: C.course.course_id }, { loadingMsg: 'กำลังปลดล็อก...' });
      homeStale = true;
      Toast.show('ปลดล็อกแล้ว');
      openCourse(C.course.course_id);
    } catch (e) { }
  }

  $('gb-btn-settings').onclick = openSettings;
  $('gb-btn-add').onclick = function () { openItem(null); };
  $('gb-btn-deduct').onclick = function () { openDeduct([]); };
  $('gb-btn-submit').onclick = submitCourse;
  document.querySelectorAll('[data-tab]').forEach(function (b) { b.onclick = function () { setTab(b.dataset.tab); }; });

  function route() {
    const m = /^#c=(.+)$/.exec(location.hash);
    if (m) { openCourse(decodeURIComponent(m[1])); return; }
    if (C) { flush(); }
    document.querySelectorAll('.modal-backdrop.show').forEach(function (x) { x.classList.remove('show'); });
    $('gb-course').classList.add('hidden');
    $('gb-home').classList.remove('hidden');
    if (!data || homeStale) { homeStale = false; loadHome(); }
  }

  $('gb-back').onclick = function () { location.hash = ''; };
  $('gb-teacher').onchange = function () { Store.set(KEY_VIEW, this.value); loadHome(); };
  window.addEventListener('hashchange', route);

  TTAuth.require({ caps: ['gb', 'gb_admin', 'gb_view'] }).then(function (u) { me = u; route(); });
})();
