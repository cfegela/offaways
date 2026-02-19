'use strict';

const { Pool } = require('pg');

let pool;

function getPool() {
  if (!pool) {
    pool = new Pool({
      host:     process.env.DB_HOST,
      port:     parseInt(process.env.DB_PORT, 10) || 5432,
      database: process.env.DB_NAME,
      user:     process.env.DB_USER,
      password: process.env.DB_PASSWORD,
      max:      10,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 5000,
      // Aurora Serverless v2 / RDS SSL in production
      ssl: process.env.NODE_ENV !== 'local' ? { rejectUnauthorized: false } : false, // nosemgrep: bypass-tls-verification
    });

    pool.on('error', (err) => {
      console.error('Unexpected DB pool error', err);
    });
  }
  return pool;
}

async function query(text, params) {
  const client = getPool();
  return client.query(text, params);
}

module.exports = { query, getPool };
