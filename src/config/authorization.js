const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const logger = require('../utils/logger');
const { ADMIN_CONFIG_PATH } = require('./adminConfig');
const { CONFIG_DIR, ensureDir } = require('../utils/runtimePaths');

// 直接导入getUsersList函数，避免参数传递错误
let getUsersList;
try {
  getUsersList = require('../utils/userUtils').getUsersList;
  logger.info('成功导入getUsersList函数');
} catch (error) {
  logger.error('导入getUsersList函数失败:', error);
  getUsersList = null;
}

// 用户授权信息存储路径（pkg 下为 exe 所在目录的 config）
const AUTHORIZATION_FILE = path.join(CONFIG_DIR, 'user_authorizations.json');

// 确保授权文件存在
function ensureAuthorizationFile() {
  try {
    if (!fs.existsSync(AUTHORIZATION_FILE)) {
      fs.writeFileSync(AUTHORIZATION_FILE, JSON.stringify({ authorizations: {} }, null, 2));
    }
  } catch (error) {
    logger.error('创建授权文件失败:', error);
  }
}

// 初始化时确保文件存在
ensureAuthorizationFile();

// 读取用户授权信息
function getUserAuthorizations() {
  try {
    const data = fs.readFileSync(AUTHORIZATION_FILE, 'utf8').replace(/^\uFEFF/, '');
    return JSON.parse(data).authorizations || {};
  } catch (error) {
    logger.error('读取授权信息失败:', error);
    return {};
  }
}

// 保存用户授权信息
function saveUserAuthorization(username, startDate, endDate) {
  try {
    const authorizations = getUserAuthorizations();
    authorizations[username] = {
      startDate: startDate,
      endDate: endDate,
      updatedAt: new Date().toISOString()
    };
    
    fs.writeFileSync(AUTHORIZATION_FILE, JSON.stringify({ authorizations }, null, 2));
    logger.info(`保存用户 ${username} 的授权信息成功`);
    return true;
  } catch (error) {
    logger.error('保存授权信息失败:', error);
    throw new Error('保存授权信息失败: ' + error.message);
  }
}

// 禁用用户授权
function disableUserAuthorization(username) {
  try {
    const authorizations = getUserAuthorizations();
    if (authorizations[username]) {
      // 保留授权信息，但添加disabled标志
      if (!authorizations[username].metadata) {
        authorizations[username].metadata = {};
      }
      authorizations[username].metadata.disabled = true;
      fs.writeFileSync(AUTHORIZATION_FILE, JSON.stringify({ authorizations }, null, 2));
      logger.info(`禁用用户 ${username} 的授权成功`);
      return true;
    }
    return false;
  } catch (error) {
    logger.error('禁用授权失败:', error);
    throw new Error('禁用授权失败: ' + error.message);
  }
}

// 启用用户授权
function enableUserAuthorization(username) {
  try {
    const authorizations = getUserAuthorizations();
    if (authorizations[username]) {
      // 移除disabled标志
      if (authorizations[username].metadata) {
        delete authorizations[username].metadata.disabled;
        // 如果metadata为空，则删除整个metadata对象
        if (Object.keys(authorizations[username].metadata).length === 0) {
          delete authorizations[username].metadata;
        }
      }
      fs.writeFileSync(AUTHORIZATION_FILE, JSON.stringify({ authorizations }, null, 2));
      logger.info(`启用用户 ${username} 的授权成功`);
      return true;
    }
    return false;
  } catch (error) {
    logger.error('启用授权失败:', error);
    throw new Error('启用授权失败: ' + error.message);
  }
}

// 检查用户授权是否有效
function isUserAuthorized(username) {
  try {
    const authorizations = getUserAuthorizations();
    const auth = authorizations[username];
    
    // 如果没有授权记录，则视为有效（未设置限制）
    if (!auth) {
      return { authorized: true, reason: '未设置授权限制' };
    }
    
    // 检查授权是否被禁用
    if (auth.metadata && auth.metadata.disabled) {
      return { authorized: false, reason: '授权已被禁用' };
    }
    
    const now = new Date();
    const startDate = new Date(auth.startDate);
    const endDate = new Date(auth.endDate);
    
    if (now < startDate) {
      return { authorized: false, reason: '授权时间未开始' };
    }
    
    if (now > endDate) {
      return { authorized: false, reason: '授权时间已过期' };
    }
    
    return { authorized: true, reason: '在授权时间范围内' };
  } catch (error) {
    logger.error('检查用户授权失败:', error);
    // 出错时默认允许访问，避免影响正常使用
    return { authorized: true, reason: '授权检查出错，默认允许访问' };
  }
}

// 从配置文件读取授权检查间隔（分钟）
function getAuthorizationCheckInterval() {
  try {
    const configData = fs.readFileSync(ADMIN_CONFIG_PATH, 'utf8').replace(/^\uFEFF/, '');
    const config = JSON.parse(configData);
    // 默认10分钟，范围限制在1-120分钟之间
    const interval = config.settings?.authorizationCheckInterval || 10;
    return Math.max(1, Math.min(120, parseInt(interval) || 10));
  } catch (error) {
    console.error('读取授权检查间隔配置失败:', error);
    return 10; // 默认10分钟
  }
}

