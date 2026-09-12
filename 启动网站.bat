@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo 正在启动网站，浏览器将自动打开（关闭此窗口即停止）...
start "" cmd /c "timeout /t 3 >nul & start http://localhost:5173/"
npm run dev
