'use strict';

jest.mock('../../db/client', () => ({ query: jest.fn() }));
jest.mock('../../utils/auth', () => ({
  getClaims:   jest.fn(),
  isAdmin:     jest.fn(),
  resolveUser: jest.fn(),
}));

const { query }                           = require('../../db/client');
const { getClaims, isAdmin, resolveUser } = require('../../utils/auth');
const users                               = require('../../handlers/users');
const { makeEvent, adminUser, regularUser } = require('../helpers');

// Force local mode for all user handler tests (no Cognito calls)
const originalEnv = process.env.NODE_ENV;
beforeAll(() => { process.env.NODE_ENV = 'local'; });
afterAll(() => { process.env.NODE_ENV = originalEnv; });

beforeEach(() => {
  jest.clearAllMocks();
  getClaims.mockReturnValue({});
  isAdmin.mockReturnValue(true);
  resolveUser.mockResolvedValue(adminUser);
});

function parsed(res) { return JSON.parse(res.body); }

const mockUser = { id: 'other-uuid', email: 'other@test.com', role: 'user', is_active: true };

// ── create ────────────────────────────────────────────────────────────────────

describe('users.create', () => {
  test('returns 403 when caller is not admin', async () => {
    isAdmin.mockReturnValue(false);
    const res = await users.create(makeEvent({ body: { email: 'a@b.com', password: 'pass' } }));
    expect(res.statusCode).toBe(403);
  });

  test('returns 401 when admin user cannot be resolved', async () => {
    resolveUser.mockResolvedValue(null);
    const res = await users.create(makeEvent({ body: { email: 'a@b.com', password: 'pass' } }));
    expect(res.statusCode).toBe(401);
  });

  test('returns 400 when email is missing', async () => {
    const res = await users.create(makeEvent({ body: { password: 'pass123' } }));
    expect(res.statusCode).toBe(400);
    expect(parsed(res).message).toMatch(/email/);
  });

  test('returns 400 when password is missing', async () => {
    const res = await users.create(makeEvent({ body: { email: 'a@b.com' } }));
    expect(res.statusCode).toBe(400);
  });

  test('returns 400 for invalid role', async () => {
    const res = await users.create(makeEvent({ body: { email: 'a@b.com', password: 'p', role: 'superuser' } }));
    expect(res.statusCode).toBe(400);
    expect(parsed(res).message).toMatch(/role/);
  });

  test('returns 400 when email already registered', async () => {
    query.mockResolvedValueOnce({ rows: [mockUser] }); // existing check
    const res = await users.create(makeEvent({ body: { email: 'other@test.com', password: 'pass' } }));
    expect(res.statusCode).toBe(400);
    expect(parsed(res).message).toMatch(/already registered/);
  });

  test('creates user with bcrypt hash and returns 201', async () => {
    query.mockResolvedValueOnce({ rows: [] });     // no existing user
    query.mockResolvedValueOnce({ rows: [{ id: 'new-uuid', email: 'new@test.com', role: 'user' }] }); // insert
    const res = await users.create(makeEvent({ body: { email: 'new@test.com', password: 'SecurePass1' } }));
    expect(res.statusCode).toBe(201);
    expect(parsed(res).email).toBe('new@test.com');
  });

  test('defaults role to user when not specified', async () => {
    query.mockResolvedValueOnce({ rows: [] });
    query.mockResolvedValueOnce({ rows: [{ id: 'new-uuid', email: 'new@test.com', role: 'user' }] });
    await users.create(makeEvent({ body: { email: 'new@test.com', password: 'pass' } }));
    expect(query).toHaveBeenLastCalledWith(
      expect.stringContaining('INSERT INTO users'),
      expect.arrayContaining(['user']),
    );
  });
});

// ── list ──────────────────────────────────────────────────────────────────────

