@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo Đang tắt bot và trang web...
node bot\local-ctl.mjs shutdown
if exist bot\bot.pid (
  for /f %%p in (bot\bot.pid) do taskkill /F /T /PID %%p >nul 2>&1
  del /q bot\bot.pid >nul 2>&1
)
if exist bot\ui.pid (
  for /f %%p in (bot\ui.pid) do taskkill /F /T /PID %%p >nul 2>&1
  del /q bot\ui.pid >nul 2>&1
)
echo Đã tắt.
timeout /t 3 /nobreak >nul
exit /b 0
