@echo off
REM ============================================================
REM  Vault Ledger v2 - Windows launcher (smart)
REM  Tries PHP, then Node, then Python
REM ============================================================

cd /d "%~dp0"
set PORT=8080
set URL=http://127.0.0.1:%PORT%/index.html

echo Checking what's installed on your system...
echo.

REM --- Try PHP first ---
where php >nul 2>nul
if %errorlevel%==0 (
    echo Found PHP. Starting server on port %PORT%...
    echo.
    echo =========================================================
    echo  Vault Ledger running on %URL%
    echo  Leave this window open while using the app.
    echo  Press Ctrl+C to stop the server when done.
    echo =========================================================
    echo.
    start "" "%URL%"
    php -S 127.0.0.1:%PORT%
    goto :end
)

REM --- Try Node ---
where npx >nul 2>nul
if %errorlevel%==0 (
    echo Found Node. Starting server on port %PORT%...
    echo.
    echo =========================================================
    echo  Vault Ledger running on %URL%
    echo  Leave this window open while using the app.
    echo  Press Ctrl+C to stop the server when done.
    echo =========================================================
    echo.
    start "" "%URL%"
    npx --yes http-server . -p %PORT% -a 127.0.0.1
    goto :end
)

REM --- Try Python ---
where python >nul 2>nul
if %errorlevel%==0 (
    echo Found Python. Starting server on port %PORT%...
    echo.
    echo =========================================================
    echo  Vault Ledger running on %URL%
    echo  Leave this window open while using the app.
    echo  Press Ctrl+C to stop the server when done.
    echo =========================================================
    echo.
    start "" "%URL%"
    python -m http.server %PORT% --bind 127.0.0.1
    goto :end
)

echo ERROR: Could not find PHP, Node, or Python.
pause
exit /b 1

:end
pause