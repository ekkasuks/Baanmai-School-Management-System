/**
 * AI Scheduling Engine — Constraint Solver (รันใน Web Worker)
 *
 * ขั้นตอน: แตกวิชาเป็น "คาบเรียน (lesson)" ต่อหน่วยการเรียน → มอบหมายครู (สมดุลภาระ)
 *          → วางแบบ greedy เรียงคาบยากก่อน + ย้ายคาบที่ขวาง (ejection) → สุ่มเริ่มใหม่หลายรอบเลือกผลดีสุด
 *          → ปรับปรุงต่อด้วย local search (ย้าย/สลับคาบ) → วิเคราะห์สาเหตุคาบที่จัดไม่ได้
 * กติกาเด็ดขาด (hard): ชั้น/ครูไม่ชน, วันหยุด-ช่วงสอนไม่ได้-ไม่สอนคาบแรก/สุดท้าย, คาบสูงสุด, สอนติดกัน,
 *                     ห้องพิเศษ/จำนวนผู้ใช้พร้อมกัน, คาบต่อวัน, วันที่อนุญาต, คาบต่อเนื่องไม่ข้ามพัก
 * ครู: คาบว่างร่วม (cfg.common_free เช่น PLC) · สอนสูงสุดต่อวัน (prefs.max_per_day หรือ cfg.teacher_max_per_day)
 *      ช่วงว่างติดกันอย่างน้อย/วัน (cfg.teacher_min_free_block — hard) · ว่างติดกันระหว่างคาบสอนไม่เกิน (cfg.teacher_max_free_run — soft)
 * ล็อกคาบ: วิชาที่ระบุ rules.fixed_slots วางที่ตำแหน่งนั้นก่อนเสมอและไม่ถูกย้าย (rules.shared = ครูดูแลหลายชั้นพร้อมกันได้)
 * ความชอบ (soft): กระจายวิชา, วิชาพื้นฐานช่วงเช้า, กิจกรรมช่วงบ่าย, ไม่มีคาบว่างแทรก, ภาระครูสมดุลรายวัน
 * หน่วยการเรียน = ห้องเดียว หรือกลุ่มเรียนควบชั้น (จัดครั้งเดียว ใช้กับทุกห้องในกลุ่ม)
 */
'use strict';

self.onmessage = function (e) {
  if (!e.data || e.data.type !== 'run') return;
  try {
    const result = solve(e.data.input, function (p) { self.postMessage({ type: 'progress', progress: p }); });
    self.postMessage({ type: 'result', result: result });
  } catch (err) {
    self.postMessage({ type: 'error', message: String((err && err.message) || err) });
  }
};

function clock() { return (self.performance && performance.now) ? performance.now() : Date.now(); }
function makeRng(seed) {
  let s = (seed >>> 0) || 0x9e3779b9;
  return function () { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; };
}
function shuffle(a, rnd) { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); const t = a[i]; a[i] = a[j]; a[j] = t; } return a; }
function tName(t) { return (t.title || '') + (t.name || ''); }

