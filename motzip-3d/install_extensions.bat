@echo off
REM Build CUDA extensions for TRELLIS using MSVC
call "C:\Program Files\Microsoft Visual Studio\2022\Community\VC\Auxiliary\Build\vcvars64.bat"
cd /d "%~dp0\TRELLIS"
call .venv\Scripts\activate.bat
set DISTUTILS_USE_SDK=1
set MSSdk=1
set MAX_JOBS=4
set TORCH_CUDA_ARCH_LIST=8.6

echo === Installing diffoctreerast ===
uv pip install --no-build-isolation "..\extensions\diffoctreerast"

echo === Installing diff-gaussian-rasterization (mip-splatting) ===
uv pip install --no-build-isolation "..\extensions\mip-splatting\submodules\diff-gaussian-rasterization"
