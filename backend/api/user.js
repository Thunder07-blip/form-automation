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

  const pool = new Pool({ connectionString: process.env.DATABASE_URL });

  try {
    if (req.method === 'GET') {
      const { id } = req.query;
      if (!id) return res.status(400).json({ error: 'Missing user ID' });

      const result = await pool.query(
        'SELECT name, email, college, city, branch, year, gender, phone, dob, prn FROM users WHERE id = $1',
        [id]
      );

      if (result.rows.length === 0) {
        return res.status(404).json({ error: 'User not found' });
      }

      return res.status(200).json({ user: result.rows[0] });
    } 
    else if (req.method === 'PUT' || req.method === 'POST') {
      const { id, name, email, college, city, branch, year, gender, phone, dob, prn } = req.body;
      if (!id) return res.status(400).json({ error: 'Missing user ID' });

      await pool.query(
        `UPDATE users 
         SET name = $1, email = $2, college = $3, city = $4, branch = $5, year = $6,
             gender = $7, phone = $8, dob = $9, prn = $10
         WHERE id = $11`,
        [name, email, college, city, branch, year, gender, phone, dob, prn, id]
      );

      return res.status(200).json({ success: true });
    } 
    else {
      return res.status(405).json({ error: 'Method Not Allowed' });
    }
  } catch (error) {
    console.error('DB Error:', error);
    return res.status(500).json({ error: 'Internal Server Error', details: error.message });
  } finally {
    pool.end();
  }
}
