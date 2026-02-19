'use strict';

const R = require('../utils/response');

/**
 * Returns Cognito config to the frontend so we don't have to bake IDs
 * into the static JS bundle at build time.
 * This endpoint is unauthenticated by design.
 */
exports.handler = async () => {
  return R.ok({
    userPoolId:   process.env.COGNITO_USER_POOL_ID,
    clientId:     process.env.COGNITO_CLIENT_ID,
    region:       process.env.COGNITO_REGION || 'us-east-1',
  });
};
