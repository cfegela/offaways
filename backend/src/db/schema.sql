CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Users table
-- cognito_sub is null in local dev (we use our own UUID as sub)
-- password_hash is only used in local dev; null in production
CREATE TABLE IF NOT EXISTS users (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    cognito_sub     VARCHAR(255) UNIQUE,
    email           VARCHAR(255) UNIQUE NOT NULL,
    password_hash   VARCHAR(255),
    first_name      VARCHAR(255),
    last_name       VARCHAR(255),
    role            VARCHAR(50) NOT NULL DEFAULT 'user',
    is_active       BOOLEAN NOT NULL DEFAULT true,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Filings table
CREATE TABLE IF NOT EXISTS filings (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    first_name      VARCHAR(255) NOT NULL,
    last_name       VARCHAR(255) NOT NULL,
    street_address  VARCHAR(500) NOT NULL,
    city            VARCHAR(255) NOT NULL,
    state           VARCHAR(100) NOT NULL,
    zip_code        VARCHAR(20) NOT NULL,
    country         VARCHAR(100) NOT NULL DEFAULT 'US',
    annual_salary   NUMERIC(15, 2) NOT NULL,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Auto-update updated_at
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_users_updated_at ON users;
CREATE TRIGGER trg_users_updated_at
    BEFORE UPDATE ON users
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();

DROP TRIGGER IF EXISTS trg_filings_updated_at ON filings;
CREATE TRIGGER trg_filings_updated_at
    BEFORE UPDATE ON filings
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();
