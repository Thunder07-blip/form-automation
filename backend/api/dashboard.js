require('dotenv').config({ path: '../.env' });
const { neon } = require('@neondatabase/serverless');

const allowCors = fn => async (req, res) => {
  res.setHeader('Access-Control-Allow-Credentials', true);
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');
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
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  const { email } = req.query;

  if (!email) {
    return res.status(400).json({ error: 'Email is required' });
  }

  try {
    const sql = neon(process.env.DATABASE_URL);

    // Fetch user
    const users = await sql`SELECT * FROM Users WHERE email = ${email}`;
    if (users.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }
    const user = users[0];

    // Fetch aggregate usage stats
    const statsResult = await sql`
      SELECT 
        COUNT(*) as total_forms,
        SUM(questions_filled) as total_questions,
        AVG(questions_filled) as avg_questions,
        AVG(time_taken_seconds) as avg_time
      FROM FormUsage
      WHERE user_id = ${user.user_id}
    `;
    const stats = statsResult[0];

    // Fetch recent activity (last 10)
    const recentActivity = await sql`
      SELECT usage_id, timestamp, time_taken_seconds, questions_detected, questions_filled, success 
      FROM FormUsage 
      WHERE user_id = ${user.user_id}
      ORDER BY timestamp DESC
      LIMIT 10
    `;

    return res.status(200).json({
      success: true,
      user: {
        name: user.name,
        email: user.email,
        college: user.college,
        branch: user.branch,
        year: user.year
      },
      stats: {
        total_forms: parseInt(stats.total_forms || 0),
        total_questions: parseInt(stats.total_questions || 0),
        avg_questions: parseFloat(stats.avg_questions || 0).toFixed(1),
        avg_time: parseFloat(stats.avg_time || 0).toFixed(1)
      },
      recent_activity: recentActivity
    });

  } catch (error) {
    console.error('Dashboard Error:', error);
    return res.status(500).json({ error: 'Internal Server Error' });
  }
}

module.exports = allowCors(handler);
