@echo off
rem Run without building (needs Python 3.8+). Address http://localhost:port is printed here.
cd /d "%~dp0"
where python >nul 2>nul || (echo Python not found. Use portable\Chistilshik.exe & pause & exit /b 1)
python "%~dp0cleaner.py"
pause
