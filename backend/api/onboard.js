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

  const { name, email, college, branch, year } = req.body;

  if (!name || !email || !college || !branch || !year) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  const pool = new Pool({ connectionString: process.env.DATABASE_URL });

  try {
    // Upsert logic: if email exists, return existing user ID. Otherwise insert.
    const result = await pool.query(
      `INSERT INTO users (name, email, college, branch, year) 
       VALUES ($1, $2, $3, $4, $5) 
       ON CONFLICT (email) DO UPDATE 
       SET name = EXCLUDED.name, college = EXCLUDED.college, branch = EXCLUDED.branch, year = EXCLUDED.year
       RETURNING id;`,
      [name, email, college, branch, year]
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
