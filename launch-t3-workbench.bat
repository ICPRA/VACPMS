@echo off
setlocal
REM T3 Code + custom client (project workbench, i18n) launcher.
REM Stock desktop exe - only environment variables are injected; the desktop
REM spawns its own bundled server on T3CODE_PORT. Recheck custom-client
REM compatibility before updating the desktop runtime.
REM
REM Prerequisites:
REM   1. vite dev client on :5733  (from the t3code fork checkout):
REM        cd %USERPROFILE%\t3code-git\apps\web
REM        set PATH=%PATH%;%LOCALAPPDATA%\vite-plus\bin
REM        set PORT=5733&& set T3CODE_PORT=13774&& vp dev
REM   2. SpecGraph on :8690, using the existing Docker database:
REM        %USERPROFILE%\specgraph-src\specgraph.exe serve --config %USERPROFILE%\project-workbench\specgraph-config.yaml
REM      The workbench requires the real /wb API; no mock server is used.

set "VITE_DEV_SERVER_URL=http://localhost:5733"
set "T3CODE_PORT=13774"

netstat -ano | findstr /C:":5733 " | findstr LISTENING >nul
if errorlevel 1 (
  echo [ERROR] vite dev client not on :5733 - start it first ^(see header comments^).
  pause
  exit /b 1
)

echo Starting T3 Code (custom client) ...
start "" "%LOCALAPPDATA%\Programs\t3code\T3 Code (Alpha).exe"
