/**
 * หน้าแผนที่บ้านนักเรียน (map.html) — ต้องเข้าสู่ระบบ (สิทธิ์ geo)
 *   แผนที่: หมุดสีตามชั้น · วงรัศมี · จุดเสี่ยง · ความหนาแน่น (heatmap) · กลุ่มบ้าน · เส้นทางรถรับส่ง
 *   แท็บ: รายชื่อ (เลือกส่งลิงก์ผู้ปกครอง/แก้วิธีเดินทาง) · วิธีเดินทาง (สรุปรายชั้น) · บ้านไกล (เกณฑ์ กม. + ระยะถนนจริง)
 *         · กลุ่มบ้าน/รถรับส่ง (จัดกลุ่มตามระยะ + วางเส้นทาง) · จุดเสี่ยง (นักเรียนที่ต้องผ่าน)
 *   ระยะทาง: ใช้ระยะถนนจริงที่คำนวณเก็บไว้ (OSRM) ถ้ามี ไม่งั้นใช้ค่าประมาณ (≈)
 *   ครู (เมื่อผู้ดูแลตั้ง "เห็นเฉพาะชั้นตัวเอง") ได้รับเฉพาะนักเรียนชั้นที่เป็นครูประจำชั้น — กรองที่ server
 */
(function () {
  const esc = Utils.esc;
  const COLORS = ['#E53935', '#FB8C00', '#FDD835', '#43A047', '#00ACC1', '#1E88E5', '#8E24AA', '#6D4C41', '#546E7A'];
  const HEAT_URL = 'https://cdn.jsdelivr.net/npm/leaflet.heat@0.2.0/dist/leaflet-heat.js';
  const QR_URL = 'https://cdn.jsdelivr.net/npm/qrcode-generator@1.4.4/qrcode.min.js';
  const D = { students: [], school: null, speeds: null, options: null, points: [], scope: null };
  const V = { filter: '', focus: '', tab: 'list', selected: {}, route: null, picking: null, groupR: 600, groupSel: {} };
  let map, layer, rings, hazLayer, heatLayer = null, groupLayer, routeLayer, schoolMarker = null, markers = {};

  const can = function (c) { return TTAuth.can(c); };
  function name(s) { return s.prefix + s.first_name + ' ' + s.last_name; }
  function cls(s) { return s.grade + (s.room ? '/' + s.room : ''); }
  function grades() { return D.students.map(cls).filter(function (g, i, a) { return a.indexOf(g) === i; }).sort(function (a, b) { return Utils.gradeSortKey(a) - Utils.gradeSortKey(b) || a.localeCompare(b); }); }
  function color(s) { return COLORS[grades().indexOf(cls(s)) % COLORS.length]; }
  function shown() { return D.students.filter(function (s) { return !V.filter || cls(s) === V.filter; }); }
  /** ระยะ/เวลาไปโรงเรียน: ถนนจริงที่เก็บไว้ (real) หรือค่าประมาณ */
  function dist(s) {
    if (!D.school || !s.home) return null;
    const h = s.home;
    if (h.road_km != null) return { km: h.road_km, walk: h.road_walk_min, car: h.road_car_min, moto: h.road_km / D.speeds.moto * 60, real: true };
    const e = GeoUtil.estimate(D.school, h, D.speeds);
    return { km: e.road, walk: e.walk, car: e.car, moto: e.moto, real: false };
  }
  function fmtD(d) { return d ? (d.real ? '' : '≈') + GeoUtil.fmtKm(d.km) : '-'; }
  function fmtT(d, k) { return d && d[k] != null ? (d.real ? '' : '≈') + GeoUtil.fmtMin(d[k]) : '-'; }
  /** (6) จุดเสี่ยงที่อยู่บนแนวบ้าน→โรงเรียน (ประมาณตามเส้นตรง) */
  function hazardsFor(s) {
    if (!D.school || !s.home) return [];
    return D.points.filter(function (p) { return GeoUtil.segKm(p, s.home, D.school) * 1000 <= (p.radius_m || 150); });
  }
  function passing(p) { return D.students.filter(function (s) { return s.home && D.school && GeoUtil.segKm(p, s.home, D.school) * 1000 <= (p.radius_m || 150); }); }
  function downloadCsv(head, rows, fname) {
    const csv = '﻿' + [head].concat(rows).map(function (r) { return r.map(function (v) { const t = String(v == null ? '' : v); return /[",\n]/.test(t) ? '"' + t.replace(/"/g, '""') + '"' : t; }).join(','); }).join('\r\n');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    a.download = fname;
    document.body.appendChild(a); a.click(); setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  }
  function modal(html) {
    const el = document.createElement('div');
    el.className = 'modal-backdrop show';
    el.innerHTML = '<div class="modal wide">' + html + '</div>';
    document.body.appendChild(el);
    el.close = function () { el.remove(); };
    el.querySelectorAll('[data-x]').forEach(function (b) { b.onclick = el.close; });
    return el;
  }

  async function load() {
    const d = await api('geo.bootstrap', {}, { loadingMsg: 'กำลังโหลดแผนที่...' });
    Object.assign(D, { students: d.students, school: d.school, speeds: d.speeds, options: d.options, points: d.points, scope: d.scope });
    document.getElementById('gm-sub').textContent = (D.school && D.school.name ? D.school.name + ' · ' : '') + 'เฉพาะบุคลากร';
  }
  function initMap() {
    map = L.map('gm-map');
    GeoUtil.addLayers(map, 'street');
    groupLayer = L.layerGroup().addTo(map);
    rings = L.layerGroup().addTo(map);
    hazLayer = L.layerGroup().addTo(map);
    routeLayer = L.layerGroup().addTo(map);
    layer = L.layerGroup().addTo(map);
    map.on('click', function (e) { if (V.picking === 'hazard') { stopPick(); hazardForm({ lat: e.latlng.lat, lng: e.latlng.lng }); } });
  }

  /* ════ แถบควบคุม ════ */
  function renderControls() {
    const sel = document.getElementById('gm-class');
    sel.innerHTML = '<option value="">ทุกชั้น' + (D.scope.limited ? 'ที่ดูแล' : '') + ' (' + D.students.length + ' คน)</option>' + grades().map(function (g) {
      const n = D.students.filter(function (s) { return cls(s) === g; }), h = n.filter(function (s) { return s.home; }).length;
      return '<option value="' + esc(g) + '"' + (g === V.filter ? ' selected' : '') + '>' + esc(g) + ' — มีพิกัด ' + h + '/' + n.length + '</option>';
    }).join('');
    document.getElementById('gm-names').innerHTML = D.students.map(function (s) { return '<option value="' + esc(name(s) + ' (' + cls(s) + ')') + '">'; }).join('');
    const act = document.getElementById('gm-actions');
    act.innerHTML =
      (can('geo_edit') ? '<button class="btn btn-secondary" data-a="hazard"><i class="bi bi-exclamation-triangle"></i> เพิ่มจุดเสี่ยง</button>' +
        '<button class="btn btn-secondary" data-a="links"><i class="bi bi-link-45deg"></i> ลิงก์ให้ผู้ปกครองส่งพิกัด</button>' +
        '<button class="btn btn-secondary" data-a="road"><i class="bi bi-signpost-split"></i> คำนวณระยะตามถนนจริง</button>' : '') +
      (can('geo_admin') ? '<button class="btn btn-secondary" data-a="school"><i class="bi bi-building"></i> ' + (D.school ? 'แก้พิกัดโรงเรียน' : 'ตั้งพิกัดโรงเรียน') + '</button>' +
        '<button class="btn btn-secondary" data-a="settings"><i class="bi bi-gear"></i> ตั้งค่าแผนที่</button>' : '');
    act.querySelectorAll('[data-a]').forEach(function (b) {
      b.onclick = function () {
        const a = b.dataset.a;
        if (a === 'hazard') startPick();
        else if (a === 'links') linksFor(selectedOrMissing());
        else if (a === 'road') computeRoads();
        else if (a === 'school') GeoPicker.open({ mode: 'school', onSaved: refresh });
        else if (a === 'settings') settings();
      };
    });
    document.getElementById('gm-scope').innerHTML = !D.scope.limited ? '' : D.scope.classes.length
      ? '<div class="alert alert-info" style="margin-top:10px;font-size:14px">👩‍🏫 เห็นเฉพาะนักเรียนชั้นที่คุณเป็นครูประจำชั้น: <strong>' + esc(D.scope.classes.join(', ')) + '</strong></div>'
      : '<div class="alert alert-warning" style="margin-top:10px;font-size:14px">👩‍🏫 บัญชีนี้ยังไม่ได้ผูกกับครูประจำชั้น จึงยังไม่เห็นนักเรียน — แจ้งผู้ดูแลให้ผูก "ครู" ในแท็บผู้ใช้ และตั้งครูประจำชั้นในหน้าจัดตารางสอน</div>';
    document.getElementById('gm-noschool').innerHTML = D.school ? '' : '<div class="alert alert-warning" style="margin-top:10px">🏫 ยังไม่ได้ตั้งพิกัดโรงเรียน — ระยะทางและเวลาเดินทางจะคำนวณได้หลังตั้งพิกัด' + (can('geo_admin') ? ' (กดปุ่ม "ตั้งพิกัดโรงเรียน")' : ' (แจ้งผู้ดูแลระบบ)') + '</div>';
    document.getElementById('gm-legend').innerHTML = grades().map(function (g, i) { return '<span><span class="gm-dot" style="background:' + COLORS[i % COLORS.length] + '"></span>' + esc(g) + '</span>'; }).join('') +
      '<span>🏫 โรงเรียน</span><span>⚠️ จุดเสี่ยง</span><span>📨 = ผู้ปกครองส่งมา (รอครูยืนยัน)</span>';
  }

  function renderStats() {
    const list = shown(), withH = list.filter(function (s) { return s.home; });
    const ds = withH.map(dist).filter(Boolean);
    const avg = ds.length ? ds.reduce(function (a, d) { return a + d.km; }, 0) / ds.length : 0;
    const far = D.options.far_km, nFar = ds.filter(function (d) { return d.km >= far; }).length;
    document.getElementById('gm-stats').innerHTML =
      stat('มีพิกัดแล้ว', withH.length + '/' + list.length, list.length ? Math.round(withH.length / list.length * 100) + '%' : '') +
      stat('ระยะเฉลี่ย', ds.length ? GeoUtil.fmtKm(avg) : '-', ds.some(function (d) { return !d.real; }) ? 'มีค่าประมาณ' : 'ตามถนนจริง') +
      stat('บ้านไกล ≥ ' + far + ' กม.', String(nFar), 'คน') +
      stat('ยังไม่มีพิกัด', String(list.length - withH.length), 'คน');
    const band = [0, 0, 0, 0];
    ds.forEach(function (d) { band[d.km < 1 ? 0 : d.km < 3 ? 1 : d.km < 5 ? 2 : 3]++; });
    document.getElementById('gm-band').innerHTML = ds.length ? '<span>ไม่เกิน 1 กม.: ' + band[0] + '</span><span>1–3 กม.: ' + band[1] + '</span><span>3–5 กม.: ' + band[2] + '</span><span>เกิน 5 กม.: ' + band[3] + '</span>' : '';
    function stat(l, v, sub) { return '<div class="stat"><div class="label">' + l + '</div><div class="value">' + v + '</div>' + (sub ? '<div class="tt-note">' + sub + '</div>' : '') + '</div>'; }
  }

  /* ════ แผนที่ ════ */
  function popupHtml(s) {
    const d = dist(s), hz = hazardsFor(s);
    return '<div class="gp-name">' + esc(name(s)) + (s.home.source === 'parent' ? ' 📨' : '') + '</div><div class="tt-note">ชั้น ' + esc(cls(s)) + (s.student_code ? ' · รหัส ' + esc(s.student_code) : '') + '</div>' +
      (s.guardian_name || s.guardian_phone ? '<div>👪 ' + esc(s.guardian_name || '-') + (s.guardian_phone ? ' · <a href="tel:' + esc(s.guardian_phone) + '">' + esc(s.guardian_phone) + '</a>' : '') + '</div>' : '') +
      (s.travel ? '<div>' + GeoUtil.MODES[s.travel] + '</div>' : '') +
      (s.home.note ? '<div>📝 ' + esc(s.home.note) + '</div>' : '') +
      (d ? '<div style="margin-top:6px"><strong>ไปโรงเรียน ' + fmtD(d) + (d.real ? ' (ตามถนน)' : ' (ประมาณ)') + '</strong></div>' +
        '<div class="gp-row"><span>🚶 ' + fmtT(d, 'walk') + '</span><span>🛵 ' + fmtT(d, 'moto') + '</span><span>🚗 ' + fmtT(d, 'car') + '</span></div>' +
        (hz.length ? '<div class="text-danger">⚠️ ผ่าน: ' + hz.map(function (p) { return esc(p.name); }).join(', ') + '</div>' : '') +
        '<div data-route></div>' + (d.real ? '' : '<button class="btn btn-secondary" data-act="route">🛣️ ตามถนนจริง</button>') +
        '<a class="btn btn-secondary" target="_blank" rel="noopener" href="https://www.google.com/maps/dir/?api=1&origin=' + s.home.lat + ',' + s.home.lng + '&destination=' + D.school.lat + ',' + D.school.lng + '">🧭 นำทาง</a>'
        : '<div class="tt-note">ตั้งพิกัดโรงเรียนก่อนจึงคำนวณระยะทางได้</div>') +
      (can('geo_edit') ? '<button class="btn btn-primary" data-act="edit">' + (s.home.source === 'parent' ? '✅ ตรวจ/ยืนยัน' : '✏️ แก้พิกัด') + '</button>' : '') +
      '<div class="tt-note">' + (GeoUtil.SOURCES[s.home.source] || '') + (s.home.accuracy ? ' ±' + s.home.accuracy + ' ม.' : '') + ' · ' + esc(s.home.updated_by || '') + '</div>';
  }

  function renderMap(fit) {
    layer.clearLayers(); rings.clearLayers(); hazLayer.clearLayers(); groupLayer.clearLayers(); routeLayer.clearLayers(); markers = {};
    if (schoolMarker) { map.removeLayer(schoolMarker); schoolMarker = null; }
    if (heatLayer) { map.removeLayer(heatLayer); heatLayer = null; }
    const pts = [];
    if (D.school) {
      schoolMarker = L.marker([D.school.lat, D.school.lng], { icon: GeoUtil.schoolIcon(), zIndexOffset: 1000 }).addTo(map).bindPopup('<div class="gp-name">🏫 ' + esc(D.school.name || 'โรงเรียน') + '</div>');
      pts.push([D.school.lat, D.school.lng]);
      if (document.getElementById('gm-rings').checked) [1, 3, 5].concat(D.options.far_km && [1, 3, 5].indexOf(D.options.far_km) < 0 ? [D.options.far_km] : []).forEach(function (r) {
        L.circle([D.school.lat, D.school.lng], { radius: r * 1000, color: r === D.options.far_km ? '#E53935' : '#0288D1', weight: 1, dashArray: '4 6', fill: false, interactive: false }).addTo(rings);
      });
    }
    const labels = document.getElementById('gm-labels').checked;
    const list = shown().filter(function (s) { return s.home; });
    list.forEach(function (s) {
      const parent = s.home.source === 'parent';
      const m = L.circleMarker([s.home.lat, s.home.lng], { radius: s.citizen_id === V.focus ? 10 : 7, color: parent ? '#FF6F00' : '#fff', weight: parent ? 3 : 2, dashArray: parent ? '3 2' : null, fillColor: color(s), fillOpacity: 0.95 }).addTo(layer);
      if (labels) m.bindTooltip(s.first_name, { permanent: true, direction: 'top', offset: [0, -6], className: 'gp-label' });
      m.bindPopup(function () { return popupHtml(s); });
      m.on('popupopen', function (ev) { bindPopup(ev.popup.getElement(), s); });
      markers[s.citizen_id] = m;
      pts.push([s.home.lat, s.home.lng]);
    });
    if (document.getElementById('gm-hazards').checked) D.points.forEach(function (p) {
      L.circle([p.lat, p.lng], { radius: p.radius_m || 150, color: '#E53935', weight: 1, fillColor: '#E53935', fillOpacity: 0.12, interactive: false }).addTo(hazLayer);
      L.marker([p.lat, p.lng], { icon: L.divIcon({ className: 'geo-hazard', html: '⚠️', iconSize: [26, 26], iconAnchor: [13, 13] }), title: p.name })
        .addTo(hazLayer).bindPopup(function () { return hazardPopup(p); }).on('popupopen', function (ev) { bindHazardPopup(ev.popup.getElement(), p); });
    });
    if (document.getElementById('gm-heat').checked && list.length) {
      LazyLib.script(HEAT_URL).then(function () {
        if (heatLayer) map.removeLayer(heatLayer);
        heatLayer = L.heatLayer(list.map(function (s) { return [s.home.lat, s.home.lng, 1]; }), { radius: 28, blur: 22, maxZoom: 16, minOpacity: 0.35 }).addTo(map);
      }).catch(function () { Toast.show('โหลดชั้นความหนาแน่นไม่สำเร็จ', 'warning'); });
    }
    if (document.getElementById('gm-groups').checked) clusters().forEach(function (g) {
      const r = Math.max(150, Math.max.apply(null, g.members.map(function (s) { return GeoUtil.km(g.center, s.home) * 1000; })) + 80);
      L.circle([g.center.lat, g.center.lng], { radius: r, color: '#6A1B9A', weight: 2, fillOpacity: 0.06 }).addTo(groupLayer)
        .bindTooltip(g.label + ' · ' + g.members.length + ' คน', { permanent: g.members.length > 1, direction: 'center', className: 'gp-label' });
    });
    if (V.route && D.school) {
      const line = [[D.school.lat, D.school.lng]].concat(V.route.stops.map(function (g) { return [g.center.lat, g.center.lng]; })).concat(V.route.back ? [[D.school.lat, D.school.lng]] : []);
      L.polyline(line, { color: '#0277BD', weight: 4, dashArray: '8 6' }).addTo(routeLayer);
      V.route.stops.forEach(function (g, i) {
        L.marker([g.center.lat, g.center.lng], { icon: L.divIcon({ className: '', html: '<div class="geo-stop">' + (i + 1) + '</div>', iconSize: [24, 24], iconAnchor: [12, 12] }) })
          .addTo(routeLayer).bindTooltip('จุดที่ ' + (i + 1) + ': ' + g.label + ' (' + g.members.length + ' คน)');
      });
    }
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
        root.querySelector('[data-route]').innerHTML = '<div style="margin-top:4px"><strong>ตามถนนจริง</strong> ' + GeoUtil.fmtKm(x.car_km) + '</div>' +
          '<div class="gp-row"><span>🚶 ' + GeoUtil.fmtMin(x.walk) + ' (' + GeoUtil.fmtKm(x.foot_km) + ')</span><span>🛵 ' + GeoUtil.fmtMin(x.moto) + '</span><span>🚗 ' + GeoUtil.fmtMin(x.car) + '</span></div>';
        r.remove();
        if (can('geo_edit')) {   // เก็บไว้ใช้ในรายงาน
          await api('geo.save_road', { items: [{ citizen_id: s.citizen_id, road_km: x.car_km, walk_min: x.walk, car_min: x.car }] }, { loading: false, silent: true, noRetry: true });
          Object.assign(s.home, { road_km: Math.round(x.car_km * 100) / 100, road_walk_min: Math.round(x.walk), road_car_min: Math.round(x.car) });
          renderStats(); renderPane();
        }
      } catch (e) { r.disabled = false; r.textContent = '🛣️ ตามถนนจริง'; Toast.show('คำนวณเส้นทางไม่สำเร็จ: ' + e.message, 'danger'); }
    };
    const ed = root.querySelector('[data-act=edit]');
    if (ed) ed.onclick = function () { map.closePopup(); GeoPicker.open({ mode: 'home', citizen_id: s.citizen_id, label: name(s), onSaved: refresh }); };
  }

  function showOne(cid) {
    const s = D.students.find(function (x) { return x.citizen_id === cid; });
    if (!s) return;
    if (!s.home) { Toast.show(name(s) + ' ยังไม่มีพิกัดบ้าน', 'warning'); return; }
    V.focus = cid;
    if (V.filter && cls(s) !== V.filter) { V.filter = ''; renderAll(false); } else renderMap(false);
    map.setView([s.home.lat, s.home.lng], 17);
    markers[cid].openPopup();
    document.getElementById('gm-map').scrollIntoView({ behavior: 'smooth', block: 'center' });
  }

  /* ════ แท็บ ════ */
  function renderPane() {
    document.querySelectorAll('#gm-tabs .tab').forEach(function (t) { t.classList.toggle('active', t.dataset.tab === V.tab); });
    document.querySelectorAll('.gm-pane').forEach(function (p) { p.classList.toggle('hidden', p.id !== 'gm-pane-' + V.tab); });
    ({ list: paneList, travel: paneTravel, far: paneFar, groups: paneGroups, hazards: paneHazards })[V.tab]();
  }

  // ── รายชื่อ ──
  function paneList() {
    const host = document.getElementById('gm-pane-list');
    const sort = host.dataset.sort || 'class';
    const list = shown().map(function (s) { return { s: s, d: dist(s) }; });
    list.sort(function (a, b) {
      if (sort === 'far') return (b.d ? b.d.km : -1) - (a.d ? a.d.km : -1);
      if (sort === 'missing') return (a.s.home ? 1 : 0) - (b.s.home ? 1 : 0) || Utils.gradeSortKey(a.s.grade) - Utils.gradeSortKey(b.s.grade);
      return Utils.gradeSortKey(a.s.grade) - Utils.gradeSortKey(b.s.grade) || String(a.s.room).localeCompare(String(b.s.room)) || a.s.first_name.localeCompare(b.s.first_name, 'th');
    });
    const edit = can('geo_edit'), nSel = Object.keys(V.selected).length;
    host.innerHTML = '<div class="gm-bar" style="margin-bottom:8px"><select class="form-control" data-sort style="max-width:200px">' +
        [['class', 'เรียงตามชั้น'], ['far', 'ไกลสุดก่อน'], ['missing', 'ยังไม่มีพิกัดก่อน']].map(function (o) { return '<option value="' + o[0] + '"' + (o[0] === sort ? ' selected' : '') + '>' + o[1] + '</option>'; }).join('') + '</select>' +
        (edit ? '<button class="btn btn-secondary" data-selmissing>เลือกคนที่ยังไม่มีพิกัด</button><button class="btn btn-primary" data-links' + (nSel ? '' : ' disabled') + '><i class="bi bi-link-45deg"></i> สร้างลิงก์ผู้ปกครอง (' + nSel + ')</button>' : '') +
        '<span style="flex:1"></span><button class="btn btn-secondary" data-csv><i class="bi bi-filetype-csv"></i> ส่งออก CSV</button></div>' +
      (!list.length ? '<div class="text-muted">ไม่มีนักเรียน</div>' :
      '<div class="table-wrap"><table class="tt-results gm-list"><thead><tr>' + (edit ? '<th><input type="checkbox" data-all></th>' : '') + '<th>ชื่อ</th><th>ชั้น</th><th>ระยะ</th><th>🚶</th><th>🛵</th><th>🚗</th><th>วิธีเดินทาง</th><th></th></tr></thead><tbody>' +
      list.map(function (x) {
        const s = x.s, d = x.d;
        return '<tr data-cid="' + esc(s.citizen_id) + '">' + (edit ? '<td><input type="checkbox" data-sel' + (V.selected[s.citizen_id] ? ' checked' : '') + '></td>' : '') +
          '<td><span class="gm-dot" style="background:' + color(s) + '"></span>' + esc(name(s)) + (s.home && s.home.source === 'parent' ? ' 📨' : '') + (hazardsFor(s).length ? ' ⚠️' : '') + '</td><td>' + esc(cls(s)) + '</td>' +
          (s.home ? (d ? '<td>' + fmtD(d) + '</td><td>' + fmtT(d, 'walk') + '</td><td>' + fmtT(d, 'moto') + '</td><td>' + fmtT(d, 'car') + '</td>' : '<td colspan="4" class="tt-note">มีพิกัดแล้ว (ยังไม่ตั้งพิกัดโรงเรียน)</td>')
            : '<td colspan="4"><span class="badge badge-fail">ยังไม่มีพิกัด</span></td>') +
          '<td>' + (edit ? '<select class="form-control" data-mode><option value="">—</option>' + Object.keys(GeoUtil.MODES).map(function (k) { return '<option value="' + k + '"' + (s.travel === k ? ' selected' : '') + '>' + GeoUtil.MODES[k] + '</option>'; }).join('') + '</select>'
            : (GeoUtil.MODES[s.travel] || '-')) + '</td>' +
          '<td class="tt-actions">' + (edit ? '<button class="btn btn-' + (s.home ? 'secondary' : 'primary') + '" data-pin title="' + (s.home ? 'แก้พิกัด' : 'ปักหมุด') + '"><i class="bi bi-geo-alt"></i></button>' : '') + '</td></tr>';
      }).join('') + '</tbody></table></div>');
    host.querySelector('[data-sort]').onchange = function () { host.dataset.sort = this.value; paneList(); };
    host.querySelector('[data-csv]').onclick = exportList;
    if (!list.length) return;
    host.querySelectorAll('tbody tr').forEach(function (tr) {
      const cid = tr.dataset.cid, s = D.students.find(function (x) { return x.citizen_id === cid; });
      tr.onclick = function (ev) { if (!ev.target.closest('input,select,button')) showOne(cid); };
      const cb = tr.querySelector('[data-sel]');
      if (cb) cb.onchange = function () { if (cb.checked) V.selected[cid] = 1; else delete V.selected[cid]; paneList(); };
      const md = tr.querySelector('[data-mode]');
      if (md) md.onchange = async function () {
        try { await api('geo.save_travel', { citizen_id: cid, mode: md.value }, { loading: false, noRetry: true }); s.travel = md.value; Toast.show('บันทึกวิธีเดินทางแล้ว', 'success'); }
        catch (e) { md.value = s.travel || ''; }
      };
      const pin = tr.querySelector('[data-pin]');
      if (pin) pin.onclick = function () { GeoPicker.open({ mode: 'home', citizen_id: cid, label: name(s), onSaved: refresh }); };
    });
    const all = host.querySelector('[data-all]');
    if (all) all.onchange = function () { list.forEach(function (x) { if (all.checked) V.selected[x.s.citizen_id] = 1; else delete V.selected[x.s.citizen_id]; }); paneList(); };
    const sm = host.querySelector('[data-selmissing]');
    if (sm) sm.onclick = function () { V.selected = {}; shown().forEach(function (s) { if (!s.home) V.selected[s.citizen_id] = 1; }); paneList(); };
    const lk = host.querySelector('[data-links]');
    if (lk) lk.onclick = function () { linksFor(Object.keys(V.selected)); };
  }
  function exportList() {
    const head = ['ชั้น', 'รหัส', 'ชื่อ-สกุล', 'มีพิกัด', 'ระยะ (กม.)', 'ประเภทระยะ', 'เดิน (นาที)', 'จักรยานยนต์ (นาที)', 'รถยนต์ (นาที)', 'วิธีเดินทาง', 'จุดเสี่ยงที่ผ่าน', 'จุดสังเกต'];
    const rows = shown().map(function (s) {
      const d = dist(s);
      return [cls(s), s.student_code, name(s), s.home ? 'มี' : 'ไม่มี', d ? d.km.toFixed(2) : '', d ? (d.real ? 'ถนนจริง' : 'ประมาณ') : '', d && d.walk != null ? Math.round(d.walk) : '',
        d ? Math.round(d.moto) : '', d && d.car != null ? Math.round(d.car) : '', (GeoUtil.MODES[s.travel] || '').replace(/^\S+\s/, ''), hazardsFor(s).map(function (p) { return p.name; }).join(' / '), s.home ? s.home.note : ''];
    });
    downloadCsv(head, rows, 'student_distance_' + (V.filter || 'all').replace(/\//g, '-') + '.csv');
  }

  // ── (2) วิธีเดินทาง ──
  function paneTravel() {
    const host = document.getElementById('gm-pane-travel');
    const modes = Object.keys(GeoUtil.MODES), gs = grades().filter(function (g) { return !V.filter || g === V.filter; });
    const count = function (list, m) { return list.filter(function (s) { return (s.travel || '') === m; }).length; };
    const rows = gs.map(function (g) { const l = D.students.filter(function (s) { return cls(s) === g; }); return [g, l]; });
    const all = shown();
    host.innerHTML = '<h3 class="card-title">🚸 วิธีเดินทางมาโรงเรียน</h3>' +
      '<p class="tt-note" style="margin-top:-6px">ตั้งได้ในแท็บรายชื่อ (คอลัมน์วิธีเดินทาง) · ในหน้าต่างปักหมุด · หรือผู้ปกครองเลือกเองผ่านลิงก์</p>' +
      '<div class="table-wrap"><table class="tt-results gm-mode-table"><thead><tr><th>ชั้น</th>' + modes.map(function (m) { return '<th>' + GeoUtil.MODES[m] + '</th>'; }).join('') + '<th>ยังไม่ระบุ</th><th>รวม</th></tr></thead><tbody>' +
      rows.map(function (r) { return '<tr><td><strong>' + esc(r[0]) + '</strong></td>' + modes.map(function (m) { const n = count(r[1], m); return '<td>' + (n || '·') + '</td>'; }).join('') + '<td>' + (count(r[1], '') || '·') + '</td><td><strong>' + r[1].length + '</strong></td></tr>'; }).join('') +
      '<tr style="font-weight:700"><td>รวม</td>' + modes.map(function (m) { return '<td>' + count(all, m) + '</td>'; }).join('') + '<td>' + count(all, '') + '</td><td>' + all.length + '</td></tr>' +
      '</tbody></table></div>' +
      '<div class="gm-band" style="margin-top:10px">' + modes.filter(function (m) { return count(all, m); }).map(function (m) { return '<span>' + GeoUtil.MODES[m] + ' ' + Math.round(count(all, m) / Math.max(1, all.length) * 100) + '%</span>'; }).join('') + '</div>' +
      '<button class="btn btn-secondary mt-2" data-csv><i class="bi bi-filetype-csv"></i> ส่งออก CSV</button>';
    host.querySelector('[data-csv]').onclick = function () {
      downloadCsv(['ชั้น'].concat(modes.map(function (m) { return GeoUtil.MODES[m].replace(/^\S+\s/, ''); })).concat(['ยังไม่ระบุ', 'รวม']),
        rows.map(function (r) { return [r[0]].concat(modes.map(function (m) { return count(r[1], m); })).concat([count(r[1], ''), r[1].length]); }), 'travel_modes.csv');
    };
  }

  // ── (3) บ้านไกล ──
  function paneFar() {
    const host = document.getElementById('gm-pane-far');
    const far = D.options.far_km;
    const list = shown().map(function (s) { return { s: s, d: dist(s) }; }).filter(function (x) { return x.d && x.d.km >= far; }).sort(function (a, b) { return b.d.km - a.d.km; });
    const est = shown().filter(function (s) { const d = dist(s); return d && !d.real; }).length;
    const byClass = {};
    list.forEach(function (x) { byClass[cls(x.s)] = (byClass[cls(x.s)] || 0) + 1; });
    host.innerHTML = '<div class="flex" style="justify-content:space-between;flex-wrap:wrap;gap:8px"><h3 class="card-title" style="margin:0">📏 นักเรียนบ้านไกล ≥ ' + far + ' กม.</h3>' +
        (can('geo_admin') ? '<div class="gm-bar"><input type="number" class="form-control" data-far step="0.5" min="0.5" max="50" value="' + far + '" style="max-width:90px"><button class="btn btn-secondary" data-savefar>ตั้งเกณฑ์</button></div>' : '') + '</div>' +
      (est ? '<div class="alert alert-warning" style="margin-top:10px;font-size:14px">มี ' + est + ' คนที่ยังใช้ระยะ<strong>ประมาณ</strong> — กด "คำนวณระยะตามถนนจริง" ด้านบนเพื่อใช้ระยะทางจริงในรายงาน (เช่น ขอค่าพาหนะ)</div>' : '') +
      '<div class="gm-band" style="margin:10px 0">' + (Object.keys(byClass).length ? Object.keys(byClass).sort(function (a, b) { return Utils.gradeSortKey(a) - Utils.gradeSortKey(b); }).map(function (k) { return '<span>' + esc(k) + ': ' + byClass[k] + ' คน</span>'; }).join('') : '<span>ไม่มี</span>') + '</div>' +
      (list.length ? '<div class="table-wrap"><table class="tt-results gm-list"><thead><tr><th>#</th><th>ชื่อ</th><th>ชั้น</th><th>ระยะ</th><th>🚶 เดิน</th><th>วิธีเดินทาง</th><th>จุดเสี่ยงที่ผ่าน</th></tr></thead><tbody>' +
        list.map(function (x, i) {
          return '<tr data-cid="' + esc(x.s.citizen_id) + '"><td>' + (i + 1) + '</td><td>' + esc(name(x.s)) + '</td><td>' + esc(cls(x.s)) + '</td><td><strong>' + fmtD(x.d) + '</strong></td><td>' + fmtT(x.d, 'walk') + '</td>' +
            '<td>' + (GeoUtil.MODES[x.s.travel] || '<span class="tt-note">ยังไม่ระบุ</span>') + '</td><td>' + esc(hazardsFor(x.s).map(function (p) { return p.name; }).join(', ') || '-') + '</td></tr>';
        }).join('') + '</tbody></table></div>' : '<div class="text-muted">ไม่มีนักเรียนบ้านไกลตามเกณฑ์</div>') +
      '<button class="btn btn-secondary mt-2" data-csv><i class="bi bi-filetype-csv"></i> ส่งออกรายชื่อบ้านไกล</button>';
    host.querySelectorAll('tbody tr').forEach(function (tr) { tr.onclick = function () { showOne(tr.dataset.cid); }; });
    host.querySelector('[data-csv]').onclick = function () {
      downloadCsv(['ลำดับ', 'ชั้น', 'รหัส', 'ชื่อ-สกุล', 'ระยะ (กม.)', 'ประเภทระยะ', 'เดิน (นาที)', 'วิธีเดินทาง', 'ผู้ปกครอง', 'โทร'],
        list.map(function (x, i) { return [i + 1, cls(x.s), x.s.student_code, name(x.s), x.d.km.toFixed(2), x.d.real ? 'ถนนจริง' : 'ประมาณ', x.d.walk != null ? Math.round(x.d.walk) : '', (GeoUtil.MODES[x.s.travel] || '').replace(/^\S+\s/, ''), x.s.guardian_name, x.s.guardian_phone]; }),
        'far_students_' + far + 'km.csv');
    };
    const sf = host.querySelector('[data-savefar]');
    if (sf) sf.onclick = async function () {
      try { const r = await api('geo.save_config', { options: { far_km: Number(host.querySelector('[data-far]').value) } }, { loadingMsg: 'กำลังบันทึก...', noRetry: true }); D.options = r.options; renderStats(); renderMap(false); paneFar(); Toast.show('ตั้งเกณฑ์แล้ว', 'success'); } catch (e) { /* toast */ }
    };
  }

  /** (3) คำนวณระยะ/เวลาตามถนนจริงทีละคน (เว้นจังหวะ เพื่อไม่ใช้บริการแผนที่สาธารณะหนักเกินไป) แล้วเก็บไว้ */
  async function computeRoads() {
    if (!D.school) { Toast.show('ตั้งพิกัดโรงเรียนก่อน', 'warning'); return; }
    const todo = shown().filter(function (s) { return s.home && s.home.road_km == null; });
    const redo = shown().filter(function (s) { return s.home; });
    const el = modal('<h3 class="modal-title">🛣️ คำนวณระยะตามถนนจริง</h3><p>ใช้เส้นทางจาก OpenStreetMap (ส่งเฉพาะพิกัดบ้าน–โรงเรียน ไม่ส่งชื่อ) · ใช้เวลาประมาณ 2 วินาที/คน</p>' +
      '<label class="tt-chip"><input type="radio" name="gm-road" value="todo" checked> เฉพาะที่ยังไม่คำนวณ (' + todo.length + ' คน)</label> ' +
      '<label class="tt-chip"><input type="radio" name="gm-road" value="all"> คำนวณใหม่ทั้งหมด (' + redo.length + ' คน)</label>' +
      '<div class="progress mt-2 hidden" data-pg><div class="progress-bar" data-bar></div></div><div class="tt-note" data-txt style="margin-top:6px"></div>' +
      '<div class="flex" style="justify-content:flex-end;gap:8px;margin-top:12px"><button class="btn btn-secondary" data-cancel>ปิด</button><button class="btn btn-primary" data-go>เริ่มคำนวณ</button></div>');
    let stop = false;
    el.querySelector('[data-cancel]').onclick = function () { stop = true; el.close(); };
    el.querySelector('[data-go]').onclick = async function () {
      const list = el.querySelector('[name=gm-road]:checked').value === 'all' ? redo : todo;
      if (!list.length) { Toast.show('ไม่มีรายการที่ต้องคำนวณ', 'info'); return; }
      this.disabled = true;
      el.querySelector('[data-pg]').classList.remove('hidden');
      let buf = [], ok = 0, fail = 0;
      const flush = async function () { if (!buf.length) return; const b = buf; buf = []; await api('geo.save_road', { items: b }, { loading: false, silent: true, noRetry: true }); };
      for (let i = 0; i < list.length && !stop; i++) {
        const s = list[i];
        el.querySelector('[data-txt]').textContent = (i + 1) + '/' + list.length + ' · ' + name(s);
        el.querySelector('[data-bar]').style.width = Math.round((i + 1) / list.length * 100) + '%';
        try {
          const x = await GeoUtil.route(s.home, D.school, D.speeds);
          buf.push({ citizen_id: s.citizen_id, road_km: x.car_km, walk_min: x.walk, car_min: x.car });
          ok++;
        } catch (e) { fail++; }
        if (buf.length >= 10) { try { await flush(); } catch (e) { /* ลองรอบถัดไป */ } }
        await new Promise(function (r) { setTimeout(r, 1500); });
      }
      try { await flush(); } catch (e) { /* ignore */ }
      el.querySelector('[data-txt]').textContent = 'เสร็จ ' + ok + ' คน' + (fail ? ' · ไม่สำเร็จ ' + fail + ' คน (ใช้ค่าประมาณแทน)' : '') + (stop ? ' (หยุดกลางทาง)' : '');
      await refresh();
    };
  }

  // ── (3) กลุ่มบ้าน / เส้นทางรถรับส่ง ──
  /** จัดกลุ่มบ้านที่อยู่ใกล้กันภายในรัศมี R เมตร (ต่อกันเป็นสาย) · ชื่อกลุ่มจาก "หมู่ X" ที่พบมากสุดในที่อยู่ */
  function clusters() {
    const pts = shown().filter(function (s) { return s.home; }), used = {}, out = [];
    pts.forEach(function (s) {
      if (used[s.citizen_id]) return;
      const g = [s];
      used[s.citizen_id] = 1;
      for (let i = 0; i < g.length; i++) pts.forEach(function (t) { if (!used[t.citizen_id] && GeoUtil.km(g[i].home, t.home) * 1000 <= V.groupR) { used[t.citizen_id] = 1; g.push(t); } });
      out.push(g);
    });
    return out.map(function (m, i) {
      const c = { lat: m.reduce(function (a, s) { return a + s.home.lat; }, 0) / m.length, lng: m.reduce(function (a, s) { return a + s.home.lng; }, 0) / m.length };
      const tally = {};
      m.forEach(function (s) { const x = String(s.address || '').match(/(?:หมู่(?:ที่)?|ม\.)\s*(\d+)/); if (x) tally[x[1]] = (tally[x[1]] || 0) + 1; });
      const top = Object.keys(tally).sort(function (a, b) { return tally[b] - tally[a]; })[0];
      const ds = m.map(dist).filter(Boolean);
      const label = top ? 'หมู่ ' + top : 'กลุ่ม ' + (i + 1);
      return { id: 'g' + i, members: m, center: c, label: label, base: label, avgKm: ds.length ? ds.reduce(function (a, d) { return a + d.km; }, 0) / ds.length : null };
    }).sort(function (a, b) { return b.members.length - a.members.length || (b.avgKm || 0) - (a.avgKm || 0); })
      .map(function (g, i, all) {   // ชื่อซ้ำ (หมู่เดียวกันแต่อยู่ห่างกัน) → เติมลำดับ
        const same = all.filter(function (x) { return x.base === g.base; });
        if (same.length > 1) g.label += ' (' + (same.indexOf(g) + 1) + ')';
        return g;
      });
  }
  function paneGroups() {
    const host = document.getElementById('gm-pane-groups');
    const gs = clusters();
    host.innerHTML = '<h3 class="card-title">🏘️ กลุ่มบ้าน / เส้นทางรถรับส่ง</h3>' +
      '<div class="gm-bar" style="margin-bottom:8px"><span class="tt-note">บ้านที่ห่างกันไม่เกิน</span><input type="number" class="form-control" data-r min="100" max="3000" step="100" value="' + V.groupR + '" style="max-width:100px"><span class="tt-note">เมตร = กลุ่มเดียวกัน</span>' +
        '<span style="flex:1"></span><button class="btn btn-primary" data-route' + (D.school ? '' : ' disabled') + '><i class="bi bi-bus-front"></i> วางเส้นทางรถรับส่ง (กลุ่มที่เลือก)</button>' +
        (V.route ? '<button class="btn btn-secondary" data-clear>ล้างเส้นทาง</button>' : '') + '</div>' +
      (V.route ? routeHtml() : '') +
      (!gs.length ? '<div class="text-muted">ยังไม่มีพิกัดบ้าน</div>' : '<div class="table-wrap"><table class="tt-results gm-list"><thead><tr><th></th><th>กลุ่ม</th><th>จำนวน</th><th>ชั้น</th><th>ระยะเฉลี่ย</th><th>รายชื่อ</th></tr></thead><tbody>' +
        gs.map(function (g) {
          const key = g.members.map(function (s) { return s.citizen_id; }).sort().join(',');
          return '<tr data-g="' + g.id + '"><td><input type="checkbox" data-gsel="' + esc(key) + '"' + (V.groupSel[key] ? ' checked' : '') + '></td><td><strong>' + esc(g.label) + '</strong></td><td>' + g.members.length + '</td>' +
            '<td>' + esc(g.members.map(cls).filter(function (x, i, a) { return a.indexOf(x) === i; }).join(', ')) + '</td><td>' + (g.avgKm != null ? GeoUtil.fmtKm(g.avgKm) : '-') + '</td>' +
            '<td class="tt-note">' + esc(g.members.map(function (s) { return s.first_name; }).join(', ')) + '</td></tr>';
        }).join('') + '</tbody></table></div>') +
      '<p class="tt-note" style="margin:8px 0 0">เส้นทางรถเรียงจุดรับจากโรงเรียนไปจุดที่ใกล้ที่สุดถัดไปเรื่อย ๆ (ประมาณ — ใช้วางแผนเบื้องต้น) · ติ๊ก "🏘️ กลุ่มบ้าน" ด้านบนเพื่อแสดงกลุ่มบนแผนที่</p>';
    host.querySelector('[data-r]').onchange = function () { V.groupR = Math.max(100, Math.min(3000, Number(this.value) || 600)); V.groupSel = {}; paneGroups(); if (document.getElementById('gm-groups').checked) renderMap(false); };
    host.querySelectorAll('[data-gsel]').forEach(function (c) { c.onchange = function () { if (c.checked) V.groupSel[c.dataset.gsel] = 1; else delete V.groupSel[c.dataset.gsel]; }; });
    host.querySelectorAll('tbody tr').forEach(function (tr) {
      tr.onclick = function (ev) { if (ev.target.closest('input')) return; const g = gs.find(function (x) { return x.id === tr.dataset.g; }); map.setView([g.center.lat, g.center.lng], 16); document.getElementById('gm-map').scrollIntoView({ behavior: 'smooth', block: 'center' }); };
    });
    host.querySelector('[data-route]').onclick = function () {
      const sel = gs.filter(function (g) { return V.groupSel[g.members.map(function (s) { return s.citizen_id; }).sort().join(',')]; });
      if (!sel.length) { Toast.show('ติ๊กเลือกกลุ่มที่รถต้องไปรับก่อน', 'warning'); return; }
      V.route = planRoute(sel);
      paneGroups(); renderMap(false);
    };
    const cl = host.querySelector('[data-clear]');
    if (cl) cl.onclick = function () { V.route = null; paneGroups(); renderMap(false); };
  }
  /** เรียงจุดรับแบบ nearest-neighbor จากโรงเรียน · ระยะ = เส้นตรง × ตัวคูณถนน */
  function planRoute(groups) {
    const left = groups.slice(), stops = [];
    let cur = D.school, total = 0;
    while (left.length) {
      let bi = 0, bd = Infinity;
      left.forEach(function (g, i) { const d = GeoUtil.km(cur, g.center); if (d < bd) { bd = d; bi = i; } });
      const g = left.splice(bi, 1)[0];
      total += bd; g.legKm = bd * D.speeds.road_factor; g.cumKm = total * D.speeds.road_factor;
      stops.push(g); cur = g.center;
    }
    const back = GeoUtil.km(cur, D.school);
    return { stops: stops, back: true, oneWayKm: total * D.speeds.road_factor, totalKm: (total + back) * D.speeds.road_factor };
  }
  function routeHtml() {
    const r = V.route, n = r.stops.reduce(function (a, g) { return a + g.members.length; }, 0);
    return '<div class="alert alert-info" style="font-size:14px"><strong>🚐 เส้นทางรถรับส่ง (ประมาณ)</strong> · ' + r.stops.length + ' จุด · ' + n + ' คน · ขาไป ≈' + GeoUtil.fmtKm(r.oneWayKm) +
      ' · ไป–กลับ ≈' + GeoUtil.fmtKm(r.totalKm) + ' · ใช้เวลาขับ ≈' + GeoUtil.fmtMin(r.oneWayKm / D.speeds.car * 60) + ' (ไม่รวมเวลาจอดรับ)' +
      '<ol style="margin:6px 0 0 18px">' + r.stops.map(function (g) { return '<li>' + esc(g.label) + ' — ' + g.members.length + ' คน (+' + GeoUtil.fmtKm(g.legKm) + ', สะสม ' + GeoUtil.fmtKm(g.cumKm) + ')</li>'; }).join('') + '<li>กลับโรงเรียน</li></ol></div>';
  }

  // ── (6) จุดเสี่ยง ──
  function hazardPopup(p) {
    const ss = passing(p);
    return '<div class="gp-name">' + esc(GeoUtil.POINT_TYPES[p.type] || '⚠️') + ' · ' + esc(p.name) + '</div>' + (p.note ? '<div>' + esc(p.note) + '</div>' : '') +
      '<div class="tt-note">รัศมี ' + (p.radius_m || 150) + ' ม. · ' + esc(p.updated_by || '') + '</div>' +
      '<div style="margin-top:4px"><strong>นักเรียนที่ต้องผ่าน (ประมาณ): ' + ss.length + ' คน</strong></div>' +
      (ss.length ? '<div class="tt-note">' + esc(ss.slice(0, 15).map(function (s) { return s.first_name + ' (' + cls(s) + ')'; }).join(', ')) + (ss.length > 15 ? ' …' : '') + '</div>' : '') +
      (can('geo_edit') ? '<button class="btn btn-secondary" data-hedit>✏️ แก้ไข</button><button class="btn btn-danger" data-hdel>🗑️ ลบ</button>' : '');
  }
  function bindHazardPopup(root, p) {
    const e = root.querySelector('[data-hedit]'), d = root.querySelector('[data-hdel]');
    if (e) e.onclick = function () { map.closePopup(); hazardForm(p); };
    if (d) d.onclick = async function () {
      if (!confirm('ลบจุดเสี่ยง "' + p.name + '"?')) return;
      try { await api('geo.point_delete', { point_id: p.point_id }, { loadingMsg: 'กำลังลบ...', noRetry: true }); map.closePopup(); await refresh(); } catch (x) { /* toast */ }
    };
  }
  function startPick() {
    V.picking = 'hazard';
    document.getElementById('gm-map').classList.add('picking');
    document.getElementById('gm-pick').innerHTML = '<div class="gm-pick-hint">⚠️ แตะบนแผนที่ตรงจุดเสี่ยง (ถนนใหญ่ แม่น้ำ จุดน้ำท่วม ฯลฯ) <button class="btn btn-secondary" data-stop style="padding:2px 10px;font-size:13px;margin-left:8px">ยกเลิก</button></div>';
    document.querySelector('#gm-pick [data-stop]').onclick = stopPick;
    document.getElementById('gm-map').scrollIntoView({ behavior: 'smooth', block: 'center' });
  }
  function stopPick() { V.picking = null; document.getElementById('gm-map').classList.remove('picking'); document.getElementById('gm-pick').innerHTML = ''; }
  function hazardForm(p) {
    const el = modal('<h3 class="modal-title">⚠️ ' + (p.point_id ? 'แก้ไขจุดเสี่ยง' : 'เพิ่มจุดเสี่ยง') + '</h3><div class="tt-form">' +
      '<div><label>ประเภท</label><select class="form-control" data-type>' + Object.keys(GeoUtil.POINT_TYPES).map(function (k) { return '<option value="' + k + '"' + (p.type === k ? ' selected' : '') + '>' + GeoUtil.POINT_TYPES[k] + '</option>'; }).join('') + '</select></div>' +
      '<div><label>รัศมีพื้นที่เสี่ยง (เมตร)</label><input class="form-control" type="number" data-radius min="20" max="2000" value="' + (p.radius_m || 150) + '"></div>' +
      '<div class="full"><label>ชื่อ</label><input class="form-control" data-name maxlength="80" value="' + esc(p.name || '') + '" placeholder="เช่น ทางแยกถนนสายหลักหน้าตลาด"></div>' +
      '<div class="full"><label>รายละเอียด (ไม่บังคับ)</label><input class="form-control" data-note maxlength="300" value="' + esc(p.note || '') + '" placeholder="เช่น รถวิ่งเร็ว ไม่มีทางม้าลาย"></div>' +
      '</div><div class="tt-note">📍 ' + p.lat.toFixed(6) + ', ' + p.lng.toFixed(6) + '</div>' +
      '<div class="flex" style="justify-content:flex-end;gap:8px;margin-top:12px"><button class="btn btn-secondary" data-x>ยกเลิก</button><button class="btn btn-primary" data-ok>บันทึก</button></div>');
    el.querySelector('[data-ok]').onclick = async function () {
      try {
        await api('geo.point_save', { point_id: p.point_id, type: el.querySelector('[data-type]').value, name: el.querySelector('[data-name]').value, note: el.querySelector('[data-note]').value,
          radius_m: Number(el.querySelector('[data-radius]').value), lat: p.lat, lng: p.lng }, { loadingMsg: 'กำลังบันทึก...', noRetry: true });
        el.close(); Toast.show('บันทึกจุดเสี่ยงแล้ว', 'success'); await refresh();
      } catch (e) { /* toast */ }
    };
  }
  function paneHazards() {
    const host = document.getElementById('gm-pane-hazards');
    host.innerHTML = '<div class="flex" style="justify-content:space-between;flex-wrap:wrap;gap:8px;margin-bottom:8px"><h3 class="card-title" style="margin:0">⚠️ จุดเสี่ยงบนเส้นทาง</h3>' +
        (can('geo_edit') ? '<button class="btn btn-primary" data-add><i class="bi bi-plus-lg"></i> เพิ่มจุดเสี่ยง</button>' : '') + '</div>' +
      (!D.points.length ? '<div class="text-muted">ยังไม่มีจุดเสี่ยง</div>' : '<div class="table-wrap"><table class="tt-results gm-list"><thead><tr><th>ประเภท</th><th>ชื่อ</th><th>รัศมี</th><th>นักเรียนที่ต้องผ่าน</th><th>รายชื่อ</th></tr></thead><tbody>' +
        D.points.map(function (p, i) {
          const ss = passing(p).filter(function (s) { return !V.filter || cls(s) === V.filter; });
          return '<tr data-i="' + i + '"><td>' + esc(GeoUtil.POINT_TYPES[p.type] || '⚠️') + '</td><td><strong>' + esc(p.name) + '</strong>' + (p.note ? '<div class="tt-note">' + esc(p.note) + '</div>' : '') + '</td><td>' + (p.radius_m || 150) + ' ม.</td>' +
            '<td><strong>' + ss.length + '</strong> คน</td><td class="tt-note">' + esc(ss.map(function (s) { return s.first_name + ' (' + cls(s) + ')'; }).join(', ') || '-') + '</td></tr>';
        }).join('') + '</tbody></table></div>') +
      '<p class="tt-note" style="margin:8px 0 0">"ต้องผ่าน" = จุดเสี่ยงอยู่ใกล้แนวเส้นตรงบ้าน–โรงเรียนภายในรัศมีที่ตั้ง (ประมาณ) · ใช้ประกอบการแนะนำเส้นทางและแจ้งผู้ปกครอง</p>';
    host.querySelectorAll('tbody tr').forEach(function (tr) {
      tr.onclick = function () { const p = D.points[Number(tr.dataset.i)]; document.getElementById('gm-hazards').checked = true; renderMap(false); map.setView([p.lat, p.lng], 16); document.getElementById('gm-map').scrollIntoView({ behavior: 'smooth', block: 'center' }); };
    });
    const add = host.querySelector('[data-add]');
    if (add) add.onclick = startPick;
  }

  /* ════ (4) ลิงก์ผู้ปกครอง ════ */
  function selectedOrMissing() {
    const sel = Object.keys(V.selected);
    if (sel.length) return sel;
    return shown().filter(function (s) { return !s.home; }).map(function (s) { return s.citizen_id; });
  }
  async function linksFor(ids) {
    if (!ids.length) { Toast.show('ไม่มีนักเรียนที่ต้องส่งลิงก์ (ทุกคนมีพิกัดแล้ว) — เลือกเองในแท็บรายชื่อ', 'info'); return; }
    if (!confirm('สร้างลิงก์ให้ผู้ปกครองส่งพิกัดบ้าน ' + ids.length + ' คน?\n\nลิงก์ใช้ได้คนละ 1 ครั้ง ภายใน 14 วัน · ลิงก์เดิมที่ยังไม่ใช้ของนักเรียนคนเดียวกันจะถูกยกเลิก')) return;
    let r;
    try { r = await api('geo.link_create', { citizen_ids: ids }, { loadingMsg: 'กำลังสร้างลิงก์...', noRetry: true }); } catch (e) { return; }
    const base = location.href.replace(/[^/]*([?#].*)?$/, '') + 'home-pin.html?t=';
    const rows = r.links.map(function (l) { const s = D.students.find(function (x) { return x.citizen_id === l.citizen_id; }); return { s: s, url: base + l.token }; });
    const text = rows.map(function (x) { return x.s.first_name + ' (' + cls(x.s) + '): ' + x.url; }).join('\n');
    const el = modal('<h3 class="modal-title">🔗 ลิงก์ให้ผู้ปกครองส่งพิกัด (' + rows.length + ' คน)</h3>' +
      '<div class="alert alert-warning" style="font-size:14px">ลิงก์จะแสดง<strong>ครั้งเดียว</strong> — คัดลอกหรือพิมพ์ QR ตอนนี้ · ใช้ได้คนละ 1 ครั้ง ถึง ' + esc(Utils.fmtDateTime(r.expires_at)) + ' · ส่งเฉพาะผู้ปกครองของนักเรียนคนนั้น</div>' +
      '<div class="gm-bar" style="margin-bottom:8px"><button class="btn btn-primary" data-copyall><i class="bi bi-clipboard"></i> คัดลอกทั้งหมด (ส่งไลน์)</button><button class="btn btn-secondary" data-qr><i class="bi bi-qr-code"></i> พิมพ์ QR</button></div>' +
      '<div class="table-wrap" style="max-height:50vh;overflow:auto"><table class="tt-results"><thead><tr><th>นักเรียน</th><th>ลิงก์</th><th></th></tr></thead><tbody>' +
      rows.map(function (x, i) { return '<tr><td>' + esc(name(x.s)) + '<div class="tt-note">' + esc(cls(x.s)) + '</div></td><td><input class="form-control" readonly value="' + esc(x.url) + '" style="font-size:12px"></td><td><button class="btn btn-secondary" data-copy="' + i + '"><i class="bi bi-clipboard"></i></button></td></tr>'; }).join('') +
      '</tbody></table></div><div class="flex" style="justify-content:flex-end;margin-top:12px"><button class="btn btn-secondary" data-x>ปิด</button></div>');
    const copy = async function (t) { try { await navigator.clipboard.writeText(t); Toast.show('คัดลอกแล้ว', 'success'); } catch (e) { prompt('คัดลอกข้อความนี้', t); } };
    el.querySelector('[data-copyall]').onclick = function () { copy(text); };
    el.querySelectorAll('[data-copy]').forEach(function (b) { b.onclick = function () { copy(rows[Number(b.dataset.copy)].url); }; });
    el.querySelector('[data-qr]').onclick = async function () {
      try { await LazyLib.script(QR_URL); } catch (e) { Toast.show('โหลดตัวสร้าง QR ไม่สำเร็จ', 'danger'); return; }
      const w = window.open('', '_blank');
      if (!w) { Toast.show('เบราว์เซอร์บล็อกหน้าต่างใหม่ — อนุญาต pop-up แล้วลองอีกครั้ง', 'warning'); return; }
      const cards = rows.map(function (x) {
        const q = qrcode(0, 'M'); q.addData(x.url); q.make();
        return '<div class="c"><img src="' + q.createDataURL(4, 8) + '"><div class="n">' + esc(name(x.s)) + '</div><div class="k">' + esc(cls(x.s)) + '</div><div class="h">สแกนเพื่อส่งพิกัดบ้าน (ใช้ได้ 1 ครั้ง)</div></div>';
      }).join('');
      w.document.write('<!doctype html><html lang="th"><head><meta charset="utf-8"><title>QR ส่งพิกัดบ้าน</title><style>body{font-family:sans-serif;margin:12mm}.g{display:grid;grid-template-columns:repeat(3,1fr);gap:8mm}' +
        '.c{border:1px dashed #999;border-radius:8px;padding:6mm;text-align:center;break-inside:avoid}.c img{width:38mm;height:38mm}.n{font-weight:700;margin-top:2mm}.k{color:#555}.h{font-size:11px;color:#777;margin-top:2mm}</style></head>' +
        '<body><div class="g">' + cards + '</div><script>window.onload=function(){window.print()}<\/script></body></html>');
      w.document.close();
    };
  }

  /* ════ ตั้งค่า (ผู้ดูแล) ════ */
  function settings() {
    const sp = D.speeds, op = D.options;
    const el = modal('<h3 class="modal-title">⚙️ ตั้งค่าแผนที่</h3>' +
      '<h4 style="margin:4px 0">ใครเห็นนักเรียนคนไหน</h4>' +
      '<label class="tt-chip"><input type="radio" name="gm-scope" value="homeroom"' + (op.teacher_scope === 'homeroom' ? ' checked' : '') + '> ครูเห็นเฉพาะนักเรียนชั้นที่ตนเป็นครูประจำชั้น</label> ' +
      '<label class="tt-chip"><input type="radio" name="gm-scope" value="all"' + (op.teacher_scope === 'all' ? ' checked' : '') + '> ครูเห็นทั้งโรงเรียน</label>' +
      '<p class="tt-note">ผู้ดูแลระบบ · ผู้บริหาร · ฝ่ายวิชาการ เห็นทั้งโรงเรียนเสมอ · ครูต้องผูกบัญชีกับ "ครู" (แท็บผู้ใช้) และเป็นครูประจำชั้นในหน้าจัดตารางสอน (ภาคเรียนปัจจุบัน)</p>' +
      '<h4 style="margin:12px 0 4px">ความเร็วเฉลี่ยสำหรับประมาณเวลา</h4><div class="tt-form">' +
        '<div><label>🚶 เดิน (กม./ชม.)</label><input class="form-control" type="number" step="0.5" data-k="walk" value="' + sp.walk + '"></div>' +
        '<div><label>🛵 จักรยานยนต์ (กม./ชม.)</label><input class="form-control" type="number" data-k="moto" value="' + sp.moto + '"></div>' +
        '<div><label>🚗 รถยนต์ (กม./ชม.)</label><input class="form-control" type="number" data-k="car" value="' + sp.car + '"></div>' +
        '<div><label>ตัวคูณระยะถนน</label><input class="form-control" type="number" step="0.05" data-k="road_factor" value="' + sp.road_factor + '"></div>' +
        '<div><label>เกณฑ์ "บ้านไกล" (กม.)</label><input class="form-control" type="number" step="0.5" data-far value="' + op.far_km + '"></div>' +
      '</div><div class="flex" style="justify-content:flex-end;gap:8px;margin-top:12px"><button class="btn btn-secondary" data-x>ยกเลิก</button><button class="btn btn-primary" data-ok>บันทึก</button></div>');
    el.querySelector('[data-ok]').onclick = async function () {
      const v = {};
      el.querySelectorAll('[data-k]').forEach(function (i) { v[i.dataset.k] = Number(i.value); });
      try {
        const r = await api('geo.save_config', { speeds: v, options: { teacher_scope: el.querySelector('[name=gm-scope]:checked').value, far_km: Number(el.querySelector('[data-far]').value) } }, { loadingMsg: 'กำลังบันทึก...', noRetry: true });
        D.speeds = r.speeds; D.options = r.options; el.close(); Toast.show('บันทึกแล้ว', 'success'); renderAll(false);
      } catch (e) { /* toast */ }
    };
  }

  function renderAll(fit) { renderControls(); renderStats(); renderMap(fit); renderPane(); }
  async function refresh() { try { await load(); renderAll(false); } catch (e) { /* toast */ } }

  document.getElementById('gm-class').onchange = function () { V.filter = this.value; V.focus = ''; V.route = null; renderStats(); renderMap(true); renderPane(); };
  document.getElementById('gm-find').addEventListener('change', function () {
    const v = this.value;
    const s = D.students.find(function (x) { return v === name(x) + ' (' + cls(x) + ')' || (x.student_code && v === x.student_code); });
    if (s) showOne(s.citizen_id);
    this.value = '';
  });
  ['gm-rings', 'gm-labels', 'gm-hazards', 'gm-heat', 'gm-groups'].forEach(function (id) { document.getElementById(id).onchange = function () { renderMap(false); }; });
  document.querySelectorAll('#gm-tabs .tab').forEach(function (t) { t.onclick = function () { V.tab = t.dataset.tab; renderPane(); }; });

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
