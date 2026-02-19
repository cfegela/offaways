'use strict';

/**
 * Run the N-PX schema migration against local or remote DB.
 *
 * Usage:
 *   node backend/scripts/migrate-npx.js          # uses .env.local
 *   DATABASE_URL=postgres://... node backend/scripts/migrate-npx.js
 */

require('dotenv').config({ path: require('path').resolve(__dirname, '../.env.local') });

const fs   = require('fs');
const path = require('path');
const { Pool } = require('pg');

const sql = fs.readFileSync(
  path.resolve(__dirname, '../src/db/migrations/001-npx-schema.sql'),
  'utf8',
);

async function run() {
  const pool = new Pool(
    process.env.DATABASE_URL
      ? { connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } }
      : {
          host:     process.env.DB_HOST     || 'localhost',
          port:     parseInt(process.env.DB_PORT || '5432', 10),
          database: process.env.DB_NAME     || 'offaways',
          user:     process.env.DB_USER     || 'offaways',
          password: process.env.DB_PASSWORD || 'offaways',
        },
  );

  const client = await pool.connect();
  try {
    console.log('Running migration 001-npx-schema.sql …');
    await client.query(sql);
    console.log('✓ Migration complete');
  } finally {
    client.release();
    await pool.end();
  }
}

run().catch((err) => {
  console.error('✗ Migration failed:', err.message);
  process.exit(1);
});