/* ════ สร้างแบบจำลองปัญหา ════ */
function model(input) {
  const cfg = input.config || {};
  const all = (input.periods || []).slice().sort(function (a, b) { return (Number(a.seq) || 0) - (Number(b.seq) || 0); });
  const P = [], seg = [];
  let sg = 0;
  all.forEach(function (p) { if (String(p.is_break) === '1') { sg++; return; } P.push(p); seg.push(sg); });
  const np = P.length;
  if (!np) throw new Error('ยังไม่ได้กำหนดคาบเรียน');
  const sess = P.map(function (p, i) { return p.session === 'afternoon' || p.session === 'morning' ? p.session : (i < np / 2 ? 'morning' : 'afternoon'); });
  const pIdx = {};
  P.forEach(function (p, i) { pIdx[p.period_id] = i; });

  const T = input.teachers || [], R = input.rooms || [], U = input.units || [], S = input.subjects || [];
  const tIdx = {};
  T.forEach(function (t, i) { tIdx[t.teacher_id] = i; });
  const defConsec = Number(cfg.teacher_max_consecutive) > 0 ? Number(cfg.teacher_max_consecutive) : 99;
  const defDay = Number(cfg.teacher_max_per_day) > 0 ? Number(cfg.teacher_max_per_day) : 99;   // 0 = ไม่จำกัด
  const commonFree = cfg.common_free || [];   // คาบว่างร่วม (เช่น PLC): teachers ว่าง = ครูทุกคน
  const maxIdle = Number(cfg.teacher_max_free_run) > 0 ? Number(cfg.teacher_max_free_run) : 0;     // ว่างติดกันระหว่างคาบสอนไม่เกิน (soft) · 0 = ไม่ใช้
  const minBlock = Number(cfg.teacher_min_free_block) > 0 ? Number(cfg.teacher_min_free_block) : 0; // ต้องมีช่วงว่างติดกันอย่างน้อย/วัน (hard) · 0 = ไม่ใช้

  const own = function (v, def) { return v === null || v === undefined || v === '' ? def : Math.max(0, Number(v) || 0); };   // ค่ารายครู: ว่าง = ค่ากลาง · 0 = ไม่ใช้
  const tin = T.map(function (t) {
    const off = {}, un = {}, fr = {};
    (t.off_days || []).forEach(function (d) { off[Number(d)] = 1; });
    (t.unavailable || []).forEach(function (x) { const pi = pIdx[x.period_id]; if (pi !== undefined) un[Number(x.day) + '|' + pi] = 1; });
    commonFree.forEach(function (x) {
      if ((x.teachers || []).length && x.teachers.indexOf(t.teacher_id) < 0) return;
      const pi = pIdx[x.period_id];
      if (pi !== undefined) fr[Number(x.day) + '|' + pi] = 1;
    });
    const pr = t.prefs || {};
    const mx = (t.max_periods === null || t.max_periods === undefined || t.max_periods === '') ? Infinity : Number(t.max_periods);
    return { off: off, un: un, fr: fr, max: mx, noFirst: !!pr.no_first, noLast: !!pr.no_last,
      consec: Number(pr.max_consecutive) > 0 ? Number(pr.max_consecutive) : defConsec,
      dayMax: Number(pr.max_per_day) > 0 ? Number(pr.max_per_day) : defDay,
      maxIdle: own(pr.max_free_run, maxIdle), minBlock: own(pr.min_free_block, minBlock) };
  });
  // ช่องที่ครูแต่ละคนสอนได้จริง (ใช้ถ่วงภาระตอนมอบหมาย)
  const cap = tin.map(function (ti) {
    let c = 0;
    for (let d = 1; d <= 5; d++) {
      if (ti.off[d]) continue;
      let cd = 0;
      for (let p = 0; p < np; p++) if (!ti.un[d + '|' + p] && !ti.fr[d + '|' + p] && !(ti.noFirst && p === 0) && !(ti.noLast && p === np - 1)) cd++;
      c += Math.min(cd, ti.dayMax, ti.minBlock ? Math.max(0, np - ti.minBlock) : np);
    }
    return Math.min(c, ti.max);
  });

  const warnings = [], lessons = [];
  const assigned = T.map(function () { return 0; });
  const pairs = [];
  U.forEach(function (u, ui) {
    S.forEach(function (s) {
      if (!(s.grades || []).some(function (g) { return u.grades.indexOf(g) >= 0; })) return;
      const elig = {};
      (s.teachers || []).forEach(function (id) { if (tIdx[id] !== undefined) elig[tIdx[id]] = 1; });
      T.forEach(function (t, ti) { if ((t.subjects || []).indexOf(s.subject_id) >= 0) elig[ti] = 1; });
      // มอบหมายการสอน (วิชา × ชั้น → ครู) มาก่อนเสมอ
      const fx = (input.assign || {})[u.unit_id + '|' + s.subject_id];
      pairs.push({ ui: ui, s: s, elig: Object.keys(elig).map(Number), fixed: fx && tIdx[fx] !== undefined ? tIdx[fx] : -1 });
    });
  });
  // ที่มอบหมายไว้แล้วก่อน (นับภาระให้ครูก่อน) → วิชาที่มีครูให้เลือกน้อย → วิชาที่ไม่มีครูเลยไว้ท้าย
  const rank = function (p) { return p.fixed >= 0 ? 0 : (p.elig.length || 99); };
  pairs.sort(function (a, b) { return rank(a) - rank(b); });

  pairs.forEach(function (pr) {
    const u = U[pr.ui];
    const home = (u.homeroom_teacher_id && tIdx[u.homeroom_teacher_id] !== undefined) ? tIdx[u.homeroom_teacher_id] : -1;
    const n = Number(pr.s.periods_week) || 0;
    let ti = -1, viaHome = false;
    if (pr.fixed >= 0) ti = pr.fixed;
    else if (pr.elig.length) {
      if (home >= 0 && pr.elig.indexOf(home) >= 0) ti = home;
      else ti = pr.elig.slice().sort(function (a, b) { return assigned[a] / Math.max(1, cap[a]) - assigned[b] / Math.max(1, cap[b]); })[0];
    } else if (cfg.fallback_homeroom !== false && home >= 0) { ti = home; viaHome = true; }
    if (ti < 0) warnings.push({ level: 'warning', code: 'no_teacher', msg: 'วิชา "' + pr.s.name + '" ชั้น ' + u.label + ' ยังไม่มีครูผู้สอน — จัดเวลาให้แล้ว แต่ยังไม่ระบุครู' });
    else {
      assigned[ti] += n;
      if (viaHome) warnings.push({ level: 'info', code: 'homeroom', msg: 'วิชา "' + pr.s.name + '" ชั้น ' + u.label + ' ไม่ได้ระบุครู — ใช้ครูประจำชั้น ' + tName(T[ti]) });
    }

    const allows = function (r) { return !(r.allowed_subjects || []).length || r.allowed_subjects.indexOf(pr.s.subject_id) >= 0; };
    const rooms = [];
    if (pr.s.room_type) {
      R.forEach(function (r, ri) { if (r.type === pr.s.room_type && allows(r)) rooms.push(ri); });
      if (!rooms.length) warnings.push({ level: 'warning', code: 'no_room', msg: 'วิชา "' + pr.s.name + '" ต้องใช้ห้องประเภท "' + pr.s.room_type + '" แต่ยังไม่มีห้องประเภทนี้ — จัดโดยไม่ระบุห้อง' });
    } else if (u.home_room_id) {
      R.forEach(function (r, ri) { if (r.room_id === u.home_room_id && allows(r)) rooms.push(ri); });
    }

    const rules = pr.s.rules || {};
    let b = Math.max(1, Math.floor(Number(rules.consecutive) || 1));
    b = Math.min(b, Math.max(1, n));
    const perDay = Number(rules.max_per_day) > 0 ? Number(rules.max_per_day) : (Number(cfg.subject_max_per_day) || 2);
    const days = (rules.allowed_days || []).map(Number).filter(function (d) { return d >= 1 && d <= 5; });
    let left = n;
    // ล็อกคาบ (ทั้งโรงเรียน): คาบละ 1 บทเรียนที่ตำแหน่งตายตัว — วางก่อนทุกวิชาและไม่ถูกย้าย
    const fixedSlots = (rules.fixed_slots || []).map(function (x) { return { d: Number(x.day), p: pIdx[x.period_id] }; })
      .filter(function (x) { return x.d >= 1 && x.d <= 5 && x.p !== undefined; });
    if ((rules.fixed_slots || []).length > fixedSlots.length) warnings.push({ level: 'warning', code: 'fixed_bad', msg: 'วิชา "' + pr.s.name + '" มีคาบล็อกที่ไม่มีอยู่จริง (คาบถูกลบ/เป็นช่วงพัก) — ข้าม' });
    if (fixedSlots.length > n) warnings.push({ level: 'warning', code: 'fixed_over', msg: 'วิชา "' + pr.s.name + '" ล็อกไว้ ' + fixedSlots.length + ' คาบ แต่เรียน ' + n + ' คาบ/สัปดาห์ — ใช้ ' + n + ' คาบแรก' });
    fixedSlots.slice(0, n).forEach(function (fx) {
      if (ti >= 0 && (tin[ti].off[fx.d] || tin[ti].un[fx.d + '|' + fx.p] || tin[ti].fr[fx.d + '|' + fx.p])) warnings.push({ level: 'warning', code: 'fixed_teacher', msg: 'วิชา "' + pr.s.name + '" ชั้น ' + u.label + ' ล็อกไว้ในเวลาที่ครู' + tName(T[ti]) + ' แจ้งว่าไม่ว่าง — ยังจัดตามที่ล็อก' });
      lessons.push({ id: lessons.length, ui: pr.ui, si: S.indexOf(pr.s), s: pr.s, ti: ti, len: 1, rooms: rooms, maxDay: 99, days: null, type: pr.s.type || 'core',
        fixed: fx, shared: rules.shared !== false });
      left--;
    });
    while (left > 0) {
      const len = Math.min(b, left);
      lessons.push({ id: lessons.length, ui: pr.ui, si: S.indexOf(pr.s), s: pr.s, ti: ti, len: len, rooms: rooms,
        maxDay: Math.max(perDay, len), days: days.length ? days : null, type: pr.s.type || 'core' });
      left -= len;
    }
  });

  T.forEach(function (t, ti) {
    if (assigned[ti] > tin[ti].max) warnings.push({ level: 'error', code: 'over_max', msg: 'ครู ' + tName(t) + ' ได้รับมอบหมาย ' + assigned[ti] + ' คาบ เกินคาบสูงสุด ' + tin[ti].max + ' คาบ' });
    else if (assigned[ti] > cap[ti]) warnings.push({ level: 'error', code: 'over_cap', msg: 'ครู ' + tName(t) + ' ได้รับมอบหมาย ' + assigned[ti] + ' คาบ แต่มีช่องเวลาที่สอนได้เพียง ' + cap[ti] + ' ช่อง' });
  });
  U.forEach(function (u, ui) {
    const need = lessons.reduce(function (a, l) { return a + (l.ui === ui ? l.len : 0); }, 0);
    if (need > np * 5) warnings.push({ level: 'error', code: 'unit_over', msg: 'ชั้น ' + u.label + ' ต้องเรียน ' + need + ' คาบ เกินช่องที่มี ' + (np * 5) + ' คาบ/สัปดาห์' });
  });

  return { cfg: cfg, P: P, np: np, seg: seg, sess: sess, T: T, R: R, U: U, S: S, tin: tin, cap: cap, assigned: assigned, lessons: lessons, warnings: warnings };
}

