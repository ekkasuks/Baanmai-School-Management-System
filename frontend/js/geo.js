/**
 * แผนที่บ้านนักเรียน — ส่วนที่ใช้ร่วมกัน (หน้าแผนที่ map.html และหน้าข้อมูลนักเรียน students.html)
 *   GeoUtil   : โหลด Leaflet · ชั้นแผนที่ (ถนน/ดาวเทียม) · ระยะทาง · ประมาณเวลาเดินทาง · เส้นทางถนนจริง (OSRM)
 *   GeoPicker : หน้าต่างปักหมุด — อ่านจาก GPS ของอุปกรณ์ / ลากหมุด / แตะบนแผนที่ / วางพิกัดหรือลิงก์ Google Maps → บันทึก
 * ข้อมูลพิกัดต้องเข้าสู่ระบบ (TTAuth) · ประมาณเวลาคำนวณในเครื่อง (ไม่ส่งข้อมูลออก) · เส้นทางถนนจริงส่งเฉพาะพิกัด 2 จุด เมื่อกดปุ่มเท่านั้น
 */
const GeoUtil = (function () {
  const LEAFLET = 'https://cdn.jsdelivr.net/npm/leaflet@1.9.4/dist/';
  let loading = null;

  function load() {
    if (window.L) return Promise.resolve();
    if (!loading) {
      const css = document.createElement('link');
      css.rel = 'stylesheet'; css.href = LEAFLET + 'leaflet.css';
      document.head.appendChild(css);
      loading = LazyLib.script(LEAFLET + 'leaflet.js').catch(function (e) { loading = null; throw e; });
    }
    return loading;
  }

  /** ชั้นแผนที่: ถนน (OpenStreetMap) + ดาวเทียม (Esri) พร้อมปุ่มสลับ */
  function addLayers(map, start) {
    const street = L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '© OpenStreetMap' });
    const sat = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', { maxZoom: 19, attribution: 'ภาพ © Esri' });
    (start === 'sat' ? sat : street).addTo(map);
    L.control.layers({ 'แผนที่ถนน': street, 'ภาพดาวเทียม': sat }, null, { position: 'topright' }).addTo(map);
    return { street: street, sat: sat };
  }

  function km(a, b) {   // ระยะเส้นตรง (haversine)
    const R = 6371, rad = Math.PI / 180;
    const dLat = (b.lat - a.lat) * rad, dLng = (b.lng - a.lng) * rad;
    const x = Math.sin(dLat / 2) * Math.sin(dLat / 2) + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLng / 2) * Math.sin(dLng / 2);
    return 2 * R * Math.asin(Math.sqrt(x));
  }
  /** ประมาณ: ระยะถนน ≈ เส้นตรง × road_factor · เวลา = ระยะ ÷ ความเร็วเฉลี่ย */
  function estimate(a, b, sp) {
    const line = km(a, b), road = line * (Number(sp.road_factor) || 1.3);
    return { line: line, road: road, walk: road / sp.walk * 60, moto: road / sp.moto * 60, car: road / sp.car * 60 };
  }
  function fmtKm(x) { return x < 1 ? Math.round(x * 1000) + ' ม.' : (Math.round(x * 10) / 10) + ' กม.'; }
  function fmtMin(m) {
    if (!isFinite(m)) return '-';
    if (m < 1) return '< 1 นาที';
    if (m < 60) return Math.round(m) + ' นาที';
    return Math.floor(m / 60) + ' ชม. ' + Math.round(m % 60) + ' นาที';
  }
  /** เส้นทางถนนจริงจาก OSRM (FOSSGIS) — เดิน + รถยนต์ · จักรยานยนต์ = ระยะเส้นทางรถ ÷ ความเร็วจักรยานยนต์ */
  async function route(a, b, sp) {
    const q = a.lng + ',' + a.lat + ';' + b.lng + ',' + b.lat + '?overview=false';
    const get = async function (profile) {
      const r = await fetch('https://routing.openstreetmap.de/routed-' + profile + '/route/v1/' + (profile === 'foot' ? 'foot' : 'driving') + '/' + q);
      const j = await r.json();
      if (j.code !== 'Ok' || !j.routes || !j.routes.length) throw new Error('หาเส้นทางไม่ได้');
      return j.routes[0];
    };
    const [car, foot] = await Promise.all([get('car'), get('foot')]);
    return { car_km: car.distance / 1000, car: car.duration / 60, foot_km: foot.distance / 1000, walk: foot.duration / 60, moto: car.distance / 1000 / sp.moto * 60 };
  }
  /** วางข้อความ "13.12, 100.45" หรือลิงก์ Google Maps (@lat,lng / q=lat,lng) → {lat,lng} */
  function parseCoords(text) {
    const t = String(text || '');
    const m = t.match(/@(-?\d+\.\d+),\s*(-?\d+\.\d+)/) || t.match(/[?&](?:q|query|ll|destination)=(-?\d+\.\d+),\s*(-?\d+\.\d+)/) || t.match(/(-?\d{1,2}\.\d{3,})\s*[, ]\s*(-?\d{2,3}\.\d{3,})/);
    if (!m) return null;
    const lat = Number(m[1]), lng = Number(m[2]);
    return isFinite(lat) && isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180 ? { lat: lat, lng: lng } : null;
  }
  const schoolIcon = function () { return L.divIcon({ className: 'geo-school', html: '🏫', iconSize: [34, 34], iconAnchor: [17, 17] }); };
  const homeIcon = function () { return L.divIcon({ className: 'geo-home-pin', html: '🏠', iconSize: [32, 32], iconAnchor: [16, 28] }); };

  return { load: load, addLayers: addLayers, km: km, estimate: estimate, fmtKm: fmtKm, fmtMin: fmtMin, route: route, parseCoords: parseCoords, schoolIcon: schoolIcon, homeIcon: homeIcon };
})();

