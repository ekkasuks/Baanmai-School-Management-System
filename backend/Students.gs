/**
 * Students module — Import DMC + CRUD + สถิติ
 *
 * Import: frontend อ่าน .xlsx ด้วย SheetJS → ส่งทีละ chunk (~50 แถว) → backend upsert
 * Key = citizen_id (13 หลัก, ไม่ซ้ำ)
 */

const StudentsAPI = {

  /** รายชื่อ — กรองตามชั้น/ห้อง/คำค้น */
  list: function (params) {
    let rows = readAll('STUDENTS');
    if (params.grade) rows = rows.filter(function (r) { return r.grade === params.grade; });
    if (params.room) rows = rows.filter(function (r) { return String(r.room) === String(params.room); });
    if (params.search) {
      const q = String(params.search).toLowerCase();
      rows = rows.filter(function (r) {
        return String(r.first_name).toLowerCase().indexOf(q) >= 0 ||
               String(r.last_name).toLowerCase().indexOf(q) >= 0 ||
               String(r.student_code).indexOf(q) >= 0 ||
               String(r.citizen_id).indexOf(q) >= 0;
      });
    }
    return { students: rows, total: rows.length };
  },

  get: function (params) {
    if (!params.citizen_id) apiError('VALIDATION', 'ไม่ได้ระบุ citizen_id');
    const found = readAll('STUDENTS').find(function (r) {
      return String(r.citizen_id) === String(params.citizen_id);
    });
    if (!found) apiError('NOT_FOUND', 'ไม่พบนักเรียน');
    return { student: found };
  },

  update: function (params) {
    if (!params.citizen_id) apiError('VALIDATION', 'ไม่ได้ระบุ citizen_id');
    const rowIdx = findRowIndex('STUDENTS', 'citizen_id', params.citizen_id);
    if (rowIdx < 0) apiError('NOT_FOUND', 'ไม่พบนักเรียน');

    const allowed = ['student_code', 'prefix', 'first_name', 'last_name', 'gender',
                     'grade', 'room', 'birth_date', 'blood_type', 'religion', 'nationality',
                     'guardian_relation', 'guardian_name', 'guardian_phone', 'address',
                     'weight_init', 'height_init', 'status'];
    const update = { updated_at: now() };
    const fields = params.fields || {};
    Object.keys(fields).forEach(function (k) {
      if (allowed.indexOf(k) >= 0) update[k] = fields[k];
    });
    updateRow('STUDENTS', rowIdx, update);
    audit('students', 'UPDATE', params.citizen_id, { fields: Object.keys(fields) }, params.recorded_by);
    return { ok: true };
  },

  /**
   * โปรไฟล์รายบุคคล — รวมข้อมูลข้ามโมดูล (ธนาคาร/พฤติกรรม/สุขภาพ/มาเรียน)
   * params = { citizen_id }
   */
  profile: function (params) {
    if (!params.citizen_id) apiError('VALIDATION', 'ไม่ได้ระบุ citizen_id');
    const cid = String(params.citizen_id);
    const student = buildIndex('STUDENTS', 'citizen_id')[cid];
    if (!student) apiError('NOT_FOUND', 'ไม่พบนักเรียน');

    // ธนาคาร — ยอดคงเหลือ
    const balRow = buildIndex('BANK_BALANCE', 'citizen_id')[cid];
    const balance = balRow ? Number(balRow.balance) || 0 : 0;

    // พฤติกรรม — คะแนนเดือนปัจจุบัน + 5 รายการล่าสุด
    const ym = yearMonth();
    const start = behaviorStart();
    const itemIndex = buildIndex('BEHAVIOR_MASTER', 'item_id');
    const bhvLogs = readAll('BEHAVIOR_LOG')
      .filter(function (l) { return String(l.citizen_id) === cid && toYm(l.year_month) === ym; })
      .sort(function (a, b) { return String(a.created_at).localeCompare(String(b.created_at)); });
    const behaviorScore = bhvLogs.length ? Number(bhvLogs[bhvLogs.length - 1].points_after) || start : start;
    const recentBehavior = bhvLogs.slice(-5).reverse().map(function (l) {
      const it = itemIndex[String(l.item_id)];
      return { date: l.date, item_name: it ? it.name : '(ลบแล้ว)', points_change: Number(l.points_change) || 0 };
    });

    // สุขภาพ — ผลตรวจล่าสุด
    const healthItems = ['hair', 'nails', 'cup', 'toothbrush', 'toothpaste'];
    let latestHealth = null;
    readAll('HEALTH_CHECK').forEach(function (c) {
      if (String(c.citizen_id) !== cid) return;
      if (!latestHealth || toYmd(c.date) > toYmd(latestHealth.date)) latestHealth = c;
    });
    let health = null;
    if (latestHealth) {
      health = { date: toYmd(latestHealth.date) };
      healthItems.forEach(function (k) { health[k] = latestHealth[k] || ''; });
    }

    // การมาเรียน — สรุปเดือนปัจจุบัน
    const attCounts = { 'มา': 0, 'ขาด': 0, 'ลา': 0, 'สาย': 0 };
    readAll('ATTENDANCE').forEach(function (a) {
      if (String(a.citizen_id) !== cid) return;
      if (toYm(a.date) !== ym) return;
      if (attCounts[a.status] !== undefined) attCounts[a.status]++;
    });

    // การเจริญเติบโต — ผลล่าสุด (แปลผลตามเกณฑ์ WHO)
    let latestGrowth = null;
    readAll('GROWTH').forEach(function (g) {
      if (String(g.citizen_id) !== cid) return;
      if (!latestGrowth || toYmd(g.date) > toYmd(latestGrowth.date)) latestGrowth = g;
    });
    let growth = null;
    if (latestGrowth) {
      const gbmi = Number(latestGrowth.bmi) || 0;
      const ev = growthEval(gbmi, student, toYmd(latestGrowth.date));
      growth = {
        date: toYmd(latestGrowth.date), weight: Number(latestGrowth.weight) || 0,
        height: Number(latestGrowth.height) || 0, bmi: gbmi, zscore: ev.z, bmi_label: ev.label,
      };
    }

    // ทุนการศึกษา — รวมปีปัจจุบัน + รายการล่าสุด
    const curYear = String(SettingsAPI.get_raw('current_year') || '');
    const schAll = readAll('SCHOLARSHIP')
      .filter(function (r) { return String(r.citizen_id) === cid; })
      .map(function (r) { return { date: toYmd(r.date), year: String(r.year), name: r.name, amount: Number(r.amount) || 0 }; })
      .sort(function (a, b) { return b.date.localeCompare(a.date); });
    let schYearTotal = 0, schYearCount = 0;
    schAll.forEach(function (r) { if (r.year === curYear) { schYearTotal += r.amount; schYearCount++; } });

    return {
      student: student,
      bank: { balance: balance },
      behavior: { year_month: ym, score: behaviorScore, recent: recentBehavior },
      health: health,
      attendance: { year_month: ym, counts: attCounts },
      growth: growth,
      scholarship: { year: curYear, year_total: Math.round(schYearTotal * 100) / 100, year_count: schYearCount, recent: schAll.slice(0, 5) },
    };
  },

  /** สถิติสรุป — ใช้ใน Dashboard ข้อมูลนักเรียน + Dashboard หลัก */
  stats: function () {
    const rows = readAll('STUDENTS').filter(function (r) { return r.status !== 'inactive'; });
    const byGrade = {};
    let male = 0, female = 0;
    rows.forEach(function (r) {
      const key = r.grade + '/' + r.room;
      byGrade[key] = (byGrade[key] || 0) + 1;
      if (r.gender === 'ช') male++;
      else if (r.gender === 'ญ') female++;
    });
    return { total: rows.length, male: male, female: female, by_grade: byGrade };
  },

  /**
   * Import DMC — เรียกหลายครั้ง (chunk ละ ~50 แถว)
   * params = { rows:[{...DMC...}], chunk_index, total_chunks, recorded_by }
   */
  import_dmc: function (params) {
    const rows = params.rows;
    if (!Array.isArray(rows)) apiError('VALIDATION', 'rows ต้องเป็น array');

    // map citizen_id -> rowIndex (อ่านครั้งเดียว) สำหรับเช็คว่ามีอยู่แล้วหรือยัง
    const sh = getSheet('STUDENTS');
    const cidCol = SHEETS.STUDENTS.headers.indexOf('citizen_id') + 1;
    const lastRow = sh.getLastRow();
    const rowIndexById = {};
    if (lastRow > 1) {
      const cids = sh.getRange(2, cidCol, lastRow - 1, 1).getValues();
      for (let i = 0; i < cids.length; i++) rowIndexById[String(cids[i][0])] = i + 2;
    }

    const inserts = [];
    let updated = 0, skipped = 0;

    rows.forEach(function (raw) {
      const m = mapDmcStudent(raw);
      if (!m.citizen_id || String(m.citizen_id).length !== 13) { skipped++; return; }

      const existRow = rowIndexById[String(m.citizen_id)];
      if (existRow) {
        m.updated_at = now();
        updateRow('STUDENTS', existRow, m);
        updated++;
      } else {
        m.status = 'active';
        m.created_at = now();
        m.updated_at = now();
        inserts.push(m);
      }
    });

    if (inserts.length) appendRows('STUDENTS', inserts);

    audit('students', 'IMPORT_DMC', 'chunk-' + params.chunk_index, {
      inserted: inserts.length, updated: updated, skipped: skipped, total_chunks: params.total_chunks,
    }, params.recorded_by);

    return { chunk_index: params.chunk_index, inserted: inserts.length, updated: updated, skipped: skipped };
  },
};