/* ════ สถานะตาราง + กติกา ════ */
function newState(M) {
  const grid = function (n) {
    const g = [];
    for (let i = 0; i < n; i++) { const d = []; for (let k = 0; k < 6; k++) d.push(new Int32Array(M.np).fill(-1)); g.push(d); }
    return g;
  };
  const rc = [];
  for (let i = 0; i < M.R.length; i++) { const d = []; for (let k = 0; k < 6; k++) d.push(new Int32Array(M.np)); rc.push(d); }
  const tday = [];
  for (let i = 0; i < M.T.length; i++) tday.push(new Int32Array(6));
  return { ub: grid(M.U.length), tb: grid(M.T.length), rc: rc, sd: {}, sdl: {}, tload: new Int32Array(M.T.length), tday: tday, pos: new Array(M.lessons.length).fill(null) };
}

/** ตรวจว่าวางคาบ L ที่ (วัน d, คาบเริ่ม p0) ได้ไหม → {ok, r} หรือ {why} */
function fits(M, st, L, d, p0) {
  const np = M.np, len = L.len;
  if (p0 + len > np) return { why: 'block' };
  for (let k = 1; k < len; k++) if (M.seg[p0 + k] !== M.seg[p0]) return { why: 'block' };
  if (L.days && L.days.indexOf(d) < 0) return { why: 'days' };
  const ub = st.ub[L.ui][d];
  for (let k = 0; k < len; k++) if (ub[p0 + k] >= 0) return { why: 'unit' };
  if ((st.sd[L.ui + '|' + L.si + '|' + d] || 0) + len > L.maxDay) return { why: 'per_day' };
  if (L.ti >= 0) {
    const ti = M.tin[L.ti], tb = st.tb[L.ti][d];
    if (ti.off[d]) return { why: 't_off' };
    for (let k = 0; k < len; k++) {
      const p = p0 + k;
      if (ti.un[d + '|' + p]) return { why: 't_unav' };
      if (ti.fr[d + '|' + p]) return { why: 't_free' };
      if ((ti.noFirst && p === 0) || (ti.noLast && p === np - 1)) return { why: 't_pref' };
      if (tb[p] >= 0) return { why: 't_busy' };
    }
    if (st.tload[L.ti] + len > ti.max) return { why: 't_max' };
    if (st.tday[L.ti][d] + len > ti.dayMax) return { why: 't_day' };
    let run = len, q = p0 - 1;
    while (q >= 0 && M.seg[q] === M.seg[p0] && tb[q] >= 0) { run++; q--; }
    q = p0 + len;
    while (q < np && M.seg[q] === M.seg[p0] && tb[q] >= 0) { run++; q++; }
    if (run > ti.consec) return { why: 't_consec' };
    if (ti.minBlock && freeShape(tb, np, p0, len).maxFree < ti.minBlock) return { why: 't_block' };
  }
  let r = -1;
  if (L.rooms.length) {
    for (let i = 0; i < L.rooms.length; i++) {
      const ri = L.rooms[i], capR = Math.max(1, Number(M.R[ri].max_concurrent) || 1), rc = st.rc[ri][d];
      let ok = true;
      for (let k = 0; k < len; k++) if (rc[p0 + k] >= capR) { ok = false; break; }
      if (ok) { r = ri; break; }
    }
    if (r < 0) return { why: 'room' };
  }
  return { ok: true, r: r };
}

