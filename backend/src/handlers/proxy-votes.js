'use strict';

const { query, getPool }          = require('../db/client');
const { getClaims, resolveUser }  = require('../utils/auth');
const R                           = require('../utils/response');
const { parseProxyVoteCSV }       = require('../utils/csv-parser');
const { getParentFiling }         = require('../utils/filing-helpers');

// ── List (paginated) ───────────────────────────────────────────────────────────

exports.list = async (event) => {
  try {
    const claims = getClaims(event);
    const user   = await resolveUser(claims);
    if (!user) return R.unauthorized();

    const { id: filingId } = event.pathParameters || {};
    const { error } = await getParentFiling(filingId, user, claims);
    if (error) return error;

    const qs    = event.queryStringParameters || {};
    const page  = Math.max(1, parseInt(qs.page  || '1',  10));
    const limit = Math.min(200, Math.max(1, parseInt(qs.limit || '50', 10)));
    const offset = (page - 1) * limit;

    const countRes = await query(
      'SELECT COUNT(*) FROM npx_proxy_votes WHERE filing_id = $1',
      [filingId],
    );
    const total = parseInt(countRes.rows[0].count, 10);

    const votesRes = await query(
      `SELECT * FROM npx_proxy_votes
       WHERE filing_id = $1
       ORDER BY sort_order, created_at
       LIMIT $2 OFFSET $3`,
      [filingId, limit, offset],
    );

    const votes = votesRes.rows;

    // Attach vote records to each vote
    if (votes.length) {
      const voteIds = votes.map((v) => v.id);
      const recRes  = await query(
        `SELECT * FROM npx_vote_records
         WHERE proxy_vote_id = ANY($1::uuid[])
         ORDER BY proxy_vote_id, sort_order`,
        [voteIds],
      );
      const byVote = {};
      recRes.rows.forEach((r) => {
        (byVote[r.proxy_vote_id] = byVote[r.proxy_vote_id] || []).push(r);
      });
      votes.forEach((v) => { v.vote_records = byVote[v.id] || []; });
    }

    return R.ok({ total, page, limit, pages: Math.ceil(total / limit), votes });
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

    const { id: filingId } = event.pathParameters || {};
    const { filing, error } = await getParentFiling(filingId, user, claims);
    if (error) return error;

    if (filing.status === 'complete') {
      return R.badRequest('Cannot modify a completed filing. Return to draft first.');
    }

    const body = JSON.parse(event.body || '{}');
    const vote = await insertVote(filingId, body);
    return R.created(vote);
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

    const { id: filingId, voteId: id } = event.pathParameters || {};
    const { filing, error } = await getParentFiling(filingId, user, claims);
    if (error) return error;

    if (filing.status === 'complete') {
      return R.badRequest('Cannot modify a completed filing. Return to draft first.');
    }

    const existing = await query(
      'SELECT * FROM npx_proxy_votes WHERE id = $1 AND filing_id = $2',
      [id, filingId],
    );
    if (!existing.rows.length) return R.notFound('Vote not found');

    const body = JSON.parse(event.body || '{}');
    const vote = await updateVote(id, filingId, body);
    return R.ok(vote);
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

    const { id: filingId, voteId: id } = event.pathParameters || {};
    const { filing, error } = await getParentFiling(filingId, user, claims);
    if (error) return error;

    if (filing.status === 'complete') {
      return R.badRequest('Cannot modify a completed filing. Return to draft first.');
    }

    const existing = await query(
      'SELECT id FROM npx_proxy_votes WHERE id = $1 AND filing_id = $2',
      [id, filingId],
    );
    if (!existing.rows.length) return R.notFound('Vote not found');

    await query('DELETE FROM npx_proxy_votes WHERE id = $1', [id]);
    return R.noContent();
  } catch (err) {
    return R.serverError(err);
  }
};

// ── CSV Import ────────────────────────────────────────────────────────────────

exports.importCSV = async (event) => {
  try {
    const claims = getClaims(event);
    const user   = await resolveUser(claims);
    if (!user) return R.unauthorized();

    const { id: filingId } = event.pathParameters || {};
    const { filing, error } = await getParentFiling(filingId, user, claims);
    if (error) return error;

    if (filing.status === 'complete') {
      return R.badRequest('Cannot modify a completed filing. Return to draft first.');
    }

    const body = JSON.parse(event.body || '{}');
    if (!body.csv) return R.badRequest('Request body must include a "csv" field');

    let groups;
    try {
      groups = parseProxyVoteCSV(body.csv);
    } catch (parseErr) {
      return R.badRequest(`CSV parse error: ${parseErr.message}`);
    }

    const pool   = getPool();
    const client = await pool.connect();
    let inserted = 0;

    try {
      await client.query('BEGIN');
      for (const { vote, records } of groups) {
        const vRes = await client.query(
          `INSERT INTO npx_proxy_votes
             (filing_id, issuer_name, cusip, isin, figi, meeting_date, meeting_type,
              vote_description, vote_source, vote_category, shares_voted, shares_on_loan, sort_order)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
           RETURNING id`,
          [
            filingId,
            vote.issuer_name, vote.cusip, vote.isin, vote.figi,
            vote.meeting_date, vote.meeting_type,
            vote.vote_description, vote.vote_source, vote.vote_category,
            vote.shares_voted, vote.shares_on_loan, vote.sort_order,
          ],
        );
        const voteId = vRes.rows[0].id;
        for (const rec of records) {
          await client.query(
            `INSERT INTO npx_vote_records (proxy_vote_id, how_voted, mgmt_recommendation, shares, sort_order)
             VALUES ($1, $2, $3, $4, $5)`,
            [voteId, rec.how_voted, rec.mgmt_recommendation, rec.shares, rec.sort_order],
          );
        }
        inserted++;
      }
      await client.query('COMMIT');
    } catch (dbErr) {
      await client.query('ROLLBACK');
      throw dbErr;
    } finally {
      client.release();
    }

    return R.ok({ imported: inserted });
  } catch (err) {
    return R.serverError(err);
  }
};

