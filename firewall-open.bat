@echo off
rem ===================================================================
rem Windows 用户远程管理系统 - 防火墙放行脚本
rem 作用: 放行 TCP 端口，允许局域网/其他电脑访问本服务
rem 用法: 以管理员身份运行  firewall-open.bat
rem 参数: /S 静默模式（安装程序调用，不暂停）
rem ===================================================================

net session >nul 2>&1
if %errorlevel% neq 0 (
    echo 错误: 请以管理员身份运行本脚本！
    if /i not "%~1"=="/S" pause
    exit /b 1
)

echo 正在放行端口 3000 和 8080...
netsh advfirewall firewall delete rule name="WindowsUserManager Web (3000)" >nul 2>&1
netsh advfirewall firewall add rule name="WindowsUserManager Web (3000)" dir=in action=allow protocol=TCP localport=3000 >nul 2>&1

netsh advfirewall firewall delete rule name="WindowsUserManager Web (8080)" >nul 2>&1
netsh advfirewall firewall add rule name="WindowsUserManager Web (8080)" dir=in action=allow protocol=TCP localport=8080 >nul 2>&1

echo 完成！防火墙已放行端口 3000 和 8080。
if /i not "%~1"=="/S" (
    echo.
    pause
)
exit /b 0
