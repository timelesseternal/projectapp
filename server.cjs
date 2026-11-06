const http = require('node:http');
const https = require('node:https');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const PORT = Number(process.env.PORT) || 4173;
const HOST = process.env.HOST || '0.0.0.0';
const root = path.join(__dirname, 'dist');
const dataDir = path.join(__dirname, 'data');
fs.mkdirSync(dataDir, { recursive: true });

const mime = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.json': 'application/json; charset=utf-8',
  '.ico': 'image/x-icon'
};

function hashPassword(password, salt = 'codesense-ts-salt-2026') {
  return crypto.scryptSync(String(password), salt, 32).toString('hex');
}

// --- Database Layer (node:sqlite built-in with automatic JSON fallback) ---
let dbMode = 'sqlite';
let sqliteDb = null;
const jsonDbPath = path.join(dataDir, 'codesense-fallback.json');

try {
  const { DatabaseSync } = require('node:sqlite');
  sqliteDb = new DatabaseSync(path.join(dataDir, 'codesense.db'));
  sqliteDb.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      username TEXT UNIQUE NOT NULL,
      name TEXT NOT NULL,
      email TEXT UNIQUE NOT NULL,
      role TEXT NOT NULL,
      cohort TEXT NOT NULL,
      password_hash TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS sessions (
      token TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS audits (
      id TEXT PRIMARY KEY,
      room_code TEXT NOT NULL,
      title TEXT NOT NULL,
      language TEXT NOT NULL,
      repo_url TEXT,
      student_id TEXT,
      student_name TEXT NOT NULL,
      auditor_id TEXT,
      auditor_name TEXT NOT NULL,
      status TEXT NOT NULL,
      state_json TEXT NOT NULL,
      score_tests INTEGER DEFAULT 0,
      total_tests INTEGER DEFAULT 0,
      score_mutations INTEGER DEFAULT 0,
      duration_sec INTEGER DEFAULT 0,
      verdict TEXT DEFAULT 'pending',
      teacher_comment TEXT DEFAULT '',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `);
} catch (err) {
  dbMode = 'json-file';
}

function loadJsonStore() {
  try {
    return JSON.parse(fs.readFileSync(jsonDbPath, 'utf8'));
  } catch {
    return { users: [], sessions: [], audits: [] };
  }
}
function saveJsonStore(store) {
  fs.writeFileSync(jsonDbPath, JSON.stringify(store, null, 2));
}

const DB = {
  getUsers() {
    if (sqliteDb) {
      return sqliteDb.prepare('SELECT id, username, name, email, role, cohort, created_at FROM users ORDER BY created_at ASC').all();
    }
    return loadJsonStore().users.map(({ password_hash, ...u }) => u);
  },
  findUserByLogin(login) {
    const key = String(login || '').trim().toLowerCase();
    if (sqliteDb) {
      return sqliteDb.prepare('SELECT * FROM users WHERE LOWER(username) = ? OR LOWER(email) = ?').get(key, key);
    }
    return loadJsonStore().users.find(u => u.username.toLowerCase() === key || u.email.toLowerCase() === key);
  },
  findUserById(id) {
    if (sqliteDb) {
      return sqliteDb.prepare('SELECT id, username, name, email, role, cohort, created_at FROM users WHERE id = ?').get(id);
    }
    const u = loadJsonStore().users.find(x => x.id === id);
    if (!u) return null;
    const { password_hash, ...rest } = u;
    return rest;
  },
  createUser({ username, name, email, role, cohort, password }) {
    const user = {
      id: crypto.randomUUID(),
      username: String(username).trim(),
      name: String(name).trim(),
      email: String(email).trim().toLowerCase(),
      role: ['student', 'auditor', 'teacher'].includes(role) ? role : 'student',
      cohort: String(cohort || 'Tomorrow School · Wave 4').trim(),
      password_hash: hashPassword(password),
      created_at: new Date().toISOString()
    };
    if (sqliteDb) {
      sqliteDb.prepare(`
        INSERT INTO users (id, username, name, email, role, cohort, password_hash, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).run(user.id, user.username, user.name, user.email, user.role, user.cohort, user.password_hash, user.created_at);
    } else {
      const s = loadJsonStore();
      if (s.users.some(u => u.username.toLowerCase() === user.username.toLowerCase() || u.email === user.email)) {
        throw Error('Пользователь с таким логином или email уже существует');
      }
      s.users.push(user);
      saveJsonStore(s);
    }
    const { password_hash, ...safe } = user;
    return safe;
  },
  createSession(userId) {
    const token = crypto.randomBytes(24).toString('hex');
    const now = new Date().toISOString();
    if (sqliteDb) {
      sqliteDb.prepare('INSERT INTO sessions (token, user_id, created_at) VALUES (?, ?, ?)').run(token, userId, now);
    } else {
      const s = loadJsonStore();
      s.sessions.push({ token, user_id: userId, created_at: now });
      saveJsonStore(s);
    }
    return token;
  },
  deleteSession(token) {
    if (!token) return;
    if (sqliteDb) {
      sqliteDb.prepare('DELETE FROM sessions WHERE token = ?').run(token);
    } else {
      const s = loadJsonStore();
      s.sessions = s.sessions.filter(x => x.token !== token);
      saveJsonStore(s);
    }
  },
  getUserByToken(token) {
    if (!token) return null;
    if (sqliteDb) {
      const row = sqliteDb.prepare('SELECT user_id FROM sessions WHERE token = ?').get(token);
      return row ? this.findUserById(row.user_id) : null;
    }
    const s = loadJsonStore();
    const row = s.sessions.find(x => x.token === token);
    return row ? this.findUserById(row.user_id) : null;
  },
  listAudits() {
    if (sqliteDb) {
      return sqliteDb.prepare(`
        SELECT id, room_code, title, language, repo_url, student_id, student_name, auditor_id, auditor_name,
               status, score_tests, total_tests, score_mutations, duration_sec, verdict, teacher_comment,
               created_at, updated_at, state_json
        FROM audits ORDER BY updated_at DESC
      `).all().map(r => ({
        ...r,
        state: JSON.parse(r.state_json || '{}'),
        state_json: undefined
      }));
    }
    return loadJsonStore().audits.sort((a, b) => b.updated_at.localeCompare(a.updated_at)).map(r => ({
      ...r,
      state: JSON.parse(r.state_json || '{}'),
      state_json: undefined
    }));
  },
  getAudit(idOrCode) {
    const key = String(idOrCode || '').trim();
    if (sqliteDb) {
      const r = sqliteDb.prepare('SELECT * FROM audits WHERE id = ? OR UPPER(room_code) = UPPER(?)').get(key, key);
      if (!r) return null;
      return { ...r, state: JSON.parse(r.state_json || '{}'), state_json: undefined };
    }
    const r = loadJsonStore().audits.find(x => x.id === key || x.room_code.toUpperCase() === key.toUpperCase());
    if (!r) return null;
    return { ...r, state: JSON.parse(r.state_json || '{}'), state_json: undefined };
  },
  upsertAudit(audit) {
    const now = new Date().toISOString();
    const existing = this.getAudit(audit.id);
    const stateObj = audit.state || existing?.state || {};
    const passed = Array.isArray(stateObj.results) ? stateObj.results.filter(t => t.pass).length : (audit.score_tests ?? 0);
    const total = Array.isArray(stateObj.tests) ? stateObj.tests.length : (audit.total_tests ?? 0);
    const restored = typeof audit.score_mutations === 'number'
      ? audit.score_mutations
      : (Array.isArray(stateObj.mutations) && Array.isArray(stateObj.results) && stateObj.results.length
          ? stateObj.mutations.filter(m => Array.isArray(m.testIndexes) && m.testIndexes.every(i => stateObj.results[i]?.pass)).length
          : 0);
    const duration = stateObj.end && stateObj.start
      ? Math.min(600, Math.max(1, Math.round((stateObj.end - stateObj.start) / 1000)))
      : (audit.duration_sec ?? existing?.duration_sec ?? 0);
    const status = stateObj.finished ? 'finished' : stateObj.active ? 'active' : (audit.status || existing?.status || 'ready');

    const record = {
      id: audit.id || existing?.id || crypto.randomUUID(),
      room_code: audit.room_code || existing?.room_code || ('TS-' + Math.floor(100 + Math.random() * 900)),
      title: audit.title || existing?.title || 'Проект студента',
      language: audit.language || stateObj.language || existing?.language || 'javascript',
      repo_url: audit.repo_url ?? stateObj.repoUrl ?? existing?.repo_url ?? '',
      student_id: audit.student_id ?? existing?.student_id ?? '',
      student_name: audit.student_name || stateObj.studentName || existing?.student_name || 'Алихан С. (Студент)',
      auditor_id: audit.auditor_id ?? existing?.auditor_id ?? '',
      auditor_name: audit.auditor_name || stateObj.auditorName || existing?.auditor_name || 'Тимур Б. (Аудитор)',
      status,
      state_json: JSON.stringify(stateObj),
      score_tests: passed,
      total_tests: total,
      score_mutations: restored,
      duration_sec: duration,
      verdict: audit.verdict || stateObj.verdict || existing?.verdict || (status === 'finished' ? (passed === total && restored === 3 ? 'passed' : 'needs_work') : 'pending'),
      teacher_comment: audit.teacher_comment ?? stateObj.teacherComment ?? existing?.teacher_comment ?? '',
      created_at: existing?.created_at || now,
      updated_at: now
    };

    if (sqliteDb) {
      sqliteDb.prepare(`
        INSERT INTO audits (
          id, room_code, title, language, repo_url, student_id, student_name, auditor_id, auditor_name,
          status, state_json, score_tests, total_tests, score_mutations, duration_sec, verdict,
          teacher_comment, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          title = excluded.title,
          language = excluded.language,
          repo_url = excluded.repo_url,
          student_id = excluded.student_id,
          student_name = excluded.student_name,
          auditor_id = excluded.auditor_id,
          auditor_name = excluded.auditor_name,
          status = excluded.status,
          state_json = excluded.state_json,
          score_tests = excluded.score_tests,
          total_tests = excluded.total_tests,
          score_mutations = excluded.score_mutations,
          duration_sec = excluded.duration_sec,
          verdict = excluded.verdict,
          teacher_comment = excluded.teacher_comment,
          updated_at = excluded.updated_at
      `).run(
        record.id, record.room_code, record.title, record.language, record.repo_url,
        record.student_id, record.student_name, record.auditor_id, record.auditor_name,
        record.status, record.state_json, record.score_tests, record.total_tests,
        record.score_mutations, record.duration_sec, record.verdict, record.teacher_comment,
        record.created_at, record.updated_at
      );
    } else {
      const s = loadJsonStore();
      const idx = s.audits.findIndex(x => x.id === record.id);
      if (idx >= 0) s.audits[idx] = record;
      else s.audits.push(record);
      saveJsonStore(s);
    }
    return this.getAudit(record.id);
  }
};