function commit(M, st, L, d, p0, r) {
  for (let k = 0; k < L.len; k++) {
    st.ub[L.ui][d][p0 + k] = L.id;
    if (L.ti >= 0) st.tb[L.ti][d][p0 + k] = L.id;
    if (r >= 0) st.rc[r][d][p0 + k]++;
  }
  const key = L.ui + '|' + L.si + '|' + d;
  st.sd[key] = (st.sd[key] || 0) + L.len;
  st.sdl[key] = (st.sdl[key] || 0) + 1;
  if (L.ti >= 0) { st.tload[L.ti] += L.len; st.tday[L.ti][d] += L.len; }
  st.pos[L.id] = { d: d, p: p0, r: r };
}

function uncommit(M, st, L) {
  const ps = st.pos[L.id];
  if (!ps) return null;
  for (let k = 0; k < L.len; k++) {
    st.ub[L.ui][ps.d][ps.p + k] = -1;
    if (L.ti >= 0) st.tb[L.ti][ps.d][ps.p + k] = -1;
    if (ps.r >= 0) st.rc[ps.r][ps.d][ps.p + k]--;
  }
  const key = L.ui + '|' + L.si + '|' + ps.d;
  st.sd[key] -= L.len;
  st.sdl[key] -= 1;
  if (L.ti >= 0) { st.tload[L.ti] -= L.len; st.tday[L.ti][ps.d] -= L.len; }
  st.pos[L.id] = null;
  return ps;
}

