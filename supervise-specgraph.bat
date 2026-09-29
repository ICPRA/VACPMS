@echo off
REM Auto-restart supervisor for specgraph (started by start-workbench-stack.bat).
cd /d %USERPROFILE%\specgraph-src
:loop
specgraph.exe serve --config "%USERPROFILE%\project-workbench\specgraph-config.yaml" >> "%USERPROFILE%\project-workbench\logs-specgraph.txt" 2>&1
echo [%date% %time%] specgraph exited, restarting in 5s... >> "%USERPROFILE%\project-workbench\logs-specgraph.txt"
timeout /t 5 /nobreak >nul
goto loop
