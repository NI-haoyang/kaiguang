@echo off
chcp 65001 >nul
cd /d "%~dp0"
set "bad="
for %%F in (ffmpeg.dll libEGL.dll libGLESv2.dll icudtl.dat resources.pak v8_context_snapshot.bin version) do (
  if not exist "%%F" set "bad=1"
)
if not exist "resources\app\app\server.mjs" set "bad=1"
if not exist "resources\app\collect.ps1" set "bad=1"
if defined bad (
  echo.
  echo [X] 这个文件夹不完整，所以打不开。
  echo     当前目录: %CD%
  echo.
  echo     最常见的原因：只把 小白助手.exe 复制出来了，
  echo     或者在压缩软件的预览窗口里直接双击了 exe。
  echo     Windows 只会把 exe 单独解到临时目录，DLL 和 resources 都没跟过来。
  echo.
  echo     正确做法：把整个 zip 解压到一个空文件夹，
  echo     再双击文件夹里的 小白助手.exe。不要单独发 exe。
  echo.
  pause
  exit /b 1
)
echo [OK] 运行文件齐全，正在启动...
start "" "小白助手.exe"
exit /b 0