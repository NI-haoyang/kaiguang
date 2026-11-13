@echo off
chcp 65001 >nul
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo 需要先安装 Node.js：https://nodejs.org/
  echo 装好后双击本文件即可。
  pause
  exit /b 1
)
echo 正在准备，稍等一会儿浏览器会自己打开…
node start.mjs
pause
