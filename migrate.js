const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');

const pool = new Pool({
  // Notice ?sslmode=require is removed from the end of this string!
  connectionString: "postgresql://postgres:sVE1%5B%27ag4G@directcare-pft-db.cs5m8662wh1z.us-east-1.rds.amazonaws.com:5432/postgres",
  ssl: {
    rejectUnauthorized: false // Now this command will actually work
  }
});

async function runMigration() {
  console.log('Connecting to AWS RDS PostgreSQL database...');
  try {
    const client = await pool.connect();
    const sql = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
    
    console.log('Running SQL Migration Script...');
    await client.query(sql);
    console.log('SUCCESS: All HIPAA tables, relations, and enums initialized on AWS RDS!');
    
    client.release();
    process.exit(0);
  } catch (err) {
    console.error('Migration failed:', err);
    process.exit(1);
  }
}

runMigration();