# Windows 用户远程管理系统

基于 Node.js + Express 的 Windows 用户远程管理 Web 应用，通过浏览器远程管理 Windows 服务器上的用户账户、密码和会话。

## 功能特性

- 👤 **用户管理**：查看用户列表、修改密码、添加用户、重命名用户、更新用户信息
- 🔐 **会话管理**：查看活动会话、强制断开/注销远程用户、向用户发送消息
- 🛡️ **多管理员**：支持多个管理员账户，独立密码管理
- ⏰ **用户授权**：按时间段管理 Windows 用户的使用授权，到期自动下线
- 📊 **安全体检**：管理员账户审查、操作日志查看
- 🖥️ **Windows 服务**：可注册为 Windows 服务，开机自启

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

### 修改端口

- 环境变量：`set PORT=8080 && npm start`
- 配置文件：在 `config/admin_config.json` 的 `settings` 中添加 `"port": 8080`

### 注册为 Windows 服务

以管理员身份运行：

```bash
node service-manager.js
```

按菜单选择安装/卸载服务。

## 目录结构

```
├── server.js              # 主服务器入口
├── service-manager.js     # Windows 服务管理
├── config/                # 配置文件（admin_config.json 等）
├── src/
│   ├── config/            # 配置与授权逻辑
│   ├── routes/            # 路由定义
│   ├── services/          # 业务服务（管理员、会话）
│   └── utils/             # 工具函数（用户、会话、日志、密码）
├── views/                 # EJS 页面模板
└── public/                # 静态资源（CSS）
```

## 安全说明

- 密码使用 SHA-256 加盐哈希存储（Node.js 内置 crypto，无外部依赖）
- 会话使用 HttpOnly Cookie + SameSite=Strict
- 内置 CSRF 同源校验，拦截跨域写请求
- 所有写操作（改密码、增删用户等）均记录操作日志

## 技术栈

- **后端**：Node.js + Express 4
- **模板**：EJS
- **系统交互**：Node 内置 child_process（wmic/net/quser 等 Windows 命令）
- **Windows 服务**：node-windows

## 许可证

[MIT](LICENSE)

## 免责声明

本项目仅用于合法的服务器管理场景。请确保您有权限管理目标服务器，并在使用前了解相关法律法规。因使用本项目产生的一切后果由使用者自行承担。
