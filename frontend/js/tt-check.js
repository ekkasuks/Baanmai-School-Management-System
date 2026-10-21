/**
 * ตรวจสอบความถูกต้องของตาราง (โมดูล 5) — ใช้กติกาชุดเดียวกับ AI Engine (tt-solver.js)
 *
 *   error   (แดง)    : ครู/ห้องชน, วันหยุด/ช่วงสอนไม่ได้/ไม่สอนคาบแรก-สุดท้าย, เกินคาบสูงสุด, สอนติดกันเกิน,
 *                      วิชาเกินวันละ, วิชาอยู่ผิดวัน
 *   warning (เหลือง) : คาบที่ล็อกไว้ไม่ใช่วิชานั้น, จำนวนคาบไม่ตรงหลักสูตร, ยังไม่ระบุครู, ครูไม่ตรงกับที่มอบหมาย, ครูไม่ได้ถูกกำหนดให้สอนวิชานี้, ห้องไม่ตรงประเภท,
 *                      วิชาไม่อยู่ในชั้นนี้, คาบว่างแทรก, ครูต่ำกว่าคาบขั้นต่ำ
 *   ช่องที่ไม่มีปัญหา = เขียว
 *
 * input: { units:[{unit_id,label,grades,class_ids}], cells:{unit_id:{'day|period_id':{subject_id,teacher_id,room_id,locked}}},
 *          subjects, teachers, rooms, periods, config, assign?:{'unit_id|subject_id': teacher_id} }
 * ใช้ได้ทั้งในเบราว์เซอร์ (window.TTCheck) และ Node (module.exports) สำหรับทดสอบ
 */
