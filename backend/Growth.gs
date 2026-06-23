/**
 * Growth module — การเจริญเติบโต (ไม่ใช้ PIN)
 *
 * บันทึกน้ำหนัก (กก.) + ส่วนสูง (ซม.) → คำนวณ BMI แล้วแปลผลด้วย **BMI-for-age z-score ตามเกณฑ์ WHO**
 * (WHO 2006 อายุ 0-5 ปี + WHO 2007 อายุ 5-19 ปี — ค่า LMS อยู่ใน GrowthData.gs)
 * เก็บได้หลายครั้งต่อคน (ติดตามแนวโน้ม) · กันซ้ำเฉพาะ (date, citizen_id) เดียวกัน
 *
 * แปลผล: ผอมมาก (<-3SD) · ผอม (-3..-2SD) · สมส่วน · น้ำหนักเกิน · อ้วน
 * ต้องมี วันเกิด (birth_date) + เพศ (gender) ของนักเรียนเพื่อคำนวณอายุ
 */

const GrowthAPI = {

  /** รายชื่อชั้น/ห้อง สำหรับ dropdown */
  classes: function () {
    return { classes: listClasses() };
  },

  /**
   * นักเรียนในชั้น + ค่าล่าสุด + ค่าของวันที่ระบุ (สำหรับบันทึก/รายชั้น)
   * params = { grade, room, date? }
   */
  by_class: function (params) {
    if (!params.grade) apiError('VALIDATION', 'กรุณาเลือกชั้นเรียน');
    const date = params.date ? toYmd(params.date) : '';

    // จัดกลุ่มประวัติการวัดตาม citizen_id
    const byCid = {};
    readAll('GROWTH').forEach(function (g) {
      const cid = String(g.citizen_id);
      if (!byCid[cid]) byCid[cid] = [];
      byCid[cid].push(g);
    });

    const results = studentsInClass(params.grade, params.room).map(function (s) {
      const recs = (byCid[String(s.citizen_id)] || []).slice().sort(function (a, b) {
        return toYmd(a.date).localeCompare(toYmd(b.date));
      });
      const latest = recs.length ? recs[recs.length - 1] : null;
      const onDate = date ? recs.filter(function (r) { return toYmd(r.date) === date; }).pop() : null;
      return {
        citizen_id: s.citizen_id, student_code: s.student_code, name: studentName(s),
        grade: s.grade, room: s.room,
        gender: s.gender, birth_date: s.birth_date,   // ให้ frontend คำนวณ z-score สดได้
        latest: latest ? {
          date: toYmd(latest.date), weight: Number(latest.weight) || 0, height: Number(latest.height) || 0,
          bmi: Number(latest.bmi) || 0, zscore: latest.zscore === '' || latest.zscore == null ? null : Number(latest.zscore),
          bmi_label: latest.bmi_label || '',
        } : null,
        on_date: onDate ? { weight: Number(onDate.weight) || 0, height: Number(onDate.height) || 0 } : null,
      };
    });
    results.sort(function (a, b) { return String(a.name).localeCompare(String(b.name), 'th'); });
    return { date: date, results: results };
  },

  /**
   * บันทึกการวัด (ทีละหลายคน) — upsert ตาม (date, citizen_id) · คำนวณ BMI ฝั่ง server
   * params = { date?, records:[{citizen_id, weight, height, note}], recorded_by }
   */
  save: function (params) {
    const records = params.records;
    if (!Array.isArray(records) || !records.length) apiError('VALIDATION', 'ไม่มีข้อมูลให้บันทึก');
    const date = params.date ? toYmd(params.date) : today();
    const ts = now();
    const by = params.recorded_by || 'admin';
    const stIndex = buildIndex('STUDENTS', 'citizen_id');

    const lock = LockService.getScriptLock();
    lock.waitLock(15000);
    try {
      const sh = getSheet('GROWTH');
      const headers = SHEETS.GROWTH.headers;
      const lastRow = sh.getLastRow();
      const keyToRow = {};
      if (lastRow > 1) {
        const dateCol = headers.indexOf('date') + 1;
        const cidCol = headers.indexOf('citizen_id') + 1;
        const dates = sh.getRange(2, dateCol, lastRow - 1, 1).getValues();
        const cids = sh.getRange(2, cidCol, lastRow - 1, 1).getValues();
        for (let i = 0; i < dates.length; i++) {
          keyToRow[toYmd(dates[i][0]) + '|' + String(cids[i][0])] = i + 2;
        }
      }

      const inserts = [];
      let updated = 0, skipped = 0;
      records.forEach(function (r) {
        const weight = Number(r.weight);
        const height = Number(r.height);
        if (!r.citizen_id || !(weight > 0) || !(height > 0)) { skipped++; return; }

        const bmi = computeBmi(weight, height);
        const student = stIndex[String(r.citizen_id)];
        let z = null, label = '';
        if (student) {
          const ageM = ageMonthsAt(student.birth_date, date);
          z = whoZ(bmi, sexCode(student.gender), ageM);
          label = whoLabel(z, ageM);
        }
        const rec = {
          date: date, citizen_id: r.citizen_id,
          weight: Math.round(weight * 10) / 10, height: Math.round(height * 10) / 10,
          bmi: bmi, zscore: (z == null ? '' : z), bmi_label: label,
          note: r.note || '', recorded_by: by, created_at: ts,
        };
        const existRow = keyToRow[date + '|' + String(r.citizen_id)];
        if (existRow) { updateRow('GROWTH', existRow, rec); updated++; }
        else { rec.growth_id = genId('GRW'); inserts.push(rec); }
      });
      if (inserts.length) appendRows('GROWTH', inserts);

      audit('growth', 'SAVE', date, { date: date, inserted: inserts.length, updated: updated, skipped: skipped }, by);
      return { date: date, inserted: inserts.length, updated: updated, skipped: skipped };
    } finally {
      lock.releaseLock();
    }
  },

  /** ประวัติการวัดของนักเรียน 1 คน (เรียงเก่า→ใหม่ สำหรับกราฟแนวโน้ม) */
  student: function (params) {
    if (!params.citizen_id) apiError('VALIDATION', 'กรุณาระบุนักเรียน');
    const cid = String(params.citizen_id);
    const s = buildIndex('STUDENTS', 'citizen_id')[cid];
    if (!s) apiError('NOT_FOUND', 'ไม่พบนักเรียน');

    const records = readAll('GROWTH')
      .filter(function (g) { return String(g.citizen_id) === cid; })
      .map(function (g) {
        return {
          growth_id: g.growth_id, date: toYmd(g.date),
          weight: Number(g.weight) || 0, height: Number(g.height) || 0,
          bmi: Number(g.bmi) || 0, zscore: g.zscore === '' || g.zscore == null ? null : Number(g.zscore),
          bmi_label: g.bmi_label || '',
          note: g.note, recorded_by: g.recorded_by,
        };
      })
      .sort(function (a, b) { return a.date.localeCompare(b.date); });

    return {
      student: { citizen_id: s.citizen_id, student_code: s.student_code, name: studentName(s), grade: s.grade, room: s.room },
      records: records,
    };
  },

  /** ค้นหานักเรียน (สำหรับเลือกดูรายบุคคล) */
  search: function (params) {
    const q = String(params.q || '').trim().toLowerCase();
    if (!q) return { results: [] };
    const results = [];
    const rows = readAll('STUDENTS');
    for (let i = 0; i < rows.length && results.length < 20; i++) {
      const s = rows[i];
      if (s.status === 'inactive') continue;
      const hay = (studentName(s) + ' ' + s.student_code + ' ' + s.citizen_id).toLowerCase();
      if (hay.indexOf(q) < 0) continue;
      results.push({
        citizen_id: s.citizen_id, student_code: s.student_code,
        name: studentName(s), grade: s.grade, room: s.room,
      });
    }
    return { results: results };
  },

  /** Dashboard — ใช้ค่า "ล่าสุด" ของแต่ละคน: เฉลี่ย BMI, การกระจาย, รายชั้น */
  dashboard: function () {
    const students = readAll('STUDENTS').filter(function (s) { return s.status !== 'inactive'; });

    // ค่าล่าสุดต่อคน
    const latest = {};
    readAll('GROWTH').forEach(function (g) {
      const cid = String(g.citizen_id);
      const d = toYmd(g.date);
      if (!latest[cid] || d > latest[cid].date) {
        latest[cid] = { date: d, bmi: Number(g.bmi) || 0, label: g.bmi_label || '' };
      }
    });

    const dist = { 'ผอมมาก': 0, 'ผอม': 0, 'สมส่วน': 0, 'น้ำหนักเกิน': 0, 'อ้วน': 0 };
    const gradeMap = {};
    let bmiSum = 0, measured = 0;

    students.forEach(function (s) {
      const g = latest[String(s.citizen_id)];
      const grade = s.grade || '-';
      if (!gradeMap[grade]) gradeMap[grade] = { grade: grade, bmi_sum: 0, measured: 0, total: 0 };
      gradeMap[grade].total++;
      if (g && g.bmi > 0) {
        measured++; bmiSum += g.bmi;
        gradeMap[grade].measured++; gradeMap[grade].bmi_sum += g.bmi;
        if (dist[g.label] !== undefined) dist[g.label]++;
      }
    });

    const byGrade = Object.keys(gradeMap).map(function (k) {
      const o = gradeMap[k];
      return { grade: o.grade, avg_bmi: o.measured ? Math.round((o.bmi_sum / o.measured) * 10) / 10 : 0, measured: o.measured, total: o.total };
    });

    return {
      student_count: students.length,
      measured: measured,
      not_measured: Math.max(students.length - measured, 0),
      avg_bmi: measured ? Math.round((bmiSum / measured) * 10) / 10 : 0,
      distribution: dist,
      by_grade: byGrade,
    };
  },
};

