/**
 * Runtime configuration.
 *
 * Local dev: auto-detected from hostname, hits the Express server directly.
 * Production: hits the API via the CloudFront /api/* path rule.
 *
 * Cognito values are fetched from /api/config at startup (see auth.js).
 * You do NOT need to edit this file for local dev.
 */

const IS_LOCAL = ['localhost', '127.0.0.1'].includes(window.location.hostname);

const CONFIG = {
  IS_LOCAL,

  // API base URL (no trailing slash)
  API_BASE_URL: IS_LOCAL
    ? 'http://localhost:3000'
    : '/api',

  // Filled by auth.js on init (prod only)
  COGNITO: {
    userPoolId: null,
    clientId:   null,
    region:     'us-east-1',
  },
};

window.CONFIG = CONFIG;
