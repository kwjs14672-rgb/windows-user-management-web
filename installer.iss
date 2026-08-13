; Windows 用户远程管理系统 - 安装脚本 (Inno Setup 6)
; 编译: ISCC.exe installer.iss

#define MyAppName "Windows用户远程管理系统"
#define MyAppVersion "2.0.1"
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
; 辅助脚本
Source: "firewall-open.bat"; DestDir: "{app}"; Flags: ignoreversion
Source: "autostart-install.bat"; DestDir: "{app}"; Flags: ignoreversion
Source: "install-service.bat"; DestDir: "{app}"; Flags: ignoreversion
Source: "uninstall-service.bat"; DestDir: "{app}"; Flags: ignoreversion

[Icons]
Name: "{group}\{#MyAppName}"; Filename: "{app}\{#MyAppExeName}"
Name: "{group}\卸载{#MyAppName}"; Filename: "{uninstallexe}"
Name: "{autodesktop}\{#MyAppName}"; Filename: "{app}\{#MyAppExeName}"; Tasks: desktopicon

[Tasks]
Name: "desktopicon"; Description: "创建桌面快捷方式"; GroupDescription: "附加任务:"
Name: "firewall"; Description: "放行防火墙端口（允许其他电脑访问）"; GroupDescription: "附加任务:"; Flags: checkedonce
Name: "autostart"; Description: "设置开机自启（开机自动运行）"; GroupDescription: "附加任务:"; Flags: checkedonce

[Run]
; 放行防火墙（勾选时）
Filename: "{app}\firewall-open.bat"; WorkingDir: "{app}"; Flags: runhidden; Tasks: firewall; StatusMsg: "正在配置防火墙..."
; 设置开机自启（勾选时）
Filename: "{app}\autostart-install.bat"; WorkingDir: "{app}"; Flags: runhidden; Tasks: autostart; StatusMsg: "正在设置开机自启..."
; 启动浏览器打开管理页面
Filename: "http://localhost:3000"; Flags: shellexec runhidden; Description: "打开管理页面"

[UninstallRun]
Filename: "{app}\uninstall-service.bat"; WorkingDir: "{app}"; Flags: runhidden
Filename: "schtasks.exe"; Parameters: "/Delete /TN ""WindowsUserManager"" /F"; WorkingDir: "{app}"; Flags: runhidden

[Code]
procedure CurStepChanged(CurStep: TSetupStep);
begin
  if CurStep = ssPostInstall then
    MsgBox('安装完成！' + #13#10 + #13#10 +
           '默认管理员账户: administrator' + #13#10 +
           '默认密码: admin123' + #13#10 +
           '请在首次登录后立即修改密码。' + #13#10 + #13#10 +
           '本机访问: http://localhost:3000' + #13#10 +
           '局域网访问: http://本机IP:3000（需勾选放行防火墙）' + #13#10 +
           '修改端口: 编辑 {app}\config\admin_config.json 中的 settings.port', mbInformation, MB_OK);
end;
