@echo off
title Install Casanovo GPU (CUDA 12.8 - RTX 5070 / Blackwell)
echo.
echo ============================================================
echo  CASANOVO GPU SETUP - CUDA 12.8 for RTX 5000 series
echo  Requires: NVIDIA driver 595+ (CUDA 13.2 supported)
echo  This replaces CPU-only torch with GPU-accelerated version
echo ============================================================
echo.

set VENV=%~dp0casanovo_env
set PIP=%VENV%\Scripts\pip.exe

if not exist "%PIP%" (
    echo ERROR: casanovo_env not found at %VENV%
    echo Run install_casanovo_cpu.bat first to create the venv.
    pause
    exit /b 1
)

echo [1/3] Checking current torch installation...
"%VENV%\Scripts\python.exe" -c "import torch; print('torch', torch.__version__, '| CUDA:', torch.cuda.is_available(), '| Device:', torch.cuda.get_device_name(0) if torch.cuda.is_available() else 'N/A')"

echo.
echo [2/3] Installing PyTorch with CUDA 12.8 support...
echo (This downloads ~2.5 GB - may take several minutes)
echo.
"%PIP%" install torch torchvision torchaudio --index-url https://download.pytorch.org/whl/cu128

echo.
echo [3/3] Verifying GPU is now available...
"%VENV%\Scripts\python.exe" -c "import torch; cuda_ok = torch.cuda.is_available(); print('CUDA available:', cuda_ok); print('Device:', torch.cuda.get_device_name(0) if cuda_ok else 'No GPU found - check driver'); exit(0 if cuda_ok else 1)"

if errorlevel 1 (
    echo.
    echo WARNING: CUDA still not available after install.
    echo Check: nvidia-smi in a new terminal to verify driver version.
    echo RTX 5070 needs driver 595+ for CUDA 12.8.
) else (
    echo.
    echo SUCCESS: Casanovo will now use GPU acceleration.
    echo RTX 5070 can process ~5000 spectra in under 60 seconds.
)

echo.
pause
