'use strict';

const { query }                   = require('../db/client');
const { getClaims, isAdmin, resolveUser } = require('../utils/auth');
const R                           = require('../utils/response');

// ── Required fields for status=complete ───────────────────────────────────────

const REQUIRED_FOR_COMPLETE = [
  'filer_name', 'filer_street1', 'filer_city', 'filer_state', 'filer_zip',
  'signatory_name', 'signatory_title', 'signature_date',
  'period_start', 'period_end',
];

// ── List ──────────────────────────────────────────────────────────────────────

exports.list = async (event) => {
  try {
    const claims = getClaims(event);
    const user   = await resolveUser(claims);
    if (!user) return R.unauthorized();

    let result;
    if (isAdmin(claims)) {
      result = await query(
        `SELECT f.*,
                u.email AS user_email,
                u.first_name AS user_first_name,
                u.last_name  AS user_last_name,
                (SELECT COUNT(*) FROM npx_proxy_votes v WHERE v.filing_id = f.id) AS vote_count
         FROM npx_filings f
         JOIN users u ON u.id = f.user_id
         ORDER BY f.created_at DESC`,
      );
    } else {
      result = await query(
        `SELECT f.*,
                (SELECT COUNT(*) FROM npx_proxy_votes v WHERE v.filing_id = f.id) AS vote_count
         FROM npx_filings f
         WHERE f.user_id = $1
         ORDER BY f.created_at DESC`,
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
    const result = await query(
      `SELECT f.*,
              (SELECT COUNT(*) FROM npx_proxy_votes v WHERE v.filing_id = f.id) AS vote_count
       FROM npx_filings f WHERE f.id = $1`,
      [id],
    );
    const row = result.rows[0];

    if (!row) return R.notFound('Filing not found');
    if (row.user_id !== user.id && !isAdmin(claims)) return R.forbidden();

    // Attach series
    const seriesResult = await query(
      `SELECT * FROM npx_filing_series WHERE filing_id = $1 ORDER BY sort_order, created_at`,
      [id],
    );
    row.series = seriesResult.rows;

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

    const body       = JSON.parse(event.body || '{}');
    const filer_type = body.filer_type || 'RMIC';
    const report_type = body.report_type || 'NPX';

    if (!['RMIC', 'IM'].includes(filer_type)) {
      return R.badRequest('filer_type must be RMIC or IM');
    }
    if (!['NPX', 'NPX-A'].includes(report_type)) {
      return R.badRequest('report_type must be NPX or NPX-A');
    }

    const result = await query(
      `INSERT INTO npx_filings (user_id, filer_type, report_type)
       VALUES ($1, $2, $3)
       RETURNING *`,
      [user.id, filer_type, report_type],
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
    const existing = await query('SELECT * FROM npx_filings WHERE id = $1', [id]);
    const row      = existing.rows[0];

    if (!row) return R.notFound('Filing not found');
    if (row.user_id !== user.id && !isAdmin(claims)) return R.forbidden();
    if (row.status === 'complete') return R.badRequest('Cannot edit a completed filing. Return to draft first.');

    const body = JSON.parse(event.body || '{}');

    // Whitelist of updatable fields
    const fields = [
      'filer_type', 'report_type', 'period_start', 'period_end',
      'amendment_number', 'amendment_type',
      'filer_name', 'filer_cik', 'filer_lei', 'filer_crd',
      'filer_street1', 'filer_street2', 'filer_city', 'filer_state',
      'filer_zip', 'filer_country', 'filer_phone',
      'agent_name', 'agent_street1', 'agent_street2', 'agent_city',
      'agent_state', 'agent_zip', 'agent_country', 'agent_phone',
      'signatory_name', 'signatory_title', 'signature_date',
    ];

    const setClauses = [];
    const params     = [];
    let   paramIdx   = 1;

    for (const f of fields) {
      if (f in body) {
        setClauses.push(`${f} = $${paramIdx++}`);
        params.push(body[f] === '' ? null : body[f]);
      }
    }

    if (!setClauses.length) return R.badRequest('No updatable fields provided');

    params.push(id);
    const result = await query(
      `UPDATE npx_filings SET ${setClauses.join(', ')} WHERE id = $${paramIdx} RETURNING *`,
      params,
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
    const existing = await query('SELECT * FROM npx_filings WHERE id = $1', [id]);
    const row      = existing.rows[0];

    if (!row) return R.notFound('Filing not found');
    if (row.user_id !== user.id && !isAdmin(claims)) return R.forbidden();

    await query('DELETE FROM npx_filings WHERE id = $1', [id]);
    return R.noContent();
  } catch (err) {
    return R.serverError(err);
  }
};

// ── Status transition ─────────────────────────────────────────────────────────

exports.setStatus = async (event) => {
  try {
    const claims = getClaims(event);
    const user   = await resolveUser(claims);
    if (!user) return R.unauthorized();

    const { id } = event.pathParameters || {};
    const existing = await query('SELECT * FROM npx_filings WHERE id = $1', [id]);
    const row      = existing.rows[0];

    if (!row) return R.notFound('Filing not found');
    if (row.user_id !== user.id && !isAdmin(claims)) return R.forbidden();

    const body   = JSON.parse(event.body || '{}');
    const status = body.status;

    if (!['draft', 'complete'].includes(status)) {
      return R.badRequest('status must be draft or complete');
    }

    if (status === 'complete') {
      const missing = REQUIRED_FOR_COMPLETE.filter((f) => !row[f]);
      if (missing.length) {
        return R.badRequest(`Missing required fields: ${missing.join(', ')}`);
      }
    }

    const result = await query(
      'UPDATE npx_filings SET status = $1 WHERE id = $2 RETURNING *',
      [status, id],
    );

    return R.ok(result.rows[0]);
  } catch (err) {
    return R.serverError(err);
  }
};
