'use strict';

const { parseProxyVoteCSV } = require('../../utils/csv-parser');

const HEADER = 'issuer_name,cusip,isin,figi,meeting_date,meeting_type,vote_description,vote_source,vote_category,shares_voted,shares_on_loan,how_voted,mgmt_recommendation,shares';

function makeRow(overrides = {}) {
  const defaults = {
    issuer_name: 'Acme Corp', cusip: '000000000', isin: 'US0000000000',
    figi: '', meeting_date: '2026-01-15', meeting_type: 'Annual',
    vote_description: 'Elect Director', vote_source: 'Management',
    vote_category: 'Directors', shares_voted: '1000', shares_on_loan: '50',
    how_voted: 'For', mgmt_recommendation: 'For', shares: '1000',
  };
  const merged = { ...defaults, ...overrides };
  return Object.values(merged).join(',');
}

// ── Error cases ───────────────────────────────────────────────────────────────

describe('parseProxyVoteCSV — errors', () => {
  test('throws on empty string', () => {
    expect(() => parseProxyVoteCSV('')).toThrow('CSV is empty');
  });

  test('throws on whitespace-only string', () => {
    expect(() => parseProxyVoteCSV('   \n  ')).toThrow('CSV is empty');
  });

  test('throws when there are no data rows', () => {
    expect(() => parseProxyVoteCSV(HEADER)).toThrow('CSV contains no data rows');
  });

  test('throws when all data rows are blank', () => {
    expect(() => parseProxyVoteCSV(`${HEADER}\n,,,,,,,,,,,,,`)).toThrow('CSV contains no data rows');
  });
});

// ── Single row ────────────────────────────────────────────────────────────────

describe('parseProxyVoteCSV — single row', () => {
  test('parses a single row into one vote group with one record', () => {
    const csv = `${HEADER}\n${makeRow()}`;
    const groups = parseProxyVoteCSV(csv);

    expect(groups).toHaveLength(1);
    const { vote, records } = groups[0];
    expect(vote.issuer_name).toBe('Acme Corp');
    expect(vote.cusip).toBe('000000000');
    expect(vote.meeting_type).toBe('Annual');
    expect(vote.shares_voted).toBe(1000);
    expect(vote.shares_on_loan).toBe(50);
    expect(vote.sort_order).toBe(0);
    expect(records).toHaveLength(1);
    expect(records[0].how_voted).toBe('For');
    expect(records[0].mgmt_recommendation).toBe('For');
    expect(records[0].shares).toBe(1000);
  });

  test('sets null for empty optional fields', () => {
    const csv = `${HEADER}\n${makeRow({ figi: '', isin: '' })}`;
    const [{ vote }] = parseProxyVoteCSV(csv);
    expect(vote.figi).toBeNull();
    expect(vote.isin).toBeNull();
  });
});

// ── Grouping ──────────────────────────────────────────────────────────────────

describe('parseProxyVoteCSV — grouping', () => {
  test('groups rows with same issuer/meeting/description into one vote', () => {
    const row1 = makeRow({ how_voted: 'For',     shares: '600' });
    const row2 = makeRow({ how_voted: 'Against', shares: '400' });
    const csv  = `${HEADER}\n${row1}\n${row2}`;
    const groups = parseProxyVoteCSV(csv);

    expect(groups).toHaveLength(1);
    expect(groups[0].records).toHaveLength(2);
    expect(groups[0].records[0].how_voted).toBe('For');
    expect(groups[0].records[1].how_voted).toBe('Against');
  });

  test('creates separate votes for different issuers', () => {
    const row1 = makeRow({ issuer_name: 'Acme Corp' });
    const row2 = makeRow({ issuer_name: 'Beta Inc'  });
    const csv  = `${HEADER}\n${row1}\n${row2}`;
    const groups = parseProxyVoteCSV(csv);

    expect(groups).toHaveLength(2);
    expect(groups[0].vote.issuer_name).toBe('Acme Corp');
    expect(groups[1].vote.issuer_name).toBe('Beta Inc');
  });

  test('creates separate votes for different meeting dates', () => {
    const row1 = makeRow({ meeting_date: '2026-01-15' });
    const row2 = makeRow({ meeting_date: '2026-06-30' });
    const csv  = `${HEADER}\n${row1}\n${row2}`;
    const groups = parseProxyVoteCSV(csv);
    expect(groups).toHaveLength(2);
  });

  test('creates separate votes for different descriptions', () => {
    const row1 = makeRow({ vote_description: 'Elect Director A' });
    const row2 = makeRow({ vote_description: 'Elect Director B' });
    const csv  = `${HEADER}\n${row1}\n${row2}`;
    const groups = parseProxyVoteCSV(csv);
    expect(groups).toHaveLength(2);
  });

  test('assigns sort_order by group insertion order', () => {
    const row1 = makeRow({ issuer_name: 'Alpha' });
    const row2 = makeRow({ issuer_name: 'Beta'  });
    const csv  = `${HEADER}\n${row1}\n${row2}`;
    const [g1, g2] = parseProxyVoteCSV(csv);
    expect(g1.vote.sort_order).toBe(0);
    expect(g2.vote.sort_order).toBe(1);
  });
});

