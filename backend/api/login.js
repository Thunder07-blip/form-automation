require('dotenv').config({ path: '../.env' });
const { neon } = require('@neondatabase/serverless');
const { OAuth2Client } = require('google-auth-library');

// Hardcoded for extension development until user provides a client ID
// We can skip actual verification if no client ID is provided during dev,
// but let's set it up correctly.
const CLIENT_ID = process.env.GOOGLE_CLIENT_ID || 'dummy-client-id';
const client = new OAuth2Client(CLIENT_ID);

const allowCors = fn => async (req, res) => {
  res.setHeader('Access-Control-Allow-Credentials', true);
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT');
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

  const { token, email, name } = req.body;

  if (!token && !email) {
    return res.status(400).json({ error: 'Token or Email is required' });
  }

  try {
    let verifiedEmail = email;
    let verifiedName = name;

    // In a real prod env with a proper Google Client ID, verify the token:
    if (CLIENT_ID !== 'dummy-client-id' && token) {
      const ticket = await client.verifyIdToken({
        idToken: token,
        audience: CLIENT_ID,
      });
      const payload = ticket.getPayload();
      verifiedEmail = payload.email;
      verifiedName = payload.name;
    }

    if (!verifiedEmail) {
      return res.status(400).json({ error: 'Invalid token payload' });
    }

    const sql = neon(process.env.DATABASE_URL);

    // Check if user exists
    let users = await sql`SELECT * FROM Users WHERE email = ${verifiedEmail}`;
    let user = users[0];
    let requiresOnboarding = false;

    if (!user) {
      // First time login -> create user
      const result = await sql`
        INSERT INTO Users (email, name) 
        VALUES (${verifiedEmail}, ${verifiedName || null}) 
        RETURNING *
      `;
      user = result[0];
      requiresOnboarding = true;
    } else {
      // Update last login
      const result = await sql`
        UPDATE Users 
        SET last_login_at = CURRENT_TIMESTAMP, name = COALESCE(${verifiedName || null}, name)
        WHERE email = ${verifiedEmail}
        RETURNING *
      `;
      user = result[0];
      
      // If college or year is missing, they haven't finished onboarding
      if (!user.college || !user.year) {
        requiresOnboarding = true;
      }
    }

    return res.status(200).json({
      success: true,
      user: {
        id: user.user_id,
        email: user.email,
        name: user.name,
      },
      requires_onboarding: requiresOnboarding
    });

  } catch (error) {
    console.error('Login Error:', error);
    return res.status(500).json({ error: 'Internal Server Error', details: error.message });
  }
}

module.exports = allowCors(handler);
