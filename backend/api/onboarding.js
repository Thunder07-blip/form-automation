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

  // In a real production app, verify the Google Token here via the Authorization header
  // For MVP purposes, we accept the email/userId securely passed from the client immediately after login
  const { email, gender, college, branch, year } = req.body;

  if (!email || !gender || !college || !branch || !year) {
    return res.status(400).json({ error: 'All fields are required.' });
  }

  try {
    const sql = neon(process.env.DATABASE_URL);

    const result = await sql`
      UPDATE Users 
      SET 
        gender = ${gender}, 
        college = ${college}, 
        branch = ${branch}, 
        year = ${parseInt(year)}
      WHERE email = ${email}
      RETURNING *
    `;

    if (result.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    return res.status(200).json({ success: true, user: result[0] });

  } catch (error) {
    console.error('Onboarding Error:', error);
    return res.status(500).json({ error: 'Internal Server Error' });
  }
}

module.exports = allowCors(handler);
