/**
 * หน้าสาธารณะสำหรับผู้ปกครอง (home-pin.html?t=<token>) — ส่งพิกัดบ้านนักเรียนด้วยลิงก์ที่ครูสร้างให้
 *   ไม่ต้องเข้าสู่ระบบ · ลิงก์ใช้ได้ 1 ครั้งและมีวันหมดอายุ · เห็นเฉพาะชื่อจริงและชั้นของนักเรียน
 *   ผลที่ส่งจะขึ้นบนแผนที่ของโรงเรียนเป็น "📨 ผู้ปกครองส่งมา" ให้ครูตรวจและยืนยัน
 */
(function () {
  const esc = Utils.esc;
  const main = document.getElementById('hp-main');
  const token = new URLSearchParams(location.search).get('t') || '';
  let map, marker = null, pos = null, info = null;

  function fail(msg) {
    main.innerHTML = '<div class="card hp-done"><div class="ic">🔒</div><h2>ใช้ลิงก์นี้ไม่ได้</h2><p>' + esc(msg) + '</p><p class="hp-note">ติดต่อครูประจำชั้นเพื่อขอลิงก์ใหม่</p></div>';
  }

  function render() {
    const who = info.first_name + ' (ชั้น ' + info.grade + (info.room ? '/' + info.room : '') + ')';
    main.innerHTML = '<div class="card"><h2 class="card-title" style="margin-bottom:6px">บ้านของ ' + esc(who) + '</h2>' +
      '<ol class="hp-steps"><li>อยู่ที่บ้านแล้วกด <strong>"ใช้ตำแหน่งปัจจุบัน"</strong> หรือแตะ/ลากหมุดบนแผนที่ไปที่บ้าน</li><li>สลับเป็น "ภาพดาวเทียม" มุมขวาบนเพื่อดูหลังคาบ้านได้ชัดขึ้น</li><li>เลือกวิธีเดินทาง แล้วกด <strong>"ส่งพิกัด"</strong></li></ol>' +
      '<div class="hp-tools"><button class="btn btn-primary" data-gps type="button"><i class="bi bi-crosshair"></i> ใช้ตำแหน่งปัจจุบัน (GPS)</button></div>' +
      '<div class="hp-map" id="hp-map"></div><div class="geo-info" data-info>ยังไม่ได้เลือกตำแหน่ง</div>' +
      '<label style="margin-top:10px">นักเรียนเดินทางมาโรงเรียนอย่างไร</label><select class="form-control" data-travel><option value="">— เลือก —</option>' +
        Object.keys(GeoUtil.MODES).map(function (k) { return '<option value="' + k + '">' + GeoUtil.MODES[k] + '</option>'; }).join('') + '</select>' +
      '<label style="margin-top:10px">จุดสังเกต (ไม่บังคับ)</label><input class="form-control" data-note maxlength="200" placeholder="เช่น บ้านหลังที่ 2 ซ้ายมือหลังวัด">' +
      '<button class="btn btn-success hp-big" data-send disabled><i class="bi bi-send"></i> ส่งพิกัด</button>' +
      '<p class="hp-note" style="margin-top:10px">🔒 ตำแหน่งนี้ส่งถึงโรงเรียนเท่านั้น ใช้เพื่อดูแลความปลอดภัยและการเดินทางของนักเรียน · ลิงก์ใช้ได้ครั้งเดียว ถึง ' + esc(Utils.fmtDateTime(info.expires_at)) + '</p></div>';

    map = L.map('hp-map');
    GeoUtil.addLayers(map, 'street');
    if (info.school) {
      L.marker([info.school.lat, info.school.lng], { icon: GeoUtil.schoolIcon(), interactive: false }).addTo(map);
      map.setView([info.school.lat, info.school.lng], 14);
    } else map.setView([13.0, 101.0], 6);
    map.on('click', function (e) { place(e.latlng.lat, e.latlng.lng, null); });
    main.querySelector('[data-gps]').onclick = gps;
    main.querySelector('[data-send]').onclick = send;
  }

  function place(lat, lng, acc) {
    pos = { lat: lat, lng: lng, accuracy: acc };
    if (!marker) {
      marker = L.marker([lat, lng], { draggable: true, icon: GeoUtil.homeIcon(), autoPan: true }).addTo(map);
      marker.on('dragend', function () { const p = marker.getLatLng(); pos = { lat: p.lat, lng: p.lng, accuracy: null }; showInfo(); });
    } else marker.setLatLng([lat, lng]);
    showInfo();
  }
  function showInfo() {
    let h = '📍 ' + pos.lat.toFixed(6) + ', ' + pos.lng.toFixed(6) + (pos.accuracy ? ' (แม่นยำ ±' + Math.round(pos.accuracy) + ' ม.)' : '');
    if (info.school) h += '<br>ห่างโรงเรียนประมาณ ' + GeoUtil.fmtKm(GeoUtil.km(info.school, pos) * 1.3);
    main.querySelector('[data-info]').innerHTML = h;
    main.querySelector('[data-send]').disabled = false;
  }
  function gps() {
    if (!navigator.geolocation) { Toast.show('อุปกรณ์นี้ไม่รองรับ GPS — แตะบนแผนที่แทน', 'warning'); return; }
    const b = main.querySelector('[data-gps]');
    b.disabled = true; b.innerHTML = 'กำลังหาตำแหน่ง...';
    navigator.geolocation.getCurrentPosition(function (p) {
      b.disabled = false; b.innerHTML = '<i class="bi bi-crosshair"></i> ใช้ตำแหน่งปัจจุบัน (GPS)';
      place(p.coords.latitude, p.coords.longitude, p.coords.accuracy);
      map.setView([p.coords.latitude, p.coords.longitude], 18);
      if (p.coords.accuracy > 100) Toast.show('ตำแหน่งยังไม่แม่นยำ (±' + Math.round(p.coords.accuracy) + ' ม.) — ลากหมุดให้ตรงบ้านอีกครั้ง', 'warning', 6000);
    }, function (e) {
      b.disabled = false; b.innerHTML = '<i class="bi bi-crosshair"></i> ใช้ตำแหน่งปัจจุบัน (GPS)';
      Toast.show(e.code === 1 ? 'ไม่ได้รับอนุญาตให้ใช้ตำแหน่ง — อนุญาตในเบราว์เซอร์ หรือแตะบนแผนที่แทน' : 'หาตำแหน่งไม่ได้ — แตะบนแผนที่แทน', 'warning', 6000);
    }, { enableHighAccuracy: true, timeout: 20000, maximumAge: 0 });
  }
  async function send() {
    if (!pos) return;
    if (!confirm('ยืนยันส่งพิกัดบ้านของ ' + info.first_name + '?\n(ลิงก์นี้ใช้ได้ครั้งเดียว)')) return;
    try {
      await api('geo.link_submit', { token: token, lat: pos.lat, lng: pos.lng, accuracy: pos.accuracy, travel: main.querySelector('[data-travel]').value, note: main.querySelector('[data-note]').value },
        { loadingMsg: 'กำลังส่ง...', token: null, noRetry: true });
      main.innerHTML = '<div class="card hp-done"><div class="ic">✅</div><h2>ส่งพิกัดเรียบร้อย ขอบคุณครับ/ค่ะ</h2><p>ครูประจำชั้นจะตรวจสอบตำแหน่งอีกครั้ง</p><p class="hp-note">ปิดหน้านี้ได้เลย</p></div>';
    } catch (e) {
      if (/LINK_|ลิงก์/.test(String(e.code || '') + e.message)) fail(e.message);
    }
  }

  (async function () {
    if (!/^[0-9a-f]{64}$/.test(token)) { fail('ลิงก์ไม่ครบหรือไม่ถูกต้อง'); return; }
    try {
      info = await api('geo.link_info', { token: token }, { loadingMsg: 'กำลังตรวจสอบลิงก์...', token: null, silent: true });
    } catch (e) { fail(e.message || 'ลิงก์ไม่ถูกต้อง'); return; }
    if (info.school_name) { document.getElementById('hp-school').textContent = info.school_name; document.title = 'ส่งพิกัดบ้านนักเรียน — ' + info.school_name; }
    try { Loading.show('กำลังโหลดแผนที่...'); await GeoUtil.load(); render(); }
    catch (e) { fail('โหลดแผนที่ไม่สำเร็จ — ตรวจสอบอินเทอร์เน็ตแล้วเปิดลิงก์อีกครั้ง'); }
    finally { Loading.hide(); }
  })();
})();
