; Windows 用户远程管理系统 - 安装脚本 (Inno Setup 6)
; 编译: ISCC.exe installer.iss
; v2.1.0: 一体化安装 - 填公网IP即可，装完自动运行全部服务

#define MyAppName "Windows用户远程管理系统"
#define MyAppVersion "2.1.0"
#define MyAppPublisher "windows-user-management-web"
#define MyAppExeName "windows-user-management-web.exe"

[Setup]
AppId={{8F4E2B1A-9C3D-4E5F-8A6B-7C2D9E1F3A5B}
AppName={#MyAppName}
AppVersion={#MyAppVersion}
AppPublisher={#MyAppPublisher}
DefaultDirName={autopf}\WindowsUserManager
DefaultGroupName={#MyAppName}
OutputDir=installer
OutputBaseFilename=WindowsUserManager-Setup-{#MyAppVersion}
Compression=lzma2
SolidCompression=yes
WizardStyle=modern
PrivilegesRequired=admin
ArchitecturesInstallIn64BitMode=x64compatible
UninstallDisplayIcon={app}\{#MyAppExeName}

[Languages]
Name: "chinesesimplified"; MessagesFile: "compiler:Default.isl"

[Files]
; 主程序 exe
Source: "dist\{#MyAppExeName}"; DestDir: "{app}"; Flags: ignoreversion
; frp 客户端
Source: "..\tools\frp\frp_0.61.1_windows_amd64\frpc.exe"; DestDir: "{app}\frp"; Flags: ignoreversion
; 辅助脚本
Source: "firewall-open.bat"; DestDir: "{app}"; Flags: ignoreversion
Source: "autostart-install.bat"; DestDir: "{app}"; Flags: ignoreversion
Source: "autostart-install.ps1"; DestDir: "{app}"; Flags: ignoreversion
Source: "setup-frpc.ps1"; DestDir: "{app}"; Flags: ignoreversion
Source: "install-service.bat"; DestDir: "{app}"; Flags: ignoreversion
Source: "uninstall-service.bat"; DestDir: "{app}"; Flags: ignoreversion

[Icons]
Name: "{group}\{#MyAppName}"; Filename: "{app}\{#MyAppExeName}"
Name: "{group}\卸载{#MyAppName}"; Filename: "{uninstallexe}"
Name: "{autodesktop}\{#MyAppName}"; Filename: "{app}\{#MyAppExeName}"; Tasks: desktopicon

[Tasks]
Name: "desktopicon"; Description: "创建桌面快捷方式"; GroupDescription: "附加任务:"
Name: "firewall"; Description: "放行防火墙端口（允许其他电脑访问）"; GroupDescription: "附加任务:"
Name: "autostart"; Description: "设置开机自启（开机自动运行）"; GroupDescription: "附加任务:"
Name: "frpc"; Description: "启用公网访问（内网穿透，需填写公网服务器IP）"; GroupDescription: "附加任务:"

[Run]
; 放行防火墙（勾选时）- 直接调用 netsh，避免 bat 卡住
Filename: "netsh.exe"; Parameters: "advfirewall firewall delete rule name=""WindowsUserManager Web (3000)"""; Flags: runhidden; Tasks: firewall; StatusMsg: "正在配置防火墙..."
Filename: "netsh.exe"; Parameters: "advfirewall firewall add rule name=""WindowsUserManager Web (3000)"" dir=in action=allow protocol=TCP localport=3000"; Flags: runhidden; Tasks: firewall
Filename: "netsh.exe"; Parameters: "advfirewall firewall delete rule name=""WindowsUserManager Web (8080)"""; Flags: runhidden; Tasks: firewall
Filename: "netsh.exe"; Parameters: "advfirewall firewall add rule name=""WindowsUserManager Web (8080)"" dir=in action=allow protocol=TCP localport=8080"; Flags: runhidden; Tasks: firewall
; 设置开机自启（勾选时）- 用 PowerShell 注册计划任务
Filename: "{sys}\WindowsPowerShell\v1.0\powershell.exe"; Parameters: "-NoProfile -ExecutionPolicy Bypass -File ""{app}\autostart-install.ps1"""; Flags: runhidden; Tasks: autostart; StatusMsg: "正在设置开机自启..."
; 立即启动主服务（无论是否勾选自启，装完直接可用）
Filename: "{app}\windows-user-management-web.exe"; Flags: runhidden; StatusMsg: "正在启动服务..."
; 配置并启动 frp 公网隧道（勾选时）
Filename: "{sys}\WindowsPowerShell\v1.0\powershell.exe"; Parameters: "-NoProfile -ExecutionPolicy Bypass -File ""{app}\setup-frpc.ps1"" -ServerIP ""{code:GetServerIP}"" -ServerPort 7000 -LocalPort 8080"; Flags: runhidden; Tasks: frpc; StatusMsg: "正在配置公网访问..."
; 启动浏览器打开管理页面
Filename: "http://localhost:8080"; Flags: shellexec runhidden; Description: "打开管理页面"

[UninstallRun]
Filename: "{app}\uninstall-service.bat"; WorkingDir: "{app}"; Flags: runhidden
Filename: "{sys}\schtasks.exe"; Parameters: "/Delete /TN ""WindowsUserManager"" /F"; WorkingDir: "{app}"; Flags: runhidden
Filename: "{sys}\schtasks.exe"; Parameters: "/Delete /TN ""WumFrpc"" /F"; WorkingDir: "{app}"; Flags: runhidden

[Code]
var
  ServerIPPage: TInputQueryWizardPage;

procedure InitializeWizard;
begin
  ServerIPPage := CreateInputQueryPage(wpSelectTasks,
    '公网服务器配置（内网穿透）',
    '请输入您的 frp 公网服务器 IP 地址',
    '本系统通过 frp 内网穿透实现公网访问。' + #13#10 +
    '请填写您有公网 IP 的服务器地址（如已部署 frp 服务端的那台）：' + #13#10 + #13#10 +
    '如果不需要公网访问，取消勾选上一页的"启用公网访问"即可。' + #13#10 + #13#10 +
    '未填写时默认为 127.0.0.1（仅本机可用）。');
  ServerIPPage.Add('frp 公网服务器 IP:', False);
  ServerIPPage.Values[0] := '';
end;

function GetServerIP(Param: String): String;
begin
  Result := ServerIPPage.Values[0];
  if Result = '' then
    Result := '127.0.0.1';
end;

procedure CurStepChanged(CurStep: TSetupStep);
begin
  if CurStep = ssPostInstall then
    MsgBox('安装完成！系统已自动启动。' + #13#10 + #13#10 +
           '默认管理员账户: administrator' + #13#10 +
           '默认密码: admin123' + #13#10 +
           '首次登录后请立即修改密码。' + #13#10 + #13#10 +
           '本机访问: http://localhost:8080' + #13#10 +
           '局域网访问: http://本机IP:8080' + #13#10 +
           '公网访问: http://' + GetServerIP('') + ':8080' + #13#10 + #13#10 +
           '（服务与公网隧道已设置为开机自启）', mbInformation, MB_OK);
end;
