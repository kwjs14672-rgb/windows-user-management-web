@echo off
cd /d "%~dp0"
echo 远程修改服务器用户密码与资源管理系统 - 服务管理
echo =========================================
echo.

if "%1"=="" (
    echo 请选择以下操作：
    echo 0. 安装依赖 (npm install)
    echo 1. 安装服务
    echo 2. 卸载服务
    echo 3. 检查服务状态
    echo 4. 退出
    echo.
    set /p choice=请输入操作序号：
    node service-manager.js %choice%
) else (
    node service-manager.js %1
)
pause