const GeoPicker = (function () {
  const esc = function (s) { return Utils.esc(s); };

  /**
   * opts = { mode:'home'|'school', citizen_id?, label?, onSaved?(result) }
   * home: ต้องมีสิทธิ์ geo_edit · school: ต้องมีสิทธิ์ geo_admin
   */
  async function open(opts) {
    const mode = opts.mode || 'home';
    await TTAuth.require({});
    const cap = mode === 'school' ? 'geo_admin' : 'geo_edit';
    if (!TTAuth.can(cap)) { Toast.show(mode === 'school' ? 'เฉพาะผู้ดูแลระบบตั้งพิกัดโรงเรียนได้' : 'บัญชีนี้ไม่มีสิทธิ์บันทึกพิกัดบ้าน', 'warning'); return; }
    let ctx;
    try {
      Loading.show('กำลังโหลดแผนที่...');
      await GeoUtil.load();
      ctx = mode === 'school' ? await api('geo.bootstrap', {}, { loading: false }) : await api('geo.home', { citizen_id: opts.citizen_id }, { loading: false });
    } catch (e) { Toast.show(e.message || 'โหลดแผนที่ไม่สำเร็จ', 'danger'); return; }
    finally { Loading.hide(); }

    const school = ctx.school, sp = ctx.speeds, cur = mode === 'school' ? school : ctx.student.home;
    const title = mode === 'school' ? '🏫 ตั้งพิกัดโรงเรียน' : '📍 พิกัดบ้าน · ' + esc(opts.label || (ctx.student.prefix + ctx.student.first_name + ' ' + ctx.student.last_name));
    const el = document.createElement('div');
    el.className = 'modal-backdrop show';
    el.innerHTML = '<div class="modal geo-modal"><h3 class="modal-title">' + title + '</h3>' +
      '<div class="geo-tools">' +
        '<button class="btn btn-primary" data-gps type="button"><i class="bi bi-crosshair"></i> อ่านพิกัดจาก GPS</button>' +
        '<input class="form-control" data-paste placeholder="หรือวางพิกัด / ลิงก์ Google Maps แล้วกด Enter">' +
      '</div>' +
      '<div class="geo-map" data-map></div>' +
      '<div class="tt-note" data-hint>แตะบนแผนที่ หรือลากหมุดไปที่บ้าน · สลับเป็น "ภาพดาวเทียม" ที่มุมขวาบนเพื่อดูหลังคาบ้าน</div>' +
      '<div class="geo-info" data-info></div>' +
      (mode === 'school' ? '<label>ชื่อสถานที่</label><input class="form-control" data-name maxlength="80" value="' + esc((school && school.name) || 'โรงเรียน') + '">'
        : '<label style="margin-top:8px">จุดสังเกต (ไม่บังคับ)</label><input class="form-control" data-note maxlength="200" placeholder="เช่น บ้านหลังที่ 2 ซ้ายมือหลังวัด" value="' + esc((cur && cur.note) || '') + '">') +
      '<div class="flex" style="justify-content:flex-end;gap:8px;flex-wrap:wrap;margin-top:12px">' +
        (mode === 'home' && cur ? '<button class="btn btn-danger" data-del type="button" style="margin-right:auto"><i class="bi bi-trash"></i> ลบพิกัด</button>' : '') +
        '<button class="btn btn-secondary" data-cancel type="button">ยกเลิก</button>' +
        '<button class="btn btn-success" data-save type="button" disabled><i class="bi bi-save"></i> บันทึกพิกัด</button></div></div>';
    document.body.appendChild(el);

    const start = cur ? [cur.lat, cur.lng] : school ? [school.lat, school.lng] : [13.0, 101.0];
    const map = L.map(el.querySelector('[data-map]'), { zoomControl: true }).setView(start, cur || school ? 17 : 6);
    GeoUtil.addLayers(map, cur || school ? 'sat' : 'street');
    if (school && mode === 'home') L.marker([school.lat, school.lng], { icon: GeoUtil.schoolIcon(), interactive: false }).addTo(map);
    let marker = null, accCircle = null, pos = cur ? { lat: cur.lat, lng: cur.lng } : null, source = cur ? cur.source : 'map', accuracy = cur ? cur.accuracy : null;
    const saveBtn = el.querySelector('[data-save]');

    function info() {
      if (!pos) { el.querySelector('[data-info]').innerHTML = ''; return; }
      let h = '<span>📌 ' + pos.lat.toFixed(6) + ', ' + pos.lng.toFixed(6) + '</span>' + (accuracy ? ' <span class="tt-note">(GPS ±' + Math.round(accuracy) + ' ม.)</span>' : '');
      if (mode === 'home' && school) {
        const e = GeoUtil.estimate(school, pos, sp);
        h += '<br>ห่างโรงเรียน ~' + GeoUtil.fmtKm(e.road) + ' · 🚶 ' + GeoUtil.fmtMin(e.walk) + ' · 🛵 ' + GeoUtil.fmtMin(e.moto) + ' · 🚗 ' + GeoUtil.fmtMin(e.car);
        if (e.line > 50) h += '<br><span class="text-danger">⚠️ ห่างโรงเรียนเกิน 50 กม. — ตรวจสอบตำแหน่งอีกครั้ง</span>';
      }
      el.querySelector('[data-info]').innerHTML = h;
    }
    function place(p, src, acc) {
      pos = { lat: p.lat, lng: p.lng }; source = src; accuracy = acc || null;
      if (!marker) {
        marker = L.marker([pos.lat, pos.lng], { draggable: true, icon: mode === 'school' ? GeoUtil.schoolIcon() : GeoUtil.homeIcon(), autoPan: true }).addTo(map);
        marker.on('dragend', function () { const ll = marker.getLatLng(); place({ lat: ll.lat, lng: ll.lng }, 'map'); });
      } else marker.setLatLng([pos.lat, pos.lng]);
      if (accCircle) { map.removeLayer(accCircle); accCircle = null; }
      if (accuracy) accCircle = L.circle([pos.lat, pos.lng], { radius: accuracy, color: '#0288D1', weight: 1, fillOpacity: 0.1 }).addTo(map);
      saveBtn.disabled = false;
      info();
    }
    if (cur) place(cur, cur.source, cur.accuracy);
    map.on('click', function (e) { place({ lat: e.latlng.lat, lng: e.latlng.lng }, 'map'); });
    setTimeout(function () { map.invalidateSize(); }, 50);

    el.querySelector('[data-gps]').onclick = function () {
      if (!navigator.geolocation) { Toast.show('อุปกรณ์นี้ไม่รองรับ GPS', 'warning'); return; }
      const b = this;
      b.disabled = true; b.innerHTML = '<i class="bi bi-hourglass-split"></i> กำลังอ่าน GPS...';
      navigator.geolocation.getCurrentPosition(function (p) {
        b.disabled = false; b.innerHTML = '<i class="bi bi-crosshair"></i> อ่านพิกัดจาก GPS อีกครั้ง';
        place({ lat: p.coords.latitude, lng: p.coords.longitude }, 'gps', p.coords.accuracy);
        map.setView([pos.lat, pos.lng], 18);
        if (p.coords.accuracy > 50) Toast.show('GPS แม่นยำ ±' + Math.round(p.coords.accuracy) + ' ม. — ออกไปที่โล่งแล้วอ่านใหม่ หรือลากหมุดให้ตรงหลังคาบ้าน', 'warning');
      }, function (err) {
        b.disabled = false; b.innerHTML = '<i class="bi bi-crosshair"></i> อ่านพิกัดจาก GPS';
        Toast.show(err.code === 1 ? 'ไม่ได้รับอนุญาตให้ใช้ตำแหน่ง — เปิดสิทธิ์ตำแหน่งให้เบราว์เซอร์' : 'อ่าน GPS ไม่สำเร็จ — ลองใหม่ หรือแตะบนแผนที่แทน', 'danger');
      }, { enableHighAccuracy: true, timeout: 20000, maximumAge: 0 });
    };
    el.querySelector('[data-paste]').addEventListener('keydown', function (e) {
      if (e.key !== 'Enter') return;
      e.preventDefault();
      const p = GeoUtil.parseCoords(this.value);
      if (!p) { Toast.show('อ่านพิกัดไม่ได้ — ตัวอย่าง: 13.123456, 100.123456', 'warning'); return; }
      place(p, 'manual');
      map.setView([p.lat, p.lng], 18);
    });
    const close = function () { map.remove(); el.remove(); };
    el.querySelector('[data-cancel]').onclick = close;
    saveBtn.onclick = async function () {
      if (!pos) return;
      try {
        let r;
        if (mode === 'school') r = await api('geo.save_config', { school: { lat: pos.lat, lng: pos.lng, name: el.querySelector('[data-name]').value } }, { loadingMsg: 'กำลังบันทึก...', noRetry: true });
        else r = await api('geo.save_home', { citizen_id: opts.citizen_id, lat: pos.lat, lng: pos.lng, accuracy: accuracy, source: source, note: el.querySelector('[data-note]').value }, { loadingMsg: 'กำลังบันทึก...', noRetry: true });
        close();
        Toast.show(mode === 'school' ? 'บันทึกพิกัดโรงเรียนแล้ว' : 'บันทึกพิกัดบ้านแล้ว', 'success');
        if (opts.onSaved) opts.onSaved(r);
      } catch (e) { /* toast แสดงแล้ว */ }
    };
    const del = el.querySelector('[data-del]');
    if (del) del.onclick = async function () {
      if (!confirm('ลบพิกัดบ้านของนักเรียนคนนี้?')) return;
      try {
        await api('geo.delete_home', { citizen_id: opts.citizen_id }, { loadingMsg: 'กำลังลบ...', noRetry: true });
        close();
        Toast.show('ลบพิกัดแล้ว', 'success');
        if (opts.onSaved) opts.onSaved({ home: null });
      } catch (e) { /* toast */ }
    };
  }
  return { open: open };
})();
window.GeoUtil = GeoUtil;
window.GeoPicker = GeoPicker;