(function (root) {
  'use strict';

  const DAYS = ['', 'จันทร์', 'อังคาร', 'พุธ', 'พฤหัสบดี', 'ศุกร์'];
  function tName(t) { return t ? (t.title || '') + (t.name || '') : ''; }
  function sName(s) { return s ? String(s.name || '').replace(/\s*\(ป\.[^)]*\)$/, '') : '?'; }

  function check(input) {
    const cfg = input.config || {};
    const all = (input.periods || []).slice().sort(function (a, b) { return (Number(a.seq) || 0) - (Number(b.seq) || 0); });
    const P = [], seg = [];
    let sg = 0;
    all.forEach(function (p) { if (String(p.is_break) === '1') { sg++; return; } P.push(p); seg.push(sg); });
    const np = P.length;
    const pIdx = {};
    P.forEach(function (p, i) { pIdx[p.period_id] = i; });
    const sess = P.map(function (p, i) { return p.session === 'afternoon' || p.session === 'morning' ? p.session : (i < np / 2 ? 'morning' : 'afternoon'); });

    const byId = function (list, pk) { const m = {}; (list || []).forEach(function (x) { m[x[pk]] = x; }); return m; };
    const S = byId(input.subjects, 'subject_id'), T = byId(input.teachers, 'teacher_id'), R = byId(input.rooms, 'room_id');
    const units = input.units || [];
    const U = byId(units, 'unit_id');
    const defConsec = Number(cfg.teacher_max_consecutive) > 0 ? Number(cfg.teacher_max_consecutive) : 99;
    const defPerDay = Number(cfg.subject_max_per_day) || 2;

    // ครูที่สอนวิชาได้ (จากวิชา + จากครู)
    const elig = {};
    (input.subjects || []).forEach(function (s) { (s.teachers || []).forEach(function (t) { (elig[s.subject_id] = elig[s.subject_id] || {})[t] = 1; }); });
    (input.teachers || []).forEach(function (t) { (t.subjects || []).forEach(function (sid) { (elig[sid] = elig[sid] || {})[t.teacher_id] = 1; }); });

    const issues = [], cellLevel = {};
    function add(level, code, msg, cells, extra) {
      issues.push(Object.assign({ level: level, code: code, msg: msg, cells: cells || [] }, extra || {}));
      (cells || []).forEach(function (c) { if (cellLevel[c] !== 'error') cellLevel[c] = level; });
    }

    // แตกช่องเป็นรายการ
    const E = [];
    units.forEach(function (u) {
      const cs = (input.cells || {})[u.unit_id] || {};
      Object.keys(cs).forEach(function (k) {
        const c = cs[k];
        if (!c || !c.subject_id) return;
        const parts = k.split('|'), d = Number(parts[0]), p = pIdx[parts[1]];
        if (p === undefined || !(d >= 1 && d <= 5)) return;
        E.push({ u: u.unit_id, d: d, p: p, s: c.subject_id, t: c.teacher_id || '', r: c.room_id || '', key: u.unit_id + '|' + k });
      });
    });

    // ล็อกคาบ: วิชาที่ล็อกไว้ที่ (วัน, คาบ) นี้ · shared = ครูดูแลหลายชั้นพร้อมกันได้ (ไม่นับชน)
    function lockedAt(sid, d, pid) { const r = (S[sid] && S[sid].rules) || {}; return (r.fixed_slots || []).some(function (x) { return Number(x.day) === d && x.period_id === pid; }); }
    function sharedLocked(sid, d, pid) { return lockedAt(sid, d, pid) && ((S[sid].rules || {}).shared !== false); }
    const subjOf = {};
    E.forEach(function (e) { subjOf[e.key] = e.s; });

    // ── ครู ──
    const tOcc = {};   // tid -> 'd|p' -> {unit: [keys]}
    E.forEach(function (e) {
      if (!e.t) return;
      const m = (tOcc[e.t] = tOcc[e.t] || {});
      const slot = (m[e.d + '|' + e.p] = m[e.d + '|' + e.p] || {});
      (slot[e.u] = slot[e.u] || []).push(e.key);
    });
    const teacherLoad = {};
    Object.keys(tOcc).forEach(function (tid) {
      const t = T[tid], m = tOcc[tid];
      teacherLoad[tid] = Object.keys(m).length;
      if (!t) return;
      const off = {}, un = {};
      (t.off_days || []).forEach(function (d) { off[Number(d)] = 1; });
      (t.unavailable || []).forEach(function (x) { const pi = pIdx[x.period_id]; if (pi !== undefined) un[Number(x.day) + '|' + pi] = 1; });
      const pr = t.prefs || {};
      const offCells = {}, unCells = [], prefCells = [];
      Object.keys(m).forEach(function (dp) {
        const d = Number(dp.split('|')[0]), p = Number(dp.split('|')[1]);
        const us = Object.keys(m[dp]);
        const keys = us.reduce(function (a, u) { return a.concat(m[dp][u]); }, []);
        if (us.length > 1 && !keys.every(function (k) { return sharedLocked(subjOf[k], d, P[p].period_id); })) {
          add('error', 't_clash', 'ครู' + tName(t) + ' สอนชน ' + us.length + ' ชั้น (' + us.map(function (u) { return U[u] ? U[u].label : u; }).join(', ') + ') วัน' + DAYS[d] + ' ' + P[p].label, keys, { teacher_id: tid });
        }
        if (off[d]) (offCells[d] = offCells[d] || []).push.apply(offCells[d], keys);
        if (un[d + '|' + p]) unCells.push.apply(unCells, keys);
        if ((pr.no_first && p === 0) || (pr.no_last && p === np - 1)) prefCells.push.apply(prefCells, keys);
      });
      Object.keys(offCells).forEach(function (d) { add('error', 't_off', 'ครู' + tName(t) + ' มีสอนในวันหยุด (วัน' + DAYS[d] + ')', offCells[d], { teacher_id: tid }); });
      if (unCells.length) add('error', 't_unav', 'ครู' + tName(t) + ' มีสอนในช่วงที่แจ้งว่าสอนไม่ได้ ' + unCells.length + ' ช่อง', unCells, { teacher_id: tid });
      if (prefCells.length) add('error', 't_pref', 'ครู' + tName(t) + ' ไม่สอน' + (pr.no_first && pr.no_last ? 'คาบแรก/คาบสุดท้าย' : pr.no_first ? 'คาบแรก' : 'คาบสุดท้าย') + ' แต่มีสอน ' + prefCells.length + ' ช่อง', prefCells, { teacher_id: tid });

      const load = teacherLoad[tid];
      const mx = (t.max_periods === null || t.max_periods === undefined || t.max_periods === '') ? Infinity : Number(t.max_periods);
      if (load > mx) add('error', 't_max', 'ครู' + tName(t) + ' สอน ' + load + ' คาบ เกินคาบสูงสุด ' + mx + ' คาบ/สัปดาห์', [], { teacher_id: tid });

      // สอนติดกันเกิน (นับเฉพาะช่วงที่ไม่มีพักคั่น)
      const consec = Number(pr.max_consecutive) > 0 ? Number(pr.max_consecutive) : defConsec;
      for (let d = 1; d <= 5; d++) {
        let run = [];
        const flush = function () {
          if (run.length > consec) {
            const keys = run.reduce(function (a, p) { const s = m[d + '|' + p]; return a.concat(Object.keys(s).reduce(function (b, u) { return b.concat(s[u]); }, [])); }, []);
            add('error', 't_consec', 'ครู' + tName(t) + ' สอนติดกัน ' + run.length + ' คาบ วัน' + DAYS[d] + ' (กำหนดไม่เกิน ' + consec + ')', keys, { teacher_id: tid });
          }
          run = [];
        };
        for (let p = 0; p < np; p++) {
          if (run.length && seg[p] !== seg[run[run.length - 1]]) flush();
          if (m[d + '|' + p]) run.push(p); else flush();
        }
        flush();
      }
    });
    (input.teachers || []).forEach(function (t) {
      const load = teacherLoad[t.teacher_id] || 0;
      if (t.min_periods !== null && t.min_periods !== undefined && t.min_periods !== '' && load < Number(t.min_periods)) {
        add('warning', 't_min', 'ครู' + tName(t) + ' สอน ' + load + ' คาบ ต่ำกว่าคาบขั้นต่ำ ' + t.min_periods + ' คาบ/สัปดาห์', [], { teacher_id: t.teacher_id });
      }
    });

    // ── ห้อง ──
    const rOcc = {};
    E.forEach(function (e) {
      if (!e.r) return;
      const m = (rOcc[e.r] = rOcc[e.r] || {});
      const slot = (m[e.d + '|' + e.p] = m[e.d + '|' + e.p] || {});
      (slot[e.u] = slot[e.u] || []).push(e.key);
    });
    Object.keys(rOcc).forEach(function (rid) {
      const r = R[rid], cap = Math.max(1, Number(r && r.max_concurrent) || 1);
      Object.keys(rOcc[rid]).forEach(function (dp) {
        const us = Object.keys(rOcc[rid][dp]);
        if (us.length > cap) {
          const d = Number(dp.split('|')[0]), p = Number(dp.split('|')[1]);
          add('error', 'r_clash', 'ห้อง' + (r ? r.name : rid) + ' ถูกใช้พร้อมกัน ' + us.length + ' ชั้น (รับได้ ' + cap + ') วัน' + DAYS[d] + ' ' + P[p].label,
            us.reduce(function (a, u) { return a.concat(rOcc[rid][dp][u]); }, []));
        }
      });
    });

    // ── ต่อช่อง: วิชา/ครู/ห้อง ──
    const noTeacher = {}, perDay = {}, count = {};
    E.forEach(function (e) {
      const s = S[e.s], u = U[e.u];
      if (!s) return;
      const rules = s.rules || {};
      const days = (rules.allowed_days || []).map(Number);
      if (days.length && days.indexOf(e.d) < 0) add('error', 'days', sName(s) + ' (' + u.label + ') จัดได้เฉพาะวัน' + days.map(function (d) { return DAYS[d]; }).join('/') + ' แต่อยู่วัน' + DAYS[e.d], [e.key]);
      if (!(s.grades || []).some(function (g) { return u.grades.indexOf(g) >= 0; })) add('warning', 'not_grade', sName(s) + ' ไม่ได้อยู่ในหลักสูตรของ ' + u.label, [e.key]);
      const asg = (input.assign || {})[e.u + '|' + e.s];   // มอบหมายการสอนไว้ (วิชา × ชั้น → ครู)
      if (!e.t) (noTeacher[e.u] = noTeacher[e.u] || []).push(e.key);
      else if (asg && e.t !== asg) add('warning', 'not_assigned', sName(s) + ' (' + u.label + ' วัน' + DAYS[e.d] + ' ' + P[e.p].label + ') มอบหมายให้ครู' + tName(T[asg]) + ' แต่จัดครู' + tName(T[e.t]), [e.key]);
      else if (!asg && elig[e.s] && !elig[e.s][e.t]) add('warning', 't_elig', 'ครู' + tName(T[e.t]) + ' ไม่ได้ถูกกำหนดให้สอน ' + sName(s) + ' (' + u.label + ' วัน' + DAYS[e.d] + ' ' + P[e.p].label + ')', [e.key]);
      if (s.room_type) {
        const r = R[e.r];
        if (r && r.type !== s.room_type) add('warning', 'room_type', sName(s) + ' ควรใช้ห้องประเภท "' + s.room_type + '" แต่จัดไว้ที่ ' + r.name, [e.key]);
      }
      if (e.r && R[e.r] && (R[e.r].allowed_subjects || []).length && R[e.r].allowed_subjects.indexOf(e.s) < 0) add('warning', 'room_type', 'ห้อง' + R[e.r].name + ' ไม่ได้เปิดให้ใช้กับ ' + sName(s), [e.key]);
      const pk = e.u + '|' + e.s + '|' + e.d;
      (perDay[pk] = perDay[pk] || []).push(e.key);
      (count[e.u + '|' + e.s] = count[e.u + '|' + e.s] || []).push(e.key);
    });
    Object.keys(perDay).forEach(function (pk) {
      const parts = pk.split('|'), s = S[parts[1]], rules = (s && s.rules) || {};
      const lim = Math.max(Number(rules.max_per_day) > 0 ? Number(rules.max_per_day) : defPerDay, Number(rules.consecutive) || 1);
      if (perDay[pk].length > lim) add('error', 'per_day', sName(s) + ' (' + U[parts[0]].label + ') วัน' + DAYS[parts[2]] + ' มี ' + perDay[pk].length + ' คาบ เกินวันละ ' + lim + ' คาบ', perDay[pk]);
    });
    Object.keys(noTeacher).forEach(function (u) { add('warning', 'no_teacher', U[u].label + ' มี ' + noTeacher[u].length + ' คาบที่ยังไม่ระบุครู', noTeacher[u], { unit_id: u }); });

    // ── จำนวนคาบตามหลักสูตร + คาบว่างแทรก (ต่อหน่วย) ──
    const unitCount = {};
    units.forEach(function (u) {
      // คาบที่ล็อกไว้ต้องเป็นวิชานั้น
      const cs0 = (input.cells || {})[u.unit_id] || {};
      (input.subjects || []).forEach(function (s) {
        if (!(s.grades || []).some(function (g) { return u.grades.indexOf(g) >= 0; })) return;
        ((s.rules || {}).fixed_slots || []).slice(0, Number(s.periods_week) || 0).forEach(function (x) {
          if (pIdx[x.period_id] === undefined) return;
          const c = cs0[Number(x.day) + '|' + x.period_id];
          if (c && c.subject_id === s.subject_id) return;
          add('warning', 'fixed_slot', u.label + ' · ' + sName(s) + ' ล็อกไว้วัน' + DAYS[Number(x.day)] + ' ' + P[pIdx[x.period_id]].label + ' แต่ช่องนี้' + (c ? 'เป็น ' + sName(S[c.subject_id]) : 'ว่าง'),
            [u.unit_id + '|' + Number(x.day) + '|' + x.period_id], { unit_id: u.unit_id });
        });
      });
      const uc = (unitCount[u.unit_id] = {});
      Object.keys(count).forEach(function (k) { if (k.split('|')[0] === u.unit_id) uc[k.split('|')[1]] = count[k].length; });
      (input.subjects || []).forEach(function (s) {
        if (!(s.grades || []).some(function (g) { return u.grades.indexOf(g) >= 0; })) return;
        const need = Number(s.periods_week) || 0, have = uc[s.subject_id] || 0;
        if (have < need) add('warning', 'count', u.label + ' · ' + sName(s) + ' ขาด ' + (need - have) + ' คาบ (มี ' + have + '/' + need + ')', [], { unit_id: u.unit_id, subject_id: s.subject_id });
        else if (have > need) add('warning', 'count', u.label + ' · ' + sName(s) + ' เกิน ' + (have - need) + ' คาบ (มี ' + have + '/' + need + ')', count[u.unit_id + '|' + s.subject_id], { unit_id: u.unit_id, subject_id: s.subject_id });
      });
      if (cfg.avoid_gaps !== false) {
        const cs = (input.cells || {})[u.unit_id] || {};
        for (let d = 1; d <= 5; d++) {
          const filled = P.map(function (p) { const c = cs[d + '|' + p.period_id]; return !!(c && c.subject_id); });
          const first = filled.indexOf(true), last = filled.lastIndexOf(true);
          const gaps = [];
          for (let p = first + 1; first >= 0 && p < last; p++) if (!filled[p]) gaps.push(u.unit_id + '|' + d + '|' + P[p].period_id);
          if (gaps.length) add('warning', 'gap', u.label + ' วัน' + DAYS[d] + ' มีคาบว่างแทรก ' + gaps.length + ' คาบ', gaps, { unit_id: u.unit_id });
        }
      }
    });

    // ── สรุป ──
    let coreAft = 0, actMorn = 0;
    E.forEach(function (e) {
      const s = S[e.s];
      if (!s) return;
      if ((s.type || 'core') === 'core' && sess[e.p] === 'afternoon') coreAft++;
      if (s.type === 'activity' && sess[e.p] === 'morning') actMorn++;
    });
    const errors = issues.filter(function (i) { return i.level === 'error'; }).length;
    const warnings = issues.length - errors;
    const bad = E.filter(function (e) { return cellLevel[e.key]; }).length;
    issues.sort(function (a, b) { return (a.level === b.level ? 0 : a.level === 'error' ? -1 : 1); });
    return {
      issues: issues, cellLevel: cellLevel, unitCount: unitCount, teacherLoad: teacherLoad,
      summary: { errors: errors, warnings: warnings, filled: E.length, ok: E.length - bad, total: units.length * np * 5, coreAft: coreAft, actMorn: actMorn },
    };
  }

  const api = { check: check };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.TTCheck = api;
})(typeof self !== 'undefined' ? self : this);
