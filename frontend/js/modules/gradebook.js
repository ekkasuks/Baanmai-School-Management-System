/**
 * วิชาการ › บันทึกคะแนน — เฟส 1: วิชาของฉัน (จากการมอบหมายในตารางสอน) + รายชื่อนักเรียนรายวิชา
 * เข้าสู่ระบบแบบเลือกชื่อ + รหัสผ่าน (body data-tt-login="pick" · js/tt-session.js)
 * ดีไซน์: docs/superpowers/specs/2026-11-06-gradebook-design.md
 */
(function () {
  const esc = Utils.esc;
  const $ = function (id) { return document.getElementById(id); };
  const KEY_VIEW = 'gb:view';
  let me = null, data = null;

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
              '<span><i class="bi bi-people"></i> ' + c.students + ' คน</span>' + (c.periods_week ? '<span>' + c.periods_week + ' คาบ/สัปดาห์</span>' : '') + '</span>' +
            (showTeacher ? '<span class="meta"><span>👩‍🏫 ' + esc(c.teacher_name || '-') + '</span></span>' : '') +
          '</button>';
        }).join('') + '</div></div>';
      }).join('');
    box.querySelectorAll('[data-c]').forEach(function (b) { b.onclick = function () { location.hash = 'c=' + encodeURIComponent(b.dataset.c); }; });
  }

  /* ════ รายวิชา ════ */
  async function openCourse(id) {
    $('gb-home').classList.add('hidden');
    $('gb-course').classList.remove('hidden');
    $('gb-c-title').textContent = 'กำลังโหลด...';
    $('gb-c-info').innerHTML = ''; $('gb-c-roster').innerHTML = ''; $('gb-c-count').textContent = '';
    let r;
    try { r = await api('acad.gb_course', { course_id: id }, { loadingMsg: 'กำลังโหลดรายวิชา...' }); }
    catch (e) { $('gb-c-title').textContent = 'เปิดรายวิชาไม่ได้'; $('gb-c-roster').innerHTML = '<div class="alert alert-danger">' + esc(e.message) + '</div>'; return; }
    const c = r.course;
    $('gb-c-title').textContent = c.subject_name + ' · ' + c.class_label;
    $('gb-c-info').innerHTML = [c.subject_code && '<span>รหัสวิชา ' + esc(c.subject_code) + '</span>', c.type_label && '<span class="gb-tag">' + esc(c.type_label) + '</span>',
      '<span>👩‍🏫 ' + esc(c.teacher_name || '-') + '</span>', '<span>' + esc(termLabel(c.term)) + '</span>',
      !r.can_edit && '<span class="gb-tag">ดูอย่างเดียว</span>'].filter(Boolean).join('');
    $('gb-c-count').textContent = r.students.length + ' คน';
    $('gb-c-roster').innerHTML = !r.students.length ? '<div class="alert alert-info">ไม่พบนักเรียนที่กำลังศึกษาในชั้น ' + esc(c.class_label) + '</div>' :
      '<div class="table-wrap"><table class="tt-results gb-roster"><thead><tr><th>ที่</th><th>รหัส</th><th>ชื่อ-สกุล</th><th>เพศ</th></tr></thead><tbody>' +
      r.students.map(function (s) { return '<tr><td>' + s.no + '</td><td>' + esc(s.student_code || '-') + '</td><td data-no-i18n>' + esc(s.name) + '</td><td>' + esc(s.gender || '-') + '</td></tr>'; }).join('') +
      '</tbody></table></div>';
  }

  function route() {
    const m = /^#c=(.+)$/.exec(location.hash);
    if (m) { openCourse(decodeURIComponent(m[1])); return; }
    $('gb-course').classList.add('hidden');
    $('gb-home').classList.remove('hidden');
    if (!data) loadHome();
  }

  $('gb-back').onclick = function () { location.hash = ''; };
  $('gb-teacher').onchange = function () { Store.set(KEY_VIEW, this.value); loadHome(); };
  window.addEventListener('hashchange', route);

  TTAuth.require({ caps: ['gb', 'gb_admin', 'gb_view'] }).then(function (u) { me = u; route(); });
})();
