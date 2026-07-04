/**
 * Store — stale-while-revalidate + localStorage (ระดับ A: ทำให้รู้สึกเร็วเหมือนเว็บปกติ)
 *
 * แนวคิด: เปิดหน้าปุ๊บ แสดงข้อมูลล่าสุดที่เคยโหลด (จาก localStorage) ทันที
 *         แล้วดึงข้อมูลใหม่เบื้องหลังมาอัปเดตเสมอ (revalidate)
 *
 * ความปลอดภัยของข้อมูล:
 *  - cache แยกตามเครื่อง (localStorage) — ครูแต่ละคนไม่แชร์กัน
 *  - ใช้กับ "การแสดงผล" เท่านั้น; การบันทึกยังผ่าน server ที่ตรวจสอบ/ล็อกเสมอ
 *  - เมื่อเครื่องตัวเองบันทึกข้อมูล ให้เรียก Store.invalidate(prefix) เพื่อบังคับดึงใหม่
 */
const Store = (function () {
  const PREFIX = 'swr:';
  const MAX_AGE_MS = 24 * 3600 * 1000;      // เก็บ cache ได้ 1 วัน (กันข้อมูลข้ามวันค้าง)
  const REVALIDATE_THROTTLE_MS = 15000;     // ถ้าเพิ่งดึงสดในเซสชันนี้ < 15 วิ ไม่ยิงซ้ำ (กันถล่ม backend ตอนสลับแท็บ)

  const memFresh = {};                      // key -> { data, ts } ค่าที่ดึงสดล่าสุดในเซสชันนี้ (เร็วกว่า localStorage)

  function get(key) {
    try {
      const raw = localStorage.getItem(PREFIX + key);
      if (!raw) return null;
      const o = JSON.parse(raw);
      if (!o || typeof o.ts !== 'number') return null;
      if (Date.now() - o.ts > MAX_AGE_MS) { localStorage.removeItem(PREFIX + key); return null; }
      return o.data;
    } catch (e) { return null; }
  }

  function set(key, data) {
    try { localStorage.setItem(PREFIX + key, JSON.stringify({ ts: Date.now(), data: data })); }
    catch (e) { /* localStorage เต็ม/ปิด: ข้ามได้ ไม่กระทบการทำงาน */ }
  }

  function remove(key) {
    delete memFresh[key];
    try { localStorage.removeItem(PREFIX + key); } catch (e) { /* ignore */ }
  }

  /** ล้างทุก key ที่ขึ้นต้นด้วย prefix — ใช้หลังเครื่องตัวเองบันทึก เพื่อบังคับดึงใหม่ */
  function invalidate(prefix) {
    Object.keys(memFresh).forEach(function (k) { if (k.indexOf(prefix) === 0) delete memFresh[k]; });
    try {
      const full = PREFIX + prefix;
      const toRemove = [];
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k && k.indexOf(full) === 0) toRemove.push(k);
      }
      toRemove.forEach(function (k) { localStorage.removeItem(k); });
    } catch (e) { /* ignore */ }
  }

  /**
   * swr — แสดงข้อมูลเก่าทันที (ถ้ามี) แล้วดึงสดมาแสดงใหม่ + เก็บลง localStorage
   * @param {string}   key      คีย์ cache
   * @param {function} fetcher  (hadCache:boolean) => Promise<data>  (ควรตั้ง loading:!hadCache, silent:hadCache)
   * @param {function} render   (data, isStale:boolean) => void      ถูกเรียก 1–2 ครั้ง
   * @returns {Promise<data>}
   */
  async function swr(key, fetcher, render) {
    const mem = memFresh[key];
    const first = (mem && mem.data !== undefined) ? mem.data : get(key);
    const hadCache = first !== null && first !== undefined;
    if (hadCache) { try { render(first, true); } catch (e) { /* ignore */ } }

    // เพิ่งดึงสดไปไม่นาน → ใช้ค่าในหน่วยความจำ ไม่ต้องยิง backend ซ้ำ
    if (mem && (Date.now() - mem.ts) < REVALIDATE_THROTTLE_MS) return mem.data;

    try {
      const fresh = await fetcher(hadCache);
      memFresh[key] = { data: fresh, ts: Date.now() };
      set(key, fresh);
      render(fresh, false);
      return fresh;
    } catch (e) {
      if (hadCache) return first;   // ดึงสดไม่ได้แต่มีของเก่าอยู่แล้ว → คงของเก่าไว้ ไม่โยน error ซ้ำ
      throw e;
    }
  }

  return { get: get, set: set, remove: remove, invalidate: invalidate, swr: swr };
})();
