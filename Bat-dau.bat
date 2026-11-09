@echo off
chcp 65001 >nul
cd /d "%~dp0"

where node >nul 2>&1
if errorlevel 1 (
  echo.
  echo Bạn chưa cài Node.js.
  echo Cần Node 20.19 trở lên. Bản 22.12 trở lên cũng được. Đừng dùng bản 21.
  echo Mình mở trang tải Node. Cài xong thì bấm đúp file này lại.
  echo.
  start https://nodejs.org/en/download
  pause
  exit /b 1
)

if not exist node_modules (
  echo Đang cài thư viện lần đầu. Đợi một chút...
  call npm ci
  if errorlevel 1 (
    echo Cài thư viện thất bại. Kiểm tra mạng rồi bấm đúp file này lại.
    pause
    exit /b 1
  )
)

if not exist .env (
  copy /Y .env.example .env >nul
  echo Mở Notepad. Dán PRIVATE_KEY của ví MỚI, Save, rồi đóng Notepad.
  echo Đừng gửi khoá cho ai. Đừng dán khoá vào trình duyệt.
  notepad .env
)

if not exist logs mkdir logs
if not exist bot mkdir bot
if not exist "bot\.auth-token" (
  node -e "require('fs').writeFileSync('bot/.auth-token', require('crypto').randomBytes(24).toString('hex')+'\n')"
)
set /p BOTTOKEN=<"bot\.auth-token"

node bot\local-ctl.mjs ping
if errorlevel 1 (
  echo Đang bật trang web và bot...
  powershell -NoProfile -Command "$p = Start-Process -FilePath cmd.exe -ArgumentList '/c','npm run bot:server' -WorkingDirectory (Get-Location) -WindowStyle Minimized -PassThru; Set-Content -Path 'bot/bot.pid' -Value $p.Id"
  powershell -NoProfile -Command "$p = Start-Process -FilePath cmd.exe -ArgumentList '/c','npm run dev -- --host 127.0.0.1 --port 5173' -WorkingDirectory (Get-Location) -WindowStyle Minimized -PassThru; Set-Content -Path 'bot/ui.pid' -Value $p.Id"
  node -e "const http=require('http'); let n=0; const t=setInterval(()=>{ n++; const req=http.get('http://127.0.0.1:5173/',res=>{clearInterval(t); process.exit(0)}); req.on('error',()=>{ if(n>50){ clearInterval(t); process.exit(0) } }); req.setTimeout(800,()=>req.destroy()); },500)"
) else (
  echo Bot đã chạy sẵn. Mở trình duyệt.
)

start "" "http://127.0.0.1:5173/#botToken=%BOTTOKEN%"
echo Đã mở trình duyệt. Muốn tắt thì bấm đúp Dung.bat.
timeout /t 4 /nobreak >nul
exit /b 0
