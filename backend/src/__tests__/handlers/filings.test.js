'use strict';

jest.mock('../../db/client', () => ({ query: jest.fn() }));
jest.mock('../../utils/auth', () => ({
  getClaims:   jest.fn(),
  isAdmin:     jest.fn(),
  resolveUser: jest.fn(),
}));

const { query }                        = require('../../db/client');
const { getClaims, isAdmin, resolveUser } = require('../../utils/auth');
const filings                          = require('../../handlers/filings');
const { makeEvent, adminUser, regularUser, mockFiling, mockCompleteFiling } = require('../helpers');

beforeEach(() => {
  jest.clearAllMocks();
  getClaims.mockReturnValue({});
  isAdmin.mockReturnValue(false);
  resolveUser.mockResolvedValue(regularUser);
});

function parsed(res) { return JSON.parse(res.body); }

// ── list ──────────────────────────────────────────────────────────────────────

describe('filings.list', () => {
  test('returns 401 when user not resolved', async () => {
    resolveUser.mockResolvedValue(null);
    const res = await filings.list(makeEvent());
    expect(res.statusCode).toBe(401);
  });

  test('regular user sees only their own filings', async () => {
    query.mockResolvedValueOnce({ rows: [mockFiling] });
    const res = await filings.list(makeEvent());
    expect(res.statusCode).toBe(200);
    expect(query).toHaveBeenCalledWith(
      expect.stringContaining('WHERE f.user_id = $1'),
      [regularUser.id],
    );
  });

  test('admin sees all filings', async () => {
    isAdmin.mockReturnValue(true);
    resolveUser.mockResolvedValue(adminUser);
    query.mockResolvedValueOnce({ rows: [mockFiling] });
    const res = await filings.list(makeEvent());
    expect(res.statusCode).toBe(200);
    expect(query).toHaveBeenCalledWith(expect.not.stringContaining('WHERE f.user_id'));
  });

  test('returns 500 on DB error', async () => {
    query.mockRejectedValueOnce(new Error('db down'));
    const spy = jest.spyOn(console, 'error').mockImplementation(() => {});
    const res = await filings.list(makeEvent());
    expect(res.statusCode).toBe(500);
    spy.mockRestore();
  });
});

// ── get ───────────────────────────────────────────────────────────────────────

describe('filings.get', () => {
  test('returns 401 when not authenticated', async () => {
    resolveUser.mockResolvedValue(null);
    const res = await filings.get(makeEvent({ params: { id: 'filing-uuid' } }));
    expect(res.statusCode).toBe(401);
  });

  test('returns 404 when filing not found', async () => {
    query.mockResolvedValueOnce({ rows: [] });
    const res = await filings.get(makeEvent({ params: { id: 'missing' } }));
    expect(res.statusCode).toBe(404);
  });

  test('returns 403 when user does not own the filing', async () => {
    query.mockResolvedValueOnce({ rows: [{ ...mockFiling, user_id: 'other-user' }] });
    const res = await filings.get(makeEvent({ params: { id: 'filing-uuid' } }));
    expect(res.statusCode).toBe(403);
  });

  test('returns filing with series for the owner', async () => {
    query.mockResolvedValueOnce({ rows: [mockFiling] });
    query.mockResolvedValueOnce({ rows: [{ id: 'series-1' }] });
    const res = await filings.get(makeEvent({ params: { id: 'filing-uuid' } }));
    expect(res.statusCode).toBe(200);
    expect(parsed(res).series).toHaveLength(1);
  });

  test('admin can view any filing', async () => {
    isAdmin.mockReturnValue(true);
    resolveUser.mockResolvedValue(adminUser);
    query.mockResolvedValueOnce({ rows: [{ ...mockFiling, user_id: 'other-user' }] });
    query.mockResolvedValueOnce({ rows: [] });
    const res = await filings.get(makeEvent({ params: { id: 'filing-uuid' } }));
    expect(res.statusCode).toBe(200);
  });
});

