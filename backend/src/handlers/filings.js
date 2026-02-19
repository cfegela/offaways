'use strict';

const { query }                   = require('../db/client');
const { getClaims, isAdmin, resolveUser } = require('../utils/auth');
const R                           = require('../utils/response');

// ── List ──────────────────────────────────────────────────────────────────────

exports.list = async (event) => {
  try {
    const claims = getClaims(event);
    const user   = await resolveUser(claims);
    if (!user) return R.unauthorized();

    let result;
    if (isAdmin(claims)) {
      result = await query(
        `SELECT s.*, u.email AS user_email, u.first_name AS user_first_name, u.last_name AS user_last_name
         FROM filings s
         JOIN users u ON u.id = s.user_id
         ORDER BY s.created_at DESC`,
      );
    } else {
      result = await query(
        `SELECT * FROM filings WHERE user_id = $1 ORDER BY created_at DESC`,
        [user.id],
      );
    }

    return R.ok(result.rows);
  } catch (err) {
    return R.serverError(err);
  }
};

// ── Get one ───────────────────────────────────────────────────────────────────

exports.get = async (event) => {
  try {
    const claims = getClaims(event);
    const user   = await resolveUser(claims);
    if (!user) return R.unauthorized();

    const { id } = event.pathParameters || {};
    const result = await query('SELECT * FROM filings WHERE id = $1', [id]);
    const row    = result.rows[0];

    if (!row) return R.notFound('Filing not found');
    if (row.user_id !== user.id && !isAdmin(claims)) return R.forbidden();

    return R.ok(row);
  } catch (err) {
    return R.serverError(err);
  }
};

// ── Create ────────────────────────────────────────────────────────────────────

exports.create = async (event) => {
  try {
    const claims = getClaims(event);
    const user   = await resolveUser(claims);
    if (!user) return R.unauthorized();

    const body = JSON.parse(event.body || '{}');
    const { first_name, last_name, street_address, city, state, zip_code, country, annual_salary } = body;

    if (!first_name || !last_name || !street_address || !city || !state || !zip_code || annual_salary == null) {
      return R.badRequest('All fields are required: first_name, last_name, street_address, city, state, zip_code, annual_salary');
    }

    if (isNaN(parseFloat(annual_salary)) || parseFloat(annual_salary) < 0) {
      return R.badRequest('annual_salary must be a non-negative number');
    }

    const result = await query(
      `INSERT INTO filings (user_id, first_name, last_name, street_address, city, state, zip_code, country, annual_salary)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       RETURNING *`,
      [user.id, first_name, last_name, street_address, city, state, zip_code, country || 'US', annual_salary],
    );

    return R.created(result.rows[0]);
  } catch (err) {
    return R.serverError(err);
  }
};

// ── Update ────────────────────────────────────────────────────────────────────

exports.update = async (event) => {
  try {
    const claims = getClaims(event);
    const user   = await resolveUser(claims);
    if (!user) return R.unauthorized();

    const { id } = event.pathParameters || {};
    const existing = await query('SELECT * FROM filings WHERE id = $1', [id]);
    const row      = existing.rows[0];

    if (!row) return R.notFound('Filing not found');
    if (row.user_id !== user.id && !isAdmin(claims)) return R.forbidden();

    const body = JSON.parse(event.body || '{}');
    const { first_name, last_name, street_address, city, state, zip_code, country, annual_salary } = body;

    const result = await query(
      `UPDATE filings
       SET first_name     = COALESCE($1, first_name),
           last_name      = COALESCE($2, last_name),
           street_address = COALESCE($3, street_address),
           city           = COALESCE($4, city),
           state          = COALESCE($5, state),
           zip_code       = COALESCE($6, zip_code),
           country        = COALESCE($7, country),
           annual_salary  = COALESCE($8, annual_salary)
       WHERE id = $9
       RETURNING *`,
      [first_name, last_name, street_address, city, state, zip_code, country, annual_salary, id],
    );

    return R.ok(result.rows[0]);
  } catch (err) {
    return R.serverError(err);
  }
};

// ── Delete ────────────────────────────────────────────────────────────────────

exports.remove = async (event) => {
  try {
    const claims = getClaims(event);
    const user   = await resolveUser(claims);
    if (!user) return R.unauthorized();

    const { id } = event.pathParameters || {};
    const existing = await query('SELECT * FROM filings WHERE id = $1', [id]);
    const row      = existing.rows[0];

    if (!row) return R.notFound('Filing not found');
    if (row.user_id !== user.id && !isAdmin(claims)) return R.forbidden();

    await query('DELETE FROM filings WHERE id = $1', [id]);
    return R.noContent();
  } catch (err) {
    return R.serverError(err);
  }
};
