'use strict';

let mockClient;

jest.mock('../../db/client', () => {
  mockClient = {
    query:   jest.fn(),
    release: jest.fn(),
  };
  return {
    query:   jest.fn(),
    getPool: jest.fn(() => ({ connect: jest.fn().mockResolvedValue(mockClient) })),
  };
});

jest.mock('../../utils/auth', () => ({
  getClaims:   jest.fn(),
  isAdmin:     jest.fn(),
  resolveUser: jest.fn(),
}));

const { query, getPool }                  = require('../../db/client');
const { getClaims, isAdmin, resolveUser } = require('../../utils/auth');
const votes                               = require('../../handlers/proxy-votes');
const { makeEvent, regularUser, mockFiling, mockCompleteFiling } = require('../helpers');

beforeEach(() => {
  jest.clearAllMocks();
  getClaims.mockReturnValue({});
  isAdmin.mockReturnValue(false);
  resolveUser.mockResolvedValue(regularUser);

  // Re-bind pool mock after clearAllMocks
  mockClient.query.mockResolvedValue({ rows: [] });
  mockClient.release.mockReturnValue(undefined);
  getPool.mockReturnValue({ connect: jest.fn().mockResolvedValue(mockClient) });
});

function parsed(res) { return JSON.parse(res.body); }

const mockVote = {
  id: 'vote-uuid', filing_id: 'filing-uuid',
  issuer_name: 'Acme Corp', meeting_date: '2026-01-15',
  vote_records: [],
};

// ── list ──────────────────────────────────────────────────────────────────────

describe('proxy-votes.list', () => {
  test('returns 401 when not authenticated', async () => {
    resolveUser.mockResolvedValue(null);
    const res = await votes.list(makeEvent({ params: { id: 'filing-uuid' } }));
    expect(res.statusCode).toBe(401);
  });

  test('returns 404 when parent filing not found', async () => {
    query.mockResolvedValueOnce({ rows: [] });
    const res = await votes.list(makeEvent({ params: { id: 'missing' } }));
    expect(res.statusCode).toBe(404);
  });

  test('returns paginated votes with vote_records', async () => {
    query.mockResolvedValueOnce({ rows: [mockFiling] });            // getParentFiling
    query.mockResolvedValueOnce({ rows: [{ count: '1' }] });        // COUNT
    query.mockResolvedValueOnce({ rows: [mockVote] });              // votes
    query.mockResolvedValueOnce({ rows: [{ proxy_vote_id: 'vote-uuid', how_voted: 'For', sort_order: 0 }] }); // vote_records

    const res = await votes.list(makeEvent({ params: { id: 'filing-uuid' } }));
    expect(res.statusCode).toBe(200);
    const body = parsed(res);
    expect(body.total).toBe(1);
    expect(body.votes).toHaveLength(1);
    expect(body.votes[0].vote_records).toHaveLength(1);
  });

  test('uses default pagination (page=1, limit=50)', async () => {
    query.mockResolvedValueOnce({ rows: [mockFiling] });
    query.mockResolvedValueOnce({ rows: [{ count: '0' }] });
    query.mockResolvedValueOnce({ rows: [] });
    const res = await votes.list(makeEvent({ params: { id: 'filing-uuid' } }));
    expect(res.statusCode).toBe(200);
    const body = parsed(res);
    expect(body.page).toBe(1);
    expect(body.limit).toBe(50);
  });

  test('empty vote list returns empty array without hitting vote_records', async () => {
    query.mockResolvedValueOnce({ rows: [mockFiling] });
    query.mockResolvedValueOnce({ rows: [{ count: '0' }] });
    query.mockResolvedValueOnce({ rows: [] });
    const res = await votes.list(makeEvent({ params: { id: 'filing-uuid' } }));
    expect(parsed(res).votes).toEqual([]);
    // vote_records query should NOT have been called
    expect(query).toHaveBeenCalledTimes(3);
  });
});

// ── create ────────────────────────────────────────────────────────────────────

