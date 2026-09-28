@echo off
setlocal EnableDelayedExpansion
REM DB Backup Manager - Quick Start Script for Windows

echo ======================================
echo DB Backup Manager Setup
echo ======================================
echo.

REM .env is optional: connections are added from the UI.
if not exist .env (
    echo Creating .env file from template...
    copy .env.example .env
    echo .env file created
    echo.
    echo .env is optional. Database connections can be added from the UI.
    echo Edit .env if you want a Default PostgreSQL connection, S3 storage or a schedule.
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

    where docker >nul 2>nul
    if !ERRORLEVEL! NEQ 0 (
        echo Docker is not installed. Please install Docker Desktop first.
        pause
        exit /b 1
    )

    echo Building Docker image ^(includes PostgreSQL, MySQL and MongoDB client tools^)...
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

    where node >nul 2>nul
    if !ERRORLEVEL! NEQ 0 (
        echo Node.js is not installed. Please install Node.js 20 LTS first.
        pause
        exit /b 1
    )

    echo Checking database client tools ^(missing tools only matter for that database type^):
    call :check_tool PostgreSQL pg_dump "https://www.postgresql.org/download/windows/"
    call :check_tool MySQL mysqldump "https://dev.mysql.com/downloads/mysql/"
    call :check_tool MongoDB mongodump "https://www.mongodb.com/try/download/database-tools"
    echo.

    echo Installing dependencies...
    call npm install

    echo.
    echo Setup complete!
    echo.
    echo Starting application...
    start "DB Backup Manager" npm start

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
exit /b 0

:check_tool
where %2 >nul 2>nul
if %ERRORLEVEL% NEQ 0 (
    echo   WARNING: %1 tools not found ^(only needed for %1 connections^). Install: %~3
) else (
    echo   OK: %1 tools found
)
exit /b 0