/**
 * รูปแบบเวลาว่างของครูในวันหนึ่ง (ถ้าวางคาบเพิ่มที่ from..from+len-1)
 *   maxFree = ช่วงว่างติดกันยาวที่สุดทั้งวัน (นับเฉพาะคาบเรียน — ช่วงพักไม่ตัด)
 *   idleOver(lim) = ส่วนที่เกิน lim ของช่วงว่างระหว่างคาบสอนแรก–สุดท้าย
 */
function freeShape(tbDay, np, from, len) {
  const occ = function (p) { return tbDay[p] >= 0 || (from >= 0 && p >= from && p < from + len); };
  let first = -1, last = -1, run = 0, maxFree = 0;
  for (let p = 0; p < np; p++) {
    if (occ(p)) { if (first < 0) first = p; last = p; maxFree = Math.max(maxFree, run); run = 0; } else run++;
  }
  maxFree = Math.max(maxFree, run);
  const idle = [];
  let r = 0;
  for (let p = first + 1; first >= 0 && p <= last; p++) { if (occ(p)) { if (r) idle.push(r); r = 0; } else r++; }
  return { first: first, maxFree: maxFree, idleOver: function (lim) { return idle.reduce(function (a, x) { return a + Math.max(0, x - lim); }, 0); } };
}

/** ต้นทุนความชอบของตำแหน่ง (ยิ่งน้อยยิ่งดี) */
function cost(M, st, L, d, p0, rnd) {
  const cfg = M.cfg;
  let c = 0;
  if (cfg.spread_subjects !== false && (st.sdl[L.ui + '|' + L.si + '|' + d] || 0) > 0) c += 10;
  const s = M.sess[p0];
  if (cfg.prefer_core_morning !== false && L.type === 'core' && s === 'afternoon') c += 3;
  if (cfg.prefer_activity_afternoon !== false && L.type === 'activity' && s === 'morning') c += 2;
  if (L.ti >= 0) {
    c += st.tday[L.ti][d] * 0.6;
    const ti = M.tin[L.ti];
    if (ti.maxIdle) c += freeShape(st.tb[L.ti][d], M.np, p0, L.len).idleOver(ti.maxIdle) * 6;   // ครูว่างรอนานเกินกำหนด
  }
  if (cfg.avoid_gaps !== false) c += p0 * 0.25;
  if (rnd) c += rnd() * 0.8;
  return c;
}

function bestPos(M, st, L, rnd) {
  let best = null;
  for (let d = 1; d <= 5; d++) {
    for (let p0 = 0; p0 + L.len <= M.np; p0++) {
      const f = fits(M, st, L, d, p0);
      if (!f.ok) continue;
      const c = cost(M, st, L, d, p0, rnd);
      if (!best || c < best.c) best = { d: d, p: p0, r: f.r, c: c };
    }
  }
  return best;
}

