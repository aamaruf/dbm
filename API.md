# API Documentation

## Base URL

```
http://localhost:7050/api
```

## Table of Contents

- [Health Check](#health-check)
- [Connections](#connections)
- [Backups](#backups)
- [Config Mode Management](#config-mode-management)
- [Manual Configuration](#manual-configuration)
- [Storage Configuration](#storage-configuration)
- [Scheduler](#scheduler)
- [Error Responses](#error-responses)
- [Rate Limiting](#rate-limiting)
- [Cron Schedule Format](#cron-schedule-format)
- [Security Best Practices](#security-best-practices)

---

## Health Check

### Check Server Health

```http
GET /health
```

**Response:**

```json
{
  "status": "ok",
  "timestamp": "2024-01-01T00:00:00.000Z"
}
```

---

## Connections

Connections are saved to `data/connections.json` (override the folder with `DATA_DIR`). Passwords are stored in plain text and never returned by the API.

Supported types: `postgres`, `mysql`, `mongodb`.

A connection must be unique on **type + host + port + database**, and its **title** must also be unique. A duplicate returns `409`.

The existing ENV / Manual database configuration shows up as a pinned connection with id `default`. You edit it through the Configure dialog, and it can't be updated or deleted through these endpoints.

### List Connections

```http
GET /api/connections
```

**Response:**

```json
{
  "success": true,
  "drivers": [
    { "type": "postgres", "label": "PostgreSQL", "defaultPort": 5432, "formats": ["sql", "dump"] },
    { "type": "mysql", "label": "MySQL", "defaultPort": 3306, "formats": ["sql"] },
    { "type": "mongodb", "label": "MongoDB", "defaultPort": 27017, "formats": ["archive"] }
  ],
  "connections": [
    {
      "id": "3f1c...",
      "title": "Production Shop",
      "type": "mysql",
      "host": "db.example.com",
      "port": 3306,
      "user": "backup",
      "database": "shop",
      "options": { "excludeTables": [], "sslMode": "on" },
      "hasPassword": true,
      "backupCount": 4,
      "lastBackupAt": "2026-01-01T00:00:00.000Z"
    }
  ]
}
```

### Create Connection

The connection is tested before it's saved.

```http
POST /api/connections
```

**Request Body:**

```json
{
  "title": "Production Shop",
  "type": "mysql",
  "host": "db.example.com",
  "port": 3306,
  "user": "backup",
  "password": "secret",
  "database": "shop",
  "options": {}
}
```

**Type-specific `options`:**

| Type       | Options                                                                  |
| ---------- | ------------------------------------------------------------------------ |
| `postgres` | `schema`, `excludeTables` (comma list or array), `sslMode` (`on`/`off`)  |
| `mysql`    | `excludeTables` (comma list or array), `sslMode` (`on`/`off`)            |
| `mongodb`  | `authSource` (default `admin`), `excludeCollections`, `tls`, `srv`       |

### Update Connection

```http
PUT /api/connections/:id
```

It takes the same body as create. If `password` is blank, the saved password is kept. The database type can't be changed.

### Delete Connection

```http
DELETE /api/connections/:id
```

Backup files for the connection are kept on disk and in S3.

### Test Connection

```http
POST /api/connections/test      # unsaved form (same body as create; include "id" to reuse a saved password)
POST /api/connections/:id/test  # saved connection
```

**Response:**

```json
{
  "success": true,
  "message": "Connection successful",
  "serverTime": "2026-01-01T00:00:00.000Z",
  "version": "MySQL 8.0.36"
}
```

### Create Instant Backup

```http
POST /api/connections/:id/backups
```

**Request Body (Optional):**

```json
{
  "format": "dump"
}
```

`format` only applies to PostgreSQL (`sql` or `dump`). MySQL always produces `.sql` (from `mysqldump`), and MongoDB always produces a gzipped `.archive` (from `mongodump`).

**Response:**

```json
{
  "success": true,
  "message": "Backup of \"Production Shop\" created successfully",
  "filename": "backup_mysql_shop_2026-01-01T00-00-00-000Z.sql",
  "size": 1048576,
  "format": "sql",
  "location": "both"
}
```

### List Backups of a Connection

This is used by the restore file dropdown.

```http
GET /api/connections/:id/backups
```

### Restore Connection

This restores the target connection (`:id`) from a backup file that belongs to `sourceConnectionId`. Both connections must be the same database type. To restore a connection from its own backup, pass the same id as the source.

```http
POST /api/connections/:id/restore
```

**Request Body:**

```json
{
  "sourceConnectionId": "3f1c...",
  "filename": "backup_mysql_shop_2026-01-01T00-00-00-000Z.sql"
}
```

What restore does for each type:

- **PostgreSQL:** For `.dump` files, runs `pg_restore -c`. For `.sql` files, drops and recreates the schema, then runs `psql`.
- **MySQL:** Pipes the file into `mysql`. The dump includes `DROP TABLE IF EXISTS`.
- **MongoDB:** Runs `mongorestore --drop`. When the source and target database names differ, the namespaces are remapped with `--nsFrom` / `--nsTo`.

---

## Backups

Backup files are stored per connection: locally in `<BACKUP_LOCAL_PATH>/<connectionId>/`, and in S3 under `<prefix>/<connectionId>/`.

### List All Backups

```http
GET /api/backups
GET /api/backups?connectionId=3f1c...
```

**Response:**

```json
{
  "success": true,
  "backups": [
    {
      "connectionId": "3f1c...",
      "filename": "backup_mysql_shop_2026-01-01T00-00-00-000Z.sql",
      "size": 1048576,
      "date": "2026-01-01T00:00:00.000Z",
      "location": "both",
      "format": "sql"
    }
  ],
  "stats": {
    "total": 1,
    "local": 1,
    "remote": 1,
    "totalSize": 1048576
  }
}
```

### Upload Backup File

```http
POST /api/backups/upload
```

**Content-Type:**

`multipart/form-data`

**Form Fields:**

- `connectionId`: required. The connection that the file belongs to.
- `backupFile`: required. Must use an extension the connection's type accepts: `.sql`/`.dump` for PostgreSQL, `.sql` for MySQL, `.archive` for MongoDB.

**Response:**

```json
{
  "success": true,
  "message": "Backup file uploaded successfully",
  "filename": "uploaded_backup_1714012345678.sql",
  "size": 1048576
}
```

### Download Backup

```http
GET /api/backups/:connectionId/:filename/download
```

**Response:**

- File download stream

### Delete Backup

```http
DELETE /api/backups/:connectionId/:filename
```

**Response:**

```json
{
  "success": true,
  "message": "Backup deleted successfully",
  "deletedLocal": true,
  "deletedRemote": true
}
```

### List Operation Logs

```http
GET /api/operations?limit=20&stepsPerOperation=500
```

**Query Parameters:**

- `limit` - Max number of operations (default: 30)
- `stepsPerOperation` - Max log lines per operation (default: 500)

**Response:**

```json
{
  "success": true,
  "operations": [
    {
      "operationId": "backup-1714012345000-1",
      "type": "backup",
      "filename": "backup_mydb_2024-01-01T00-00-00-000Z.sql",
      "latestStatus": "success",
      "latestStep": "Backup completed (local)",
      "latestTimestamp": "2024-01-01T00:00:10.000Z",
      "startedAt": "2024-01-01T00:00:00.000Z",
      "steps": [
        {
          "id": "backup-1714012345000-1-1714012345001-ab12cd",
          "operationId": "backup-1714012345000-1",
          "type": "backup",
          "filename": "backup_mydb_2024-01-01T00-00-00-000Z.sql",
          "status": "started",
          "step": "Operation started",
          "details": null,
          "timestamp": "2024-01-01T00:00:00.000Z"
        }
      ]
    }
  ]
}
```

### Clear Operation Logs

```http
DELETE /api/operations
```

**Response:**

```json
{
  "success": true,
  "message": "Operation logs cleared"
}
```

**Response:**

```json
{
  "success": true,
  "message": "Database restored successfully"
}
```

---

## Config Mode Management

### Get Configuration Mode

```http
GET /api/config/mode
```

**Response:**

```json
{
  "success": true,
  "mode": "env",
  "manualConfig": null,
  "envConfig": {
    "database": {
      "host": "localhost",
      "port": 5432,
      "user": "postgres",
      "database": "mydb",
      "schema": "",
      "excludeTables": []
    },
    "backup": {
      "enabled": true,
      "schedule": "0 2 * * *",
      "retentionDays": 7,
      "format": "sql",
      "storage": "local"
    },
    "s3": null
  }
}
```

### Set Configuration Mode

```http
POST /api/config/mode
```

**Request Body:**

```json
{
  "mode": "manual" // or "env"
}
```

**Response:**

```json
{
  "success": true,
  "message": "Configuration mode set to MANUAL",
  "mode": "manual"
}
```

### Reset Manual Configuration

```http
POST /api/config/reset
```

**Response:**

```json
{
  "success": true,
  "message": "Manual configuration has been reset"
}
```

---

## Manual Configuration

Manual configuration endpoints allow you to set database, backup, and S3 settings via API when the application is in `manual` mode.

### Set Manual Database Configuration

```http
POST /api/config/manual/database
```

**Request Body:**

```json
{
  "host": "localhost",
  "port": 5432,
  "user": "postgres",
  "password": "password",
  "database": "mydb",
  "schema": "public",
  "excludeTables": "migrations,sessions"
}
```

**Response:**

```json
{
  "success": true,
  "message": "Manual database configuration saved",
  "config": {
    "host": "localhost",
    "port": 5432,
    "user": "postgres",
    "database": "mydb",
    "schema": "public",
    "excludeTables": ["migrations", "sessions"]
  }
}
```

### Set Manual Backup Configuration

```http
POST /api/config/manual/backup
```

**Request Body:**

```json
{
  "auto": true,
  "schedule": "0 2 * * *",
  "retentionDays": 7,
  "storage": "both",
  "localPath": "./backups",
  "format": "sql"
}
```

**Response:**

```json
{
  "success": true,
  "message": "Manual backup configuration saved",
  "config": {
    "auto": true,
    "schedule": "0 2 * * *",
    "retentionDays": 7,
    "storage": "both",
    "localPath": "./backups",
    "format": "sql"
  }
}
```

### Set Manual S3 Configuration

```http
POST /api/config/manual/s3
```

**Request Body:**

```json
{
  "accessKeyId": "your-access-key",
  "secretAccessKey": "your-secret-key",
  "region": "us-east-1",
  "bucket": "my-backups",
  "prefix": "postgres/",
  "endpoint": "https://s3.amazonaws.com",
  "s3ForcePathStyle": false
}
```

**Response:**

```json
{
  "success": true,
  "message": "Manual S3 configuration saved",
  "config": {
    "accessKeyId": "your-access-key",
    "region": "us-east-1",
    "bucket": "my-backups",
    "endpoint": "https://s3.amazonaws.com",
    "s3ForcePathStyle": false
  }
}
```

**Note:** All manual configuration endpoints require the application to be in `manual` mode. Switch mode using `POST /api/config/mode` first.

---

## Storage Configuration

### Get Storage Configuration

```http
GET /api/storage/config
```

**Response:**

```json
{
  "success": true,
  "config": {
    "storage": "local",
    "retentionDays": 7,
    "s3": {
      "accessKeyId": "your-access-key",
      "secretAccessKey": "********",
      "region": "us-east-1",
      "bucket": "my-backups",
      "prefix": "postgres/",
      "endpoint": "",
      "s3ForcePathStyle": false
    }
  }
}
```

### Update Storage Configuration

```http
POST /api/storage/config
```

**Request Body:**

```json
{
  "accessKeyId": "your-access-key",
  "secretAccessKey": "your-secret-key",
  "region": "us-east-1",
  "bucket": "my-backups",
  "prefix": "postgres/",
  "endpoint": "https://s3.amazonaws.com",
  "s3ForcePathStyle": false
}
```

**Response:**

```json
{
  "success": true,
  "message": "Storage configuration updated successfully"
}
```

---

## Scheduler

### Get Scheduler Status

```http
GET /api/scheduler
```

**Response:**

```json
{
  "success": true,
  "running": true,
  "schedule": "0 2 * * *",
  "nextRun": "2024-01-02T02:00:00.000Z"
}
```

### Start Scheduler

```http
POST /api/scheduler
```

**Request Body (Optional):**

```json
{
  "schedule": "0 2 * * *"
}
```

**Response:**

```json
{
  "success": true,
  "message": "Scheduler started successfully",
  "running": true,
  "schedule": "0 2 * * *"
}
```

### Stop Scheduler

```http
DELETE /api/scheduler
```

**Response:**

```json
{
  "success": true,
  "message": "Scheduler stopped successfully",
  "running": false
}
```

---

## Error Responses

All endpoints may return the following error formats:

### Validation Error (400)

```json
{
  "success": false,
  "message": "Validation failed",
  "errors": [
    {
      "type": "field",
      "value": "",
      "msg": "Host is required",
      "path": "host",
      "location": "body"
    }
  ]
}
```

### Not Found Error (404)

```json
{
  "success": false,
  "message": "Backup file not found"
}
```

### Server Error (500)

```json
{
  "success": false,
  "message": "Internal server error"
}
```

### Rate Limit Error (429)

```json
{
  "success": false,
  "message": "Too many requests, please try again later"
}
```

---

## Rate Limiting

- **General endpoints**: 100 requests per 15 minutes per IP
- **Sensitive operations** (backup, restore, config changes): 20 requests per 15 minutes per IP

---

## Cron Schedule Format

The scheduler uses standard cron syntax:

```
┌───────────── minute (0 - 59)
│ ┌───────────── hour (0 - 23)
│ │ ┌───────────── day of month (1 - 31)
│ │ │ ┌───────────── month (1 - 12)
│ │ │ │ ┌───────────── day of week (0 - 6) (Sunday to Saturday)
│ │ │ │ │
* * * * *
```

### Examples:

- `0 2 * * *` - Every day at 2:00 AM
- `0 */6 * * *` - Every 6 hours
- `*/30 * * * *` - Every 30 minutes
- `0 0 * * 0` - Every Sunday at midnight
- `0 0 1 * *` - First day of every month at midnight

---

## Security Best Practices

1. **Always use HTTPS in production** - Deploy behind a reverse proxy (nginx, Caddy, etc.)
2. **Restrict network access** - Use firewall rules to limit access to trusted IPs
3. **Use strong passwords** - For both database and S3 credentials
4. **Rotate credentials regularly** - Change passwords and access keys periodically
5. **Limit S3 bucket permissions** - Grant only necessary permissions for backup operations
6. **Keep backups encrypted** - Consider encrypting sensitive backup data
7. **Monitor logs** - Regularly check logs for suspicious activity
8. **Keep software updated** - Regularly update dependencies for security patches
