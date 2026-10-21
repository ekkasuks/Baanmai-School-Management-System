/**
 * คาบว่างร่วมของครู (เช่น ประชุม PLC / ประชุมกลุ่มสาระ) — การ์ดในแท็บ "เงื่อนไข"
 *   กำหนด วัน + คาบ + ครู (ทุกคน หรือเลือกบางคน) → AI ไม่จัดสอนครูกลุ่มนั้นในช่องนี้ · ตัวตรวจแจ้งถ้ามีคาบสอนทับ
 *   เก็บใน TT_CONSTRAINT.config.common_free · บันทึกทันทีที่เพิ่ม/ลบ (tt.constraints_save)
 */
(function () {
  const esc = Utils.esc;
  const host = document.getElementById('tt-free');

  function S() { return TT.S; }
  function list() { return ((S().config || {}).common_free || []).slice(); }
  function teach() { return S().periods.filter(function (p) { return String(p.is_break) !== '1'; }).sort(function (a, b) { return (a.seq || 0) - (b.seq || 0); }); }
  function pLabel(id) { const p = S().periods.find(function (x) { return x.period_id === id; }); return p ? p.label + (p.start_time ? ' (' + p.start_time + '–' + (p.end_time || '') + ')' : '') : '?'; }
  function names(ids) {
    return ids.map(function (id) { const t = S().teachers.find(function (x) { return x.teacher_id === id; }); return t ? TT.teacherName(t) : null; }).filter(Boolean);
  }

  /** ชั้นที่ช่องเรียนไม่พอ เพราะคาบว่างร่วม "ครูทุกคน" กินช่องเรียน */
  function capacityWarnings(items) {
    const allFree = items.filter(function (x) { return !(x.teachers || []).length; }).length;
    if (!allFree) return [];
    const slots = teach().length * 5;
    return ((S().dashboard && S().dashboard.units) || []).map(function (u) {
      const need = S().subjects.filter(function (s) { return (s.grades || []).some(function (g) { return u.grades.indexOf(g) >= 0; }); })
        .reduce(function (a, s) { return a + (Number(s.periods_week) || 0); }, 0);
      return need && need > slots - allFree ? u.label + ' ต้องเรียน ' + need + ' คาบ แต่เหลือช่องที่มีครูสอนได้ ' + (slots - allFree) + ' ช่อง' : null;
    }).filter(Boolean);
  }

  function render() {
    if (!host || !S().config) return;
    const items = list(), tp = teach();
    const canEdit = !window.TTAuth || TTAuth.can('edit_data');
    const warn = capacityWarnings(items);
    host.innerHTML =
      '<h3 class="card-title">🤝 คาบว่างร่วมของครู (เช่น ประชุม PLC)</h3>' +
      '<p class="tt-note" style="margin-top:-6px">ครูที่เลือกจะ<strong>ไม่มีคาบสอน</strong>ในช่องนี้ตรงกันทุกสัปดาห์ · เลือก "ครูทุกคน" = ทุกชั้นจะว่างคาบนี้ (ยกเว้นวิชาที่ล็อกไว้)</p>' +
      (items.length ? '<div class="table-wrap"><table class="tt-results"><thead><tr><th>ชื่อ</th><th>วัน</th><th>คาบ</th><th>ครู</th><th></th></tr></thead><tbody>' +
        items.map(function (x, i) {
          const ts = names(x.teachers || []);
          return '<tr><td><strong>' + esc(x.label || 'คาบว่างร่วม') + '</strong></td><td>' + TT.DAY_NAMES[x.day] + '</td><td>' + esc(pLabel(x.period_id)) + '</td>' +
            '<td>' + ((x.teachers || []).length ? esc(ts.join(', ')) + ' <span class="tt-note">(' + ts.length + ' คน)</span>' : '<span class="tt-pill">ครูทุกคน</span>') + '</td>' +
            '<td class="tt-actions">' + (canEdit ? '<button class="btn btn-danger" data-del="' + i + '" title="ลบ"><i class="bi bi-trash"></i></button>' : '') + '</td></tr>';
        }).join('') + '</tbody></table></div>' : '<div class="text-muted" style="margin-bottom:8px">ยังไม่มีคาบว่างร่วม</div>') +
      warn.map(function (w) { return '<div class="tt-issue alert-warning"><span>⚠️</span><span>' + esc(w) + '</span></div>'; }).join('') +
      (canEdit ? '<div class="tt-form" style="margin-top:12px">' +
        '<div><label>ชื่อ</label><input class="form-control" data-f="label" maxlength="40" placeholder="เช่น ประชุม PLC" value="ประชุม PLC"></div>' +
        '<div class="flex" style="gap:8px"><div style="flex:1"><label>วัน</label><select class="form-control" data-f="day">' + [1, 2, 3, 4, 5].map(function (d) { return '<option value="' + d + '">' + TT.DAY_NAMES[d] + '</option>'; }).join('') + '</select></div>' +
          '<div style="flex:1"><label>คาบ</label><select class="form-control" data-f="period">' + tp.map(function (p) { return '<option value="' + esc(p.period_id) + '">' + esc(p.label) + '</option>'; }).join('') + '</select></div></div>' +
        '<div class="full"><label class="tt-chip"><input type="radio" name="tt-free-who" value="all" checked> ครูทุกคน</label> ' +
          '<label class="tt-chip"><input type="radio" name="tt-free-who" value="some"> เลือกครู</label>' +
          '<div class="tt-checks hidden" data-pick style="margin-top:8px">' + S().teachers.map(function (t) { return '<label class="tt-chip"><input type="checkbox" value="' + esc(t.teacher_id) + '"> ' + esc(TT.teacherName(t)) + '</label>'; }).join('') + '</div></div>' +
        '</div><button class="btn btn-primary mt-2" data-add><i class="bi bi-plus-lg"></i> เพิ่มคาบว่างร่วม</button>' : '');

    host.querySelectorAll('[data-del]').forEach(function (b) {
      b.onclick = function () { const l = list(); l.splice(Number(b.dataset.del), 1); save(l, 'ลบคาบว่างร่วมแล้ว'); };
    });
    if (!canEdit) return;
    host.querySelectorAll('[name=tt-free-who]').forEach(function (r) {
      r.onchange = function () { host.querySelector('[data-pick]').classList.toggle('hidden', r.value !== 'some' || !r.checked); };
    });
    host.querySelector('[data-add]').onclick = function () {
      const day = Number(host.querySelector('[data-f=day]').value), pid = host.querySelector('[data-f=period]').value;
      const some = host.querySelector('[name=tt-free-who]:checked').value === 'some';
      const teachers = some ? [].slice.call(host.querySelectorAll('[data-pick] input:checked')).map(function (c) { return c.value; }) : [];
      if (some && teachers.length < 2) { Toast.show('เลือกครูอย่างน้อย 2 คน (หรือเลือก "ครูทุกคน")', 'warning'); return; }
      const l = list();
      if (l.some(function (x) { return x.day === day && x.period_id === pid; })) { Toast.show('ช่องนี้มีคาบว่างร่วมอยู่แล้ว — ลบอันเดิมก่อนถ้าจะเปลี่ยนครู', 'warning'); return; }
      l.push({ label: host.querySelector('[data-f=label]').value.trim() || 'คาบว่างร่วม', day: day, period_id: pid, teachers: teachers });
      save(l, 'เพิ่มคาบว่างร่วมแล้ว — กดจัดตาราง AI ใหม่เพื่อใช้');
    };
  }

  async function save(items, msg) {
    try {
      const r = await api('tt.constraints_save', { config: { common_free: items } }, { loadingMsg: 'กำลังบันทึก...', noRetry: true });
      TT.S.config = r.config;
      Toast.show(msg, 'success');
      render();
    } catch (e) { /* toast แสดงแล้ว */ }
  }

  window.addEventListener('tt:loaded', render);
})();