/* ── helpers ── */

/** BMI = น้ำหนัก(กก.) / ส่วนสูง(ม.)^2 — ปัดทศนิยม 1 ตำแหน่ง */
function computeBmi(weight, height) {
  const w = Number(weight), h = Number(height) / 100;
  if (!(w > 0) || !(h > 0)) return 0;
  return Math.round((w / (h * h)) * 10) / 10;
}

/** อายุเป็นเดือน (completed) ณ วันที่วัด — birthDate = 'DD/MM/พ.ศ.' */
function ageMonthsAt(birthDate, atYmd) {
  const m = String(birthDate || '').match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (!m) return null;
  const by = parseInt(m[3], 10) - 543, bm = parseInt(m[2], 10), bd = parseInt(m[1], 10);
  const p = String(atYmd).split('-');
  const ay = parseInt(p[0], 10), am = parseInt(p[1], 10), ad = parseInt(p[2], 10);
  if (!by || !ay) return null;
  let months = (ay - by) * 12 + (am - bm);
  if (ad < bd) months -= 1;
  return months >= 0 ? months : null;
}

/** เพศ → รหัสตาราง WHO (1=ชาย, 2=หญิง) */
function sexCode(gender) {
  return gender === 'ช' ? '1' : gender === 'ญ' ? '2' : null;
}