/** วางไม่ได้ → ลองย้ายคาบที่ขวาง 1 คาบไปที่อื่น */
function ejectPlace(M, st, L, rnd, tries) {
  const cands = [];
  for (let d = 1; d <= 5; d++) for (let p0 = 0; p0 + L.len <= M.np; p0++) cands.push([d, p0]);
  shuffle(cands, rnd);
  for (let i = 0; i < cands.length && i < tries; i++) {
    const d = cands[i][0], p0 = cands[i][1];
    const bl = {};
    for (let k = 0; k < L.len; k++) {
      const a = st.ub[L.ui][d][p0 + k];
      if (a >= 0) bl[a] = 1;
      if (L.ti >= 0) { const b = st.tb[L.ti][d][p0 + k]; if (b >= 0) bl[b] = 1; }
    }
    const ids = Object.keys(bl);
    if (ids.length !== 1) continue;
    const B = M.lessons[Number(ids[0])];
    if (B.fixed) continue;
    const old = uncommit(M, st, B);
    const f = fits(M, st, L, d, p0);
    if (f.ok) {
      commit(M, st, L, d, p0, f.r);
      const nb = bestPos(M, st, B, rnd);
      if (nb) { commit(M, st, B, nb.d, nb.p, nb.r); return true; }
      uncommit(M, st, L);
    }
    commit(M, st, B, old.d, old.p, old.r);
  }
  return false;
}

function difficulty(M, L) {
  let k = L.len * 3 + (L.rooms.length ? 4 : 0) + (L.days ? 4 : 0);
  if (L.ti >= 0) {
    const ti = M.tin[L.ti];
    k += (M.assigned[L.ti] / Math.max(1, M.cap[L.ti])) * 10;
    if (ti.noFirst || ti.noLast || Object.keys(ti.off).length || Object.keys(ti.un).length) k += 2;
  }
  return k;
}

/**
 * วางคาบที่ล็อกไว้ (ตำแหน่งตายตัว) — ไม่ตรวจวันหยุด/ช่วงไม่ว่างของครู (ล็อกมีผลเหนือกว่า แจ้งเตือนใน model แล้ว)
 * shared: ครูคนเดียวดูแลหลายชั้นในกิจกรรมล็อกเดียวกันได้ (นับภาระครั้งเดียว) แต่ยังชนกับวิชาอื่นตามปกติ
 */
function placeFixed(M, st) {
  M.lessons.forEach(function (L) {
    if (!L.fixed) return;
    const d = L.fixed.d, p = L.fixed.p;
    if (st.ub[L.ui][d][p] >= 0) return;                         // ชั้นนี้ล็อกวิชาอื่นไว้ช่องเดียวกัน → วางไม่ได้
    let share = false;
    if (L.ti >= 0) {
      const occ = st.tb[L.ti][d][p];
      if (occ >= 0) {
        const O = M.lessons[occ];
        if (!(O.fixed && O.shared && L.shared)) return;          // ครูติดคาบล็อกที่ไม่ได้ดูแลร่วม
        share = true;
      }
    }
    let r = -1;
    for (let i = 0; i < L.rooms.length; i++) {
      const ri = L.rooms[i];
      if (st.rc[ri][d][p] < Math.max(1, Number(M.R[ri].max_concurrent) || 1) || L.shared) { r = ri; break; }
    }
    st.ub[L.ui][d][p] = L.id;
    if (L.ti >= 0 && !share) { st.tb[L.ti][d][p] = L.id; st.tload[L.ti]++; st.tday[L.ti][d]++; }
    if (r >= 0) st.rc[r][d][p]++;
    const key = L.ui + '|' + L.si + '|' + d;
    st.sd[key] = (st.sd[key] || 0) + 1;
    st.sdl[key] = (st.sdl[key] || 0) + 1;
    st.pos[L.id] = { d: d, p: p, r: r, fixed: true };
  });
}

