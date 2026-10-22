@echo off
setlocal
cd /d "%~dp0"
start "" http://localhost:8901
where python >nul 2>nul
if %errorlevel%==0 (
  echo Starting server on http://localhost:8901 ...
  start "TerrainEditorServer" cmd /k python -m http.server 8901 --directory "%~dp0web"
) else (
  echo Python not found on PATH - assuming the VM server is already running.
  echo If the page is blank, start it from the VM:
  echo   cd "%~dp0web" ^&^& python3 -m http.server 8901
)
endlocal
