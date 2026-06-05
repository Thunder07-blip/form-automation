import { Pool } from '@neondatabase/serverless';

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

  const { name, email, college, city, branch, year } = req.body;

  if (!name || !email || !college || !city || !branch || !year) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  const pool = new Pool({ connectionString: process.env.DATABASE_URL });

  try {
    // Upsert user
    const result = await pool.query(
      `INSERT INTO users (name, email, college, city, branch, year) 
       VALUES ($1, $2, $3, $4, $5, $6) 
       ON CONFLICT (email) DO UPDATE 
       SET name = EXCLUDED.name, college = EXCLUDED.college, city = EXCLUDED.city, branch = EXCLUDED.branch, year = EXCLUDED.year
       RETURNING id;`,
      [name, email, college, city, branch, year]
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
