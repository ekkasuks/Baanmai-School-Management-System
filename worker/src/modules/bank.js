/** Bank — ธนาคารโรงเรียน (ต้องใช้ PIN: bank) · ยอดคงเหลือเก็บใน BANK_BALANCE */
import {
  readAll, getBy, selectWhere, insertRows, upsert, buildIndex,
  now, today, yearMonth, toYmd, toYm, genId, audit, apiError,
} from '../db.js';
import { studentName, listClasses, studentsInClass } from '../shared.js';
import { requirePin } from './auth.js';

export const BankAPI = {

  dashboard: async function (params, ctx) {
    await requirePin(ctx, 'bank');
    const db = ctx.db;
    const students = (await readAll(db, 'STUDENTS')).filter(function (s) { return s.status === 'active' || !s.status; });
    const balIndex = buildIndex(await readAll(db, 'BANK_BALANCE'), 'citizen_id');

    let total = 0;
    const enriched = students.map(function (s) {
      const row = balIndex[String(s.citizen_id)];
      const bal = row ? Number(row.balance) || 0 : 0;
      total += bal;
      return { citizen_id: s.citizen_id, name: studentName(s), grade: s.grade, room: s.room, balance: bal };
    });
    const top10 = enriched.slice().sort(function (a, b) { return b.balance - a.balance; }).slice(0, 10);

    const gradeMap = {};
    enriched.forEach(function (e) {
      const g = e.grade || '-';
      if (!gradeMap[g]) gradeMap[g] = { grade: g, total: 0, count: 0 };
      gradeMap[g].total += e.balance; gradeMap[g].count += 1;
    });
    const byGrade = Object.keys(gradeMap).map(function (g) {
      const o = gradeMap[g];
      o.avg = o.count ? Math.round((o.total / o.count) * 100) / 100 : 0;
      return o;
    });

    const td = today();
    let depositToday = 0, withdrawToday = 0, depCount = 0, wdCount = 0;
    (await readAll(db, 'BANK_TRANSACTIONS')).forEach(function (t) {
      if (toYmd(t.date) !== td) return;
      const amt = Number(t.amount) || 0;
      if (t.type === 'deposit') { depositToday += amt; depCount++; }
      else if (t.type === 'withdraw') { withdrawToday += amt; wdCount++; }
    });

    return {
      total_balance: Math.round(total * 100) / 100, account_count: enriched.length,
      today_deposit: depositToday, today_deposit_count: depCount,
      today_withdraw: withdrawToday, today_withdraw_count: wdCount,
      top10: top10, by_grade: byGrade,
    };
  },

  classes: async function (params, ctx) {
    await requirePin(ctx, 'bank');
    return { classes: await listClasses(ctx.db) };
  },

  by_class: async function (params, ctx) {
    await requirePin(ctx, 'bank');
    if (!params.grade) apiError('VALIDATION', 'กรุณาเลือกชั้นเรียน');
    const balIndex = buildIndex(await readAll(ctx.db, 'BANK_BALANCE'), 'citizen_id');
    const results = (await studentsInClass(ctx.db, params.grade, params.room)).map(function (s) {
      const row = balIndex[String(s.citizen_id)];
      return {
        citizen_id: s.citizen_id, student_code: s.student_code, name: studentName(s),
        grade: s.grade, room: s.room, balance: row ? Number(row.balance) || 0 : 0,
      };
    });
    results.sort(function (a, b) { return String(a.name).localeCompare(String(b.name), 'th'); });
    return { results: results };
  },

  search: async function (params, ctx) {
    await requirePin(ctx, 'bank');
    const q = String(params.q || '').trim().toLowerCase();
    if (!q) return { results: [] };
    const balIndex = buildIndex(await readAll(ctx.db, 'BANK_BALANCE'), 'citizen_id');
    const rows = await readAll(ctx.db, 'STUDENTS');
    const results = [];
    for (let i = 0; i < rows.length && results.length < 20; i++) {
      const s = rows[i];
      const hay = (studentName(s) + ' ' + s.student_code + ' ' + s.citizen_id).toLowerCase();
      if (hay.indexOf(q) < 0) continue;
      const row = balIndex[String(s.citizen_id)];
      results.push({
        citizen_id: s.citizen_id, student_code: s.student_code, name: studentName(s),
        grade: s.grade, room: s.room, balance: row ? Number(row.balance) || 0 : 0,
      });
    }
    return { results: results };
  },

  balance: async function (params, ctx) {
    await requirePin(ctx, 'bank');
    if (!params.citizen_id) apiError('VALIDATION', 'กรุณาระบุนักเรียน');
    const row = await getBy(ctx.db, 'BANK_BALANCE', 'citizen_id', String(params.citizen_id));
    return { citizen_id: params.citizen_id, balance: row ? Number(row.balance) || 0 : 0 };
  },

  deposit: async function (params, ctx) {
    await requirePin(ctx, 'bank');
    return applyTransaction(ctx.db, 'deposit', params);
  },

  withdraw: async function (params, ctx) {
    await requirePin(ctx, 'bank');
    return applyTransaction(ctx.db, 'withdraw', params);
  },

  history: async function (params, ctx) {
    await requirePin(ctx, 'bank');
    const p = params || {};
    const stIndex = buildIndex(await readAll(ctx.db, 'STUDENTS'), 'citizen_id');
    let rows = p.citizen_id
      ? await selectWhere(ctx.db, 'BANK_TRANSACTIONS', 'citizen_id', String(p.citizen_id))
      : await readAll(ctx.db, 'BANK_TRANSACTIONS');

    if (p.type) rows = rows.filter(function (t) { return t.type === p.type; });
    if (p.date_from) rows = rows.filter(function (t) { return toYmd(t.date) >= p.date_from; });
    if (p.date_to) rows = rows.filter(function (t) { return toYmd(t.date) <= p.date_to; });
    if (p.grade) rows = rows.filter(function (t) { const s = stIndex[String(t.citizen_id)]; return s && s.grade === p.grade; });

    rows.sort(function (a, b) { return String(b.created_at).localeCompare(String(a.created_at)); });
    const limit = Math.min(parseInt(p.limit, 10) || 100, 500);
    const total = rows.length;
    rows = rows.slice(0, limit).map(function (t) {
      const s = stIndex[String(t.citizen_id)];
      return {
        txn_id: t.txn_id, date: t.date, type: t.type, amount: Number(t.amount) || 0,
        balance_after: Number(t.balance_after) || 0, note: t.note, recorded_by: t.recorded_by,
        created_at: t.created_at, citizen_id: t.citizen_id,
        name: s ? studentName(s) : '(ไม่พบ)', grade: s ? s.grade : '', room: s ? s.room : '',
      };
    });
    return { transactions: rows, total: total, returned: rows.length };
  },

  passbook: async function (params, ctx) {
    await requirePin(ctx, 'bank');
    const cid = params.citizen_id;
    if (!cid) apiError('VALIDATION', 'กรุณาระบุนักเรียน');
    const s = await getBy(ctx.db, 'STUDENTS', 'citizen_id', String(cid));
    if (!s) apiError('NOT_FOUND', 'ไม่พบนักเรียน');
    const balRow = await getBy(ctx.db, 'BANK_BALANCE', 'citizen_id', String(cid));
    const txns = (await selectWhere(ctx.db, 'BANK_TRANSACTIONS', 'citizen_id', String(cid)))
      .sort(function (a, b) { return String(a.created_at).localeCompare(String(b.created_at)); })
      .map(function (t) {
        return {
          txn_id: t.txn_id, date: t.date, type: t.type, amount: Number(t.amount) || 0,
          balance_after: Number(t.balance_after) || 0, note: t.note, recorded_by: t.recorded_by, created_at: t.created_at,
        };
      });
    return {
      student: { citizen_id: s.citizen_id, student_code: s.student_code, name: studentName(s), grade: s.grade, room: s.room },
      balance: balRow ? Number(balRow.balance) || 0 : 0,
      transactions: txns,
    };
  },

  /** สถิตินิสัยการออม — ความถี่การฝาก (จำนวนครั้ง) รายเดือน + จัดอันดับ */
  saving_habit: async function (params, ctx) {
    await requirePin(ctx, 'bank');
    const p = params || {};
    const ym = p.year_month || yearMonth();
    const months = lastMonths(ym, 6);
    const students = (await readAll(ctx.db, 'STUDENTS')).filter(function (s) { return s.status === 'active' || !s.status; });

    const monthlyTrend = {};
    months.forEach(function (m) { monthlyTrend[m] = { year_month: m, deposit_count: 0, deposit_total: 0 }; });
    const countByStudent = {}, amountByStudent = {};
    (await readAll(ctx.db, 'BANK_TRANSACTIONS')).forEach(function (t) {
      if (t.type !== 'deposit') return;
      const tYm = toYm(t.date), amt = Number(t.amount) || 0;
      if (monthlyTrend[tYm]) { monthlyTrend[tYm].deposit_count++; monthlyTrend[tYm].deposit_total += amt; }
      if (tYm === ym) {
        const cid = String(t.citizen_id);
        countByStudent[cid] = (countByStudent[cid] || 0) + 1;
        amountByStudent[cid] = (amountByStudent[cid] || 0) + amt;
      }
    });

    let list = students.map(function (s) {
      const cid = String(s.citizen_id);
      return {
        citizen_id: s.citizen_id, student_code: s.student_code, name: studentName(s), grade: s.grade, room: s.room,
        deposit_count: countByStudent[cid] || 0, deposit_total: Math.round((amountByStudent[cid] || 0) * 100) / 100,
      };
    });
    if (p.grade) list = list.filter(function (e) { return e.grade === p.grade; });
    list.sort(function (a, b) {
      if (b.deposit_count !== a.deposit_count) return b.deposit_count - a.deposit_count;
      if (b.deposit_total !== a.deposit_total) return b.deposit_total - a.deposit_total;
      return String(a.name).localeCompare(String(b.name), 'th');
    });
    list.forEach(function (e, i) { e.rank = i + 1; });
    return {
      year_month: ym, ranking: list,
      monthly_trend: months.map(function (m) { const o = monthlyTrend[m]; o.deposit_total = Math.round(o.deposit_total * 100) / 100; return o; }),
    };
  },
};