// --- Seed Initial Accounts (Teachers, Auditors, Students) & Sample History ---
function seedDatabase() {
  const existing = DB.getUsers();
  let studentUser, student2User, auditorUser, teacherUser;
  if (existing.length === 0) {
    studentUser = DB.createUser({
      username: 'student',
      name: 'Алихан Садыков',
      email: 'alikhan@tomorrow.school',
      role: 'student',
      cohort: 'Go & JS Core · Wave 4',
      password: 'student123'
    });
    student2User = DB.createUser({
      username: 'dana',
      name: 'Дана Касымова',
      email: 'dana@tomorrow.school',
      role: 'student',
      cohort: 'Rust & Algorithms · Wave 4',
      password: 'student123'
    });
    auditorUser = DB.createUser({
      username: 'auditor',
      name: 'Тимур Бектуров',
      email: 'timur@tomorrow.school',
      role: 'auditor',
      cohort: 'Senior Peer Auditor · Wave 3',
      password: 'auditor123'
    });
    teacherUser = DB.createUser({
      username: 'teacher',
      name: 'Арман Есенов',
      email: 'arman.mentor@tomorrow.school',
      role: 'teacher',
      cohort: 'Tomorrow School · Lead Mentor',
      password: 'teacher123'
    });
  } else {
    studentUser = existing.find(u => u.role === 'student') || existing[0];
    auditorUser = existing.find(u => u.role === 'auditor') || existing[0];
  }

  const audits = DB.listAudits();
  if (audits.length === 0 && studentUser && auditorUser) {
    const startTs = Date.now() - 3600_000;
    const endTs = startTs + 312_000;
    DB.upsertAudit({
      id: 'demo-history-go-01',
      room_code: 'TS-101',
      title: 'Биллинг и доставка заказов (Go)',
      language: 'go',
      repo_url: 'https://github.com/tomorrow-school/go-order-engine',
      student_id: studentUser.id,
      student_name: studentUser.name,
      auditor_id: auditorUser.id,
      auditor_name: auditorUser.name,
      status: 'finished',
      score_tests: 6,
      total_tests: 6,
      score_mutations: 3,
      duration_sec: 312,
      verdict: 'passed',
      teacher_comment: 'Отличная защита: студент за 5 минут локализовал все 3 мутации в Go-коде без внешних подсказок.',
      state: {
        id: 'demo-history-go-01',
        roomCode: 'TS-101',
        title: 'Биллинг и доставка заказов (Go)',
        language: 'go',
        repoUrl: 'https://github.com/tomorrow-school/go-order-engine',
        studentName: studentUser.name,
        auditorName: auditorUser.name,
        active: false,
        finished: true,
        start: startTs,
        end: endTs,
        runs: 4,
        antiCheat: { tabSwitches: 0, largePastes: 0, events: [] },
        mutations: [
          { file: 'order.go', line: 8, kind: 'Сравнение и границы', before: '>=', after: '>', testIndexes: [1] },
          { file: 'order.go', line: 15, kind: 'Логическое условие', before: '&&', after: '||', testIndexes: [4] },
          { file: 'order.go', line: 23, kind: 'Арифметика и возврат значения', before: '+', after: '-', testIndexes: [0, 5] }
        ],
        tests: [
          { name: 'Обычный заказ', expression: 'orderTotal(1000,2,false)', expected: 3000 },
          { name: 'Бесплатная доставка на границе', expression: 'delivery(10000)', expected: 0 },
          { name: 'Доставка ниже порога', expression: 'delivery(9999)', expected: 1000 },
          { name: 'Скидка участнику', expression: 'discount(6000,true)', expected: 5400 },
          { name: 'Без скидки для гостя', expression: 'discount(6000,false)', expected: 6000 },
          { name: 'Итог с бесплатной доставкой', expression: 'orderTotal(6000,2,false)', expected: 12000 }
        ],
        results: [
          { name: 'Обычный заказ', pass: true, actual: 3000, expected: 3000 },
          { name: 'Бесплатная доставка на границе', pass: true, actual: 0, expected: 0 },
          { name: 'Доставка ниже порога', pass: true, actual: 1000, expected: 1000 },
          { name: 'Скидка участнику', pass: true, actual: 5400, expected: 5400 },
          { name: 'Без скидки для гостя', pass: true, actual: 6000, expected: 6000 },
          { name: 'Итог с бесплатной доставкой', pass: true, actual: 12000, expected: 12000 }
        ],
        notes: [
          { time: '12:14:20', text: '1. В функции delivery граничное условие >= 10000 было заменено на > 10000, из-за чего заказ ровно на 10000 платил за доставку.' },
          { time: '12:16:05', text: '2. В discount логическое И (&&) было заменено на ИЛИ (||), поэтому гость с суммой > 5000 получал клубную скидку.' },
          { time: '12:17:40', text: '3. В orderTotal стоимость доставки вычиталась (-) вместо сложения (+).' }
        ],
        log: [
          { time: '12:12:30', text: 'Аудит подготовлен: 3 проверенные мутации (Go)' },
          { time: '12:12:45', text: 'Началась 10-минутная P2P-защита' },
          { time: '12:17:57', text: 'Тесты: 6/6 пройдено' },
          { time: '12:18:00', text: 'Защита успешно завершена' }
        ],
        auditorChecklist: { m0: true, m1: true, m2: true, comment: 'Студент уверенно ориентируется в коде.' }
      }
    });
  }
}
seedDatabase();

