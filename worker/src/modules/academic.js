/**
 * วิชาการ › ท่องสูตรคูณ — บันทึกการท่องสูตรคูณแม่ 2–12 รายคน ทุกภาคเรียน ทุกปีการศึกษา
 * ภาคเรียนปัจจุบัน: ดูและบันทึกได้โดยไม่ต้องเข้าสู่ระบบ (ผู้บันทึกพิมพ์ชื่อตัวเอง) · ดูภาคเก่า/แนวโน้ม/รายคน ได้เช่นกัน
 *   acad_admin  : แก้ผลภาคเรียนที่ผ่านมาแล้ว — ต้องเข้าสู่ระบบ (ผู้ดูแล · ฝ่ายวิชาการ · tt-auth.js)
 * หน้าสาธารณะ → ไม่ส่งเลขประจำตัวประชาชนออกไป: ใช้รหัสอ้างอิง sid = HMAC(ADMIN_KEY, citizen_id) แทน
 * ข้อมูลเดิมไม่หาย: เขียนเฉพาะ ACAD_* · ยกเลิกการเช็ค = passed 0 (ไม่ลบแถว + บันทึก AUDIT_LOG)
 *   ACAD_MULT_ROSTER เก็บชั้น/ห้อง ณ ภาคเรียนนั้น → เลื่อนชั้นแล้วสถิติภาคเก่ายังอยู่ชั้นเดิม
 *   ชั้นของภาคปัจจุบันซิงก์จาก STUDENTS (อ่านอย่างเดียว) · หยุดซิงก์รายคนเมื่อมีผลการท่องในภาคนั้นแล้ว
 */
import { selectWhere, getBy, now, today, toYmd, audit, apiError } from '../db.js';
import { requireCap, currentUser, can } from './tt-auth.js';
import { getSetting } from './settings.js';

export const MULT_TABLES = [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];
const MAX_ITEMS = 20;   // ต่อคำขอ (2 คำสั่ง D1/รายการ — อยู่ในเพดานของ Worker ฟรี)

async function currentTerm(db) {
  const y = String((await getSetting(db, 'current_year')) || '').trim();
  const s = String((await getSetting(db, 'current_semester')) || '1').trim();
  return y ? y + '-' + s : '';
}
function checkTerm(t) {
  t = String(t || '').trim();
  if (!/^\d{4}-[1-3]$/.test(t)) apiError('VALIDATION', 'ภาคเรียนไม่ถูกต้อง (รูปแบบ ปี-ภาค เช่น 2569-1)');
  return t;
}
function who(u, typed) {
  if (u) return u.display_name || u.username;
  const n = String(typed || '').replace(/\s+/g, ' ').trim().slice(0, 40);
  if (!n) apiError('VALIDATION', 'กรุณาพิมพ์ชื่อผู้บันทึก');
  return n;
}

/** รหัสอ้างอิงนักเรียนสำหรับหน้าสาธารณะ (เดาเลขประจำตัวประชาชนกลับไม่ได้ถ้าไม่รู้ ADMIN_KEY) */
async function sidFn(ctx) {
  if (!ctx._sidKey) {
    const secret = (ctx.env && ctx.env.ADMIN_KEY) || 'baanmai-local-dev';
    ctx._sidKey = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret + ':acad-sid'), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  }
  const key = ctx._sidKey;
  return async function (cid) {
    const sig = new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(String(cid))));
    return Array.prototype.map.call(sig.slice(0, 10), function (b) { return ('0' + b.toString(16)).slice(-2); }).join('');
  };
}
/** sid → citizen_id (เทียบกับนักเรียนทุกคน) */
async function resolveSids(ctx, sids) {
  const want = {}, out = {};
  sids.forEach(function (x) { want[String(x || '')] = 1; });
  const sid = await sidFn(ctx);
  const rows = (await ctx.db.prepare("SELECT citizen_id FROM STUDENTS WHERE COALESCE(citizen_id, '') <> ''").all()).results || [];
  for (const r of rows) { const k = await sid(r.citizen_id); if (want[k]) out[k] = String(r.citizen_id); }
  return out;
}

