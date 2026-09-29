@echo off
setlocal
node "%~dp0extensions\workbench-desktop\launch.mjs"
set "RESULT=%ERRORLEVEL%"
if not "%RESULT%"=="0" pause
exit /b %RESULT%
