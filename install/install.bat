@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo 正在安装 WPS Excel AI 助手…
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0install-windows.ps1"
if errorlevel 1 (
  echo.
  echo 安装失败。请右键「使用 PowerShell 运行」或查看上方错误。
  pause
  exit /b 1
)
echo.
pause
