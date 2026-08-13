const express = require('express');
const fs = require('fs');
const path = require('path');
const app = express();

// 导入模块
const logger = require('./src/utils/logger');
const AdminManager = require('./src/services/adminManager');
const SessionManager = require('./src/services/sessionManager');
const setupRoutes = require('./src/routes/routes');
const setupAdminRoutes = require('./src/routes/adminRoutes');
const setupSecurityRoutes = require('./src/routes/securityRoutes');
const { ensureAdminConfig, loadLogLevelFromConfig, getPort } = require('./src/config/adminConfig');
const { checkAndSyncAllUsersAuthorization, checkActiveSessionsForExpiredAuthorization, updateAuthorizationCheckInterval } = require('./src/config/authorization');
const { getUsersList } = require('./src/utils/userUtils');
const { getActiveSessions, disconnectUser, logoffUser } = require('./src/utils/sessionUtils');

// 从环境变量或配置文件读取端口号
const PORT = getPort();

// 设置全局Content-Type响应头，确保中文正常显示
app.use((req, res, next) => {
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  next();
});
app.use(express.urlencoded({ extended: true })); // 处理表单数据
app.use(express.json()); // 处理JSON数据

// 基础安全中间件：同源校验（CSRF防护）
app.use((req, res, next) => {
  // 仅对写请求（POST/PUT/DELETE）校验同源
  if (['POST', 'PUT', 'DELETE'].includes(req.method)) {
    // 跳过登录接口（登录时无会话，且登录表单为同源提交）
    if (req.path === '/api/admins/login') {
      return next();
    }
    
    const origin = req.headers.origin;
    const referer = req.headers.referer;
    const host = req.headers.host;
    
    // 检查是否有同源信息可验证（非浏览器客户端如curl无Origin，放行）
    if (origin || referer) {
      const source = origin || referer;
      try {
        const sourceHost = new URL(source).host;
        if (sourceHost !== host) {
          logger.warn(`CSRF拦截：跨域请求 ${req.method} ${req.path}，来源 ${source}`);
          return res.status(403).json({
            success: false,
            message: '请求来源不合法，已拦截',
            errorCode: 'CSRF_BLOCKED'
          });
        }
      } catch (e) {
        // URL解析失败，视为非法来源
        return res.status(403).json({
          success: false,
          message: '请求来源不合法，已拦截',
          errorCode: 'CSRF_BLOCKED'
        });
      }
    }
  }
  next();
});

// 全局错误处理中间件
app.use((err, req, res, next) => {
  const errorId = Date.now().toString(36) + Math.random().toString(36).substr(2);
  const errorMessage = `内部服务器错误 [ID: ${errorId}]`;
  
  logger.error(`[${errorId}] 错误发生在 ${req.method} ${req.url}`, err);
  
  // 返回友好的错误信息给客户端
  res.status(500).json({
    success: false,
    message: errorMessage,
    errorId: errorId,
    // 只在开发环境返回详细错误
    stack: process.env.NODE_ENV === 'development' ? err.stack : undefined
  });
});

// 初始化管理员管理器
const adminManager = new AdminManager(logger);

// 读取会话超时设置
let sessionTimeout = 60; // 默认60分钟
try {
  const { ADMIN_CONFIG_PATH } = require('./src/config/adminConfig');
  const fs = require('fs');
  if (fs.existsSync(ADMIN_CONFIG_PATH)) {
    const configData = fs.readFileSync(ADMIN_CONFIG_PATH, 'utf8').replace(/^\uFEFF/, '');
    const config = JSON.parse(configData);
    if (config.settings && config.settings.sessionTimeout) {
      sessionTimeout = config.settings.sessionTimeout;
    }
  }
} catch (error) {
  logger.warn('读取会话超时设置失败，使用默认值:', error.message);
}

// 初始化会话管理器
const sessionManager = new SessionManager(logger, {
  sessionTimeout: sessionTimeout * 60 * 1000 // 转换为毫秒
});

// 进程错误捕获
process.on('uncaughtException', (error) => {
  logger.error('未捕获的异常:', error.stack || error.message);
});

process.on('unhandledRejection', (reason, promise) => {
  logger.error('未处理的Promise拒绝:', reason);
});

// 确保管理员配置文件存在
ensureAdminConfig();

// 认证中间件
function requireAuth(req, res, next) {
  // 对于静态资源、登录页面，不需要认证
  if (req.path === '/login' || req.path.startsWith('/public/')) {
    return next();
  }
  
  // 检查会话ID
  const sessionId = req.headers.cookie?.split(';').find(c => c.trim().startsWith('sessionId='))?.split('=')[1];
  
  // 使用sessionManager验证会话并获取会话信息
  const sessionInfo = sessionManager.validateAndGetSession(sessionId);
  if (sessionInfo) {
    // 将用户名添加到请求对象中，便于后续使用
    req.username = sessionInfo.username;
    
    // 对于API请求，直接继续
    if (req.path.startsWith('/api/')) {
      return next();
    }
    // 对于页面请求，重定向到用户管理页（默认首页）
    if (req.path === '/') {
      return res.redirect('/users');
    }
    return next();
  }
  
  // 对于API请求，返回401 JSON响应而不是重定向
  if (req.path.startsWith('/api/')) {
    return res.status(401).json({
      success: false,
      message: '未授权访问，请先登录',
      errorCode: 'UNAUTHORIZED',
      redirectTo: '/login'
    });
  }
  
  // 对于页面请求，重定向到登录页面
  res.redirect('/login');
}

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(express.static(path.join(__dirname, 'public')));

