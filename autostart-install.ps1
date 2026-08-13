# Windows 用户远程管理系统 - 开机自启安装脚本 (PowerShell)
# 用法: powershell -ExecutionPolicy Bypass -File autostart-install.ps1
# 作用: 注册计划任务，开机以 SYSTEM 身份启动服务（无窗口）
# 说明: 使用 PowerShell 原生 cmdlet，不依赖外部命令，兼容任何环境

$ErrorActionPreference = 'Stop'

$appDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$appExe = Join-Path $appDir 'windows-user-management-web.exe'

if (-not (Test-Path $appExe)) {
    Write-Output "错误: 找不到 $appExe"
    exit 1
}

# 删除旧任务（忽略错误）
try { Unregister-ScheduledTask -TaskName "WindowsUserManager" -Confirm:$false -ErrorAction SilentlyContinue } catch {}

# 创建计划任务（以 SYSTEM 运行，开机触发，路径带空格也安全）
$action = New-ScheduledTaskAction -Execute $appExe
$trigger = New-ScheduledTaskTrigger -AtStartup
$principal = New-ScheduledTaskPrincipal -UserId "SYSTEM" -LogonType ServiceAccount -RunLevel Highest
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -ExecutionTimeLimit ([TimeSpan]::Zero) -MultipleInstances IgnoreNew

Register-ScheduledTask -TaskName "WindowsUserManager" -Action $action -Trigger $trigger -Principal $principal -Settings $settings -Force | Out-Null

Write-Output "OK: autostart task registered"
exit 0
