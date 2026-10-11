/** Dashboard — สรุปภาพรวมหน้าหลัก (ไม่ใช้ PIN) · อ่าน sheet โดยตรง */
import { readAll, today, yearMonth, toYmd, toYm } from '../db.js';
import { behaviorStart } from '../shared.js';

export const DashboardAPI = {

  summary: async function (params, ctx) {
    const db = ctx.db;
    const students = (await readAll(db, 'STUDENTS')).filter(function (s) { return s.status !== 'inactive'; });
    let male = 0, female = 0;
    students.forEach(function (s) { if (s.gender === 'ช') male++; else if (s.gender === 'ญ') female++; });

    // ธนาคาร
    let bankTotal = 0, accountCount = 0;
    (await readAll(db, 'BANK_BALANCE')).forEach(function (b) { bankTotal += Number(b.balance) || 0; accountCount++; });

    // พฤติกรรม — คะแนนเฉลี่ยเดือนปัจจุบัน
    const ym = yearMonth();
    const start = await behaviorStart(db);
    const sums = {};
    (await readAll(db, 'BEHAVIOR_LOG')).forEach(function (l) {
      if (toYm(l.year_month) !== ym) return;
      const cid = String(l.citizen_id);
      sums[cid] = (sums[cid] || 0) + (Number(l.points_change) || 0);
    });
    let scoreSum = 0;
    students.forEach(function (s) { scoreSum += start + (sums[String(s.citizen_id)] || 0); });
    const behaviorAvg = students.length ? Math.round((scoreSum / students.length) * 10) / 10 : start;

    // การมาเรียนวันนี้
    const td = today();
    const counts = { 'มา': 0, 'ขาด': 0, 'ลา': 0, 'สาย': 0 };
    let attChecked = 0;
    (await readAll(db, 'ATTENDANCE')).forEach(function (a) {
      if (toYmd(a.date) !== td) return;
      attChecked++;
      if (counts[a.status] !== undefined) counts[a.status]++;
    });

    return {
      date: td,
      students: { total: students.length, male: male, female: female },
      bank: { total_balance: Math.round(bankTotal * 100) / 100, account_count: accountCount },
      behavior: { year_month: ym, avg_score: behaviorAvg, start: start },
      attendance: { checked: attChecked, counts: counts, present_rate: attChecked ? Math.round((counts['มา'] / attChecked) * 1000) / 10 : null },
    };
  },
};
