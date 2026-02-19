'use strict';

const { query } = require('../db/client');
const { isAdmin } = require('./auth');
const R = require('./response');

/**
 * Verify the caller owns (or is admin of) the parent filing.
 * @param {string} filingId - Filing UUID
 * @param {object} user - Resolved user object
 * @param {object} claims - JWT/Cognito claims
 * @returns {Promise<{filing?: object, error?: object}>}
 */
async function getParentFiling(filingId, user, claims) {
  const result = await query('SELECT * FROM npx_filings WHERE id = $1', [filingId]);
  const filing = result.rows[0];
  if (!filing) return { error: R.notFound('Filing not found') };
  if (filing.user_id !== user.id && !isAdmin(claims)) return { error: R.forbidden() };
  return { filing };
}

module.exports = { getParentFiling };
