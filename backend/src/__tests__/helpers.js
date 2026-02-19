'use strict';

/** Build a minimal Lambda-style event */
function makeEvent({ method = 'GET', params = {}, query = {}, body = null, claims = {} } = {}) {
  return {
    httpMethod: method,
    pathParameters: params,
    queryStringParameters: query,
    headers: {},
    body: body !== null ? JSON.stringify(body) : null,
    requestContext: { authorizer: { claims } },
  };
}

const adminClaims = { sub: 'admin-uuid', email: 'admin@test.com', role: 'admin' };
const userClaims  = { sub: 'user-uuid',  email: 'user@test.com',  role: 'user'  };

const adminUser = { id: 'admin-uuid', email: 'admin@test.com', role: 'admin', is_active: true };
const regularUser = { id: 'user-uuid', email: 'user@test.com', role: 'user',  is_active: true };

const mockFiling = {
  id: 'filing-uuid',
  user_id: 'user-uuid',
  status: 'draft',
  filer_type: 'RMIC',
  report_type: 'NPX',
  filer_name: 'Test Fund',
  filer_street1: '123 Main St',
  filer_city: 'New York',
  filer_state: 'NY',
  filer_zip: '10001',
  signatory_name: 'Jane Doe',
  signatory_title: 'CFO',
  signature_date: '2026-01-01',
  period_start: '2025-01-01',
  period_end: '2025-12-31',
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
};

const mockCompleteFiling = { ...mockFiling, status: 'complete' };

module.exports = {
  makeEvent,
  adminClaims,
  userClaims,
  adminUser,
  regularUser,
  mockFiling,
  mockCompleteFiling,
};