/** 'YYYY-MM' ย้อนหลัง n เดือนจนถึง ym (เก่า→ใหม่) */
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

/** ฝาก/ถอน — อ่านยอด → เช็ก → เขียน txn + อัปเดตยอด (ความเสี่ยง race ต่ำ: เจ้าหน้าที่คนเดียวทำทีละรายการ) */
async function applyTransaction(db, type, params) {
  const cid = params.citizen_id;
  let amount = Number(params.amount);
  if (!cid) apiError('VALIDATION', 'กรุณาระบุนักเรียน');
  if (!isFinite(amount) || amount <= 0) apiError('VALIDATION', 'จำนวนเงินต้องมากกว่า 0');
  amount = Math.round(amount * 100) / 100;

  const student = await getBy(db, 'STUDENTS', 'citizen_id', String(cid));
  if (!student) apiError('NOT_FOUND', 'ไม่พบนักเรียน');

  const balRow = await getBy(db, 'BANK_BALANCE', 'citizen_id', String(cid));
  const current = balRow ? Number(balRow.balance) || 0 : 0;
  if (type === 'withdraw' && amount > current) {
    apiError('INSUFFICIENT_FUNDS', 'ยอดเงินไม่พอ (คงเหลือ ' + current.toFixed(2) + ' บาท)');
  }
  const balanceAfter = Math.round((type === 'deposit' ? current + amount : current - amount) * 100) / 100;
  const txnId = genId('TXN'); const ts = now();

  await insertRows(db, 'BANK_TRANSACTIONS', [{
    txn_id: txnId, date: today(), citizen_id: cid, type: type, amount: amount, balance_after: balanceAfter,
    note: params.note || '', recorded_by: params.recorded_by || 'admin', created_at: ts,
  }]);
  await upsert(db, 'BANK_BALANCE', { citizen_id: cid, balance: balanceAfter, last_txn_date: ts, updated_at: ts });
  await audit(db, 'bank', type === 'deposit' ? 'DEPOSIT' : 'WITHDRAW', txnId,
    { citizen_id: cid, amount: amount, balance_after: balanceAfter }, params.recorded_by);

  return {
    txn_id: txnId, type: type, amount: amount, balance_after: balanceAfter, date: today(),
    student: { name: studentName(student), grade: student.grade, room: student.room, student_code: student.student_code },
  };
}