/** ซิงก์ชั้น/ห้องของภาคปัจจุบันจาก STUDENTS (1 คำสั่ง) — ไม่แก้คนที่มีผลการท่องในภาคนี้แล้ว */
async function syncRoster(db, term) {
  await db.prepare(
    "INSERT INTO ACAD_MULT_ROSTER (roster_id, term, citizen_id, grade, room, updated_at) " +
    "SELECT ? || ':' || citizen_id, ?, citizen_id, grade, CAST(COALESCE(room, '') AS TEXT), ? FROM STUDENTS " +
    "WHERE COALESCE(status, '') <> 'inactive' AND COALESCE(citizen_id, '') <> '' " +
    "ON CONFLICT(roster_id) DO UPDATE SET grade = excluded.grade, room = excluded.room, updated_at = excluded.updated_at " +
    "WHERE (ACAD_MULT_ROSTER.grade IS NOT excluded.grade OR ACAD_MULT_ROSTER.room IS NOT excluded.room) " +
    "AND NOT EXISTS (SELECT 1 FROM ACAD_MULT m WHERE m.term = ACAD_MULT_ROSTER.term AND m.citizen_id = ACAD_MULT_ROSTER.citizen_id)"
  ).bind(term, term, now()).run();
}

/** ภาคเรียนที่เปิดดูได้ = ภาคปัจจุบัน + ทุกภาคที่เคยมีรายชื่อ (ใหม่ → เก่า) */
async function termList(db, cur) {
  const r = await db.prepare('SELECT DISTINCT term FROM ACAD_MULT_ROSTER').all();
  const set = {};
  (r.results || []).forEach(function (x) { set[x.term] = 1; });
  if (cur) set[cur] = 1;
  return Object.keys(set).sort().reverse();
}

/** ตรวจสิทธิ์เขียนตามภาคเรียน: ภาคปัจจุบัน = ทุกคน · ภาคอื่น = เข้าสู่ระบบ + acad_admin */
async function writeGuard(ctx, rawTerm) {
  const term = checkTerm(rawTerm);
  const cur = await currentTerm(ctx.db);
  const u = term === cur ? await currentUser(ctx) : await requireCap(ctx, 'acad_admin');
  return { u: u, cur: cur, term: term };
}

