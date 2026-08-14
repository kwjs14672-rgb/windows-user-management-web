@echo off
rem 注册 Windows 用户远程管理系统为系统服务
set SERVICE_NAME=WindowsUserManager
set APP_EXE=%~dp0windows-user-management-web.exe

rem 如果服务已存在，先删除
sc query %SERVICE_NAME% >nul 2>&1
if %errorlevel%==0 (
  sc stop %SERVICE_NAME% >nul 2>&1
  sc delete %SERVICE_NAME% >nul 2>&1
  timeout /t 2 /nobreak >nul
)

rem 创建服务（自动启动）
sc create %SERVICE_NAME% start= auto binPath= "%APP_EXE%" DisplayName= "Windows User Remote Management" obj= LocalSystem

rem 启动服务
sc start %SERVICE_NAME% >nul 2>&1

echo Service installed: %SERVICE_NAME%
exit /b 0
