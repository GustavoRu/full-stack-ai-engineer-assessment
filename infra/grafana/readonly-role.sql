-- Read-only role for Grafana. It sees the metric columns of "questions" and nothing else.
-- Run with the psql variables reader_password and dbname. Safe to run on every start.
SELECT 'CREATE ROLE grafana_reader LOGIN'
WHERE NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'grafana_reader') \gexec

ALTER ROLE grafana_reader PASSWORD :'reader_password';
GRANT CONNECT ON DATABASE :"dbname" TO grafana_reader;
GRANT USAGE ON SCHEMA public TO grafana_reader;

-- Column-level grant: no question text, answers, passages or user data
GRANT SELECT (created_at, status, latency_ms, input_tokens, output_tokens, model, prompt_version, provider)
  ON questions TO grafana_reader;