function attempt(M, seed) {
  const rnd = makeRng(seed);
  const st = newState(M);
  placeFixed(M, st);
  const order = M.lessons.filter(function (L) { return !L.fixed; }).map(function (L) { return { L: L, k: difficulty(M, L) + rnd() * 3 }; })
    .sort(function (a, b) { return b.k - a.k; }).map(function (x) { return x.L; });
  let unplaced = [];
  order.forEach(function (L) {
    const b = bestPos(M, st, L, rnd);
    if (b) commit(M, st, L, b.d, b.p, b.r);
    else if (!ejectPlace(M, st, L, rnd, 60)) unplaced.push(L);
  });
  unplaced = unplaced.filter(function (L) {
    const b = bestPos(M, st, L, rnd);
    if (b) { commit(M, st, L, b.d, b.p, b.r); return false; }
    return !ejectPlace(M, st, L, rnd, 200);
  });
  return { st: st, unplaced: unplaced.length };
}

/** วัดคุณภาพตาราง (ความชอบ) */
function evaluate(M, st) {
  let sameDay = 0, coreAft = 0, actMorn = 0, gaps = 0, placedP = 0, totalP = 0;
  Object.keys(st.sdl).forEach(function (k) { if (st.sdl[k] > 1) sameDay += st.sdl[k] - 1; });
  M.lessons.forEach(function (L) {
    totalP += L.len;
    const ps = st.pos[L.id];
    if (!ps) return;
    placedP += L.len;
    for (let k = 0; k < L.len; k++) {
      const s = M.sess[ps.p + k];
      if (L.type === 'core' && s === 'afternoon') coreAft++;
      if (L.type === 'activity' && s === 'morning') actMorn++;
    }
  });
  st.ub.forEach(function (u) {
    for (let d = 1; d <= 5; d++) {
      let last = -1;
      for (let p = 0; p < M.np; p++) if (u[d][p] >= 0) last = p;
      for (let p = 0; p < last; p++) if (u[d][p] < 0) gaps++;
    }
  });
  let tIdle = 0;   // คาบว่างของครูที่เกินกำหนด "ว่างติดกันไม่เกิน"
  st.tb.forEach(function (t, ti) {
    const lim = M.tin[ti].maxIdle;
    if (!lim) return;
    for (let d = 1; d <= 5; d++) tIdle += freeShape(t[d], M.np, -1, 0).idleOver(lim);
  });
  const pen = sameDay * 3 + gaps * 2 + coreAft * 0.5 + actMorn * 0.3 + tIdle * 2;
  return { sameDay: sameDay, coreAft: coreAft, actMorn: actMorn, gaps: gaps, tIdle: tIdle, pen: pen, placedP: placedP, totalP: totalP,
    quality: Math.max(0, Math.round(100 - pen * 100 / Math.max(1, totalP))) };
}

/** local search: ย้ายคาบไปตำแหน่งที่ดีกว่า / สลับคาบในชั้นเดียวกัน / เก็บคาบที่ยังไม่ได้วาง */
function improve(M, st, rnd, until, onProgress, t0, budget) {
  const Ls = M.lessons;
  let cur = evaluate(M, st).pen, iter = 0, lastPost = 0;
  while (clock() < until) {
    iter++;
    if (iter % 40 === 0) {
      Ls.forEach(function (L) {
        if (st.pos[L.id] || L.fixed) return;
        const b = bestPos(M, st, L, rnd);
        if (b) commit(M, st, L, b.d, b.p, b.r); else ejectPlace(M, st, L, rnd, 80);
      });
      cur = evaluate(M, st).pen;
    }
    const A = Ls[Math.floor(rnd() * Ls.length)];
    if (!st.pos[A.id] || A.fixed) continue;
    if (rnd() < 0.6) {
      const old = uncommit(M, st, A);
      const b = bestPos(M, st, A, rnd);
      if (b) commit(M, st, A, b.d, b.p, b.r); else commit(M, st, A, old.d, old.p, old.r);
      const nv = evaluate(M, st).pen;
      if (nv > cur + 1e-9) { uncommit(M, st, A); commit(M, st, A, old.d, old.p, old.r); } else cur = nv;
    } else {
      const B = Ls[Math.floor(rnd() * Ls.length)];
      if (B === A || B.ui !== A.ui || B.len !== A.len || !st.pos[B.id] || B.fixed) continue;
      const pa = uncommit(M, st, A), pb = uncommit(M, st, B);
      const fa = fits(M, st, A, pb.d, pb.p);
      let ok = false;
      if (fa.ok) {
        commit(M, st, A, pb.d, pb.p, fa.r);
        const fb = fits(M, st, B, pa.d, pa.p);
        if (fb.ok) { commit(M, st, B, pa.d, pa.p, fb.r); ok = true; } else uncommit(M, st, A);
      }
      if (ok) {
        const nv = evaluate(M, st).pen;
        if (nv > cur + 1e-9) { uncommit(M, st, A); uncommit(M, st, B); commit(M, st, A, pa.d, pa.p, pa.r); commit(M, st, B, pb.d, pb.p, pb.r); } else cur = nv;
      } else { commit(M, st, A, pa.d, pa.p, pa.r); commit(M, st, B, pb.d, pb.p, pb.r); }
    }
    const t = clock();
    if (t - lastPost > 200) { lastPost = t; onProgress({ phase: 'improve', pct: Math.min(99, Math.round((t - t0) / budget * 100)), iterations: iter }); }
  }
  return iter;
}

