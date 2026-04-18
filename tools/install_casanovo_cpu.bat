@echo off
title Install Casanovo CPU-only (no GPU required)
echo.
echo ============================================================
echo  CASANOVO CPU SETUP
echo  For PCs without NVIDIA GPU (or before GPU driver setup)
echo  De novo will work but is slower: ~5-10 min per 1000 spectra
echo ============================================================
echo.

set VENV=%~dp0casanovo_env
set PYTHON=C:\Users\Admin\STAN\venv\Scripts\python.exe

REM Try to find Python 3.12 - Casanovo needs 3.12+
set PYTHON312=
for %%P in (
    "C:\Python312\python.exe"
    "C:\Program Files\Python312\python.exe"
    "C:\Users\Admin\AppData\Local\Programs\Python\Python312\python.exe"
    "%LOCALAPPDATA%\Programs\Python\Python312\python.exe"
) do (
    if exist %%P (
        set PYTHON312=%%P
        goto :found_python
    )
)

:found_python
if "%PYTHON312%"=="" (
    echo ERROR: Python 3.12 not found.
    echo Casanovo requires Python 3.12.
    echo Download from: https://www.python.org/downloads/release/python-3120/
    echo Install to default location, then re-run this script.
    pause
    exit /b 1
)

echo Found Python 3.12 at: %PYTHON312%
echo.

if exist "%VENV%" (
    echo casanovo_env already exists at %VENV%
    echo To reinstall, delete the folder first.
    goto :install_check
)

echo [1/4] Creating Python 3.12 virtual environment...
"%PYTHON312%" -m venv "%VENV%"
if errorlevel 1 (
    echo ERROR: Failed to create venv. Check Python 3.12 installation.
    pause
    exit /b 1
)

:install_check
echo [2/4] Upgrading pip...
"%VENV%\Scripts\python.exe" -m pip install --upgrade pip

echo.
echo [3/4] Installing PyTorch CPU-only (small download ~200 MB)...
"%VENV%\Scripts\pip.exe" install torch --index-url https://download.pytorch.org/whl/cpu

echo.
echo [4/4] Installing Casanovo and dependencies...
"%VENV%\Scripts\pip.exe" install casanovo

echo.
echo Verifying installation...
"%VENV%\Scripts\python.exe" -c "import casanovo; print('casanovo OK'); import torch; print('torch', torch.__version__); import depthcharge; print('depthcharge OK')"

if errorlevel 1 (
    echo.
    echo ERROR: Installation verification failed.
    echo Check the output above for details.
) else (
    echo.
    echo SUCCESS: Casanovo installed (CPU mode).
    echo To upgrade to GPU later, run: install_casanovo_gpu.bat
    echo.
    echo NOTE: For Novor (Java-based alternative), download novor.jar from:
    echo   https://www.rapidnovor.com/ (free academic registration required)
    echo   Place the JAR at: %~dp0novor\novor.jar
)

echo.
pause
