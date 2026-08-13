@echo off
rem ===================================================================
rem Windows 用户远程管理系统 - 开机自启安装脚本（计划任务方式）
rem 作用: 开机自动启动服务（无需登录，后台静默运行）
rem 用法: 以管理员身份运行  autostart-install.bat
rem 参数: /S 静默模式（安装程序调用，不暂停）
rem ===================================================================

net session >nul 2>&1
if %errorlevel% neq 0 (
    echo 错误: 请以管理员身份运行本脚本！
    if /i not "%~1"=="/S" pause
    exit /b 1
)

set APP_DIR=%~dp0
set APP_EXE=%APP_DIR%windows-user-management-web.exe

if not exist "%APP_EXE%" (
    echo 错误: 找不到 %APP_EXE%
    if /i not "%~1"=="/S" pause
    exit /b 1
)

set TASK_XML=%TEMP%\wum_task.xml

(
echo ^<?xml version="1.0" encoding="UTF-16"?^>
echo ^<Task version="1.2" xmlns="http://schemas.microsoft.com/windows/2004/02/mit/task"^>
echo   ^<RegistrationInfo^>
echo     ^<Date^>2026-08-13T00:00:00^</Date^>
echo     ^<Author^>Administrator^</Author^>
echo     ^<URI^>\WindowsUserManager^</URI^>
echo   ^</RegistrationInfo^>
echo   ^<Triggers^>
echo     ^<BootTrigger^>
echo       ^<Enabled^>true^</Enabled^>
echo     ^</BootTrigger^>
echo   ^</Triggers^>
echo   ^<Principals^>
echo     ^<Principal id="Author"^>
echo       ^<UserId^>S-1-5-18^</UserId^>
echo       ^<RunLevel^>HighestAvailable^</RunLevel^>
echo     ^</Principal^>
echo   ^</Principals^>
echo   ^<Settings^>
echo     ^<MultipleInstancesPolicy^>IgnoreNew^</MultipleInstancesPolicy^>
echo     ^<DisallowStartIfOnBatteries^>false^</DisallowStartIfOnBatteries^>
echo     ^<StopIfGoingOnBatteries^>false^</StopIfGoingOnBatteries^>
echo     ^<Enabled^>true^</Enabled^>
echo     ^<ExecutionTimeLimit^>PT0S^</ExecutionTimeLimit^>
echo   ^</Settings^>
echo   ^<Actions Context="Author"^>
echo     ^<Exec^>
echo       ^<Command^>%APP_EXE%^</Command^>
echo     ^</Exec^>
echo   ^</Actions^>
echo ^</Task^>
) > "%TASK_XML%"

schtasks /Delete /TN "WindowsUserManager" /F >nul 2>&1
schtasks /Create /TN "WindowsUserManager" /XML "%TASK_XML%" /F
if %errorlevel% neq 0 (
    echo 错误: 任务计划创建失败！
    if /i not "%~1"=="/S" pause
    exit /b 1
)

del "%TASK_XML%" >nul 2>&1

echo 完成！已设置开机自启（任务名: WindowsUserManager）。
if /i not "%~1"=="/S" (
    echo.
    echo 立即启动: schtasks /Run /TN "WindowsUserManager"
    echo 取消自启: schtasks /Delete /TN "WindowsUserManager" /F
    echo.
    pause
)
exit /b 0
