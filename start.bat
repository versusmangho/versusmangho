@echo off
rem Keep this file ASCII + CRLF: cmd misreads UTF-8 / LF batch files.
cd /d "%~dp0"

set PORT=8777

rem Fall back to the py launcher when python is not on PATH
set PY=python
where python >nul 2>nul || set PY=py
where %PY% >nul 2>nul || (
    echo Python not found. Install it from https://www.python.org
    pause
    exit /b 1
)

rem Open the browser a moment after the server starts
start "" /b cmd /c "timeout /t 1 /nobreak >nul & start http://localhost:%PORT%/index.html"

rem helper.py = file server + key input / V-ARCHIVE upload relay (127.0.0.1 only)
%PY% helper.py %PORT%
pause
