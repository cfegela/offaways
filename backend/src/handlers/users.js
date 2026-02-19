'use strict';

/**
 * Admin-only user management handlers.
 *
 * Local dev: users are stored in the DB with a bcrypt password_hash.
 * Production: users are created in Cognito; the DB row is upserted on first
 *   login via resolveUser(). The create handler also pre-inserts the DB row
 *   so the user appears in the admin list immediately.
 */

const { query }                   = require('../db/client');
const { getClaims, isAdmin, resolveUser } = require('../utils/auth');
const R                           = require('../utils/response');

const IS_LOCAL = process.env.NODE_ENV === 'local';

async function requireAdmin(event) {
  const claims = getClaims(event);
  if (!isAdmin(claims)) return { error: R.forbidden() };
  const user = await resolveUser(claims);
  if (!user) return { error: R.unauthorized() };
  return { claims, user };
}

function getCognitoClient() {
  const { CognitoIdentityProviderClient } = require('@aws-sdk/client-cognito-identity-provider');
  return new CognitoIdentityProviderClient({ region: process.env.COGNITO_REGION });
}

// ── Create user (admin only) ──────────────────────────────────────────────────

exports.create = async (event) => {
  try {
    const { error } = await requireAdmin(event);
    if (error) return error;

    const { email, password, first_name, last_name, role } = JSON.parse(event.body || '{}');

    if (!email || !password) return R.badRequest('email and password are required');

    const allowed_roles = ['user', 'admin'];
    if (role && !allowed_roles.includes(role)) {
      return R.badRequest(`role must be one of: ${allowed_roles.join(', ')}`);
    }

    if (IS_LOCAL) {
      const existing = await query('SELECT id FROM users WHERE email = $1', [email]);
      if (existing.rows.length) return R.badRequest('Email already registered');

      const bcrypt = require('bcryptjs');
      const password_hash = await bcrypt.hash(password, 10);

      const result = await query(
        `INSERT INTO users (email, password_hash, first_name, last_name, role)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING id, email, first_name, last_name, role, is_active, created_at`,
        [email, password_hash, first_name || '', last_name || '', role || 'user'],
      );
      return R.created(result.rows[0]);
    }

    // ── Production: create in Cognito ────────────────────────────────────────
    const {
      AdminCreateUserCommand,
      AdminSetUserPasswordCommand,
      AdminAddUserToGroupCommand,
    } = require('@aws-sdk/client-cognito-identity-provider');

    const cognito     = getCognitoClient();
    const userPoolId  = process.env.COGNITO_USER_POOL_ID;

    let cognitoUser;
    try {
      const res = await cognito.send(new AdminCreateUserCommand({
        UserPoolId:    userPoolId,
        Username:      email,
        MessageAction: 'SUPPRESS',
        UserAttributes: [
          { Name: 'email',          Value: email },
          { Name: 'email_verified', Value: 'true' },
          ...(first_name ? [{ Name: 'given_name',   Value: first_name }] : []),
          ...(last_name  ? [{ Name: 'family_name',  Value: last_name  }] : []),
        ],
      }));
      cognitoUser = res.User;
    } catch (err) {
      if (err.name === 'UsernameExistsException') return R.badRequest('Email already registered');
      throw err;
    }

    await cognito.send(new AdminSetUserPasswordCommand({
      UserPoolId: userPoolId,
      Username:   email,
      Password:   password,
      Permanent:  true,
    }));

    if (role === 'admin') {
      await cognito.send(new AdminAddUserToGroupCommand({
        UserPoolId: userPoolId,
        Username:   email,
        GroupName:  'Admins',
      }));
    }

    // Pre-insert into DB so the user appears in the list before first login
    const cognitoSub = cognitoUser.Attributes.find((a) => a.Name === 'sub')?.Value;
    const result = await query(
      `INSERT INTO users (cognito_sub, email, first_name, last_name, role)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (cognito_sub) DO UPDATE
         SET email = EXCLUDED.email, updated_at = NOW()
       RETURNING id, email, first_name, last_name, role, is_active, created_at`,
      [cognitoSub, email, first_name || '', last_name || '', role || 'user'],
    );

    return R.created(result.rows[0]);
  } catch (err) {
    return R.serverError(err);
  }
};

