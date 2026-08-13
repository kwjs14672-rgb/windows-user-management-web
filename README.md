# Windows 用户远程管理系统

基于 Node.js + Express 的 Windows 用户远程管理 Web 应用，通过浏览器远程管理 Windows 服务器上的用户账户、密码和会话。**支持局域网内任意电脑通过浏览器访问控制。**

## 功能特性

- 👤 **用户管理**：查看用户列表、修改密码、添加用户、重命名用户、更新用户信息
- 🔐 **会话管理**：查看活动会话、强制断开/注销远程用户、向用户发送消息
- 🛡️ **多管理员**：支持多个管理员账户，独立密码管理
- ⏰ **用户授权**：按时间段管理 Windows 用户的使用授权，到期自动下线
- 📊 **安全体检**：管理员账户审查、操作日志查看
- 🖥️ **开机自启**：安装时可选设置开机自启（计划任务方式，无需登录）

## 快速开始

### 环境要求

- Node.js 18+（推荐 20+）
- Windows 7/10/11 或 Windows Server（需管理员权限执行用户管理操作）

### 安装与运行

```bash
# 1. 安装依赖
npm install

# 2. 启动服务
npm start

# 3. 浏览器访问
http://localhost:3000
```

默认管理员账户：`administrator`，初始密码：`admin123`（首次登录后请立即修改）

> 安装包方式：运行 `WindowsUserManager-Setup-x.x.x.exe`，安装时勾选"放行防火墙端口"和"设置开机自启"即可。

## 让其他电脑访问（局域网/远程控制）

程序默认监听 `0.0.0.0`（所有网卡），其他电脑通过浏览器访问即可：

### 1. 局域网访问（最简单）

1. 在运行服务的电脑上放行防火墙（安装时勾选，或手动以管理员运行 `firewall-open.bat`）
2. 查看本机 IP：`ipconfig`，记下 IPv4 地址（如 `192.168.1.100`）
3. 其他电脑浏览器访问：`http://192.168.1.100:3000`

启动时的控制台会直接显示所有可用的局域网访问地址。

### 2. 公网访问（可选，需路由器支持）

- **方案A（端口映射）**：在路由器上把公网端口（如 3000）映射到本机 IP 的 3000 端口，然后通过 `http://公网IP:3000` 访问
- **方案B（内网穿透）**：使用 frp / ngrok / 花生壳 等工具将本机 3000 端口映射到公网
- **注意**：暴露到公网前**务必修改默认密码**，并建议同时修改默认端口

### 3. 修改端口

- 环境变量：`set PORT=8080 && npm start`
- 配置文件：在 `config/admin_config.json` 的 `settings` 中添加 `"port": 8080`（修改后需重启服务）
- 修改端口后，防火墙放行脚本需要同步修改端口号

## 开机自启

### 安装包方式

安装时勾选"设置开机自启"即可。系统会在计划任务中创建 `WindowsUserManager` 任务（以 SYSTEM 身份运行，无需登录）。

### 手动方式

以管理员身份运行 `autostart-install.bat`。

常用命令：

```bash
# 立即启动
schtasks /Run /TN "WindowsUserManager"

# 取消自启
schtasks /Delete /TN "WindowsUserManager" /F
```

## 常见问题（FAQ）

### 登录提示"用户名或密码错误"

- 默认账户是 `administrator`，默认密码 `admin123`（区分大小写）
- 如果之前配置过密码，使用修改后的密码
- 忘记密码时：停止服务 → 编辑 `config/admin_config.json`，将 `passwordHash` 改为 `698d51a19d8a121ce581499d7b701668` → 启动服务 → 用 `admin123` 登录

### 程序启动后立即退出 / 端口被占用

- 日志文件：`logs/app.log`（exe 同目录）
- 端口被占用时修改 `config/admin_config.json` 中的 `settings.port` 换一个端口
- 排查端口占用：`netstat -ano | findstr :3000`

### 其他电脑访问不了

- 确认防火墙已放行（运行 `firewall-open.bat`）
- 确认访问的是 `http://本机IP:端口` 而不是 `localhost`
- 确认两台电脑在同一局域网

## 目录结构

```
├── server.js              # 主服务器入口
├── service-manager.js     # Windows 服务管理
├── firewall-open.bat      # 防火墙放行脚本
├── autostart-install.bat  # 开机自启安装脚本
├── config/                # 配置文件（admin_config.json 等）
├── src/
│   ├── config/            # 配置与授权逻辑
│   ├── routes/            # 路由定义
│   ├── services/          # 业务服务（管理员、会话）
│   └── utils/             # 工具函数（用户、会话、日志、密码、JSON）
├── views/                 # EJS 页面模板
└── public/                # 静态资源（CSS）
```

## 安全说明

- 密码使用 SHA-256 加盐哈希存储（Node.js 内置 crypto，无外部依赖）
- 会话使用 HttpOnly Cookie + SameSite=Strict
- 内置 CSRF 同源校验，拦截跨域写请求
- 所有写操作（改密码、增删用户等）均记录操作日志
- **公网暴露前请务必修改默认密码！**

## 技术栈

- **后端**：Node.js + Express 4
- **模板**：EJS
- **系统交互**：Node 内置 child_process（wmic/net/quser 等 Windows 命令）
- **开机自启**：Windows 计划任务（schtasks）

## 许可证

[MIT](LICENSE)

## 免责声明

本项目仅用于合法的服务器管理场景。请确保您有权限管理目标服务器，并在使用前了解相关法律法规。因使用本项目产生的一切后果由使用者自行承担。