/** เรียงชั้น: อ.2 < อ.3 < ป.1 < ... < ป.6 (mirror frontend Utils.gradeSortKey) */
function gradeSortKey(g) {
  g = String(g || '');
  if (g.indexOf('อ.') === 0) return parseInt(g.slice(2), 10) || 0;
  if (g.indexOf('ป.') === 0) return 10 + (parseInt(g.slice(2), 10) || 0);
  if (g.indexOf('ม.') === 0) return 20 + (parseInt(g.slice(2), 10) || 0);
  return 99;
}

/** รายชื่อชั้น/ห้อง (distinct) ของนักเรียน active เรียงตามชั้น→ห้อง — ใช้ใน dropdown เลือกชั้น */
function listClasses() {
  const map = {};
  readAll('STUDENTS').forEach(function (s) {
    if (s.status === 'inactive') return;
    const grade = s.grade || '-';
    const room = (s.room === undefined || s.room === null) ? '' : String(s.room);
    const key = grade + '|' + room;
    if (!map[key]) map[key] = { grade: grade, room: room, count: 0 };
    map[key].count++;
  });
  return Object.keys(map).map(function (k) { return map[k]; }).sort(function (a, b) {
    const d = gradeSortKey(a.grade) - gradeSortKey(b.grade);
    return d !== 0 ? d : (parseInt(a.room, 10) || 0) - (parseInt(b.room, 10) || 0);
  });
}

