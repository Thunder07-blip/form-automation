const { Pool } = require('pg');

const pool = new Pool({
  connectionString: 'postgresql://neondb_owner:npg_MQy6fwboA1Ur@ep-royal-mud-apr0r0pd-pooler.c-7.us-east-1.aws.neon.tech/neondb?sslmode=require',
});

async function migrate() {
  try {
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
    await pool.query(`
      INSERT INTO admin_settings (key, value)
      VALUES ('college_mode', 'launch_allowlist')
      ON CONFLICT (key) DO NOTHING;
    `);
    await pool.query(`
      INSERT INTO college_allowlist (name, active)
      VALUES ('VIT Bibwewadi', TRUE), ('VIT Kondhwa', TRUE)
      ON CONFLICT (name) DO UPDATE SET active = TRUE;
    `);
    console.log('Successfully added columns');
  } catch (err) {
    console.error('Migration failed', err);
  } finally {
    pool.end();
  }
}

migrate();
