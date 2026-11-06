/**
 * วิชาการ › บันทึกคะแนน — เฟส 1: วิชาของฉัน (จากการมอบหมายในตารางสอน) + รายชื่อนักเรียนรายวิชา
 * เฟส 2: ตั้งค่าน้ำหนัก 4 ช่วง · เพิ่ม/แก้/ลบ(กู้คืนได้) งาน · ตารางคะแนน + บันทึกทีละงาน (บันทึกอัตโนมัติ)
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
              '<span><i class="bi bi-journal-text"></i> ' + (c.items ? c.items + ' งาน' : 'ยังไม่มีงาน') + '</span></span>' +
            (showTeacher ? '<span class="meta"><span>👩‍🏫 ' + esc(c.teacher_name || '-') + '</span></span>' : '') +
          '</button>';
        }).join('') + '</div></div>';
      }).join('');
    box.querySelectorAll('[data-c]').forEach(function (b) { b.onclick = function () { location.hash = 'c=' + encodeURIComponent(b.dataset.c); }; });
  }

  /* ════ รายวิชา ════ */
  let C = null;                 // ข้อมูลรายวิชาที่เปิดอยู่ (จาก acad.gb_course)
  let pending = {};             // 'item_id|citizen_id' → คะแนน (number | null) ที่ยังไม่ได้ส่ง
  let saving = false, saveTimer = null, saveErr = '';
  let curTab = 'grid';

  function fmt(n) { return n == null || n === '' ? '' : String(Math.round(Number(n) * 100) / 100); }
  function activeStudents() { return C.students.filter(function (s) { return !s.left; }); }
  function itemsOf(p) { return C.items.filter(function (i) { return i.period === p; }); }
  function scoreOf(cid, iid) { const r = C.scores[cid]; return r && r[iid] != null ? r[iid] : null; }
  function setScore(cid, iid, v) { if (!C.scores[cid]) C.scores[cid] = {}; if (v == null) delete C.scores[cid][iid]; else C.scores[cid][iid] = v; }

  /** คะแนนช่วง = Σ ได้ / Σ เต็ม × น้ำหนัก (ช่องว่าง = 0) · ช่วงที่ยังไม่มีงาน = null */
  function calc(cid) {
    const per = C.periods.map(function (p) {
      const its = itemsOf(p.no);
      if (!its.length || !p.weight) return null;
      let e = 0, m = 0;
      its.forEach(function (i) { m += i.max_score; e += scoreOf(cid, i.item_id) || 0; });
      return m ? e / m * p.weight : 0;
    });
    return { per: per, total: per.reduce(function (a, b) { return a + (b || 0); }, 0) };
  }

  async function openCourse(id) {
    $('gb-home').classList.add('hidden');
    $('gb-course').classList.remove('hidden');
    $('gb-c-title').textContent = 'กำลังโหลด...';
    $('gb-c-info').innerHTML = ''; $('gb-tab-grid').innerHTML = ''; $('gb-tab-items').innerHTML = '';
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
      !r.can_edit && '<span class="gb-tag">' + (r.locked ? 'ส่งผลแล้ว' : 'ดูอย่างเดียว') + '</span>'].filter(Boolean).join('');
    $('gb-c-actions').classList.toggle('hidden', !r.can_edit);
    setTab(C.items.length ? curTab : 'items');
    renderAll();
  }

  function renderAll() { renderGrid(); renderItems(); $('gb-n-items').textContent = C.items.length ? '(' + C.items.length + ')' : ''; }

  function setTab(t) {
    curTab = t;
    document.querySelectorAll('[data-tab]').forEach(function (b) { b.classList.toggle('active', b.dataset.tab === t); b.setAttribute('aria-selected', b.dataset.tab === t); });
    $('gb-tab-grid').classList.toggle('hidden', t !== 'grid');
    $('gb-tab-items').classList.toggle('hidden', t !== 'items');
    if (t === 'grid') fixHeader();
  }
  function fixHeader() { const tr = document.querySelector('.gb-grid-t thead tr'); if (tr) tr.parentNode.parentNode.style.setProperty('--gb-h1', tr.offsetHeight + 'px'); }

  /* ── ตารางคะแนน ── */
  function cellHtml(cid, it, editable) {
    const v = scoreOf(cid, it.item_id);
    if (!editable) return fmt(v);
    return '<input class="gb-cell' + (pending[it.item_id + '|' + cid] !== undefined ? ' dirty' : '') + '" inputmode="decimal" autocomplete="off" data-i="' + esc(it.item_id) + '" data-s="' + esc(cid) + '" value="' + esc(fmt(v)) + '" aria-label="' + esc(it.title) + '">';
  }
  function renderGrid() {
    const box = $('gb-tab-grid');
    if (!C.students.length) { box.innerHTML = '<div class="alert alert-info" style="margin:0">ไม่พบนักเรียนที่กำลังศึกษาในชั้น ' + esc(C.course.class_label) + '</div>'; return; }
    if (!C.items.length) {
      box.innerHTML = '<div class="alert alert-info" style="margin:0">ยังไม่มีงาน/ช่องคะแนน' + (C.can_edit ? ' — กด <strong>เพิ่มงาน</strong> เพื่อสร้างช่องบันทึกคะแนน เช่น แบบฝึกหัด สอบย่อย สอบกลางภาค' : '') + '</div>';
      return;
    }
    const ps = C.periods.filter(function (p) { return p.weight > 0 || itemsOf(p.no).length; });
    let h1 = '<tr><th class="c-no" rowspan="2">ที่</th><th class="c-name" rowspan="2">ชื่อ-สกุล</th>', h2 = '<tr>';
    ps.forEach(function (p) {
      const its = itemsOf(p.no);
      h1 += '<th colspan="' + (its.length + 1) + '">' + esc(p.label) + ' <span class="gb-w">' + p.weight + '</span></th>';
      its.forEach(function (i) { h2 += '<th class="it" title="' + esc(i.title) + '">' + esc(i.title) + '<small>เต็ม ' + fmt(i.max_score) + '</small></th>'; });
      h2 += '<th class="sum">รวม<small style="display:block;font-weight:400">/' + p.weight + '</small></th>';
    });
    h1 += '<th class="tot" rowspan="2">รวม<small style="display:block;font-weight:400">/100</small></th></tr>'; h2 += '</tr>';
    const body = C.students.map(function (s) {
      const ed = C.can_edit && !s.left, r = calc(s.citizen_id);
      let tds = '<td class="c-no">' + (s.no || '') + '</td><td class="c-name" data-no-i18n title="' + esc(s.name) + '">' + esc(s.name) + (s.left ? ' <small>(ออกจากชั้น)</small>' : '') + '</td>';
      ps.forEach(function (p) {
        itemsOf(p.no).forEach(function (i) { tds += '<td>' + cellHtml(s.citizen_id, i, ed) + '</td>'; });
        tds += '<td class="sum" data-sum="' + p.no + '">' + (r.per[p.no - 1] == null ? '–' : fmt(r.per[p.no - 1])) + '</td>';
      });
      return '<tr data-row="' + esc(s.citizen_id) + '"' + (s.left ? ' class="left"' : '') + '>' + tds + '<td class="tot">' + fmt(r.total) + '</td></tr>';
    }).join('');
    box.innerHTML = '<div class="gb-gridwrap"><table class="gb-grid-t"><thead>' + h1 + h2 + '</thead><tbody>' + body + '</tbody><tfoot>' + footHtml(ps) + '</tfoot></table></div>' +
      '<p class="tt-note" style="margin:8px 0 0">' + (C.can_edit ? 'พิมพ์คะแนนในช่องได้เลย บันทึกอัตโนมัติ · Enter/↓ = คนถัดไป · ' : '') + 'คะแนนรวมแต่ละช่วงย่อตามน้ำหนักอัตโนมัติ · ช่องว่างนับเป็น 0</p>';
    if (curTab === 'grid') fixHeader();
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
    return f + '<td class="tot">' + fmt(avg(rs.map(function (r) { return r.total; }))) + '</td></tr>';
  }
  function updateRow(cid) {
    const tr = document.querySelector('tr[data-row="' + CSS.escape(cid) + '"]');
    if (!tr) return;
    const r = calc(cid);
    tr.querySelectorAll('[data-sum]').forEach(function (td) { const v = r.per[Number(td.dataset.sum) - 1]; td.textContent = v == null ? '–' : fmt(v); });
    tr.querySelector('.tot').textContent = fmt(r.total);
    const tf = document.querySelector('.gb-grid-t tfoot');
    if (tf) tf.innerHTML = footHtml(C.periods.filter(function (p) { return p.weight > 0 || itemsOf(p.no).length; }));
  }

  /* ── รับค่าคะแนน (ใช้ร่วมกันทั้งตาราง + บันทึกทีละงาน) ── */
  function itemById(id) { return C.items.find(function (i) { return i.item_id === id; }); }
  function onCellInput(el) {
    const it = itemById(el.dataset.i), cid = el.dataset.s;
    if (!it) return;
    const raw = el.value.trim().replace(',', '.');
    let v = null, bad = false;
    if (raw !== '') { v = Number(raw); bad = !isFinite(v) || v < 0 || v > it.max_score; }
    el.classList.toggle('bad', bad);
    el.title = bad ? 'คะแนนต้องอยู่ระหว่าง 0–' + fmt(it.max_score) : '';
    if (bad) return;
    if (v != null) v = Math.round(v * 100) / 100;
    setScore(cid, it.item_id, v);
    pending[it.item_id + '|' + cid] = v;
    // ซิงก์ช่องเดียวกันในอีกมุมมอง
    document.querySelectorAll('.gb-cell[data-i="' + CSS.escape(it.item_id) + '"][data-s="' + CSS.escape(cid) + '"]').forEach(function (x) { x.classList.add('dirty'); if (x !== el) x.value = fmt(v); });
    updateRow(cid);
    if (el.closest('#gb-e-list')) updateEntrySub();
    queueSave();
  }
  function onCellKey(e) {
    const el = e.target;
    if (!el.classList || !el.classList.contains('gb-cell')) return;
    let dir = 0;
    if (e.key === 'Enter' || e.key === 'ArrowDown') dir = 1; else if (e.key === 'ArrowUp') dir = -1;
    if (!dir) return;
    e.preventDefault();
    const scope = el.closest('#gb-e-list') || el.closest('tbody');
    const col = Array.prototype.filter.call(scope.querySelectorAll('.gb-cell'), function (x) { return x.dataset.i === el.dataset.i; });
    const nx = col[col.indexOf(el) + dir];
    if (nx) { nx.focus(); nx.select(); } else if (dir === 1 && el.closest('#gb-e-list')) el.blur();
  }
  document.addEventListener('input', function (e) { if (e.target.classList && e.target.classList.contains('gb-cell')) onCellInput(e.target); });
  document.addEventListener('keydown', onCellKey);
  document.addEventListener('focusin', function (e) { if (e.target.classList && e.target.classList.contains('gb-cell')) e.target.select(); });

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
        const scores = part.map(function (k) { const ix = k.indexOf('|'); sent[k] = pending[k]; return { item_id: k.slice(0, ix), citizen_id: k.slice(ix + 1), score: pending[k] }; });
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
  function entered(it) { return activeStudents().filter(function (s) { return scoreOf(s.citizen_id, it.item_id) != null; }).length; }
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
          return '<div class="gb-item"><div class="t"><b>' + esc(i.title) + '</b><small>เต็ม ' + fmt(i.max_score) + (i.item_date ? ' · ' + esc(Utils.fmtDateThai(i.item_date)) : '') + (i.note ? ' · ' + esc(i.note) : '') + '</small></div>' +
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
  function hideModal(id) { $(id).classList.remove('show'); if (id === 'gb-m-entry') { flush(); renderAll(); } }
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
    $('gb-i-date').value = it ? it.item_date : '';
    $('gb-i-note').value = it ? it.note : '';
    showModal('gb-m-item');
    setTimeout(function () { $('gb-i-name').focus(); }, 50);
  }
  function lastPeriod() { const l = C.items[C.items.length - 1]; return l ? l.period : (C.periods.find(function (p) { return p.weight > 0; }) || { no: 1 }).no; }
  $('gb-i-save').onclick = async function () {
    const p = { course_id: C.course.course_id, period: Number($('gb-i-period').value), title: $('gb-i-name').value.trim(), max_score: Number($('gb-i-max').value),
      item_date: $('gb-i-date').value, note: $('gb-i-note').value.trim() };
    if (!p.title) { Toast.show('กรอกชื่องาน', 'warning'); $('gb-i-name').focus(); return; }
    if (!(p.max_score > 0 && p.max_score <= 1000)) { Toast.show('คะแนนเต็มต้องมากกว่า 0 และไม่เกิน 1000', 'warning'); $('gb-i-max').focus(); return; }
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

  /* ── ตั้งค่าวิชา ── */
  function openSettings() {
    $('gb-w-rows').innerHTML = C.periods.map(function (p) {
      return '<div class="gb-wrow"><label for="gb-w-' + p.no + '">' + esc(p.label) + ' <span class="tt-note">(' + itemsOf(p.no).length + ' งาน)</span></label><input class="form-control" id="gb-w-' + p.no + '" type="number" inputmode="numeric" min="0" max="100" step="1" value="' + p.weight + '"></div>';
    }).join('');
    $('gb-w-rows').oninput = wSum; wSum();
    showModal('gb-m-settings');
  }
  function wVals() { return C.periods.map(function (p) { return Number($('gb-w-' + p.no).value || 0); }); }
  function wSum() { const s = wVals().reduce(function (a, b) { return a + b; }, 0); $('gb-w-sum').textContent = s; $('gb-w-sum').style.color = s === 100 ? 'var(--green-dark)' : 'var(--red)'; }
  $('gb-w-save').onclick = async function () {
    const w = wVals();
    if (w.reduce(function (a, b) { return a + b; }, 0) !== 100) { Toast.show('น้ำหนักรวมต้องเท่ากับ 100', 'warning'); return; }
    try {
      const r = await api('acad.gb_course_save', { course_id: C.course.course_id, weights: w }, { loadingMsg: 'กำลังบันทึก...' });
      C.periods.forEach(function (p, i) { p.weight = r.weights[i]; });
      hideModal('gb-m-settings'); renderAll();
      Toast.show('บันทึกน้ำหนักคะแนนแล้ว');
    } catch (e) { }
  };

  /* ── บันทึกทีละงาน ── */
  let entryItem = null;
  function openEntry(id) {
    const it = itemById(id); if (!it) return;
    entryItem = it;
    const ed = C.can_edit;
    $('gb-e-title').textContent = it.title;
    $('gb-e-fill').classList.toggle('hidden', !ed);
    $('gb-e-list').innerHTML = activeStudents().map(function (s) {
      const v = scoreOf(s.citizen_id, it.item_id);
      return '<li><span class="n">' + s.no + '</span><span class="nm" data-no-i18n>' + esc(s.name) + '</span>' +
        (ed ? cellHtml(s.citizen_id, it, true) : '<strong style="width:84px;text-align:center">' + (v == null ? '–' : fmt(v)) + '</strong>') + '<span class="mx">/ ' + fmt(it.max_score) + '</span></li>';
    }).join('') || '<li class="tt-note">ไม่มีนักเรียน</li>';
    updateEntrySub(); renderSave();
    showModal('gb-m-entry');
    if (ed && window.matchMedia('(min-width:641px)').matches) { const f = $('gb-e-list').querySelector('.gb-cell'); if (f) setTimeout(function () { f.focus(); }, 50); }
  }
  function updateEntrySub() {
    const it = entryItem, p = C.periods[it.period - 1];
    $('gb-e-sub').textContent = p.label + ' · เต็ม ' + fmt(it.max_score) + ' · บันทึกแล้ว ' + entered(it) + '/' + activeStudents().length + ' คน';
  }
  $('gb-e-fill').onclick = function () {
    const blanks = $('gb-e-list').querySelectorAll('.gb-cell');
    let n = 0;
    blanks.forEach(function (el) { if (el.value.trim() === '') { el.value = fmt(entryItem.max_score); onCellInput(el); n++; } });
    Toast.show(n ? 'เติมคะแนนเต็มให้ ' + n + ' คน' : 'ไม่มีช่องว่าง', n ? 'success' : 'info');
  };

  $('gb-btn-settings').onclick = openSettings;
  $('gb-btn-add').onclick = function () { openItem(null); };
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
