@echo off
setlocal
REM Stop the workbench stack (specgraph + vite). T3 Code desktop is NOT killed.
for /f "tokens=5" %%a in ('netstat -ano ^| findstr /C:":8690 " ^| findstr LISTENING') do (
  echo [stack] killing specgraph pid %%a
  taskkill /PID %%a /F >nul 2>&1
)
for /f "tokens=5" %%a in ('netstat -ano ^| findstr /C:":5733 " ^| findstr LISTENING') do (
  echo [stack] killing vite pid %%a
  taskkill /PID %%a /F >nul 2>&1
)
echo [stack] stopped.
