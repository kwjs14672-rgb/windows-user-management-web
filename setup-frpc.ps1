# Windows 用户远程管理系统 - frp 客户端自动配置脚本
# 由安装程序调用：自动生成 frpc.toml、注册开机自启、立即启动
# 用法: powershell -ExecutionPolicy Bypass -File setup-frpc.ps1 -ServerIP "公网服务器IP" -ServerPort 7000 -LocalPort 8080
# 说明: 不传 -Token 时自动生成随机 token（与 frps.toml 中配置的 token 需保持一致）

param(
    [string]$ServerIP = "127.0.0.1",
    [int]$ServerPort = 7000,
    [string]$Token = "",
    [int]$LocalPort = 8080
)

$ErrorActionPreference = 'Stop'

# token 为空时自动生成随机 token
if ([string]::IsNullOrWhiteSpace($Token)) {
    $Token = -join ((48..57) + (65..90) + (97..122) | Get-Random -Count 24 | ForEach-Object { [char]$_ })
}

$appDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$frpDir = Join-Path $appDir 'frp'
$frpcExe = Join-Path $frpDir 'frpc.exe'
$frpcCfg = Join-Path $frpDir 'frpc.toml'

# 1. 生成配置文件（无 BOM UTF-8）
$config = @"
serverAddr = "$ServerIP"
serverPort = $ServerPort
auth.token = "$Token"

[[proxies]]
name = "wum-web"
type = "tcp"
localIP = "127.0.0.1"
localPort = $LocalPort
remotePort = $LocalPort
"@

New-Item -ItemType Directory -Path $frpDir -Force | Out-Null
[System.IO.File]::WriteAllText($frpcCfg, $config, (New-Object System.Text.UTF8Encoding $false))

# 2. 注册开机自启任务
try { Unregister-ScheduledTask -TaskName "WumFrpc" -Confirm:$false -ErrorAction SilentlyContinue } catch {}
$action = New-ScheduledTaskAction -Execute $frpcExe -Argument "-c `"$frpcCfg`""
$trigger = New-ScheduledTaskTrigger -AtStartup
$principal = New-ScheduledTaskPrincipal -UserId "SYSTEM" -LogonType ServiceAccount -RunLevel Highest
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -ExecutionTimeLimit ([TimeSpan]::Zero) -MultipleInstances IgnoreNew
Register-ScheduledTask -TaskName "WumFrpc" -Action $action -Trigger $trigger -Principal $principal -Settings $settings -Force | Out-Null

# 3. 立即启动 frpc
Start-Process -FilePath $frpcExe -ArgumentList "-c", $frpcCfg -WindowStyle Hidden
Start-Sleep -Seconds 3

Write-Output "OK: frpc configured ($ServerIP`:$ServerPort -> local $LocalPort)"
Write-Output "提示: 请确保 frps 服务端 frps.toml 中的 token 与此一致: $Token"
exit 0
