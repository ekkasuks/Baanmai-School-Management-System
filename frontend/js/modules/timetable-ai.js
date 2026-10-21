/**
 * AI Smart Timetable — เฟส 2: เงื่อนไข (โมดูล 3) + AI Scheduling Engine (โมดูล 4)
 * engine: js/tt-solver.js (Web Worker) · backend: tt.constraints_save · tt.save_version · tt.get_version · tt.delete_version
 */
(function () {
  const esc = Utils.esc;
  let cfgRendered = false;
  let lastResult = null;

  /* ════ เงื่อนไข ════ */
  const CFG_FIELDS = [
    { k: 'teacher_max_consecutive', l: 'ครูสอนติดกันได้สูงสุด (คาบ)', t: 'number', h: 'ใช้กับครูที่ไม่ได้ตั้งค่าเอง · ช่วงพักกลางวันตัดความต่อเนื่อง' },
    { k: 'subject_max_per_day', l: 'วิชาเดียวกันไม่เกินวันละ (คาบ)', t: 'number', h: 'ใช้กับวิชาที่ไม่ได้ตั้ง "ไม่เกินวันละ" เอง' },
    { k: 'time_limit_sec', l: 'เวลาให้ AI ค้นหา (วินาที)', t: 'number', h: 'มากขึ้น = มีโอกาสได้ตารางที่ดีขึ้น' },
    { k: 'spread_subjects', l: 'กระจายวิชาไม่ให้เรียนซ้ำวันเดียวกัน', t: 'check' },
    { k: 'prefer_core_morning', l: 'วิชาพื้นฐานจัดช่วงเช้าก่อน', t: 'check' },
    { k: 'prefer_activity_afternoon', l: 'กิจกรรมจัดช่วงบ่าย', t: 'check' },
    { k: 'avoid_gaps', l: 'ไม่ให้มีคาบว่างแทรกระหว่างวัน', t: 'check' },
    { k: 'fallback_homeroom', l: 'วิชาที่ยังไม่ระบุครู ให้ครูประจำชั้นสอน', t: 'check' },
  ];

  function renderConfig(cfg) {
    document.getElementById('tt-cfg').innerHTML = CFG_FIELDS.map(function (f) {
      const v = cfg[f.k];
      if (f.t === 'check') {
        return '<div class="form-group full"><label class="tt-chip"><input type="checkbox" data-cfg="' + f.k + '"' + (v ? ' checked' : '') + '> ' + f.l + '</label></div>';
      }
      return '<div class="form-group"><label>' + f.l + '</label><input class="form-control" type="number" min="1" data-cfg="' + f.k + '" value="' + esc(v) + '">' +
        (f.h ? '<div class="tt-note">' + f.h + '</div>' : '') + '</div>';
    }).join('');
    cfgRendered = true;
  }

  function readConfig() {
    const out = {};
    document.querySelectorAll('[data-cfg]').forEach(function (el) {
      out[el.dataset.cfg] = el.type === 'checkbox' ? el.checked : Number(el.value);
    });
    return out;
  }

  document.getElementById('tt-cfg-save').onclick = async function () {
    try {
      const r = await api('tt.constraints_save', { config: readConfig(), recorded_by: 'admin' }, { loadingMsg: 'กำลังบันทึก...', noRetry: true });
      TT.S.config = r.config;
      renderConfig(r.config);
      Toast.show('บันทึกเงื่อนไขแล้ว', 'success');
    } catch (e) { /* toast แสดงแล้ว */ }
  };
  document.getElementById('tt-cfg-reset').onclick = function () {
    renderConfig(Object.assign({}, TT.S.config_defaults || {}));
    Toast.show('คืนค่าเริ่มต้นในฟอร์มแล้ว — กด "บันทึกเงื่อนไข" เพื่อใช้งาน', 'warning');
  };

  /* ════ เตรียมข้อมูลให้ engine ════ */
  function buildInput() {
    const S = TT.S;
    const units = ((S.dashboard && S.dashboard.units) || []).map(function (u) {
      const cs = u.class_ids.map(function (id) { return S.classes.find(function (c) { return c.class_id === id; }); }).filter(Boolean);
      const h = cs.find(function (c) { return c.homeroom_teacher_id; });
      const r = cs.find(function (c) { return c.home_room_id; });
      return Object.assign({}, u, { homeroom_teacher_id: h ? h.homeroom_teacher_id : '', home_room_id: r ? r.home_room_id : '' });
    });
    return { units: units, subjects: S.subjects, teachers: S.teachers, rooms: S.rooms, periods: S.periods,
      config: Object.assign({}, S.config || {}, cfgRendered ? readConfig() : {}), seed: Date.now() };
  }

  /* ════ รัน AI ════ */
  document.getElementById('tt-run').onclick = function () {
    const S = TT.S;
    if (!S.periods.some(function (p) { return String(p.is_break) !== '1'; })) { Toast.show('ยังไม่ได้กำหนดคาบเรียน', 'warning'); return; }
    if (!S.subjects.length) { Toast.show('ยังไม่มีรายวิชา', 'warning'); return; }
    const btn = this;
    btn.disabled = true;
    window.TT_AI_RUNNING = true;
    const bar = document.getElementById('tt-progress-bar'), txt = document.getElementById('tt-progress-text');
    document.getElementById('tt-progress').classList.remove('hidden');
    bar.style.width = '2%';
    txt.textContent = 'กำลังวิเคราะห์ข้อจำกัด...';

    let worker;
    try { worker = new Worker('js/tt-solver.js?v=' + encodeURIComponent(window.APP_VERSION || '1')); }
    catch (e) { finish(); Toast.show('เบราว์เซอร์นี้ไม่รองรับ Web Worker', 'danger'); return; }

    function finish() { btn.disabled = false; window.TT_AI_RUNNING = false; if (worker) worker.terminate(); }
    worker.onmessage = function (e) {
      const m = e.data;
      if (m.type === 'progress') {
        const p = m.progress;
        bar.style.width = (p.pct || 0) + '%';
        txt.textContent = p.phase === 'search'
          ? 'ค้นหาตาราง... ลองแล้ว ' + p.attempts + ' แบบ · ดีที่สุดยังจัดไม่ได้ ' + p.unplaced + ' คาบ · คุณภาพ ' + p.quality + '%'
          : p.phase === 'improve' ? 'ปรับปรุงตาราง... (' + Utils.fmtInt(p.iterations || 0) + ' ครั้ง)' : 'เสร็จสิ้น';
      } else if (m.type === 'result') {
        finish();
        lastResult = m.result;
        txt.textContent = 'เสร็จสิ้นใน ' + (m.result.stats.ms / 1000).toFixed(1) + ' วินาที';
        renderResult(m.result);
      } else if (m.type === 'error') {
        finish();
        txt.textContent = '';
        Toast.show('จัดตารางไม่สำเร็จ: ' + m.message, 'danger');
      }
    };
    worker.onerror = function (e) { finish(); Toast.show('AI Engine ผิดพลาด: ' + (e.message || 'ไม่ทราบสาเหตุ'), 'danger'); };
    worker.postMessage({ type: 'run', input: buildInput() });
  };

  /* ════ แสดงผล ════ */
  const REASON = {
    unit: ['ชั้นนี้ไม่มีช่องว่างพอ', 'ลดคาบของวิชาในชั้นนี้ หรือเพิ่มจำนวนคาบต่อวัน'],
    t_busy: ['ครูผู้สอนติดสอนชั้นอื่นในช่องที่ว่าง', 'เพิ่มครูผู้สอนได้ให้วิชานี้ หรือโอนบางวิชาของครูคนนี้ให้ครูอื่น'],
    t_off: ['ตรงกับวันหยุดของครู', 'ผ่อนวันหยุดประจำของครู หรือเพิ่มครูผู้สอนได้'],
    t_unav: ['ตรงกับช่วงที่ครูสอนไม่ได้', 'ลดช่วงเวลาที่สอนไม่ได้ของครู'],
    t_pref: ['ติดเงื่อนไขไม่สอนคาบแรก/สุดท้าย', 'ยกเลิกเงื่อนไขไม่สอนคาบแรก/สุดท้ายของครู'],
    t_max: ['ครูสอนครบคาบสูงสุดแล้ว', 'เพิ่ม "คาบสูงสุด" ของครู หรือมอบหมายครูคนอื่น'],
    t_consec: ['ครูจะสอนติดกันเกินกำหนด', 'เพิ่มค่า "สอนติดกันได้สูงสุด"'],
    room: ['ห้องที่ต้องใช้ไม่ว่าง', 'เพิ่มห้องประเภทนี้ หรือเพิ่ม "ใช้พร้อมกันได้" ของห้อง'],
    per_day: ['วิชานี้ครบจำนวนคาบต่อวันแล้ว', 'เพิ่ม "ไม่เกินวันละ" ของวิชา (หรือในแท็บเงื่อนไข)'],
    days: ['วิชานี้จำกัดวันเรียน', 'เพิ่มวันที่อนุญาตของวิชา'],
    block: ['จัดคาบต่อเนื่องไม่ได้ (ติดพัก/ท้ายวัน)', 'ลด "เรียนต่อเนื่องครั้งละ" ของวิชา'],
  };

  function kpi(icon, label, value, sub) {
    return '<div class="stat tt-stat"><div class="ic">' + icon + '</div><div><div class="label">' + label + '</div><div class="value">' + value + '</div>' + (sub ? '<div class="sub">' + sub + '</div>' : '') + '</div></div>';
  }

  function renderResult(res) {
    const st = res.stats, m = res.metrics;
    const ok = st.unplaced === 0;
    const groups = {};
    res.unplaced.forEach(function (u) {
      const k = u.unit_label + '|' + u.subject_id;
      if (!groups[k]) groups[k] = { u: u, periods: 0 };
      groups[k].periods += u.len;
    });
    const unplacedHtml = Object.keys(groups).map(function (k) {
      const g = groups[k], top = (g.u.reasons[0] || {}).code, r = REASON[top] || ['ไม่พบช่องที่เหมาะสม', 'ผ่อนเงื่อนไขที่เกี่ยวข้อง'];
      return '<div class="tt-issue alert-danger"><span>⛔</span><span><strong>' + esc(g.u.unit_label) + ' · ' + esc(g.u.subject_name) + '</strong> จัดไม่ได้ ' + g.periods + ' คาบ' +
        (g.u.teacher_name ? ' (ครู' + esc(g.u.teacher_name) + ')' : '') + '<br>สาเหตุ: ' + r[0] + '<br>💡 แนะนำ: ' + r[1] + '</span></div>';
    }).join('');

    const lv = { error: ['alert-danger', '⛔'], warning: ['alert-warning', '⚠️'], info: ['alert-info', 'ℹ️'] };
    const byCode = {};
    res.warnings.forEach(function (w) { (byCode[w.level + '|' + w.code] = byCode[w.level + '|' + w.code] || []).push(w); });
    const warnHtml = Object.keys(byCode).map(function (k) {
      const ws = byCode[k], l = lv[ws[0].level] || lv.info;
      if (ws.length === 1) return '<div class="tt-issue ' + l[0] + '"><span>' + l[1] + '</span><span>' + esc(ws[0].msg) + '</span></div>';
      const title = { no_teacher: 'คาบที่ยังไม่มีครูผู้สอน', homeroom: 'วิชาที่ใช้ครูประจำชั้นสอนแทน', over_max: 'ครูเกินคาบสูงสุด', over_cap: 'ครูมีช่องเวลาไม่พอ', no_room: 'วิชาที่ยังไม่มีห้องตามประเภท', unit_over: 'ชั้นที่คาบเกินช่อง' }[ws[0].code] || ws[0].code;
      return '<details class="tt-issue ' + l[0] + '" style="display:block"><summary>' + l[1] + ' ' + title + ' (' + ws.length + ' รายการ)</summary><ul style="margin:6px 0 0 18px">' +
        ws.map(function (w) { return '<li>' + esc(w.msg) + '</li>'; }).join('') + '</ul></details>';
    }).join('');

    document.getElementById('tt-result').innerHTML =
      '<div class="card"><h3 class="card-title">' + (ok ? '✅ จัดตารางสำเร็จ' : '⚠️ จัดตารางได้บางส่วน') + '</h3>' +
      '<div class="tt-kpi">' +
        kpi('🧩', 'คาบที่จัดได้', st.periods_placed + '/' + st.periods_total, ok ? 'ครบทุกคาบ' : 'ขาด ' + (st.periods_total - st.periods_placed) + ' คาบ') +
        kpi('⭐', 'คุณภาพตาราง', st.quality + '%', 'ซ้ำวัน ' + m.sameDay + ' · คาบว่างแทรก ' + m.gaps) +
        kpi('🌤️', 'วิชาพื้นฐานช่วงบ่าย', Utils.fmtInt(m.coreAft), 'กิจกรรมช่วงเช้า ' + m.actMorn) +
        kpi('⚡', 'ประมวลผล', (st.ms / 1000).toFixed(1) + ' วิ', Utils.fmtInt(st.attempts) + ' แบบ · ปรับ ' + Utils.fmtInt(st.iterations) + ' ครั้ง') +
      '</div>' +
      (unplacedHtml ? '<h3 class="card-title" style="font-size:16px">ข้อขัดแย้งที่ต้องแก้</h3>' + unplacedHtml : '<div class="alert alert-success">ผ่านกติกาเด็ดขาดทั้งหมด: ครู/ชั้น/ห้องไม่ชนกัน และตรงตามเงื่อนไขเวลาของครูและวิชา</div>') +
      (warnHtml ? '<h3 class="card-title" style="font-size:16px;margin-top:12px">ข้อสังเกต</h3>' + warnHtml : '') +
      '<div class="tt-toolbar" style="margin-top:14px"><input class="form-control" id="tt-save-label" placeholder="ชื่อฉบับ (ไม่บังคับ)" value="' +
        esc('AI ' + new Date().toLocaleString('th-TH', { dateStyle: 'short', timeStyle: 'short' })) + '">' +
        '<button class="btn btn-primary" id="tt-save"><i class="bi bi-save"></i> บันทึกเป็นฉบับใหม่</button>' +
        '<button class="btn btn-secondary" id="tt-rerun"><i class="bi bi-arrow-repeat"></i> จัดใหม่อีกแบบ</button></div></div>' +
      '<div class="card" id="tt-preview"></div>';

    document.getElementById('tt-save').onclick = saveResult;
    document.getElementById('tt-rerun').onclick = function () { document.getElementById('tt-run').click(); };
    renderViewer(document.getElementById('tt-preview'), placementsToSlots(res.placements), '👀 ตัวอย่างตาราง (ยังไม่บันทึก)');
  }

  function placementsToSlots(placements) {
    const out = [];
    placements.forEach(function (p) {
      p.class_ids.forEach(function (cid) {
        p.period_ids.forEach(function (pid) {
          out.push({ class_id: cid, day: p.day, period_id: pid, subject_id: p.subject_id, teacher_id: p.teacher_id, room_id: p.room_id });
        });
      });
    });
    return out;
  }

  async function saveResult() {
    if (!lastResult) return;
    const slots = placementsToSlots(lastResult.placements);
    if (!slots.length) { Toast.show('ไม่มีคาบที่จัดได้ให้บันทึก', 'warning'); return; }
    const st = lastResult.stats;
    try {
      const r = await api('tt.save_version', {
        label: document.getElementById('tt-save-label').value.trim(), slots: slots, recorded_by: 'admin',
        stats: { periods_placed: st.periods_placed, periods_total: st.periods_total, unplaced: st.unplaced, quality: st.quality,
          ms: st.ms, attempts: st.attempts, engine: st.engine, metrics: lastResult.metrics },
      }, { loadingMsg: 'กำลังบันทึกตาราง...', noRetry: true });
      Toast.show('บันทึกแล้ว (' + r.slots + ' ช่อง' + (r.conflicts ? ', พบข้อขัดแย้ง ' + r.conflicts : ', ไม่มีข้อขัดแย้ง') + ')', r.conflicts ? 'warning' : 'success');
      await TT.reload({ quiet: true });
      const btn = document.getElementById('tt-save');
      btn.innerHTML = '<i class="bi bi-pencil-square"></i> ตรวจสอบ / แก้ไขฉบับนี้';
      btn.onclick = function () { window.TTEdit.open(r.version_id); };
    } catch (e) { /* toast แสดงแล้ว */ }
  }

  /* ════ ตัวแสดงตาราง (รายชั้น / รายครู) ════ */
  function shortSubject(n) { return String(n || '').replace(/\s*\(ป\.[^)]*\)$/, ''); }
  function shortTeacher(t) { return t ? String(t.name || '').split(/\s+/)[0] : ''; }

  function renderViewer(host, slots, title) {
    const S = TT.S;
    const units = (S.dashboard && S.dashboard.units) || [];
    const unitOf = {};
    units.forEach(function (u) { u.class_ids.forEach(function (c) { unitOf[c] = u; }); });
    const subj = {}, tch = {};
    S.subjects.forEach(function (s) { subj[s.subject_id] = s; });
    S.teachers.forEach(function (t) { tch[t.teacher_id] = t; });
    const periods = S.periods.slice().sort(function (a, b) { return (a.seq || 0) - (b.seq || 0); });
    const usedUnits = units.filter(function (u) { return slots.some(function (s) { return u.class_ids.indexOf(s.class_id) >= 0; }); });
    const usedTeachers = S.teachers.filter(function (t) { return slots.some(function (s) { return s.teacher_id === t.teacher_id; }); });
    const NONE = '__none__';
    const noTeacher = slots.filter(function (s) { return !s.teacher_id; }).length;

    host.innerHTML = '<h3 class="card-title">' + title + '</h3>' +
      '<div class="tt-toolbar"><select class="form-control" data-mode style="max-width:160px"><option value="unit">รายชั้นเรียน</option><option value="teacher">รายครู</option></select>' +
      '<select class="form-control" data-key></select></div><div data-grid></div>';
    const modeSel = host.querySelector('[data-mode]'), keySel = host.querySelector('[data-key]');

    function fillKeys() {
      const opts = modeSel.value === 'unit'
        ? usedUnits.map(function (u) { return [u.unit_id, u.label + (u.combined ? ' (ควบชั้น)' : '')]; })
        : usedTeachers.map(function (t) { return [t.teacher_id, TT.teacherName(t)]; })
            .concat(noTeacher ? [[NONE, '— ยังไม่ระบุครู (' + noTeacher + ' ช่อง) —']] : []);
      keySel.innerHTML = opts.length ? opts.map(function (o) { return '<option value="' + esc(o[0]) + '">' + esc(o[1]) + '</option>'; }).join('') : '<option value="">— ไม่มีข้อมูล —</option>';
      draw();
    }

    function draw() {
      const key = keySel.value, grid = host.querySelector('[data-grid]');
      const cell = {};
      let count = 0;
      if (modeSel.value === 'unit') {
        const u = usedUnits.find(function (x) { return x.unit_id === key; });
        const cid = u ? u.class_ids[0] : null;
        slots.forEach(function (s) { if (s.class_id === cid) { cell[s.day + '|' + s.period_id] = s; count++; } });
      } else {
        // หนึ่งช่องอาจมีหลายหน่วย (กลุ่ม "ยังไม่ระบุครู" หรือครูสอนชน) → แสดงทุกหน่วย ไม่ซ้ำ
        slots.forEach(function (s) {
          if ((s.teacher_id || NONE) !== key) return;
          const k = s.day + '|' + s.period_id, u = unitOf[s.class_id];
          if (!cell[k]) { cell[k] = Object.assign({}, s, { units: [] }); count++; }
          if (u && cell[k].units.indexOf(u) < 0) cell[k].units.push(u);
        });
      }
      grid.innerHTML = '<div class="tt-note" style="margin-bottom:6px">' + count + ' คาบ/สัปดาห์</div><div class="table-wrap"><table class="tt-tt"><thead><tr><th>วัน</th>' +
        periods.map(function (p) { return '<th>' + esc(p.label) + '<br><span class="tt-note">' + esc((p.start_time || '') + (p.end_time ? '–' + p.end_time : '')) + '</span></th>'; }).join('') +
        '</tr></thead><tbody>' + [1, 2, 3, 4, 5].map(function (d) {
          return '<tr><th>' + TT.DAY_NAMES[d] + '</th>' + periods.map(function (p) {
            if (String(p.is_break) === '1') return '<td class="brk">' + esc(p.label) + '</td>';
            const s = cell[d + '|' + p.period_id];
            if (!s) return '<td></td>';
            const sb = subj[s.subject_id] || {};
            if (modeSel.value !== 'unit' && s.units.length > 1) {
              return '<td><div class="tt-cell"><div class="t">' + s.units.map(function (u) { return esc(u.label); }).join('<br>') + '</div></div></td>';
            }
            const sub2 = modeSel.value === 'unit' ? (s.teacher_id ? 'ครู' + shortTeacher(tch[s.teacher_id]) : 'ยังไม่ระบุครู') : (s.units[0] ? s.units[0].label : '');
            return '<td><div class="tt-cell ' + esc(sb.type || 'core') + '"><div class="s">' + esc(shortSubject(sb.name)) + '</div><div class="t">' + esc(sub2) + '</div></div></td>';
          }).join('') + '</tr>';
        }).join('') + '</tbody></table></div>';
    }

    modeSel.onchange = fillKeys;
    keySel.onchange = draw;
    fillKeys();
  }

  /* ════ ฉบับตาราง (Version History) ════ */
  function renderVersions() {
    const vs = TT.S.versions || [];
    const host = document.getElementById('tt-versions');
    if (!vs.length) { host.innerHTML = '<div class="text-muted">ยังไม่มีฉบับที่บันทึก</div>'; return; }
    const stTh = { draft: 'ร่าง', generated: 'จัดเสร็จ', edited: 'แก้ไขแล้ว', approved: 'อนุมัติแล้ว', published: 'เผยแพร่แล้ว' };
    host.innerHTML = '<div class="table-wrap"><table><thead><tr><th>ฉบับ</th><th>สถานะ</th><th>คาบ</th><th>คุณภาพ</th><th>ข้อขัดแย้ง</th><th>บันทึกเมื่อ</th><th></th></tr></thead><tbody>' +
      vs.map(function (v) {
        const s = v.stats || {};
        return '<tr><td><strong>' + esc(v.label) + '</strong></td><td>' + esc(stTh[v.status] || v.status) + '</td>' +
          '<td>' + (s.periods_placed != null ? s.periods_placed + '/' + s.periods_total : esc(s.slots || '-')) + '</td>' +
          '<td>' + (s.quality != null ? s.quality + '%' : '-') + '</td>' +
          '<td>' + (Number(s.conflicts) ? '<span class="badge badge-fail">' + s.conflicts + '</span>' : '<span class="badge badge-pass">0</span>') + '</td>' +
          '<td>' + esc(Utils.fmtDateTime(v.created_at)) + '</td>' +
          '<td class="tt-actions"><button class="btn btn-primary" data-editv="' + esc(v.version_id) + '" title="ตรวจสอบ / แก้ไข"><i class="bi bi-pencil-square"></i></button>' +
          '<button class="btn btn-secondary" data-view="' + esc(v.version_id) + '" title="ดูตาราง"><i class="bi bi-eye"></i></button>' +
          '<button class="btn btn-danger" data-delv="' + esc(v.version_id) + '"><i class="bi bi-trash"></i></button></td></tr>';
      }).join('') + '</tbody></table></div><div class="card" id="tt-version-view" style="margin-top:12px;display:none"></div>';
    host.querySelectorAll('[data-view]').forEach(function (b) {
      b.onclick = async function () {
        try {
          const d = await api('tt.get_version', { version_id: b.dataset.view }, { loadingMsg: 'กำลังโหลดตาราง...' });
          const box = document.getElementById('tt-version-view');
          box.style.display = '';
          renderViewer(box, d.slots, '🗓️ ' + esc(d.version.label));
          box.scrollIntoView({ behavior: 'smooth', block: 'start' });
        } catch (e) { /* toast */ }
      };
    });
    host.querySelectorAll('[data-editv]').forEach(function (b) {
      b.onclick = function () { window.TTEdit.open(b.dataset.editv); };
    });
    host.querySelectorAll('[data-delv]').forEach(function (b) {
      b.onclick = async function () {
        if (!confirm('ลบฉบับตารางนี้? (ลบเฉพาะฉบับนี้ ไม่กระทบข้อมูลอื่น)')) return;
        try { await api('tt.delete_version', { version_id: b.dataset.delv, recorded_by: 'admin' }, { loadingMsg: 'กำลังลบ...', noRetry: true }); Toast.show('ลบฉบับแล้ว', 'success'); TT.reload({ quiet: true }); } catch (e) { /* toast */ }
      };
    });
  }

  window.addEventListener('tt:loaded', function () {
    if (!cfgRendered && TT.S.config) renderConfig(TT.S.config);
    renderVersions();
  });
})();
