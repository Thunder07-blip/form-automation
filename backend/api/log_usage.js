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

  const { user_id, start_time, end_time, duration_ms, total_fields, filled_fields, error_message } = req.body;

  if (!user_id || !start_time) {
    return res.status(400).json({ error: 'Missing user_id or start_time' });
  }

  const pool = new Pool({ connectionString: process.env.DATABASE_URL });

  try {
    await pool.query(
      `INSERT INTO usage_logs (user_id, start_time, end_time, duration_ms, total_fields, filled_fields, error_message) 
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [user_id, start_time, end_time, duration_ms, total_fields, filled_fields, error_message]
    );

    return res.status(200).json({ success: true });
  } catch (error) {
    console.error('DB Error:', error);
    return res.status(500).json({ error: 'Internal Server Error', details: error.message });
  } finally {
    pool.end();
  }
}
