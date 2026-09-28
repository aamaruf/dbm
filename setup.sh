#!/bin/bash

# PostgreSQL Backup Manager - Quick Start Script
# This script helps you get started quickly

set -e

echo "======================================"
echo "PostgreSQL Backup Manager Setup"
echo "======================================"
echo ""

# Check if .env exists
if [ ! -f .env ]; then
    echo "📝 Creating .env file from template..."
    cp .env.example .env
    echo "✅ .env file created"
    echo ""
    echo "⚠️  IMPORTANT: Edit .env file with your database credentials before starting!"
    echo ""
    read -p "Press Enter to continue after editing .env file..."
fi

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
    
    # Check if docker is installed
    if ! command -v docker &> /dev/null; then
        echo "❌ Docker is not installed. Please install Docker first."
        exit 1
    fi
    
    # Check if docker-compose is available
    if ! command -v docker compose &> /dev/null && ! command -v docker-compose &> /dev/null; then
        echo "❌ Docker Compose is not installed. Please install Docker Compose first."
        exit 1
    fi
    
    # Build and start
    echo "Building Docker image..."
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
    
    # Check if node is installed
    if ! command -v node &> /dev/null; then
        echo "❌ Node.js is not installed. Please install Node.js 20 LTS first."
        exit 1
    fi
    
    # Check if pg_dump is available
    if ! command -v pg_dump &> /dev/null; then
        echo "⚠️  PostgreSQL client tools not found!"
        echo ""
        echo "Please install PostgreSQL client tools:"
        echo "  Ubuntu/Debian: sudo apt-get install postgresql-client"
        echo "  macOS:         brew install postgresql"
        echo "  Windows:       Download from https://www.postgresql.org/download/"
        echo ""
        read -p "Continue anyway? (y/n): " continue
        if [ "$continue" != "y" ]; then
            exit 1
        fi
    fi
    
    # Install dependencies
    echo "Installing dependencies..."
    npm install
    
    echo ""
    echo "✅ Setup complete!"
    echo ""
    echo "Starting application..."
    npm start &
    
    # Wait for server to start
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
