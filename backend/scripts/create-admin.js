#!/usr/bin/env node
'use strict';

/**
 * Create or promote an admin user.
 *
 * Local dev:
 *   node scripts/create-admin.js <email> <password>
 *   (creates or promotes the user in the local postgres DB)
 *
 * Production (AWS):
 *   STAGE=dev node scripts/create-admin.js <email>
 *   (adds the user to the Cognito "Admins" group — user must exist in Cognito)
 */

require('dotenv').config({ path: '.env.local' });

const isLocal = process.env.NODE_ENV === 'local' || !process.env.STAGE;

async function runLocal(email, password) {
  const bcrypt = require('bcryptjs');
  const { getPool } = require('../src/db/client');
  const pool = getPool();

  const hash = await bcrypt.hash(password, 10);

  const result = await pool.query(
    `INSERT INTO users (email, password_hash, first_name, last_name, role)
     VALUES ($1, $2, 'Admin', 'User', 'admin')
     ON CONFLICT (email) DO UPDATE
       SET role          = 'admin',
           password_hash = EXCLUDED.password_hash
     RETURNING id, email, role`,
    [email, hash],
  );

  console.log('✓ Admin user ready:', result.rows[0]);
  process.exit(0);
}

async function runProd(email) {
  const { CognitoIdentityProviderClient, AdminAddUserToGroupCommand } = require('@aws-sdk/client-cognito-identity-provider');

  const userPoolId = process.env.COGNITO_USER_POOL_ID;
  if (!userPoolId) {
    console.error('Set COGNITO_USER_POOL_ID env var');
    process.exit(1);
  }

  const client = new CognitoIdentityProviderClient({ region: 'us-east-1' });
  await client.send(new AdminAddUserToGroupCommand({
    UserPoolId: userPoolId,
    Username:   email,
    GroupName:  'Admins',
  }));

  console.log(`✓ ${email} added to Cognito "Admins" group`);
  process.exit(0);
}

const [, , email, password] = process.argv;

if (!email) {
  console.error('Usage: node scripts/create-admin.js <email> [password]');
  process.exit(1);
}

if (isLocal) {
  if (!password) {
    console.error('Local mode requires a password: node scripts/create-admin.js <email> <password>');
    process.exit(1);
  }
  runLocal(email, password).catch((err) => { console.error(err); process.exit(1); });
} else {
  runProd(email).catch((err) => { console.error(err); process.exit(1); });
}