// 同步用户授权状态到系统
async function syncUserAuthorizationToSystem(username) {
  try {
    const authCheck = isUserAuthorized(username);
    
    // 确保getUsersList是一个函数
    if (typeof getUsersList !== 'function') {
      logger.error('syncUserAuthorizationToSystem: getUsersList不是一个函数');
      throw new Error('getUsersList不是一个函数');
    }
    
    const users = await getUsersList();
    const user = users.find(u => u.name.toLowerCase() === username.toLowerCase());
    
    if (!user) {
      logger.info(`用户 ${username} 不存在`);
      logAction('authorization_sync', `尝试同步不存在的用户 ${username} 的授权状态`, false);
      return false;
    }
    
    // 根据授权状态启用/禁用用户
    if (!authCheck.authorized && !user.disabled) {
      // 禁用用户
      spawnSync('net', ['user', username, '/active:no'], { stdio: 'ignore' });
      const logMessage = `用户 ${username} 因授权时间无效被禁用: ${authCheck.reason}`;
      logger.info(logMessage);
      logAction('disable_user', logMessage);
      return true;
    } else if (authCheck.authorized && user.disabled) {
      // 启用用户
      spawnSync('net', ['user', username, '/active:yes'], { stdio: 'ignore' });
      const logMessage = `用户 ${username} 因授权时间有效被启用: ${authCheck.reason}`;
      logger.info(logMessage);
      logAction('enable_user', logMessage);
      return true;
    }
    return true;
  } catch (error) {
      const errorMessage = `同步用户 ${username} 授权状态失败: ${error.message}`;
      logger.error(errorMessage);
      logAction('authorization_sync_error', errorMessage, false);
      return false;
    }
}

// 操作日志记录函数
// 操作日志配置
const ACTION_LOG_CONFIG = {
  maxFileSize: 5 * 1024 * 1024, // 5MB
  maxFiles: 5 // 保留5个日志文件
};

// 清理旧的操作日志文件
function cleanupOldActionLogs(logDir) {
  try {
    const logFiles = fs.readdirSync(logDir)
      .filter(file => file.startsWith('action_logs.') && file.endsWith('.json'))
      .map(file => ({
        name: file,
        path: path.join(logDir, file),
        mtime: fs.statSync(path.join(logDir, file)).mtime
      }))
      .sort((a, b) => a.mtime - b.mtime);
    
    // 删除超过保留数量的旧日志文件
    if (logFiles.length > ACTION_LOG_CONFIG.maxFiles) {
      const filesToDelete = logFiles.slice(0, logFiles.length - ACTION_LOG_CONFIG.maxFiles);
      filesToDelete.forEach(file => {
        fs.unlinkSync(file.path);
        logger.info(`已删除旧操作日志文件: ${file.name}`);
      });
    }
  } catch (error) {
    logger.error('清理旧操作日志文件失败:', error);
  }
}

// 轮转操作日志文件
function rotateActionLogFile(logFilePath) {
  try {
    if (fs.existsSync(logFilePath)) {
      // 生成带时间戳的备份文件名
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const backupPath = logFilePath.replace('.json', `.${timestamp}.json`);
      fs.renameSync(logFilePath, backupPath);
      
      // 清理旧日志文件
      const logDir = path.dirname(logFilePath);
      cleanupOldActionLogs(logDir);
      
      logger.info(`操作日志文件已轮转: ${backupPath}`);
    }
  } catch (error) {
    logger.error('操作日志轮转失败:', error);
  }
}

function logAction(type, detail, success = true) {
  try {
    const logEntry = {
      time: new Date().toISOString(),
      type,
      detail,
      success
    };
    
    // 使用新的日志系统
    if (success) {
      logger.info(`${type}: ${detail}`);
    } else {
      logger.error(`${type}: ${detail}`);
    }
    
    // 仍然保留JSON格式的操作日志，用于API展示
    const logDir = path.join(CONFIG_DIR, 'logs');
    const logFilePath = path.join(logDir, 'action_logs.json');
    
    // 确保日志目录存在
    if (!fs.existsSync(logDir)) {
      fs.mkdirSync(logDir, { recursive: true });
    }
    
    // 检查日志文件大小，超过限制则轮转
    if (fs.existsSync(logFilePath)) {
      const stats = fs.statSync(logFilePath);
      if (stats.size > ACTION_LOG_CONFIG.maxFileSize) {
        rotateActionLogFile(logFilePath);
      }
    }
    
    // 安全的日志写入
    try {
      fs.appendFileSync(logFilePath, JSON.stringify(logEntry) + '\n');
    } catch (writeError) {
      logger.error('写入操作日志JSON失败:', writeError);
    }
  } catch (err) {
    logger.error('记录操作日志失败:', err);
  }
}

