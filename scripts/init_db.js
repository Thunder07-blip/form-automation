const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL || 'postgresql://neondb_owner:npg_MQy6fwboA1Ur@ep-royal-mud-apr0r0pd-pooler.c-7.us-east-1.aws.neon.tech/neondb?sslmode=require&channel_binding=require',
});

async function cleanDB() {
  try {
    console.log("Dropping old tables...");
    await pool.query(`DROP TABLE IF EXISTS formusage CASCADE;`);
    await pool.query(`DROP TABLE IF EXISTS users CASCADE;`);
    console.log("Tables dropped successfully!");
    
    console.log("Creating new tables...");
    await pool.query(`
      CREATE TABLE users (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        name VARCHAR(255) NOT NULL,
        email VARCHAR(255) UNIQUE NOT NULL,
        college VARCHAR(255) NOT NULL,
        city VARCHAR(255) NOT NULL,
        branch VARCHAR(255) NOT NULL,
        year VARCHAR(50) NOT NULL,
        gender VARCHAR(50),
        phone VARCHAR(50),
        dob VARCHAR(50),
        prn VARCHAR(100),
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );
    `);

    await pool.query(`
      CREATE TABLE admin_settings (
        key VARCHAR(100) PRIMARY KEY,
        value TEXT NOT NULL,
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );
    `);

    await pool.query(`
      CREATE TABLE college_allowlist (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        name VARCHAR(255) UNIQUE NOT NULL,
        active BOOLEAN NOT NULL DEFAULT TRUE,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );
    `);

    await pool.query(`
      CREATE TABLE colleges (
        name VARCHAR(255) PRIMARY KEY,
        student_count INTEGER NOT NULL DEFAULT 0,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );
    `);

    await pool.query(`
      INSERT INTO admin_settings (key, value) VALUES ('college_mode', 'launch_allowlist');
      INSERT INTO college_allowlist (name, active) VALUES ('VIT Bibwewadi', TRUE), ('VIT Kondhwa', TRUE);
    `);
    
    await pool.query(`
      CREATE TABLE usage_logs (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id UUID REFERENCES users(id) ON DELETE CASCADE,
        start_time TIMESTAMP WITH TIME ZONE NOT NULL,
        end_time TIMESTAMP WITH TIME ZONE,
        duration_ms INTEGER,
        total_fields INTEGER,
        filled_fields INTEGER,
        error_message TEXT
      );
    `);
    console.log("New tables created successfully!");
    
  } catch (err) {
    console.error("Database error:", err);
  } finally {
    pool.end();
  }
}

cleanDB();
