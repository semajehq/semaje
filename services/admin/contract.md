# Administration and retention contract

Administration endpoints require the `admin` or `owner` role. Invite tokens are signed, stored only
as SHA-256 hashes, expire, and are single-use. API keys store bcrypt hashes and expose the full token
once at creation.

Retention policies define a default age plus optional source-specific day counts. Every run supports
dry-run preview. Destructive runs delete at most 1,000 matching transcripts, then remove unreferenced
audio blobs from both storage and Postgres when `deleteAudio` is enabled.

Sensitive reads and mutations append tenant-scoped rows to `audit_events`; audit metadata must never
contain raw tokens, passwords, connector credentials, or transcript bodies.
