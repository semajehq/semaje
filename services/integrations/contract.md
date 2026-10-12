# Integration routing contract

All outbound connectors are disabled unless their environment variables are present. semaje never
probes or sends transcript data to an unconfigured destination.

- Local sync: `INTEGRATION_FILE_SYNC_DIR`
- Nextcloud WebDAV: `NEXTCLOUD_WEBDAV_URL`, `NEXTCLOUD_USERNAME`, `NEXTCLOUD_PASSWORD`
- Slack/Teams: `SLACK_WEBHOOK_URL`, `TEAMS_WEBHOOK_URL`
- Email: `SMTP_URL`, optional `SMTP_FROM`

Custom event webhooks subscribe to `job.succeeded`, `job.failed`, `transcript.updated`, and
`action.created`. Bodies are signed as `t=<unix>,v1=<hmac-sha256>` in `X-Semaje-Signature` using
`WEBHOOK_SECRET` and retried four times with capped exponential backoff. Delivery attempts are
stored in `integration_deliveries` without credential values.