describe('proxy-votes.create', () => {
  test('returns 401 when not authenticated', async () => {
    resolveUser.mockResolvedValue(null);
    const res = await votes.create(makeEvent({ params: { id: 'filing-uuid' }, body: {} }));
    expect(res.statusCode).toBe(401);
  });

  test('returns 400 when filing is complete', async () => {
    query.mockResolvedValueOnce({ rows: [mockCompleteFiling] });
    const res = await votes.create(makeEvent({ params: { id: 'filing-uuid' }, body: {} }));
    expect(res.statusCode).toBe(400);
    expect(parsed(res).message).toMatch(/completed/);
  });

  test('creates vote and returns 201', async () => {
    query.mockResolvedValueOnce({ rows: [mockFiling] });
    // Transaction: BEGIN, INSERT vote, COMMIT
    mockClient.query
      .mockResolvedValueOnce({})                      // BEGIN
      .mockResolvedValueOnce({ rows: [mockVote] })    // INSERT vote
      .mockResolvedValueOnce({});                     // COMMIT

    const res = await votes.create(makeEvent({
      params: { id: 'filing-uuid' },
      body: { issuer_name: 'Acme Corp', vote_records: [] },
    }));
    expect(res.statusCode).toBe(201);
    expect(mockClient.release).toHaveBeenCalled();
  });

  test('rolls back transaction on DB error', async () => {
    query.mockResolvedValueOnce({ rows: [mockFiling] });
    mockClient.query
      .mockResolvedValueOnce({})                        // BEGIN
      .mockRejectedValueOnce(new Error('insert failed')); // INSERT vote fails

    const spy = jest.spyOn(console, 'error').mockImplementation(() => {});
    const res = await votes.create(makeEvent({ params: { id: 'filing-uuid' }, body: {} }));
    expect(res.statusCode).toBe(500);
    // ROLLBACK should have been called
    expect(mockClient.query).toHaveBeenCalledWith('ROLLBACK');
    expect(mockClient.release).toHaveBeenCalled();
    spy.mockRestore();
  });
});

// ── update ────────────────────────────────────────────────────────────────────

describe('proxy-votes.update', () => {
  test('returns 401 when not authenticated', async () => {
    resolveUser.mockResolvedValue(null);
    const res = await votes.update(makeEvent({ params: { id: 'filing-uuid', voteId: 'vote-uuid' }, body: {} }));
    expect(res.statusCode).toBe(401);
  });

  test('returns 400 when filing is complete', async () => {
    query.mockResolvedValueOnce({ rows: [mockCompleteFiling] });
    const res = await votes.update(makeEvent({ params: { id: 'filing-uuid', voteId: 'vote-uuid' }, body: {} }));
    expect(res.statusCode).toBe(400);
  });

  test('returns 404 when vote not found', async () => {
    query.mockResolvedValueOnce({ rows: [mockFiling] });
    query.mockResolvedValueOnce({ rows: [] }); // vote lookup
    const res = await votes.update(makeEvent({ params: { id: 'filing-uuid', voteId: 'missing' }, body: {} }));
    expect(res.statusCode).toBe(404);
  });

  test('updates vote and returns 200', async () => {
    query.mockResolvedValueOnce({ rows: [mockFiling] });
    query.mockResolvedValueOnce({ rows: [mockVote] }); // existing vote check
    mockClient.query
      .mockResolvedValueOnce({})                                         // BEGIN
      .mockResolvedValueOnce({ rows: [{ ...mockVote, issuer_name: 'Updated' }] }) // UPDATE vote
      .mockResolvedValueOnce({ rows: [] })                               // existing records
      .mockResolvedValueOnce({});                                        // COMMIT

    const res = await votes.update(makeEvent({
      params: { id: 'filing-uuid', voteId: 'vote-uuid' },
      body: { issuer_name: 'Updated' },
    }));
    expect(res.statusCode).toBe(200);
    expect(mockClient.release).toHaveBeenCalled();
  });
});

// ── remove ────────────────────────────────────────────────────────────────────