// ── create ────────────────────────────────────────────────────────────────────

describe('filings.create', () => {
  test('returns 401 when not authenticated', async () => {
    resolveUser.mockResolvedValue(null);
    const res = await filings.create(makeEvent({ body: {} }));
    expect(res.statusCode).toBe(401);
  });

  test('creates filing with defaults (RMIC/NPX)', async () => {
    query.mockResolvedValueOnce({ rows: [mockFiling] });
    const res = await filings.create(makeEvent({ body: {} }));
    expect(res.statusCode).toBe(201);
    expect(query).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO npx_filings'),
      [regularUser.id, 'RMIC', 'NPX'],
    );
  });

  test('creates IM filing when specified', async () => {
    query.mockResolvedValueOnce({ rows: [{ ...mockFiling, filer_type: 'IM' }] });
    const res = await filings.create(makeEvent({ body: { filer_type: 'IM' } }));
    expect(res.statusCode).toBe(201);
  });

  test('returns 400 for invalid filer_type', async () => {
    const res = await filings.create(makeEvent({ body: { filer_type: 'INVALID' } }));
    expect(res.statusCode).toBe(400);
    expect(parsed(res).message).toMatch(/filer_type/);
  });

  test('returns 400 for invalid report_type', async () => {
    const res = await filings.create(makeEvent({ body: { report_type: 'BAD' } }));
    expect(res.statusCode).toBe(400);
    expect(parsed(res).message).toMatch(/report_type/);
  });
});

// ── update ────────────────────────────────────────────────────────────────────

describe('filings.update', () => {
  test('returns 401 when not authenticated', async () => {
    resolveUser.mockResolvedValue(null);
    const res = await filings.update(makeEvent({ params: { id: 'filing-uuid' }, body: {} }));
    expect(res.statusCode).toBe(401);
  });

  test('returns 404 when filing not found', async () => {
    query.mockResolvedValueOnce({ rows: [] });
    const res = await filings.update(makeEvent({ params: { id: 'missing' }, body: { filer_name: 'X' } }));
    expect(res.statusCode).toBe(404);
  });

  test('returns 403 when user does not own the filing', async () => {
    query.mockResolvedValueOnce({ rows: [{ ...mockFiling, user_id: 'other-user' }] });
    const res = await filings.update(makeEvent({ params: { id: 'filing-uuid' }, body: { filer_name: 'X' } }));
    expect(res.statusCode).toBe(403);
  });

  test('returns 400 when filing is complete', async () => {
    query.mockResolvedValueOnce({ rows: [mockCompleteFiling] });
    const res = await filings.update(makeEvent({ params: { id: 'filing-uuid' }, body: { filer_name: 'X' } }));
    expect(res.statusCode).toBe(400);
  });

  test('returns 400 when no updatable fields provided', async () => {
    query.mockResolvedValueOnce({ rows: [mockFiling] });
    const res = await filings.update(makeEvent({ params: { id: 'filing-uuid' }, body: { unknown_field: 'x' } }));
    expect(res.statusCode).toBe(400);
    expect(parsed(res).message).toMatch(/No updatable/);
  });

  test('updates whitelisted fields successfully', async () => {
    query.mockResolvedValueOnce({ rows: [mockFiling] });
    query.mockResolvedValueOnce({ rows: [{ ...mockFiling, filer_name: 'New Name' }] });
    const res = await filings.update(makeEvent({ params: { id: 'filing-uuid' }, body: { filer_name: 'New Name' } }));
    expect(res.statusCode).toBe(200);
    expect(parsed(res).filer_name).toBe('New Name');
  });

  test('converts empty string fields to null', async () => {
    query.mockResolvedValueOnce({ rows: [mockFiling] });
    query.mockResolvedValueOnce({ rows: [{ ...mockFiling, filer_street2: null }] });
    await filings.update(makeEvent({ params: { id: 'filing-uuid' }, body: { filer_street2: '' } }));
    expect(query).toHaveBeenLastCalledWith(
      expect.stringContaining('UPDATE npx_filings'),
      expect.arrayContaining([null]),
    );
  });
});

