/**
 * Bank module — ธนาคารโรงเรียน (ต้องใช้ PIN: bank)
 *
 * ยอดคงเหลือเก็บใน BANK_BALANCE (cache sheet) — ไม่ต้อง SUM transactions ทุกครั้ง
 * ทุก method ต้องผ่าน requirePin(ctx, 'bank')
 */

const BankAPI = {

  /** Dashboard — ยอดรวม, Top 10, ค่าเฉลี่ยรายชั้น, ฝาก/ถอนวันนี้ */
  dashboard: function (params, ctx) {
    requirePin(ctx, 'bank');
    return cachedResult('bank.dash', ['STUDENTS', 'BANK_BALANCE', 'BANK_TRANSACTIONS'], 90, function () {

    const students = readAll('STUDENTS').filter(function (s) {
      return s.status === 'active' || !s.status;
    });
    const balIndex = buildIndex('BANK_BALANCE', 'citizen_id');

    // รวมข้อมูลนักเรียน + ยอดเงิน
    let total = 0;
    const enriched = students.map(function (s) {
      const row = balIndex[String(s.citizen_id)];
      const bal = row ? Number(row.balance) || 0 : 0;
      total += bal;
      return {
        citizen_id: s.citizen_id,
        name: studentName(s),
        grade: s.grade,
        room: s.room,
        balance: bal,
      };
    });

    // Top 10 ยอดสูงสุด
    const top10 = enriched.slice().sort(function (a, b) {
      return b.balance - a.balance;
    }).slice(0, 10);

    // ค่าเฉลี่ยรายชั้น
    const gradeMap = {};
    enriched.forEach(function (e) {
      const g = e.grade || '-';
      if (!gradeMap[g]) gradeMap[g] = { grade: g, total: 0, count: 0 };
      gradeMap[g].total += e.balance;
      gradeMap[g].count += 1;
    });
    const byGrade = Object.keys(gradeMap).map(function (g) {
      const o = gradeMap[g];
      o.avg = o.count ? Math.round((o.total / o.count) * 100) / 100 : 0;
      return o;
    });

    // ฝาก/ถอนวันนี้
    const td = today();
    let depositToday = 0, withdrawToday = 0, depCount = 0, wdCount = 0;
    readAll('BANK_TRANSACTIONS').forEach(function (t) {
      if (toYmd(t.date) !== td) return;
      const amt = Number(t.amount) || 0;
      if (t.type === 'deposit') { depositToday += amt; depCount++; }
      else if (t.type === 'withdraw') { withdrawToday += amt; wdCount++; }
    });

    return {
      total_balance: Math.round(total * 100) / 100,
      account_count: enriched.length,
      today_deposit: depositToday,
      today_deposit_count: depCount,
      today_withdraw: withdrawToday,
      today_withdraw_count: wdCount,
      top10: top10,
      by_grade: byGrade,
    };
    });
  },

  /** รายชื่อชั้น/ห้อง สำหรับ dropdown เลือกชั้น */
  classes: function (params, ctx) {
    requirePin(ctx, 'bank');
    return { classes: listClasses() };
  },

  /** นักเรียนในชั้น/ห้อง + ยอดเงิน (สำหรับเลือกทำรายการ) */
  by_class: function (params, ctx) {
    requirePin(ctx, 'bank');
    if (!params.grade) apiError('VALIDATION', 'กรุณาเลือกชั้นเรียน');
    const balIndex = buildIndex('BANK_BALANCE', 'citizen_id');
    const results = studentsInClass(params.grade, params.room).map(function (s) {
      const row = balIndex[String(s.citizen_id)];
      return {
        citizen_id: s.citizen_id, student_code: s.student_code, name: studentName(s),
        grade: s.grade, room: s.room, balance: row ? Number(row.balance) || 0 : 0,
      };
    });
    results.sort(function (a, b) { return String(a.name).localeCompare(String(b.name), 'th'); });
    return { results: results };
  },

  /** ค้นหานักเรียน + ยอดเงิน (สำหรับเลือกทำรายการ) */
  search: function (params, ctx) {
    requirePin(ctx, 'bank');
    const q = String(params.q || '').trim().toLowerCase();
    if (!q) return { results: [] };

    const balIndex = buildIndex('BANK_BALANCE', 'citizen_id');
    const results = [];
    const rows = readAll('STUDENTS');
    for (let i = 0; i < rows.length && results.length < 20; i++) {
      const s = rows[i];
      const hay = (studentName(s) + ' ' + s.student_code + ' ' + s.citizen_id).toLowerCase();
      if (hay.indexOf(q) < 0) continue;
      const row = balIndex[String(s.citizen_id)];
      results.push({
        citizen_id: s.citizen_id,
        student_code: s.student_code,
        name: studentName(s),
        grade: s.grade,
        room: s.room,
        balance: row ? Number(row.balance) || 0 : 0,
      });
    }
    return { results: results };
  },

  /** ยอดคงเหลือปัจจุบันของนักเรียน 1 คน (สด — ใช้ก่อนทำรายการฝาก/ถอน กันทำบนยอดเก่า) */
  balance: function (params, ctx) {
    requirePin(ctx, 'bank');
    const cid = params.citizen_id;
    if (!cid) apiError('VALIDATION', 'กรุณาระบุนักเรียน');
    const row = buildIndex('BANK_BALANCE', 'citizen_id')[String(cid)];
    return { citizen_id: cid, balance: row ? Number(row.balance) || 0 : 0 };
  },

  /** ฝากเงิน */
  deposit: function (params, ctx) {
    requirePin(ctx, 'bank');
    return applyTransaction('deposit', params);
  },

  /** ถอนเงิน — ถอนเกินยอดไม่ได้ */
  withdraw: function (params, ctx) {
    requirePin(ctx, 'bank');
    return applyTransaction('withdraw', params);
  },

  /** ประวัติรายการ — กรองตามคน/ชั้น/ประเภท/ช่วงวันที่ */
  history: function (params, ctx) {
    requirePin(ctx, 'bank');
    const p = params || {};
    const stIndex = buildIndex('STUDENTS', 'citizen_id');
    let rows = readAll('BANK_TRANSACTIONS');

    if (p.citizen_id) rows = rows.filter(function (t) { return String(t.citizen_id) === String(p.citizen_id); });
    if (p.type) rows = rows.filter(function (t) { return t.type === p.type; });
    if (p.date_from) rows = rows.filter(function (t) { return toYmd(t.date) >= p.date_from; });
    if (p.date_to) rows = rows.filter(function (t) { return toYmd(t.date) <= p.date_to; });
    if (p.grade) {
      rows = rows.filter(function (t) {
        const s = stIndex[String(t.citizen_id)];
        return s && s.grade === p.grade;
      });
    }

    // ใหม่สุดก่อน
    rows.sort(function (a, b) { return String(b.created_at).localeCompare(String(a.created_at)); });
    const limit = Math.min(parseInt(p.limit, 10) || 100, 500);
    const total = rows.length;
    rows = rows.slice(0, limit).map(function (t) {
      const s = stIndex[String(t.citizen_id)];
      return {
        txn_id: t.txn_id, date: t.date, type: t.type, amount: Number(t.amount) || 0,
        balance_after: Number(t.balance_after) || 0, note: t.note, recorded_by: t.recorded_by,
        created_at: t.created_at,
        citizen_id: t.citizen_id,
        name: s ? studentName(s) : '(ไม่พบ)',
        grade: s ? s.grade : '', room: s ? s.room : '',
      };
    });
    return { transactions: rows, total: total, returned: rows.length };
  },

  /** สมุดบัญชีรายบุคคล — ข้อมูลนักเรียน + ยอด + รายการทั้งหมด (เรียงเก่า→ใหม่) */
  passbook: function (params, ctx) {
    requirePin(ctx, 'bank');
    const cid = params.citizen_id;
    if (!cid) apiError('VALIDATION', 'กรุณาระบุนักเรียน');

    const s = buildIndex('STUDENTS', 'citizen_id')[String(cid)];
    if (!s) apiError('NOT_FOUND', 'ไม่พบนักเรียน');

    const balRow = buildIndex('BANK_BALANCE', 'citizen_id')[String(cid)];
    const txns = readAll('BANK_TRANSACTIONS')
      .filter(function (t) { return String(t.citizen_id) === String(cid); })
      .sort(function (a, b) { return String(a.created_at).localeCompare(String(b.created_at)); })
      .map(function (t) {
        return {
          txn_id: t.txn_id, date: t.date, type: t.type,
          amount: Number(t.amount) || 0, balance_after: Number(t.balance_after) || 0,
          note: t.note, recorded_by: t.recorded_by, created_at: t.created_at,
        };
      });

    return {
      student: {
        citizen_id: s.citizen_id, student_code: s.student_code,
        name: studentName(s), grade: s.grade, room: s.room,
      },
      balance: balRow ? Number(balRow.balance) || 0 : 0,
      transactions: txns,
    };
  },

  /**
   * สถิตินิสัยการออม — ความถี่การฝากเงิน (จำนวนครั้ง) รายเดือน + จัดอันดับ
   * รางวัลมอบให้นักเรียนที่ฝากบ่อยที่สุด (ไม่ใช่ยอดเงินสูงสุด)
   */
  saving_habit: function (params, ctx) {
    requirePin(ctx, 'bank');
    const p = params || {};
    const ym = p.year_month || yearMonth();
    return cachedResult('bank.habit:' + ym + ':' + (p.grade || ''), ['STUDENTS', 'BANK_TRANSACTIONS'], 90, function () {
    const months = lastMonths(ym, 6);

    const students = readAll('STUDENTS').filter(function (s) {
      return s.status === 'active' || !s.status;
    });

    const monthlyTrend = {};
    months.forEach(function (m) { monthlyTrend[m] = { year_month: m, deposit_count: 0, deposit_total: 0 }; });

    const countByStudent = {};
    const amountByStudent = {};
    readAll('BANK_TRANSACTIONS').forEach(function (t) {
      if (t.type !== 'deposit') return;
      const tYm = toYm(t.date);
      const amt = Number(t.amount) || 0;
      if (monthlyTrend[tYm]) {
        monthlyTrend[tYm].deposit_count++;
        monthlyTrend[tYm].deposit_total += amt;
      }
      if (tYm === ym) {
        const cid = String(t.citizen_id);
        countByStudent[cid] = (countByStudent[cid] || 0) + 1;
        amountByStudent[cid] = (amountByStudent[cid] || 0) + amt;
      }
    });

    let list = students.map(function (s) {
      const cid = String(s.citizen_id);
      return {
        citizen_id: s.citizen_id, student_code: s.student_code, name: studentName(s),
        grade: s.grade, room: s.room,
        deposit_count: countByStudent[cid] || 0,
        deposit_total: Math.round((amountByStudent[cid] || 0) * 100) / 100,
      };
    });
    if (p.grade) list = list.filter(function (e) { return e.grade === p.grade; });

    // เรียงตามจำนวนครั้งที่ฝากมากสุดก่อน (นิสัยการออม) แล้วค่อยยอดเงินรวม
    list.sort(function (a, b) {
      if (b.deposit_count !== a.deposit_count) return b.deposit_count - a.deposit_count;
      if (b.deposit_total !== a.deposit_total) return b.deposit_total - a.deposit_total;
      return String(a.name).localeCompare(String(b.name), 'th');
    });
    list.forEach(function (e, i) { e.rank = i + 1; });

    return {
      year_month: ym,
      ranking: list,
      monthly_trend: months.map(function (m) {
        const o = monthlyTrend[m];
        o.deposit_total = Math.round(o.deposit_total * 100) / 100;
        return o;
      }),
    };
    });
  },
};

