/**
 * Dashboard module — สรุปภาพรวมหน้าหลัก (ไม่ใช้ PIN — แสดงเฉพาะตัวเลขรวม)
 *
 * อ่าน sheet โดยตรง ไม่ผ่าน BankAPI/AttendanceAPI (เลี่ยง PIN) — โชว์ภาพรวมระดับโรงเรียน
 */

const DashboardAPI = {

  summary: function () {
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

    // ── ตรวจสุขภาพ: วันล่าสุดที่มีการตรวจ ──
    const healthRows = readAll('HEALTH_CHECK');
    let healthDate = '';
    healthRows.forEach(function (c) { const cd = toYmd(c.date); if (cd > healthDate) healthDate = cd; });
    let hPass = 0, hCells = 0, hChecked = 0;
    if (healthDate) {
      const items = ['hair', 'nails', 'cup', 'toothbrush', 'toothpaste'];
      healthRows.forEach(function (c) {
        if (toYmd(c.date) !== healthDate) return;
        hChecked++;
        items.forEach(function (k) {
          if (c[k] === 'ผ่าน') { hPass++; hCells++; }
          else if (c[k] === 'ไม่ผ่าน') { hCells++; }
        });
      });
    }

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
      health: {
        date: healthDate,
        checked: hChecked,
        pass_rate: hCells ? Math.round((hPass / hCells) * 1000) / 10 : null,
      },
      attendance: {
        checked: attChecked,
        counts: counts,
        present_rate: attChecked ? Math.round((counts['มา'] / attChecked) * 1000) / 10 : null,
      },
    };
  },
};