/** สาเหตุที่วางคาบ L ไม่ได้ (นับจากทุกตำแหน่ง) */
function diagnose(M, st, L) {
  const tally = {};
  for (let d = 1; d <= 5; d++) for (let p0 = 0; p0 < M.np; p0++) {
    const f = fits(M, st, L, d, p0);
    if (!f.ok) tally[f.why] = (tally[f.why] || 0) + 1;
  }
  return Object.keys(tally).map(function (k) { return { code: k, count: tally[k] }; }).sort(function (a, b) { return b.count - a.count; });
}

/* ════ main ════ */
function solve(input, onProgress) {
  const t0 = clock();
  const M = model(input);
  const budget = Math.max(1, Math.min(30, Number(M.cfg.time_limit_sec) || 6)) * 1000;
  const searchEnd = t0 + budget * 0.65, end = t0 + budget;
  const baseSeed = (Number(input.seed) || Date.now()) >>> 0;

  let best = null, att = 0, lastPost = 0;
  if (M.lessons.length) {
    while (true) {
      const a = attempt(M, baseSeed + att * 7919);
      att++;
      a.ev = evaluate(M, a.st);
      if (!best || a.unplaced < best.unplaced || (a.unplaced === best.unplaced && a.ev.pen < best.ev.pen)) best = a;
      const t = clock();
      if (t - lastPost > 150) {
        lastPost = t;
        onProgress({ phase: 'search', pct: Math.min(65, Math.round((t - t0) / budget * 100)), attempts: att, unplaced: best.unplaced, quality: best.ev.quality });
      }
      if (t >= searchEnd || att >= 3000) break;
    }
  } else {
    best = { st: newState(M), unplaced: 0 };
  }

  const iterations = M.lessons.length ? improve(M, best.st, makeRng(baseSeed ^ 0x5bd1e995), end, onProgress, t0, budget) : 0;
  const ev = evaluate(M, best.st);

  const unplaced = M.lessons.filter(function (L) { return !best.st.pos[L.id]; }).map(function (L) {
    return { unit_label: M.U[L.ui].label, subject_id: L.s.subject_id, subject_name: L.s.name,
      teacher_name: L.ti >= 0 ? tName(M.T[L.ti]) : '', len: L.len, reasons: L.fixed ? [{ code: 'fixed', count: 1 }] : diagnose(M, best.st, L) };
  });
  const placements = M.lessons.filter(function (L) { return best.st.pos[L.id]; }).map(function (L) {
    const ps = best.st.pos[L.id], pids = [];
    for (let k = 0; k < L.len; k++) pids.push(M.P[ps.p + k].period_id);
    return { unit_id: M.U[L.ui].unit_id, class_ids: M.U[L.ui].class_ids, subject_id: L.s.subject_id,
      teacher_id: L.ti >= 0 ? M.T[L.ti].teacher_id : '', room_id: ps.r >= 0 ? M.R[ps.r].room_id : '',
      day: ps.d, period_ids: pids, len: L.len, fixed: !!L.fixed };
  });
  const load = M.T.map(function (t, ti) { return { teacher_id: t.teacher_id, name: tName(t), assigned: M.assigned[ti], placed: best.st.tload[ti], max: isFinite(M.tin[ti].max) ? M.tin[ti].max : null }; });

  onProgress({ phase: 'done', pct: 100 });
  return {
    placements: placements, unplaced: unplaced, warnings: M.warnings, teacher_load: load,
    metrics: ev,
    stats: { lessons: M.lessons.length, placed: placements.length, unplaced: unplaced.length,
      periods_total: ev.totalP, periods_placed: ev.placedP, attempts: att, iterations: iterations,
      ms: Math.round(clock() - t0), quality: ev.quality, engine: 'csp-greedy-eject-ls-v1' },
  };
}
