; Windows 用户远程管理系统 - 安装脚本 (Inno Setup 6)
; 编译: ISCC.exe installer.iss
; v2.1.0: 一体化安装 - 填公网IP即可，装完自动运行全部服务

#define MyAppName "Windows用户远程管理系统"
#define MyAppVersion "2.2.7"
#define MyAppPublisher "windows-user-management-web"
#define MyAppExeName "windows-user-management-web.exe"

; 预填默认值（默认空，本地编译时用 /D 参数注入自己的服务器信息，避免写入开源仓库）
#ifndef MyServerIP
  #define MyServerIP ""
#endif
#ifndef MyToken
  #define MyToken ""
#endif

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
; 安装前自动关闭正在运行的旧版程序，避免文件占用导致安装失败
CloseApplications=yes
RestartApplications=no

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
; 注意: 必须加 nowait，否则安装器会一直等待服务退出而卡死
Filename: "{app}\windows-user-management-web.exe"; Flags: runhidden nowait; StatusMsg: "正在启动服务..."
; 配置并启动 frp 公网隧道（勾选时）
; 传 -Token 参数（用户填写的 frps token），留空时脚本自动生成随机值
; 传 -MachineNo（第几台）自动分配公网端口和代理名，避免多台机器冲突
Filename: "{sys}\WindowsPowerShell\v1.0\powershell.exe"; Parameters: "-NoProfile -ExecutionPolicy Bypass -File ""{app}\setup-frpc.ps1"" -ServerIP ""{code:GetServerIP}"" -ServerPort 7000 -LocalPort 8080 -Token ""{code:GetServerToken}"" -MachineNo ""{code:GetMachineNo}"""; Flags: runhidden; Tasks: frpc; StatusMsg: "正在配置公网访问..."
; 启动浏览器打开管理页面
Filename: "http://localhost:8080"; Flags: shellexec runhidden nowait; Description: "打开管理页面"

[UninstallRun]
Filename: "{app}\uninstall-service.bat"; WorkingDir: "{app}"; Flags: runhidden
Filename: "{sys}\schtasks.exe"; Parameters: "/Delete /TN ""WindowsUserManager"" /F"; WorkingDir: "{app}"; Flags: runhidden
Filename: "{sys}\schtasks.exe"; Parameters: "/Delete /TN ""WumFrpc"" /F"; WorkingDir: "{app}"; Flags: runhidden

[Code]

// 杀掉指定名称的进程（忽略错误，进程不存在也没关系）
procedure KillProcessByName(ExeName: string);
var
  ResultCode: Integer;
begin
  Exec(ExpandConstant('{sys}\taskkill.exe'), '/F /IM ' + ExeName + ' /T', '', SW_HIDE, ewWaitUntilTerminated, ResultCode);
end;

// 安装前（文件复制前）停止旧版服务，确保文件可覆盖
function PrepareToInstall(var NeedsRestart: Boolean): String;
var
  ResultCode: Integer;
begin
  Result := '';
  // 先停止计划任务（旧版以 SYSTEM 身份自启，任务不停可能立即重启进程）
  Exec(ExpandConstant('{sys}\schtasks.exe'), '/End /TN "WindowsUserManager" /F', '', SW_HIDE, ewWaitUntilTerminated, ResultCode);
  Exec(ExpandConstant('{sys}\schtasks.exe'), '/End /TN "WumFrpc" /F', '', SW_HIDE, ewWaitUntilTerminated, ResultCode);
  // 再强制杀掉残留进程
  KillProcessByName('windows-user-management-web.exe');
  KillProcessByName('frpc.exe');
end;

var
  ServerIPPage: TInputQueryWizardPage;

// 根据机器序号计算公网端口（第1台=8080，第2台=8081，第3台=8082...）
function GetMachinePublicPort(MachineNo: Integer): Integer;
begin
  Result := 8080 + (MachineNo - 1);
end;

// 根据机器序号生成 frp 代理名（第1台=wum-web，第2台=wum-web-2...）
function GetMachineProxyName(MachineNo: Integer): String;
begin
  if MachineNo <= 1 then
    Result := 'wum-web'
  else
    Result := 'wum-web-' + IntToStr(MachineNo);
end;

procedure InitializeWizard;
begin
  ServerIPPage := CreateInputQueryPage(wpSelectTasks,
    '公网服务器配置（内网穿透）',
    '请输入您的 frp 公网服务器信息',
    '本系统通过 frp 内网穿透实现公网访问。' + #13#10 +
    '请填写您有公网 IP 的服务器地址（如已部署 frp 服务端的那台）和 frps 服务端配置的 token：' + #13#10 + #13#10 +
    '如果不需要公网访问，取消勾选上一页的"启用公网访问"即可。' + #13#10 + #13#10 +
    'token 必须与服务器 frps.toml 中的 auth.token 一致，否则隧道连不上。' + #13#10 +
    '未填写时默认为 127.0.0.1（仅本机可用），token 留空则自动生成随机值。');
  ServerIPPage.Add('frp 公网服务器 IP:', False);
  ServerIPPage.Values[0] := '{#MyServerIP}';
  ServerIPPage.Add('frp token（与服务器 frps.toml 一致）:', False);
  ServerIPPage.Values[1] := '{#MyToken}';
  ServerIPPage.Add('这是第几台机器？（自动分配公网端口: 第1台=8080, 第2台=8081...）:', False);
  ServerIPPage.Values[2] := '1';
end;

function GetServerIP(Param: String): String;
begin
  Result := ServerIPPage.Values[0];
  if Result = '' then
    Result := '127.0.0.1';
end;

function GetServerToken(Param: String): String;
begin
  Result := ServerIPPage.Values[1];
end;

function GetMachineNo(Param: String): String;
var
  val: Integer;
begin
  val := StrToIntDef(Trim(ServerIPPage.Values[2]), 1);
  if val < 1 then val := 1;
  if val > 99 then val := 99;
  Result := IntToStr(val);
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
           '公网访问: http://' + GetServerIP('') + ':' + IntToStr(GetMachinePublicPort(StrToIntDef(GetMachineNo(''), 1))) + #13#10 + #13#10 +
           '（服务与公网隧道已设置为开机自启）', mbInformation, MB_OK);
end;
