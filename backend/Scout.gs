/**
 * Scout module — คะแนนกิจกรรมลูกเสือ (ไม่ใช้ PIN)
 *
 * โครงสร้าง: หมู่ลูกเสือ (SCOUT_GROUP) ─< สมาชิก (SCOUT_MEMBER) → STUDENTS
 *            กิจกรรม (SCOUT_ACTIVITY) ─< คะแนน (SCOUT_SCORE) → หมู่
 *
 * หลักการให้คะแนน: บันทึกคะแนน "ต่อหมู่" 1 แถว/กิจกรรม
 *   → สมาชิกทุกคนในหมู่ได้คะแนนเท่ากันโดยปริยาย (ไม่ต้องเก็บรายคน)
 *
 * แยก sheet ใหม่ทั้งหมด — ไม่กระทบข้อมูล/โมดูลเดิม
 */

const ScoutAPI = {

  /** ปีการศึกษาปัจจุบัน + ปีที่มีข้อมูล (สำหรับ dropdown) */
  years: function () {
    const set = {};
    readAll('SCOUT_GROUP').forEach(function (g) { if (g.year) set[String(g.year)] = true; });
    readAll('SCOUT_ACTIVITY').forEach(function (a) { if (a.year) set[String(a.year)] = true; });
    const cur = SettingsAPI.get_raw('current_year');
    if (cur) set[String(cur)] = true;
    return { years: Object.keys(set).sort().reverse(), current: cur || '' };
  },

  /* ════════ แดชบอร์ด ════════ */

  /** สรุปคะแนนรวมตามหมู่ (+จำนวนสมาชิก, คะแนนเต็มรวม, %) */
  dashboard: function (params) {
    const year = scoutYear(params);
    return cachedResult('scout.dash:' + year,
      ['SCOUT_GROUP', 'SCOUT_MEMBER', 'SCOUT_ACTIVITY', 'SCOUT_SCORE', 'STUDENTS'], 60, function () {
        const groups = readAll('SCOUT_GROUP').filter(function (g) { return String(g.year) === year; });
        const activities = readAll('SCOUT_ACTIVITY').filter(function (a) { return String(a.year) === year; });
        const actIds = {};
        let maxTotal = 0;
        activities.forEach(function (a) { actIds[String(a.activity_id)] = true; maxTotal += Number(a.max_score) || 0; });

        // นับสมาชิกต่อหมู่
        const memberCount = {};
        readAll('SCOUT_MEMBER').forEach(function (m) {
          const gid = String(m.group_id);
          memberCount[gid] = (memberCount[gid] || 0) + 1;
        });

        // รวมคะแนนต่อหมู่ (เฉพาะกิจกรรมของปีนี้)
        const sums = {};
        const scored = {};
        readAll('SCOUT_SCORE').forEach(function (s) {
          if (!actIds[String(s.activity_id)]) return;
          const gid = String(s.group_id);
          sums[gid] = (sums[gid] || 0) + (Number(s.score) || 0);
          scored[gid] = (scored[gid] || 0) + 1;
        });

        const rows = groups.map(function (g) {
          const gid = String(g.group_id);
          const total = Math.round((sums[gid] || 0) * 100) / 100;
          return {
            group_id: gid, name: g.name,
            members: memberCount[gid] || 0,
            total: total,
            scored_activities: scored[gid] || 0,
            percent: maxTotal ? Math.round((total / maxTotal) * 1000) / 10 : 0,
          };
        }).sort(function (a, b) {
          if (b.total !== a.total) return b.total - a.total;
          return String(a.name).localeCompare(String(b.name), 'th');
        });
        rows.forEach(function (r, i) { r.rank = i + 1; });

        return {
          year: year,
          group_count: groups.length,
          activity_count: activities.length,
          max_total: Math.round(maxTotal * 100) / 100,
          total_awarded: Math.round(rows.reduce(function (s, r) { return s + r.total; }, 0) * 100) / 100,
          groups: rows,
        };
      });
  },

  /* ════════ หมู่ลูกเสือ ════════ */

  /** รายชื่อหมู่ + จำนวนสมาชิก */
  groups: function (params) {
    const year = scoutYear(params);
    const stIndex = buildIndex('STUDENTS', 'citizen_id');
    const memberCount = {};
    const leaderOf = {}, deputyOf = {};
    readAll('SCOUT_MEMBER').forEach(function (m) {
      const gid = String(m.group_id);
      memberCount[gid] = (memberCount[gid] || 0) + 1;
      const r = scoutRole(m.role);
      if (!r) return;
      const s = stIndex[String(m.citizen_id)];
      const nm = s ? studentName(s) : '';
      if (r === 'leader') leaderOf[gid] = nm; else deputyOf[gid] = nm;
    });
    const list = readAll('SCOUT_GROUP')
      .filter(function (g) { return String(g.year) === year; })
      .map(function (g) {
        const gid = String(g.group_id);
        return {
          group_id: g.group_id, name: g.name, year: String(g.year), note: g.note,
          members: memberCount[gid] || 0,
          leader: leaderOf[gid] || '', deputy: deputyOf[gid] || '',
        };
      })
      .sort(function (a, b) { return String(a.name).localeCompare(String(b.name), 'th'); });
    return { year: year, groups: list };
  },

  /** สร้าง/แก้ไขหมู่ */
  group_save: function (params) {
    const name = String(params.name || '').trim();
    if (!name) apiError('VALIDATION', 'กรุณาระบุชื่อหมู่');
    const year = scoutYear(params);

    if (params.group_id) {
      const idx = findRowIndex('SCOUT_GROUP', 'group_id', params.group_id);
      if (idx < 0) apiError('NOT_FOUND', 'ไม่พบหมู่ลูกเสือ');
      updateRow('SCOUT_GROUP', idx, { name: name, note: params.note || '', updated_at: now() });
      audit('scout', 'GROUP_UPDATE', params.group_id, { name: name }, params.recorded_by);
      return { group_id: params.group_id, name: name };
    }

    // กันชื่อซ้ำในปีเดียวกัน
    const dup = readAll('SCOUT_GROUP').some(function (g) {
      return String(g.year) === year && String(g.name).trim() === name;
    });
    if (dup) apiError('DUPLICATE', 'มีหมู่ชื่อนี้อยู่แล้วในปีการศึกษานี้');

    const id = genId('SG');
    appendRows('SCOUT_GROUP', [{
      group_id: id, name: name, year: year, note: params.note || '',
      created_at: now(), updated_at: now(),
    }]);
    audit('scout', 'GROUP_CREATE', id, { name: name, year: year }, params.recorded_by);
    return { group_id: id, name: name, year: year };
  },

  /** ลบหมู่ (ลบสมาชิกและคะแนนของหมู่นั้นด้วย) */
  group_delete: function (params) {
    const gid = String(params.group_id || '');
    if (!gid) apiError('VALIDATION', 'ไม่ได้ระบุหมู่');
    const idx = findRowIndex('SCOUT_GROUP', 'group_id', gid);
    if (idx < 0) apiError('NOT_FOUND', 'ไม่พบหมู่ลูกเสือ');

    deleteRowsWhere('SCOUT_MEMBER', 'group_id', gid);
    deleteRowsWhere('SCOUT_SCORE', 'group_id', gid);
    deleteRow('SCOUT_GROUP', findRowIndex('SCOUT_GROUP', 'group_id', gid));
    audit('scout', 'GROUP_DELETE', gid, {}, params.recorded_by);
    return { ok: true };
  },

  /**
   * สมาชิกในหมู่ (พร้อมข้อมูลนักเรียน)
   * ลำดับ: นายหมู่ (บนสุด) → สมาชิกทั่วไป (ชั้น→ชื่อ) → รองนายหมู่ (ล่างสุด)
   */
  members: function (params) {
    const gid = String(params.group_id || '');
    if (!gid) apiError('VALIDATION', 'ไม่ได้ระบุหมู่');
    const stIndex = buildIndex('STUDENTS', 'citizen_id');
    const list = readAll('SCOUT_MEMBER')
      .filter(function (m) { return String(m.group_id) === gid; })
      .map(function (m) {
        const s = stIndex[String(m.citizen_id)];
        return {
          member_id: m.member_id, citizen_id: m.citizen_id,
          name: s ? studentName(s) : '(ไม่พบนักเรียน)',
          student_code: s ? s.student_code : '', grade: s ? s.grade : '', room: s ? s.room : '',
          role: scoutRole(m.role),
          role_label: SCOUT_ROLE_LABEL[scoutRole(m.role)] || '',
        };
      })
      .sort(function (a, b) {
        const ra = scoutRoleOrder(a.role), rb = scoutRoleOrder(b.role);
        if (ra !== rb) return ra - rb;
        const d = gradeSortKey(a.grade) - gradeSortKey(b.grade);
        return d !== 0 ? d : String(a.name).localeCompare(String(b.name), 'th');
      });
    return { group_id: gid, members: list };
  },

  /**
   * กำหนด/ยกเลิกตำแหน่งในหมู่ — 1 หมู่มีนายหมู่ 1 คน และรองนายหมู่ 1 คน
   * params = { group_id, citizen_id, role: 'leader'|'deputy'|'' }
   */
  member_role: function (params) {
    const gid = String(params.group_id || '');
    const cid = String(params.citizen_id || '');
    const role = scoutRole(params.role);
    if (!gid || !cid) apiError('VALIDATION', 'ข้อมูลไม่ครบ');
    if (params.role && !role) apiError('VALIDATION', 'ตำแหน่งไม่ถูกต้อง');

    const sh = getSheet('SCOUT_MEMBER');
    const headers = SHEETS.SCOUT_MEMBER.headers;
    const lastRow = sh.getLastRow();
    if (lastRow <= 1) apiError('NOT_FOUND', 'ไม่พบสมาชิกในหมู่นี้');

    const gIdx = headers.indexOf('group_id');
    const cIdx = headers.indexOf('citizen_id');
    const rIdx = headers.indexOf('role');
    const values = sh.getRange(2, 1, lastRow - 1, headers.length).getValues();

    let targetRow = -1;
    const clearRows = [];
    for (let i = 0; i < values.length; i++) {
      if (String(values[i][gIdx]) !== gid) continue;
      if (String(values[i][cIdx]) === cid) { targetRow = i + 2; continue; }
      // ตั้งตำแหน่งใหม่ → ปลดคนเดิมที่ถือตำแหน่งเดียวกันในหมู่นี้
      if (role && scoutRole(values[i][rIdx]) === role) clearRows.push(i + 2);
    }
    if (targetRow < 0) apiError('NOT_FOUND', 'ไม่พบสมาชิกในหมู่นี้');

    clearRows.forEach(function (r) { sh.getRange(r, rIdx + 1).setValue(''); });
    sh.getRange(targetRow, rIdx + 1).setValue(role);
    invalidateCache('SCOUT_MEMBER');

    audit('scout', 'MEMBER_ROLE', gid, { citizen_id: cid, role: role || '(ยกเลิก)' }, params.recorded_by);
    return { ok: true, role: role, role_label: SCOUT_ROLE_LABEL[role] || '' };
  },

  /**
   * นักเรียนที่ยังไม่อยู่หมู่ใดในปีนี้ (สำหรับเลือกเข้าหมู่)
   * params = { year?, grade?, q? }
   */
  available_students: function (params) {
    const p = params || {};
    const year = scoutYear(p);
    // หมู่ของปีนี้
    const yearGroups = {};
    readAll('SCOUT_GROUP').forEach(function (g) {
      if (String(g.year) === year) yearGroups[String(g.group_id)] = true;
    });
    // นักเรียนที่อยู่หมู่แล้วในปีนี้
    const taken = {};
    readAll('SCOUT_MEMBER').forEach(function (m) {
      if (yearGroups[String(m.group_id)]) taken[String(m.citizen_id)] = true;
    });

    const q = String(p.q || '').trim().toLowerCase();
    let list = readAll('STUDENTS').filter(function (s) {
      if (s.status === 'inactive') return false;
      if (taken[String(s.citizen_id)]) return false;
      if (p.grade && s.grade !== p.grade) return false;
      if (q && (studentName(s) + ' ' + s.student_code).toLowerCase().indexOf(q) < 0) return false;
      return true;
    }).map(function (s) {
      return {
        citizen_id: s.citizen_id, student_code: s.student_code, name: studentName(s),
        grade: s.grade, room: s.room,
      };
    });

    list.sort(function (a, b) {
      const d = gradeSortKey(a.grade) - gradeSortKey(b.grade);
      if (d !== 0) return d;
      const r = (parseInt(a.room, 10) || 0) - (parseInt(b.room, 10) || 0);
      return r !== 0 ? r : String(a.name).localeCompare(String(b.name), 'th');
    });
    return { year: year, students: list.slice(0, 300), total: list.length };
  },

  /** เพิ่มสมาชิกเข้าหมู่ (ทีละหลายคน) — กันซ้ำ 1 คน/1 หมู่ ต่อปี */
  member_add: function (params) {
    const gid = String(params.group_id || '');
    const cids = params.citizen_ids;
    if (!gid) apiError('VALIDATION', 'ไม่ได้ระบุหมู่');
    if (!Array.isArray(cids) || !cids.length) apiError('VALIDATION', 'กรุณาเลือกนักเรียน');

    const group = buildIndex('SCOUT_GROUP', 'group_id')[gid];
    if (!group) apiError('NOT_FOUND', 'ไม่พบหมู่ลูกเสือ');
    const year = String(group.year);

    const yearGroups = {};
    readAll('SCOUT_GROUP').forEach(function (g) {
      if (String(g.year) === year) yearGroups[String(g.group_id)] = true;
    });
    const taken = {};
    readAll('SCOUT_MEMBER').forEach(function (m) {
      if (yearGroups[String(m.group_id)]) taken[String(m.citizen_id)] = true;
    });
    const stIndex = buildIndex('STUDENTS', 'citizen_id');

    const rows = [];
    let skipped = 0;
    cids.forEach(function (cid) {
      const key = String(cid);
      if (taken[key] || !stIndex[key]) { skipped++; return; }
      taken[key] = true;
      rows.push({ member_id: genId('SM'), group_id: gid, citizen_id: cid, created_at: now() });
    });
    if (rows.length) appendRows('SCOUT_MEMBER', rows);
    audit('scout', 'MEMBER_ADD', gid, { added: rows.length, skipped: skipped }, params.recorded_by);
    return { added: rows.length, skipped: skipped };
  },

  /** เอาสมาชิกออกจากหมู่ */
  member_remove: function (params) {
    const gid = String(params.group_id || '');
    const cid = String(params.citizen_id || '');
    if (!gid || !cid) apiError('VALIDATION', 'ข้อมูลไม่ครบ');
    const removed = deleteRowsWhere('SCOUT_MEMBER', 'group_id', gid, function (r) {
      return String(r.citizen_id) === cid;
    });
    if (!removed) apiError('NOT_FOUND', 'ไม่พบสมาชิกในหมู่นี้');
    audit('scout', 'MEMBER_REMOVE', gid, { citizen_id: cid }, params.recorded_by);
    return { ok: true };
  },

  /* ════════ กิจกรรม ════════ */

  /** รายการกิจกรรมของปี (+จำนวนหมู่ที่ให้คะแนนแล้ว) */
  activities: function (params) {
    const year = scoutYear(params);
    const scoredCount = {};
    readAll('SCOUT_SCORE').forEach(function (s) {
      const aid = String(s.activity_id);
      scoredCount[aid] = (scoredCount[aid] || 0) + 1;
    });
    const list = readAll('SCOUT_ACTIVITY')
      .filter(function (a) { return String(a.year) === year; })
      .map(function (a) {
        return {
          activity_id: a.activity_id, name: a.name, task: a.task,
          max_score: Number(a.max_score) || 0, date: a.date ? toYmd(a.date) : '',
          note: a.note, year: String(a.year),
          scored_groups: scoredCount[String(a.activity_id)] || 0,
        };
      })
      .sort(function (a, b) { return String(b.date).localeCompare(String(a.date)); });
    return { year: year, activities: list };
  },

  /** สร้าง/แก้ไขกิจกรรม */
  activity_save: function (params) {
    const name = String(params.name || '').trim();
    const task = String(params.task || '').trim();
    const max = Number(params.max_score);
    if (!name) apiError('VALIDATION', 'กรุณาระบุชื่อกิจกรรม');
    if (!task) apiError('VALIDATION', 'กรุณาระบุชื่องานที่มอบหมาย');
    if (!isFinite(max) || max <= 0) apiError('VALIDATION', 'คะแนนเต็มต้องมากกว่า 0');

    const date = params.date ? toYmd(params.date) : today();
    const year = scoutYear(params);

    if (params.activity_id) {
      const idx = findRowIndex('SCOUT_ACTIVITY', 'activity_id', params.activity_id);
      if (idx < 0) apiError('NOT_FOUND', 'ไม่พบกิจกรรม');
      updateRow('SCOUT_ACTIVITY', idx, {
        name: name, task: task, max_score: max, date: date, note: params.note || '', updated_at: now(),
      });
      audit('scout', 'ACTIVITY_UPDATE', params.activity_id, { name: name, max_score: max }, params.recorded_by);
      return { activity_id: params.activity_id };
    }

    const id = genId('SA');
    appendRows('SCOUT_ACTIVITY', [{
      activity_id: id, name: name, task: task, max_score: max, year: year,
      date: date, note: params.note || '', created_at: now(), updated_at: now(),
    }]);
    audit('scout', 'ACTIVITY_CREATE', id, { name: name, task: task, max_score: max }, params.recorded_by);
    return { activity_id: id };
  },

  /** ลบกิจกรรม (ลบคะแนนของกิจกรรมนั้นด้วย) */
  activity_delete: function (params) {
    const aid = String(params.activity_id || '');
    if (!aid) apiError('VALIDATION', 'ไม่ได้ระบุกิจกรรม');
    const idx = findRowIndex('SCOUT_ACTIVITY', 'activity_id', aid);
    if (idx < 0) apiError('NOT_FOUND', 'ไม่พบกิจกรรม');
    deleteRowsWhere('SCOUT_SCORE', 'activity_id', aid);
    deleteRow('SCOUT_ACTIVITY', findRowIndex('SCOUT_ACTIVITY', 'activity_id', aid));
    audit('scout', 'ACTIVITY_DELETE', aid, {}, params.recorded_by);
    return { ok: true };
  },

  /* ════════ บันทึกคะแนน ════════ */

  /** หมู่ทั้งหมด + คะแนนที่เคยให้ในกิจกรรมนี้ (สำหรับหน้าบันทึก) */
  score_sheet: function (params) {
    const aid = String(params.activity_id || '');
    if (!aid) apiError('VALIDATION', 'กรุณาเลือกกิจกรรม');
    const act = buildIndex('SCOUT_ACTIVITY', 'activity_id')[aid];
    if (!act) apiError('NOT_FOUND', 'ไม่พบกิจกรรม');
    const year = String(act.year);

    const current = {};
    readAll('SCOUT_SCORE').forEach(function (s) {
      if (String(s.activity_id) === aid) current[String(s.group_id)] = Number(s.score) || 0;
    });
    const memberCount = {};
    readAll('SCOUT_MEMBER').forEach(function (m) {
      const gid = String(m.group_id);
      memberCount[gid] = (memberCount[gid] || 0) + 1;
    });

    const groups = readAll('SCOUT_GROUP')
      .filter(function (g) { return String(g.year) === year; })
      .map(function (g) {
        const gid = String(g.group_id);
        return {
          group_id: gid, name: g.name, members: memberCount[gid] || 0,
          score: current[gid] !== undefined ? current[gid] : null,
        };
      })
      .sort(function (a, b) { return String(a.name).localeCompare(String(b.name), 'th'); });

    return {
      activity: {
        activity_id: aid, name: act.name, task: act.task,
        max_score: Number(act.max_score) || 0, date: act.date ? toYmd(act.date) : '', year: year,
      },
      groups: groups,
    };
  },

  /**
   * บันทึกคะแนนของกิจกรรม (ทีละหลายหมู่) — upsert ตาม (activity_id, group_id)
   * params = { activity_id, scores:[{group_id, score}], recorded_by }
   */
  score_save: function (params) {
    const aid = String(params.activity_id || '');
    const scores = params.scores;
    if (!aid) apiError('VALIDATION', 'กรุณาเลือกกิจกรรม');
    if (!Array.isArray(scores) || !scores.length) apiError('VALIDATION', 'ไม่มีข้อมูลให้บันทึก');

    const act = buildIndex('SCOUT_ACTIVITY', 'activity_id')[aid];
    if (!act) apiError('NOT_FOUND', 'ไม่พบกิจกรรม');
    const max = Number(act.max_score) || 0;

    const lock = LockService.getScriptLock();
    lock.waitLock(15000);
    try {
      const sh = getSheet('SCOUT_SCORE');
      const headers = SHEETS.SCOUT_SCORE.headers;
      const lastRow = sh.getLastRow();
      const keyToRow = {};
      if (lastRow > 1) {
        const aCol = headers.indexOf('activity_id') + 1;
        const gCol = headers.indexOf('group_id') + 1;
        const aVals = sh.getRange(2, aCol, lastRow - 1, 1).getValues();
        const gVals = sh.getRange(2, gCol, lastRow - 1, 1).getValues();
        for (let i = 0; i < aVals.length; i++) {
          keyToRow[String(aVals[i][0]) + '|' + String(gVals[i][0])] = i + 2;
        }
      }

      const ts = now();
      const by = params.recorded_by || 'admin';
      const inserts = [];
      let updated = 0, skipped = 0;

      scores.forEach(function (r) {
        const gid = String(r.group_id || '');
        if (!gid) { skipped++; return; }
        if (r.score === '' || r.score === null || r.score === undefined) { skipped++; return; }
        let sc = Number(r.score);
        if (!isFinite(sc) || sc < 0) { skipped++; return; }
        if (max && sc > max) sc = max;               // กันกรอกเกินคะแนนเต็ม
        sc = Math.round(sc * 100) / 100;

        const rec = {
          activity_id: aid, group_id: gid, score: sc,
          note: r.note || '', recorded_by: by, date: today(), created_at: ts,
        };
        const exist = keyToRow[aid + '|' + gid];
        if (exist) { updateRow('SCOUT_SCORE', exist, rec); updated++; }
        else { rec.score_id = genId('SS'); inserts.push(rec); }
      });
      if (inserts.length) appendRows('SCOUT_SCORE', inserts);

      audit('scout', 'SCORE_SAVE', aid, { inserted: inserts.length, updated: updated, skipped: skipped }, by);
      return { activity_id: aid, inserted: inserts.length, updated: updated, skipped: skipped };
    } finally {
      lock.releaseLock();
    }
  },

  /** รายละเอียดคะแนนรายหมู่ (แยกตามกิจกรรม) — ใช้ดูย้อนหลัง */
  group_detail: function (params) {
    const gid = String(params.group_id || '');
    if (!gid) apiError('VALIDATION', 'ไม่ได้ระบุหมู่');
    const group = buildIndex('SCOUT_GROUP', 'group_id')[gid];
    if (!group) apiError('NOT_FOUND', 'ไม่พบหมู่ลูกเสือ');
    const year = String(group.year);

    const actIndex = buildIndex('SCOUT_ACTIVITY', 'activity_id');
    const scoreOf = {};
    readAll('SCOUT_SCORE').forEach(function (s) {
      if (String(s.group_id) === gid) scoreOf[String(s.activity_id)] = Number(s.score) || 0;
    });

    let total = 0, maxTotal = 0;
    const rows = readAll('SCOUT_ACTIVITY')
      .filter(function (a) { return String(a.year) === year; })
      .map(function (a) {
        const aid = String(a.activity_id);
        const sc = scoreOf[aid];
        const mx = Number(a.max_score) || 0;
        maxTotal += mx;
        if (sc !== undefined) total += sc;
        return {
          activity_id: aid, name: a.name, task: a.task, max_score: mx,
          date: a.date ? toYmd(a.date) : '', score: sc === undefined ? null : sc,
        };
      })
      .sort(function (a, b) { return String(b.date).localeCompare(String(a.date)); });

    return {
      group: { group_id: gid, name: group.name, year: year },
      total: Math.round(total * 100) / 100,
      max_total: Math.round(maxTotal * 100) / 100,
      activities: rows,
    };
  },
};

