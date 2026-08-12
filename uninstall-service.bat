@echo off
rem 卸载 Windows 用户远程管理系统服务
set SERVICE_NAME=WindowsUserManager

sc query %SERVICE_NAME% >nul 2>&1
if %errorlevel%==0 (
  sc stop %SERVICE_NAME% >nul 2>&1
  timeout /t 2 /nobreak >nul
  sc delete %SERVICE_NAME% >nul 2>&1
  echo Service uninstalled: %SERVICE_NAME%
) else (
  echo Service not found: %SERVICE_NAME%
)
exit /b 0
