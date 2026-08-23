/**
 * Dashboard module — สรุปภาพรวมหน้าหลัก (ไม่ใช้ PIN — แสดงเฉพาะตัวเลขรวม)
 *
 * อ่าน sheet โดยตรง ไม่ผ่าน BankAPI/AttendanceAPI (เลี่ยง PIN) — โชว์ภาพรวมระดับโรงเรียน
 */

const DashboardAPI = {

  summary: function () {
    // ไม่รวม HEALTH_CHECK ใน deps แล้ว — หน้าหลักไม่แสดงข้อมูลสุขภาพ การเช็คสุขภาพระหว่างวัน
    //   จึงไม่ควรทำให้ cache ภาพรวมหน้าหลักถูกล้าง (ลดการคำนวณใหม่โดยไม่จำเป็น)
    return cachedResult('dash.summary',
      ['STUDENTS', 'BANK_BALANCE', 'BEHAVIOR_LOG', 'ATTENDANCE', 'SETTINGS'], 90, function () {
    const students = readAll('STUDENTS').filter(function (s) { return s.status !== 'inactive'; });
    let male = 0, female = 0;
    students.forEach(function (s) {
      if (s.gender === 'ช') male++;
      else if (s.gender === 'ญ') female++;
    });

    // ── ธนาคาร: ยอดรวมจาก BANK_BALANCE ──
    let bankTotal = 0, accountCount = 0;
    readAll('BANK_BALANCE').forEach(function (b) {
      const bal = Number(b.balance) || 0;
      bankTotal += bal;
      accountCount++;
    });

    // ── พฤติกรรม: คะแนนเฉลี่ยเดือนปัจจุบัน ──
    const ym = yearMonth();
    const ms = monthScores(ym);
    let scoreSum = 0;
    students.forEach(function (s) { scoreSum += ms.start + (ms.sums[String(s.citizen_id)] || 0); });
    const behaviorAvg = students.length ? Math.round((scoreSum / students.length) * 10) / 10 : ms.start;

    // ── การมาเรียนวันนี้ ──
    const td = today();
    const counts = { 'มา': 0, 'ขาด': 0, 'ลา': 0, 'สาย': 0 };
    let attChecked = 0;
    readAll('ATTENDANCE').forEach(function (a) {
      if (toYmd(a.date) !== td) return;
      attChecked++;
      if (counts[a.status] !== undefined) counts[a.status]++;
    });

    return {
      date: td,
      students: { total: students.length, male: male, female: female },
      bank: { total_balance: Math.round(bankTotal * 100) / 100, account_count: accountCount },
      behavior: { year_month: ym, avg_score: behaviorAvg, start: ms.start },
      attendance: {
        checked: attChecked,
        counts: counts,
        present_rate: attChecked ? Math.round((counts['มา'] / attChecked) * 1000) / 10 : null,
      },
    };
    });
  },
};
