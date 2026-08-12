; Windows 用户远程管理系统 - 安装脚本 (Inno Setup 6)
; 编译: ISCC.exe installer.iss

#define MyAppName "Windows用户远程管理系统"
#define MyAppVersion "2.0.0"
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
; 服务安装/卸载脚本
Source: "install-service.bat"; DestDir: "{app}"; Flags: ignoreversion
Source: "uninstall-service.bat"; DestDir: "{app}"; Flags: ignoreversion

[Icons]
Name: "{group}\{#MyAppName}"; Filename: "{app}\{#MyAppExeName}"
Name: "{group}\卸载{#MyAppName}"; Filename: "{uninstallexe}"
Name: "{autodesktop}\{#MyAppName}"; Filename: "{app}\{#MyAppExeName}"; Tasks: desktopicon

[Tasks]
Name: "desktopicon"; Description: "创建桌面快捷方式"; GroupDescription: "附加任务:"
Name: "installservice"; Description: "注册为 Windows 服务（开机自启）"; GroupDescription: "附加任务:"; Flags: checkedonce

[Run]
; 注册为 Windows 服务（勾选时）
Filename: "{app}\install-service.bat"; WorkingDir: "{app}"; Flags: runhidden; Tasks: installservice; StatusMsg: "正在注册 Windows 服务..."
; 安装后启动服务
Filename: "sc.exe"; Parameters: "start WindowsUserManager"; Flags: runhidden; Tasks: installservice; StatusMsg: "正在启动服务..."
; 启动浏览器打开管理页面
Filename: "http://localhost:3000"; Flags: shellexec runhidden; Description: "打开管理页面"

[UninstallRun]
Filename: "{app}\uninstall-service.bat"; WorkingDir: "{app}"; Flags: runhidden

[Code]
procedure CurStepChanged(CurStep: TSetupStep);
begin
  if CurStep = ssPostInstall then
    MsgBox('安装完成！' + #13#10 + #13#10 +
           '默认管理员账户: administrator' + #13#10 +
           '默认密码: admin123' + #13#10 +
           '请在首次登录后立即修改密码。' + #13#10 + #13#10 +
           '访问地址: http://localhost:3000' + #13#10 +
           '（如已勾选注册服务，系统将开机自启）', mbInformation, MB_OK);
end;