describe('proxy-votes.remove', () => {
  test('returns 401 when not authenticated', async () => {
    resolveUser.mockResolvedValue(null);
    const res = await votes.remove(makeEvent({ params: { id: 'filing-uuid', voteId: 'vote-uuid' } }));
    expect(res.statusCode).toBe(401);
  });

  test('returns 400 when filing is complete', async () => {
    query.mockResolvedValueOnce({ rows: [mockCompleteFiling] });
    const res = await votes.remove(makeEvent({ params: { id: 'filing-uuid', voteId: 'vote-uuid' } }));
    expect(res.statusCode).toBe(400);
  });

  test('returns 404 when vote not found', async () => {
    query.mockResolvedValueOnce({ rows: [mockFiling] });
    query.mockResolvedValueOnce({ rows: [] });
    const res = await votes.remove(makeEvent({ params: { id: 'filing-uuid', voteId: 'missing' } }));
    expect(res.statusCode).toBe(404);
  });

  test('deletes vote and returns 204', async () => {
    query.mockResolvedValueOnce({ rows: [mockFiling] });
    query.mockResolvedValueOnce({ rows: [mockVote] });
    query.mockResolvedValueOnce({});
    const res = await votes.remove(makeEvent({ params: { id: 'filing-uuid', voteId: 'vote-uuid' } }));
    expect(res.statusCode).toBe(204);
    expect(query).toHaveBeenLastCalledWith('DELETE FROM npx_proxy_votes WHERE id = $1', ['vote-uuid']);
  });
});

// ── clearAll ──────────────────────────────────────────────────────────────────

describe('proxy-votes.clearAll', () => {
  test('returns 400 when filing is complete', async () => {
    query.mockResolvedValueOnce({ rows: [mockCompleteFiling] });
    const res = await votes.clearAll(makeEvent({ params: { id: 'filing-uuid' } }));
    expect(res.statusCode).toBe(400);
  });

  test('deletes all votes and returns count', async () => {
    query.mockResolvedValueOnce({ rows: [mockFiling] });
    query.mockResolvedValueOnce({ rowCount: 5 });
    const res = await votes.clearAll(makeEvent({ params: { id: 'filing-uuid' } }));
    expect(res.statusCode).toBe(200);
    expect(parsed(res).deleted).toBe(5);
  });
});

// ── importCSV ────────────────────────────────────────────────────────────────

describe('proxy-votes.importCSV', () => {
  const HEADER = 'issuer_name,cusip,isin,figi,meeting_date,meeting_type,vote_description,vote_source,vote_category,shares_voted,shares_on_loan,how_voted,mgmt_recommendation,shares';
  const ROW    = 'Acme Corp,000000000,US0000000000,,2026-01-15,Annual,Elect Director,Management,Directors,1000,50,For,For,1000';

  test('returns 400 when csv field is missing', async () => {
    query.mockResolvedValueOnce({ rows: [mockFiling] });
    const res = await votes.importCSV(makeEvent({ params: { id: 'filing-uuid' }, body: {} }));
    expect(res.statusCode).toBe(400);
    expect(parsed(res).message).toMatch(/csv/);
  });

  test('returns 400 when filing is complete', async () => {
    query.mockResolvedValueOnce({ rows: [mockCompleteFiling] });
    const res = await votes.importCSV(makeEvent({ params: { id: 'filing-uuid' }, body: { csv: `${HEADER}\n${ROW}` } }));
    expect(res.statusCode).toBe(400);
  });

  test('returns 400 on CSV parse error', async () => {
    query.mockResolvedValueOnce({ rows: [mockFiling] });
    // Non-empty but invalid: header only, no data rows → parser throws
    const res = await votes.importCSV(makeEvent({ params: { id: 'filing-uuid' }, body: { csv: HEADER } }));
    expect(res.statusCode).toBe(400);
    expect(parsed(res).message).toMatch(/CSV parse error/);
  });

  test('imports CSV rows and returns count', async () => {
    query.mockResolvedValueOnce({ rows: [mockFiling] });
    mockClient.query
      .mockResolvedValueOnce({})                          // BEGIN
      .mockResolvedValueOnce({ rows: [{ id: 'v1' }] })   // INSERT vote
      .mockResolvedValueOnce({})                          // INSERT vote_record
      .mockResolvedValueOnce({});                         // COMMIT

    const res = await votes.importCSV(makeEvent({
      params: { id: 'filing-uuid' },
      body: { csv: `${HEADER}\n${ROW}` },
    }));
    expect(res.statusCode).toBe(200);
    expect(parsed(res).imported).toBe(1);
    expect(mockClient.release).toHaveBeenCalled();
  });
});
