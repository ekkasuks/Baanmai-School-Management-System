/**
 * หน้าดูตารางเรียน / ตารางสอน (เฟส 6) — สำหรับนักเรียน · ผู้ปกครอง · ครู
 *   แสดงเฉพาะฉบับ "เผยแพร่แล้ว" (tt.public_view) · ไม่ต้องเข้าสู่ระบบ (ถ้าผู้ดูแลเปิดไว้)
 *   บัญชีที่ผูกครู/ชั้นเรียน → เปิดตารางของตัวเองอัตโนมัติ · ลิงก์ ?class= / ?teacher= ส่งต่อได้
 *   เน้นวันนี้และคาบปัจจุบัน · จอมือถือแสดงเป็นรายการรายวัน · พิมพ์ได้
 */
(function () {
  const esc = Utils.esc;
  const DAYS = ['', 'จันทร์', 'อังคาร', 'พุธ', 'พฤหัสบดี', 'ศุกร์'];
  const TYPES = { core: ['วิชาพื้นฐาน', '#90CAF9'], elective: ['วิชาเพิ่มเติม', '#CE93D8'], activity: ['กิจกรรม', '#A5D6A7'], practical: ['วิชาปฏิบัติ', '#FFCC80'] };
  const V = { d: null, mode: 'class', key: '' };
  const out = document.getElementById('tv-out');

  function by(list, pk) { const m = {}; (list || []).forEach(function (x) { m[x[pk]] = x; }); return m; }
  function tName(t) { return t ? (t.title || '') + t.name : ''; }
  function short(n) { return String(n || '').replace(/\s*\(ป\.[^)]*\)$/, ''); }
  function shortT(t) { return t ? String(t.name || '').split(/\s+/)[0] : ''; }
  function periods() { return V.d.periods.slice().sort(function (a, b) { return (a.seq || 0) - (b.seq || 0); }); }
  function nowInfo() {   // วัน (1–5) และเวลา HH:MM ตามเวลาไทย
    const b = new Date(Date.now() + 7 * 3600 * 1000);
    return { day: b.getUTCDay(), hm: b.toISOString().slice(11, 16) };
  }

  async function load() {
    try {
      V.d = await api('tt.public_view', {}, { loadingMsg: 'กำลังโหลดตาราง...', silent: true });
    } catch (e) {
      if (e.code === 'AUTH_REQUIRED') {
        out.innerHTML = '<div class="alert alert-info">ต้องเข้าสู่ระบบเพื่อดูตาราง</div>';
        await TTAuth.require({});
        return load();
      }
      out.innerHTML = '<div class="alert alert-danger">' + esc(e.message) + '</div>';
      return;
    }
    const d = V.d;
    document.getElementById('tv-sub').textContent = [d.school, TTi18n.t(d.term || '')].filter(Boolean).join(' · ');
    if (!d.version) { out.innerHTML = '<div class="alert alert-info">ยังไม่มีตารางที่เผยแพร่</div>'; document.querySelector('.tv-controls').classList.add('hidden'); return; }
    // ค่าเริ่มต้น: ลิงก์ → บัญชีที่ผูกไว้ → ชั้นแรก
    const q = new URLSearchParams(location.search);
    const me = d.me;
    const mineBtn = document.querySelector('[data-mine]');
    if (me && (me.teacher_id || me.class_id)) {
      mineBtn.classList.remove('hidden');
      mineBtn.onclick = function () { if (me.teacher_id) setMode('teacher', me.teacher_id); else setMode('class', unitOf(me.class_id)); };
    }
    if (q.get('teacher')) setMode('teacher', q.get('teacher'));
    else if (q.get('class')) setMode('class', unitOf(q.get('class')) || q.get('class'));
    else if (me && me.teacher_id) setMode('teacher', me.teacher_id);
    else if (me && me.class_id) setMode('class', unitOf(me.class_id));
    else setMode('class', '');
  }
  function unitOf(classId) { const u = V.d.units.find(function (x) { return x.class_ids.indexOf(classId) >= 0 || x.unit_id === classId; }); return u ? u.unit_id : ''; }

  function options() {
    const d = V.d;
    if (V.mode === 'class') {
      const used = {};
      d.slots.forEach(function (s) { used[s.class_id] = 1; });
      return d.units.filter(function (u) { return u.class_ids.some(function (c) { return used[c]; }); }).map(function (u) { return [u.unit_id, u.label + (u.combined ? ' (ควบชั้น)' : '')]; });
    }
    const used = {};
    d.slots.forEach(function (s) { if (s.teacher_id) used[s.teacher_id] = 1; });
    return d.teachers.filter(function (t) { return used[t.teacher_id]; }).map(function (t) { return [t.teacher_id, tName(t)]; });
  }

  function setMode(mode, key) {
    V.mode = mode;
    document.querySelectorAll('[data-mode]').forEach(function (b) { b.classList.toggle('active', b.dataset.mode === mode); });
    const opts = options();
    V.key = opts.some(function (o) { return o[0] === key; }) ? key : (opts[0] ? opts[0][0] : '');
    const sel = document.getElementById('tv-key');
    sel.innerHTML = opts.length ? opts.map(function (o) { return '<option value="' + esc(o[0]) + '">' + esc(o[1]) + '</option>'; }).join('') : '<option value="">-</option>';
    sel.value = V.key;
    const url = new URL(location.href);
    url.searchParams.delete('class'); url.searchParams.delete('teacher');
    if (V.key) url.searchParams.set(mode === 'class' ? 'class' : 'teacher', V.key);
    history.replaceState(null, '', url);
    draw();
  }

  /** ช่องของตาราง: key 'day|period_id' → { s, sub } */
  function cells() {
    const d = V.d, S = by(d.subjects, 'subject_id'), T = by(d.teachers, 'teacher_id'), R = by(d.rooms, 'room_id');
    const out = {};
    if (V.mode === 'class') {
      const u = d.units.find(function (x) { return x.unit_id === V.key; });
      if (!u) return out;
      d.slots.forEach(function (s) {
        if (u.class_ids.indexOf(s.class_id) < 0) return;
        const k = s.day + '|' + s.period_id;
        if (out[k]) return;
        out[k] = { s: S[s.subject_id], sub: [s.teacher_id ? 'ครู' + shortT(T[s.teacher_id]) : '', s.room_id && R[s.room_id] ? R[s.room_id].name : ''].filter(Boolean).join(' · ') };
      });
    } else {
      const lab = {};
      d.units.forEach(function (u) { u.class_ids.forEach(function (c) { lab[c] = u; }); });
      d.slots.forEach(function (s) {
        if (s.teacher_id !== V.key) return;
        const k = s.day + '|' + s.period_id;
        const u = lab[s.class_id];
        if (!out[k]) out[k] = { s: S[s.subject_id], units: [], room: s.room_id && R[s.room_id] ? R[s.room_id].name : '' };
        if (u && out[k].units.indexOf(u.label) < 0) out[k].units.push(u.label);
      });
      Object.keys(out).forEach(function (k) { out[k].sub = out[k].units.join(', ') + (out[k].room ? ' · ' + out[k].room : ''); });
    }
    return out;
  }

  function draw() {
    const d = V.d;
    if (!V.key) { out.innerHTML = '<div class="text-muted">ตารางนี้ยังไม่มีคาบ</div>'; return; }
    const ps = periods(), c = cells(), now = nowInfo();
    const isNow = function (day, p) { return day === now.day && p.start_time && p.end_time && now.hm >= p.start_time && now.hm < p.end_time; };
    const title = V.mode === 'class'
      ? 'ตารางเรียน ชั้น ' + (d.units.find(function (u) { return u.unit_id === V.key; }) || {}).label
      : 'ตารางสอน ' + tName(d.teachers.find(function (t) { return t.teacher_id === V.key; }));
    const count = Object.keys(c).length;
    const cellHtml = function (x) {
      if (!x) return '';
      const ty = (x.s && x.s.type) || 'core';
      return '<div class="tv-cell ' + esc(ty) + '"><div class="s">' + esc(short(x.s ? x.s.name : '?')) + '</div>' + (x.sub ? '<div class="x">' + esc(x.sub) + '</div>' : '') + '</div>';
    };
    const grid = '<div class="table-wrap tv-grid"><table class="tv-table"><thead><tr><th>วัน</th>' +
      ps.map(function (p) { return '<th>' + esc(p.label) + '<br><span class="tt-note">' + esc((p.start_time || '') + (p.end_time ? '–' + p.end_time : '')) + '</span></th>'; }).join('') +
      '</tr></thead><tbody>' + [1, 2, 3, 4, 5].map(function (day) {
        return '<tr' + (day === now.day ? ' class="today"' : '') + '><th>' + DAYS[day] + '</th>' + ps.map(function (p) {
          if (String(p.is_break) === '1') return '<td class="brk">' + esc(p.label) + '</td>';
          return '<td' + (isNow(day, p) ? ' class="now"' : '') + '>' + cellHtml(c[day + '|' + p.period_id]) + '</td>';
        }).join('') + '</tr>';
      }).join('') + '</tbody></table></div>';
    // มือถือ: รายการรายวัน (เริ่มจากวันนี้)
    const order = [1, 2, 3, 4, 5].sort(function (a, b) { return ((a - now.day + 7) % 7) - ((b - now.day + 7) % 7); });
    const days = '<div class="tv-days">' + order.map(function (day) {
      const rows = ps.map(function (p) {
        const x = c[day + '|' + p.period_id];
        if (String(p.is_break) === '1') return '<div class="tv-row"><div class="tm">' + esc((p.start_time || '') + '–' + (p.end_time || '')) + '</div><div class="tv-cell" style="background:transparent;color:var(--muted)">' + esc(p.label) + '</div></div>';
        if (!x) return '';
        return '<div class="tv-row' + (isNow(day, p) ? ' now' : '') + '"><div class="tm">' + esc(p.label) + '<br>' + esc((p.start_time || '') + '–' + (p.end_time || '')) + '</div>' + cellHtml(x) + '</div>';
      }).join('');
      return '<div class="tv-day' + (day === now.day ? ' today' : '') + '"><h4>' + DAYS[day] + (day === now.day ? ' <span class="tv-now">วันนี้</span>' : '') + '</h4>' + (rows || '<div class="tt-note">-</div>') + '</div>';
    }).join('') + '</div>';
    const t = TTi18n.t;
    const when = TTi18n.lang() === 'en' ? new Date(d.version.updated_at).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' }) : Utils.fmtDateTime(d.version.updated_at);
    out.innerHTML = '<div class="tv-head"><div class="t">' + esc(title) + '</div><div class="tt-note">' +
      [t(count + ' คาบ/สัปดาห์'), t('ฉบับ "' + d.version.label + '"'), t('ปรับปรุงล่าสุด ' + when)].map(esc).join(' · ') + '</div></div>' +
      grid + days +
      '<div class="tv-legend">' + Object.keys(TYPES).map(function (k) { return '<span style="--c:' + TYPES[k][1] + '">' + TYPES[k][0] + '</span>'; }).join('') + '</div>';
  }

  document.querySelectorAll('[data-mode]').forEach(function (b) { b.onclick = function () { setMode(b.dataset.mode, ''); }; });
  document.getElementById('tv-key').onchange = function () { setMode(V.mode, this.value); };
  document.getElementById('tv-print').onclick = function () {
    const theme = document.documentElement.getAttribute('data-theme');
    document.documentElement.setAttribute('data-theme', 'light');
    window.print();
    document.documentElement.setAttribute('data-theme', theme || 'light');
  };
  document.getElementById('tv-link').onclick = async function () {
    try { await navigator.clipboard.writeText(location.href); Toast.show(TTi18n.t('คัดลอกลิงก์แล้ว'), 'success'); }
    catch (e) { prompt('Link', location.href); }
  };
  // อัปเดตไฮไลต์ "ตอนนี้" ทุกนาที
  setInterval(function () { if (V.d && V.d.version && document.visibilityState === 'visible') draw(); }, 60000);

  TTAuth.peek().then(load);
})();