// --- Built-in Multi-Language Project Templates & GitHub Repository Importer ---
const PROJECT_TEMPLATES = {
  'go-order': {
    title: 'Go: Расчёт заказа и доставки (Tomorrow School Go Piscine)',
    language: 'go',
    repoUrl: 'https://github.com/tomorrow-school/go-order-engine',
    files: {
      'order.go': `package main

func subtotal(price int, quantity int) int {
  return price * quantity
}

func delivery(total int) int {
  if total >= 10000 {
    return 0
  }
  return 1000
}

func discount(total int, isMember bool) int {
  if isMember && total > 5000 {
    return total * 0.9
  }
  return total
}

func orderTotal(price int, quantity int, isMember bool) int {
  total := subtotal(price, quantity)
  return discount(total, isMember) + delivery(total)
}
`
    },
    tests: [
      { name: 'Обычный заказ', expression: 'orderTotal(1000, 2, false)', expected: 3000 },
      { name: 'Бесплатная доставка на границе (10000)', expression: 'delivery(10000)', expected: 0 },
      { name: 'Доставка ниже порога (9999)', expression: 'delivery(9999)', expected: 1000 },
      { name: 'Скидка участнику клуба', expression: 'discount(6000, true)', expected: 5400 },
      { name: 'Без скидки для гостя', expression: 'discount(6000, false)', expected: 6000 },
      { name: 'Итог с бесплатной доставкой', expression: 'orderTotal(6000, 2, false)', expected: 12000 }
    ]
  },
  'rust-rating': {
    title: 'Rust: Система рейтинга и бонусов P2P-пула',
    language: 'rust',
    repoUrl: 'https://github.com/tomorrow-school/rust-p2p-scorer',
    files: {
      'scorer.rs': `pub fn base_points(tasks: i32, weight: i32) -> i32 {
  return tasks * weight;
}

pub fn streak_bonus(days: i32) -> i32 {
  if days >= 7 {
    return 50;
  }
  return 0;
}

pub fn peer_multiplier(score: i32, verified: bool) -> i32 {
  if verified && score > 100 {
    return score + 25;
  }
  return score;
}

pub fn final_rating(tasks: i32, weight: i32, days: i32, verified: bool) -> i32 {
  let raw: i32 = base_points(tasks, weight);
  return peer_multiplier(raw, verified) + streak_bonus(days);
}
`
    },
    tests: [
      { name: 'Базовый рейтинг без бонусов', expression: 'final_rating(5, 10, 3, false)', expected: 50 },
      { name: 'Бонус за серию ровно 7 дней', expression: 'streak_bonus(7)', expected: 50 },
      { name: 'Без бонуса за 6 дней', expression: 'streak_bonus(6)', expected: 0 },
      { name: 'Надбавка за верифицированный P2P > 100', expression: 'peer_multiplier(120, true)', expected: 145 },
      { name: 'Без надбавки без верификации', expression: 'peer_multiplier(120, false)', expected: 120 },
      { name: 'Итоговый рейтинг со всеми бонусами', expression: 'final_rating(6, 20, 7, true)', expected: 195 }
    ]
  },
  'js-order': {
    title: 'JavaScript: Сервис расчёта заказа (Standard Demo)',
    language: 'javascript',
    repoUrl: 'https://github.com/timelesseternal/projectapp',
    files: {
      'order.js': `function subtotal(price, quantity) {
  return price * quantity;
}

function delivery(total) {
  if (total >= 10000) return 0;
  return 1000;
}

function discount(total, isMember) {
  if (isMember && total > 5000) return total * 0.9;
  return total;
}

function orderTotal(price, quantity, isMember) {
  const total = subtotal(price, quantity);
  return discount(total, isMember) + delivery(total);
}
`
    },
    tests: [
      { name: 'Обычный заказ', expression: 'orderTotal(1000,2,false)', expected: 3000 },
      { name: 'Бесплатная доставка на границе', expression: 'delivery(10000)', expected: 0 },
      { name: 'Доставка ниже порога', expression: 'delivery(9999)', expected: 1000 },
      { name: 'Скидка участнику', expression: 'discount(6000,true)', expected: 5400 },
      { name: 'Без скидки для гостя', expression: 'discount(6000,false)', expected: 6000 },
      { name: 'Итог с бесплатной доставкой', expression: 'orderTotal(6000,2,false)', expected: 12000 }
    ]
  }
};