/* ── helpers ── */

const SCOUT_ROLE_LABEL = { leader: 'นายหมู่', deputy: 'รองนายหมู่' };

/** normalize ค่า role → 'leader' | 'deputy' | '' */
function scoutRole(v) {
  const s = String(v || '').trim();
  return (s === 'leader' || s === 'deputy') ? s : '';
}

/** ลำดับการแสดง: นายหมู่ 0 → สมาชิก 1 → รองนายหมู่ 2 */
function scoutRoleOrder(role) {
  const r = scoutRole(role);
  return r === 'leader' ? 0 : r === 'deputy' ? 2 : 1;
}

/** ปีการศึกษาที่ใช้งาน (จาก params หรือ SETTINGS.current_year) */
function scoutYear(params) {
  const y = params && params.year;
  return String(y || SettingsAPI.get_raw('current_year') || new Date().getFullYear() + 543);
}

/**
 * ลบทุกแถวที่ column = value (และผ่าน extraMatch ถ้าระบุ) — ลบจากล่างขึ้นบนกัน index เลื่อน
 * คืนจำนวนแถวที่ลบ
 */
function deleteRowsWhere(key, columnName, value, extraMatch) {
  const sh = getSheet(key);
  const headers = SHEETS[key].headers;
  const lastRow = sh.getLastRow();
  if (lastRow <= 1) return 0;
  const values = sh.getRange(2, 1, lastRow - 1, headers.length).getValues();
  const targets = [];
  for (let i = 0; i < values.length; i++) {
    const obj = {};
    headers.forEach(function (h, j) { obj[h] = values[i][j]; });
    if (String(obj[columnName]) !== String(value)) continue;
    if (extraMatch && !extraMatch(obj)) continue;
    targets.push(i + 2);
  }
  for (let k = targets.length - 1; k >= 0; k--) sh.deleteRow(targets[k]);
  if (targets.length) invalidateCache(key);
  return targets.length;
}
