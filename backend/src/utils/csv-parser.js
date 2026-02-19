'use strict';

/**
 * Parse N-PX proxy vote CSV.
 *
 * Expected columns (case-insensitive, any order):
 *   issuer_name, cusip, isin, figi,
 *   meeting_date, meeting_type,
 *   vote_description, vote_source, vote_category,
 *   shares_voted, shares_on_loan,
 *   how_voted, mgmt_recommendation, shares
 *
 * Multiple vote records for the same vote can be expressed by repeating rows
 * with the same issuer/meeting/description but different how_voted/shares.
 * The parser groups them automatically.
 */

function normalizeHeader(h) {
  return h.trim().toLowerCase().replace(/\s+/g, '_');
}

function parseCSV(csvText) {
  const lines = csvText.split(/\r?\n/).filter((l) => l.trim());
  if (!lines.length) throw new Error('CSV is empty');

  const headers = lines[0].split(',').map(normalizeHeader);

  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    const values = splitCSVLine(lines[i]);
    if (values.every((v) => !v.trim())) continue;
    const row = {};
    headers.forEach((h, idx) => { row[h] = (values[idx] || '').trim(); });
    rows.push(row);
  }

  return rows;
}

/** Naïve CSV line splitter (handles quoted fields with commas) */
function splitCSVLine(line) {
  const values = [];
  let current  = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === ',' && !inQuotes) {
      values.push(current);
      current = '';
    } else {
      current += ch;
    }
  }
  values.push(current);
  return values;
}

/**
 * Convert raw CSV rows into grouped vote objects ready for DB insert.
 * Returns an array of { vote, records } objects.
 */
function groupVotes(rows) {
  const map    = new Map();
  const order  = [];

  rows.forEach((row, idx) => {
    const key = [
      row.issuer_name  || '',
      row.cusip        || '',
      row.meeting_date || '',
      row.vote_description || '',
    ].join('||');

    if (!map.has(key)) {
      map.set(key, {
        vote: {
          issuer_name:      row.issuer_name      || null,
          cusip:            row.cusip             || null,
          isin:             row.isin              || null,
          figi:             row.figi              || null,
          meeting_date:     row.meeting_date      || null,
          meeting_type:     row.meeting_type      || null,
          vote_description: row.vote_description  || null,
          vote_source:      row.vote_source        || null,
          vote_category:    row.vote_category      || null,
          shares_voted:     parseNum(row.shares_voted),
          shares_on_loan:   parseNum(row.shares_on_loan),
          sort_order:       idx,
        },
        records: [],
      });
      order.push(key);
    }

    const entry = map.get(key);
    if (row.how_voted || row.mgmt_recommendation || row.shares) {
      entry.records.push({
        how_voted:           row.how_voted            || null,
        mgmt_recommendation: row.mgmt_recommendation  || null,
        shares:              parseNum(row.shares),
        sort_order:          entry.records.length,
      });
    }
  });

  return order.map((k) => map.get(k));
}

function parseNum(s) {
  if (!s || !s.trim()) return null;
  const n = parseFloat(s.replace(/,/g, ''));
  return isNaN(n) ? null : n;
}

/**
 * Main entry point: parse CSV text and return grouped vote objects.
 * Throws on parse errors.
 */
function parseProxyVoteCSV(csvText) {
  const rows = parseCSV(csvText);
  if (!rows.length) throw new Error('CSV contains no data rows');
  return groupVotes(rows);
}

module.exports = { parseProxyVoteCSV };