function fetchHttpsJson(url) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, {
      headers: { 'User-Agent': 'CodeSense-TomorrowSchool/2.0', 'Accept': 'application/vnd.github.v3+json' },
      timeout: 5000
    }, res => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          try { resolve(JSON.parse(body)); } catch (e) { reject(e); }
        } else {
          reject(Error('GitHub HTTP ' + res.statusCode));
        }
      });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(Error('GitHub timeout')); });
  });
}

function fetchHttpsText(url) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, {
      headers: { 'User-Agent': 'CodeSense-TomorrowSchool/2.0' },
      timeout: 5000
    }, res => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) resolve(body);
        else reject(Error('HTTP ' + res.statusCode));
      });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(Error('Timeout')); });
  });
}

async function importFromGithub(repoInput, templateId) {
  if (templateId && PROJECT_TEMPLATES[templateId]) {
    return PROJECT_TEMPLATES[templateId];
  }
  const raw = String(repoInput || '').trim();
  const lower = raw.toLowerCase();
  if (lower.includes('rust')) return { ...PROJECT_TEMPLATES['rust-rating'], repoUrl: raw };
  if (lower.includes('go-order') || lower.endsWith('/go') || lower.includes('golang')) {
    return { ...PROJECT_TEMPLATES['go-order'], repoUrl: raw };
  }

  // Parse owner/repo from URL or shorthand
  const match = raw.match(/(?:github\.com\/)?([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)/);
  if (match) {
    const owner = match[1];
    const repo = match[2].replace(/\.git$/, '');
    try {
      const contents = await fetchHttpsJson(`https://api.github.com/repos/${owner}/${repo}/contents`);
      const list = Array.isArray(contents) ? contents : [];
      const files = {};
      let tests = null;
      let language = 'javascript';
      for (const item of list) {
        if (item.type === 'file' && item.download_url && item.size < 200000) {
          if (item.name === 'tests.json') {
            tests = JSON.parse(await fetchHttpsText(item.download_url));
          } else if (/\.(js|go|rs)$/.test(item.name) && !item.name.endsWith('.cjs') && !item.name.includes('test')) {
            files[item.name] = await fetchHttpsText(item.download_url);
            if (item.name.endsWith('.go')) language = 'go';
            if (item.name.endsWith('.rs')) language = 'rust';
          }
        }
      }
      // Also check example/ folder if root had no source files
      if (Object.keys(files).length === 0) {
        const exDir = list.find(x => x.type === 'dir' && x.name === 'example');
        if (exDir) {
          const sub = await fetchHttpsJson(exDir.url);
          for (const item of (Array.isArray(sub) ? sub : [])) {
            if (item.name === 'tests.json' && item.download_url) {
              tests = JSON.parse(await fetchHttpsText(item.download_url));
            } else if (/\.(js|go|rs)$/.test(item.name) && item.download_url) {
              files[item.name] = await fetchHttpsText(item.download_url);
            }
          }
        }
      }
      if (Object.keys(files).length > 0 && Array.isArray(tests) && tests.length > 0) {
        return {
          title: `${owner}/${repo}`,
          language,
          repoUrl: `https://github.com/${owner}/${repo}`,
          files,
          tests
        };
      }
    } catch {
      // Fallback to built-in Go project if offline or rate-limited
    }
  }
  return {
    ...PROJECT_TEMPLATES['go-order'],
    title: raw ? `GitHub: ${raw.replace(/^https?:\/\/github\.com\//, '')}` : PROJECT_TEMPLATES['go-order'].title,
    repoUrl: raw || PROJECT_TEMPLATES['go-order'].repoUrl
  };
}

// --- Real-Time SSE Clients per Audit ---
const sseClients = new Map(); // auditId -> Set<res>
function broadcastAuditUpdate(audit) {
  if (!audit) return;
  const payload = `data: ${JSON.stringify({ type: 'audit_update', audit })}\n\n`;
  for (const key of [audit.id, audit.room_code, '*']) {
    const set = sseClients.get(key);
    if (set) {
      for (const res of set) {
        try { res.write(payload); } catch {}
      }
    }
  }
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', chunk => {
      data += chunk;
      if (data.length > 2_000_000) {
        req.destroy();
        reject(Error('Превышен лимит тела запроса (2 МБ)'));
      }
    });
    req.on('end', () => {
      if (!data) return resolve({});
      try { resolve(JSON.parse(data)); } catch { reject(Error('Некорректный JSON')); }
    });
    req.on('error', reject);
  });
}

