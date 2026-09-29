@echo off
REM Auto-restart supervisor for vite (started by start-workbench-stack.bat).
set "PATH=%LOCALAPPDATA%\vite-plus\bin;%PATH%"
cd /d %USERPROFILE%\t3code-git\apps\web
:loop
set PORT=5733
set T3CODE_PORT=13774
vp dev >> "%USERPROFILE%\project-workbench\logs-vite.txt" 2>&1
echo [%date% %time%] vite exited, restarting in 5s... >> "%USERPROFILE%\project-workbench\logs-vite.txt"
timeout /t 5 /nobreak >nul
goto loop
