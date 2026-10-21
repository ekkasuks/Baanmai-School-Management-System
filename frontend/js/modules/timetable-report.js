/**
 * AI Smart Timetable — เฟส 4: รายงาน (โมดูล 11) + ส่งออก (โมดูล 8)
 *   รายงาน: ตารางเรียนรายชั้น · ตารางสอนรายครู · ตารางการใช้ห้อง · ตารางรวมทั้งโรงเรียน · ภาระงานสอนครู
 *           · คาบรายวิชาเทียบหลักสูตร · ผลการตรวจสอบ · ประวัติการเปลี่ยนแปลง
 *   ส่งออก: PDF (jsPDF + Sarabun) · Excel (SheetJS) · CSV (UTF-8 BOM) · JSON (ข้อมูลฉบับเต็ม) · PNG (html2canvas) · พิมพ์
 * อ่านอย่างเดียว — ไม่เขียนข้อมูลใด ๆ
 * window.TTData ใช้ร่วมกับ timetable-search.js
 */
(function () {
  const esc = Utils.esc;
  const H2C_URL = 'https://cdn.jsdelivr.net/npm/html2canvas@1.4.1/dist/html2canvas.min.js';
  const TYPE_FILL = { core: [227, 242, 253], elective: [243, 229, 245], activity: [232, 245, 233], practical: [255, 243, 224] };
  const STATUS = { generated: 'จัดเสร็จ (AI)', edited: 'แก้ไขแล้ว', draft: 'ร่าง', approved: 'อนุมัติแล้ว', published: 'เผยแพร่แล้ว' };
  const DAYS = [1, 2, 3, 4, 5];

  /* ════ ข้อมูลฉบับตาราง (ใช้ร่วมกับหน้าค้นหา) ════ */
  function S() { return TT.S; }
  function shortSubject(n) { return String(n || '').replace(/\s*\(ป\.[^)]*\)$/, ''); }
  function shortTeacher(t) { return t ? String(t.name || '').split(/\s+/)[0] : ''; }
  function periods() { return S().periods.slice().sort(function (a, b) { return (a.seq || 0) - (b.seq || 0); }); }
  function teachPeriods() { return periods().filter(function (p) { return String(p.is_break) !== '1'; }); }
  function pTime(p) { return (p.start_time || '') + (p.end_time ? '–' + p.end_time : ''); }

  /** ฉบับที่ควรใช้เป็นค่าเริ่มต้น: เผยแพร่ > อนุมัติ > ล่าสุด */
  function defaultVersion() {
    const vs = S().versions || [];
    return (vs.find(function (v) { return v.status === 'published'; }) || vs.find(function (v) { return v.status === 'approved'; }) || vs[0] || {}).version_id || null;
  }

  const TTData = {
    vid: null, data: null,
    /** โหลดฉบับ (รอให้ตัวแก้ไขบันทึกที่ค้างก่อน) → { version, units, cells, entries, check } */
    load: async function (vid) {
      if (window.TTEdit && TTEdit.whenSaved) await TTEdit.whenSaved();
      const d = await api('tt.get_version', { version_id: vid }, { loadingMsg: 'กำลังโหลดตาราง...' });
      const units = ((S().dashboard && S().dashboard.units) || []).slice();
      const byClass = {};
      d.slots.forEach(function (s) { (byClass[s.class_id] = byClass[s.class_id] || {})[s.day + '|' + s.period_id] = s; });
      const cells = {};
      units.forEach(function (u) {
        const m = (cells[u.unit_id] = {});
        u.class_ids.forEach(function (cid) { Object.keys(byClass[cid] || {}).forEach(function (k) { if (!m[k] && byClass[cid][k].subject_id) m[k] = byClass[cid][k]; }); });
      });
      const check = TTCheck.check({ units: units, cells: cells, subjects: S().subjects, teachers: S().teachers, rooms: S().rooms, periods: S().periods, config: S().config || {} });
      const pIdx = {}, ps = teachPeriods();
      ps.forEach(function (p, i) { pIdx[p.period_id] = i; });
      const find = function (list, pk, id) { return id ? list.find(function (x) { return x[pk] === id; }) : null; };
      const entries = [];
      units.forEach(function (u) {
        Object.keys(cells[u.unit_id]).forEach(function (k) {
          const c = cells[u.unit_id][k], parts = k.split('|');
          if (pIdx[parts[1]] === undefined) return;
          entries.push({ u: u, k: k, day: Number(parts[0]), pid: parts[1], pi: pIdx[parts[1]], p: ps[pIdx[parts[1]]],
            s: find(S().subjects, 'subject_id', c.subject_id), t: find(S().teachers, 'teacher_id', c.teacher_id),
            r: find(S().rooms, 'room_id', c.room_id), locked: String(c.locked) === '1', level: check.cellLevel[u.unit_id + '|' + k] || '' });
        });
      });
      entries.sort(function (a, b) { return a.day - b.day || a.pi - b.pi || (a.u.sort || 0) - (b.u.sort || 0); });
      TTData.vid = vid;
      TTData.data = { version: d.version, slots: d.slots, units: units, cells: cells, entries: entries, check: check };
      window.dispatchEvent(new CustomEvent('tt:data'));
      return TTData.data;
    },
    defaultVersion: defaultVersion,
    shortSubject: shortSubject, shortTeacher: shortTeacher, teachPeriods: teachPeriods, periods: periods, pTime: pTime,
  };
  window.TTData = TTData;

  /* ════ ส่วนช่วยดาวน์โหลด ════ */
  function download(blob, name) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    document.body.appendChild(a);
    a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  }
  function csvText(rows) {
    return '﻿' + rows.map(function (r) {
      return r.map(function (v) { const s = String(v === null || v === undefined ? '' : v); return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; }).join(',');
    }).join('\r\n');
  }
  function cellText(c) { return c === null || c === undefined ? '' : typeof c === 'object' ? c.t : String(c); }
  function safeName(s) { return String(s || '').replace(/[\\/:*?"<>|\s]+/g, '_').replace(/_+/g, '_').slice(0, 60); }
  TTData.download = download;
  TTData.csvText = csvText;

  /* ════ ตัวสร้างรายงาน ════
     report = { title, orientation, file, sections:[{ heading, sub, head:[], rows:[[cell]], grid:bool, sign:[], widths? }] }
     cell = string | { t, type?, brk?, bad? } */
  function gridSection(heading, sub, cellFn, sign) {
    const ps = periods();
    return {
      heading: heading, sub: sub, grid: true, sign: sign,
      head: ['วัน'].concat(ps.map(function (p) { return p.label + '\n' + pTime(p); })),
      rows: DAYS.map(function (d) {
        return [TT.DAY_NAMES[d]].concat(ps.map(function (p) {
          if (String(p.is_break) === '1') return { t: p.label, brk: true };
          return cellFn(d, p) || '';
        }));
      }),
    };
  }
  function unitEntries(d, uid) { return d.entries.filter(function (e) { return e.u.unit_id === uid; }); }
  function at(list, day, pid) { return list.filter(function (e) { return e.day === day && e.pid === pid; }); }
  function homeroomName(u) {
    const c = u.class_ids.map(function (id) { return S().classes.find(function (x) { return x.class_id === id; }); }).find(function (c) { return c && c.homeroom_teacher_id; });
    const t = c && S().teachers.find(function (x) { return x.teacher_id === c.homeroom_teacher_id; });
    return t ? TT.teacherName(t) : '';
  }

  const REPORTS = {
    class: {
      label: '🎒 ตารางเรียนรายชั้น', orientation: 'l', sign: true,
      targets: function (d) { return d.units.filter(function (u) { return unitEntries(d, u.unit_id).length; }).map(function (u) { return [u.unit_id, u.label + (u.combined ? ' (ควบชั้น)' : '')]; }); },
      build: function (d, target, opt) {
        return d.units.filter(function (u) { return (target === '*' || u.unit_id === target) && unitEntries(d, u.unit_id).length; }).map(function (u) {
          const es = unitEntries(d, u.unit_id), hr = homeroomName(u);
          return gridSection('ตารางเรียน ชั้น ' + u.label, (hr ? 'ครูประจำชั้น ' + hr + ' · ' : '') + es.length + ' คาบ/สัปดาห์',
            function (day, p) {
              const e = at(es, day, p.period_id)[0];
              if (!e) return null;
              return { t: shortSubject(e.s && e.s.name) + (opt.teacher && e.t ? '\n' + 'ครู' + shortTeacher(e.t) : '') + (opt.room && e.r ? '\n' + e.r.name : ''), type: e.s && e.s.type, bad: e.level === 'error' };
            }, opt.sign ? ['ครูประจำชั้น', 'ผู้อำนวยการโรงเรียน'] : null);
        });
      },
    },
    teacher: {
      label: '👩‍🏫 ตารางสอนรายครู', orientation: 'l', sign: true,
      targets: function (d) {
        const used = {};
        d.entries.forEach(function (e) { if (e.t) used[e.t.teacher_id] = 1; });
        return S().teachers.filter(function (t) { return used[t.teacher_id]; }).map(function (t) { return [t.teacher_id, TT.teacherName(t)]; });
      },
      build: function (d, target, opt) {
        return S().teachers.filter(function (t) { return target === '*' || t.teacher_id === target; }).map(function (t) {
          const es = d.entries.filter(function (e) { return e.t && e.t.teacher_id === t.teacher_id; });
          if (!es.length) return null;
          const load = Object.keys(es.reduce(function (m, e) { m[e.k] = 1; return m; }, {})).length;
          return gridSection('ตารางสอน ' + TT.teacherName(t), (t.dept ? 'กลุ่มสาระ' + t.dept + ' · ' : '') + 'สอน ' + load + ' คาบ/สัปดาห์',
            function (day, p) {
              const list = at(es, day, p.period_id);
              if (!list.length) return null;
              return { t: shortSubject(list[0].s && list[0].s.name) + '\n' + list.map(function (e) { return e.u.label; }).join(', ') + (opt.room && list[0].r ? '\n' + list[0].r.name : ''),
                type: list[0].s && list[0].s.type, bad: list.some(function (e) { return e.level === 'error'; }) };
            }, opt.sign ? ['ครูผู้สอน', 'ผู้อำนวยการโรงเรียน'] : null);
        }).filter(Boolean);
      },
    },
    room: {
      label: '🏫 ตารางการใช้ห้อง', orientation: 'l',
      targets: function (d) {
        const used = {};
        d.entries.forEach(function (e) { if (e.r) used[e.r.room_id] = 1; });
        return S().rooms.filter(function (r) { return used[r.room_id]; }).map(function (r) { return [r.room_id, r.name]; });
      },
      build: function (d, target) {
        return S().rooms.filter(function (r) { return target === '*' || r.room_id === target; }).map(function (r) {
          const es = d.entries.filter(function (e) { return e.r && e.r.room_id === r.room_id; });
          if (!es.length) return null;
          return gridSection('ตารางการใช้ห้อง ' + r.name, (r.building ? 'อาคาร ' + r.building + ' · ' : '') + 'ใช้ ' + Object.keys(es.reduce(function (m, e) { m[e.k] = 1; return m; }, {})).length + ' คาบ/สัปดาห์',
            function (day, p) {
              const list = at(es, day, p.period_id);
              if (!list.length) return null;
              return { t: list.map(function (e) { return shortSubject(e.s && e.s.name) + ' · ' + e.u.label; }).join('\n'), type: list[0].s && list[0].s.type };
            });
        }).filter(Boolean);
      },
    },
    master: {
      label: '🗂️ ตารางรวมทั้งโรงเรียน (รายวัน)', orientation: 'l',
      build: function (d, target, opt) {
        const ps = periods(), us = d.units.filter(function (u) { return unitEntries(d, u.unit_id).length; });
        return DAYS.map(function (day) {
          return {
            heading: 'ตารางรวมทั้งโรงเรียน วัน' + TT.DAY_NAMES[day], sub: us.length + ' ชั้นเรียน', grid: true,
            head: ['ชั้น'].concat(ps.map(function (p) { return p.label + '\n' + pTime(p); })),
            rows: us.map(function (u) {
              const es = unitEntries(d, u.unit_id);
              return [u.label].concat(ps.map(function (p) {
                if (String(p.is_break) === '1') return { t: p.label, brk: true };
                const e = at(es, day, p.period_id)[0];
                return e ? { t: shortSubject(e.s && e.s.name) + (opt.teacher && e.t ? '\n' + shortTeacher(e.t) : ''), type: e.s && e.s.type, bad: e.level === 'error' } : '';
              }));
            }),
          };
        });
      },
    },
    load: {
      label: '📊 สรุปภาระงานสอนครู', orientation: 'l',
      build: function (d) {
        const rows = S().teachers.map(function (t) {
          const es = d.entries.filter(function (e) { return e.t && e.t.teacher_id === t.teacher_id; });
          const slot = {}, perDay = [0, 0, 0, 0, 0, 0], subs = {};
          es.forEach(function (e) {
            if (!slot[e.k]) { slot[e.k] = 1; perDay[e.day]++; }
            const n = shortSubject(e.s && e.s.name);
            (subs[n] = subs[n] || {})[e.u.label] = 1;
          });
          const total = Object.keys(slot).length;
          const mx = t.max_periods, mn = t.min_periods;
          const st = mx != null && total > mx ? 'เกินคาบสูงสุด' : mn != null && total < mn ? 'ต่ำกว่าขั้นต่ำ' : 'ปกติ';
          return [TT.teacherName(t), t.dept || '-'].concat(DAYS.map(function (x) { return perDay[x]; })).concat([
            { t: String(total), bad: st === 'เกินคาบสูงสุด' }, (mn != null ? mn : '-') + ' – ' + (mx != null ? mx : '-'),
            Object.keys(subs).map(function (n) { return n + ' (' + Object.keys(subs[n]).join(', ') + ')'; }).join('\n') || '-',
            { t: st, bad: st !== 'ปกติ' }]);
        });
        const none = d.entries.filter(function (e) { return !e.t; }).length;
        if (none) rows.push(['ยังไม่ระบุครู', '-'].concat(DAYS.map(function (x) { return d.entries.filter(function (e) { return !e.t && e.day === x; }).length; })).concat([String(none), '-', '-', { t: 'ต้องระบุครู', bad: true }]));
        return [{ heading: 'สรุปภาระงานสอนครู', sub: 'นับคาบแบบไม่ซ้ำเวลา (คาบเรียนควบชั้นนับครั้งเดียว)',
          head: ['ครู', 'กลุ่มสาระ', 'จ.', 'อ.', 'พ.', 'พฤ.', 'ศ.', 'รวม/สัปดาห์', 'ขั้นต่ำ–สูงสุด', 'วิชาที่สอน (ชั้น)', 'สถานะ'],
          rows: rows, widths: { 0: 42, 1: 30, 9: 70 } }];
      },
    },
    curriculum: {
      label: '📚 คาบรายวิชาเทียบหลักสูตร', orientation: 'l',
      build: function (d) {
        const us = d.units.filter(function (u) { return S().subjects.some(function (s) { return (s.grades || []).some(function (g) { return u.grades.indexOf(g) >= 0; }); }); });
        const rows = S().subjects.map(function (s) {
          let ok = true;
          const cols = us.map(function (u) {
            if (!(s.grades || []).some(function (g) { return u.grades.indexOf(g) >= 0; })) return '-';
            const have = (d.check.unitCount[u.unit_id] || {})[s.subject_id] || 0, need = Number(s.periods_week) || 0;
            if (have !== need) ok = false;
            return { t: have + '/' + need, bad: have !== need };
          });
          return [shortSubject(s.name) + ((s.grades || []).length ? ' (' + s.grades.join(',') + ')' : '')].concat(cols).concat([{ t: ok ? '✓ ครบ' : '✗ ไม่ตรง', bad: !ok }]);
        });
        const tot = ['รวมคาบ/สัปดาห์'].concat(us.map(function (u) { return String(unitEntries(d, u.unit_id).length); })).concat(['']);
        rows.push(tot);
        return [{ heading: 'จำนวนคาบรายวิชาเทียบหลักสูตร', sub: 'ช่อง = คาบที่จัดได้/คาบตามหลักสูตร ต่อสัปดาห์',
          head: ['วิชา'].concat(us.map(function (u) { return u.label; })).concat(['ผล']), rows: rows, widths: { 0: 60 } }];
      },
    },
    check: {
      label: '🩺 รายงานผลการตรวจสอบ', orientation: 'p',
      build: function (d) {
        const s = d.check.summary;
        const rows = d.check.issues.map(function (i, n) { return [String(n + 1), { t: i.level === 'error' ? 'ข้อผิดพลาด' : 'คำเตือน', bad: i.level === 'error' }, i.msg]; });
        return [{ heading: 'รายงานผลการตรวจสอบตาราง', sub: 'ข้อผิดพลาด ' + s.errors + ' · คำเตือน ' + s.warnings + ' · คาบที่ผ่าน ' + s.ok + '/' + s.filled,
          head: ['#', 'ระดับ', 'รายละเอียด'], rows: rows.length ? rows : [['-', '-', 'ไม่พบปัญหา ✓']], widths: { 0: 10, 1: 26 } }];
      },
    },
    changes: {
      label: '🕘 ประวัติการเปลี่ยนแปลง', orientation: 'p', async: true,
      build: async function (d) {
        const r = await api('tt.changes', { version_id: TTData.vid, limit: 300 }, { loadingMsg: 'กำลังโหลดประวัติ...' });
        const act = { GENERATE: 'สร้างด้วย AI', EDIT: 'แก้ไขตาราง', UPDATE: 'แก้ข้อมูลฉบับ', COPY: 'ทำสำเนา', DELETE: 'ลบ' };
        const rows = r.items.map(function (i) {
          const det = i.detail || {};
          const msg = i.message || (det.status ? 'สถานะ → ' + (STATUS[det.status] || det.status) : det.label ? 'ชื่อ → ' + det.label : det.from ? 'สำเนาจากฉบับ ' + det.from : '');
          return [Utils.fmtDateTime(i.created_at), act[det.action] || det.action || '-', msg + (det.cells ? ' (' + det.cells + ' ช่อง)' : ''), i.created_by || '-'];
        });
        return [{ heading: 'ประวัติการเปลี่ยนแปลงของฉบับ', sub: r.total + ' รายการ' + (r.total > rows.length ? ' (แสดงล่าสุด ' + rows.length + ')' : ''),
          head: ['เวลา', 'การกระทำ', 'รายละเอียด', 'โดย'], rows: rows.length ? rows : [['-', '-', 'ยังไม่มีประวัติ', '-']], widths: { 0: 34, 1: 26, 3: 18 } }];
      },
    },
  };

  /* ════ หน้าจอ ════ */
  const host = document.getElementById('tab-report');
  const R = { type: 'class', target: '*', opt: { teacher: true, room: false, sign: true }, report: null, school: 'โรงเรียนบ้านใหม่' };
  AppSettings.schoolName().then(function (n) { R.school = n; }).catch(function () {});

  function shell() {
    host.innerHTML =
      '<div class="card">' +
        '<h3 class="card-title">📑 รายงาน / ส่งออก</h3>' +
        '<div class="tt-toolbar">' +
          '<select class="form-control" data-ver></select>' +
          '<select class="form-control" data-type>' + Object.keys(REPORTS).map(function (k) { return '<option value="' + k + '">' + REPORTS[k].label + '</option>'; }).join('') + '</select>' +
          '<select class="form-control" data-target></select>' +
        '</div>' +
        '<div class="tt-checks" data-opts style="margin-bottom:10px">' +
          '<label class="tt-chip"><input type="checkbox" data-o="teacher" checked> แสดงชื่อครู</label>' +
          '<label class="tt-chip"><input type="checkbox" data-o="room"> แสดงห้อง</label>' +
          '<label class="tt-chip"><input type="checkbox" data-o="sign" checked> ช่องลงชื่อ</label>' +
        '</div>' +
        '<div class="tt-toolbar tt-export">' +
          '<button class="btn btn-danger" data-x="pdf"><i class="bi bi-file-earmark-pdf"></i> PDF</button>' +
          '<button class="btn btn-success" data-x="xlsx"><i class="bi bi-file-earmark-excel"></i> Excel</button>' +
          '<button class="btn btn-secondary" data-x="csv"><i class="bi bi-filetype-csv"></i> CSV</button>' +
          '<button class="btn btn-secondary" data-x="png"><i class="bi bi-image"></i> PNG</button>' +
          '<button class="btn btn-secondary" data-x="json" title="ข้อมูลฉบับเต็ม (ใช้สำรอง/นำเข้า)"><i class="bi bi-filetype-json"></i> JSON</button>' +
          '<button class="btn btn-primary" data-x="print"><i class="bi bi-printer"></i> พิมพ์</button>' +
        '</div>' +
      '</div>' +
      '<div class="card"><div id="tt-rep-preview" class="tt-rep"></div></div>';
    host.querySelector('[data-ver]').onchange = function () { if (this.value) load(this.value); };
    host.querySelector('[data-type]').onchange = function () { R.type = this.value; R.target = '*'; build(); };
    host.querySelector('[data-target]').onchange = function () { R.target = this.value; build(); };
    host.querySelectorAll('[data-o]').forEach(function (c) { c.onchange = function () { R.opt[c.dataset.o] = c.checked; build(); }; });
    host.querySelectorAll('[data-x]').forEach(function (b) { b.onclick = function () { exportAs(b.dataset.x); }; });
  }

  function renderVersions() {
    const sel = host.querySelector('[data-ver]');
    const vs = S().versions || [];
    sel.innerHTML = vs.length ? vs.map(function (v) {
      return '<option value="' + esc(v.version_id) + '"' + (v.version_id === TTData.vid ? ' selected' : '') + '>' + esc(v.label) + ' · ' + esc(STATUS[v.status] || v.status) + '</option>';
    }).join('') : '<option value="">— ยังไม่มีฉบับตาราง —</option>';
  }

  async function load(vid) {
    try { await TTData.load(vid); } catch (e) { /* toast — สร้างรายงานใหม่ผ่าน event tt:data */ }
  }

  async function build() {
    const d = TTData.data, def = REPORTS[R.type];
    const tsel = host.querySelector('[data-target]');
    if (def.targets && d) {
      const ts = def.targets(d);
      tsel.innerHTML = '<option value="*">ทั้งหมด (' + ts.length + ')</option>' + ts.map(function (t) { return '<option value="' + esc(t[0]) + '">' + esc(t[1]) + '</option>'; }).join('');
      if (!ts.some(function (t) { return t[0] === R.target; })) R.target = '*';
      tsel.value = R.target;
      tsel.classList.remove('hidden');
    } else tsel.classList.add('hidden');
    host.querySelector('[data-opts]').classList.toggle('hidden', ['class', 'teacher', 'master'].indexOf(R.type) < 0);
    const pv = document.getElementById('tt-rep-preview');
    if (!d) { pv.innerHTML = '<div class="text-muted">' + ((S().versions || []).length ? 'เลือกฉบับตาราง' : 'ยังไม่มีฉบับตาราง — ไปที่แท็บ "🤖 จัดตาราง AI" เพื่อสร้างและบันทึกฉบับแรก') + '</div>'; R.report = null; return; }
    try {
      const sections = (await def.build(d, R.target, R.opt)) || [];
      const v = d.version;
      R.report = {
        title: def.label.replace(/^\S+\s/, ''), orientation: def.orientation, sections: sections,
        sub: ((S().term && S().term.label) || '') + ' · ฉบับ "' + v.label + '" (' + (STATUS[v.status] || v.status) + ')',
        file: safeName('timetable_' + R.type + (R.target !== '*' ? '_' + (def.targets ? (def.targets(d).find(function (t) { return t[0] === R.target; }) || [])[1] : R.target) : '') + '_' + v.label),
      };
      pv.innerHTML = reportHtml(R.report);
    } catch (e) { pv.innerHTML = '<div class="alert alert-danger">' + esc(e.message) + '</div>'; R.report = null; }
  }

  /** แถว → แถวที่ช่องพักรวมเป็นช่องเดียว (rowSpan) สำหรับ HTML/PDF */
  function mergeBreaks(rows) {
    if (!rows.length) return rows.map(function (r) { return r.slice(); });
    const cols = rows[0].map(function (_, j) { return rows.every(function (r) { return r[j] && r[j].brk; }); });
    return rows.map(function (r, i) {
      return r.map(function (c, j) {
        if (!cols[j]) return c;
        return i === 0 ? Object.assign({}, c, { rowSpan: rows.length }) : undefined;
      }).filter(function (c) { return c !== undefined; });
    });
  }

  function reportHtml(rep) {
    if (!rep.sections.length) return '<div class="text-muted">ไม่มีข้อมูลสำหรับรายงานนี้</div>';
    return rep.sections.map(function (sec) {
      const rows = sec.grid ? mergeBreaks(sec.rows) : sec.rows;
      return '<section class="tt-rep-sec' + (rep.orientation === 'l' ? ' land' : '') + '">' +
        '<div class="tt-rep-head"><div class="school">' + esc(R.school) + '</div><div class="title">' + esc(sec.heading) + '</div>' +
        '<div class="tt-note">' + esc(rep.sub) + (sec.sub ? ' · ' + esc(sec.sub) : '') + '</div></div>' +
        '<div class="table-wrap"><table class="tt-rep-table' + (sec.grid ? ' grid' : '') + '"><thead><tr>' +
        sec.head.map(function (h) { return '<th>' + esc(h).replace(/\n/g, '<br><span class="tt-note">') + (h.indexOf('\n') >= 0 ? '</span>' : '') + '</th>'; }).join('') +
        '</tr></thead><tbody>' + rows.map(function (r) {
          return '<tr>' + r.map(function (c, j) {
            const o = typeof c === 'object' && c ? c : { t: c };
            const cls = [o.brk ? 'brk' : '', o.type ? 'ty-' + o.type : '', o.bad ? 'bad' : '', j === 0 ? 'first' : ''].filter(Boolean).join(' ');
            return '<td' + (cls ? ' class="' + cls + '"' : '') + (o.rowSpan ? ' rowspan="' + o.rowSpan + '"' : '') + '>' + esc(o.t === undefined ? '' : o.t).replace(/\n/g, '<br>') + '</td>';
          }).join('') + '</tr>';
        }).join('') + '</tbody></table></div>' +
        (sec.sign ? '<div class="tt-sign">' + sec.sign.map(function (s) { return '<div>ลงชื่อ ................................................<br>(................................................)<br>' + esc(s) + '</div>'; }).join('') + '</div>' : '') +
        '</section>';
    }).join('');
  }

  /* ════ ส่งออก ════ */
  async function exportAs(kind) {
    if (kind === 'json') return exportJson();
    const rep = R.report;
    if (!rep || !rep.sections.length) { Toast.show('ยังไม่มีข้อมูลรายงาน', 'warning'); return; }
    try {
      if (kind === 'pdf') await exportPdf(rep);
      else if (kind === 'xlsx') await exportXlsx(rep);
      else if (kind === 'csv') download(new Blob([csvText(flatRows(rep))], { type: 'text/csv;charset=utf-8' }), rep.file + '.csv');
      else if (kind === 'png') await exportPng(rep);
      else if (kind === 'print') printReport(rep);
    } catch (e) { Toast.show('ส่งออกไม่สำเร็จ: ' + e.message, 'danger'); }
  }

  function flatRows(rep) {
    const out = [[R.school], [rep.title], [rep.sub], []];
    rep.sections.forEach(function (sec) {
      out.push([sec.heading + (sec.sub ? ' · ' + sec.sub : '')]);
      out.push(sec.head.map(function (h) { return h.replace(/\n/g, ' '); }));
      sec.rows.forEach(function (r) { out.push(r.map(function (c) { return cellText(c).replace(/\n/g, ' / '); })); });
      out.push([]);
    });
    return out;
  }

  async function exportPdf(rep) {
    Loading.show('กำลังสร้าง PDF...');
    try {
      const doc = await PDF.newDoc(rep.orientation);
      const W = doc.internal.pageSize.getWidth(), Hh = doc.internal.pageSize.getHeight();
      rep.sections.forEach(function (sec, i) {
        if (i > 0) doc.addPage();
        let y = PDF.header(doc, R.school, sec.heading);
        doc.setFontSize(10);
        doc.text(rep.sub + (sec.sub ? ' · ' + sec.sub : ''), W / 2, y - 2, { align: 'center' });
        const rows = sec.grid ? mergeBreaks(sec.rows) : sec.rows;
        const body = rows.map(function (r) {
          return r.map(function (c) {
            const o = typeof c === 'object' && c ? c : { t: c };
            const st = {};
            if (o.brk) { st.fillColor = [245, 245, 245]; st.textColor = [120, 144, 156]; }
            else if (o.type && TYPE_FILL[o.type]) st.fillColor = TYPE_FILL[o.type];
            if (o.bad) { st.textColor = [198, 40, 40]; st.fontStyle = 'bold'; }
            return { content: o.t === undefined ? '' : String(o.t), rowSpan: o.rowSpan || 1, styles: st };
          });
        });
        const colStyles = { 0: { fontStyle: 'bold', halign: sec.grid ? 'center' : 'left' } };
        Object.keys(sec.widths || {}).forEach(function (k) { colStyles[k] = Object.assign(colStyles[k] || {}, { cellWidth: sec.widths[k] }); });
        if (sec.grid) {   // คอลัมน์คาบกว้างเท่ากัน · ช่วงพักแคบ (ไม่งั้นคาบที่ว่างมากจะถูกบีบจนหัวตารางตกบรรทัด)
          const first = 26, brkW = 22, cols = sec.rows[0].length;
          const brk = sec.rows[0].map(function (c) { return !!(c && c.brk); });
          const nBrk = brk.filter(Boolean).length;
          const w = (W - 20 - first - nBrk * brkW) / (cols - 1 - nBrk);
          colStyles[0].cellWidth = first;
          for (let j = 1; j < cols; j++) colStyles[j] = { cellWidth: brk[j] ? brkW : w };
        }
        doc.autoTable({
          startY: y + 2, head: [sec.head], body: body, theme: 'grid',
          styles: { font: 'Sarabun', fontSize: sec.grid ? 10 : 9, halign: sec.grid ? 'center' : 'left', valign: 'middle', cellPadding: 1.6, minCellHeight: sec.grid ? (rep.orientation === 'l' && sec.rows.length <= 5 ? 22 : 12) : 0, lineColor: [176, 190, 197], lineWidth: 0.2 },
          headStyles: { font: 'Sarabun', fontStyle: 'bold', fillColor: [79, 195, 247], textColor: 255, halign: 'center' },
          columnStyles: colStyles, margin: { left: 10, right: 10 },
        });
        if (sec.sign) {
          let sy = doc.lastAutoTable.finalY + 14;
          if (sy + 18 > Hh) { doc.addPage(); sy = 24; }
          doc.setFontSize(11);
          sec.sign.forEach(function (s, j) {
            const x = W * (j + 1) / (sec.sign.length + 1);
            doc.text('ลงชื่อ ......................................................', x, sy, { align: 'center' });
            doc.text('(......................................................)', x, sy + 7, { align: 'center' });
            doc.text(s, x, sy + 14, { align: 'center' });
          });
        }
      });
      doc.save(rep.file + '.pdf');
    } finally { Loading.hide(); }
  }

  async function exportXlsx(rep) {
    Loading.show('กำลังสร้าง Excel...');
    try {
      await LazyLib.xlsx();
      const wb = XLSX.utils.book_new(), used = {};
      rep.sections.forEach(function (sec, i) {
        const aoa = [[R.school], [sec.heading], [rep.sub + (sec.sub ? ' · ' + sec.sub : '')], [], sec.head.map(function (h) { return h.replace(/\n/g, ' '); })]
          .concat(sec.rows.map(function (r) { return r.map(cellText); }));
        const ws = XLSX.utils.aoa_to_sheet(aoa);
        ws['!cols'] = sec.head.map(function (h, j) { return { wch: j === 0 ? 16 : sec.grid ? 18 : Math.max(10, Math.min(60, (sec.widths && sec.widths[j]) || 14)) }; });
        let name = (rep.sections.length > 1 ? sec.heading.replace(/^(ตารางเรียน ชั้น |ตารางสอน |ตารางการใช้ห้อง |ตารางรวมทั้งโรงเรียน )/, '') : rep.title).replace(/[\\/?*[\]:]/g, ' ').slice(0, 28) || ('Sheet' + (i + 1));
        let n = name, k = 2;
        while (used[n]) n = name.slice(0, 26) + ' ' + (k++);
        used[n] = 1;
        XLSX.utils.book_append_sheet(wb, ws, n);
      });
      XLSX.writeFile(wb, rep.file + '.xlsx');
    } finally { Loading.hide(); }
  }

  async function exportPng(rep) {
    Loading.show('กำลังสร้างรูปภาพ...');
    try {
      await LazyLib.script(H2C_URL);
      const el = document.getElementById('tt-rep-preview');
      el.classList.add('tt-capture');
      let canvas;
      try { canvas = await window.html2canvas(el, { scale: 2, backgroundColor: '#ffffff', useCORS: true }); }
      finally { el.classList.remove('tt-capture'); }
      await new Promise(function (res) { canvas.toBlob(function (b) { download(b, rep.file + '.png'); res(); }, 'image/png'); });
    } finally { Loading.hide(); }
  }

  function printReport(rep) {
    let st = document.getElementById('tt-print-page');
    if (!st) { st = document.createElement('style'); st.id = 'tt-print-page'; document.head.appendChild(st); }
    st.textContent = '@page { size: A4 ' + (rep.orientation === 'l' ? 'landscape' : 'portrait') + '; margin: 10mm; }';
    document.body.classList.add('tt-printing');
    const done = function () { document.body.classList.remove('tt-printing'); window.removeEventListener('afterprint', done); };
    window.addEventListener('afterprint', done);
    window.print();
    setTimeout(done, 1500);
  }

  /** JSON ฉบับเต็ม: ข้อมูลอ้างอิง + ทุกช่อง (ใช้สำรองข้อมูล / นำเข้าในเฟส 5) */
  function exportJson() {
    const d = TTData.data;
    if (!d) { Toast.show('ยังไม่ได้เลือกฉบับตาราง', 'warning'); return; }
    const pick = function (o, ks) { const r = {}; ks.forEach(function (k) { r[k] = o[k]; }); return r; };
    const out = {
      format: 'baanmai-timetable', format_version: 1, exported_at: new Date().toISOString(), school: R.school,
      term: S().term, version: pick(d.version, ['version_id', 'label', 'status', 'created_at', 'stats']),
      periods: S().periods, subjects: S().subjects, teachers: S().teachers, rooms: S().rooms, classes: S().classes,
      units: d.units.map(function (u) { return pick(u, ['unit_id', 'label', 'class_ids', 'grades', 'combined']); }),
      config: S().config, slots: d.slots,
    };
    download(new Blob([JSON.stringify(out, null, 2)], { type: 'application/json' }), safeName('timetable_' + d.version.label) + '.json');
  }

  /* ════ เชื่อมกับหน้า ════ */
  document.querySelectorAll('#tt-tabs .tab').forEach(function (t) {
    t.addEventListener('click', function () {
      if (t.dataset.tab !== 'report') return;
      if (!host.querySelector('[data-ver]')) shell();
      renderVersions();
      const vid = TTData.vid && (S().versions || []).some(function (v) { return v.version_id === TTData.vid; }) ? TTData.vid : defaultVersion();
      if (vid) load(vid); else { TTData.data = null; build(); }
    });
  });
  window.addEventListener('tt:loaded', function () {
    if (TTData.vid && !(S().versions || []).some(function (v) { return v.version_id === TTData.vid; })) { TTData.vid = null; TTData.data = null; }
    if (host.querySelector('[data-ver]')) renderVersions();
  });
  window.addEventListener('tt:data', function () {
    if (host.querySelector('[data-ver]')) { renderVersions(); if (!host.classList.contains('hidden')) build(); }
  });
})();
