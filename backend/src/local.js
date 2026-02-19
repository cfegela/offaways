'use strict';

require('dotenv').config({ path: '.env.local' });

const express = require('express');
const cors    = require('cors');
const jwt     = require('jsonwebtoken');

const filingsHandler = require('./handlers/filings');
const usersHandler       = require('./handlers/users');
const authHandler        = require('./handlers/auth');
const { getPool }        = require('./db/client');

const app = express();
app.use(express.json());
app.use(cors({
  origin:      process.env.CORS_ORIGIN || 'http://localhost:8080',
  credentials: true,
}));

// ── Lambda event adapter ──────────────────────────────────────────────────────

function createEvent(req, extraParams = {}) {
  return {
    httpMethod:          req.method,
    path:                req.path,
    pathParameters:      { ...req.params, ...extraParams },
    queryStringParameters: req.query || {},
    headers:             req.headers,
    body:                req.body ? JSON.stringify(req.body) : null,
    requestContext: {
      authorizer: {
        claims: req.claims || {},
      },
    },
  };
}

function sendResponse(res, result) {
  const headers = result.headers || {};
  Object.entries(headers).forEach(([k, v]) => res.set(k, v));
  res.status(result.statusCode);
  if (result.body) {
    res.send(result.body);
  } else {
    res.end();
  }
}

// ── Auth middleware (local JWT) ───────────────────────────────────────────────

function localAuth(req, res, next) {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) {
    return res.status(401).json({ message: 'Unauthorized' });
  }
  try {
    req.claims = jwt.verify(header.replace('Bearer ', ''), process.env.JWT_SECRET);
    next();
  } catch {
    return res.status(401).json({ message: 'Invalid or expired token' });
  }
}

// ── Routes ────────────────────────────────────────────────────────────────────

// Health
app.get('/health', (req, res) => res.json({ status: 'ok', env: 'local' }));

// Auth (local dev only)
app.post('/auth/login', async (req, res) => {
  sendResponse(res, await authHandler.login(createEvent(req)));
});

// Filings
app.get('/filings',     localAuth, async (req, res) => {
  sendResponse(res, await filingsHandler.list(createEvent(req)));
});
app.post('/filings',    localAuth, async (req, res) => {
  sendResponse(res, await filingsHandler.create(createEvent(req)));
});
app.get('/filings/:id', localAuth, async (req, res) => {
  sendResponse(res, await filingsHandler.get(createEvent(req)));
});
app.put('/filings/:id', localAuth, async (req, res) => {
  sendResponse(res, await filingsHandler.update(createEvent(req)));
});
app.delete('/filings/:id', localAuth, async (req, res) => {
  sendResponse(res, await filingsHandler.remove(createEvent(req)));
});

// Admin — users
app.post('/admin/users',            localAuth, async (req, res) => {
  sendResponse(res, await usersHandler.create(createEvent(req)));
});
app.get('/admin/users',             localAuth, async (req, res) => {
  sendResponse(res, await usersHandler.list(createEvent(req)));
});
app.get('/admin/users/:id',         localAuth, async (req, res) => {
  sendResponse(res, await usersHandler.getOne(createEvent(req)));
});
app.put('/admin/users/:id',         localAuth, async (req, res) => {
  sendResponse(res, await usersHandler.update(createEvent(req)));
});
app.delete('/admin/users/:id',      localAuth, async (req, res) => {
  sendResponse(res, await usersHandler.remove(createEvent(req)));
});

// ── Start ─────────────────────────────────────────────────────────────────────

const PORT = process.env.PORT || 3000;

async function start() {
  // Verify DB connectivity on startup
  try {
    await getPool().query('SELECT 1');
    console.log('✓ Database connected');
  } catch (err) {
    console.error('✗ Database connection failed:', err.message);
    process.exit(1);
  }

  app.listen(PORT, () => {
    console.log(`✓ Local API server running on http://localhost:${PORT}`);
  });
}

start().catch(console.error);