describe('users.list', () => {
  test('returns 403 when caller is not admin', async () => {
    isAdmin.mockReturnValue(false);
    const res = await users.list(makeEvent());
    expect(res.statusCode).toBe(403);
  });

  test('returns list of all users with filing counts', async () => {
    query.mockResolvedValueOnce({ rows: [mockUser, adminUser] });
    const res = await users.list(makeEvent());
    expect(res.statusCode).toBe(200);
    expect(parsed(res)).toHaveLength(2);
  });

  test('returns 500 on DB error', async () => {
    query.mockRejectedValueOnce(new Error('db error'));
    const spy = jest.spyOn(console, 'error').mockImplementation(() => {});
    const res = await users.list(makeEvent());
    expect(res.statusCode).toBe(500);
    spy.mockRestore();
  });
});

// ── getOne ────────────────────────────────────────────────────────────────────

describe('users.getOne', () => {
  test('returns 403 when caller is not admin', async () => {
    isAdmin.mockReturnValue(false);
    const res = await users.getOne(makeEvent({ params: { id: 'other-uuid' } }));
    expect(res.statusCode).toBe(403);
  });

  test('returns 404 when user not found', async () => {
    query.mockResolvedValueOnce({ rows: [] });
    const res = await users.getOne(makeEvent({ params: { id: 'missing' } }));
    expect(res.statusCode).toBe(404);
  });

  test('returns user when found', async () => {
    query.mockResolvedValueOnce({ rows: [mockUser] });
    const res = await users.getOne(makeEvent({ params: { id: 'other-uuid' } }));
    expect(res.statusCode).toBe(200);
    expect(parsed(res).email).toBe('other@test.com');
  });
});

// ── update ────────────────────────────────────────────────────────────────────

describe('users.update', () => {
  test('returns 403 when caller is not admin', async () => {
    isAdmin.mockReturnValue(false);
    const res = await users.update(makeEvent({ params: { id: 'other-uuid' }, body: {} }));
    expect(res.statusCode).toBe(403);
  });

  test('returns 400 when admin tries to deactivate themselves', async () => {
    const res = await users.update(makeEvent({ params: { id: adminUser.id }, body: { is_active: false } }));
    expect(res.statusCode).toBe(400);
    expect(parsed(res).message).toMatch(/deactivate/);
  });

  test('returns 400 for invalid role', async () => {
    const res = await users.update(makeEvent({ params: { id: 'other-uuid' }, body: { role: 'superuser' } }));
    expect(res.statusCode).toBe(400);
  });

  test('returns 404 when user not found', async () => {
    query.mockResolvedValueOnce({ rows: [] });
    const res = await users.update(makeEvent({ params: { id: 'missing' }, body: { first_name: 'New' } }));
    expect(res.statusCode).toBe(404);
  });

  test('updates user fields and returns 200', async () => {
    query.mockResolvedValueOnce({ rows: [{ ...mockUser, first_name: 'Updated' }] });
    const res = await users.update(makeEvent({ params: { id: 'other-uuid' }, body: { first_name: 'Updated' } }));
    expect(res.statusCode).toBe(200);
  });
});

// ── remove ────────────────────────────────────────────────────────────────────

describe('users.remove', () => {
  test('returns 403 when caller is not admin', async () => {
    isAdmin.mockReturnValue(false);
    const res = await users.remove(makeEvent({ params: { id: 'other-uuid' } }));
    expect(res.statusCode).toBe(403);
  });

  test('returns 400 when admin tries to delete themselves', async () => {
    const res = await users.remove(makeEvent({ params: { id: adminUser.id } }));
    expect(res.statusCode).toBe(400);
    expect(parsed(res).message).toMatch(/delete your own/);
  });

  test('returns 404 when user not found', async () => {
    query.mockResolvedValueOnce({ rows: [] });
    const res = await users.remove(makeEvent({ params: { id: 'missing' } }));
    expect(res.statusCode).toBe(404);
  });

  test('deletes user and returns 204', async () => {
    query.mockResolvedValueOnce({ rows: [{ id: 'other-uuid' }] });
    const res = await users.remove(makeEvent({ params: { id: 'other-uuid' } }));
    expect(res.statusCode).toBe(204);
    expect(query).toHaveBeenLastCalledWith('DELETE FROM users WHERE id = $1 RETURNING id', ['other-uuid']);
  });
});