/** z-score BMI-for-age ตามค่า LMS ของ WHO — คืน null ถ้าข้อมูลไม่พอ */
function whoZ(bmi, sex, ageM) {
  if (!(bmi > 0) || !sex || ageM == null) return null;
  const table = WHO_BMI_LMS[sex];
  if (!table) return null;
  let mo = ageM;
  if (mo < 24) mo = 24;        // นอกช่วงตาราง (อายุ < 2 ปี พบน้อยในโรงเรียน) — ใช้ขอบล่าง
  if (mo > 228) mo = 228;
  const lms = table[String(mo)];
  if (!lms) return null;
  const L = lms[0], M = lms[1], S = lms[2];
  const z = (Math.abs(L) < 1e-9) ? Math.log(bmi / M) / S : (Math.pow(bmi / M, L) - 1) / (L * S);
  return Math.round(z * 100) / 100;
}

/** แปลผล z-score → ป้ายไทย (WHO BMI-for-age; อายุ < 5 ปี ใช้เกณฑ์ 0-5) */
function whoLabel(z, ageM) {
  if (z == null) return '';
  if (z < -3) return 'ผอมมาก';
  if (z < -2) return 'ผอม';
  if (ageM != null && ageM < 60) {        // WHO 0-5: ปกติ -2..+2, น้ำหนักเกิน +2..+3, อ้วน >+3
    if (z <= 2) return 'สมส่วน';
    if (z <= 3) return 'น้ำหนักเกิน';
    return 'อ้วน';
  }
  if (z <= 1) return 'สมส่วน';            // WHO 5-19: ปกติ -2..+1, น้ำหนักเกิน +1..+2, อ้วน >+2
  if (z <= 2) return 'น้ำหนักเกิน';
  return 'อ้วน';
}