/** บันทึกหลายรายการใน batch เดียว — items = [{ sid, table_no, passed, date? }] */
async function saveItems(ctx, u, term, items, typedBy) {
  const db = ctx.db;
  if (!Array.isArray(items) || !items.length) apiError('VALIDATION', 'ไม่มีรายการที่จะบันทึก');
  if (items.length > MAX_ITEMS) apiError('VALIDATION', 'บันทึกได้ครั้งละไม่เกิน ' + MAX_ITEMS + ' รายการ');
  const by = who(u, typedBy);
  const cidOf = await resolveSids(ctx, items.map(function (it) { return it.sid; }));
  const existing = {};
  (await selectWhere(db, 'ACAD_MULT', 'term', term)).forEach(function (r) { existing[r.rec_id] = r; });
  const ts = now(), td = today(), stmts = [], out = [], unchecked = [], seen = {};
  for (const it of items) {
    const sid = String(it.sid || ''), cid = cidOf[sid], no = Number(it.table_no), passed = it.passed ? 1 : 0;
    if (MULT_TABLES.indexOf(no) < 0) apiError('VALIDATION', 'ข้อมูลไม่ถูกต้อง (แม่ ' + it.table_no + ')');
    if (!cid) apiError('NOT_FOUND', 'ไม่พบนักเรียน — โหลดหน้าใหม่แล้วลองอีกครั้ง');
    if (!seen[cid]) {
      seen[cid] = 1;
      // มีชื่อในรายชื่อของภาคนั้นเสมอ (บันทึกย้อนหลังให้นักเรียนที่ยังไม่มีในรายชื่อภาคนั้น → ใช้ชั้นปัจจุบัน)
      stmts.push(db.prepare("INSERT OR IGNORE INTO ACAD_MULT_ROSTER (roster_id, term, citizen_id, grade, room, updated_at) " +
        "SELECT ? || ':' || citizen_id, ?, citizen_id, grade, CAST(COALESCE(room, '') AS TEXT), ? FROM STUDENTS WHERE citizen_id = ?").bind(term, term, ts, cid));
    }
    let date = it.date ? toYmd(it.date) : '';
    if (date && (date > td || date < '2000-01-01')) apiError('VALIDATION', 'วันที่ไม่ถูกต้อง');
    const id = term + ':' + cid + ':' + no, old = existing[id];
    if (passed && !date) date = old && Number(old.passed) === 1 && old.passed_date ? old.passed_date : td;   // เช็คซ้ำ = คงวันที่เดิม
    if (!passed && (!old || Number(old.passed) !== 1)) continue;                                             // ไม่เคยผ่าน → ไม่ต้องเขียน
    if (passed && old && Number(old.passed) === 1 && old.passed_date === date) { out.push({ sid: sid, table_no: no, passed: 1, passed_date: date }); continue; }
    if (!passed) unchecked.push({ citizen_id: cid, table_no: no, was: old.passed_date || '' });
    stmts.push(db.prepare('INSERT INTO ACAD_MULT (rec_id, term, citizen_id, table_no, passed, passed_date, recorded_by, updated_at) VALUES (?,?,?,?,?,?,?,?) ' +
      'ON CONFLICT(rec_id) DO UPDATE SET passed = excluded.passed, passed_date = excluded.passed_date, recorded_by = excluded.recorded_by, updated_at = excluded.updated_at')
      .bind(id, term, cid, no, passed, passed ? date : '', by, ts));
    out.push({ sid: sid, table_no: no, passed: passed, passed_date: passed ? date : '' });
  }
  if (stmts.length) await db.batch(stmts);
  if (unchecked.length) await audit(db, 'acad', 'MULT_UNCHECK', term, { items: unchecked }, by);
  return out;
}

