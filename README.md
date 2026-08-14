# 云枢远程管理系统（Windows 用户远程管理系统）

基于 Node.js + Express 的 Windows 用户远程管理 Web 应用，通过浏览器远程管理 Windows 服务器上的用户账户、密码和会话。支持**局域网**与**公网**任意电脑通过浏览器访问控制。

全新 **v2.2.0**：「云枢」品牌界面重构 + 性能大幅优化 + 多机器自动端口分配。

## 功能特性

- 👤 **账号管理**：查看用户列表、修改密码、添加用户、重命名用户、启用/禁用、用户前缀批量管理
- 🔐 **会话管理**：查看活动会话、强制断开/注销远程用户
- 🛡️ **多管理员**：支持多个管理员账户，独立密码管理
- ⏰ **授权管理**：按时间段控制用户使用权限，到期自动禁用下线
  - 开始时间默认当前时间
  - **授权天数输入**：结束时间自动换算 = 开始时间 + 天数 × 24 小时，实时联动
- 🛡️ **安全中心**：账户安全检查、管理员权限验证、操作日志、**账户权限设置（每账户电源关机可用开关）**
- 🖥️ **开机自启**：安装时可选设置开机自启（计划任务方式，无需登录）
- 🌐 **公网访问**：安装包内置 frp 内网穿透，一键开通公网访问
- 🚀 **性能优化**：gzip 压缩、CSS 缓存、用户/会话列表内存缓存（选项卡秒开）
- 🖥️ **多机器部署**：安装向导填写「第几台机器」自动分配独立公网端口，多台互不冲突

## 快速开始

### 方式一：安装包（推荐，Windows 用户）

下载 `WindowsUserManager-Setup-2.2.0.exe`，双击安装：

1. 附加任务页勾选（默认全选）：
   - ✅ 放行防火墙端口（允许其他电脑访问）
   - ✅ 设置开机自启（开机自动运行）
   - ✅ 启用公网访问（内网穿透）
2. 公网配置页填写（已预填默认值）：
   - **frp 公网服务器 IP**：已预填，一般不用改
   - **frp token**：已预填，直接下一步
   - **第几台机器**：默认 1；多台部署时依次填 2、3、4...（自动分配公网端口 8081、8082、8083...）
3. 安装完成自动启动服务、配置公网隧道、设置开机自启

安装后：

- 本机访问：`http://localhost:8080`
- 公网访问：`http://你的公网服务器IP:8080`（第 1 台）/ `:8081`（第 2 台）...
- 默认账户：`administrator`，初始密码：`admin123`（**首次登录后请立即修改**）

### 方式二：源码运行

```bash
# 环境要求：Node.js 18+
npm install
npm start

# 浏览器访问
http://localhost:8080
```

默认管理员账户：`administrator`，初始密码：`admin123`

> 源码运行默认端口 3000（可用环境变量 `PORT` 覆盖）；安装包模式默认 8080。修改端口见下文。

## 多机器部署（公网端口自动分配）

安装向导填写「第几台机器」，系统自动分配独立公网端口和 frp 代理名：

| 机器序号 | 公网访问地址 | frp 代理名 |
|---|---|---|
| 第 1 台 | `http://服务器IP:8080` | wum-web |
| 第 2 台 | `http://服务器IP:8081` | wum-web-2 |
| 第 3 台 | `http://服务器IP:8082` | wum-web-3 |
| ... | 以此类推 | 以此类推 |

规则：**公网端口 = 8080 + (机器序号 - 1)**。服务器需放行对应端口段（如 `ufw allow 8080:8090/tcp`）。

## 修改端口

配置文件 `config/admin_config.json` 的 `settings` 中添加：

```json
{
  "settings": {
    "port": 9000
  }
}
```

重启服务生效（安装包模式：`schtasks /Run /TN "WindowsUserManager"`）。

⚠️ 修改端口后需同步：防火墙放行新端口、frpc.toml 的 localPort、公网隧道 remotePort。详见《端口设置说明书》。

## 局域网访问

1. 安装时勾选"放行防火墙端口"（或手动运行 `firewall-open.bat`）
2. 查看本机 IP：`ipconfig`，记下 IPv4 地址（如 `192.168.1.100`）
3. 其他电脑访问：`http://192.168.1.100:8080`

启动时的控制台会直接显示所有可用的局域网访问地址。

## 公网访问（frp 内网穿透）

