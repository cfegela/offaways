'use strict';

jest.mock('../../db/client', () => ({ query: jest.fn() }));

const { query } = require('../../db/client');
const { getClaims, isAdmin, resolveUser } = require('../../utils/auth');

afterEach(() => jest.clearAllMocks());

// ── getClaims ─────────────────────────────────────────────────────────────────

describe('getClaims', () => {
  test('extracts claims from requestContext', () => {
    const event = { requestContext: { authorizer: { claims: { sub: 'abc', email: 'a@b.com' } } } };
    expect(getClaims(event)).toEqual({ sub: 'abc', email: 'a@b.com' });
  });

  test('returns empty object when claims are missing', () => {
    expect(getClaims({})).toEqual({});
    expect(getClaims({ requestContext: {} })).toEqual({});
    expect(getClaims({ requestContext: { authorizer: {} } })).toEqual({});
  });
});

// ── isAdmin ───────────────────────────────────────────────────────────────────

describe('isAdmin', () => {
  test('returns true for local dev role=admin', () => {
    expect(isAdmin({ role: 'admin' })).toBe(true);
  });

  test('returns false for local dev role=user', () => {
    expect(isAdmin({ role: 'user' })).toBe(false);
  });

  test('returns false when role is missing', () => {
    expect(isAdmin({})).toBe(false);
  });

  test('returns true when cognito:groups is a plain string "Admins"', () => {
    expect(isAdmin({ 'cognito:groups': 'Admins' })).toBe(true);
  });

  test('returns false when cognito:groups is a plain string without Admins', () => {
    expect(isAdmin({ 'cognito:groups': 'Users' })).toBe(false);
  });

  test('returns true when cognito:groups is comma-separated and contains Admins', () => {
    expect(isAdmin({ 'cognito:groups': 'Users,Admins' })).toBe(true);
    expect(isAdmin({ 'cognito:groups': 'Admins,OtherGroup' })).toBe(true);
  });

  test('trims spaces in comma-separated groups', () => {
    expect(isAdmin({ 'cognito:groups': 'Users, Admins' })).toBe(true);
  });

  test('returns true when cognito:groups is a JSON-stringified array containing Admins', () => {
    expect(isAdmin({ 'cognito:groups': '["Admins"]' })).toBe(true);
    expect(isAdmin({ 'cognito:groups': '["Users","Admins"]' })).toBe(true);
  });

  test('returns false when JSON array does not contain Admins', () => {
    expect(isAdmin({ 'cognito:groups': '["Users"]' })).toBe(false);
  });

  test('returns true when cognito:groups is a real array containing Admins', () => {
    expect(isAdmin({ 'cognito:groups': ['Admins'] })).toBe(true);
  });

  test('returns false when cognito:groups is an empty array', () => {
    expect(isAdmin({ 'cognito:groups': [] })).toBe(false);
  });

  test('returns false when cognito:groups is absent', () => {
    expect(isAdmin({ sub: 'abc' })).toBe(false);
  });
});

// ── resolveUser ───────────────────────────────────────────────────────────────

describe('resolveUser', () => {
  const originalEnv = process.env.NODE_ENV;

  afterAll(() => { process.env.NODE_ENV = originalEnv; });

  describe('local mode (NODE_ENV=local)', () => {
    beforeEach(() => { process.env.NODE_ENV = 'local'; });

    test('returns user when found by sub', async () => {
      const user = { id: 'user-uuid', email: 'u@test.com', is_active: true };
      query.mockResolvedValueOnce({ rows: [user] });

      const result = await resolveUser({ sub: 'user-uuid' });

      expect(result).toEqual(user);
      expect(query).toHaveBeenCalledWith(
        expect.stringContaining('WHERE id = $1'),
        ['user-uuid'],
      );
    });

    test('returns null when user not found', async () => {
      query.mockResolvedValueOnce({ rows: [] });
      const result = await resolveUser({ sub: 'missing-uuid' });
      expect(result).toBeNull();
    });
  });

  describe('production mode (NODE_ENV=dev)', () => {
    beforeEach(() => { process.env.NODE_ENV = 'dev'; });
    afterEach(() => { process.env.NODE_ENV = 'local'; });

    test('upserts user by cognito_sub and returns row', async () => {
      const user = { id: 'db-uuid', cognito_sub: 'cog-uuid', email: 'u@test.com' };
      query.mockResolvedValueOnce({ rows: [user] });

      const result = await resolveUser({ sub: 'cog-uuid', email: 'u@test.com', given_name: 'A', family_name: 'B' });

      expect(result).toEqual(user);
      expect(query).toHaveBeenCalledWith(
        expect.stringContaining('ON CONFLICT (cognito_sub)'),
        ['cog-uuid', 'u@test.com', 'A', 'B'],
      );
    });

    test('returns null when upsert returns no rows', async () => {
      query.mockResolvedValueOnce({ rows: [] });
      const result = await resolveUser({ sub: 'cog-uuid' });
      expect(result).toBeNull();
    });

    test('uses empty strings when name claims are absent', async () => {
      const user = { id: 'db-uuid', cognito_sub: 'cog-uuid' };
      query.mockResolvedValueOnce({ rows: [user] });

      await resolveUser({ sub: 'cog-uuid' });

      expect(query).toHaveBeenCalledWith(
        expect.any(String),
        ['cog-uuid', '', '', ''],
      );
    });
  });
});
