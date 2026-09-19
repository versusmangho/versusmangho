@echo off
chcp 65001 >nul
cd /d "%~dp0"

set PORT=8777

rem python이 없으면 py 런처로 시도
set PY=python
where python >nul 2>nul || set PY=py
where %PY% >nul 2>nul || (
    echo Python을 찾을 수 없습니다. https://www.python.org 에서 설치해 주세요.
    pause
    exit /b 1
)

rem 서버가 뜰 시간을 조금 준 뒤 브라우저를 연다
start "" /b cmd /c "timeout /t 1 /nobreak >nul & start http://localhost:%PORT%/index.html"

rem helper.py = 예전 http.server + 성과 스캔용 키 입력·V-ARCHIVE 업로드 중계 (127.0.0.1에만 열린다)
%PY% helper.py %PORT%
pause
