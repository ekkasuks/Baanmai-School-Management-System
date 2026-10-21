/**
 * ล็อกวิชาในคาบ (ทั้งโรงเรียน) — เช่น สวดมนต์ ลูกเสือ ชุมนุม ให้ทุกชั้นเรียนเวลาเดียวกัน
 *   เลือกวิชา (รวมตามชื่อ: ทุกช่วงชั้นของวิชาชื่อเดียวกัน) → คลิกช่องในตารางสัปดาห์เพื่อล็อก/ปลดล็อก
 *   "ครูดูแลร่วมได้" = ครูคนเดียวดูแลหลายชั้นพร้อมกันในคาบล็อกนี้ได้ (ไม่นับเป็นครูสอนชน)
 *   เก็บใน TT_SUBJECT.rules.fixed_slots / rules.shared · บันทึกผ่าน tt.import_entities (ครั้งเดียว ตรวจซ้ำที่ server)
 *   AI Engine วางคาบล็อกก่อนทุกวิชาและไม่ย้าย · ตารางที่ได้จะเป็นช่อง 🔒
 */
(function () {
  const esc = Utils.esc;
  const host = document.getElementById('tab-lock');
  let draft = {}, sel = null;   // draft: subject_id → { fixed_slots:[{day,period_id}], shared }

  function S() { return TT.S; }
  function short(n) { return String(n || '').replace(/\s*\(ป\.[^)]*\)$/, ''); }
  function groups() {
    const order = [], map = {};
    S().subjects.forEach(function (s) {
      const k = short(s.name);
      if (!map[k]) { map[k] = { name: k, subjects: [] }; order.push(map[k]); }
      map[k].subjects.push(s);
    });
    order.forEach(function (g) {
      g.grades = [];
      g.subjects.forEach(function (s) { (s.grades || []).forEach(function (x) { if (g.grades.indexOf(x) < 0) g.grades.push(x); }); });
      g.grades.sort(function (a, b) { return Utils.gradeSortKey(a) - Utils.gradeSortKey(b); });
      g.max = Math.min.apply(null, g.subjects.map(function (s) { return Number(s.periods_week) || 0; }));
    });
    return order;
  }
  function gradeText(gs) { return gs.length > 2 ? gs[0] + '–' + gs[gs.length - 1] : gs.join(', '); }
  function periods() { return S().periods.slice().sort(function (a, b) { return (a.seq || 0) - (b.seq || 0); }); }
  function loadDraft() {
    draft = {};
    S().subjects.forEach(function (s) {
      const r = s.rules || {};
      draft[s.subject_id] = { fixed_slots: (r.fixed_slots || []).map(function (x) { return { day: Number(x.day), period_id: x.period_id }; }), shared: r.shared !== false };
    });
  }
  /** วิชาที่เพิ่งเพิ่ม (หลังโหลดร่าง) → ใส่ค่าเริ่มต้นจากข้อมูลจริง */
  function ensure() {
    S().subjects.forEach(function (s) {
      if (draft[s.subject_id]) return;
      const r = s.rules || {};
      draft[s.subject_id] = { fixed_slots: (r.fixed_slots || []).map(function (x) { return { day: Number(x.day), period_id: x.period_id }; }), shared: r.shared !== false };
    });
  }
  function slotsOf(g) { return draft[g.subjects[0].subject_id].fixed_slots; }
  function has(list, d, pid) { return list.some(function (x) { return x.day === d && x.period_id === pid; }); }
  function changed() {
    return S().subjects.filter(function (s) {
      const r = s.rules || {}, d = draft[s.subject_id];
      if (!d) return false;
      const a = JSON.stringify((r.fixed_slots || []).map(function (x) { return Number(x.day) + '|' + x.period_id; }).sort());
      const b = JSON.stringify(d.fixed_slots.map(function (x) { return x.day + '|' + x.period_id; }).sort());
      return a !== b || (d.fixed_slots.length && (r.shared !== false) !== d.shared);
    });
  }
  /** ปัญหา: วิชาล็อกช่องเดียวกันในชั้นที่ซ้อนกัน · วันที่วิชาไม่อนุญาต · ล็อกเกินจำนวนคาบ */
  function problems(gs) {
    const out = [], bySlot = {};
    gs.forEach(function (g) {
      slotsOf(g).forEach(function (x) { (bySlot[x.day + '|' + x.period_id] = bySlot[x.day + '|' + x.period_id] || []).push(g); });
      if (slotsOf(g).length > g.max) out.push({ level: 'error', msg: g.name + ' ล็อก ' + slotsOf(g).length + ' คาบ เกินจำนวนที่เรียน (' + g.max + ' คาบ/สัปดาห์)' });
      g.subjects.forEach(function (s) {
        const days = ((s.rules || {}).allowed_days || []).map(Number);
        slotsOf(g).forEach(function (x) { if (days.length && days.indexOf(x.day) < 0) out.push({ level: 'warning', msg: s.name + ' ตั้ง "จัดได้เฉพาะวัน" ไว้ แต่ล็อกวัน' + TT.DAY_NAMES[x.day] }); });
      });
    });
    const bad = {};
    Object.keys(bySlot).forEach(function (k) {
      const list = bySlot[k];
      for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) {
        const both = list[i].grades.filter(function (g) { return list[j].grades.indexOf(g) >= 0; });
        if (both.length) {
          bad[k] = 1;
          const p = S().periods.find(function (x) { return x.period_id === k.split('|')[1]; });
          out.push({ level: 'error', msg: list[i].name + ' และ ' + list[j].name + ' ล็อกช่องเดียวกัน (วัน' + TT.DAY_NAMES[Number(k.split('|')[0])] + ' ' + (p ? p.label : '') + ') ในชั้น ' + both.join(', ') });
        }
      }
    });
    return { list: out, bad: bad };
  }

  function render() {
    ensure();
    const gs = groups();
    if (!gs.length) { host.innerHTML = '<div class="card"><div class="alert alert-info">ยังไม่มีรายวิชา</div></div>'; return; }
    if (!sel || !gs.some(function (g) { return g.name === sel; })) {
      const act = gs.find(function (g) { return g.subjects.some(function (s) { return s.type === 'activity'; }); });
      sel = (act || gs[0]).name;
    }
    const g = gs.find(function (x) { return x.name === sel; });
    const pr = problems(gs), ch = changed().length, mine = slotsOf(g);
    const ps = periods();
    host.innerHTML =
      '<div class="card"><div class="flex" style="justify-content:space-between;flex-wrap:wrap;gap:8px;margin-bottom:6px">' +
        '<h3 class="card-title" style="margin:0">📌 ล็อกวิชาในคาบ (ทั้งโรงเรียน)</h3>' +
        '<div class="tt-toolbar" style="margin:0"><button class="btn btn-secondary" data-reset' + (ch ? '' : ' disabled') + '><i class="bi bi-arrow-counterclockwise"></i> ยกเลิกที่แก้</button>' +
        '<button class="btn btn-primary" data-save' + (ch ? '' : ' disabled') + '><i class="bi bi-save"></i> บันทึก' + (ch ? ' (' + ch + ' วิชา)' : '') + '</button></div></div>' +
        '<p class="tt-note" style="margin:0 0 10px">เลือกวิชา แล้วคลิกช่องในตารางเพื่อล็อก/ปลดล็อก — ทุกชั้นที่เรียนวิชานั้นจะเรียนคาบนี้พร้อมกัน · AI จัดวิชาอื่นรอบ ๆ คาบที่ล็อกไว้</p>' +
        '<div class="tt-toolbar"><select class="form-control" data-sel style="max-width:360px">' + gs.map(function (x) {
          const n = slotsOf(x).length;
          return '<option value="' + esc(x.name) + '"' + (x.name === sel ? ' selected' : '') + '>' + (n ? '📌 ' : '') + esc(x.name) + ' (' + esc(gradeText(x.grades)) + ' · ' + x.max + ' คาบ/สัปดาห์' + (n ? ' · ล็อก ' + n : '') + ')</option>';
        }).join('') + '</select>' +
        '<label class="tt-chip"><input type="checkbox" data-shared' + (draft[g.subjects[0].subject_id].shared ? ' checked' : '') + '> ครูดูแลร่วมได้ (ครูคนเดียวดูแลหลายชั้นพร้อมกัน)</label>' +
        '<span class="tt-note">ล็อกแล้ว <strong>' + mine.length + '/' + g.max + '</strong> คาบ</span></div>' +
        '<div class="table-wrap"><table class="tt-tt tt-lockgrid"><thead><tr><th>วัน</th>' + ps.map(function (p) {
          return '<th>' + esc(p.label) + '<br><span class="tt-note">' + esc((p.start_time || '') + (p.end_time ? '–' + p.end_time : '')) + '</span></th>';
        }).join('') + '</tr></thead><tbody>' + [1, 2, 3, 4, 5].map(function (d) {
          return '<tr><th>' + TT.DAY_NAMES[d] + '</th>' + ps.map(function (p) {
            if (String(p.is_break) === '1') return '<td class="brk">' + esc(p.label) + '</td>';
            const k = d + '|' + p.period_id;
            const here = gs.filter(function (x) { return has(slotsOf(x), d, p.period_id); });
            const on = has(mine, d, p.period_id);
            return '<td class="lk' + (on ? ' on' : '') + (pr.bad[k] ? ' bad' : '') + '" data-d="' + d + '" data-p="' + esc(p.period_id) + '" title="' + (on ? 'คลิกเพื่อปลดล็อก' : 'คลิกเพื่อล็อก ' + esc(g.name)) + '">' +
              here.map(function (x) { return '<span class="tt-pill' + (x.name === sel ? '' : ' combo') + '">📌 ' + esc(x.name) + '</span>'; }).join('') + '</td>';
          }).join('') + '</tr>';
        }).join('') + '</tbody></table></div>' +
        (pr.list.length ? '<div style="margin-top:10px">' + pr.list.map(function (x) { return '<div class="tt-issue ' + (x.level === 'error' ? 'alert-danger' : 'alert-warning') + '"><span>' + (x.level === 'error' ? '⛔' : '⚠️') + '</span><span>' + esc(x.msg) + '</span></div>'; }).join('') + '</div>' : '') +
      '</div>' +
      '<div class="card"><h3 class="card-title">📋 วิชาที่ล็อกไว้</h3>' + summary(gs) + '</div>';

    host.querySelector('[data-sel]').onchange = function () { sel = this.value; render(); };
    host.querySelector('[data-shared]').onchange = function () { const v = this.checked; g.subjects.forEach(function (s) { draft[s.subject_id].shared = v; }); render(); };
    host.querySelectorAll('td.lk').forEach(function (td) {
      td.onclick = function () {
        const d = Number(td.dataset.d), pid = td.dataset.p;
        const on = has(mine, d, pid);
        if (!on && mine.length >= g.max) { Toast.show(g.name + ' เรียน ' + g.max + ' คาบ/สัปดาห์ — ล็อกได้สูงสุด ' + g.max + ' คาบ (ปลดล็อกช่องเดิมก่อน)', 'warning'); return; }
        g.subjects.forEach(function (s) {
          const list = draft[s.subject_id].fixed_slots;
          draft[s.subject_id].fixed_slots = on ? list.filter(function (x) { return !(x.day === d && x.period_id === pid); }) : list.concat([{ day: d, period_id: pid }]);
        });
        render();
      };
    });
    host.querySelectorAll('[data-clear]').forEach(function (b) {
      b.onclick = function () { gs.find(function (x) { return x.name === b.dataset.clear; }).subjects.forEach(function (s) { draft[s.subject_id].fixed_slots = []; }); render(); };
    });
    host.querySelectorAll('[data-pick]').forEach(function (b) { b.onclick = function () { sel = b.dataset.pick; render(); host.scrollIntoView({ behavior: 'smooth' }); }; });
    host.querySelector('[data-reset]').onclick = function () { loadDraft(); render(); };
    host.querySelector('[data-save]').onclick = function () { save(pr); };
  }

  function summary(gs) {
    const locked = gs.filter(function (g) { return slotsOf(g).length; });
    if (!locked.length) return '<div class="text-muted">ยังไม่ได้ล็อกวิชาใด — เลือกวิชาด้านบนแล้วคลิกช่องในตาราง</div>';
    return '<div class="table-wrap"><table class="tt-results"><thead><tr><th>วิชา</th><th>ชั้น</th><th>คาบที่ล็อก</th><th>ครูดูแลร่วม</th><th></th></tr></thead><tbody>' +
      locked.map(function (g) {
        const slots = slotsOf(g).slice().sort(function (a, b) { return a.day - b.day; }).map(function (x) {
          const p = S().periods.find(function (y) { return y.period_id === x.period_id; });
          return 'วัน' + TT.DAY_NAMES[x.day] + ' ' + (p ? p.label : '?');
        });
        return '<tr><td><strong>' + esc(g.name) + '</strong></td><td>' + esc(gradeText(g.grades)) + '</td><td>' + esc(slots.join(', ')) + ' (' + slots.length + '/' + g.max + ')</td>' +
          '<td>' + (draft[g.subjects[0].subject_id].shared ? '✅' : '—') + '</td>' +
          '<td class="tt-actions"><button class="btn btn-secondary" data-pick="' + esc(g.name) + '" title="แก้ไข"><i class="bi bi-pencil"></i></button>' +
          '<button class="btn btn-danger" data-clear="' + esc(g.name) + '" title="ปลดล็อกทั้งหมด"><i class="bi bi-unlock"></i></button></td></tr>';
      }).join('') + '</tbody></table></div>';
  }

  async function save(pr) {
    if (pr.list.some(function (x) { return x.level === 'error'; })) { Toast.show('แก้รายการสีแดงก่อนบันทึก', 'warning'); return; }
    const rows = changed().map(function (s) {
      const d = draft[s.subject_id], rules = Object.assign({}, s.rules || {});
      if (d.fixed_slots.length) { rules.fixed_slots = d.fixed_slots; rules.shared = d.shared; }
      else { delete rules.fixed_slots; delete rules.shared; }
      return { subject_id: s.subject_id, rules: rules };
    });
    try {
      await api('tt.import_entities', { entity: 'subject', rows: rows }, { loadingMsg: 'กำลังบันทึก...', noRetry: true });
      Toast.show('บันทึกการล็อกคาบแล้ว (' + rows.length + ' วิชา) — กดจัดตาราง AI ใหม่เพื่อใช้', 'success');
      await TT.reload({ quiet: true });
      loadDraft();
      render();
    } catch (e) { /* toast แสดงแล้ว */ }
  }

  document.querySelectorAll('#tt-tabs .tab').forEach(function (t) {
    t.addEventListener('click', function () {
      if (t.dataset.tab === 'lock') { if (!changed().length || !Object.keys(draft).length) loadDraft(); render(); return; }
      if (Object.keys(draft).length && changed().length) Toast.show('มีการล็อกคาบที่ยังไม่บันทึกในแท็บ "ล็อกคาบ"', 'warning');
    });
  });
  window.addEventListener('beforeunload', function (e) { if (Object.keys(draft).length && changed().length) { e.preventDefault(); e.returnValue = ''; } });
})();
