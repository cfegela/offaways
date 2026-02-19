'use strict';

jest.mock('../../db/client', () => ({ query: jest.fn() }));
jest.mock('../../utils/auth', () => ({
  getClaims:   jest.fn(),
  isAdmin:     jest.fn(),
  resolveUser: jest.fn(),
}));

const { query }                           = require('../../db/client');
const { getClaims, isAdmin, resolveUser } = require('../../utils/auth');
const series                              = require('../../handlers/series');
const { makeEvent, regularUser, adminUser, mockFiling, mockCompleteFiling } = require('../helpers');

beforeEach(() => {
  jest.clearAllMocks();
  getClaims.mockReturnValue({});
  isAdmin.mockReturnValue(false);
  resolveUser.mockResolvedValue(regularUser);
});

function parsed(res) { return JSON.parse(res.body); }

const mockSeries = { id: 'series-uuid', filing_id: 'filing-uuid', series_name: 'Fund A', sort_order: 0 };

// ── list ──────────────────────────────────────────────────────────────────────

describe('series.list', () => {
  test('returns 401 when not authenticated', async () => {
    resolveUser.mockResolvedValue(null);
    const res = await series.list(makeEvent({ params: { id: 'filing-uuid' } }));
    expect(res.statusCode).toBe(401);
  });

  test('returns 404 when parent filing not found', async () => {
    query.mockResolvedValueOnce({ rows: [] });
    const res = await series.list(makeEvent({ params: { id: 'missing' } }));
    expect(res.statusCode).toBe(404);
  });

  test('returns 403 when user does not own the filing', async () => {
    query.mockResolvedValueOnce({ rows: [{ ...mockFiling, user_id: 'other' }] });
    const res = await series.list(makeEvent({ params: { id: 'filing-uuid' } }));
    expect(res.statusCode).toBe(403);
  });

  test('returns series list for the filing owner', async () => {
    query.mockResolvedValueOnce({ rows: [mockFiling] });
    query.mockResolvedValueOnce({ rows: [mockSeries] });
    const res = await series.list(makeEvent({ params: { id: 'filing-uuid' } }));
    expect(res.statusCode).toBe(200);
    expect(parsed(res)).toHaveLength(1);
  });

  test('admin can list series for any filing', async () => {
    isAdmin.mockReturnValue(true);
    resolveUser.mockResolvedValue(adminUser);
    query.mockResolvedValueOnce({ rows: [{ ...mockFiling, user_id: 'other' }] });
    query.mockResolvedValueOnce({ rows: [] });
    const res = await series.list(makeEvent({ params: { id: 'filing-uuid' } }));
    expect(res.statusCode).toBe(200);
  });
});

// ── create ────────────────────────────────────────────────────────────────────

describe('series.create', () => {
  test('returns 401 when not authenticated', async () => {
    resolveUser.mockResolvedValue(null);
    const res = await series.create(makeEvent({ params: { id: 'filing-uuid' }, body: {} }));
    expect(res.statusCode).toBe(401);
  });

  test('returns 400 when filing is complete', async () => {
    query.mockResolvedValueOnce({ rows: [mockCompleteFiling] });
    const res = await series.create(makeEvent({ params: { id: 'filing-uuid' }, body: { series_name: 'X' } }));
    expect(res.statusCode).toBe(400);
    expect(parsed(res).message).toMatch(/completed/);
  });

  test('creates series and returns 201', async () => {
    query.mockResolvedValueOnce({ rows: [mockFiling] });
    query.mockResolvedValueOnce({ rows: [mockSeries] });
    const res = await series.create(makeEvent({ params: { id: 'filing-uuid' }, body: { series_name: 'Fund A' } }));
    expect(res.statusCode).toBe(201);
    expect(parsed(res).series_name).toBe('Fund A');
  });

  test('inserts with null for missing optional fields', async () => {
    query.mockResolvedValueOnce({ rows: [mockFiling] });
    query.mockResolvedValueOnce({ rows: [mockSeries] });
    await series.create(makeEvent({ params: { id: 'filing-uuid' }, body: {} }));
    expect(query).toHaveBeenLastCalledWith(
      expect.stringContaining('INSERT INTO npx_filing_series'),
      ['filing-uuid', null, null, null, 0],
    );
  });
});

// ── update ────────────────────────────────────────────────────────────────────

describe('series.update', () => {
  test('returns 401 when not authenticated', async () => {
    resolveUser.mockResolvedValue(null);
    const res = await series.update(makeEvent({ params: { id: 'filing-uuid', seriesId: 'series-uuid' }, body: {} }));
    expect(res.statusCode).toBe(401);
  });

  test('returns 400 when filing is complete', async () => {
    query.mockResolvedValueOnce({ rows: [mockCompleteFiling] });
    const res = await series.update(makeEvent({ params: { id: 'filing-uuid', seriesId: 'series-uuid' }, body: {} }));
    expect(res.statusCode).toBe(400);
  });

  test('returns 404 when series not found', async () => {
    query.mockResolvedValueOnce({ rows: [mockFiling] });
    query.mockResolvedValueOnce({ rows: [] }); // series lookup
    const res = await series.update(makeEvent({ params: { id: 'filing-uuid', seriesId: 'missing' }, body: { series_name: 'X' } }));
    expect(res.statusCode).toBe(404);
  });

  test('updates series and returns 200', async () => {
    query.mockResolvedValueOnce({ rows: [mockFiling] });
    query.mockResolvedValueOnce({ rows: [mockSeries] });
    query.mockResolvedValueOnce({ rows: [{ ...mockSeries, series_name: 'Updated' }] });
    const res = await series.update(makeEvent({ params: { id: 'filing-uuid', seriesId: 'series-uuid' }, body: { series_name: 'Updated' } }));
    expect(res.statusCode).toBe(200);
    expect(parsed(res).series_name).toBe('Updated');
  });
});

// ── remove ────────────────────────────────────────────────────────────────────

describe('series.remove', () => {
  test('returns 401 when not authenticated', async () => {
    resolveUser.mockResolvedValue(null);
    const res = await series.remove(makeEvent({ params: { id: 'filing-uuid', seriesId: 'series-uuid' } }));
    expect(res.statusCode).toBe(401);
  });

  test('returns 400 when filing is complete', async () => {
    query.mockResolvedValueOnce({ rows: [mockCompleteFiling] });
    const res = await series.remove(makeEvent({ params: { id: 'filing-uuid', seriesId: 'series-uuid' } }));
    expect(res.statusCode).toBe(400);
  });

  test('returns 404 when series not found', async () => {
    query.mockResolvedValueOnce({ rows: [mockFiling] });
    query.mockResolvedValueOnce({ rows: [] });
    const res = await series.remove(makeEvent({ params: { id: 'filing-uuid', seriesId: 'missing' } }));
    expect(res.statusCode).toBe(404);
  });

  test('deletes series and returns 204', async () => {
    query.mockResolvedValueOnce({ rows: [mockFiling] });
    query.mockResolvedValueOnce({ rows: [mockSeries] });
    query.mockResolvedValueOnce({ rows: [] });
    const res = await series.remove(makeEvent({ params: { id: 'filing-uuid', seriesId: 'series-uuid' } }));
    expect(res.statusCode).toBe(204);
    expect(query).toHaveBeenLastCalledWith('DELETE FROM npx_filing_series WHERE id = $1', ['series-uuid']);
  });
});