// 定期检查并同步所有用户的授权状态
async function checkAndSyncAllUsersAuthorization() {
  try {
    logger.info('开始定期检查所有用户授权状态...');
    
    // 确保getUsersList是一个函数
    if (typeof getUsersList !== 'function') {
      logger.error('checkAndSyncAllUsersAuthorization: getUsersList不是一个函数');
      throw new Error('getUsersList不是一个函数');
    }
    
    const users = await getUsersList();
    const authorizations = getUserAuthorizations();
    
    // 只检查有授权信息的用户
    const usersToCheck = users.filter(user => authorizations[user.name]);
    
    logger.info(`找到 ${usersToCheck.length} 个需要检查授权状态的用户`);
    
    for (const user of usersToCheck) {
      await syncUserAuthorizationToSystem(user.name);
      // 小延迟避免操作过于频繁
      await new Promise(resolve => setTimeout(resolve, 500));
    }
    
    logger.info('所有用户授权状态检查完成');
    logAction('periodic_authorization_check', `成功检查 ${usersToCheck.length} 个用户的授权状态`);
  } catch (error) {
    const errorMessage = `定期检查用户授权状态失败: ${error.message}`;
    logger.error(errorMessage);
    logAction('periodic_authorization_check_error', errorMessage, false);
  }
}

// 实时监测活动会话中用户的授权状态并断开过期用户的连接
async function checkActiveSessionsForExpiredAuthorization(getActiveSessions, disconnectUser, logoffUser) {
  try {
    logger.info('开始检查活动会话中的用户授权状态...');
    
    // 确保getActiveSessions是一个函数
    if (typeof getActiveSessions !== 'function') {
      logger.error('checkActiveSessionsForExpiredAuthorization: getActiveSessions不是一个函数');
      throw new Error('getActiveSessions不是一个函数');
    }
    
    const sessions = await getActiveSessions();
    logger.info(`找到 ${sessions.length} 个活动会话`);
    
    for (const session of sessions) {
      // 跳过未知用户名的会话
      if (!session.username || session.username === '未知') continue;
      
      // 检查用户授权状态
      const authCheck = isUserAuthorized(session.username);
      
      // 如果用户授权已过期且会话处于活动状态
      if (!authCheck.authorized && session.state === '活动') {
        logger.warn(`检测到用户 ${session.username} (会话ID: ${session.sessionId}) 授权已过期，正在断开连接...`);
        
        try {
          // 1. 先断开用户的连接
          if (session.sessionId && session.sessionId !== '未知') {
            // 确保disconnectUser是一个函数
            if (typeof disconnectUser !== 'function') {
              logger.error('checkActiveSessionsForExpiredAuthorization: disconnectUser不是一个函数');
              throw new Error('disconnectUser不是一个函数');
            }
            
            await disconnectUser(session.sessionId);
            logAction('disconnect_expired_user', `用户 ${session.username} (会话ID: ${session.sessionId}) 因授权过期被断开连接`);
            logger.info(`用户 ${session.username} 的会话已断开连接`);
          }
          
          // 2. 然后禁用用户账户
          await syncUserAuthorizationToSystem(session.username);
          logger.info(`用户 ${session.username} 的账户状态已同步为禁用`);
          
        } catch (error) {
          logger.error(`断开用户 ${session.username} 连接或禁用账户时出错:`, error);
          logAction('disconnect_expired_user_error', `操作用户 ${session.username} 时出错: ${error.message}`, false);
        }
      }
      // 小延迟避免操作过于频繁
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
    
    // 活动会话授权状态检查已完成
  } catch (error) {
    const errorMessage = `检查活动会话授权状态失败: ${error.message}`;
    logger.error(errorMessage);
    logAction('session_authorization_check_error', errorMessage, false);
  }
}

// 存储授权检查间隔的定时器ID
let authorizationCheckIntervalId = null;

// 更新授权检查间隔
function updateAuthorizationCheckInterval(getActiveSessions, disconnectUser, logoffUser) {
  // 清除现有的定时器
  if (authorizationCheckIntervalId) {
    clearInterval(authorizationCheckIntervalId);
  }
  
  // 获取新的间隔时间（分钟）
  const intervalMinutes = getAuthorizationCheckInterval();
  const intervalMs = intervalMinutes * 60 * 1000;
  
  logger.info(`设置授权检查间隔为 ${intervalMinutes} 分钟 (${intervalMs} 毫秒)`);
  
  // 创建新的定时器
  authorizationCheckIntervalId = setInterval(async () => {
    try {
      logger.info('定期检查活动会话授权状态和所有用户授权状态');
      
      // 检查活动会话中的用户授权状态
      await checkActiveSessionsForExpiredAuthorization(getActiveSessions, disconnectUser, logoffUser);
      
      // 检查并同步所有用户的授权状态
      await checkAndSyncAllUsersAuthorization();
    } catch (error) {
      console.error('定期检查授权状态失败:', error);
    }
  }, intervalMs);
}

module.exports = {
  ensureAuthorizationFile,
  getUserAuthorizations,
  saveUserAuthorization,
  disableUserAuthorization,
  enableUserAuthorization,
  isUserAuthorized,
  getAuthorizationCheckInterval,
  syncUserAuthorizationToSystem,
  logAction,
  checkAndSyncAllUsersAuthorization,
  checkActiveSessionsForExpiredAuthorization,
  updateAuthorizationCheckInterval
};
