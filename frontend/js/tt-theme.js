/**
 * โหมดมืด/สว่าง ของหน้าระบบจัดตารางสอน (timetable*.html เท่านั้น — ไม่กระทบหน้าอื่นของระบบ)
 * โหลดใน <head> ก่อน CSS แสดงผล เพื่อไม่ให้จอกระพริบ · จำค่าในเครื่อง (localStorage) · ค่าเริ่มต้นตามระบบปฏิบัติการ
 */
const TTTheme = (function () {
  const KEY = 'tt_theme';
  function saved() { try { return localStorage.getItem(KEY); } catch (e) { return null; } }
  function current() {
    const s = saved();
    if (s === 'dark' || s === 'light') return s;
    return window.matchMedia && matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }
  function apply(t) {
    document.documentElement.setAttribute('data-theme', t);
    const m = document.querySelector('meta[name="theme-color"]');
    if (m) m.setAttribute('content', t === 'dark' ? '#0F1A24' : '#0288D1');
    document.querySelectorAll('[data-theme-btn]').forEach(function (b) { b.innerHTML = t === 'dark' ? '☀️' : '🌙'; b.title = t === 'dark' ? 'โหมดสว่าง' : 'โหมดมืด'; });
    window.dispatchEvent(new CustomEvent('tt:theme', { detail: t }));
  }
  apply(current());
  return {
    current: current,
    toggle: function () {
      const t = current() === 'dark' ? 'light' : 'dark';
      try { localStorage.setItem(KEY, t); } catch (e) { /* ใช้ได้เฉพาะรอบนี้ */ }
      apply(t);
    },
    refresh: function () { apply(current()); },
  };
})();
