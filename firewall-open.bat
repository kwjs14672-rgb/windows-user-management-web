@echo off
rem ===================================================================
rem Windows 用户远程管理系统 - 防火墙放行脚本
rem 作用: 放行 TCP 端口，允许局域网/其他电脑访问本服务
rem 用法: 以管理员身份运行  firewall-open.bat
rem ===================================================================

echo [1/2] 正在检查管理员权限...
net session >nul 2>&1
if %errorlevel% neq 0 (
    echo 错误: 请以管理员身份运行本脚本！
    pause
    exit /b 1
)

echo [2/2] 正在放行端口 3000 和 8080...
netsh advfirewall firewall delete rule name="WindowsUserManager Web (3000)" >nul 2>&1
netsh advfirewall firewall add rule name="WindowsUserManager Web (3000)" dir=in action=allow protocol=TCP localport=3000 >nul 2>&1

netsh advfirewall firewall delete rule name="WindowsUserManager Web (8080)" >nul 2>&1
netsh advfirewall firewall add rule name="WindowsUserManager Web (8080)" dir=in action=allow protocol=TCP localport=8080 >nul 2>&1

echo.
echo 完成！防火墙已放行端口 3000 和 8080。
echo 其他电脑现在可以通过 http://本机IP:端口 访问本服务了。
echo 查看本机 IP: ipconfig
echo.
pause
