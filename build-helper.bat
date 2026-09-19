@echo off
rem Keep this file ASCII + CRLF: cmd misreads UTF-8 / LF batch files.
rem Builds helper.py into download\vmh-helper.exe, the helper program the web page offers for download.
rem It runs without a console window and lives in the tray (notification area); icon = helper.ico.
rem Needs: python -m pip install pyinstaller
rem After changing helper.py: bump VERSION, run this, and commit download\vmh-helper.exe with it.
cd /d "%~dp0"

python -m PyInstaller --onefile --noconsole --icon "%~dp0helper.ico" --clean --noconfirm --name vmh-helper --distpath download --workpath build\pyinstaller --specpath build helper.py || (pause & exit /b 1)

rmdir /s /q build
echo.
echo Built download\vmh-helper.exe
pause