// ── List all users ────────────────────────────────────────────────────────────

exports.list = async (event) => {
  try {
    const { error } = await requireAdmin(event);
    if (error) return error;

    const result = await query(
      `SELECT id, email, first_name, last_name, role, is_active, created_at, updated_at,
              (SELECT COUNT(*) FROM npx_filings s WHERE s.user_id = users.id) AS filing_count
       FROM users
       ORDER BY created_at DESC`,
    );

    return R.ok(result.rows);
  } catch (err) {
    return R.serverError(err);
  }
};

// ── Get one user ──────────────────────────────────────────────────────────────

exports.getOne = async (event) => {
  try {
    const { error } = await requireAdmin(event);
    if (error) return error;

    const { id } = event.pathParameters || {};
    const result = await query(
      `SELECT id, email, first_name, last_name, role, is_active, created_at, updated_at
       FROM users WHERE id = $1`,
      [id],
    );

    if (!result.rows.length) return R.notFound('User not found');
    return R.ok(result.rows[0]);
  } catch (err) {
    return R.serverError(err);
  }
};

// ── Update user ───────────────────────────────────────────────────────────────

exports.update = async (event) => {
  try {
    const { error, user: adminUser } = await requireAdmin(event);
    if (error) return error;

    const { id } = event.pathParameters || {};
    const { email, password, first_name, last_name, role, is_active } = JSON.parse(event.body || '{}');

    if (id === adminUser.id && is_active === false) {
      return R.badRequest('You cannot deactivate your own account');
    }

    const allowed_roles = ['user', 'admin'];
    if (role && !allowed_roles.includes(role)) {
      return R.badRequest(`role must be one of: ${allowed_roles.join(', ')}`);
    }

    let passwordClause = '';
    const params = [first_name, last_name, email, role, is_active, id];

    if (password) {
      const bcrypt = require('bcryptjs');
      const hash = await bcrypt.hash(password, 10);
      passwordClause = ', password_hash = $7';
      params.push(hash);
    }

    const result = await query(
      `UPDATE users
       SET first_name = COALESCE($1, first_name),
           last_name  = COALESCE($2, last_name),
           email      = COALESCE($3, email),
           role       = COALESCE($4, role),
           is_active  = COALESCE($5, is_active)
           ${passwordClause}
       WHERE id = $6
       RETURNING id, email, first_name, last_name, role, is_active, created_at, updated_at`,
      params,
    );

    if (!result.rows.length) return R.notFound('User not found');
    return R.ok(result.rows[0]);
  } catch (err) {
    return R.serverError(err);
  }
};

// ── Delete user ───────────────────────────────────────────────────────────────

exports.remove = async (event) => {
  try {
    const { error, user: adminUser } = await requireAdmin(event);
    if (error) return error;

    const { id } = event.pathParameters || {};

    if (id === adminUser.id) return R.badRequest('You cannot delete your own account');

    if (!IS_LOCAL) {
      // Production: remove from Cognito first
      const userRes = await query('SELECT email FROM users WHERE id = $1', [id]);
      if (!userRes.rows.length) return R.notFound('User not found');

      const { AdminDeleteUserCommand } = require('@aws-sdk/client-cognito-identity-provider');
      const cognito = getCognitoClient();
      try {
        await cognito.send(new AdminDeleteUserCommand({
          UserPoolId: process.env.COGNITO_USER_POOL_ID,
          Username:   userRes.rows[0].email,
        }));
      } catch (err) {
        if (err.name !== 'UserNotFoundException') throw err;
      }
    }

    const result = await query('DELETE FROM users WHERE id = $1 RETURNING id', [id]);
    if (!result.rows.length) return R.notFound('User not found');

    return R.noContent();
  } catch (err) {
    return R.serverError(err);
  }
};
