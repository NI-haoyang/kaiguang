@echo off
chcp 65001 >nul
rem ============================================
rem  启动服务.bat
rem  只有想用「AI 深读」按钮时才需要它
rem  它会开一个小窗口，关掉窗口就停止
rem ============================================
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo 没有找到 Node.js，跳过。
  echo 直接双击 打开网页.bat 也能看报告，只是没有 AI 深读。
  pause
  exit /b
)
start "" http://127.0.0.1:4173/
node server.mjs
pause