// ── Numeric parsing ───────────────────────────────────────────────────────────

describe('parseProxyVoteCSV — numeric fields', () => {
  test('parses numbers with commas', () => {
    const row = `Acme Corp,000000000,US0000000000,,2026-01-15,Annual,Elect Director,Management,Directors,"1,234,567",50,For,For,1000`;
    const csv = `${HEADER}\n${row}`;
    const [{ vote }] = parseProxyVoteCSV(csv);
    expect(vote.shares_voted).toBe(1234567);
  });

  test('returns null for empty numeric fields', () => {
    const csv = `${HEADER}\n${makeRow({ shares_voted: '', shares_on_loan: '' })}`;
    const [{ vote }] = parseProxyVoteCSV(csv);
    expect(vote.shares_voted).toBeNull();
    expect(vote.shares_on_loan).toBeNull();
  });

  test('returns null for non-numeric values', () => {
    const csv = `${HEADER}\n${makeRow({ shares_voted: 'N/A' })}`;
    const [{ vote }] = parseProxyVoteCSV(csv);
    expect(vote.shares_voted).toBeNull();
  });
});

// ── Quoted fields ─────────────────────────────────────────────────────────────

describe('parseProxyVoteCSV — quoted fields', () => {
  test('handles fields with embedded commas', () => {
    const row = `"Acme, Inc",000000000,US0000000000,,2026-01-15,Annual,"Elect Director, Class A",Management,Directors,1000,50,For,For,1000`;
    const csv = `${HEADER}\n${row}`;
    const [{ vote }] = parseProxyVoteCSV(csv);
    expect(vote.issuer_name).toBe('Acme, Inc');
    expect(vote.vote_description).toBe('Elect Director, Class A');
  });

  test('handles escaped double-quotes inside quoted fields', () => {
    const row = `"Acme ""Corp""",000000000,US0000000000,,2026-01-15,Annual,Test,Management,Directors,1000,50,For,For,1000`;
    const csv = `${HEADER}\n${row}`;
    const [{ vote }] = parseProxyVoteCSV(csv);
    expect(vote.issuer_name).toBe('Acme "Corp"');
  });

  test('handles Windows-style CRLF line endings', () => {
    const csv = `${HEADER}\r\n${makeRow()}`;
    const groups = parseProxyVoteCSV(csv);
    expect(groups).toHaveLength(1);
  });
});

// ── Vote record edge cases ────────────────────────────────────────────────────

describe('parseProxyVoteCSV — vote record handling', () => {
  test('omits vote record when how_voted and mgmt_recommendation and shares are all empty', () => {
    const row = makeRow({ how_voted: '', mgmt_recommendation: '', shares: '' });
    const csv = `${HEADER}\n${row}`;
    const [{ records }] = parseProxyVoteCSV(csv);
    expect(records).toHaveLength(0);
  });

  test('includes vote record when only mgmt_recommendation is set', () => {
    const row = makeRow({ how_voted: '', shares: '', mgmt_recommendation: 'For' });
    const csv = `${HEADER}\n${row}`;
    const [{ records }] = parseProxyVoteCSV(csv);
    expect(records).toHaveLength(1);
    expect(records[0].mgmt_recommendation).toBe('For');
  });

  test('assigns sequential sort_order to vote records', () => {
    const row1 = makeRow({ how_voted: 'For',     shares: '600' });
    const row2 = makeRow({ how_voted: 'Against', shares: '400' });
    const csv  = `${HEADER}\n${row1}\n${row2}`;
    const [{ records }] = parseProxyVoteCSV(csv);
    expect(records[0].sort_order).toBe(0);
    expect(records[1].sort_order).toBe(1);
  });
});
