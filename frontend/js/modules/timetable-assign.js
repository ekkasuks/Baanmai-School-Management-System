/**
 * มอบหมายการสอน: วิชา × ชั้นเรียน → ครู (เลือกได้อิสระทุกวิชา ทุกชั้น)
 *   แถว = วิชา (รวมตามชื่อ เช่น "คณิตศาสตร์" ครอบคลุม ป.1–3 และ ป.4–6) · คอลัมน์ = ชั้นเรียน (กลุ่มควบชั้น = 1 คอลัมน์)
 *   ช่องว่าง = "อัตโนมัติ" (AI เลือกจากครูที่สอนวิชานั้นได้ / ครูประจำชั้น เหมือนเดิม)
 *   เติมทั้งแถว (ครูคนเดียวสอนวิชานี้ทุกชั้น) / ทั้งคอลัมน์ (ครูประจำชั้นสอนทุกวิชา) · สรุปภาระคาบของครูทันที
 *   บันทึกครั้งเดียว (tt.assign_save) · AI Engine และตัวแก้ไขใช้ครูตามนี้ก่อนเสมอ
 */
(function () {
  const esc = Utils.esc;
  const host = document.getElementById('tab-assign');
  const AUTO = '';
  let draft = {}, base = {};   // 'unit_id|subject_id' → teacher_id

  function S() { return TT.S; }
  function short(n) { return String(n || '').replace(/\s*\(ป\.[^)]*\)$/, ''); }
  function units() {
    return ((S().dashboard && S().dashboard.units) || []).filter(function (u) { return S().subjects.some(function (s) { return applies(s, u); }); });
  }
  function applies(s, u) { return (s.grades || []).some(function (g) { return u.grades.indexOf(g) >= 0; }); }
  /** แถว: ชื่อวิชาแบบย่อ → วิชาที่ใช้กับแต่ละหน่วย */
  function rows() {
    const order = [], map = {};
    S().subjects.forEach(function (s) {
      const k = short(s.name);
      if (!map[k]) { map[k] = []; order.push(k); }
      map[k].push(s);
    });
    return order.map(function (k) { return { name: k, subjects: map[k] }; });
  }
  function subjectFor(row, u) { return row.subjects.find(function (s) { return applies(s, u); }) || null; }
  function teacher(id) { return S().teachers.find(function (t) { return t.teacher_id === id; }); }
  function homeroom(u) {
    const c = u.class_ids.map(function (id) { return S().classes.find(function (x) { return x.class_id === id; }); }).find(function (c) { return c && c.homeroom_teacher_id; });
    return c ? c.homeroom_teacher_id : '';
  }
  function changedKeys() { return Object.keys(Object.assign({}, base, draft)).filter(function (k) { return (draft[k] || '') !== (base[k] || ''); }); }

  function loadDraft() {
    base = Object.assign({}, TT.assignMap().map);
    draft = Object.assign({}, base);
  }

  function teacherOptions(sid, cur) {
    const el = {};
    const s = S().subjects.find(function (x) { return x.subject_id === sid; });
    ((s && s.teachers) || []).forEach(function (t) { el[t] = 1; });
    S().teachers.forEach(function (t) { if ((t.subjects || []).indexOf(sid) >= 0) el[t.teacher_id] = 1; });
    return '<option value="">อัตโนมัติ</option>' + S().teachers.map(function (t) {
      return '<option value="' + esc(t.teacher_id) + '"' + (t.teacher_id === cur ? ' selected' : '') + '>' + (el[t.teacher_id] ? '⭐ ' : '') + esc(TT.teacherName(t)) + '</option>';
    }).join('');
  }

  function render() {
    if (!S().subjects.length || !units().length) {
      host.innerHTML = '<div class="card"><div class="alert alert-info">ยังไม่มีวิชาหรือชั้นเรียน — เพิ่มในแท็บ "วิชา" และ "ชั้นเรียน" ก่อน</div></div>';
      return;
    }
    const us = units(), rs = rows(), ch = changedKeys().length;
    const allT = '<option value="">— เลือกครู —</option>' + S().teachers.map(function (t) { return '<option value="' + esc(t.teacher_id) + '">' + esc(TT.teacherName(t)) + '</option>'; }).join('');
    host.innerHTML =
      '<div class="card"><div class="flex" style="justify-content:space-between;flex-wrap:wrap;gap:8px;margin-bottom:6px">' +
        '<h3 class="card-title" style="margin:0">🧑‍🏫 มอบหมายการสอน (วิชา × ชั้น → ครู)</h3>' +
        '<div class="tt-toolbar" style="margin:0"><button class="btn btn-secondary" data-reset' + (ch ? '' : ' disabled') + '><i class="bi bi-arrow-counterclockwise"></i> ยกเลิกที่แก้</button>' +
        '<button class="btn btn-primary" data-save' + (ch ? '' : ' disabled') + '><i class="bi bi-save"></i> บันทึก' + (ch ? ' (' + ch + ' ช่อง)' : '') + '</button></div></div>' +
        '<p class="tt-note" style="margin:0 0 10px">เลือกครูผู้สอนของแต่ละวิชาในแต่ละชั้น · ⭐ = ครูที่ระบุว่าสอนวิชานั้นได้ · "อัตโนมัติ" = ให้ AI เลือกเอง · ' +
          'ใช้แถวบนสุดเพื่อให้ครูคนเดียวสอนทุกวิชาของชั้นนั้น และคอลัมน์ขวาสุดเพื่อให้ครูคนเดียวสอนวิชานั้นทุกชั้น</p>' +
        '<div data-mixed></div>' +
        '<div class="table-wrap"><table class="tt-assign"><thead><tr><th class="sticky">วิชา</th>' +
          us.map(function (u) { return '<th>' + esc(u.label) + (u.combined ? '<br><span class="tt-pill combo">ควบชั้น</span>' : '') + '</th>'; }).join('') + '<th>ทั้งแถว</th></tr>' +
          '<tr class="fill"><th class="sticky tt-note">ทั้งชั้น →</th>' + us.map(function (u, j) {
            return '<th><select class="form-control" data-col="' + j + '">' + allT.replace('— เลือกครู —', '— ทั้งชั้น —') + (homeroom(u) ? '<option value="__home">ครูประจำชั้น</option>' : '') + '<option value="__auto">ล้าง (อัตโนมัติ)</option></select></th>';
          }).join('') + '<th></th></tr></thead><tbody>' +
          rs.map(function (r, i) {
            return '<tr><th class="sticky">' + esc(r.name) + '</th>' + us.map(function (u) {
              const s = subjectFor(r, u);
              if (!s) return '<td class="na">—</td>';
              const k = u.unit_id + '|' + s.subject_id, cur = draft[k] || AUTO;
              return '<td class="' + ((draft[k] || '') !== (base[k] || '') ? 'chg' : '') + (cur ? ' set' : '') + '"><select class="form-control" data-k="' + esc(k) + '">' + teacherOptions(s.subject_id, cur) + '</select>' +
                '<div class="tt-note">' + (Number(s.periods_week) || 0) + ' คาบ</div></td>';
            }).join('') + '<td><select class="form-control" data-row="' + i + '">' + allT.replace('— เลือกครู —', '— ทั้งแถว —') + '<option value="__auto">ล้าง (อัตโนมัติ)</option></select></td></tr>';
          }).join('') + '</tbody></table></div>' +
      '</div>' +
      '<div class="card"><h3 class="card-title">📊 ภาระคาบตามที่มอบหมาย</h3><div data-load></div></div>';

    host.querySelectorAll('select[data-k]').forEach(function (sel) {
      sel.onchange = function () { draft[sel.dataset.k] = sel.value; render(); };
    });
    host.querySelectorAll('select[data-col]').forEach(function (sel) {
      sel.onchange = function () {
        const u = us[Number(sel.dataset.col)];
        const v = sel.value === '__home' ? homeroom(u) : sel.value === '__auto' ? '' : sel.value;
        rs.forEach(function (r) { const s = subjectFor(r, u); if (s) draft[u.unit_id + '|' + s.subject_id] = v; });
        render();
      };
    });
    host.querySelectorAll('select[data-row]').forEach(function (sel) {
      sel.onchange = function () {
        const r = rs[Number(sel.dataset.row)], v = sel.value === '__auto' ? '' : sel.value;
        us.forEach(function (u) { const s = subjectFor(r, u); if (s) draft[u.unit_id + '|' + s.subject_id] = v; });
        render();
      };
    });
    host.querySelector('[data-save]').onclick = save;
    host.querySelector('[data-reset]').onclick = function () { draft = Object.assign({}, base); render(); };
    renderMixed();
    renderLoad(us);
  }

  function renderMixed() {
    const m = TT.assignMap().mixed;
    host.querySelector('[data-mixed]').innerHTML = m.length ? '<div class="alert alert-warning" style="font-size:14px">⚠️ กลุ่มควบชั้นที่ห้องในกลุ่มมอบหมายครูต่างกัน (ใช้ครูของห้องแรก): ' +
      m.map(function (x) { return esc(x.unit.label + ' · ' + short(x.subject.name)); }).join(', ') + ' — เลือกใหม่แล้วบันทึกเพื่อให้ตรงกัน</div>' : '';
  }

  /** ภาระคาบรวมต่อครู (ตามร่างที่กำลังแก้) เทียบคาบสูงสุด */
  function renderLoad(us) {
    const load = {}, detail = {};
    let auto = 0;
    us.forEach(function (u) {
      S().subjects.forEach(function (s) {
        if (!applies(s, u)) return;
        const t = draft[u.unit_id + '|' + s.subject_id], n = Number(s.periods_week) || 0;
        if (!t) { auto += n; return; }
        load[t] = (load[t] || 0) + n;
        (detail[t] = detail[t] || []).push(short(s.name) + ' ' + u.label);
      });
    });
    const rows = S().teachers.map(function (t) {
      const n = load[t.teacher_id] || 0, mx = t.max_periods;
      const over = mx !== null && mx !== undefined && mx !== '' && n > Number(mx);
      const pct = Math.min(100, Math.round(n / Math.max(1, Number(mx) || 35) * 100));
      return '<tr><td><strong>' + esc(TT.teacherName(t)) + '</strong></td><td style="white-space:nowrap">' + (over ? '<span class="text-danger">⛔ ' : '') + n + (mx != null && mx !== '' ? ' / ' + mx : '') + ' คาบ' + (over ? '</span>' : '') + '</td>' +
        '<td style="min-width:120px"><div class="progress" style="height:10px"><div class="progress-bar" style="width:' + pct + '%;' + (over ? 'background:var(--red)' : '') + '"></div></div></td>' +
        '<td class="tt-note">' + esc((detail[t.teacher_id] || []).join(', ') || '-') + '</td></tr>';
    }).join('');
    host.querySelector('[data-load]').innerHTML = '<div class="table-wrap"><table class="tt-results"><thead><tr><th>ครู</th><th>คาบ/สัปดาห์</th><th></th><th>วิชา · ชั้น</th></tr></thead><tbody>' + rows + '</tbody></table></div>' +
      '<p class="tt-note" style="margin:8px 0 0">ยังไม่มอบหมาย (ให้ AI เลือก) ' + auto + ' คาบ/สัปดาห์ · กลุ่มควบชั้นนับครั้งเดียว · คาบสูงสุดตั้งในแท็บ "ครู"</p>';
  }

  async function save() {
    const keys = changedKeys();
    if (!keys.length) return;
    const us = units();
    const rows = [];
    keys.forEach(function (k) {
      const p = k.split('|'), u = us.find(function (x) { return x.unit_id === p[0]; });
      if (!u) return;
      u.class_ids.forEach(function (cid) { rows.push({ class_id: cid, subject_id: p[1], teacher_id: draft[k] || '' }); });
    });
    try {
      const r = await api('tt.assign_save', { rows: rows }, { loadingMsg: 'กำลังบันทึก...', noRetry: true });
      Toast.show('บันทึกการมอบหมายแล้ว (' + r.set + ' ช่อง' + (r.cleared ? ', ล้าง ' + r.cleared : '') + ') — กดจัดตาราง AI ใหม่เพื่อใช้ครูตามนี้', 'success');
      await TT.reload({ quiet: true });
      loadDraft();
      render();
    } catch (e) { /* toast แสดงแล้ว */ }
  }

  document.querySelectorAll('#tt-tabs .tab').forEach(function (t) {
    t.addEventListener('click', function () {
      if (t.dataset.tab === 'assign') { if (!changedKeys().length) loadDraft(); render(); return; }   // กลับมาแล้วร่างที่ยังไม่บันทึกยังอยู่
      if (changedKeys().length) Toast.show('มีการมอบหมายที่ยังไม่บันทึกในแท็บ "มอบหมายการสอน"', 'warning');
    });
  });
  window.addEventListener('beforeunload', function (e) { if (host.querySelector('[data-save]') && changedKeys().length) { e.preventDefault(); e.returnValue = ''; } });
})();
