-- FF-092 Part 2 (schema): invite list for Strike testers.
--
-- Idempotent. RLS on with NO policies, anon/authenticated revoked: only the service role reads.
-- Emails are stored lowercase. Testers are added by hand with SQL:
--   INSERT INTO allowed_emails (email, invited_by) VALUES ('tester@example.com', 'founder');

CREATE TABLE IF NOT EXISTS allowed_emails (
  email       text PRIMARY KEY CHECK (email = lower(email)),
  invited_by  text,
  created_at  timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE allowed_emails ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON allowed_emails FROM anon, authenticated;

INSERT INTO allowed_emails (email, invited_by)
VALUES ('ghostnet5x5@gmail.com', 'founder')
ON CONFLICT (email) DO NOTHING;
