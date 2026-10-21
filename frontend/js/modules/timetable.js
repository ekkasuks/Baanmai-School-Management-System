/**
 * AI Smart Timetable — เฟส 1: Dashboard + จัดการข้อมูลพื้นฐาน (ครู/วิชา/ห้อง/ชั้น+ควบชั้น/คาบ)
 * backend: tt.bootstrap · tt.save · tt.remove · tt.combine · tt.uncombine · tt.sync_classes · tt.seed_periods
 */
(function () {

  const DAY_NAMES = ['', 'จันทร์', 'อังคาร', 'พุธ', 'พฤหัสบดี', 'ศุกร์'];
  const DEPTS = ['ภาษาไทย', 'คณิตศาสตร์', 'วิทยาศาสตร์และเทคโนโลยี', 'สังคมศึกษา ศาสนาและวัฒนธรรม',
    'สุขศึกษาและพลศึกษา', 'ศิลปะ', 'การงานอาชีพ', 'ภาษาต่างประเทศ', 'กิจกรรมพัฒนาผู้เรียน', 'ปฐมวัย'];
  const SUBJECT_TYPES = { core: 'วิชาพื้นฐาน', elective: 'วิชาเพิ่มเติม/เลือก', practical: 'วิชาปฏิบัติ', activity: 'กิจกรรม' };
  const ROOM_TYPES = { classroom: 'ห้องเรียนปกติ', computer: 'ห้องคอมพิวเตอร์', science: 'ห้องวิทยาศาสตร์', music: 'ห้องดนตรี',
    lab: 'ห้องปฏิบัติการ', library: 'ห้องสมุด', gym: 'ลาน/โรงยิม', other: 'อื่น ๆ' };
  const GRADES = ['อ.1', 'อ.2', 'อ.3', 'ป.1', 'ป.2', 'ป.3', 'ป.4', 'ป.5', 'ป.6'];

  const S = { teachers: [], subjects: [], rooms: [], classes: [], periods: [], dashboard: null, term: null };
  const charts = {};
  const esc = Utils.esc;

  /* ── helpers ── */
  function getPath(o, path) { return path.split('.').reduce(function (a, k) { return a == null ? undefined : a[k]; }, o); }
  function setPath(o, path, v) {
    const ks = path.split('.'); let cur = o;
    for (let i = 0; i < ks.length - 1; i++) { if (!cur[ks[i]] || typeof cur[ks[i]] !== 'object') cur[ks[i]] = {}; cur = cur[ks[i]]; }
    cur[ks[ks.length - 1]] = v;
  }
  function pairs(list) { return list.map(function (x) { return Array.isArray(x) ? x : [x, x]; }); }
  function teacherName(t) { return (t.title || '') + (t.name || ''); }
  function names(list, pk, ids, fmt) {
    return (ids || []).map(function (id) { const x = list.find(function (i) { return i[pk] === id; }); return x ? (fmt ? fmt(x) : x.name) : null; })
      .filter(Boolean).map(function (n) { return '<span class="tt-pill">' + esc(n) + '</span>'; }).join('') || '<span class="text-muted">-</span>';
  }
  function dayList(days) { return (days || []).map(function (d) { return DAY_NAMES[d] || d; }).join(', ') || '-'; }
  function teachingPeriods() { return S.periods.filter(function (p) { return String(p.is_break) !== '1'; }); }
  function classLabel(c) { return c.grade + (c.room ? '/' + c.room : ''); }
  function gradeOptions() {
    const set = {};
    GRADES.concat(S.classes.map(function (c) { return c.grade; })).forEach(function (g) { if (g) set[g] = 1; });
    return Object.keys(set).sort(function (a, b) { return Utils.gradeSortKey(a) - Utils.gradeSortKey(b); });
  }

  /* ── นิยามแต่ละประเภทข้อมูล: คอลัมน์ตาราง + ฟิลด์ฟอร์ม ── */
  const ENT = {
    teacher: {
      pk: 'teacher_id', list: 'teachers', title: 'ครู', icon: '👩‍🏫',
      cols: [
        ['รหัส', function (r) { return esc(r.code || '-'); }],
        ['ชื่อ-สกุล', function (r) { return '<strong>' + esc(teacherName(r)) + '</strong>'; }],
        ['กลุ่มสาระ', function (r) { return esc(r.dept || '-'); }],
        ['วิชาที่สอนได้', function (r) { return names(S.subjects, 'subject_id', r.subjects); }],
        ['คาบ/สัปดาห์', function (r) { return (r.min_periods != null ? r.min_periods : '-') + ' – ' + (r.max_periods != null ? r.max_periods : '-'); }],
        ['วันหยุด', function (r) { return esc(dayList(r.off_days)); }],
      ],
      fields: [
        { k: 'code', l: 'รหัสครู', t: 'text' },
        { k: 'title', l: 'คำนำหน้า', t: 'select', opts: function () { return ['', 'นาย', 'นาง', 'นางสาว', 'ว่าที่ร้อยตรี']; } },
        { k: 'name', l: 'ชื่อ-สกุล', t: 'text', req: 1, full: 1 },
        { k: 'dept', l: 'กลุ่มสาระ', t: 'select', opts: function () { return [''].concat(DEPTS); } },
        { k: 'extra_duty', l: 'ภาระงานพิเศษ', t: 'text' },
        { k: 'min_periods', l: 'คาบขั้นต่ำ/สัปดาห์', t: 'number' },
        { k: 'max_periods', l: 'คาบสูงสุด/สัปดาห์', t: 'number' },
        { k: 'subjects', l: 'วิชาที่สอนได้', t: 'multi', full: 1, opts: function () { return S.subjects.map(function (s) { return [s.subject_id, (s.code ? s.code + ' ' : '') + s.name]; }); } },
        { k: 'off_days', l: 'วันหยุดประจำ (ไม่สอนทั้งวัน)', t: 'days', full: 1 },
        { k: 'unavailable', l: 'ช่วงเวลาที่สอนไม่ได้ (ติ๊กช่องที่ไม่ว่าง)', t: 'grid', full: 1 },
        { k: 'prefs.no_first', l: 'ไม่สอนคาบแรก', t: 'check' },
        { k: 'prefs.no_last', l: 'ไม่สอนคาบสุดท้าย', t: 'check' },
        { k: 'prefs.max_consecutive', l: 'สอนติดกันได้สูงสุด (คาบ)', t: 'number' },
      ],
    },
    subject: {
      pk: 'subject_id', list: 'subjects', title: 'วิชา', icon: '📚',
      cols: [
        ['รหัส', function (r) { return esc(r.code || '-'); }],
        ['ชื่อวิชา', function (r) { return '<strong>' + esc(r.name) + '</strong>'; }],
        ['คาบ/สัปดาห์', function (r) { return esc(r.periods_week); }],
        ['ระดับชั้น', function (r) { return (r.grades || []).map(function (g) { return '<span class="tt-pill">' + esc(g) + '</span>'; }).join('') || '-'; }],
        ['ประเภท', function (r) { return esc(SUBJECT_TYPES[r.type] || r.type || '-'); }],
        ['ครูผู้สอนได้', function (r) { return names(S.teachers, 'teacher_id', r.teachers, teacherName); }],
      ],
      fields: [
        { k: 'code', l: 'รหัสวิชา', t: 'text' },
        { k: 'name', l: 'ชื่อวิชา', t: 'text', req: 1 },
        { k: 'periods_week', l: 'จำนวนคาบ/สัปดาห์', t: 'number', req: 1 },
        { k: 'type', l: 'ประเภทวิชา', t: 'select', opts: function () { return [['', '-']].concat(Object.keys(SUBJECT_TYPES).map(function (k) { return [k, SUBJECT_TYPES[k]]; })); } },
        { k: 'grades', l: 'ระดับชั้นที่เรียน (ชั้นที่เรียนควบกันควรติ๊กให้ครบทุกชั้น)', t: 'multi', full: 1, opts: function () { return gradeOptions(); } },
        { k: 'teachers', l: 'ครูผู้สอนได้', t: 'multi', full: 1, opts: function () { return S.teachers.map(function (t) { return [t.teacher_id, teacherName(t)]; }); } },
        { k: 'room_type', l: 'ต้องใช้ห้องประเภท', t: 'select', opts: function () { return [['', 'ห้องเรียนปกติ/ไม่กำหนด']].concat(Object.keys(ROOM_TYPES).filter(function (k) { return k !== 'classroom'; }).map(function (k) { return [k, ROOM_TYPES[k]]; })); } },
        { k: 'rules.consecutive', l: 'เรียนต่อเนื่องครั้งละ (คาบ) — วิชาปฏิบัติ', t: 'number' },
        { k: 'rules.max_per_day', l: 'ไม่เกินวันละ (คาบ)', t: 'number' },
        { k: 'rules.allowed_days', l: 'จัดได้เฉพาะวัน (ไม่ติ๊ก = ทุกวัน)', t: 'days', full: 1 },
      ],
    },
    room: {
      pk: 'room_id', list: 'rooms', title: 'ห้องเรียน', icon: '🏫',
      cols: [
        ['รหัส', function (r) { return esc(r.code || '-'); }],
        ['ชื่อห้อง', function (r) { return '<strong>' + esc(r.name) + '</strong>' + (String(r.special) === '1' ? ' <span class="tt-pill combo">เฉพาะทาง</span>' : ''); }],
        ['อาคาร', function (r) { return esc(r.building || '-'); }],
        ['ประเภท', function (r) { return esc(ROOM_TYPES[r.type] || r.type || '-'); }],
        ['ความจุ', function (r) { return r.capacity != null ? esc(r.capacity) : '-'; }],
        ['ใช้ได้กับวิชา', function (r) { return (r.allowed_subjects || []).length ? names(S.subjects, 'subject_id', r.allowed_subjects) : '<span class="text-muted">ทุกวิชา</span>'; }],
      ],
      fields: [
        { k: 'code', l: 'รหัสห้อง', t: 'text' },
        { k: 'name', l: 'ชื่อห้อง', t: 'text', req: 1 },
        { k: 'building', l: 'อาคาร', t: 'text' },
        { k: 'type', l: 'ประเภทห้อง', t: 'select', opts: function () { return Object.keys(ROOM_TYPES).map(function (k) { return [k, ROOM_TYPES[k]]; }); } },
        { k: 'capacity', l: 'ความจุ (คน)', t: 'number' },
        { k: 'max_concurrent', l: 'ใช้พร้อมกันได้ (กลุ่มเรียน)', t: 'number' },
        { k: 'special', l: 'ห้องเฉพาะทาง', t: 'check' },
        { k: 'allowed_subjects', l: 'ใช้เฉพาะวิชา (ไม่ติ๊ก = ทุกวิชา)', t: 'multi', full: 1, opts: function () { return S.subjects.map(function (s) { return [s.subject_id, s.name]; }); } },
      ],
    },
    class: {
      pk: 'class_id', list: 'classes', title: 'ชั้นเรียน', icon: '🎒',
      cols: [
        ['ชั้น/ห้อง', function (r) { return '<strong>' + esc(classLabel(r)) + '</strong>'; }],
        ['นักเรียน', function (r) { return r.students != null ? esc(r.students) : '-'; }],
        ['ครูประจำชั้น', function (r) { const t = S.teachers.find(function (x) { return x.teacher_id === r.homeroom_teacher_id; }); return t ? esc(teacherName(t)) : '-'; }],
        ['ห้องประจำ', function (r) { const m = S.rooms.find(function (x) { return x.room_id === r.home_room_id; }); return m ? esc(m.name) : '-'; }],
        ['เรียนควบ', function (r) { const u = unitOf(r.class_id); return u && u.combined ? '<span class="tt-pill combo">' + esc(u.label) + '</span>' : '-'; }],
      ],
      fields: [
        { k: 'grade', l: 'ชั้นเรียน', t: 'select', req: 1, opts: function () { return gradeOptions(); } },
        { k: 'room', l: 'ห้อง', t: 'text' },
        { k: 'students', l: 'จำนวนนักเรียน', t: 'number' },
        { k: 'homeroom_teacher_id', l: 'ครูประจำชั้น', t: 'select', opts: function () { return [['', '-']].concat(S.teachers.map(function (t) { return [t.teacher_id, teacherName(t)]; })); } },
        { k: 'home_room_id', l: 'ห้องเรียนประจำ', t: 'select', opts: function () { return [['', '-']].concat(S.rooms.map(function (m) { return [m.room_id, m.name]; })); } },
      ],
      extra: '<button class="btn btn-secondary" data-act="sync"><i class="bi bi-arrow-repeat"></i> ดึงชั้นเรียนจากข้อมูลนักเรียน</button>',
    },
    period: {
      pk: 'period_id', list: 'periods', title: 'คาบเรียน', icon: '⏰',
      cols: [
        ['ลำดับ', function (r) { return esc(r.seq); }],
        ['ชื่อคาบ', function (r) { return '<strong>' + esc(r.label) + '</strong>' + (String(r.is_break) === '1' ? ' <span class="tt-pill combo">พัก</span>' : ''); }],
        ['เวลา', function (r) { return esc((r.start_time || '') + ' – ' + (r.end_time || '')); }],
        ['ช่วง', function (r) { return r.session === 'afternoon' ? 'ภาคบ่าย' : r.session === 'morning' ? 'ภาคเช้า' : '-'; }],
      ],
      fields: [
        { k: 'seq', l: 'ลำดับ', t: 'number' },
        { k: 'label', l: 'ชื่อคาบ', t: 'text', req: 1 },
        { k: 'start_time', l: 'เวลาเริ่ม', t: 'time' },
        { k: 'end_time', l: 'เวลาสิ้นสุด', t: 'time' },
        { k: 'session', l: 'ช่วง', t: 'select', opts: function () { return [['morning', 'ภาคเช้า'], ['afternoon', 'ภาคบ่าย']]; } },
        { k: 'is_break', l: 'เป็นช่วงพัก (ไม่มีวิชา)', t: 'check' },
      ],
      extra: '<button class="btn btn-secondary" data-act="seed"><i class="bi bi-magic"></i> สร้างคาบมาตรฐาน (7 คาบ + พักเที่ยง)</button>',
    },
  };

  function unitOf(classId) {
    const units = (S.dashboard && S.dashboard.units) || [];
    return units.find(function (u) { return u.class_ids.indexOf(classId) >= 0; });
  }

  /* ════ โหลดข้อมูล ════ */
  async function reload(opts) {
    try {
      const d = await api('tt.bootstrap', {}, { loading: !(opts && opts.quiet), silent: !!(opts && opts.quiet), loadingMsg: 'กำลังโหลดข้อมูล...' });
      S.teachers = d.teachers; S.subjects = d.subjects; S.rooms = d.rooms; S.classes = d.classes; S.periods = d.periods;
      S.dashboard = d.dashboard; S.term = d.term;
      S.config = d.config; S.config_defaults = d.config_defaults; S.versions = d.versions || [];
      document.getElementById('tt-term').textContent = (d.term && d.term.label) || '';
      renderDashboard();
      Object.keys(ENT).forEach(renderEntity);
      renderCombos();
      window.dispatchEvent(new CustomEvent('tt:loaded'));   // ให้โมดูล AI (timetable-ai.js) อัปเดตตาม
    } catch (e) { /* toast แสดงแล้ว */ }
  }

  /* ════ Dashboard ════ */
  function stat(icon, label, value, sub) {
    return '<div class="stat tt-stat"><div class="ic">' + icon + '</div><div><div class="label">' + label + '</div>' +
      '<div class="value">' + value + '</div>' + (sub ? '<div class="sub">' + sub + '</div>' : '') + '</div></div>';
  }

  function renderDashboard() {
    const d = S.dashboard;
    if (!d) return;
    const c = d.counts;
    const st = d.latest;
    const statusTh = { draft: 'ร่าง', generated: 'จัดเสร็จ', edited: 'แก้ไขแล้ว', approved: 'อนุมัติแล้ว', published: 'เผยแพร่แล้ว' };
    document.getElementById('tt-stats').innerHTML = [
      stat('👩‍🏫', 'ครูทั้งหมด', Utils.fmtInt(c.teachers)),
      stat('📚', 'จำนวนรายวิชา', Utils.fmtInt(c.subjects)),
      stat('🏫', 'ห้องเรียน', Utils.fmtInt(c.rooms)),
      stat('🎓', 'ระดับชั้น', Utils.fmtInt(c.grades), c.classes + ' ห้อง · ' + c.units + ' หน่วยการเรียน' + (c.combined_groups ? ' (ควบชั้น ' + c.combined_groups + ')' : '')),
      stat('⏰', 'คาบเรียน/สัปดาห์', Utils.fmtInt(c.periods_per_week), c.periods_per_day + ' คาบ/วัน × 5 วัน'),
      stat('🧮', 'คาบที่ต้องจัด', Utils.fmtInt(c.demand_periods), 'จากช่องทั้งหมด ' + Utils.fmtInt(c.total_slots) + ' ช่อง'),
      stat('✅', 'ตารางที่จัดสำเร็จ', Utils.fmtInt(c.done_versions)),
      stat('⚠️', 'ตารางที่มีข้อขัดแย้ง', Utils.fmtInt(c.conflict_versions)),
      stat('⚙️', 'สถานะประมวลผลล่าสุด', st ? esc(statusTh[st.status] || st.status) : '<span style="font-size:15px">ยังไม่เคยจัด</span>', st ? Utils.fmtDateTime(st.created_at) : 'จัดตารางอัตโนมัติจะมาในเฟส 2'),
    ].join('');

    const levels = { error: ['alert-danger', '⛔'], warning: ['alert-warning', '⚠️'], info: ['alert-info', 'ℹ️'] };
    const issues = d.issues || [];
    document.getElementById('tt-issues').innerHTML = issues.length
      ? issues.map(function (i) { const l = levels[i.level] || levels.info; return '<div class="tt-issue ' + l[0] + '"><span>' + l[1] + '</span><span>' + esc(i.msg) + '</span></div>'; }).join('')
      : '<div class="alert alert-success">✅ ข้อมูลพร้อมสำหรับจัดตาราง</div>';
    document.getElementById('tt-updated').textContent = 'อัปเดต ' + new Date().toLocaleTimeString('th-TH') + ' · รีเฟรชอัตโนมัติทุก 60 วินาที';
    drawCharts();
  }

  async function drawCharts() {
    const d = S.dashboard;
    if (!window.Chart) { try { await LazyLib.chart(); } catch (e) { return; } }
    const filled = d.utilization.slots_filled;
    document.getElementById('tt-chart-note').textContent = filled ? '' :
      'ยังไม่มีตารางที่จัดแล้ว — กราฟคาบสอน/การใช้ห้องจะแสดงค่าจริงหลังสร้างตาราง (เฟส 2) · ตอนนี้แสดงภาระงานสูงสุดที่ตั้งไว้เป็นเกณฑ์';
    const font = { family: 'Sarabun' };
    function make(id, cfg) { if (charts[id]) charts[id].destroy(); charts[id] = new Chart(document.getElementById(id), cfg); }

    make('ch-teacher', { type: 'bar', data: {
      labels: d.teacher_load.map(function (t) { return t.name; }),
      datasets: [
        { label: 'คาบที่สอน', data: d.teacher_load.map(function (t) { return t.assigned; }), backgroundColor: '#0288D1', borderRadius: 6 },
        { label: 'สูงสุด', data: d.teacher_load.map(function (t) { return t.max || 0; }), backgroundColor: '#B3E5FC', borderRadius: 6 },
      ] }, options: { plugins: { legend: { labels: { font: font } } }, scales: { x: { ticks: { font: font } }, y: { beginAtZero: true, ticks: { precision: 0 } } } } });

    make('ch-room', { type: 'bar', data: {
      labels: d.room_usage.map(function (r) { return r.name; }),
      datasets: [{ label: '% การใช้', data: d.room_usage.map(function (r) { return r.percent; }), backgroundColor: '#66BB6A', borderRadius: 6 }],
    }, options: { indexAxis: 'y', plugins: { legend: { display: false } }, scales: { x: { beginAtZero: true, max: 100 }, y: { ticks: { font: font } } } } });

    const u = d.utilization;
    make('ch-util', { type: 'bar', data: {
      labels: ['ช่องตารางที่จัดแล้ว', 'ความต้องการคาบ/ช่องทั้งหมด', 'ภาระครูที่ใช้'],
      datasets: [{ data: [u.slot_percent, u.demand_percent, u.teacher_percent], backgroundColor: ['#0288D1', '#FFB74D', '#BA68C8'], borderRadius: 6 }],
    }, options: { plugins: { legend: { display: false } }, scales: { y: { beginAtZero: true, suggestedMax: 100 }, x: { ticks: { font: font } } } } });
  }

  /* ════ ตารางข้อมูลแต่ละประเภท ════ */
  const query = {};

  function renderEntity(name) {
    const ent = ENT[name];
    const host = document.querySelector('[data-entity="' + name + '"]');
    if (!host) return;
    if (!host.dataset.ready) {
      host.innerHTML = '<h3 class="card-title">' + ent.icon + ' ' + ent.title + '</h3>' +
        '<div class="tt-toolbar"><input class="form-control" data-q placeholder="ค้นหา' + ent.title + '...">' +
        '<button class="btn btn-primary" data-act="add"><i class="bi bi-plus-lg"></i> เพิ่ม' + ent.title + '</button>' + (ent.extra || '') + '</div>' +
        '<div data-list></div>';
      host.dataset.ready = '1';
      host.querySelector('[data-q]').addEventListener('input', Utils.debounce(function (e) { query[name] = e.target.value; renderEntity(name); }, 200));
      host.querySelector('[data-act="add"]').onclick = function () { openForm(name, null); };
      const sync = host.querySelector('[data-act="sync"]');
      if (sync) sync.onclick = syncClasses;
      const seed = host.querySelector('[data-act="seed"]');
      if (seed) seed.onclick = seedPeriods;
    }
    const q = String(query[name] || '').trim().toLowerCase();
    let items = S[ent.list] || [];
    if (q) items = items.filter(function (r) { return JSON.stringify(r).toLowerCase().indexOf(q) >= 0 || ent.cols.some(function (c) { return String(c[1](r)).toLowerCase().indexOf(q) >= 0; }); });
    const listEl = host.querySelector('[data-list]');
    if (!items.length) { listEl.innerHTML = '<div class="text-muted">' + (q ? 'ไม่พบข้อมูลที่ค้นหา' : 'ยังไม่มีข้อมูล — กด "เพิ่ม' + ent.title + '"') + '</div>'; return; }
    listEl.innerHTML = '<div class="tt-note" style="margin-bottom:6px">ทั้งหมด ' + items.length + ' รายการ</div><div class="table-wrap"><table><thead><tr>' +
      ent.cols.map(function (c) { return '<th>' + c[0] + '</th>'; }).join('') + '<th></th></tr></thead><tbody>' +
      items.map(function (r) {
        return '<tr>' + ent.cols.map(function (c) { return '<td>' + c[1](r) + '</td>'; }).join('') +
          '<td class="tt-actions"><button class="btn btn-secondary" data-edit="' + esc(r[ent.pk]) + '"><i class="bi bi-pencil"></i></button>' +
          '<button class="btn btn-danger" data-del="' + esc(r[ent.pk]) + '"><i class="bi bi-trash"></i></button></td></tr>';
      }).join('') + '</tbody></table></div>';
    listEl.querySelectorAll('[data-edit]').forEach(function (b) {
      b.onclick = function () { openForm(name, items.find(function (r) { return r[ent.pk] === b.dataset.edit; })); };
    });
    listEl.querySelectorAll('[data-del]').forEach(function (b) {
      b.onclick = function () { removeItem(name, items.find(function (r) { return r[ent.pk] === b.dataset.del; })); };
    });
  }

  /* ════ ฟอร์มเพิ่ม/แก้ไข (สร้างจากนิยามฟิลด์) ════ */
  function fieldHtml(f, rec) {
    const v = getPath(rec || {}, f.k);
    const req = f.req ? ' <span style="color:var(--red)">*</span>' : '';
    const wrap = function (inner) { return '<div class="form-group' + (f.full || f.t === 'multi' || f.t === 'days' || f.t === 'grid' ? ' full' : '') + '"><label>' + f.l + req + '</label>' + inner + '</div>'; };
    if (f.t === 'text' || f.t === 'number' || f.t === 'time') {
      return wrap('<input class="form-control" data-k="' + f.k + '" type="' + f.t + '"' + (f.t === 'number' ? ' min="0"' : '') + ' value="' + esc(v == null ? '' : v) + '">');
    }
    if (f.t === 'select') {
      return wrap('<select class="form-control" data-k="' + f.k + '">' + pairs(f.opts()).map(function (o) {
        return '<option value="' + esc(o[0]) + '"' + (String(v == null ? '' : v) === String(o[0]) ? ' selected' : '') + '>' + esc(o[1]) + '</option>';
      }).join('') + '</select>');
    }
    if (f.t === 'check') {
      const on = v === true || v === 1 || v === '1' || v === 'true';
      return '<div class="form-group"><label class="tt-chip" style="margin-top:26px"><input type="checkbox" data-k="' + f.k + '"' + (on ? ' checked' : '') + '> ' + f.l + '</label></div>';
    }
    if (f.t === 'multi') {
      const sel = (v || []).map(String);
      const opts = pairs(f.opts());
      return wrap(opts.length ? '<div class="tt-checks" data-k="' + f.k + '" data-t="multi">' + opts.map(function (o) {
        return '<label class="tt-chip"><input type="checkbox" value="' + esc(o[0]) + '"' + (sel.indexOf(String(o[0])) >= 0 ? ' checked' : '') + '> ' + esc(o[1]) + '</label>';
      }).join('') + '</div>' : '<div class="tt-note">ยังไม่มีข้อมูลให้เลือก</div>');
    }
    if (f.t === 'days') {
      const sel = (v || []).map(Number);
      return wrap('<div class="tt-checks" data-k="' + f.k + '" data-t="days">' + [1, 2, 3, 4, 5].map(function (d) {
        return '<label class="tt-chip"><input type="checkbox" value="' + d + '"' + (sel.indexOf(d) >= 0 ? ' checked' : '') + '> ' + DAY_NAMES[d] + '</label>';
      }).join('') + '</div>');
    }
    if (f.t === 'grid') {
      const tp = teachingPeriods();
      if (!tp.length) return wrap('<div class="tt-note">ยังไม่ได้กำหนดคาบเรียน</div>');
      const on = {};
      (v || []).forEach(function (x) { on[x.day + '|' + x.period_id] = 1; });
      return wrap('<div class="table-wrap"><table class="tt-grid" data-k="' + f.k + '" data-t="grid"><thead><tr><th>วัน</th>' +
        tp.map(function (p) { return '<th>' + esc(p.label) + '<br><span class="tt-note">' + esc(p.start_time || '') + '</span></th>'; }).join('') + '</tr></thead><tbody>' +
        [1, 2, 3, 4, 5].map(function (d) {
          return '<tr><th>' + DAY_NAMES[d] + '</th>' + tp.map(function (p) {
            return '<td><input type="checkbox" data-day="' + d + '" data-period="' + esc(p.period_id) + '"' + (on[d + '|' + p.period_id] ? ' checked' : '') + '></td>';
          }).join('') + '</tr>';
        }).join('') + '</tbody></table></div>');
    }
    return '';
  }

  function readForm(name, box) {
    const rec = {};
    ENT[name].fields.forEach(function (f) {
      const el = box.querySelector('[data-k="' + f.k + '"]');
      if (!el) return;
      let v;
      if (f.t === 'check') v = el.checked;
      else if (f.t === 'multi') v = Array.prototype.map.call(el.querySelectorAll('input:checked'), function (i) { return i.value; });
      else if (f.t === 'days') v = Array.prototype.map.call(el.querySelectorAll('input:checked'), function (i) { return Number(i.value); });
      else if (f.t === 'grid') v = Array.prototype.map.call(el.querySelectorAll('input:checked'), function (i) { return { day: Number(i.dataset.day), period_id: i.dataset.period }; });
      else if (f.t === 'number') v = el.value === '' ? null : Number(el.value);
      else v = el.value.trim();
      if (name === 'room' && f.k === 'special') v = v ? '1' : '0';
      if (name === 'period' && f.k === 'is_break') v = v ? '1' : '0';
      setPath(rec, f.k, v);
    });
    return rec;
  }

  function openForm(name, rec) {
    const ent = ENT[name];
    const el = document.createElement('div');
    el.className = 'modal-backdrop show';
    el.innerHTML = '<div class="modal wide"><h3 class="modal-title">' + ent.icon + ' ' + (rec ? 'แก้ไข' : 'เพิ่ม') + ent.title + '</h3>' +
      '<div class="tt-form">' + ent.fields.map(function (f) { return fieldHtml(f, rec); }).join('') + '</div>' +
      '<div class="alert alert-danger hidden" data-err></div>' +
      '<div class="flex" style="justify-content:flex-end;gap:8px"><button class="btn btn-secondary" data-cancel>ยกเลิก</button>' +
      '<button class="btn btn-primary" data-ok><i class="bi bi-save"></i> บันทึก</button></div></div>';
    document.body.appendChild(el);
    const close = function () { el.remove(); };
    el.querySelector('[data-cancel]').onclick = close;
    el.addEventListener('click', function (e) { if (e.target === el) close(); });
    el.querySelector('[data-ok]').onclick = async function () {
      const record = readForm(name, el);
      if (rec) record[ent.pk] = rec[ent.pk];
      const err = el.querySelector('[data-err]');
      try {
        await api('tt.save', { entity: name, record: record, recorded_by: 'admin' }, { silent: true, loadingMsg: 'กำลังบันทึก...' });
        close();
        Toast.show('บันทึก' + ent.title + 'เรียบร้อย', 'success');
        reload({ quiet: true });
      } catch (e) { err.textContent = e.message; err.classList.remove('hidden'); }
    };
  }

  async function removeItem(name, rec) {
    const ent = ENT[name];
    const label = rec.name || rec.label || classLabel(rec);
    if (!confirm('ลบ' + ent.title + ' "' + label + '" ?' + (name === 'period' ? '' : '\n(ข้อมูลจะถูกปิดใช้งาน — ไม่กระทบตารางที่จัดไว้แล้ว)'))) return;
    try {
      await api('tt.remove', { entity: name, id: rec[ent.pk], recorded_by: 'admin' }, { loadingMsg: 'กำลังลบ...' });
      Toast.show('ลบเรียบร้อย', 'success');
      reload({ quiet: true });
    } catch (e) { /* toast แสดงแล้ว */ }
  }

  async function syncClasses() {
    try {
      const r = await api('tt.sync_classes', {}, { loadingMsg: 'กำลังดึงข้อมูลชั้นเรียน...' });
      Toast.show('ดึงชั้นเรียนแล้ว — เพิ่มใหม่ ' + r.created + ' ห้อง, อัปเดตจำนวนนักเรียน ' + r.updated + ' ห้อง', 'success');
      reload({ quiet: true });
    } catch (e) { /* toast */ }
  }

  async function seedPeriods() {
    try {
      const r = await api('tt.seed_periods', {}, { loadingMsg: 'กำลังสร้างคาบ...' });
      Toast.show(r.created ? 'สร้างคาบมาตรฐาน ' + r.created + ' ช่วงแล้ว' : (r.message || 'มีคาบอยู่แล้ว'), r.created ? 'success' : 'warning');
      reload({ quiet: true });
    } catch (e) { /* toast */ }
  }

  /* ════ เรียนควบชั้น ════ */
  function renderCombos() {
    const units = ((S.dashboard && S.dashboard.units) || []).filter(function (u) { return u.combined; });
    const host = document.getElementById('tt-combos');
    host.innerHTML = units.length ? units.map(function (u) {
      return '<div class="alert alert-warning" style="display:flex;flex-wrap:wrap;align-items:center;gap:6px">🔗 <strong>' + esc(u.label) + '</strong> · นักเรียนรวม ' + u.students + ' คน · ' +
        u.class_ids.map(function (cid) {
          const c = S.classes.find(function (x) { return x.class_id === cid; });
          return '<button class="btn btn-secondary" style="padding:3px 10px;font-size:13px;margin:0" data-uncombine="' + esc(cid) + '">ถอด ' + esc(c ? classLabel(c) : cid) + ' ✕</button>';
        }).join('') + '</div>';
    }).join('') : '<div class="text-muted">ยังไม่มีกลุ่มเรียนควบชั้น</div>';
    host.querySelectorAll('[data-uncombine]').forEach(function (b) {
      b.onclick = async function () {
        try { await api('tt.uncombine', { class_id: b.dataset.uncombine, recorded_by: 'admin' }, { loadingMsg: 'กำลังแก้ไข...' }); Toast.show('ถอดออกจากกลุ่มแล้ว', 'success'); reload({ quiet: true }); } catch (e) { /* toast */ }
      };
    });
    document.getElementById('tt-combine-pick').innerHTML = S.classes.map(function (c) {
      const u = unitOf(c.class_id);
      return '<label class="tt-chip"><input type="checkbox" value="' + esc(c.class_id) + '"> ' + esc(classLabel(c)) + (u && u.combined ? ' <span class="tt-note">(ควบอยู่)</span>' : '') + '</label>';
    }).join('') || '<div class="tt-note">ยังไม่มีชั้นเรียน — กด "ดึงชั้นเรียนจากข้อมูลนักเรียน"</div>';
  }

  document.getElementById('tt-combine-btn').onclick = async function () {
    const ids = Array.prototype.map.call(document.querySelectorAll('#tt-combine-pick input:checked'), function (i) { return i.value; });
    if (ids.length < 2) { Toast.show('เลือกอย่างน้อย 2 ห้อง', 'warning'); return; }
    try {
      const r = await api('tt.combine', { class_ids: ids, recorded_by: 'admin' }, { loadingMsg: 'กำลังจัดกลุ่ม...' });
      Toast.show('จัดกลุ่มเรียนควบชั้น ' + r.label + ' แล้ว', 'success');
      reload({ quiet: true });
    } catch (e) { /* toast */ }
  };

  /* ════ Tabs + รีเฟรชอัตโนมัติ ════ */
  let activeTab = 'dashboard';
  document.querySelectorAll('#tt-tabs .tab').forEach(function (t) {
    t.addEventListener('click', function () {
      document.querySelectorAll('#tt-tabs .tab').forEach(function (x) { x.classList.remove('active'); });
      t.classList.add('active');
      document.querySelectorAll('.tab-pane').forEach(function (p) { p.classList.add('hidden'); });
      document.getElementById('tab-' + t.dataset.tab).classList.remove('hidden');
      activeTab = t.dataset.tab;
      if (activeTab === 'dashboard') drawCharts();
    });
  });

  // ใช้ร่วมกับ timetable-ai.js
  window.TT = { S: S, reload: reload, teacherName: teacherName, classLabel: classLabel, DAY_NAMES: DAY_NAMES,
    isBusy: function () { return !!document.querySelector('.modal-backdrop'); } };

  setInterval(function () {
    if (document.visibilityState === 'visible' && activeTab === 'dashboard' && !document.querySelector('.modal-backdrop') && !window.TT_AI_RUNNING) reload({ quiet: true });
  }, 60000);

  reload();
})();
