/**
 * วิชาการ › ท่องสูตรคูณ (multiplication.html) — ต้องเข้าสู่ระบบ (สิทธิ์ acad)
 *   ✅ บันทึก   : ตารางชั้น × แม่ 2–12 แตะช่อง = ท่องได้ · แตะชื่อ = โหมดท่องทีละคน (ปุ่มใหญ่ · เลื่อนคนถัดไป)
 *   📊 แดชบอร์ด : สถิติภาคที่เลือก · ร้อยละผ่านรายแม่ · ชั้น × แม่ · การกระจาย · รายชื่อที่ยังไม่ครบ · CSV
 *   📈 ทุกภาค   : ร้อยละท่องครบรายชั้นแต่ละภาคเรียน (ชั้น ณ ภาคนั้น)
 *   👤 รายคน    : ประวัติทุกภาคเรียนของนักเรียน 1 คน
 * ภาคปัจจุบันบันทึกได้ (acad_record) · ภาคที่ผ่านมาแก้ได้เฉพาะผู้ดูแล/ฝ่ายวิชาการ (acad_admin) · ยกเลิกเช็คไม่ลบประวัติ
 */
(function () {
  const esc = Utils.esc;
  const D = { term: '', current_term: '', terms: [], tables: [], can_record: false, students: [], records: [] };
  const V = { cls: Store.get('mult:cls') || '', tab: 'record', kg: false, person: '', summary: null };
  let rec = {};               // citizen_id → { แม่: { date, by } }
  let queue = Promise.resolve();

  function termLabel(t) { const p = String(t).split('-'); return 'ปีการศึกษา ' + p[0] + ' ภาคเรียนที่ ' + p[1] + (t === D.current_term ? ' (ปัจจุบัน)' : ''); }
  function cls(s) { return s.grade + (s.room && !(s.room === '1' && onlyRoom(s.grade)) ? '/' + s.room : ''); }
  const roomsOf = {};
  function onlyRoom(g) { return (roomsOf[g] || 0) <= 1; }
  function name(s) { return s.prefix + s.first_name + ' ' + s.last_name; }
  function isKg(g) { return /^อ\./.test(g); }
  function list() {
    return D.students.filter(function (s) { return (V.kg || !isKg(s.grade)) && (s.active || D.term !== D.current_term); });
  }
  function classes() {
    return list().map(cls).filter(function (c, i, a) { return a.indexOf(c) === i; })
      .sort(function (a, b) { return Utils.gradeSortKey(a) - Utils.gradeSortKey(b) || a.localeCompare(b); });
  }
  function inClass(c) {
    return list().filter(function (s) { return !c || cls(s) === c; })
      .sort(function (a, b) { return String(a.student_code).localeCompare(String(b.student_code), undefined, { numeric: true }) || a.first_name.localeCompare(b.first_name, 'th'); });
  }
  function passed(s) { const r = rec[s.citizen_id] || {}; return D.tables.filter(function (n) { return r[n]; }).length; }
  function pct(a, b) { return b ? Math.round(a / b * 100) : 0; }
  function step(p, n) { return !n ? 's0' : p === 0 ? 's0' : p < 25 ? 's1' : p < 50 ? 's2' : p < 75 ? 's3' : p < 100 ? 's4' : 's5'; }
  function fmtD(d) { return d ? Utils.fmtDateThai(d) : ''; }
  function downloadCsv(head, rows, fname) {
    const csv = '﻿' + [head].concat(rows).map(function (r) { return r.map(function (v) { const t = String(v == null ? '' : v); return /[",\n]/.test(t) ? '"' + t.replace(/"/g, '""') + '"' : t; }).join(','); }).join('\r\n');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    a.download = fname;
    document.body.appendChild(a); a.click(); setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  }

  async function load(term) {
    const d = await api('acad.mult_bootstrap', term ? { term: term } : {}, { loadingMsg: 'กำลังโหลด...' });
    Object.assign(D, d);
    rec = {};
    d.records.forEach(function (r) { (rec[r.citizen_id] || (rec[r.citizen_id] = {}))[r.table_no] = { date: r.passed_date, by: r.recorded_by }; });
    Object.keys(roomsOf).forEach(function (k) { delete roomsOf[k]; });
    const seen = {};
    D.students.forEach(function (s) { const k = s.grade + '|' + s.room; if (!seen[k]) { seen[k] = 1; roomsOf[s.grade] = (roomsOf[s.grade] || 0) + 1; } });
  }

  /* ════ แถบควบคุม ════ */
  function renderControls() {
    document.getElementById('mt-term').innerHTML = D.terms.map(function (t) { return '<option value="' + esc(t) + '"' + (t === D.term ? ' selected' : '') + '>' + esc(termLabel(t)) + '</option>'; }).join('');
    const cs = classes();
    if (V.cls && cs.indexOf(V.cls) < 0) V.cls = '';
    if (!V.cls && V.tab === 'record' && cs.length) V.cls = cs[0];
    document.getElementById('mt-class').innerHTML = '<option value="">ทุกชั้น</option>' + cs.map(function (c) {
      const l = inClass(c), full = l.filter(function (s) { return passed(s) === D.tables.length; }).length;
      return '<option value="' + esc(c) + '"' + (c === V.cls ? ' selected' : '') + '>' + esc(c) + ' — ครบ ' + full + '/' + l.length + ' คน</option>';
    }).join('');
    const past = D.term !== D.current_term;
    document.getElementById('mt-note').innerHTML = !past ? '' :
      '<div class="alert ' + (D.can_record ? 'alert-warning' : 'alert-info') + '" style="margin:10px 0 0;font-size:14px">🗂️ กำลังดู<strong>ภาคเรียนที่ผ่านมา</strong> — ' +
      (D.can_record ? 'คุณแก้ไขย้อนหลังได้ (ผู้ดูแล/ฝ่ายวิชาการ) โปรดระวัง' : 'ดูได้อย่างเดียว') + ' · ชั้นที่แสดงคือชั้นของนักเรียน ณ ภาคเรียนนั้น</div>';
    document.getElementById('mt-sub').textContent = termLabel(D.term);
  }

  /* ════ บันทึก ════ */
  /** ส่งบันทึกเป็นคิวทีละคำขอ · แสดงผลทันที (optimistic) · ไม่สำเร็จ → คืนค่าเดิม */
  function save(items, after) {
    const term = D.term, before = items.map(function (it) { const r = rec[it.citizen_id] || {}; return r[it.table_no] || null; });
    items.forEach(function (it) {
      const r = rec[it.citizen_id] || (rec[it.citizen_id] = {});
      if (it.passed) r[it.table_no] = { date: it.date || (r[it.table_no] && r[it.table_no].date) || today(), by: (TTAuth.user() || {}).display_name || '' };
      else delete r[it.table_no];
    });
    after();
    queue = queue.then(async function () {
      for (let i = 0; i < items.length; i += 20) {
        const r = await api('acad.mult_set_many', { term: term, items: items.slice(i, i + 20) }, { loading: false, noRetry: true });
        r.saved.forEach(function (x) { if (x.passed && rec[x.citizen_id] && rec[x.citizen_id][x.table_no]) rec[x.citizen_id][x.table_no].date = x.passed_date; });
      }
    }).catch(function () {
      items.forEach(function (it, i) { const r = rec[it.citizen_id] || (rec[it.citizen_id] = {}); if (before[i]) r[it.table_no] = before[i]; else delete r[it.table_no]; });
      after();
      Toast.show('บันทึกไม่สำเร็จ — คืนค่าเดิมแล้ว ลองอีกครั้ง', 'danger');
    });
  }
  function today() { const d = new Date(Date.now() + 7 * 3600 * 1000); return d.toISOString().slice(0, 10); }
  function toggle(s, no, after, date) {
    if (!D.can_record) { Toast.show('บัญชีนี้บันทึกภาคเรียนนี้ไม่ได้', 'warning'); return; }
    const has = !!(rec[s.citizen_id] || {})[no];
    if (has && !confirm('ยกเลิกการเช็ค แม่ ' + no + ' ของ ' + s.first_name + '?')) return;
    save([{ citizen_id: s.citizen_id, table_no: no, passed: !has, date: !has ? date : undefined }], after);
  }

  function cellHtml(s, no) {
    const r = (rec[s.citizen_id] || {})[no];
    return '<button class="mt-c' + (r ? ' ok' : '') + '" data-no="' + no + '"' + (D.can_record ? '' : ' disabled') +
      ' title="แม่ ' + no + (r ? ' · ท่องได้ ' + esc(fmtD(r.date)) + (r.by ? ' · ' + esc(r.by) : '') : ' · ยังไม่ผ่าน') + '" aria-pressed="' + (r ? 'true' : 'false') + '">' + (r ? '✓' : no) + '</button>';
  }
  function sumHtml(s) {
    const n = passed(s), all = D.tables.length;
    return '<div class="mt-sum' + (n === all ? ' full' : '') + '">' + (n === all ? '🏆 ' : '') + n + '/' + all + '<div class="mt-prog"><div style="width:' + pct(n, all) + '%"></div></div></div>';
  }
  function paneRecord() {
    const host = document.getElementById('mt-pane-record');
    if (!V.cls) { host.innerHTML = '<div class="text-muted">เลือกชั้นด้านบนเพื่อบันทึกการท่องสูตรคูณ</div>'; return; }
    const ss = inClass(V.cls);
    host.innerHTML = '<div class="mt-bar" style="justify-content:space-between;margin-bottom:8px"><h3 class="card-title" style="margin:0">ชั้น ' + esc(V.cls) + ' · ' + ss.length + ' คน</h3>' +
        '<span class="tt-note">' + (D.can_record ? 'แตะช่องเลขแม่เมื่อท่องได้ · แตะชื่อเพื่อท่องทีละคน (ปุ่มใหญ่)' : 'ดูได้อย่างเดียว') + '</span></div>' +
      (!ss.length ? '<div class="text-muted">ไม่มีนักเรียน</div>' :
      '<div class="mt-wrap"><table class="mt-grid"><thead><tr><th class="nm">ชื่อ</th>' + D.tables.map(function (n) { return '<th>แม่ ' + n + '</th>'; }).join('') + '<th>รวม</th></tr></thead><tbody>' +
      ss.map(function (s, i) {
        return '<tr data-cid="' + esc(s.citizen_id) + '"><td class="nm" data-open>' + (i + 1) + '. ' + esc(s.first_name + ' ' + s.last_name) + (s.active ? '' : ' <small>(ออกแล้ว)</small>') + '</td>' +
          D.tables.map(function (n) { return '<td>' + cellHtml(s, n) + '</td>'; }).join('') + '<td data-sum>' + sumHtml(s) + '</td></tr>';
      }).join('') + '</tbody></table></div>');
    host.querySelectorAll('tbody tr').forEach(function (tr) {
      const s = D.students.find(function (x) { return x.citizen_id === tr.dataset.cid; });
      const redraw = function () {
        tr.querySelectorAll('[data-no]').forEach(function (b) { b.parentNode.innerHTML = cellHtml(s, Number(b.dataset.no)); });
        tr.querySelector('[data-sum]').innerHTML = sumHtml(s);
        bindRow();
      };
      const bindRow = function () { tr.querySelectorAll('[data-no]').forEach(function (b) { b.onclick = function () { toggle(s, Number(b.dataset.no), redraw); }; }); };
      bindRow();
      tr.querySelector('[data-open]').onclick = function () { recite(ss, ss.indexOf(s)); };
    });
  }

  /** โหมดท่องทีละคน — ปุ่มใหญ่แตะง่าย · ระบุวันที่ได้ (ย้อนหลัง) · ไปคนก่อน/ถัดไป */
  function recite(ss, idx) {
    let date = today();
    const el = document.createElement('div');
    el.className = 'modal-backdrop show';
    document.body.appendChild(el);
    const close = function () { el.remove(); renderControls(); renderPane(); };
    function draw() {
      const s = ss[idx], r = rec[s.citizen_id] || {}, n = passed(s), all = D.tables.length;
      el.innerHTML = '<div class="modal wide"><div class="mt-bar" style="justify-content:space-between"><h3 class="modal-title" style="margin:0">' + esc(name(s)) + '</h3><span class="tt-note">' + esc(cls(s)) + ' · คนที่ ' + (idx + 1) + '/' + ss.length + '</span></div>' +
        '<div style="margin-top:6px;font-size:15px"><strong>' + (n === all ? '🏆 ท่องครบทุกแม่แล้ว' : 'ท่องได้ ' + n + '/' + all + ' แม่') + '</strong></div><div class="mt-prog"><div style="width:' + pct(n, all) + '%"></div></div>' +
        '<div class="mt-big">' + D.tables.map(function (no) {
          return '<button data-no="' + no + '" class="' + (r[no] ? 'ok' : '') + '"' + (D.can_record ? '' : ' disabled') + '>' + (r[no] ? '✓ ' : '') + 'แม่ ' + no + '<small>' + (r[no] ? esc(fmtD(r[no].date)) : 'ยังไม่ผ่าน') + '</small></button>';
        }).join('') + '</div>' +
        (D.can_record ? '<div class="mt-bar"><label class="tt-note" for="mt-date" style="margin:0">วันที่ท่อง</label><input type="date" class="form-control" id="mt-date" value="' + date + '" max="' + today() + '" style="max-width:180px">' +
          (n < all ? '<button class="btn btn-success" data-all><i class="bi bi-check2-all"></i> ท่องได้ทุกแม่ที่เหลือ</button>' : '') + '</div>' : '') +
        '<div class="mt-bar" style="justify-content:space-between;margin-top:14px"><button class="btn btn-secondary" data-prev' + (idx ? '' : ' disabled') + '>‹ คนก่อน</button>' +
        '<button class="btn btn-secondary" data-x>ปิด</button><button class="btn btn-primary" data-next' + (idx < ss.length - 1 ? '' : ' disabled') + '>คนถัดไป ›</button></div></div>';
      const di = el.querySelector('#mt-date');
      if (di) di.onchange = function () { date = di.value && di.value <= today() ? di.value : today(); };
      el.querySelectorAll('[data-no]').forEach(function (b) { b.onclick = function () { toggle(s, Number(b.dataset.no), draw, date); }; });
      const a = el.querySelector('[data-all]');
      if (a) a.onclick = function () {
        const items = D.tables.filter(function (no) { return !r[no]; }).map(function (no) { return { citizen_id: s.citizen_id, table_no: no, passed: true, date: date }; });
        if (confirm('บันทึกว่า ' + s.first_name + ' ท่องได้อีก ' + items.length + ' แม่ (รวมครบทุกแม่)?')) save(items, draw);
      };
      el.querySelector('[data-prev]').onclick = function () { idx--; draw(); };
      el.querySelector('[data-next]').onclick = function () { idx++; draw(); };
      el.querySelector('[data-x]').onclick = close;
    }
    el.onclick = function (e) { if (e.target === el) close(); };
    draw();
  }

  /* ════ แดชบอร์ด ════ */
  function paneDash() {
    const host = document.getElementById('mt-pane-dash');
    const ss = inClass(V.cls), all = D.tables.length;
    if (!ss.length) { host.innerHTML = '<div class="text-muted">ไม่มีนักเรียน</div>'; return; }
    const counts = ss.map(passed);
    const full = counts.filter(function (n) { return n === all; }).length, none = counts.filter(function (n) { return !n; }).length;
    const avg = counts.reduce(function (a, b) { return a + b; }, 0) / ss.length;
    const byTable = D.tables.map(function (no) { return ss.filter(function (s) { return (rec[s.citizen_id] || {})[no]; }).length; });
    const buckets = [['ยังไม่ผ่านเลย', 0, 0], ['1–3 แม่', 1, 3], ['4–6 แม่', 4, 6], ['7–10 แม่', 7, 10], ['ครบ 11 แม่', 11, 11]].map(function (b) {
      return { label: b[0], n: counts.filter(function (n) { return n >= b[1] && n <= b[2]; }).length };
    });
    const cs = V.cls ? [V.cls] : classes();
    const hbar = function (label, n, d, title, wide) {
      return '<div class="mt-hbar' + (wide ? ' wide' : '') + '" title="' + esc(title) + '"><span>' + esc(label) + '</span><div class="track"><div class="fill" style="width:' + pct(n, d) + '%"></div></div><span><strong>' + pct(n, d) + '%</strong> <span class="tt-note">' + n + '</span></span></div>';
    };
    const behind = ss.filter(function (s) { return passed(s) < all; }).sort(function (a, b) { return passed(a) - passed(b); });
    host.innerHTML = '<h3 class="card-title">📊 ' + esc(V.cls ? 'ชั้น ' + V.cls : 'ทุกชั้น') + ' · ' + esc(termLabel(D.term)) + '</h3>' +
      '<div class="mt-stats">' +
        stat('นักเรียน', ss.length, 'คน') + stat('ท่องครบ 11 แม่', full + ' คน', pct(full, ss.length) + '%') +
        stat('เฉลี่ยท่องได้', (Math.round(avg * 10) / 10) + ' แม่', 'ต่อคน') + stat('ยังไม่ผ่านเลย', none + ' คน', pct(none, ss.length) + '%') + '</div>' +
      '<div class="grid-2" style="display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:20px;margin-top:16px">' +
        '<div><h4 style="margin:0 0 6px">ร้อยละนักเรียนที่ท่องได้ รายแม่</h4>' + D.tables.map(function (no, i) { return hbar('แม่ ' + no, byTable[i], ss.length, 'แม่ ' + no + ': ท่องได้ ' + byTable[i] + ' จาก ' + ss.length + ' คน'); }).join('') + '</div>' +
        '<div><h4 style="margin:0 0 6px">จำนวนแม่ที่ท่องได้ต่อคน</h4>' + buckets.map(function (b) { return hbar(b.label, b.n, ss.length, b.label + ': ' + b.n + ' คน', true); }).join('') + '</div>' +
      '</div>' +
      (cs.length > 1 ? '<h4 style="margin:18px 0 6px">ชั้น × แม่ (ร้อยละที่ท่องได้)</h4><div style="overflow-x:auto"><table class="mt-heat"><thead><tr><th></th>' + D.tables.map(function (n) { return '<th>' + n + '</th>'; }).join('') + '<th>ครบ</th></tr></thead><tbody>' +
        cs.map(function (c) {
          const l = inClass(c), f = l.filter(function (s) { return passed(s) === all; }).length;
          return '<tr><td class="l">' + esc(c) + ' <span class="tt-note">(' + l.length + ')</span></td>' + D.tables.map(function (no) {
            const k = l.filter(function (s) { return (rec[s.citizen_id] || {})[no]; }).length, p = pct(k, l.length);
            return '<td class="' + step(p, l.length) + '" title="' + esc(c + ' แม่ ' + no + ': ' + k + '/' + l.length + ' คน') + '">' + p + '</td>';
          }).join('') + '<td class="' + step(pct(f, l.length), l.length) + '" title="' + esc(c + ' ท่องครบ ' + f + '/' + l.length + ' คน') + '">' + pct(f, l.length) + '</td></tr>';
        }).join('') + '</tbody></table></div>' +
        '<div class="mt-key">น้อย <span class="sw" style="background:var(--mt-s0)"></span><span class="sw" style="background:var(--mt-s1)"></span><span class="sw" style="background:var(--mt-s2)"></span><span class="sw" style="background:var(--mt-s3)"></span><span class="sw" style="background:var(--mt-s4)"></span><span class="sw" style="background:var(--mt-s5)"></span> 100%</div>' : '') +
      '<h4 style="margin:18px 0 6px">ยังท่องไม่ครบ (' + behind.length + ' คน)</h4>' +
      (behind.length ? '<div class="table-wrap"><table class="tt-results"><thead><tr><th>ชื่อ</th><th>ชั้น</th><th>ได้</th><th>แม่ที่ยังไม่ผ่าน</th></tr></thead><tbody>' +
        behind.map(function (s) {
          const r = rec[s.citizen_id] || {};
          return '<tr><td>' + esc(name(s)) + '</td><td>' + esc(cls(s)) + '</td><td>' + passed(s) + '/' + all + '</td><td>' + D.tables.filter(function (n) { return !r[n]; }).map(function (n) { return '<span class="mt-miss">' + n + '</span>'; }).join('') + '</td></tr>';
        }).join('') + '</tbody></table></div>' : '<div class="text-muted">🎉 ทุกคนท่องครบแล้ว</div>') +
      '<button class="btn btn-secondary mt-2" data-csv><i class="bi bi-filetype-csv"></i> ส่งออก CSV (รายคน)</button>';
    host.querySelector('[data-csv]').onclick = function () {
      downloadCsv(['ภาคเรียน', 'ชั้น', 'รหัส', 'ชื่อ-สกุล'].concat(D.tables.map(function (n) { return 'แม่ ' + n; })).concat(['รวม (แม่)', 'ครบ']),
        ss.map(function (s) {
          const r = rec[s.citizen_id] || {};
          return [D.term, cls(s), s.student_code, name(s)].concat(D.tables.map(function (n) { return r[n] ? r[n].date : ''; })).concat([passed(s), passed(s) === all ? 'ครบ' : '']);
        }), 'multiplication_' + D.term + '_' + (V.cls || 'all').replace(/\//g, '-') + '.csv');
    };
    function stat(l, v, sub) { return '<div class="stat"><div class="label">' + l + '</div><div class="value">' + v + '</div><div class="tt-note">' + sub + '</div></div>'; }
  }

  /* ════ ทุกภาคเรียน ════ */
  async function paneTrend() {
    const host = document.getElementById('mt-pane-trend');
    if (!V.summary) {
      host.innerHTML = '<div class="text-muted">กำลังโหลด...</div>';
      try { V.summary = await api('acad.mult_summary', {}, { loading: false }); } catch (e) { host.innerHTML = '<div class="text-muted">โหลดไม่สำเร็จ</div>'; return; }
    }
    const S = V.summary, rows = S.rows.filter(function (r) { return V.kg || !isKg(r.grade); });
    const terms = rows.map(function (r) { return r.term; }).filter(function (t, i, a) { return a.indexOf(t) === i; }).sort();
    const label = function (r) { return r.grade + (r.room && r.room !== '1' ? '/' + r.room : ''); };
    const gs = rows.map(label).filter(function (g, i, a) { return a.indexOf(g) === i; }).sort(function (a, b) { return Utils.gradeSortKey(a) - Utils.gradeSortKey(b) || a.localeCompare(b); });
    const cell = function (list) {
      const n = list.reduce(function (a, r) { return a + r.students; }, 0), f = list.reduce(function (a, r) { return a + r.complete; }, 0), ps = list.reduce(function (a, r) { return a + r.passes; }, 0);
      if (!n) return '<td class="s0" style="opacity:.4">–</td>';
      const p = pct(f, n);
      return '<td class="' + step(p, n) + '" title="ท่องครบ ' + f + '/' + n + ' คน · เฉลี่ย ' + (Math.round(ps / n * 10) / 10) + ' แม่/คน">' + p + '</td>';
    };
    host.innerHTML = '<h3 class="card-title">📈 ร้อยละนักเรียนที่ท่องครบ 11 แม่ — ทุกภาคเรียน</h3>' +
      '<p class="tt-note" style="margin-top:-6px">ชั้นคือชั้นของนักเรียน ณ ภาคเรียนนั้น (เลื่อนชั้นแล้วผลภาคเก่ายังอยู่ที่ชั้นเดิม) · ชี้ที่ช่องเพื่อดูจำนวนคนและค่าเฉลี่ย</p>' +
      (!terms.length ? '<div class="text-muted">ยังไม่มีข้อมูล</div>' :
      '<div style="overflow-x:auto"><table class="mt-heat"><thead><tr><th></th>' + terms.map(function (t) { const p = t.split('-'); return '<th>' + p[1] + '/' + p[0] + '</th>'; }).join('') + '</tr></thead><tbody>' +
        gs.map(function (g) { return '<tr><td class="l">' + esc(g) + '</td>' + terms.map(function (t) { return cell(rows.filter(function (r) { return r.term === t && label(r) === g; })); }).join('') + '</tr>'; }).join('') +
        '<tr><td class="l">ทั้งโรงเรียน</td>' + terms.map(function (t) { return cell(rows.filter(function (r) { return r.term === t; })); }).join('') + '</tr>' +
      '</tbody></table></div>' +
      '<div class="mt-key">0% <span class="sw" style="background:var(--mt-s0)"></span><span class="sw" style="background:var(--mt-s1)"></span><span class="sw" style="background:var(--mt-s2)"></span><span class="sw" style="background:var(--mt-s3)"></span><span class="sw" style="background:var(--mt-s4)"></span><span class="sw" style="background:var(--mt-s5)"></span> 100%</div>' +
      '<button class="btn btn-secondary mt-2" data-csv><i class="bi bi-filetype-csv"></i> ส่งออก CSV</button>');
    const b = host.querySelector('[data-csv]');
    if (b) b.onclick = function () {
      downloadCsv(['ภาคเรียน', 'ชั้น', 'นักเรียน', 'ท่องครบ', 'ร้อยละท่องครบ', 'ยังไม่ผ่านเลย', 'เฉลี่ยแม่/คน'],
        rows.slice().sort(function (a, b) { return a.term.localeCompare(b.term) || Utils.gradeSortKey(a.grade) - Utils.gradeSortKey(b.grade); })
          .map(function (r) { return [r.term, label(r), r.students, r.complete, pct(r.complete, r.students), r.none, r.students ? (r.passes / r.students).toFixed(1) : '']; }), 'multiplication_all_terms.csv');
    };
  }

  /* ════ รายคน ════ */
  async function panePerson() {
    const host = document.getElementById('mt-pane-person');
    const opts = inClass(V.cls);
    host.innerHTML = '<h3 class="card-title">👤 ประวัติการท่องรายคน (ทุกภาคเรียน)</h3><div class="mt-bar"><select class="form-control" data-p><option value="">— เลือกนักเรียน' + (V.cls ? ' ชั้น ' + esc(V.cls) : '') + ' —</option>' +
      opts.map(function (s) { return '<option value="' + esc(s.citizen_id) + '"' + (s.citizen_id === V.person ? ' selected' : '') + '>' + esc(cls(s) + ' · ' + name(s)) + '</option>'; }).join('') + '</select></div><div data-out style="margin-top:12px"></div>';
    host.querySelector('[data-p]').onchange = function () { V.person = this.value; panePerson(); };
    if (!V.person) return;
    const out = host.querySelector('[data-out]');
    out.innerHTML = '<div class="text-muted">กำลังโหลด...</div>';
    let d;
    try { d = await api('acad.mult_student', { citizen_id: V.person }, { loading: false }); } catch (e) { out.innerHTML = ''; return; }
    const by = {};
    d.records.forEach(function (r) { (by[r.term] || (by[r.term] = {}))[r.table_no] = r; });
    const terms = d.terms.slice();
    Object.keys(by).forEach(function (t) { if (!terms.some(function (x) { return x.term === t; })) terms.push({ term: t, grade: '', room: '' }); });
    terms.sort(function (a, b) { return a.term < b.term ? -1 : 1; });
    out.innerHTML = '<div style="font-size:16px;margin-bottom:8px"><strong>' + esc(name(d.student)) + '</strong> <span class="tt-note">ชั้นปัจจุบัน ' + esc(d.student.grade + (d.student.room && d.student.room !== '1' ? '/' + d.student.room : '')) + '</span></div>' +
      (!terms.length ? '<div class="text-muted">ยังไม่มีข้อมูล</div>' : '<div class="mt-wrap"><table class="mt-grid"><thead><tr><th class="nm">ภาคเรียน (ชั้น)</th>' + D.tables.map(function (n) { return '<th>แม่ ' + n + '</th>'; }).join('') + '<th>รวม</th></tr></thead><tbody>' +
        terms.map(function (t) {
          const r = by[t.term] || {}, n = D.tables.filter(function (no) { return r[no]; }).length, p = t.term.split('-');
          return '<tr><td class="nm" style="cursor:default">' + p[1] + '/' + p[0] + (t.grade ? ' <small>(' + esc(t.grade + (t.room && t.room !== '1' ? '/' + t.room : '')) + ')</small>' : '') + '</td>' +
            D.tables.map(function (no) { return '<td><span class="mt-c' + (r[no] ? ' ok' : '') + '" style="display:inline-block;line-height:40px" title="' + (r[no] ? esc(fmtD(r[no].passed_date) + (r[no].recorded_by ? ' · ' + r[no].recorded_by : '')) : 'ยังไม่ผ่าน') + '">' + (r[no] ? '✓' : '·') + '</span></td>'; }).join('') +
            '<td><div class="mt-sum' + (n === D.tables.length ? ' full' : '') + '">' + n + '/' + D.tables.length + '</div></td></tr>';
        }).join('') + '</tbody></table></div><p class="tt-note" style="margin-top:6px">ชี้ที่ ✓ เพื่อดูวันที่ท่องผ่านและผู้บันทึก</p>');
  }

  function renderPane() {
    document.querySelectorAll('#mt-tabs .tab').forEach(function (t) { t.classList.toggle('active', t.dataset.tab === V.tab); });
    document.querySelectorAll('.mt-pane').forEach(function (p) { p.classList.toggle('hidden', p.id !== 'mt-pane-' + V.tab); });
    ({ record: paneRecord, dash: paneDash, trend: paneTrend, person: panePerson })[V.tab]();
  }

  document.getElementById('mt-term').onchange = async function () {
    try { await load(this.value); renderControls(); renderPane(); } catch (e) { /* toast */ }
  };
  document.getElementById('mt-class').onchange = function () { V.cls = this.value; V.person = ''; try { Store.set('mult:cls', V.cls); } catch (e) { /* ignore */ } renderPane(); };
  document.getElementById('mt-kg').onchange = function () { V.kg = this.checked; renderControls(); renderPane(); };
  document.querySelectorAll('#mt-tabs .tab').forEach(function (t) {
    t.onclick = function () {
      V.tab = t.dataset.tab;
      if (V.tab === 'record' && !V.cls) renderControls();
      if (V.tab === 'trend') V.summary = null;   // ดึงสรุปใหม่ทุกครั้งที่เปิด (รวมผลที่เพิ่งบันทึก)
      renderPane();
    };
  });

  TTAuth.require({ caps: ['acad'] }).then(async function () {
    try { await load(); renderControls(); renderPane(); }
    catch (e) { document.getElementById('mt-pane-record').innerHTML = '<div class="alert alert-warning">' + esc(e.message || 'โหลดไม่สำเร็จ') + '</div>'; }
  });
})();