// API登录路由 - 必须在requireAuth之前定义
app.post('/api/admins/login', (req, res) => {
  const { username, password } = req.body;
  
  try {
    // 使用adminManager验证管理员凭据
    if (adminManager.verifyPassword(username, password)) {
      // 使用sessionManager创建会话
      const sessionId = sessionManager.createSession(username);
      
      // 设置会话cookie
      res.cookie('sessionId', sessionId, {
        httpOnly: true,
        secure: false,
        sameSite: 'strict',
        maxAge: 60 * 60 * 1000 // 60分钟会话超时
      });
      
      // 记录登录成功
      logger.info(`API管理员登录成功: ${username}`);
      
      // 返回成功的JSON响应（不泄露sessionId）
      res.json({
        success: true,
        message: '登录成功',
        username: username
      });
    } else {
      // 记录登录失败
      logger.warn(`API管理员登录失败: ${username} - 密码错误`);
      
      // 返回失败的JSON响应
      res.status(401).json({
        success: false,
        message: '用户名或密码错误',
        errorCode: 'INVALID_CREDENTIALS'
      });
    }
  } catch (error) {
    // 记录错误
    logger.error(`API登录错误: ${error.message}`);
    
    // 返回错误的JSON响应
    res.status(500).json({
      success: false,
      message: '登录过程中发生错误',
      errorCode: 'INTERNAL_ERROR'
    });
  }
});

// 全局应用身份验证中间件，确保需要权限的页面只能在登录后访问
app.use(requireAuth);

// 设置路由
setupRoutes(app, sessionManager, adminManager, requireAuth);

// 管理员路由 - 传递logoffUser函数以支持系统级下线操作
setupAdminRoutes(app, logger, adminManager, sessionManager, requireAuth, logoffUser);
setupSecurityRoutes(app, logger, requireAuth);

// 保存服务器实例为全局变量，防止被垃圾回收
let serverInstance;

// 获取本机所有局域网 IPv4 地址
function getLocalIPs() {
  const os = require('os');
  const interfaces = os.networkInterfaces();
  const ips = [];
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name]) {
      // 只取 IPv4、非内部地址（排除 127.0.0.1）
      if (iface.family === 'IPv4' && !iface.internal) {
        ips.push(iface.address);
      }
    }
  }
  return ips;
}

// 启动服务器
function startServer() {
  console.log('开始启动服务器...');
  // 加载日志级别配置
  loadLogLevelFromConfig();
  
  // 启动服务器，处理端口占用情况
  serverInstance = app.listen(PORT, '0.0.0.0', () => {
    const localIPs = getLocalIPs();
    let lanInfo = '';
    if (localIPs.length > 0) {
      lanInfo = localIPs.map(ip => `局域网访问: http://${ip}:${PORT}`).join('\n');
    } else {
      lanInfo = '（未检测到局域网 IP，仅本机可访问）';
    }
    
    const banner = `==================================================================
服务器运行在 http://localhost:${PORT}
登录地址: http://localhost:${PORT}/login
${lanInfo}
==================================================================
提示: 如需修改端口，请设置环境变量 PORT 或在 admin_config.json 的 settings 中配置 port 字段
其他电脑访问本服务时，请确保 Windows 防火墙已放行端口 ${PORT}（首次安装会自动添加）`;
    
    logger.info(banner);
    // 直接输出到控制台以确保用户看到启动信息
    console.log(banner);
    console.log('服务器已启动，正在监听 0.0.0.0:', PORT);
  });
  
  // 处理端口占用错误
  serverInstance.on('error', (error) => {
    if (error.code === 'EADDRINUSE') {
      const errorMessage = `错误: 端口 ${PORT} 已被占用！
请尝试以下解决方法:
1. 设置环境变量: set PORT=新端口号 && npm start
2. 在 admin_config.json 中配置端口: {"settings": {"port": 新端口号}}
3. 关闭占用该端口的程序`;
      
      logger.error(errorMessage);
      console.error(errorMessage);
      process.exit(1);
    } else {
      logger.error('服务器启动失败:', error);
      console.error('服务器启动失败:', error);
      process.exit(1);
    }
  });
  
  // 监听服务器关闭事件
  serverInstance.on('close', () => {
    console.log('服务器已关闭');
  });
  
  // 监听进程终止信号
  process.on('SIGINT', () => {
    console.log('收到SIGINT信号，正在关闭服务器...');
    serverInstance.close(() => {
      console.log('服务器已关闭，进程退出');
      process.exit(0);
    });
  });
  
  process.on('SIGTERM', () => {
    console.log('收到SIGTERM信号，正在关闭服务器...');
    serverInstance.close(() => {
      console.log('服务器已关闭，进程退出');
      process.exit(0);
    });
  });
  
  console.log('服务器启动函数执行完毕');
}

// 设置定时任务，每小时检查一次
setInterval(() => checkAndSyncAllUsersAuthorization(), 60 * 60 * 1000);
// 服务器启动时立即执行一次检查
setTimeout(() => checkAndSyncAllUsersAuthorization(), 5000);

// 初始设置授权检查间隔
updateAuthorizationCheckInterval(getActiveSessions, disconnectUser, logoffUser);

// 服务器启动时执行一次检查
setTimeout(() => {
  try {
    logger.info('服务器启动时检查活动会话授权状态');
    checkActiveSessionsForExpiredAuthorization(getActiveSessions, disconnectUser, logoffUser);
  } catch (error) {
    console.error('启动时检查活动会话失败:', error);
  }
}, 10000);

// 启动服务器
startServer();