/* ── helpers ── */

/** คืน array 'YYYY-MM' ย้อนหลัง n เดือนจนถึง ym (เรียงเก่า→ใหม่) */
function lastMonths(ym, n) {
  const parts = String(ym).split('-');
  const y = parseInt(parts[0], 10), m = parseInt(parts[1], 10);
  const list = [];
  for (let i = n - 1; i >= 0; i--) {
    let mm = m - i, yy = y;
    while (mm <= 0) { mm += 12; yy -= 1; }
    list.push(yy + '-' + String(mm).padStart(2, '0'));
  }
  return list;
}

/** ชื่อเต็มนักเรียน (backend ไม่มี Utils) */
function studentName(s) {
  return [s.prefix, s.first_name, s.last_name]
    .map(function (x) { return x === undefined || x === null ? '' : String(x).trim(); })
    .filter(Boolean).join(' ') || '(ไม่มีชื่อ)';
}

/**
 * บันทึกรายการฝาก/ถอน — ป้องกัน race ด้วย LockService
 * params = { citizen_id, amount, note, recorded_by }
 */
function applyTransaction(type, params) {
  const cid = params.citizen_id;
  let amount = Number(params.amount);
  if (!cid) apiError('VALIDATION', 'กรุณาระบุนักเรียน');
  if (!isFinite(amount) || amount <= 0) apiError('VALIDATION', 'จำนวนเงินต้องมากกว่า 0');
  amount = Math.round(amount * 100) / 100;

  const student = buildIndex('STUDENTS', 'citizen_id')[String(cid)];
  if (!student) apiError('NOT_FOUND', 'ไม่พบนักเรียน');

  const lock = LockService.getScriptLock();
  lock.waitLock(15000);
  try {
    const balRow = buildIndex('BANK_BALANCE', 'citizen_id')[String(cid)];
    const current = balRow ? Number(balRow.balance) || 0 : 0;

    if (type === 'withdraw' && amount > current) {
      apiError('INSUFFICIENT_FUNDS',
        'ยอดเงินไม่พอ (คงเหลือ ' + current.toFixed(2) + ' บาท)');
    }
    const balanceAfter = Math.round((type === 'deposit' ? current + amount : current - amount) * 100) / 100;
    const txnId = genId('TXN');
    const ts = now();

    appendRows('BANK_TRANSACTIONS', [{
      txn_id: txnId, date: today(), citizen_id: cid, type: type,
      amount: amount, balance_after: balanceAfter,
      note: params.note || '', recorded_by: params.recorded_by || 'admin', created_at: ts,
    }]);

    upsertRow('BANK_BALANCE', 'citizen_id', {
      citizen_id: cid, balance: balanceAfter, last_txn_date: ts, updated_at: ts,
    });

    audit('bank', type === 'deposit' ? 'DEPOSIT' : 'WITHDRAW', txnId,
      { citizen_id: cid, amount: amount, balance_after: balanceAfter }, params.recorded_by);

    return {
      txn_id: txnId, type: type, amount: amount,
      balance_after: balanceAfter, date: today(),
      student: { name: studentName(student), grade: student.grade, room: student.room, student_code: student.student_code },
    };
  } finally {
    lock.releaseLock();
  }
}