/** กรองนักเรียน active ตามชั้น (+ห้อง ถ้าระบุ) */
function studentsInClass(grade, room) {
  return readAll('STUDENTS').filter(function (s) {
    if (s.status === 'inactive') return false;
    if (String(s.grade) !== String(grade)) return false;
    if (room !== undefined && room !== null && room !== '' && String(s.room) !== String(room)) return false;
    return true;
  });
}

/**
 * map 1 แถว DMC (object key = หัวคอลัมน์ไทย) → STUDENTS
 * ดู docs/dmc-field-map.md
 */
function mapDmcStudent(r) {
  const get = function (k) {
    return r[k] !== undefined && r[k] !== null ? String(r[k]).trim() : '';
  };
  const num = function (k) {
    const v = get(k);
    if (!v) return '';
    const n = parseFloat(v);
    return isNaN(n) || n === 0 ? '' : n;
  };

  let lastName = get('นามสกุล');
  if (lastName === '-') lastName = ''; // 60/103 ไม่มีนามสกุล — ไม่ใช่ error

  const guardian = [get('คำนำหน้าชื่อผู้ปกครอง'), get('ชื่อผู้ปกครอง'), get('นามสกุลผู้ปกครอง')]
    .filter(Boolean).join(' ');

  const address = [
    get('เลขที่บ้าน (ที่อยู่ปัจจุบัน)') ? 'เลขที่ ' + get('เลขที่บ้าน (ที่อยู่ปัจจุบัน)') : '',
    get('หมู่ (ที่อยู่ปัจจุบัน)') ? 'หมู่ ' + get('หมู่ (ที่อยู่ปัจจุบัน)') : '',
    get('ตำบล (ที่อยู่ปัจจุบัน)') ? 'ต.' + get('ตำบล (ที่อยู่ปัจจุบัน)') : '',
    get('อำเภอ (ที่อยู่ปัจจุบัน)') ? 'อ.' + get('อำเภอ (ที่อยู่ปัจจุบัน)') : '',
    get('จังหวัด (ที่อยู่ปัจจุบัน)') ? 'จ.' + get('จังหวัด (ที่อยู่ปัจจุบัน)') : '',
    get('รหัสไปรษณีย์ (ที่อยู่ปัจจุบัน)'),
  ].filter(Boolean).join(' ');

  return {
    citizen_id: get('เลขประจำตัวประชาชน'),
    student_code: get('รหัสนักเรียน'),
    prefix: get('คำนำหน้าชื่อ'),
    first_name: get('ชื่อ'),
    last_name: lastName,
    gender: get('เพศ'),
    grade: get('ชั้น'),
    room: parseInt(get('ห้อง'), 10) || 1,
    birth_date: get('วันเกิด'),
    blood_type: get('หมู่โลหิต'),
    religion: get('ศาสนา'),
    nationality: get('สัญชาติ'),
    guardian_relation: get('ความเกี่ยวข้องของผู้ปกครองกับนักเรียน'),
    guardian_name: guardian,
    guardian_phone: get('หมายเลขโทรศัพท์ของผู้ปกครอง'),
    address: address,
    weight_init: num('น้ำหนัก'),
    height_init: num('ส่วนสูง'),
  };
}
