-- Initialize Surge Database
-- This file runs when PostgreSQL container starts for the first time

-- Create database if not exists (handled by POSTGRES_DB env var)

-- Create extensions for better functionality
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- Set timezone
SET timezone = 'UTC';

-- Create initial indexes (will be created by SQLAlchemy too, but good to have)
-- These will be created after tables are made by the app

-- Grant permissions (if needed for additional users)
-- GRANT ALL PRIVILEGES ON DATABASE surge_db TO surge_user;

-- Log initialization
DO $$
BEGIN
    RAISE NOTICE 'Surge database initialized successfully at %', NOW();
END $$;