系统通过 [frp](https://github.com/fatedier/frp) 实现内网穿透，让互联网上任意电脑都能访问管理界面。

### 架构

```
任意电脑/手机 ──> http://公网服务器IP:8080 ──> frps(公网服务器) ──> frp隧道 ──> 本机8080
```

### 一体化安装包方式（最简单）

安装时勾选"启用公网访问"，填写公网服务器 IP、token、机器序号即可，安装程序自动完成：
- 统一服务端口 8080
- 生成 `frp/frpc.toml` 客户端配置（自动分配代理名和公网端口）
- 注册 `WumFrpc` 开机自启任务
- 立即启动隧道

### 手动方式（自建 frp 服务端）

**① 公网服务器（Linux）安装 frps：**

```bash
wget -O frp.tar.gz "https://ghfast.top/https://github.com/fatedier/frp/releases/download/v0.61.1/frp_0.61.1_linux_amd64.tar.gz"
tar -xzf frp.tar.gz && mv frp_0.61.1_linux_amd64 /opt/frp

cat > /opt/frp/frps.toml <<'EOF'
bindPort = 7000
auth.method = "token"
auth.token = "换成你的随机token"
EOF

# systemd 开机自启
cat > /etc/systemd/system/frps.service <<'EOF'
[Unit]
Description=FRP Server
After=network.target
[Service]
Type=simple
ExecStart=/opt/frp/frps -c /opt/frp/frps.toml
Restart=on-failure
RestartSec=5
[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload && systemctl enable frps && systemctl start frps
```

放行端口：`ufw allow 7000/tcp && ufw allow 8080:8090/tcp`（云服务器还需在安全组放行）

**② 本机 frpc 客户端：**

编辑 `C:\Program Files\WindowsUserManager\frp\frpc.toml`（第 2 台示例）：

```toml
serverAddr = "你的公网服务器IP"
serverPort = 7000
auth.token = "和frps.toml里一样的token"

[[proxies]]
name = "wum-web-2"        # 第 2 台用 wum-web-2，避免和第一台冲突
type = "tcp"
localIP = "127.0.0.1"
localPort = 8080
remotePort = 8081         # 第 2 台公网端口
```

启动：`schtasks /Run /TN "WumFrpc"`（已注册开机自启）

**③ 完成后：** 任何电脑访问 `http://你的公网服务器IP:8081`

## 开机自启

安装包模式自动注册两个计划任务：

| 任务名 | 作用 |
|---|---|
| `WindowsUserManager` | 主服务开机自启 |
| `WumFrpc` | frp 公网隧道开机自启 |

常用命令：

```bash
schtasks /Run /TN "WindowsUserManager"    # 立即启动主服务
schtasks /Run /TN "WumFrpc"               # 立即启动隧道
schtasks /Delete /TN "WindowsUserManager" /F   # 取消自启
```

## 常见问题（FAQ）

### 登录提示"用户名或密码错误"

- 默认账户 `administrator`，密码 `admin123`（区分大小写）
- 忘记密码：停止服务 → 编辑 `config/admin_config.json`，将 `passwordHash` 改为 `698d51a19d8a121ce581499d7b701668` → 启动服务 → 用 `admin123` 登录后改密

### 程序启动后立即退出 / 端口被占用

- 日志：`logs/app.log`（exe 同目录）
- 端口被占用：修改 `config/admin_config.json` 的 `settings.port`
- 排查：`netstat -ano | findstr :8080`

### 其他电脑访问不了

- 确认防火墙已放行（`firewall-open.bat`）
- 确认访问 `http://本机IP:8080` 而不是 `localhost`
- 确认两台电脑同一局域网

### 公网访问不了

- 本机验证隧道：`netstat -ano | findstr 7000` 应有 ESTABLISHED
- 服务器验证：`systemctl status frps` 应 active (running)
- 确认云安全组已放行 7000/8080（多台机器还需放行对应端口段）
- 确认 frpc.toml 的 token 与 frps.toml 一致
- 多台机器确认公网端口不重复（代理名冲突会报 `already exists`）

### 页面打开慢

- v2.2.0 已内置优化：gzip 压缩、CSS 7 天缓存、用户/会话列表内存缓存
- 若仍慢：Ctrl+F5 强制刷新清缓存，或检查机器 CPU/内存占用

## 目录结构

```
├── server.js              # 主服务器入口
├── service-manager.js     # Windows 服务管理
├── installer.iss          # Inno Setup 安装脚本
├── firewall-open.bat      # 防火墙放行脚本
├── autostart-install.bat  # 开机自启安装脚本（bat 版）
├── autostart-install.ps1  # 开机自启安装脚本（PowerShell 版，安装器使用）
├── setup-frpc.ps1         # frp 客户端自动配置脚本（安装器调用，支持多机器端口分配）
├── build-with-defaults.bat# 本地编译脚本（预填服务器 IP/token，勿提交）
├── config/                # 配置文件（运行时生成，不提交）
├── frp/                   # frp 客户端（安装包内置）
├── src/
│   ├── config/            # 配置与授权逻辑
│   ├── routes/            # 路由定义
│   ├── services/          # 业务服务（管理员、会话）
│   └── utils/             # 工具函数（用户、会话、日志、密码、JSON）
├── views/                 # EJS 页面模板
└── public/                # 静态资源（CSS：nova.css 主题）
```

## 安全说明

- 密码使用 SHA-256 加盐哈希存储（Node.js 内置 crypto，无外部依赖）
- 会话使用 HttpOnly Cookie + SameSite=Strict
- 内置 CSRF 同源校验，拦截跨域写请求
- 所有写操作（改密码、增删用户等）均记录操作日志
- 安全中心提供账户安全检查、管理员权限验证
- **公网暴露前请务必修改默认密码！**

## 技术栈

- **后端**：Node.js + Express 4
- **模板**：EJS
- **系统交互**：Node 内置 child_process（wmic/net/quser 等 Windows 命令）
- **开机自启**：Windows 计划任务
- **公网穿透**：frp
- **界面**：原创 NOVA 主题（深空蓝黑侧边导航 + 白卡片工作区）

## 许可证

[MIT](LICENSE)

## 免责声明

本项目仅用于合法的服务器管理场景。请确保您有权限管理目标服务器，并在使用前了解相关法律法规。因使用本项目产生的一切后果由使用者自行承担。
