import { Pool } from '@neondatabase/serverless';

const DEFAULT_MODE = 'launch_allowlist';
const DEFAULT_COLLEGES = ['VIT Bibwewadi', 'VIT Kondhwa'];

async function ensureCollegeControlTables(pool) {
  await pool.query(`
    ALTER TABLE users
    ADD COLUMN IF NOT EXISTS city VARCHAR(255),
    ADD COLUMN IF NOT EXISTS gender VARCHAR(50),
    ADD COLUMN IF NOT EXISTS phone VARCHAR(50),
    ADD COLUMN IF NOT EXISTS dob VARCHAR(50),
    ADD COLUMN IF NOT EXISTS prn VARCHAR(100);
  `);

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

  await pool.query(`
    CREATE TABLE IF NOT EXISTS colleges (
      name VARCHAR(255) PRIMARY KEY,
      student_count INTEGER NOT NULL DEFAULT 0,
      created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
    );
  `);

  await pool.query(
    `INSERT INTO admin_settings (key, value)
     VALUES ('college_mode', $1)
     ON CONFLICT (key) DO NOTHING;`,
    [DEFAULT_MODE]
  );

  for (const defaultCollege of DEFAULT_COLLEGES) {
    await pool.query(
      `INSERT INTO college_allowlist (name, active)
       VALUES ($1, TRUE)
       ON CONFLICT (name) DO UPDATE SET active = TRUE;`,
      [defaultCollege]
    );
  }
}

async function getCollegeControl(pool) {
  await ensureCollegeControlTables(pool);

  const modeResult = await pool.query(
    `SELECT value FROM admin_settings WHERE key = 'college_mode'`
  );
  const collegeResult = await pool.query(
    `SELECT name FROM college_allowlist WHERE active = TRUE ORDER BY name ASC`
  );

  return {
    mode: modeResult.rows[0]?.value === 'open_catalog' ? 'open_catalog' : DEFAULT_MODE,
    colleges: collegeResult.rows.map(row => row.name)
  };
}

export default async function handler(req, res) {
  // Allow CORS
  res.setHeader('Access-Control-Allow-Credentials', true);
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT');
  res.setHeader(
    'Access-Control-Allow-Headers',
    'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version'
  );

  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  const { name, email, college, city, branch, year, gender } = req.body;

  if (!name || !email || !college || !city || !branch || !year || !gender) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return res.status(400).json({ error: 'Invalid email address' });
  }

  const pool = new Pool({ connectionString: process.env.DATABASE_URL });

  try {
    const collegeControl = await getCollegeControl(pool);
    const isAllowedCollege = collegeControl.colleges
      .some(item => item.toLowerCase() === college.toLowerCase());

    if (collegeControl.mode !== 'open_catalog' && !isAllowedCollege) {
      return res.status(400).json({ error: 'College is not available for the launch test yet' });
    }

    // Upsert user
    const result = await pool.query(
      `INSERT INTO users (name, email, college, city, branch, year, gender) 
       VALUES ($1, $2, $3, $4, $5, $6, $7) 
       ON CONFLICT (email) DO UPDATE 
       SET name = EXCLUDED.name, college = EXCLUDED.college, city = EXCLUDED.city, branch = EXCLUDED.branch, year = EXCLUDED.year, gender = EXCLUDED.gender
       RETURNING id;`,
      [name, email, college, city, branch, year, gender]
    );

    // Track this college (upsert — increment count if exists)
    await pool.query(
      `INSERT INTO colleges (name, student_count) VALUES ($1, 1)
       ON CONFLICT (name) DO UPDATE SET student_count = colleges.student_count + 1;`,
      [college]
    );

    const userId = result.rows[0].id;
    return res.status(200).json({ success: true, user_id: userId });
  } catch (error) {
    console.error('DB Error:', error);
    return res.status(500).json({ error: 'Internal Server Error', details: error.message });
  } finally {
    pool.end();
  }
}
