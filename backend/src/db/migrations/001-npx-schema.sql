-- Migration 001: Replace sample filings table with N-PX tables
-- Run via: node backend/scripts/migrate-npx.js

BEGIN;

-- Drop old filings table (and any dependent objects)
DROP TABLE IF EXISTS filings CASCADE;

-- N-PX Filing cover page + signature
CREATE TABLE IF NOT EXISTS npx_filings (
    id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id             UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    status              VARCHAR(20) NOT NULL DEFAULT 'draft',
    filer_type          VARCHAR(10) NOT NULL DEFAULT 'RMIC',

    report_type         VARCHAR(10) NOT NULL DEFAULT 'NPX',
    period_start        DATE,
    period_end          DATE,

    amendment_number    INTEGER,
    amendment_type      VARCHAR(50),

    filer_name          VARCHAR(500),
    filer_cik           VARCHAR(50),
    filer_lei           VARCHAR(50),
    filer_crd           VARCHAR(50),
    filer_street1       VARCHAR(500),
    filer_street2       VARCHAR(500),
    filer_city          VARCHAR(255),
    filer_state         VARCHAR(100),
    filer_zip           VARCHAR(20),
    filer_country       VARCHAR(100) DEFAULT 'US',
    filer_phone         VARCHAR(50),

    agent_name          VARCHAR(500),
    agent_street1       VARCHAR(500),
    agent_street2       VARCHAR(500),
    agent_city          VARCHAR(255),
    agent_state         VARCHAR(100),
    agent_zip           VARCHAR(20),
    agent_country       VARCHAR(100) DEFAULT 'US',
    agent_phone         VARCHAR(50),

    signatory_name      VARCHAR(255),
    signatory_title     VARCHAR(255),
    signature_date      DATE,

    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS npx_filing_series (
    id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    filing_id   UUID NOT NULL REFERENCES npx_filings(id) ON DELETE CASCADE,
    series_id   VARCHAR(50),
    series_name VARCHAR(500),
    series_lei  VARCHAR(50),
    sort_order  INTEGER NOT NULL DEFAULT 0,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS npx_proxy_votes (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    filing_id       UUID NOT NULL REFERENCES npx_filings(id) ON DELETE CASCADE,
    series_id       UUID REFERENCES npx_filing_series(id) ON DELETE SET NULL,

    issuer_name     VARCHAR(500),
    cusip           VARCHAR(20),
    isin            VARCHAR(25),
    figi            VARCHAR(25),

    meeting_date    DATE,
    meeting_type    VARCHAR(50),

    vote_description    TEXT,
    vote_source         VARCHAR(100),
    vote_category       VARCHAR(100),

    shares_voted        NUMERIC(20, 4),
    shares_on_loan      NUMERIC(20, 4),

    sort_order  INTEGER NOT NULL DEFAULT 0,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS npx_vote_records (
    id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    proxy_vote_id       UUID NOT NULL REFERENCES npx_proxy_votes(id) ON DELETE CASCADE,
    how_voted           VARCHAR(50),
    mgmt_recommendation VARCHAR(50),
    shares              NUMERIC(20, 4),
    sort_order          INTEGER NOT NULL DEFAULT 0,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_npx_filings_user_id       ON npx_filings(user_id);
CREATE INDEX IF NOT EXISTS idx_npx_filings_status        ON npx_filings(status);
CREATE INDEX IF NOT EXISTS idx_npx_filing_series_filing  ON npx_filing_series(filing_id);
CREATE INDEX IF NOT EXISTS idx_npx_proxy_votes_filing    ON npx_proxy_votes(filing_id);
CREATE INDEX IF NOT EXISTS idx_npx_proxy_votes_series    ON npx_proxy_votes(series_id);
CREATE INDEX IF NOT EXISTS idx_npx_vote_records_vote     ON npx_vote_records(proxy_vote_id);

DROP TRIGGER IF EXISTS trg_npx_filings_updated_at ON npx_filings;
CREATE TRIGGER trg_npx_filings_updated_at
    BEFORE UPDATE ON npx_filings
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();

DROP TRIGGER IF EXISTS trg_npx_filing_series_updated_at ON npx_filing_series;
CREATE TRIGGER trg_npx_filing_series_updated_at
    BEFORE UPDATE ON npx_filing_series
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();

DROP TRIGGER IF EXISTS trg_npx_proxy_votes_updated_at ON npx_proxy_votes;
CREATE TRIGGER trg_npx_proxy_votes_updated_at
    BEFORE UPDATE ON npx_proxy_votes
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();

DROP TRIGGER IF EXISTS trg_npx_vote_records_updated_at ON npx_vote_records;
CREATE TRIGGER trg_npx_vote_records_updated_at
    BEFORE UPDATE ON npx_vote_records
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();

COMMIT;
