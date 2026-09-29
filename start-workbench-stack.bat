@echo off
setlocal
REM Workbench stack supervisor: starts specgraph + vite under auto-restart
REM supervisors (each in a minimized window), then launches T3 Code.
REM Idempotent: services already listening are left alone.
REM
REM   start-workbench-stack.bat   - start everything
REM   stop-workbench-stack.bat    - stop specgraph + vite (desktop untouched)

set "WB=%USERPROFILE%\project-workbench"
set "T3EXE=%LOCALAPPDATA%\Programs\t3code\T3 Code (Alpha).exe"

netstat -ano | findstr /C:":5733 " | findstr LISTENING >nul
if errorlevel 1 (
  echo [stack] starting vite supervisor ...
  start "wb-vite" /min "%WB%\supervise-vite.bat"
) else (
  echo [stack] vite :5733 already up.
)

netstat -ano | findstr /C:":8690 " | findstr LISTENING >nul
if errorlevel 1 (
  echo [stack] starting specgraph supervisor ...
  start "wb-specgraph" /min "%WB%\supervise-specgraph.bat"
) else (
  echo [stack] specgraph :8690 already up.
)

%SystemRoot%\System32\timeout.exe /t 12 /nobreak >nul
echo [stack] starting T3 Code ...
start "" "%T3EXE%"