export const AcademicAPI = {

  /** หน้าท่องสูตรคูณ: รายชื่อ (ชั้น ณ ภาคนั้น) + ผลที่ท่องผ่านของภาคที่เลือก — params = { term? } */
  mult_bootstrap: async function (params, ctx) {
    const u = await currentUser(ctx);
    const db = ctx.db;
    const sid = await sidFn(ctx), sids = {};
    const cur = await currentTerm(db);
    const term = params.term ? checkTerm(params.term) : cur;
    if (!term) apiError('CONFIG', 'ยังไม่ได้ตั้งปีการศึกษา/ภาคเรียนปัจจุบัน (หน้าตั้งค่าระบบ)');
    if (term === cur) await syncRoster(db, term);
    const rows = (await db.prepare(
      'SELECT r.citizen_id, r.grade, r.room, s.student_code, s.prefix, s.first_name, s.last_name, s.gender, s.status ' +
      'FROM ACAD_MULT_ROSTER r LEFT JOIN STUDENTS s ON s.citizen_id = r.citizen_id WHERE r.term = ?').bind(term).all()).results || [];
    const recs = (await db.prepare('SELECT citizen_id, table_no, passed_date, recorded_by FROM ACAD_MULT WHERE term = ? AND passed = 1').bind(term).all()).results || [];
    for (const r of rows) sids[r.citizen_id] = await sid(r.citizen_id);
    for (const r of recs) if (!sids[r.citizen_id]) sids[r.citizen_id] = await sid(r.citizen_id);
    return {
      term: term, current_term: cur, terms: await termList(db, cur), tables: MULT_TABLES,
      can_record: term === cur || can(u, 'acad_admin'), past_needs_login: term !== cur && !can(u, 'acad_admin'),
      user: u ? who(u) : '',
      students: rows.map(function (r) {
        return { sid: sids[r.citizen_id], grade: r.grade || '', room: r.room != null ? String(r.room) : '', student_code: r.student_code || '',
          prefix: r.prefix || '', first_name: r.first_name || '', last_name: r.last_name || '', gender: r.gender || '',
          active: r.status !== 'inactive' && r.first_name != null };
      }),
      records: recs.map(function (r) { return { sid: sids[r.citizen_id], table_no: Number(r.table_no), passed_date: r.passed_date || '', recorded_by: r.recorded_by || '' }; }),
    };
  },

  /** เช็ค/ยกเลิก 1 รายการ — params = { term, sid, table_no, passed, date?, recorded_by (ถ้าไม่ได้เข้าสู่ระบบ) } */
  mult_set: async function (params, ctx) {
    const g = await writeGuard(ctx, params.term);
    return { saved: await saveItems(ctx, g.u, g.term, [params], params.recorded_by) };
  },

  /** เช็คหลายรายการพร้อมกัน (เช่น ท่องได้ทุกแม่) — params = { term, items:[{sid, table_no, passed, date?}], recorded_by? } */
  mult_set_many: async function (params, ctx) {
    const g = await writeGuard(ctx, params.term);
    return { saved: await saveItems(ctx, g.u, g.term, params.items, params.recorded_by) };
  },

  /** สรุปทุกภาคเรียน (แนวโน้ม) — ต่อ ภาค × ชั้น × ห้อง: จำนวนคน · ท่องครบ 11 แม่ · ยังไม่ผ่านเลย · รวมแม่ที่ผ่าน */
  mult_summary: async function (params, ctx) {
    const db = ctx.db;
    const cur = await currentTerm(db);
    const rows = (await db.prepare(
      'SELECT r.term, r.grade, r.room, r.citizen_id, s.status, ' +
      '(SELECT COUNT(*) FROM ACAD_MULT m WHERE m.term = r.term AND m.citizen_id = r.citizen_id AND m.passed = 1) AS n ' +
      'FROM ACAD_MULT_ROSTER r LEFT JOIN STUDENTS s ON s.citizen_id = r.citizen_id').all()).results || [];
    const agg = {};
    rows.forEach(function (r) {
      if (r.term === cur && r.status === 'inactive' && !r.n) return;   // ออกระหว่างภาคปัจจุบันและยังไม่มีผล → ไม่นับ
      const k = r.term + '|' + (r.grade || '') + '|' + (r.room || '');
      const a = agg[k] || (agg[k] = { term: r.term, grade: r.grade || '', room: r.room != null ? String(r.room) : '', students: 0, complete: 0, none: 0, passes: 0 });
      const n = Number(r.n) || 0;
      a.students++; a.passes += n;
      if (n >= MULT_TABLES.length) a.complete++;
      if (!n) a.none++;
    });
    return { current_term: cur, tables: MULT_TABLES.length, rows: Object.keys(agg).map(function (k) { return agg[k]; }) };
  },

  /** ประวัติรายคนทุกภาคเรียน — params = { sid } */
  mult_student: async function (params, ctx) {
    const db = ctx.db;
    const cid = params.sid ? (await resolveSids(ctx, [params.sid]))[String(params.sid)] : '';
    const s = cid ? await getBy(db, 'STUDENTS', 'citizen_id', cid) : null;
    if (!s) apiError('NOT_FOUND', 'ไม่พบนักเรียน');
    return {
      student: { sid: String(params.sid), student_code: s.student_code || '', prefix: s.prefix || '', first_name: s.first_name || '', last_name: s.last_name || '', grade: s.grade || '', room: s.room != null ? String(s.room) : '' },
      terms: (await selectWhere(db, 'ACAD_MULT_ROSTER', 'citizen_id', cid)).map(function (r) { return { term: r.term, grade: r.grade || '', room: r.room != null ? String(r.room) : '' }; })
        .sort(function (a, b) { return a.term < b.term ? -1 : 1; }),
      records: (await selectWhere(db, 'ACAD_MULT', 'citizen_id', cid)).filter(function (r) { return Number(r.passed) === 1; })
        .map(function (r) { return { term: r.term, table_no: Number(r.table_no), passed_date: r.passed_date || '', recorded_by: r.recorded_by || '' }; }),
    };
  },
};
