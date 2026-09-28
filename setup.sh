#!/bin/bash

# DB Backup Manager - Quick Start Script
# This script helps you get started quickly

set -e

echo "======================================"
echo "DB Backup Manager Setup"
echo "======================================"
echo ""

# .env is optional: connections are added from the UI.
if [ ! -f .env ]; then
    echo "📝 Creating .env file from template..."
    cp .env.example .env
    echo "✅ .env file created"
    echo ""
    echo "ℹ️  .env is optional. Database connections can be added from the UI."
    echo "   Edit .env if you want a Default PostgreSQL connection, S3 storage or a schedule."
    echo ""
    read -p "Press Enter to continue..."
fi

# Warn (don't fail) when a database's client tools are missing
check_tools() {
    local label="$1"
    local hint="$2"
    shift 2
    local missing=()
    for tool in "$@"; do
        if ! command -v "$tool" &> /dev/null; then
            missing+=("$tool")
        fi
    done

    if [ ${#missing[@]} -eq 0 ]; then
        echo "  ✅ $label: $*"
    else
        echo "  ⚠️  $label: missing ${missing[*]} (only needed for $label connections)"
        echo "      Install: $hint"
    fi
}

# Ask deployment method
echo "Choose deployment method:"
echo "1) Docker (recommended)"
echo "2) Local development"
echo ""
read -p "Enter choice (1 or 2): " choice

if [ "$choice" = "1" ]; then
    echo ""
    echo "🐳 Starting with Docker..."
    echo ""

    if ! command -v docker &> /dev/null; then
        echo "❌ Docker is not installed. Please install Docker first."
        exit 1
    fi

    if ! docker compose version &> /dev/null; then
        echo "❌ Docker Compose v2 is not available. Please install Docker Compose first."
        exit 1
    fi

    echo "Building Docker image (includes PostgreSQL, MySQL and MongoDB client tools)..."
    docker compose build

    echo ""
    echo "Starting application..."
    docker compose up -d

    echo ""
    echo "✅ Application started successfully!"
    echo ""
    echo "📊 Access the application at: http://localhost:7050"
    echo ""
    echo "Useful commands:"
    echo "  View logs:    docker compose logs -f"
    echo "  Stop app:     docker compose down"
    echo "  Restart app:  docker compose restart"
    echo ""

elif [ "$choice" = "2" ]; then
    echo ""
    echo "💻 Setting up for local development..."
    echo ""

    if ! command -v node &> /dev/null; then
        echo "❌ Node.js is not installed. Please install Node.js 20 LTS first."
        exit 1
    fi

    echo "Checking database client tools:"
    check_tools "PostgreSQL" "apt install postgresql-client | brew install postgresql" pg_dump psql pg_restore
    check_tools "MySQL" "apt install mysql-client | brew install mysql-client" mysqldump mysql
    check_tools "MongoDB" "https://www.mongodb.com/try/download/database-tools" mongodump mongorestore
    echo ""

    echo "Installing dependencies..."
    if command -v yarn &> /dev/null; then
        yarn install
    else
        npm install
    fi

    echo ""
    echo "✅ Setup complete!"
    echo ""
    echo "Starting application..."
    npm start &

    sleep 3

    echo ""
    echo "📊 Access the application at: http://localhost:7050"
    echo ""
    echo "Useful commands:"
    echo "  Development mode: npm run dev"
    echo "  Stop app:         Press Ctrl+C"
    echo ""

else
    echo "❌ Invalid choice. Please run the script again."
    exit 1
fi

echo "======================================"
echo "Setup complete! Happy backing up! 🎉"
echo "======================================"
