@echo off
REM Run nvdiffrast install with MSVC environment activated
call "C:\Program Files\Microsoft Visual Studio\2022\Community\VC\Auxiliary\Build\vcvars64.bat"
cd /d "%~dp0\TRELLIS"
call .venv\Scripts\activate.bat
set DISTUTILS_USE_SDK=1
set MSSdk=1
uv pip install --no-build-isolation git+https://github.com/NVlabs/nvdiffrast.git
