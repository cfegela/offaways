'use strict';

const { query } = require('../db/client');

/**
 * Extract JWT claims from a Lambda event.
 *
 * Local:  The Express adapter populates event.requestContext.authorizer.claims
 *         from a locally-verified JWT (sub = our DB UUID).
 *
 * Prod:   API Gateway Cognito authorizer validates the token and populates
 *         event.requestContext.authorizer.claims (sub = Cognito UUID).
 */
function getClaims(event) {
  return event.requestContext?.authorizer?.claims || {};
}

/**
 * Check whether the caller is an admin.
 * Handles both local (role field) and Cognito (cognito:groups claim) formats.
 */
function isAdmin(claims) {
  // Local dev: role is a plain string on the JWT payload
  if (claims.role === 'admin') return true;

  // Cognito: API Gateway passes groups as a comma-separated string ("Admins")
  // or occasionally as a JSON-stringified array ('["Admins"]').
  const groups = claims['cognito:groups'];
  if (!groups) return false;
  if (typeof groups === 'string') {
    // Try JSON array first, then fall back to comma-separated
    try {
      const parsed = JSON.parse(groups);
      if (Array.isArray(parsed)) return parsed.includes('Admins');
    } catch { /* not JSON */ }
    return groups.split(',').map((g) => g.trim()).includes('Admins');
  }
  return Array.isArray(groups) && groups.includes('Admins');
}

/**
 * Resolve the database user from the event claims.
 *
 * Local:  claims.sub is the user's DB UUID — fetch directly.
 * Prod:   claims.sub is the Cognito UUID — upsert on first call.
 */
async function resolveUser(claims) {
  if (process.env.NODE_ENV === 'local') {
    const result = await query('SELECT * FROM users WHERE id = $1 AND is_active = true', [claims.sub]);
    return result.rows[0] || null;
  }

  // Production: upsert by cognito_sub
  const result = await query(
    `INSERT INTO users (cognito_sub, email, first_name, last_name, role)
     VALUES ($1, $2, $3, $4, 'user')
     ON CONFLICT (cognito_sub) DO UPDATE
       SET email      = EXCLUDED.email,
           updated_at = NOW()
     RETURNING *`,
    [
      claims.sub,
      claims.email || '',
      claims.given_name || '',
      claims.family_name || '',
    ],
  );
  return result.rows[0] || null;
}

module.exports = { getClaims, isAdmin, resolveUser };
