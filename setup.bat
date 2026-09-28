@echo off
REM PostgreSQL Backup Manager - Quick Start Script for Windows

echo ======================================
echo PostgreSQL Backup Manager Setup
echo ======================================
echo.

REM Check if .env exists
if not exist .env (
    echo Creating .env file from template...
    copy .env.example .env
    echo .env file created
    echo.
    echo IMPORTANT: Edit .env file with your database credentials before starting!
    echo.
    pause
)

REM Ask deployment method
echo Choose deployment method:
echo 1^) Docker ^(recommended^)
echo 2^) Local development
echo.
set /p choice="Enter choice (1 or 2): "

if "%choice%"=="1" (
    echo.
    echo Starting with Docker...
    echo.
    
    REM Check if docker is installed
    where docker >nul 2>nul
    if %ERRORLEVEL% NEQ 0 (
        echo Docker is not installed. Please install Docker Desktop first.
        pause
        exit /b 1
    )
    
    REM Build and start
    echo Building Docker image...
    docker compose build
    
    echo.
    echo Starting application...
    docker compose up -d
    
    echo.
    echo Application started successfully!
    echo.
    echo Access the application at: http://localhost:7050
    echo.
    echo Useful commands:
    echo   View logs:    docker compose logs -f
    echo   Stop app:     docker compose down
    echo   Restart app:  docker compose restart
    echo.
    
) else if "%choice%"=="2" (
    echo.
    echo Setting up for local development...
    echo.
    
    REM Check if node is installed
    where node >nul 2>nul
    if %ERRORLEVEL% NEQ 0 (
        echo Node.js is not installed. Please install Node.js 20 LTS first.
        pause
        exit /b 1
    )
    
    REM Check if pg_dump is available
    where pg_dump >nul 2>nul
    if %ERRORLEVEL% NEQ 0 (
        echo WARNING: PostgreSQL client tools not found!
        echo.
        echo Please install PostgreSQL client tools from:
        echo https://www.postgresql.org/download/windows/
        echo.
        set /p continue="Continue anyway? (y/n): "
        if not "%continue%"=="y" exit /b 1
    )
    
    REM Install dependencies
    echo Installing dependencies...
    call npm install
    
    echo.
    echo Setup complete!
    echo.
    echo Starting application...
    start "PostgreSQL Backup Manager" npm start
    
    timeout /t 3 /nobreak >nul
    
    echo.
    echo Access the application at: http://localhost:7050
    echo.
    echo Useful commands:
    echo   Development mode: npm run dev
    echo   Stop app:         Close the console window or press Ctrl+C
    echo.
    
) else (
    echo Invalid choice. Please run the script again.
    exit /b 1
)

echo ======================================
echo Setup complete! Happy backing up!
echo ======================================
pause
