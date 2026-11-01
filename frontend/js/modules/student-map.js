/**
 * หน้าแผนที่บ้านนักเรียน (map.html) — ต้องเข้าสู่ระบบ (สิทธิ์ geo)
 *   เลือกดูรายชั้น/รายคน · หมุดสีตามชั้น · วงรัศมีจากโรงเรียน · กดหมุด = ข้อมูล + ระยะทาง + เวลาเดิน/จักรยานยนต์/รถยนต์ (ประมาณ / ตามถนนจริง)
 *   ผู้ที่มีสิทธิ์ geo_edit ปักหมุด/แก้พิกัดได้ · ผู้ดูแล (geo_admin) ตั้งพิกัดโรงเรียนและความเร็วเฉลี่ย · ส่งออก CSV (ไม่มีพิกัด)
 */
(function () {
  const esc = Utils.esc;
  const COLORS = ['#E53935', '#FB8C00', '#FDD835', '#43A047', '#00ACC1', '#1E88E5', '#8E24AA', '#6D4C41', '#546E7A'];
  const D = { students: [], school: null, speeds: null };
  let map = null, layer = null, rings = null, schoolMarker = null, markers = {}, filter = '', focus = '';

  function name(s) { return s.prefix + s.first_name + ' ' + s.last_name; }
  function cls(s) { return s.grade + (s.room ? '/' + s.room : ''); }
  function grades() { return D.students.map(cls).filter(function (g, i, a) { return a.indexOf(g) === i; }).sort(function (a, b) { return Utils.gradeSortKey(a) - Utils.gradeSortKey(b) || a.localeCompare(b); }); }
  function color(s) { const gs = grades(); return COLORS[gs.indexOf(cls(s)) % COLORS.length]; }
  function shown() { return D.students.filter(function (s) { return !filter || cls(s) === filter; }); }
  function est(s) { return D.school && s.home ? GeoUtil.estimate(D.school, s.home, D.speeds) : null; }

  async function load() {
    const d = await api('geo.bootstrap', {}, { loadingMsg: 'กำลังโหลดแผนที่...' });
    D.students = d.students; D.school = d.school; D.speeds = d.speeds;
    document.getElementById('gm-sub').textContent = (D.school && D.school.name ? D.school.name + ' · ' : '') + 'เฉพาะบุคลากร';
  }

  function initMap() {
    map = L.map('gm-map');
    GeoUtil.addLayers(map, 'street');
    layer = L.layerGroup().addTo(map);
    rings = L.layerGroup().addTo(map);
  }

  function renderControls() {
    const sel = document.getElementById('gm-class');
    sel.innerHTML = '<option value="">ทุกชั้น (' + D.students.length + ' คน)</option>' + grades().map(function (g) {
      const n = D.students.filter(function (s) { return cls(s) === g; }), h = n.filter(function (s) { return s.home; }).length;
      return '<option value="' + esc(g) + '"' + (g === filter ? ' selected' : '') + '>' + esc(g) + ' — มีพิกัด ' + h + '/' + n.length + '</option>';
    }).join('');
    document.getElementById('gm-names').innerHTML = D.students.map(function (s) { return '<option value="' + esc(name(s) + ' (' + cls(s) + ')') + '">'; }).join('');
    const adm = document.getElementById('gm-admin');
    adm.innerHTML = TTAuth.can('geo_admin') ? '<button class="btn btn-secondary" data-school><i class="bi bi-building"></i> ' + (D.school ? 'แก้พิกัดโรงเรียน' : 'ตั้งพิกัดโรงเรียน') + '</button>' +
      '<button class="btn btn-secondary" data-speeds><i class="bi bi-speedometer2"></i> ความเร็วเฉลี่ยสำหรับประมาณเวลา</button>' : '';
    const sb = adm.querySelector('[data-school]');
    if (sb) sb.onclick = function () { GeoPicker.open({ mode: 'school', onSaved: refresh }); };
    const spb = adm.querySelector('[data-speeds]');
    if (spb) spb.onclick = editSpeeds;
    document.getElementById('gm-noschool').innerHTML = D.school ? '' : '<div class="alert alert-warning" style="margin-top:10px">🏫 ยังไม่ได้ตั้งพิกัดโรงเรียน — ระยะทางและเวลาเดินทางจะคำนวณได้หลังตั้งพิกัด' + (TTAuth.can('geo_admin') ? ' (กดปุ่ม "ตั้งพิกัดโรงเรียน")' : ' (แจ้งผู้ดูแลระบบ)') + '</div>';
    const leg = document.getElementById('gm-legend');
    leg.innerHTML = grades().map(function (g, i) { return '<span><span class="gm-dot" style="background:' + COLORS[i % COLORS.length] + '"></span>' + esc(g) + '</span>'; }).join('') + '<span>🏫 โรงเรียน</span>';
  }

  function renderStats() {
    const list = shown(), withH = list.filter(function (s) { return s.home; });
    const es = withH.map(est).filter(Boolean);
    const avg = es.length ? es.reduce(function (a, e) { return a + e.road; }, 0) / es.length : 0;
    const far = es.length ? Math.max.apply(null, es.map(function (e) { return e.road; })) : 0;
    document.getElementById('gm-stats').innerHTML =
      stat('มีพิกัดแล้ว', withH.length + '/' + list.length, list.length ? Math.round(withH.length / list.length * 100) + '%' : '') +
      stat('ระยะเฉลี่ย (ประมาณ)', es.length ? GeoUtil.fmtKm(avg) : '-', '') +
      stat('ไกลสุด', es.length ? GeoUtil.fmtKm(far) : '-', '') +
      stat('ยังไม่มีพิกัด', String(list.length - withH.length), 'คน');
    const band = [0, 0, 0, 0];
    es.forEach(function (e) { band[e.road < 1 ? 0 : e.road < 3 ? 1 : e.road < 5 ? 2 : 3]++; });
    document.getElementById('gm-band').innerHTML = es.length ? '<span>ไม่เกิน 1 กม.: ' + band[0] + '</span><span>1–3 กม.: ' + band[1] + '</span><span>3–5 กม.: ' + band[2] + '</span><span>เกิน 5 กม.: ' + band[3] + '</span>' : '';
    function stat(l, v, sub) { return '<div class="stat"><div class="label">' + l + '</div><div class="value">' + v + '</div>' + (sub ? '<div class="tt-note">' + sub + '</div>' : '') + '</div>'; }
  }

  function popupHtml(s) {
    const e = est(s);
    return '<div class="gp-name">' + esc(name(s)) + '</div><div class="tt-note">ชั้น ' + esc(cls(s)) + (s.student_code ? ' · รหัส ' + esc(s.student_code) : '') + '</div>' +
      (s.guardian_name || s.guardian_phone ? '<div>👪 ' + esc(s.guardian_name || '-') + (s.guardian_phone ? ' · <a href="tel:' + esc(s.guardian_phone) + '">' + esc(s.guardian_phone) + '</a>' : '') + '</div>' : '') +
      (s.home.note ? '<div>📝 ' + esc(s.home.note) + '</div>' : '') +
      (e ? '<div style="margin-top:6px"><strong>ไปโรงเรียน (ประมาณ ~' + GeoUtil.fmtKm(e.road) + ')</strong></div>' +
        '<div class="gp-row"><span>🚶 ' + GeoUtil.fmtMin(e.walk) + '</span><span>🛵 ' + GeoUtil.fmtMin(e.moto) + '</span><span>🚗 ' + GeoUtil.fmtMin(e.car) + '</span></div>' +
        '<div data-route></div><button class="btn btn-secondary" data-act="route">🛣️ ตามถนนจริง</button>' +
        '<a class="btn btn-secondary" target="_blank" rel="noopener" href="https://www.google.com/maps/dir/?api=1&origin=' + s.home.lat + ',' + s.home.lng + '&destination=' + D.school.lat + ',' + D.school.lng + '">🧭 นำทาง</a>'
        : '<div class="tt-note">ตั้งพิกัดโรงเรียนก่อนจึงคำนวณระยะทางได้</div>') +
      (TTAuth.can('geo_edit') ? '<button class="btn btn-primary" data-act="edit">✏️ แก้พิกัด</button>' : '') +
      '<div class="tt-note">' + (s.home.source === 'gps' ? 'จาก GPS' + (s.home.accuracy ? ' ±' + s.home.accuracy + ' ม.' : '') : s.home.source === 'manual' ? 'ใส่พิกัดเอง' : 'ปักบนแผนที่') + ' · ' + esc(s.home.updated_by || '') + '</div>';
  }

  function renderMap(fit) {
    layer.clearLayers(); rings.clearLayers(); markers = {};
    if (schoolMarker) { map.removeLayer(schoolMarker); schoolMarker = null; }
    const pts = [];
    if (D.school) {
      schoolMarker = L.marker([D.school.lat, D.school.lng], { icon: GeoUtil.schoolIcon(), zIndexOffset: 1000 }).addTo(map).bindPopup('<div class="gp-name">🏫 ' + esc(D.school.name || 'โรงเรียน') + '</div>');
      pts.push([D.school.lat, D.school.lng]);
      if (document.getElementById('gm-rings').checked) [1, 3, 5].forEach(function (r) {
        L.circle([D.school.lat, D.school.lng], { radius: r * 1000, color: '#0288D1', weight: 1, dashArray: '4 6', fill: false, interactive: false }).addTo(rings);
      });
    }
    const labels = document.getElementById('gm-labels').checked;
    shown().forEach(function (s) {
      if (!s.home) return;
      const m = L.circleMarker([s.home.lat, s.home.lng], { radius: s.citizen_id === focus ? 10 : 7, color: '#fff', weight: 2, fillColor: color(s), fillOpacity: 0.95 }).addTo(layer);
      if (labels) m.bindTooltip(s.first_name, { permanent: true, direction: 'top', offset: [0, -6], className: 'gp-label' });
      m.bindPopup(function () { return popupHtml(s); });
      m.on('popupopen', function (ev) { bindPopup(ev.popup.getElement(), s); });
      markers[s.citizen_id] = m;
      pts.push([s.home.lat, s.home.lng]);
    });
    if (fit) {
      if (pts.length > 1) map.fitBounds(pts, { padding: [30, 30], maxZoom: 16 });
      else if (pts.length === 1) map.setView(pts[0], 15);
      else map.setView([13.0, 101.0], 6);
    }
  }

  function bindPopup(root, s) {
    const r = root.querySelector('[data-act=route]');
    if (r) r.onclick = async function () {
      r.disabled = true; r.textContent = 'กำลังคำนวณ...';
      try {
        const x = await GeoUtil.route(s.home, D.school, D.speeds);
        root.querySelector('[data-route]').innerHTML = '<div style="margin-top:4px"><strong>ตามถนนจริง</strong> ~' + GeoUtil.fmtKm(x.car_km) + '</div>' +
          '<div class="gp-row"><span>🚶 ' + GeoUtil.fmtMin(x.walk) + ' (' + GeoUtil.fmtKm(x.foot_km) + ')</span><span>🛵 ' + GeoUtil.fmtMin(x.moto) + '</span><span>🚗 ' + GeoUtil.fmtMin(x.car) + '</span></div>';
        r.remove();
      } catch (e) { r.disabled = false; r.textContent = '🛣️ ตามถนนจริง'; Toast.show('คำนวณเส้นทางไม่สำเร็จ: ' + e.message, 'danger'); }
    };
    const ed = root.querySelector('[data-act=edit]');
    if (ed) ed.onclick = function () { map.closePopup(); GeoPicker.open({ mode: 'home', citizen_id: s.citizen_id, label: name(s), onSaved: refresh }); };
  }

  function renderList() {
    const sort = document.getElementById('gm-sort').value;
    const list = shown().map(function (s) { return { s: s, e: est(s) }; });
    list.sort(function (a, b) {
      if (sort === 'far') return (b.e ? b.e.road : -1) - (a.e ? a.e.road : -1);
      if (sort === 'missing') return (a.s.home ? 1 : 0) - (b.s.home ? 1 : 0) || Utils.gradeSortKey(a.s.grade) - Utils.gradeSortKey(b.s.grade);
      return Utils.gradeSortKey(a.s.grade) - Utils.gradeSortKey(b.s.grade) || String(a.s.room).localeCompare(String(b.s.room)) || a.s.first_name.localeCompare(b.s.first_name, 'th');
    });
    const canEdit = TTAuth.can('geo_edit');
    document.getElementById('gm-list').innerHTML = !list.length ? '<div class="text-muted">ไม่มีนักเรียน</div>' :
      '<div class="table-wrap"><table class="tt-results gm-list"><thead><tr><th>ชื่อ</th><th>ชั้น</th><th>ระยะ (ประมาณ)</th><th>🚶 เดิน</th><th>🛵 จยย.</th><th>🚗 รถยนต์</th><th></th></tr></thead><tbody>' +
      list.map(function (x) {
        const s = x.s, e = x.e;
        return '<tr data-cid="' + esc(s.citizen_id) + '"><td><span class="gm-dot" style="background:' + color(s) + '"></span>' + esc(name(s)) + '</td><td>' + esc(cls(s)) + '</td>' +
          (s.home ? (e ? '<td>' + GeoUtil.fmtKm(e.road) + '</td><td>' + GeoUtil.fmtMin(e.walk) + '</td><td>' + GeoUtil.fmtMin(e.moto) + '</td><td>' + GeoUtil.fmtMin(e.car) + '</td>' : '<td colspan="4" class="tt-note">มีพิกัดแล้ว (ยังไม่ตั้งพิกัดโรงเรียน)</td>')
            : '<td colspan="4"><span class="badge badge-fail">ยังไม่มีพิกัด</span></td>') +
          '<td class="tt-actions">' + (canEdit ? '<button class="btn btn-' + (s.home ? 'secondary' : 'primary') + '" data-pin="' + esc(s.citizen_id) + '" title="' + (s.home ? 'แก้พิกัด' : 'ปักหมุด') + '"><i class="bi bi-geo-alt"></i></button>' : '') + '</td></tr>';
      }).join('') + '</tbody></table></div>';
    document.querySelectorAll('#gm-list tbody tr').forEach(function (tr) {
      tr.onclick = function (ev) {
        if (ev.target.closest('[data-pin]')) return;
        showOne(tr.dataset.cid);
      };
    });
    document.querySelectorAll('#gm-list [data-pin]').forEach(function (b) {
      b.onclick = function () { const s = D.students.find(function (x) { return x.citizen_id === b.dataset.pin; }); GeoPicker.open({ mode: 'home', citizen_id: s.citizen_id, label: name(s), onSaved: refresh }); };
    });
  }

  function showOne(cid) {
    const s = D.students.find(function (x) { return x.citizen_id === cid; });
    if (!s) return;
    if (!s.home) { Toast.show(name(s) + ' ยังไม่มีพิกัดบ้าน', 'warning'); return; }
    focus = cid;
    if (filter && cls(s) !== filter) { filter = ''; document.getElementById('gm-class').value = ''; renderAll(false); }
    else renderMap(false);
    map.setView([s.home.lat, s.home.lng], 17);
    markers[cid].openPopup();
    document.getElementById('gm-map').scrollIntoView({ behavior: 'smooth', block: 'center' });
  }

  function editSpeeds() {
    const sp = D.speeds;
    const el = document.createElement('div');
    el.className = 'modal-backdrop show';
    el.innerHTML = '<div class="modal"><h3 class="modal-title">⚙️ ความเร็วเฉลี่ยสำหรับประมาณเวลา</h3>' +
      '<div class="tt-form">' +
        '<div><label>🚶 เดิน (กม./ชม.)</label><input class="form-control" type="number" step="0.5" data-k="walk" value="' + sp.walk + '"></div>' +
        '<div><label>🛵 จักรยานยนต์ (กม./ชม.)</label><input class="form-control" type="number" data-k="moto" value="' + sp.moto + '"></div>' +
        '<div><label>🚗 รถยนต์ (กม./ชม.)</label><input class="form-control" type="number" data-k="car" value="' + sp.car + '"></div>' +
        '<div><label>ตัวคูณระยะถนน</label><input class="form-control" type="number" step="0.05" data-k="road_factor" value="' + sp.road_factor + '"></div>' +
      '</div><p class="tt-note">ระยะถนนโดยประมาณ = ระยะเส้นตรง × ตัวคูณ (ถนนชนบทคดเคี้ยว ~1.3–1.5) · เด็กประถมเดินเฉลี่ย ~3–4 กม./ชม.</p>' +
      '<div class="flex" style="justify-content:flex-end;gap:8px"><button class="btn btn-secondary" data-x>ยกเลิก</button><button class="btn btn-primary" data-ok>บันทึก</button></div></div>';
    document.body.appendChild(el);
    el.querySelector('[data-x]').onclick = function () { el.remove(); };
    el.querySelector('[data-ok]').onclick = async function () {
      const v = {};
      el.querySelectorAll('[data-k]').forEach(function (i) { v[i.dataset.k] = Number(i.value); });
      try { const r = await api('geo.save_config', { speeds: v }, { loadingMsg: 'กำลังบันทึก...', noRetry: true }); D.speeds = r.speeds; el.remove(); Toast.show('บันทึกแล้ว', 'success'); renderAll(false); } catch (e) { /* toast */ }
    };
  }

  function exportCsv() {
    const list = shown();
    const head = ['ชั้น', 'รหัส', 'ชื่อ-สกุล', 'มีพิกัด', 'ระยะถนนประมาณ (กม.)', 'เดิน (นาที)', 'จักรยานยนต์ (นาที)', 'รถยนต์ (นาที)', 'จุดสังเกต'];
    const rows = list.map(function (s) {
      const e = est(s);
      return [cls(s), s.student_code, name(s), s.home ? 'มี' : 'ไม่มี', e ? e.road.toFixed(2) : '', e ? Math.round(e.walk) : '', e ? Math.round(e.moto) : '', e ? Math.round(e.car) : '', s.home ? s.home.note : ''];
    });
    const csv = '﻿' + [head].concat(rows).map(function (r) { return r.map(function (v) { const t = String(v == null ? '' : v); return /[",\n]/.test(t) ? '"' + t.replace(/"/g, '""') + '"' : t; }).join(','); }).join('\r\n');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    a.download = 'student_distance_' + (filter || 'all').replace(/\//g, '-') + '.csv';
    document.body.appendChild(a); a.click(); setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  }

  function renderAll(fit) { renderControls(); renderStats(); renderMap(fit); renderList(); }
  async function refresh() { try { await load(); renderAll(false); } catch (e) { /* toast */ } }

  document.getElementById('gm-class').onchange = function () { filter = this.value; focus = ''; renderStats(); renderMap(true); renderList(); };
  document.getElementById('gm-find').addEventListener('change', function () {
    const v = this.value;
    const s = D.students.find(function (x) { return v === name(x) + ' (' + cls(x) + ')' || (x.student_code && v === x.student_code); });
    if (s) showOne(s.citizen_id);
    this.value = '';
  });
  document.getElementById('gm-rings').onchange = function () { renderMap(false); };
  document.getElementById('gm-labels').onchange = function () { renderMap(false); };
  document.getElementById('gm-sort').onchange = renderList;
  document.getElementById('gm-csv').onclick = exportCsv;

  TTAuth.require({ caps: ['geo'] }).then(async function () {
    try {
      Loading.show('กำลังโหลดแผนที่...');
      await GeoUtil.load();
      initMap();
      await load();
      renderAll(true);
    } catch (e) { Toast.show(e.message || 'โหลดไม่สำเร็จ', 'danger'); }
    finally { Loading.hide(); }
  });
})();
