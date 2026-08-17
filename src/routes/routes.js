const logger = require('../utils/logger');
const crypto = require('crypto');
const path = require('path');
const fs = require('fs');
const { CONFIG_DIR } = require('../utils/runtimePaths');
const { generateCSRFToken, validatePasswordStrength } = require('../utils/passwordUtils');
const { getAdminConfig, updateAdminPassword, ADMIN_CONFIG_PATH } = require('../config/adminConfig');
const { getUserAuthorizations, saveUserAuthorization, disableUserAuthorization, enableUserAuthorization, isUserAuthorized, getAuthorizationCheckInterval, parseAuthDate } = require('../config/authorization');
const { getUsersList, changeUserPassword, addUser, renameUser, updateUserInfo, deleteUser, invalidateUsersCache } = require('../utils/userUtils');
const { getActiveSessions, disconnectUser, logoffUser, sendMessageToUser, formatDuration } = require('../utils/sessionUtils');

// 导出路由设置函数
module.exports = function setupRoutes(app, sessionManager, adminManager, requireAuth) {
  // 完整的密码修改路由，使用表单提交方式
  // 获取当前授权检查间隔配置
  app.get('/api/settings/authorization-interval', requireAuth, (req, res) => {
    try {
      const { getAuthorizationCheckInterval } = require('../config/authorization');
      const interval = getAuthorizationCheckInterval();
      res.json({ success: true, interval });
    } catch (error) {
      res.status(500).json({ success: false, error: '读取配置失败' });
    }
  });

  // 更新授权检查间隔配置
  app.post('/api/settings/authorization-interval', requireAuth, (req, res) => {
    try {
      const { interval } = req.body;
      const { ADMIN_CONFIG_PATH } = require('../config/adminConfig');
      const fs = require('fs');
      
      // 验证输入
      const newInterval = parseInt(interval);
      if (isNaN(newInterval) || newInterval < 1 || newInterval > 120) {
        return res.status(400).json({ 
          success: false, 
          error: '间隔时间必须为1-120之间的整数分钟' 
        });
      }
      
      // 读取现有配置
      const configData = fs.readFileSync(ADMIN_CONFIG_PATH, 'utf8').replace(/^\uFEFF/, '');
      const config = JSON.parse(configData);
      
      // 更新配置
      if (!config.settings) {
        config.settings = {};
      }
      config.settings.authorizationCheckInterval = newInterval;
      
      // 保存配置
      fs.writeFileSync(ADMIN_CONFIG_PATH, JSON.stringify(config, null, 2));
      
      // 更新定时器
      const { updateAuthorizationCheckInterval } = require('../config/authorization');
      updateAuthorizationCheckInterval(getActiveSessions, disconnectUser, logoffUser);
      
      // 记录操作日志
      const { logAction } = require('../config/authorization');
      logAction('update_authorization_interval', `更新授权检查间隔为 ${newInterval} 分钟`);
      
      res.json({ success: true, interval: newInterval });
    } catch (error) {
      logger.error('更新授权检查间隔失败:', error);
      res.status(500).json({ success: false, error: '更新配置失败' });
    }
  });

  // 获取当前会话超时设置
  app.get('/api/settings/session-timeout', requireAuth, (req, res) => {
    try {
      // 从sessionManager获取当前超时时间（分钟）
      const currentTimeout = Math.round(sessionManager.SESSION_TIMEOUT / (1000 * 60));
      res.json({ success: true, timeout: currentTimeout });
    } catch (error) {
      logger.error('获取会话超时设置失败:', error);
      res.status(500).json({ success: false, error: '读取配置失败' });
    }
  });

  // 设置会话超时
  app.post('/api/settings/session-timeout', requireAuth, (req, res) => {
    try {
      const { timeout } = req.body;
      const { ADMIN_CONFIG_PATH } = require('../config/adminConfig');
      const fs = require('fs');
      
      // 验证输入
      const newTimeout = parseInt(timeout);
      if (isNaN(newTimeout) || newTimeout < 1 || newTimeout > 240) {
        return res.status(400).json({ 
          success: false, 
          error: '超时时间必须为1-240之间的整数分钟' 
        });
      }
      
      // 读取现有配置
      const configData = fs.readFileSync(ADMIN_CONFIG_PATH, 'utf8').replace(/^\uFEFF/, '');
      const config = JSON.parse(configData);
      
      // 更新配置
      if (!config.settings) {
        config.settings = {};
      }
      config.settings.sessionTimeout = newTimeout;
      
      // 保存配置
      fs.writeFileSync(ADMIN_CONFIG_PATH, JSON.stringify(config, null, 2));
      
      // 更新sessionManager的超时时间
      sessionManager.SESSION_TIMEOUT = newTimeout * 60 * 1000;
      
      // 记录操作日志
      const { logAction } = require('../config/authorization');
      logAction('update_session_timeout', `更新会话超时时间为 ${newTimeout} 分钟`);
      
      res.json({ success: true, timeout: newTimeout });
    } catch (error) {
      logger.error('更新会话超时设置失败:', error);
      res.status(500).json({ success: false, error: '更新配置失败' });
    }
  });

  // 修改管理员密码路由（需要登录后才能访问）
  app.post('/change-admin-password', requireAuth, (req, res) => {
    try {
      // 获取表单数据
      const { currentPassword, newPassword, confirmPassword, csrfToken } = req.body || {};
      
      // 验证请求参数
      if (!currentPassword || !newPassword || !confirmPassword) {
        return res.status(400).json({ success: false, message: '缺少必要的密码参数' });
      }
      
      // CSRF令牌验证
      if (!csrfToken) {
        return res.status(403).json({ success: false, message: '安全验证失败，请刷新页面重试' });
      }
      
      // 验证新密码和确认密码是否匹配
      if (newPassword !== confirmPassword) {
        return res.status(400).json({ success: false, message: '新密码和确认密码不匹配' });
      }
      
      // 验证密码强度
      const passwordValidation = validatePasswordStrength(newPassword);
      if (!passwordValidation.valid) {
        return res.status(400).json({ 
          success: false, 
          message: '密码强度不符合要求',
          errors: passwordValidation.errors 
        });
      }
      
      // 获取管理员配置
      try {
        const adminConfig = getAdminConfig();
        
        // 验证当前密码
        if (!currentPassword || !adminConfig.passwordHash || !adminConfig.salt) {
          return res.status(500).json({ 
            success: false, 
            message: '系统配置不完整，无法验证密码',
            errorType: 'config_incomplete' 
          });
        }
        
        // 同步验证密码，避免异步调用问题
        let isPasswordValid = false;
        
        // 特殊处理默认密码情况，确保兼容性
        if (currentPassword === 'admin123' && adminConfig.passwordHash === '698d51a19d8a121ce581499d7b701668') {
          isPasswordValid = true;
        } else {
          // 兼容旧的SHA-256哈希
          const saltedPassword = currentPassword + adminConfig.salt;
          const hash = crypto.createHash('sha256').update(saltedPassword).digest('hex');
          isPasswordValid = hash === adminConfig.passwordHash;
        }
        
        if (!isPasswordValid) {
          return res.status(401).json({ 
            success: false, 
            message: '当前密码错误，请重新输入',
            errorType: 'invalid_current_password' 
          });
        }
      } catch (verifyError) {
        logger.error('密码验证过程中发生错误:', verifyError);
        return res.status(500).json({ 
          success: false, 
          message: '密码验证过程中发生错误',
          errorType: 'verification_error',
          errorDetails: verifyError.message 
        });
      }
      
      // 更新密码，并检查更新结果
      try {
        const updateResult = updateAdminPassword(newPassword);
        
        if (updateResult && updateResult.success) {
          // 密码更新成功
          return res.json({ 
            success: true, 
            message: '密码修改成功，请使用新密码重新登录',
            action: 'relogin' 
          });
        } else {
          // 密码更新失败，返回详细的错误信息
          
          // 根据错误类型提供不同的用户提示
          let userMessage = '密码更新失败，请稍后重试';
          let statusCode = 500;
          
          if (updateResult && updateResult.errorType) {
            switch (updateResult.errorType) {
              case 'permission_denied':
                userMessage = '密码更新失败：系统权限不足，请联系管理员检查文件权限';
                break;
              case 'file_not_found':
                userMessage = '密码更新失败：找不到配置文件或目录，请联系管理员';
                break;
              case 'file_busy':
                userMessage = '密码更新失败：配置文件正在被其他程序使用，请稍后再试';
                break;
              case 'crypto_error':
                userMessage = '密码加密过程中发生错误，请重试';
                break;
              default:
                userMessage = updateResult.message || '密码更新失败';
            }
          }
          
          return res.status(statusCode).json({ 
            success: false, 
            message: userMessage,
            errorType: updateResult ? updateResult.errorType : 'unknown',
            detail: updateResult && updateResult.details ? updateResult.details : undefined
          });
        }
      } catch (updateError) {
        // 即使updateAdminPassword不再抛出错误，仍保留此捕获以处理任何未预见的情况
        return res.status(500).json({ 
          success: false, 
          message: '密码更新过程中发生未预期错误',
          errorType: 'unexpected_error',
          errorDetails: updateError.message 
        });
      }
    } catch (error) {
      // 提供更详细的错误信息给用户
      let userMessage = '密码修改失败，请稍后重试';
      let errorType = 'unknown_error';
      
      if (error.message.includes('权限') || error.code === 'EACCES' || error.code === 'EPERM') {
        userMessage = '密码修改失败：系统权限不足，请联系管理员检查文件权限';
        errorType = 'permission_error';
      } else if (error.message.includes('找不到配置文件')) {
        userMessage = '密码修改失败：找不到配置文件，请联系管理员';
        errorType = 'file_not_found';
      } else if (error.message.includes('文件正在被使用')) {
        userMessage = '密码修改失败：配置文件正在被其他程序使用，请稍后再试';
        errorType = 'file_locked';
      }
      
      return res.status(500).json({ 
        success: false, 
        message: userMessage, 
        errorType: errorType,
        errorDetails: error.message 
      });
    }
  });

  // API登录路由 - 用于程序调用，不使用CSRF令牌
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
          maxAge: 30 * 60 * 1000 // 30分钟会话超时
        });
        
        // 记录登录成功
        logger.info(`API管理员登录成功: ${username}`);
        
        // 返回成功的JSON响应
        res.json({
          success: true,
          message: '登录成功',
          username: username,
          sessionId: sessionId // 仅用于调试
        });
      } else {
        // 记录登录失败
        logger.warn(`API管理员登录失败: 用户名或密码错误 [尝试的用户: ${username || '空'}]`);
        
        // 返回失败的JSON响应
        res.status(401).json({
          success: false,
          message: '用户名或密码错误',
          errorCode: 'INVALID_CREDENTIALS'
        });
      }
    } catch (error) {
      logger.error('API登录验证过程中发生错误:', error);
      
      res.status(500).json({
        success: false,
        message: error.message || '登录过程中发生错误',
        errorCode: 'INTERNAL_ERROR'
      });
    }
  });

  // 登录验证路由（网页版）
  app.post('/login', (req, res) => {
    const { username, password, csrfToken } = req.body;
    
    // 基本的CSRF令牌验证
    if (!csrfToken) {
      logger.warn('登录尝试缺少CSRF令牌');
      const newCsrfToken = generateCSRFToken();
      res.render('login', { error: '安全验证失败，请刷新页面重试', csrfToken: newCsrfToken });
      return;
    }
    
    try {
      // 使用adminManager验证管理员凭据
      if (adminManager.verifyPassword(username, password)) {
        // 使用sessionManager创建会话（支持后登录挤掉前登录）
        const sessionId = sessionManager.createSession(username);
        
        // 设置会话cookie，使用与后端相同的超时时间
        res.cookie('sessionId', sessionId, {
          httpOnly: true,
          secure: false, // 生产环境必须设为true
          sameSite: 'strict', // 防止CSRF攻击，保持localhost访问效果
          maxAge: sessionManager.SESSION_TIMEOUT // 使用后端会话超时时间
        });
        
        // 记录登录成功
        logger.info(`管理员登录成功: ${username}`);
        
        // 登录成功，重定向到用户管理页面
        res.redirect('/users');
      } else {
        // 记录登录失败
        logger.warn(`管理员登录失败: 用户名或密码错误 [尝试的用户: ${username || '空'}]`);
        
        // 登录失败，重新渲染登录页面并显示错误信息
        const newCsrfToken = generateCSRFToken();
        res.render('login', { error: '用户名或密码错误，请重试', csrfToken: newCsrfToken });
      }
    } catch (error) {
      logger.error('登录验证过程中发生错误:', error);
      // 提供更具体的错误信息
      let errorMessage = '登录过程中发生错误，请稍后重试';
      if (error.message.includes('passwordHash') || error.message.includes('salt')) {
        errorMessage = '系统配置错误，请联系管理员';
      }
      const newCsrfToken = generateCSRFToken();
      res.render('login', { error: errorMessage, csrfToken: newCsrfToken });
    }
  });

  // 登出路由
  app.get('/logout', (req, res) => {
    // 获取会话ID并删除会话
    const sessionId = req.headers.cookie?.split(';').find(c => c.trim().startsWith('sessionId='))?.split('=')[1];
    if (sessionId && sessionManager.sessions[sessionId]) {
      delete sessionManager.sessions[sessionId];
    }
    
    // 清除cookie
    res.clearCookie('sessionId');
    
    // 重定向到登录页面
    res.redirect('/login');
  });

  // 主页路由：渲染工作台
  app.get('/', (req, res) => {
    res.render('index');
  });

  // 用户管理页面
  app.get('/users', (req, res) => {
    // 页面骨架直接渲染（用户列表由前端 fetch /api/users 异步加载，避免服务端等待抓取拖慢首屏）
    res.render('users', { users: [], error: undefined });
  });

  // 授权管理页面
  app.get('/authorization', (req, res) => {
    res.render('authorization');
  });

  // 会话管理页面
  app.get('/sessions', (req, res) => {
    res.render('sessions');
  });

  // 系统管理页面路由
  app.get('/admin-management', requireAuth, async (req, res) => {
    try {
      // 获取所有管理员信息
      const admins = adminManager.getAllAdmins();
      // 获取活跃会话信息
      const activeSessions = sessionManager.getActiveSessions();
      
      res.render('admin_management', {
        admins: admins,
        activeSessions: activeSessions,
        error: req.query.error,
        success: req.query.success,
        formatDuration: formatDuration
      });
    } catch (error) {
      logger.error('加载系统管理页面时出错:', error);
      res.render('admin_management', {
        admins: [],
        activeSessions: [],
        error: '加载页面失败，请稍后重试',
        success: null,
        formatDuration: formatDuration
      });
    }
  });

  // 强制用户下线
  app.post('/api/users/logoff', requireAuth, (req, res) => {
    try {
      const { username, sessionId } = req.body;
      const currentUser = req.session?.user?.username || req.user?.username;
      
      if (!username) {
        return res.json({ success: false, message: '缺少用户名参数' });
      }
      
      // 限制1: 不能强制administrator下线
      if (username === 'administrator') {
        return res.json({ success: false, message: '不能强制管理员账户下线' });
      }
      
      // 限制2: 用户不能下线自己
      if (username === currentUser) {
        return res.json({ success: false, message: '不能强制下线自己的账户' });
      }
      
      logoffUser(username, sessionId);
      res.json({ success: true, message: `用户 ${username} 已被强制下线` });
    } catch (error) {
      logger.error(`强制下线时出错: ${error.message}`, { error: error.stack, sessionId });
      res.json({ 
        success: false, 
        message: error.message || '强制下线操作失败',
        debugInfo: {
          errorDetails: error.toString(),
          sessionId: sessionId,
          username: username || 'unknown'
        }
      });
    }
  });

  // 新增用户
  app.post('/api/users/add', requireAuth, (req, res) => {
    try {
      const { username, fullName, description, password, isAdmin = false } = req.body;
      if (!username || !password) {
        return res.json({ success: false, message: '缺少用户名或密码参数' });
      }
      
      // 验证密码强度
      const passwordValidation = validatePasswordStrength(password);
      if (!passwordValidation.valid) {
        return res.json({ 
          success: false, 
          message: '密码强度不符合要求',
          errors: passwordValidation.errors 
        });
      }
      
      addUser(username, password, fullName, description, isAdmin);
      invalidateUsersCache();
      res.json({ success: true, message: `用户 ${username} 已成功创建` });
    } catch (error) {
      res.json({ success: false, message: error.message });
    }
  });

  // 重命名用户
  app.post('/api/users/rename', requireAuth, (req, res) => {
    try {
      const { oldUsername, newUsername } = req.body;
      if (!oldUsername || !newUsername) {
        return res.json({ success: false, message: '缺少必要参数' });
      }
      
      renameUser(oldUsername, newUsername);
      invalidateUsersCache();
      res.json({ success: true, message: `用户 ${oldUsername} 已成功重命名为 ${newUsername}` });
    } catch (error) {
      res.json({ success: false, message: error.message });
    }
  });

  // 更新用户信息（全名和描述）
  app.post('/api/users/update-info', requireAuth, (req, res) => {
    try {
      const { username, fullName, description } = req.body;
      if (!username) {
        return res.json({ success: false, message: '缺少用户名参数' });
      }
      
      updateUserInfo(username, fullName, description);
      invalidateUsersCache();
      res.json({ success: true, message: `用户 ${username} 的信息已成功更新` });
    } catch (error) {
      res.json({ success: false, message: error.message });
    }
  });

  // 获取用户列表
  app.get('/api/users', requireAuth, (req, res) => {
    try {
      logger.info('接收到获取用户列表请求');
      
      // 使用实际代码获取系统用户
      getUsersList()
        .then(users => {
          logger.info(`获取到${users.length}个用户`);
          // 获取授权信息
          const authorizations = getUserAuthorizations();
          
          // 获取账户权限（电源关机可用性）
          let accountPerms = {};
          try {
            const permsPath = path.join(CONFIG_DIR, 'account_perms.json');
            if (fs.existsSync(permsPath)) {
              const raw = fs.readFileSync(permsPath, 'utf8').replace(/^\uFEFF/, '');
              const data = JSON.parse(raw);
              accountPerms = data.perms || {};
            }
          } catch (permError) {
            logger.warn('读取账户权限配置失败:', permError.message);
          }
          
          // 合并用户信息和授权信息
          const usersWithAuth = users.map(user => {
            const auth = authorizations[user.name];
            const authCheck = isUserAuthorized(user.name);
            return {
              ...user,
              authorization: auth || null,
              isAuthorized: authCheck.authorized,
              authorizationStatus: authCheck.reason,
              shutdownPerm: accountPerms[user.name] !== false // 默认可用
            };
          });
          
          res.json({ success: true, users: usersWithAuth });
        })
        .catch(error => {
          console.error('获取用户列表失败:', error);
          res.json({ success: false, message: error.message });
        });
      
    } catch (error) {
      console.error('API处理错误:', error);
      res.json({ success: false, message: '服务器内部错误: ' + error.message });
    }
  });

  // 修改用户密码
  app.post('/api/users/change-password', requireAuth, (req, res) => {
    try {
      const { username, newPassword } = req.body;
      
      if (!username || !newPassword) {
        return res.json({ success: false, message: '缺少用户名或新密码参数' });
      }
      
      // 验证用户名长度（最大20个字符）
      const maxUsernameLength = 20;
      if (username.length > maxUsernameLength) {
        return res.json({ success: false, message: `用户名长度不能超过${maxUsernameLength}个字符，当前长度为${username.length}个字符` });
      }
      
      // 验证用户名格式
      if (!/^[\w\u4e00-\u9fa5#\-:+]+$/.test(username)) {
        return res.json({ success: false, message: '用户名格式不正确' });
      }
      
      // 验证密码长度和复杂度（最少6位）
      if (newPassword.length < 6) {
        return res.json({ success: false, message: '密码长度至少为6个字符' });
      }
      
      // 使用net user命令修改用户密码
      try {
        // 在Windows系统中，使用net user命令修改用户密码
        const { spawnSync } = require('child_process');
        
        logger.info(`正在修改用户 ${username} 的密码`);
        // 使用spawnSync和参数数组避免命令注入
        spawnSync('net', ['user', username, newPassword], { stdio: 'pipe' });
        
        logger.info(`用户 ${username} 的密码修改成功`);
        invalidateUsersCache();
        res.json({ success: true, message: `用户 ${username} 的密码修改成功` });
      } catch (error) {
        logger.error(`修改用户 ${username} 密码失败:`, error.message);
        
        // 解析错误信息，返回更友好的提示
        let errorMessage = '修改密码失败';
        if (error.message.includes('找不到用户')) {
          errorMessage = '找不到指定用户';
        } else if (error.message.includes('拒绝访问')) {
          errorMessage = '没有足够权限修改该用户密码';
        }
        
        res.json({ success: false, message: errorMessage });
      }
    } catch (error) {
      logger.error('修改密码API处理错误:', error);
      res.json({ success: false, message: '服务器内部错误: ' + error.message });
    }
  });

  // 设置用户授权时间
  app.post('/api/users/set-authorization', requireAuth, (req, res) => {
    try {
      const { username, startDate, endDate } = req.body;
      
      if (!username || !startDate || !endDate) {
        return res.json({ success: false, message: '缺少必要参数' });
      }
      
      // 验证日期格式
      const start = new Date(startDate);
      const end = new Date(endDate);
      
      if (isNaN(start.getTime()) || isNaN(end.getTime())) {
        return res.json({ success: false, message: '无效的日期格式' });
      }
      
      if (start > end) {
        return res.json({ success: false, message: '开始日期不能晚于结束日期' });
      }
      
      // 保存授权信息（parseAuthDate：带时区直接解析，无时区按北京时间解释，统一转 UTC ISO）
      saveUserAuthorization(username, parseAuthDate(startDate).toISOString(), parseAuthDate(endDate).toISOString());
      
      // 可选：同步授权状态到系统
      const { syncUserAuthorizationToSystem } = require('../config/authorization');
      syncUserAuthorizationToSystem(username, getUsersList).catch(console.error);
      
      res.json({ success: true, message: `用户 ${username} 的授权时间设置成功` });
    } catch (error) {
      res.json({ success: false, message: error.message });
    }
  });

  // 禁用用户授权
  app.post('/api/users/disable-user', requireAuth, (req, res) => {
    try {
      const { username } = req.body;
      
      if (!username) {
        return res.json({ success: false, message: '缺少用户名参数' });
      }
      
      disableUserAuthorization(username);
      
      // 同步授权状态到系统（禁用用户）
      try {
        const { spawnSync } = require('child_process');
        spawnSync('net', ['user', username, '/active:no'], { stdio: 'ignore' });
        logger.info(`用户 ${username} 已禁用（授权已禁用）`);
      } catch (error) {
        console.error(`禁用用户 ${username} 失败:`, error);
      }
      
      res.json({ success: true, message: `用户 ${username} 的授权已禁用` });
    } catch (error) {
      res.json({ success: false, message: error.message });
    }
  });

  // 启用用户授权
  app.post('/api/users/enable-authorization', requireAuth, (req, res) => {
    try {
      const { username } = req.body;
      
      if (!username) {
        return res.json({ success: false, message: '缺少用户名参数' });
      }
      
      enableUserAuthorization(username);
      
      // 同步授权状态到系统（启用用户）
      try {
        const { spawnSync } = require('child_process');
        spawnSync('net', ['user', username, '/active:yes'], { stdio: 'ignore' });
        logger.info(`用户 ${username} 已启用（授权已启用）`);
      } catch (error) {
        console.error(`启用用户 ${username} 失败:`, error);
      }
      
      res.json({ success: true, message: `用户 ${username} 的授权已启用` });
    } catch (error) {
      res.json({ success: false, message: error.message });
    }
  });

  // 检查用户授权状态
  app.get('/api/users/:username/authorization', requireAuth, (req, res) => {
    try {
      const { username } = req.params;
      const authCheck = isUserAuthorized(username);
      const authorizations = getUserAuthorizations();
      
      res.json({
        success: true,
        username,
        isAuthorized: authCheck.authorized,
        reason: authCheck.reason,
        authorization: authorizations[username] || null
      });
    } catch (error) {
      res.json({ success: false, message: error.message });
    }
  });

  // 获取会话信息
  app.get('/api/sessions', requireAuth, (req, res) => {
    try {
      logger.info('接收到获取会话列表请求');
      getActiveSessions()
        .then(sessions => {
          logger.info(`成功获取会话列表，共 ${sessions.length} 个会话`);
          res.json({
            success: true, 
            sessions,
            count: sessions.length,
            timestamp: new Date().toISOString(),
            debugInfo: {
              message: sessions.length > 0 ? '已成功获取所有活动会话' : '当前没有检测到活动会话，请注意检查服务器上的实际连接情况'
            }
          });
        })
        .catch(error => {
          console.error('获取会话列表失败:', error);
          res.json({
            success: false, 
            message: error.message,
            debugInfo: {
              errorDetails: error.toString(),
              message: '获取会话信息时出错，请尝试手动刷新或检查服务器状态'
            }
          });
        });
    } catch (error) {
      console.error('获取会话列表失败:', error);
      res.json({
        success: false, 
        message: error.message,
        debugInfo: {
          errorDetails: error.toString(),
          message: '获取会话信息时出错，请尝试手动刷新或检查服务器状态'
        }
      });
    }
  });

  // 断开用户连接（不断开应用程序）
  app.post('/api/disconnect/:sessionId', requireAuth, (req, res) => {
    try {
      const { sessionId } = req.params;
      if (!sessionId) {
        return res.json({ success: false, message: '缺少会话ID参数' });
      }
      
      // 调用disconnectUser函数
      disconnectUser(sessionId);
      res.json({ success: true, message: `会话 ${sessionId} 已被断开连接，但应用程序仍在运行` });
    } catch (error) {
      res.json({ success: false, message: error.message });
    }
  });

  // 强制会话下线（通过会话ID）
  app.post('/api/logoff/:sessionId', requireAuth, (req, res) => {
    const sessionId = req.params.sessionId;
    let targetSession = null;
    
    try {
      // 获取当前登录的管理员用户
      const adminUser = req.session?.user?.username || req.user?.username || req.session?.user;
      
      logger.info(`收到客户端用户强制下线请求 - 会话ID: ${sessionId}, 执行管理员: ${adminUser}`);
      
      if (!sessionId) {
        logger.warn('强制下线请求缺少会话ID参数');
        return res.json({ success: false, message: '缺少会话ID参数' });
      }
      
      // 获取所有活跃的客户端会话
      const activeSessions = sessionManager.getActiveSessions();
      logger.info(`当前系统中活跃的客户端会话数量: ${activeSessions.length}`);
      
      // 查找该会话ID对应的客户端用户会话
      // 尝试匹配sessionId、id、session_id等可能的字段名
      targetSession = activeSessions.find(session => 
        session.sessionId === sessionId || 
        session.id === sessionId || 
        session.session_id === sessionId
      );
      
      logger.info(`找到的目标客户端会话信息: ${targetSession ? JSON.stringify(targetSession) : '未找到'}`);
      
      // 安全检查：禁止强制下线管理员账户
      if (targetSession && targetSession.username) {
        // 限制：不能强制系统管理员账户下线
        if (targetSession.username.toLowerCase() === 'administrator') {
          logger.warn(`管理员 ${adminUser} 尝试强制下线系统管理员账户，操作被拒绝`);
          const { logAction } = require('../config/authorization');
          logAction('force_logoff_attempt', `尝试强制下线系统管理员账户: ${targetSession.username}，操作被拒绝`);
          return res.json({ 
            success: false, 
            message: '不能强制下线系统管理员账户',
            details: { username: targetSession.username, sessionId: sessionId }
          });
        }
        
        // 可选限制：用户可以下线自己的会话
        // 这里注释掉了禁止下线自己的限制，允许管理员下线自己的远程桌面会话
        /*
        if (targetSession.username.toLowerCase() === adminUser?.toLowerCase()) {
          logger.warn(`管理员 ${adminUser} 尝试强制下线自己的账户，操作被拒绝`);
          return res.json({ success: false, message: '不能强制下线自己的账户' });
        }
        */
      }
      
      // 下线结果信息
      let offlineResult = {
        sessionId: sessionId,
        username: targetSession?.username || 'unknown',
        attempts: 0,
        success: false,
        methodsUsed: []
      };
      
      // 调用优化后的logoffUser函数，优先使用用户名（如果有），否则使用会话ID
      try {
        if (targetSession && targetSession.username) {
          logger.info(`管理员 ${adminUser} 执行客户端用户强制下线: ${targetSession.username}`);
          offlineResult.methodsUsed.push('username_based');
          logoffUser(targetSession.username, null);
          offlineResult.success = true;
          
          // 记录成功操作日志
          const { logAction } = require('../config/authorization');
          logAction('force_logoff_user', `成功强制下线客户端用户: ${targetSession.username} (会话ID: ${sessionId})`);
          
          return res.json({ 
            success: true, 
            message: `客户端用户 ${targetSession.username} 已被成功强制下线`,
            details: {
              username: targetSession.username,
              sessionId: sessionId,
              targetInfo: targetSession
            }
          });
        } else {
          // 如果没有找到对应的用户名，尝试直接通过会话ID下线
          logger.info(`管理员 ${adminUser} 执行会话强制下线: ${sessionId}（未找到对应的用户名）`);
          offlineResult.methodsUsed.push('session_id_direct');
          logoffUser('', sessionId);
          offlineResult.success = true;
          
          // 记录成功操作日志
          const { logAction } = require('../config/authorization');
          logAction('force_logoff_session', `成功强制下线会话ID: ${sessionId}`);
          
          return res.json({ 
            success: true, 
            message: `会话 ${sessionId} 已被成功强制下线`,
            details: { 
              sessionId: sessionId,
              targetFound: !!targetSession
            }
          });
        }
      } catch (logoffError) {
        // 下线操作失败的详细错误处理
        offlineResult.success = false;
        logger.error(`执行客户端用户强制下线失败: ${logoffError.message}`, { sessionId, username: targetSession?.username });
        
        // 记录失败操作日志
        const { logAction } = require('../config/authorization');
        logAction('force_logoff_failed', `客户端用户强制下线失败: ${logoffError.message}`, false);
        
        return res.json({ 
          success: false, 
          message: `强制下线操作失败: ${logoffError.message}`,
          details: {
            sessionId: sessionId,
            username: targetSession?.username || 'unknown',
            attemptedMethod: targetSession && targetSession.username ? 'username' : 'sessionId'
          },
          errorCode: 'LOGOFF_FAILED'
        });
      }
    } catch (error) {
      // 捕获其他可能的错误
      const debugInfo = {
        errorMessage: error.message,
        errorStack: error.stack,
        sessionId: sessionId,
        username: targetSession?.username || 'unknown',
        timestamp: new Date().toISOString(),
        adminUser: req.session?.user?.username || req.user?.username || req.session?.user,
        requestInfo: { method: req.method, path: req.path }
      };
      
      logger.error(`客户端用户强制下线处理过程中发生错误: ${error.message}`, debugInfo);
      const { logAction } = require('../config/authorization');
      logAction('force_logoff_error', `处理强制下线请求时发生系统错误: ${error.message}`, false);
      
      res.status(500).json({ 
        success: false, 
        message: '系统处理强制下线请求时发生错误',
        details: { sessionId: sessionId },
        debugInfo: debugInfo
      });
    }
  });

  // 发送消息给用户会话
  app.post('/api/send-message/:sessionId', requireAuth, (req, res) => {
    try {
      const { sessionId } = req.params;
      const { message } = req.body;
      
      if (!sessionId) {
        return res.json({ success: false, message: '缺少会话ID参数' });
      }
      
      if (!message || message.trim() === '') {
        return res.json({ success: false, message: '消息内容不能为空' });
      }
      
      // 调用sendMessageToUser函数发送消息
      sendMessageToUser(sessionId, message.trim());
      res.json({ success: true, message: `消息已成功发送到会话 ${sessionId}` });
    } catch (error) {
      res.json({ success: false, message: error.message });
    }
  });

  // 设置用户状态（启用/禁用）
  app.post('/api/users/set-status', requireAuth, (req, res) => {
    try {
      const { username, disabled } = req.body;
      
      if (!username) {
        return res.status(400).json({ success: false, message: '用户名不能为空' });
      }
      
      logger.info(`尝试${disabled ? '禁用' : '启用'}用户: ${username}`);
      
      // 使用net user命令设置用户状态
      // 使用参数数组避免命令注入
      const { spawnSync } = require('child_process');
      spawnSync('net', ['user', username, '/active:' + (disabled ? 'no' : 'yes')], { stdio: 'pipe' });
      logger.info(`用户${username}${disabled ? '禁用' : '启用'}成功`);
      
      // 记录操作日志
      const { logAction } = require('../config/authorization');
      logAction(`用户${disabled ? '禁用' : '启用'}`, `成功${disabled ? '禁用' : '启用'}用户 ${username}`);
      
      res.json({ success: true, message: `用户${disabled ? '禁用' : '启用'}成功` });
    } catch (error) {
      console.error(`用户状态设置失败:`, error);
      res.status(500).json({ 
        success: false, 
        message: `用户状态设置失败: ${error.message}` 
      });
    }
  });

  // 删除用户
  app.post('/api/users/delete', requireAuth, (req, res) => {
    try {
      const { username } = req.body;
      const currentUser = req.username;
      
      if (!username) {
        return res.json({ success: false, message: '缺少用户名参数' });
      }
      
      // 安全限制：不能删除内置管理员账户
      if (username.toLowerCase() === 'administrator') {
        return res.json({ success: false, message: '不能删除内置管理员账户 administrator' });
      }
      
      // 安全限制：不能删除自己（当前登录的账户）
      if (currentUser && username.toLowerCase() === currentUser.toLowerCase()) {
        return res.json({ success: false, message: '不能删除当前登录的账户' });
      }
      
      // 安全限制：不能删除系统内置账户
      const protectedAccounts = ['guest', 'defaultaccount', 'wdagutilityaccount'];
      if (protectedAccounts.includes(username.toLowerCase())) {
        return res.json({ success: false, message: '不能删除系统内置账户 ' + username });
      }
      
      deleteUser(username);
      invalidateUsersCache();
      
      // 记录操作日志
      const { logAction } = require('../config/authorization');
      logAction('delete_user', `成功删除用户 ${username}`);
      
      res.json({ success: true, message: `用户 ${username} 已成功删除` });
    } catch (error) {
      logger.error(`删除用户失败:`, error);
      res.json({ success: false, message: error.message || '删除用户失败' });
    }
  });

  // 登录页面路由
  app.get('/login', (req, res) => {
    // 生成CSRF令牌并存储在会话中（如果有会话）
    const csrfToken = generateCSRFToken();
    res.render('login', { error: undefined, csrfToken });
  });
};
