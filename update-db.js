const { Pool } = require('pg');
require('dotenv').config();

// Use the exact same connection setup as your main app
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

async function runUpdate() {
  try {
    console.log('Adding interpretation and uploaded_report_path columns...');
    
    await pool.query(`
      ALTER TABLE service_requests 
      ADD COLUMN IF NOT EXISTS interpretation TEXT,
      ADD COLUMN IF NOT EXISTS uploaded_report_path TEXT;
    `);

    console.log('Database update completed successfully!');
    process.exit(0);
  } catch (err) {
    console.error('Error updating database:', err);
    process.exit(1);
  }
}

runUpdate();