# Installation Guide

Complete step-by-step installation instructions for PostgreSQL Backup Manager.

## Table of Contents

1. [Prerequisites](#prerequisites)
2. [Docker Installation (Recommended)](#docker-installation-recommended)
3. [Local Installation](#local-installation)
4. [Configuration](#configuration)
5. [First Run](#first-run)
6. [Verification](#verification)
7. [Troubleshooting](#troubleshooting)

---

## Prerequisites

### For Docker Installation

- Docker 20.10+ ([Install Docker](https://docs.docker.com/get-docker/))
- Docker Compose 2.0+ (included with Docker Desktop)
- 500MB free disk space (minimum)
- PostgreSQL database (local or remote)

### For Local Installation

- Node.js 20 LTS or higher ([Download](https://nodejs.org/))
- PostgreSQL client tools (pg_dump, psql)
- 200MB free disk space (minimum)
- PostgreSQL database (local or remote)

---

## Docker Installation (Recommended)

### Step 1: Clone or Download Project

**Option A: Using Git**

```bash
git clone <repository-url>
cd postgres-backup
```

**Option B: Download ZIP**

1. Download the project ZIP file
2. Extract to a directory
3. Open terminal in that directory

### Step 2: Create Environment File

```bash
# Copy example to .env
cp .env.example .env

# Or on Windows
copy .env.example .env
```

### Step 3: Edit Configuration

Open `.env` in your favorite text editor and update:

```env
# REQUIRED: Your database credentials
DB_HOST=your-database-host.com
DB_PORT=5432
DB_USER=postgres
DB_PASSWORD=your_secure_password
DB_NAME=postgres
```

**Examples:**

**Supabase Database:**

```env
DB_HOST=db.abcdefghijklmn.supabase.co
DB_PORT=5432
DB_USER=postgres
DB_PASSWORD=your_supabase_password
DB_NAME=postgres
```

**AWS RDS:**

```env
DB_HOST=mydb.123456789.us-east-1.rds.amazonaws.com
DB_PORT=5432
DB_USER=admin
DB_PASSWORD=your_rds_password
DB_NAME=myapp
```

**Local Database:**

```env
DB_HOST=localhost
DB_PORT=5432
DB_USER=postgres
DB_PASSWORD=postgres
DB_NAME=mydb
```

### Step 4: Build and Start

```bash
# Build the Docker image
docker compose build

# Start the application
docker compose up -d
```

**Expected output:**

```
[+] Building 45.2s (12/12) FINISHED
[+] Running 2/2
 ✔ Network postgres-backup_default          Created
 ✔ Container postgres-backup-manager        Started
```

### Step 5: Verify Installation

```bash
# Check container is running
docker compose ps

# View logs
docker compose logs -f

# Test health endpoint
curl http://localhost:7050/health
```

**Expected health response:**

```json
{ "status": "ok", "timestamp": "2025-11-04T10:30:00.000Z" }
```

### Step 6: Access Application

Open your browser and navigate to:

```
http://localhost:7050
```

You should see the PostgreSQL Backup Manager interface! 🎉

---

## Local Installation

### Step 1: Install Prerequisites

**Ubuntu/Debian:**

```bash
# Update package list
sudo apt-get update

# Install Node.js 20 LTS
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs

# Install PostgreSQL client tools
sudo apt-get install -y postgresql-client

# Verify installations
node --version   # Should show v20.x.x
yarn --version   # Should show 1.x.x or 4.x.x
pg_dump --version  # Should show PostgreSQL version
```

**macOS:**

```bash
# Install Homebrew if not already installed
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"

# Install Node.js
brew install node@20

# Install Yarn
npm install -g yarn

# Install PostgreSQL client tools
brew install postgresql

# Verify installations
node --version
yarn --version
pg_dump --version
```

**Windows:**

1. **Install Node.js:**

   - Download from https://nodejs.org/
   - Run installer (choose LTS version)
   - Verify: Open CMD and run `node --version`

2. **Install PostgreSQL Client Tools:**
   - Download from https://www.postgresql.org/download/windows/
   - Run installer
   - Select only "Command Line Tools"
   - Add to PATH during installation
   - Verify: Open CMD and run `pg_dump --version`

### Step 2: Download Project

```bash
# Clone repository
git clone <repository-url>
cd postgres-backup

# Or download and extract ZIP, then navigate to folder
```

### Step 3: Install Dependencies

```bash
# Install Node.js packages
yarn install
```

**Expected output:**

```
[1/4] Resolving packages...
[2/4] Fetching packages...
[3/4] Linking dependencies...
[4/4] Building fresh packages...
success Saved lockfile.
Done in 12.34s

found 0 vulnerabilities
```

### Step 4: Configure Environment

```bash
# Create .env file
cp .env.example .env

# Edit .env with your database credentials
nano .env  # or use any text editor
```

Update the database configuration:

```env
DB_HOST=localhost
DB_PORT=5432
DB_USER=postgres
DB_PASSWORD=your_password
DB_NAME=postgres
```

### Step 5: Start Application

```bash
# Start the server
yarn start
```

**Expected output:**

```
PostgreSQL Backup Manager running on http://localhost:7050
Environment: development
```

### Step 6: Access Application

Open your browser and go to:

```
http://localhost:7050
```

---

## Configuration

### Basic Configuration

Minimum required configuration in `.env`:

```env
DB_HOST=your-database-host
DB_PORT=5432
DB_USER=postgres
DB_PASSWORD=your_password
DB_NAME=postgres
```

### Advanced Configuration

#### Configuration Mode

Choose between ENV (environment variables) or Manual (API-based) configuration:

```env
CONFIG_MODE=env  # Default: use .env file (requires restart for changes)
# or
CONFIG_MODE=manual  # Use API to configure at runtime (no restart needed)
```

**ENV Mode (Recommended for Production):**

- Configuration loaded from .env file
- Changes require application restart
- Best for infrastructure-as-code deployments

**Manual Mode (Development/Testing):**

- Configuration set via API calls
- Changes take effect immediately
- Stored in memory (resets on restart)
- Use endpoints: `/api/config/manual/database`, `/api/config/manual/backup`, `/api/config/manual/s3`

#### Enable Auto-Backup

```env
BACKUP_AUTO=true
BACKUP_SCHEDULE=0 2 * * *  # Daily at 2 AM
BACKUP_RETENTION_DAYS=7
BACKUP_FORMAT=sql          # sql or dump
```

#### Configure Database Schema & Exclusions

```env
DB_SCHEMA=public                        # Optional: specific schema
DB_EXCLUDE_TABLES=migrations,sessions   # Optional: exclude tables
```

#### Configure S3 Storage

**AWS S3:**

```env
BACKUP_STORAGE=both  # local, remote, or both

AWS_ACCESS_KEY_ID=AKIA...
AWS_SECRET_ACCESS_KEY=...
AWS_REGION=us-east-1
AWS_S3_BUCKET=my-postgres-backups
AWS_S3_PREFIX=backups/postgres  # Optional: organize in folders
```

**Supabase Storage:**

```env
BACKUP_STORAGE=both

AWS_ACCESS_KEY_ID=your_supabase_access_key
AWS_SECRET_ACCESS_KEY=your_supabase_secret_key
AWS_REGION=us-east-1
AWS_S3_BUCKET=postgres-backups
AWS_S3_PREFIX=production/db     # Optional: organize in folders
AWS_S3_ENDPOINT=https://your-project.supabase.co/storage/v1/s3
AWS_S3_FORCE_PATH_STYLE=true
```

**MinIO:**

```env
BACKUP_STORAGE=both

AWS_ACCESS_KEY_ID=minioadmin
AWS_SECRET_ACCESS_KEY=minioadmin
AWS_REGION=us-east-1
AWS_S3_BUCKET=backups
AWS_S3_PREFIX=postgres-backups  # Optional: organize in folders
AWS_S3_ENDPOINT=http://localhost:9000
AWS_S3_FORCE_PATH_STYLE=true
```

#### Custom Backup Location

```env
BACKUP_LOCAL_PATH=/var/backups/postgres
```

For Docker:

```yaml
# Update docker-compose.yml volumes
volumes:
  - /var/backups/postgres:/app/backups
```

---

## First Run

### 1. Test Database Connection

Before creating backups, verify database connectivity:

```bash
# Test connection (replace with your credentials)
psql -h $DB_HOST -p $DB_PORT -U $DB_USER -d $DB_NAME
```

If successful, you'll see:

```
psql (14.x)
SSL connection (protocol: TLSv1.3, cipher: TLS_AES_256_GCM_SHA384, bits: 256, compression: off)
Type "help" for help.

postgres=>
```

Type `\q` to exit.

### 2. Create First Backup

**Via UI:**

1. Open http://localhost:7050
2. Click "Create Backup" button
3. Wait for success notification
4. See backup appear in table

**Via API:**

```bash
curl -X POST http://localhost:7050/api/backups
```

### 3. Verify Backup

**Check local filesystem:**

```bash
# Docker
docker compose exec backup-app ls -lh /app/backups

# Local
ls -lh ./backups
```

**Check via UI:**

- Statistics should show: Total Backups = 1
- Backup table shows your backup with size and date

### 4. Test Download

Click "Download" button on your backup. The `.sql` file should download.

### 5. Enable Scheduler (Optional)

1. Toggle "Auto-Backup" switch to ON
2. Verify status changes to "Running"
3. Check logs for scheduled execution:

```bash
# Docker
docker compose logs -f

# Local
# Watch console output
```

---

## Verification

### System Health Check

```bash
# Check application health
curl http://localhost:7050/health

# Expected response
{"status":"ok","timestamp":"2025-11-04T10:30:00.000Z"}
```

### Verify All Features

1. **✅ Create Backup** - Click button, backup appears
2. **✅ Download Backup** - File downloads successfully
3. **✅ Delete Backup** - Backup removed from list
4. **✅ Statistics** - Numbers update correctly
5. **✅ Configuration** - Can update database settings
6. **✅ Scheduler** - Can start/stop auto-backup

### Check Logs

**Docker:**

```bash
# View all logs
docker compose logs

# Follow logs in real-time
docker compose logs -f

# View last 50 lines
docker compose logs --tail=50
```

**Local:**

```bash
# Logs appear in console where you ran yarn start
```

Look for:

- ✅ "PostgreSQL Backup Manager running on http://localhost:7050"
- ✅ "Environment: production" (or development)
- ✅ No error messages

---

## Troubleshooting

### Issue: Cannot connect to database

**Symptoms:**

- Error when creating backup
- "Connection refused" or "Connection timeout"

**Solutions:**

1. **Verify credentials:**

   ```bash
   docker compose exec backup-app env | grep DB_
   ```

2. **Test connection manually:**

   ```bash
   psql -h $DB_HOST -p $DB_PORT -U $DB_USER -d $DB_NAME
   ```

3. **Check firewall:**

   - Ensure database port is accessible
   - Check security groups (AWS) or firewall rules

4. **For Supabase IPv6 issue:**

   ```bash
   # Stop Docker
   docker compose down

   # Run locally instead
   yarn install
   yarn start
   ```

### Issue: pg_dump not found

**Symptoms:**

- Error: "pg_dump: command not found"

**Solutions:**

**Docker:** Already included in image. If error persists:

```bash
docker compose down
docker compose build --no-cache
docker compose up -d
```

**Local:**

```bash
# Ubuntu/Debian
sudo apt-get install postgresql-client

# macOS
brew install postgresql

# Windows
# Reinstall PostgreSQL and ensure "Command Line Tools" is selected
```

### Issue: Permission denied

**Symptoms:**

- Error: "EACCES: permission denied"

**Solutions:**

**Docker:**

```bash
# Rebuild with proper permissions
docker compose down
docker compose up -d --build
```

**Local:**

```bash
# Create backups directory with proper permissions
mkdir -p backups
chmod 755 backups
```

### Issue: S3 upload failed

**Symptoms:**

- Backup created locally but not in S3
- Error: "Access Denied" or "Invalid credentials"

**Solutions:**

1. **Verify credentials:**

   ```bash
   docker compose exec backup-app env | grep AWS_
   ```

2. **Test S3 access:**

   ```bash
   # Install AWS CLI
   aws s3 ls s3://your-bucket-name --profile your-profile
   ```

3. **Check endpoint configuration:**
   - For Supabase: Must set `AWS_S3_ENDPOINT` and `AWS_S3_FORCE_PATH_STYLE=true`
   - For MinIO: Same as above
   - For AWS S3: Leave `AWS_S3_ENDPOINT` empty

### Issue: Port 7050 already in use

**Symptoms:**

- Error: "Port 7050 is already in use"

**Solutions:**

**Docker:**

```yaml
# Edit docker-compose.yml
ports:
  - "3001:7050" # Change 3001 to any available port
```

**Local:**

```env
# Edit .env
PORT=3001
```

### Issue: Scheduler not running

**Symptoms:**

- Scheduler shows "Stopped" even after enabling
- No scheduled backups created

**Solutions:**

1. **Check schedule format:**

   ```env
   BACKUP_SCHEDULE=0 2 * * *  # Valid cron format
   ```

2. **Verify auto-backup is enabled:**

   ```env
   BACKUP_AUTO=true
   ```

3. **Restart application:**

   ```bash
   # Docker
   docker compose restart

   # Local
   # Stop with Ctrl+C and run yarn start again
   ```

4. **Check logs for errors:**
   ```bash
   docker compose logs -f | grep scheduler
   ```

---

## Next Steps

After successful installation:

1. **📖 Read the [README](README.md)** for detailed usage instructions
2. **🏗️ Study [ARCHITECTURE.md](ARCHITECTURE.md)** to understand the system
3. **📋 Review [API.md](API.md)** for API endpoint documentation
4. **⚙️ Configure auto-backups** for your needs
5. **🔒 Set up production security** (HTTPS, firewall, etc.)

---

## Support

If you encounter issues not covered here:

1. Check application logs
2. Verify environment variables
3. Test database connection manually
4. Review the [README](README.md) troubleshooting section
5. Check the [API.md](API.md) for endpoint usage examples

---

**Congratulations! You've successfully installed PostgreSQL Backup Manager! 🎉**
