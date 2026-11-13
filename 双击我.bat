@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo.
echo   ============================================
echo    开机第一天 · 一键体检
echo   ============================================
echo.
echo   1/2 读取这台电脑的信息（只读，不改任何设置）...
echo.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0collect.ps1"
if errorlevel 1 (
  echo.
  echo   采集失败。把上面的红字发给帮你弄电脑的人看看。
  pause
  exit /b 1
)
echo.
echo   2/2 生成体检报告...
echo.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0make-report.ps1"
if errorlevel 1 (
  pause
  exit /b 1
)
echo.
echo   完成，报告已经在浏览器里打开了。
echo.
pause
