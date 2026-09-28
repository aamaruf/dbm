# Installation Guide

This guide covers installing, running and verifying **DB Backup Manager** with Docker or directly with Node.js, connecting your databases (including Supabase), and fixing common problems.

## Table of contents

- [Choose an installation method](#choose-an-installation-method)
- [Docker installation (recommended)](#docker-installation-recommended)
- [Local installation](#local-installation)
- [Dev stack with sample databases](#dev-stack-with-sample-databases)
- [First run](#first-run)
- [Supabase setup](#supabase-setup)
- [S3-compatible storage setup](#s3-compatible-storage-setup)
- [Updating](#updating)
- [Troubleshooting](#troubleshooting)

---

## Choose an installation method

| | Docker | Local (Node.js) |
| --- | --- | --- |
| Client tools | All included (PostgreSQL, MySQL/MariaDB, MongoDB) | Install the ones you need |
| Requirements | Docker 20.10+ with Compose v2 | Node.js 20+, Yarn or npm |
| Best for | Servers, NAS, homelabs | Development, or hosts without Docker |

---

## Docker installation (recommended)

### 1. Get the code

```bash
git clone https://github.com/aamaruf/dbm.git
cd dbm
```

### 2. (Optional) Create a `.env`

You don't need one. Connections are added from the UI. Create a `.env` only if you want S3 storage, an auto-backup schedule, or a pinned **Default** PostgreSQL connection:

```bash
cp .env.example .env
```

Docker Compose reads `.env` automatically. See the [configuration table](README.md#%EF%B8%8F-configuration) for every variable.

### 3. Build and start

```bash
docker compose up -d --build
```

### 4. Verify

```bash
docker compose ps                     # dbm should be "healthy"
docker compose logs -f dbm            # "DB Backup Manager running on http://localhost:7050"
curl http://localhost:7050/health     # {"status":"ok",...}
```

### 5. Open the app

Go to **http://localhost:7050**. To use a different host port, set `HOST_PORT=8080` in `.env`.

### Volumes

| Volume | Mounted at | Contents |
| --- | --- | --- |
| `backup_data` | `/app/backups` | Backup files, one folder per connection |
| `connection_data` | `/app/data` | `connections.json` (saved connections, plain-text passwords) |
| `log_data` | `/app/logs` | Application logs and the operation timeline |

The container runs as a non-root user (UID `1001`). If you replace the named volumes with host folders, give that user ownership first:

```bash
mkdir -p ./backups ./data ./logs && sudo chown -R 1001:1001 ./backups ./data ./logs
```

### Plain `docker run`

```bash
docker build -t dbm .
docker run -d --name dbm -p 7050:7050 \
  -v dbm_backups:/app/backups \
  -v dbm_data:/app/data \
  -v dbm_logs:/app/logs \
  dbm
```

---

## Local installation

### 1. Install Node.js 20+

- **Ubuntu/Debian**
  ```bash
  curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
  sudo apt-get install -y nodejs
  sudo npm install -g yarn
  ```
- **macOS**
  ```bash
  brew install node@20 yarn
  ```
- **Windows**: install from [nodejs.org](https://nodejs.org/). Using **WSL 2** with the Ubuntu steps is recommended.

### 2. Install the client tools you need

You only need the tools for the database types you plan to use.

| Database | Ubuntu / Debian | macOS (Homebrew) | Windows |
| --- | --- | --- | --- |
| PostgreSQL | `sudo apt-get install postgresql-client` | `brew install postgresql` | [PostgreSQL installer](https://www.postgresql.org/download/windows/) (Command Line Tools) |
| MySQL | `sudo apt-get install mysql-client` (or `mariadb-client`) | `brew install mysql-client` | [MySQL Installer](https://dev.mysql.com/downloads/installer/) (MySQL Shell/Client) |
| MongoDB | [Database Tools .deb](https://www.mongodb.com/try/download/database-tools) | `brew tap mongodb/brew && brew install mongodb-database-tools` | [Database Tools .msi](https://www.mongodb.com/try/download/database-tools) |

Check that the tools are available:

```bash
pg_dump --version && psql --version && pg_restore --version
mysqldump --version && mysql --version
mongodump --version && mongorestore --version
```

> Use a PostgreSQL client that is the **same major version or newer** than your server. An older `pg_dump` refuses to dump a newer server.
>
> Homebrew's `mysql-client` and `postgresql` are keg-only. Add them to your `PATH` as `brew info` describes.

### 3. Install and run

```bash
git clone https://github.com/aamaruf/dbm.git
cd dbm
yarn install              # or: npm install
cp .env.example .env      # optional
yarn start                # production mode
# or
yarn dev                  # development mode
```

You can also run the interactive helper: `./setup.sh` (Linux/macOS) or `setup.bat` (Windows). It reports which client tools are missing.

Open **http://localhost:7050**.

---

## Dev stack with sample databases

`docker-compose.dev.yml` adds throwaway PostgreSQL 16, MySQL 8.4 and MongoDB 7 servers, which makes it easy to try the app or develop against real engines.

```bash
docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d --build
```

| Type | Host (app in Docker) | Host (app on your machine) | User / Password | Database |
| --- | --- | --- | --- | --- |
| PostgreSQL | `postgres:5432` | `localhost:15432` | `dbm` / `dbm` | `demo` |
| MySQL | `mysql:3306` | `localhost:13306` | `dbm` / `dbm` | `demo` |
| MongoDB | `mongo:27017` | `localhost:27018` | `dbm` / `dbm` (Auth Source `admin`) | `demo` |

To start only the databases and run the app with `yarn dev`:

```bash
docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d postgres mysql mongo
```

To stop everything and delete the sample data:

```bash
docker compose -f docker-compose.yml -f docker-compose.dev.yml down -v
```

> These credentials are for demos only. Never expose the dev stack publicly.

---

## First run

1. **Add a connection.** Click **Add Connection**, choose the type, fill in the fields, then click **Test Connection** and **Save Connection**.
2. **Create a backup.** Click **Backup** on the connection row. The file appears in *Recent Backups* and under `backups/<connectionId>/` (in Docker, inside the `backup_data` volume):
   ```bash
   ls backups/*/                                     # local install
   docker compose exec dbm ls -R /app/backups        # Docker
   ```
3. **Restore.** Click **Restore** on a row, choose the source connection and the backup file, then confirm. Try it on a non-production database first.
4. **(Optional) Turn on Auto-Backup.** Use the toggle in the header. In ENV mode it's controlled by `BACKUP_AUTO` and `BACKUP_SCHEDULE`. Switch to Manual mode to change it from the UI.

### Optional: the Default connection

If `DB_HOST` (and the other `DB_*` variables) are set, that PostgreSQL database appears as a pinned **Default (ENV)** connection. In Manual mode you edit it under **Configure → Database**. You can't delete it from the list, and its backups are stored in `backups/default/`.

---

## Supabase setup

Supabase is PostgreSQL, so you add it as a **PostgreSQL** connection.

1. In the Supabase dashboard, open **Project Settings → Database → Connection string** and choose **Session pooler**.
2. Copy these values into **Add Connection** with type *PostgreSQL*:

   | Field | Value |
   | --- | --- |
   | Title | e.g. `Supabase – production` |
   | Host | `aws-0-<region>.pooler.supabase.com` |
   | Port | `5432` |
   | Username | `postgres.<project-ref>` |
   | Password | Your database password (reset it under *Database settings* if needed) |
   | Database | `postgres` |
   | Schema | `public` (plus any of your own schemas, one connection each) |
   | Use SSL | On |

3. Under **Configure → Backup**, set **Backup Format** to `DUMP` if you plan to restore into Supabase. Restores then use `pg_restore --no-owner`, which avoids errors about Supabase-managed roles.

Why these settings:

- The **direct connection** host (`db.<ref>.supabase.co`) only has an IPv6 address. Most Docker networks and many servers only have IPv4, so the Session pooler is the reliable choice.
- The **Transaction pooler** (port `6543`) doesn't support the session features `pg_dump` needs.
- Setting **Schema** to `public` skips the schemas Supabase manages itself (`auth`, `storage`, `realtime`, `graphql`, `vault`, …). Restoring those into another project fails.

---

## S3-compatible storage setup

Set `BACKUP_STORAGE=remote` (S3 only) or `both` (local + S3), then add your provider's settings:

**AWS S3**

```env
AWS_ACCESS_KEY_ID=AKIA...
AWS_SECRET_ACCESS_KEY=...
AWS_REGION=us-east-1
AWS_S3_BUCKET=my-db-backups
AWS_S3_PREFIX=prod
```

**Supabase Storage**

```env
AWS_ACCESS_KEY_ID=<storage access key>
AWS_SECRET_ACCESS_KEY=<storage secret key>
AWS_REGION=<project region>
AWS_S3_BUCKET=backups
AWS_S3_ENDPOINT=https://<project-ref>.supabase.co/storage/v1/s3
```

**MinIO**

```env
AWS_ACCESS_KEY_ID=minioadmin
AWS_SECRET_ACCESS_KEY=minioadmin
AWS_REGION=us-east-1
AWS_S3_BUCKET=db-backups
AWS_S3_ENDPOINT=http://minio:9000
```

**DigitalOcean Spaces**

```env
AWS_ACCESS_KEY_ID=...
AWS_SECRET_ACCESS_KEY=...
AWS_REGION=nyc3
AWS_S3_BUCKET=my-db-backups
AWS_S3_ENDPOINT=https://nyc3.digitaloceanspaces.com
```

Path-style addressing is turned on automatically for Supabase, MinIO, localhost and DigitalOcean endpoints. Force it with `AWS_S3_FORCE_PATH_STYLE=true` if you need to. In Manual mode, you can enter the same settings under **Configure → Storage**.

Objects are stored as `<prefix>/<connectionId>/<filename>`.

---

## Updating

```bash
git pull
docker compose up -d --build     # Docker
yarn install && yarn start       # local
```

Upgrading from 1.x? Read [Upgrading from 1.x](README.md#%EF%B8%8F-upgrading-from-1x) first. Backups moved into per-connection folders, and the Compose service was renamed to `dbm`.

---

## Troubleshooting

### `<tool> is not installed or not in PATH`

The client tools for that database type are missing. Install them (see [step 2](#2-install-the-client-tools-you-need)), or use the Docker image. Then restart the app so it picks up the new `PATH`.

### `pg_dump: error: aborting because of server version mismatch`

Your local `pg_dump` is older than the server. Install a newer PostgreSQL client, or use the Docker image, which ships a recent one.

### Connection refused or timeout

- Check the host, port and firewall. Many cloud databases also need your IP on an allow-list.
- From inside Docker, `localhost` is the container itself. Use `host.docker.internal` (Docker Desktop) or the host's IP.
- For Supabase, use the Session pooler (see [Supabase setup](#supabase-setup)).

### SSL / TLS errors

- **PostgreSQL / MySQL:** turn **Use SSL** on for servers that require TLS, and off for servers that don't support it.
- **MongoDB:** turn **Use TLS** on for Atlas and other TLS-only clusters.

### MySQL: `Authentication requires secure connection` / plugin `caching_sha2_password` errors

The Docker image uses the **MariaDB** client. Against MySQL 8 servers that use `caching_sha2_password`, either:

- turn **Use SSL** on, or
- create the backup user with `mysql_native_password` (on MySQL 8.4, start the server with `--mysql-native-password=ON`).

### MySQL: `Access denied; you need (at least one of) the PROCESS privilege`

Tablespace dumps are already skipped. Also give the user `SELECT, SHOW VIEW, TRIGGER, LOCK TABLES, EVENT` on the database. To include stored routines, it needs `SHOW_ROUTINE` (MySQL 8.0.20+) or `SELECT` on `mysql.*`.

### MongoDB: `Authentication failed`

- Set **Auth source** to the database where the user was created, usually `admin`.
- For Atlas: turn on **SRV record** and **Use TLS**, and put only the cluster host (e.g. `cluster0.abcd.mongodb.net`) in *Host*.

### `EACCES: permission denied` on `/app/backups` or `/app/data`

The container runs as UID `1001`. Use the named volumes, or `chown -R 1001:1001` the host folders you bind-mount.

### Port 7050 already in use

Set `HOST_PORT=8080` in `.env` for Docker, or `PORT=8080` for local installs.

### S3 upload failed

- Check the keys, bucket name, region and endpoint.
- The credentials need `s3:PutObject`, `s3:GetObject`, `s3:ListBucket` and `s3:DeleteObject`.
- For self-hosted S3, set `AWS_S3_ENDPOINT`.

### Scheduler doesn't run

- In ENV mode, set `BACKUP_AUTO=true` and a valid `BACKUP_SCHEDULE`, then restart.
- Check `docker compose logs -f dbm` for `Scheduled backup failed for "<title>"` messages. One failing connection doesn't stop the others.

### Still stuck?

Search or open an issue at **https://github.com/aamaruf/dbm/issues**. Include your install method, database type and version, and the relevant log lines, with secrets removed.