// ── Clear all votes ───────────────────────────────────────────────────────────

exports.clearAll = async (event) => {
  try {
    const claims = getClaims(event);
    const user   = await resolveUser(claims);
    if (!user) return R.unauthorized();

    const { id: filingId } = event.pathParameters || {};
    const { filing, error } = await getParentFiling(filingId, user, claims);
    if (error) return error;

    if (filing.status === 'complete') {
      return R.badRequest('Cannot modify a completed filing. Return to draft first.');
    }

    const result = await query(
      'DELETE FROM npx_proxy_votes WHERE filing_id = $1',
      [filingId],
    );

    return R.ok({ deleted: result.rowCount });
  } catch (err) {
    return R.serverError(err);
  }
};

// ── Helpers ───────────────────────────────────────────────────────────────────

async function insertVote(filingId, body) {
  const pool   = getPool();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const vRes = await client.query(
      `INSERT INTO npx_proxy_votes
         (filing_id, series_id, issuer_name, cusip, isin, figi,
          meeting_date, meeting_type, vote_description, vote_source, vote_category,
          shares_voted, shares_on_loan, sort_order)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
       RETURNING *`,
      [
        filingId,
        body.series_id     || null,
        body.issuer_name   || null,
        body.cusip         || null,
        body.isin          || null,
        body.figi          || null,
        body.meeting_date  || null,
        body.meeting_type  || null,
        body.vote_description || null,
        body.vote_source   || null,
        body.vote_category || null,
        body.shares_voted  || null,
        body.shares_on_loan || null,
        body.sort_order    ?? 0,
      ],
    );

    const vote    = vRes.rows[0];
    const records = await insertRecords(client, vote.id, body.vote_records || []);
    vote.vote_records = records;

    await client.query('COMMIT');
    return vote;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

async function updateVote(id, filingId, body) {
  const pool   = getPool();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const vRes = await client.query(
      `UPDATE npx_proxy_votes
       SET series_id        = COALESCE($1,  series_id),
           issuer_name      = COALESCE($2,  issuer_name),
           cusip            = COALESCE($3,  cusip),
           isin             = COALESCE($4,  isin),
           figi             = COALESCE($5,  figi),
           meeting_date     = COALESCE($6,  meeting_date),
           meeting_type     = COALESCE($7,  meeting_type),
           vote_description = COALESCE($8,  vote_description),
           vote_source      = COALESCE($9,  vote_source),
           vote_category    = COALESCE($10, vote_category),
           shares_voted     = COALESCE($11, shares_voted),
           shares_on_loan   = COALESCE($12, shares_on_loan),
           sort_order       = COALESCE($13, sort_order)
       WHERE id = $14 AND filing_id = $15
       RETURNING *`,
      [
        body.series_id     || null,
        body.issuer_name   || null,
        body.cusip         || null,
        body.isin          || null,
        body.figi          || null,
        body.meeting_date  || null,
        body.meeting_type  || null,
        body.vote_description || null,
        body.vote_source   || null,
        body.vote_category || null,
        body.shares_voted  || null,
        body.shares_on_loan || null,
        body.sort_order    ?? null,
        id, filingId,
      ],
    );

    const vote = vRes.rows[0];

    if (Array.isArray(body.vote_records)) {
      await client.query('DELETE FROM npx_vote_records WHERE proxy_vote_id = $1', [id]);
      vote.vote_records = await insertRecords(client, id, body.vote_records);
    } else {
      const recRes = await client.query(
        'SELECT * FROM npx_vote_records WHERE proxy_vote_id = $1 ORDER BY sort_order',
        [id],
      );
      vote.vote_records = recRes.rows;
    }

    await client.query('COMMIT');
    return vote;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

async function insertRecords(client, voteId, records) {
  const inserted = [];
  for (let i = 0; i < records.length; i++) {
    const rec = records[i];
    const rRes = await client.query(
      `INSERT INTO npx_vote_records (proxy_vote_id, how_voted, mgmt_recommendation, shares, sort_order)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING *`,
      [voteId, rec.how_voted || null, rec.mgmt_recommendation || null, rec.shares || null, i],
    );
    inserted.push(rRes.rows[0]);
  }
  return inserted;
}
