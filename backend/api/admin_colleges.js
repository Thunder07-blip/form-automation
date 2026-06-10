import { Pool } from '@neondatabase/serverless';

const DEFAULT_MODE = 'launch_allowlist';
const DEFAULT_COLLEGES = ['VIT Bibwewadi', 'VIT Kondhwa'];

function setCors(res) {
  res.setHeader('Access-Control-Allow-Credentials', true);
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,POST,PUT');
  res.setHeader(
    'Access-Control-Allow-Headers',
    'X-Admin-Token, X-CSRF-Token, X-Requested-With, Accept, Content-Type'
  );
}

function normalizeMode(mode) {
  return mode === 'open_catalog' ? 'open_catalog' : DEFAULT_MODE;
}

function normalizeColleges(colleges) {
  if (!Array.isArray(colleges)) return DEFAULT_COLLEGES;
  const cleaned = colleges
    .map(item => String(item || '').trim())
    .filter(Boolean);
  const unique = [...new Set(cleaned)].slice(0, 100);
  return unique.length > 0 ? unique : DEFAULT_COLLEGES;
}

async function ensureAdminTables(pool) {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS admin_settings (
      key VARCHAR(100) PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS college_allowlist (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      name VARCHAR(255) UNIQUE NOT NULL,
      active BOOLEAN NOT NULL DEFAULT TRUE,
      created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
    );
  `);

  await pool.query(
    `INSERT INTO admin_settings (key, value)
     VALUES ('college_mode', $1)
     ON CONFLICT (key) DO NOTHING;`,
    [DEFAULT_MODE]
  );

  for (const college of DEFAULT_COLLEGES) {
    await pool.query(
      `INSERT INTO college_allowlist (name, active)
       VALUES ($1, TRUE)
       ON CONFLICT (name) DO UPDATE SET active = TRUE;`,
      [college]
    );
  }
}

async function readConfig(pool) {
  const modeResult = await pool.query(
    `SELECT value FROM admin_settings WHERE key = 'college_mode'`
  );
  const collegeResult = await pool.query(
    `SELECT name FROM college_allowlist WHERE active = TRUE ORDER BY name ASC`
  );

  return {
    mode: normalizeMode(modeResult.rows[0]?.value),
    colleges: collegeResult.rows.map(row => row.name)
  };
}

function canWrite(req) {
  const expected = process.env.ADMIN_TOKEN;
  if (!expected) return false;
  return req.headers['x-admin-token'] === expected;
}

export default async function handler(req, res) {
  setCors(res);

  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  const pool = new Pool({ connectionString: process.env.DATABASE_URL });

  try {
    await ensureAdminTables(pool);

    if (req.method === 'GET') {
      return res.status(200).json(await readConfig(pool));
    }

    if (req.method !== 'POST' && req.method !== 'PUT') {
      return res.status(405).json({ error: 'Method Not Allowed' });
    }

    if (!canWrite(req)) {
      return res.status(401).json({ error: 'Invalid or missing admin token' });
    }

    const mode = normalizeMode(req.body?.mode);
    const colleges = normalizeColleges(req.body?.colleges);

    await pool.query('BEGIN');
    await pool.query(
      `INSERT INTO admin_settings (key, value, updated_at)
       VALUES ('college_mode', $1, CURRENT_TIMESTAMP)
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = CURRENT_TIMESTAMP;`,
      [mode]
    );

    await pool.query(`UPDATE college_allowlist SET active = FALSE;`);
    for (const college of colleges) {
      await pool.query(
        `INSERT INTO college_allowlist (name, active)
         VALUES ($1, TRUE)
         ON CONFLICT (name) DO UPDATE SET active = TRUE;`,
        [college]
      );
    }
    await pool.query('COMMIT');

    return res.status(200).json(await readConfig(pool));
  } catch (error) {
    try {
      await pool.query('ROLLBACK');
    } catch (_) {}
    console.error('Admin colleges error:', error);
    return res.status(500).json({ error: 'Internal Server Error', details: error.message });
  } finally {
    pool.end();
  }
}