function sendJson(res, status, obj) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS'
  });
  res.end(JSON.stringify(obj));
}

function getAuthUser(req) {
  const auth = req.headers['authorization'] || '';
  if (auth.startsWith('Bearer ')) {
    const token = auth.slice(7).trim();
    return { token, user: DB.getUserByToken(token) };
  }
  return { token: null, user: null };
}

const server = http.createServer(async (req, res) => {
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS'
    });
    return res.end();
  }

  let parsedUrl;
  try {
    parsedUrl = new URL(req.url, 'http://localhost');
  } catch {
    res.writeHead(400);
    return res.end();
  }
  const pathname = decodeURIComponent(parsedUrl.pathname);

  // --- API Routes ---
  if (pathname.startsWith('/api/')) {
    try {
      if (pathname === '/api/health' && req.method === 'GET') {
        const users = DB.getUsers();
        const audits = DB.listAudits();
        return sendJson(res, 200, {
          ok: true,
          dbMode,
          usersCount: users.length,
          auditsCount: audits.length,
          templates: Object.entries(PROJECT_TEMPLATES).map(([id, t]) => ({
            id, title: t.title, language: t.language, repoUrl: t.repoUrl
          }))
        });
      }

      if (pathname === '/api/auth/me' && req.method === 'GET') {
        const { user } = getAuthUser(req);
        const demoUsers = DB.getUsers();
        return sendJson(res, 200, { user, demoUsers });
      }

      if (pathname === '/api/auth/login' && req.method === 'POST') {
        const body = await readJsonBody(req);
        const found = DB.findUserByLogin(body.login || body.username || body.email);
        if (!found) return sendJson(res, 401, { error: 'Пользователь не найден' });
        if (!body.quickDemo && found.password_hash !== hashPassword(body.password || '')) {
          return sendJson(res, 401, { error: 'Неверный пароль' });
        }
        const token = DB.createSession(found.id);
        const { password_hash, ...safeUser } = found;
        return sendJson(res, 200, { token, user: safeUser });
      }

      if (pathname === '/api/auth/register' && req.method === 'POST') {
        const body = await readJsonBody(req);
        if (!body.username || !body.name || !body.password) {
          return sendJson(res, 400, { error: 'Заполните логин, имя и пароль' });
        }
        const user = DB.createUser({
          username: body.username,
          name: body.name,
          email: body.email || `${body.username}@tomorrow.school`,
          role: body.role || 'student',
          cohort: body.cohort || 'Tomorrow School · Wave 4',
          password: body.password
        });
        const token = DB.createSession(user.id);
        return sendJson(res, 201, { token, user });
      }

      if (pathname === '/api/auth/logout' && req.method === 'POST') {
        const { token } = getAuthUser(req);
        DB.deleteSession(token);
        return sendJson(res, 200, { ok: true });
      }

      if (pathname === '/api/users' && req.method === 'GET') {
        const users = DB.getUsers();
        const audits = DB.listAudits();
        const enriched = users.map(u => {
          const userAudits = audits.filter(a =>
            (u.role === 'student' && (a.student_id === u.id || a.student_name === u.name)) ||
            (u.role === 'auditor' && (a.auditor_id === u.id || a.auditor_name === u.name))
          );
          return {
            ...u,
            auditsCount: userAudits.length,
            passedCount: userAudits.filter(a => a.verdict === 'passed').length
          };
        });
        return sendJson(res, 200, { users: enriched });
      }

      if (pathname === '/api/github/import' && req.method === 'POST') {
        const body = await readJsonBody(req);
        const imported = await importFromGithub(body.repoUrl, body.templateId);
        return sendJson(res, 200, imported);
      }

      if (pathname === '/api/audits' && req.method === 'GET') {
        const audits = DB.listAudits();
        return sendJson(res, 200, { audits });
      }

      if (pathname === '/api/audits' && req.method === 'POST') {
        const body = await readJsonBody(req);
        const saved = DB.upsertAudit(body);
        broadcastAuditUpdate(saved);
        return sendJson(res, 201, { audit: saved });
      }

      const streamMatch = pathname.match(/^\/api\/audits\/([^/]+)\/stream$/);
      if (streamMatch && req.method === 'GET') {
        const key = streamMatch[1];
        res.writeHead(200, {
          'Content-Type': 'text/event-stream; charset=utf-8',
          'Cache-Control': 'no-cache, no-transform',
          'Connection': 'keep-alive',
          'Access-Control-Allow-Origin': '*'
        });
        res.write(': connected\n\n');
        if (!sseClients.has(key)) sseClients.set(key, new Set());
        sseClients.get(key).add(res);
        const current = DB.getAudit(key);
        if (current) {
          res.write(`data: ${JSON.stringify({ type: 'audit_update', audit: current })}\n\n`);
        }
        req.on('close', () => {
          sseClients.get(key)?.delete(res);
        });
        return;
      }

      const auditMatch = pathname.match(/^\/api\/audits\/([^/]+)$/);
      if (auditMatch) {
        const key = auditMatch[1];
        if (req.method === 'GET') {
          const audit = DB.getAudit(key);
          if (!audit) return sendJson(res, 404, { error: 'Сессия аудита не найдена' });
          return sendJson(res, 200, { audit });
        }
        if (req.method === 'PUT') {
          const body = await readJsonBody(req);
          const existing = DB.getAudit(key);
          const updated = DB.upsertAudit({ ...existing, ...body, id: existing?.id || key });
          broadcastAuditUpdate(updated);
          return sendJson(res, 200, { audit: updated });
        }
      }

      return sendJson(res, 404, { error: 'API endpoint not found' });
    } catch (err) {
      return sendJson(res, 400, { error: err.message || 'Ошибка сервера' });
    }
  }

  // --- Static File Serving ---
  const file = path.resolve(root, '.' + (pathname === '/' ? '/index.html' : pathname));
  if (!file.startsWith(root + path.sep)) {
    res.writeHead(403);
    return res.end();
  }
  fs.readFile(file, (err, data) => {
    if (err) {
      res.writeHead(404);
      return res.end('Not found');
    }
    res.setHeader('Content-Type', mime[path.extname(file)] || 'application/octet-stream');
    res.setHeader('Cache-Control', 'no-store');
    res.end(data);
  });
});

if (require.main === module) {
  server.listen(PORT, HOST, () => {
    console.log(`CodeSense P2P Audit Server (${dbMode}): http://127.0.0.1:${PORT}`);
  });
}

module.exports = { server, DB, PROJECT_TEMPLATES };
