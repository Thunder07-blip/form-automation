require('dotenv').config({ path: '../.env' });
const { neon } = require('@neondatabase/serverless');

async function initDb() {
  if (!process.env.DATABASE_URL) {
    console.error('DATABASE_URL is missing in ../.env');
    process.exit(1);
  }

  const sql = neon(process.env.DATABASE_URL);

  try {
    console.log('Creating Users table...');
    await sql`
      CREATE TABLE IF NOT EXISTS Users (
        user_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        email VARCHAR UNIQUE NOT NULL,
        name VARCHAR,
        gender VARCHAR,
        college VARCHAR,
        branch VARCHAR,
        year INTEGER,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        last_login_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        consent_analytics BOOLEAN DEFAULT TRUE,
        consent_marketing BOOLEAN DEFAULT FALSE
      );
    `;
    console.log('Users table ready.');

    console.log('Creating FormUsage table...');
    await sql`
      CREATE TABLE IF NOT EXISTS FormUsage (
        usage_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id UUID REFERENCES Users(user_id) ON DELETE CASCADE,
        timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        time_taken_seconds INTEGER,
        questions_detected INTEGER,
        questions_filled INTEGER,
        success BOOLEAN
      );
    `;
    console.log('FormUsage table ready.');

    console.log('Creating Indexes...');
    await sql`CREATE INDEX IF NOT EXISTS idx_users_college ON Users(college);`;
    await sql`CREATE INDEX IF NOT EXISTS idx_users_branch ON Users(branch);`;
    await sql`CREATE INDEX IF NOT EXISTS idx_usage_user ON FormUsage(user_id);`;
    await sql`CREATE INDEX IF NOT EXISTS idx_usage_timestamp ON FormUsage(timestamp);`;
    console.log('Indexes ready.');

    console.log('Database initialization completed successfully.');
  } catch (err) {
    console.error('Failed to initialize database:', err);
    process.exit(1);
  }
}

initDb();
