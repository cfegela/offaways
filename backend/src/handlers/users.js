'use strict';

/**
 * Admin-only user management handlers.
 * In production these routes are additionally protected at the API Gateway
 * level by requiring the caller to be in the Cognito "Admins" group.
 */

const { query }                   = require('../db/client');
const { getClaims, isAdmin, resolveUser } = require('../utils/auth');
const R                           = require('../utils/response');

async function requireAdmin(event) {
  const claims = getClaims(event);
  if (!isAdmin(claims)) return { error: R.forbidden() };
  const user = await resolveUser(claims);
  if (!user) return { error: R.unauthorized() };
  return { claims, user };
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

    const result = await query('DELETE FROM users WHERE id = $1 RETURNING id', [id]);
    if (!result.rows.length) return R.notFound('User not found');

    return R.noContent();
  } catch (err) {
    return R.serverError(err);
  }
};

