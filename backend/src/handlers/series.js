'use strict';

const { query }                   = require('../db/client');
const { getClaims, isAdmin, resolveUser } = require('../utils/auth');
const R                           = require('../utils/response');

// Helper: verify the caller owns (or is admin of) the parent filing
async function getParentFiling(filingId, user, claims) {
  const result = await query('SELECT * FROM npx_filings WHERE id = $1', [filingId]);
  const filing = result.rows[0];
  if (!filing) return { error: R.notFound('Filing not found') };
  if (filing.user_id !== user.id && !isAdmin(claims)) return { error: R.forbidden() };
  return { filing };
}

// ── List ──────────────────────────────────────────────────────────────────────

exports.list = async (event) => {
  try {
    const claims = getClaims(event);
    const user   = await resolveUser(claims);
    if (!user) return R.unauthorized();

    const { filingId } = event.pathParameters || {};
    const { error } = await getParentFiling(filingId, user, claims);
    if (error) return error;

    const result = await query(
      'SELECT * FROM npx_filing_series WHERE filing_id = $1 ORDER BY sort_order, created_at',
      [filingId],
    );

    return R.ok(result.rows);
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

    const { filingId } = event.pathParameters || {};
    const { filing, error } = await getParentFiling(filingId, user, claims);
    if (error) return error;

    if (filing.status === 'complete') {
      return R.badRequest('Cannot modify a completed filing. Return to draft first.');
    }

    const body = JSON.parse(event.body || '{}');
    const { series_id, series_name, series_lei, sort_order } = body;

    const result = await query(
      `INSERT INTO npx_filing_series (filing_id, series_id, series_name, series_lei, sort_order)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING *`,
      [filingId, series_id || null, series_name || null, series_lei || null, sort_order ?? 0],
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

    const { filingId, id } = event.pathParameters || {};
    const { filing, error } = await getParentFiling(filingId, user, claims);
    if (error) return error;

    if (filing.status === 'complete') {
      return R.badRequest('Cannot modify a completed filing. Return to draft first.');
    }

    const existing = await query(
      'SELECT * FROM npx_filing_series WHERE id = $1 AND filing_id = $2',
      [id, filingId],
    );
    if (!existing.rows.length) return R.notFound('Series not found');

    const body = JSON.parse(event.body || '{}');
    const { series_id, series_name, series_lei, sort_order } = body;

    const result = await query(
      `UPDATE npx_filing_series
       SET series_id   = COALESCE($1, series_id),
           series_name = COALESCE($2, series_name),
           series_lei  = COALESCE($3, series_lei),
           sort_order  = COALESCE($4, sort_order)
       WHERE id = $5
       RETURNING *`,
      [series_id, series_name, series_lei, sort_order, id],
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

    const { filingId, id } = event.pathParameters || {};
    const { filing, error } = await getParentFiling(filingId, user, claims);
    if (error) return error;

    if (filing.status === 'complete') {
      return R.badRequest('Cannot modify a completed filing. Return to draft first.');
    }

    const existing = await query(
      'SELECT id FROM npx_filing_series WHERE id = $1 AND filing_id = $2',
      [id, filingId],
    );
    if (!existing.rows.length) return R.notFound('Series not found');

    await query('DELETE FROM npx_filing_series WHERE id = $1', [id]);
    return R.noContent();
  } catch (err) {
    return R.serverError(err);
  }
};
