# Backup, restore, and encryption

## Backup

Run `deploy/backup`. It creates a timestamped, checksummed directory under `backups/` containing a
custom-format Postgres dump, local blobs/exports/logs/integration files, speech models (STT + TTS voices), optional
observability reports, Ollama models, the source revision, and a copy of `.env` when present. Set `BACKUP_DIR` to write to
encrypted removable or network storage.

Verify without restoring:

```bash
cd backups/semaje-YYYYMMDDTHHMMSSZ
shasum -a 256 -c SHA256SUMS
docker compose exec -T postgres pg_restore --list < postgres.dump >/dev/null
tar -tzf app-data.tar.gz >/dev/null
tar -tzf stt-models.tar.gz >/dev/null
```

## Restore drill

Use a disposable deployment first. `deploy/restore <backup-directory> --yes` stops application
writers, verifies checksums, restores Postgres and data/model volumes, reapplies forward migrations,
and restarts the stack. It writes backed-up configuration to `.env.restored` for manual review; it
never silently replaces active secrets.

After restore, check `docker compose ps`, `/api/health`, transcript count, one audio playback, one
export, and the model manager. Keep a dated restore-drill record outside the server.

## Encryption at rest

Use full-volume encryption beneath Docker volumes: LUKS2 on Linux, FileVault on macOS, BitLocker on
Windows, or encrypted ZFS datasets. Put `pgdata`, `blobdata`, model volumes, backups, and `.env` on
the encrypted volume. For S3/MinIO storage, require server-side encryption and TLS. Keep encryption
keys in the host secret manager, not Compose files or Git, and rotate JWT, invite, webhook, SMTP,
calendar, and object-store credentials after a suspected host compromise.

Database and filesystem encryption protect powered-off media. They do not replace host access
controls, TLS, least-privilege roles, audited exports, tested restores, or off-host backup copies.
