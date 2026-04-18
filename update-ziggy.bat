@echo off
title ZIGGY Updater
echo.
echo  ==========================================
echo   ZIGGY - Update from STAN source
echo  ==========================================
echo.

setlocal

set STAN_SRC=E:\stan\stan
set ZIGGY_DIR=E:\ziggy
set VENV_PYTHON=C:\Users\Admin\STAN\venv\Scripts\python.exe
set NODE=node
set DASHBOARD_SRC=%STAN_SRC%\stan\dashboard
set DASHBOARD_DST=%ZIGGY_DIR%\stan\dashboard

:: ── 1. Pull latest STAN source ──────────────────────────────────────
echo [1/5] Pulling latest STAN source...
pushd "%STAN_SRC%"
git pull origin main
if errorlevel 1 echo   WARNING: git pull failed. Continuing with local copy.
popd

:: ── 2. Rebuild JS bundle from component files ────────────────────────
echo.
echo [2/5] Rebuilding JS bundle...
pushd "%STAN_SRC%"
%NODE% stan/dashboard/build.js
if errorlevel 1 (
    echo   ERROR: JS build failed. Check node is installed and _manifest.json exists.
    goto :done
)
popd

:: ── 3. Sync dashboard files to ZIGGY ─────────────────────────────────
echo.
echo [3/5] Syncing dashboard to ZIGGY...

:: Server backend (ZIGGY's server.py is the source of truth — do NOT overwrite with stan's)
:: copy /Y "%DASHBOARD_SRC%\server.py" "%DASHBOARD_DST%\server.py"

:: Built JS bundle + HTML
copy /Y "%DASHBOARD_SRC%\public\vendor\app.js"  "%DASHBOARD_DST%\public\vendor\app.js" >nul
copy /Y "%DASHBOARD_SRC%\public\index.html"     "%DASHBOARD_DST%\public\index.html" >nul

:: Component source files (for reference / editing on ZIGGY side)
xcopy /Y /E /Q "%DASHBOARD_SRC%\public\components\*" "%DASHBOARD_DST%\public\components\" >nul 2>&1

:: Build script
copy /Y "%DASHBOARD_SRC%\build.js" "%DASHBOARD_DST%\build.js" >nul 2>&1

echo   Frontend synced.

:: ── 4. Sync Python modules ────────────────────────────────────────────
echo.
echo [4/5] Syncing Python modules...
for %%d in (metrics search gating community watcher) do (
    if exist "%STAN_SRC%\stan\%%d" (
        xcopy /Y /E /Q "%STAN_SRC%\stan\%%d\*" "%ZIGGY_DIR%\stan\%%d\" >nul 2>&1
    )
)
for %%f in (db.py config.py cli.py __init__.py) do (
    if exist "%STAN_SRC%\stan\%%f" (
        copy /Y "%STAN_SRC%\stan\%%f" "%ZIGGY_DIR%\stan\%%f" >nul 2>&1
    )
)
echo   Python modules synced.

:: ── 5. Verify ─────────────────────────────────────────────────────────
echo.
echo [5/5] Verifying...
"%VENV_PYTHON%" -c "import stan; print('  STAN version:', stan.__version__)" 2>nul
if errorlevel 1 echo   WARNING: Could not verify STAN version (venv path may differ).

echo.
echo  ==========================================
echo   Update complete! Run ZIGGY.bat to start.
echo  ==========================================
echo.

:done
endlocal
pause
