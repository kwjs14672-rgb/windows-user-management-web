# Windows 用户远程管理系统 - frp 客户端自动配置脚本
# 由安装程序调用：自动生成 frpc.toml、统一服务端口 8080、注册开机自启、立即启动
# 用法: powershell -ExecutionPolicy Bypass -File setup-frpc.ps1 -ServerIP "公网服务器IP" -ServerPort 7000 -LocalPort 8080 -MachineNo 1
# 说明:
#   - 不传 -Token 时自动生成随机 token（与 frps.toml 中配置的 token 需保持一致）
#   - -MachineNo 为第几台机器：第1台公网端口8080/代理wum-web，第2台8081/wum-web-2，以此类推自动避让

param(
    [string]$ServerIP = "127.0.0.1",
    [int]$ServerPort = 7000,
    [string]$Token = "",
    [int]$LocalPort = 8080,
    [int]$MachineNo = 1
)

$ErrorActionPreference = 'Stop'

# token 为空时自动生成随机 token
if ([string]::IsNullOrWhiteSpace($Token)) {
    $Token = -join ((48..57) + (65..90) + (97..122) | Get-Random -Count 24 | ForEach-Object { [char]$_ })
}

# 机器号修正（1~99）
if ($MachineNo -lt 1) { $MachineNo = 1 }
if ($MachineNo -gt 99) { $MachineNo = 99 }

# 根据机器号计算公网端口和代理名
$PublicPort = 8080 + ($MachineNo - 1)
if ($MachineNo -le 1) {
    $ProxyName = "wum-web"
} else {
    $ProxyName = "wum-web-$MachineNo"
}

$appDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$frpDir = Join-Path $appDir 'frp'
$frpcExe = Join-Path $frpDir 'frpc.exe'
$frpcCfg = Join-Path $frpDir 'frpc.toml'
$configDir = Join-Path $appDir 'config'
$adminCfg = Join-Path $configDir 'admin_config.json'

# 0. 统一服务端口为 8080（与 frpc localPort 一致，保证公网可达）
try {
    if (Test-Path $adminCfg) {
        $cfgRaw = [System.IO.File]::ReadAllText($adminCfg, [System.Text.Encoding]::UTF8).TrimStart([char]0xFEFF)
        $cfg = $cfgRaw | ConvertFrom-Json
        if (-not $cfg.settings) { $cfg | Add-Member -NotePropertyName settings -NotePropertyValue @{} }
        if ($cfg.settings.port -ne 8080) {
            $cfg.settings | Add-Member -NotePropertyName port -NotePropertyValue 8080 -Force
            $newJson = $cfg | ConvertTo-Json -Depth 10
            [System.IO.File]::WriteAllText($adminCfg, $newJson, (New-Object System.Text.UTF8Encoding $false))
        }
    }
} catch {
    Write-Output "WARN: 设置服务端口失败（不影响安装，可手动改）: $($_.Exception.Message)"
}

# 1. 生成配置文件（无 BOM UTF-8）
$config = @"
serverAddr = "$ServerIP"
serverPort = $ServerPort
auth.token = "$Token"

[[proxies]]
name = "$ProxyName"
type = "tcp"
localIP = "127.0.0.1"
localPort = $LocalPort
remotePort = $PublicPort
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

Write-Output "OK: frpc configured ($ServerIP`:$ServerPort -> local $LocalPort, public $PublicPort, proxy $ProxyName)"
Write-Output "提示: 请确保 frps 服务端 frps.toml 中的 token 与此一致: $Token"
Write-Output "公网访问地址: http://$ServerIP`:$PublicPort"
exit 0