// ── remove ────────────────────────────────────────────────────────────────────

describe('filings.remove', () => {
  test('returns 401 when not authenticated', async () => {
    resolveUser.mockResolvedValue(null);
    const res = await filings.remove(makeEvent({ params: { id: 'filing-uuid' } }));
    expect(res.statusCode).toBe(401);
  });

  test('returns 404 when filing not found', async () => {
    query.mockResolvedValueOnce({ rows: [] });
    const res = await filings.remove(makeEvent({ params: { id: 'missing' } }));
    expect(res.statusCode).toBe(404);
  });

  test('returns 403 when user does not own the filing', async () => {
    query.mockResolvedValueOnce({ rows: [{ ...mockFiling, user_id: 'other-user' }] });
    const res = await filings.remove(makeEvent({ params: { id: 'filing-uuid' } }));
    expect(res.statusCode).toBe(403);
  });

  test('deletes filing and returns 204', async () => {
    query.mockResolvedValueOnce({ rows: [mockFiling] });
    query.mockResolvedValueOnce({ rows: [] });
    const res = await filings.remove(makeEvent({ params: { id: 'filing-uuid' } }));
    expect(res.statusCode).toBe(204);
    expect(query).toHaveBeenLastCalledWith('DELETE FROM npx_filings WHERE id = $1', ['filing-uuid']);
  });
});

// ── setStatus ─────────────────────────────────────────────────────────────────

describe('filings.setStatus', () => {
  test('returns 401 when not authenticated', async () => {
    resolveUser.mockResolvedValue(null);
    const res = await filings.setStatus(makeEvent({ params: { id: 'filing-uuid' }, body: { status: 'complete' } }));
    expect(res.statusCode).toBe(401);
  });

  test('returns 404 when filing not found', async () => {
    query.mockResolvedValueOnce({ rows: [] });
    const res = await filings.setStatus(makeEvent({ params: { id: 'missing' }, body: { status: 'complete' } }));
    expect(res.statusCode).toBe(404);
  });

  test('returns 400 for invalid status value', async () => {
    query.mockResolvedValueOnce({ rows: [mockFiling] });
    const res = await filings.setStatus(makeEvent({ params: { id: 'filing-uuid' }, body: { status: 'pending' } }));
    expect(res.statusCode).toBe(400);
  });

  test('returns 400 when required fields are missing for complete', async () => {
    const incomplete = { ...mockFiling, filer_name: null };
    query.mockResolvedValueOnce({ rows: [incomplete] });
    const res = await filings.setStatus(makeEvent({ params: { id: 'filing-uuid' }, body: { status: 'complete' } }));
    expect(res.statusCode).toBe(400);
    expect(parsed(res).message).toMatch(/filer_name/);
  });

  test('transitions to complete when all required fields present', async () => {
    query.mockResolvedValueOnce({ rows: [mockFiling] });
    query.mockResolvedValueOnce({ rows: [{ ...mockFiling, status: 'complete' }] });
    const res = await filings.setStatus(makeEvent({ params: { id: 'filing-uuid' }, body: { status: 'complete' } }));
    expect(res.statusCode).toBe(200);
    expect(parsed(res).status).toBe('complete');
  });

  test('transitions back to draft without validation', async () => {
    query.mockResolvedValueOnce({ rows: [mockCompleteFiling] });
    query.mockResolvedValueOnce({ rows: [{ ...mockCompleteFiling, status: 'draft' }] });
    const res = await filings.setStatus(makeEvent({ params: { id: 'filing-uuid' }, body: { status: 'draft' } }));
    expect(res.statusCode).toBe(200);
    expect(parsed(res).status).toBe('draft');
  });
});
