'use strict';

/**
 * Local-development auth handler.
 * NOT deployed to production — Cognito handles auth there.
 */

const bcrypt = require('bcryptjs');
const jwt    = require('jsonwebtoken');
const { query } = require('../db/client');
const R = require('../utils/response');

// ── Login ─────────────────────────────────────────────────────────────────────

exports.login = async (event) => {
  try {
    const { email, password } = JSON.parse(event.body || '{}');

    if (!email || !password) return R.badRequest('email and password are required');

    const result = await query(
      'SELECT * FROM users WHERE email = $1 AND is_active = true',
      [email],
    );
    const user = result.rows[0];

    if (!user || !user.password_hash) return R.unauthorized('Invalid credentials');

    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) return R.unauthorized('Invalid credentials');

    const token = signToken(user);
    return R.ok({ token, user: sanitize(user) });
  } catch (err) {
    return R.serverError(err);
  }
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function signToken(user) {
  return jwt.sign(
    {
      sub:              user.id,
      email:            user.email,
      role:             user.role,
      'cognito:groups': user.role === 'admin' ? ['Admins'] : [],
    },
    process.env.JWT_SECRET,
    { expiresIn: '8h' },
  );
}

function sanitize(user) {
  const { password_hash, ...safe } = user;
  return safe;
}
