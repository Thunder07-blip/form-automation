require('dotenv').config({ path: '../.env' });
const { neon } = require('@neondatabase/serverless');

const allowCors = fn => async (req, res) => {
  res.setHeader('Access-Control-Allow-Credentials', true);
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS');
  res.setHeader(
    'Access-Control-Allow-Headers',
    'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version, Authorization'
  );
  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }
  return await fn(req, res);
};

async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  const { email, time_taken_seconds, questions_detected, questions_filled, success } = req.body;

  if (!email || time_taken_seconds === undefined) {
    return res.status(400).json({ error: 'Missing required usage fields.' });
  }

  try {
    const sql = neon(process.env.DATABASE_URL);

    // Get user_id from email
    const users = await sql`SELECT user_id FROM Users WHERE email = ${email}`;
    if (users.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }
    const userId = users[0].user_id;

    // Insert usage record
    const result = await sql`
      INSERT INTO FormUsage (
        user_id, 
        time_taken_seconds, 
        questions_detected, 
        questions_filled, 
        success
      ) 
      VALUES (
        ${userId}, 
        ${parseInt(time_taken_seconds)}, 
        ${parseInt(questions_detected)}, 
        ${parseInt(questions_filled)}, 
        ${success === true}
      )
      RETURNING *
    `;

    return res.status(200).json({ success: true, usage_id: result[0].usage_id });

  } catch (error) {
    console.error('Usage Error:', error);
    return res.status(500).json({ error: 'Internal Server Error' });
  }
}

module.exports = allowCors(handler);
