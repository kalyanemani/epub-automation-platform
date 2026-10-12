CREATE SCHEMA IF NOT EXISTS {{SCHEMA}};

CREATE TABLE IF NOT EXISTS {{SCHEMA}}.textbooks (
  id UUID PRIMARY KEY,
  name TEXT NOT NULL,
  original_filename TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS {{SCHEMA}}.editions (
  id UUID PRIMARY KEY,
  textbook_id UUID NOT NULL REFERENCES {{SCHEMA}}.textbooks(id) ON DELETE CASCADE,
  version_number INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft',
  artifact_path TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_editions_textbook_id
  ON {{SCHEMA}}.editions (textbook_id, version_number DESC);

CREATE TABLE IF NOT EXISTS {{SCHEMA}}.runs (
  id UUID PRIMARY KEY,
  edition_id UUID NOT NULL REFERENCES {{SCHEMA}}.editions(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'running',
  report_json JSONB,
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  finished_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_runs_edition_id
  ON {{SCHEMA}}.runs (edition_id, started_at DESC);

CREATE INDEX IF NOT EXISTS idx_runs_status
  ON {{SCHEMA}}.runs (status);

CREATE TABLE IF NOT EXISTS {{SCHEMA}}.logs (
  id UUID PRIMARY KEY,
  type TEXT NOT NULL,
  source TEXT NOT NULL,
  details JSONB NOT NULL DEFAULT '{}'::jsonb,
  timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_logs_timestamp
  ON {{SCHEMA}}.logs (timestamp DESC);

CREATE INDEX IF NOT EXISTS idx_logs_type
  ON {{SCHEMA}}.logs (type);
