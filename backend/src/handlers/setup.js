'use strict';

/**
 * One-shot database initializer.
 * Invoke once after first deploy to apply schema.sql.
 *
 * Usage (after `npx serverless deploy`):
 *   aws lambda invoke \
 *     --function-name offaways-dev-setupDb \
 *     --region us-east-1 \
 *     /tmp/setup-result.json && cat /tmp/setup-result.json
 *
 * Safe to invoke again — all statements use CREATE TABLE IF NOT EXISTS.
 */

const path = require('path');
const fs   = require('fs');
const { getPool } = require('../db/client');

exports.handler = async () => {
  try {
    const schemaPath = path.join(__dirname, '../db/schema.sql');
    const sql        = fs.readFileSync(schemaPath, 'utf8');
    const pool       = getPool();
    await pool.query(sql);
    console.log('Schema applied successfully.');
    return { statusCode: 200, body: JSON.stringify({ message: 'Schema applied successfully.' }) };
  } catch (err) {
    console.error('Schema setup failed:', err);
    return { statusCode: 500, body: JSON.stringify({ message: err.message }) };
  }
};
