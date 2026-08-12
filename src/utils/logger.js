const fs = require('fs');
const path = require('path');
const { LOG_DIR, ensureDir } = require('./runtimePaths');

// 日志系统配置
const LOG_LEVELS = {
  DEBUG: 0,
  INFO: 1,
  WARN: 2,
  ERROR: 3
};

// 日志配置
let logConfig = {
  level: 'WARN',
  consoleOutput: ['ERROR', 'WARN'],
  fileOutput: ['DEBUG', 'INFO', 'WARN', 'ERROR'],
  maxFileSize: 10 * 1024 * 1024, // 10MB
  maxFiles: 10, // 保留10个日志文件
  logDir: LOG_DIR // 日志目录（pkg 下为 exe 所在目录，开发模式下为项目根目录）
};

// 当前日志级别
let currentLogLevel = LOG_LEVELS[logConfig.level];

// 日志文件路径
const LOG_FILE_PATH = path.join(logConfig.logDir, 'app.log');
let logFileSize = 0;

// 确保日志目录存在
ensureDir(logConfig.logDir);

// 检查当前日志文件大小
if (fs.existsSync(LOG_FILE_PATH)) {
  try {
    const stats = fs.statSync(LOG_FILE_PATH);
    logFileSize = stats.size;
  } catch (e) {
    // 文件无法读取，从0开始
    console.warn('无法读取日志文件大小，从0开始计数');
  }
}

// 从配置文件加载日志配置（延迟到服务器启动时调用，避免循环依赖）
function loadLogConfig() {
  try {
    // 动态 require，避免与 adminConfig 形成循环依赖
    const { getAdminConfig } = require('../config/adminConfig');
    const adminConfig = getAdminConfig();
    
    // 读取日志配置（如果存在）
    if (adminConfig.settings && adminConfig.settings.logging) {
      const loggingSettings = adminConfig.settings.logging;
      
      // 更新日志级别
      if (loggingSettings.level && LOG_LEVELS[loggingSettings.level]) {
        logConfig.level = loggingSettings.level;
        currentLogLevel = LOG_LEVELS[loggingSettings.level];
      }
      
      // 更新控制台输出级别
      if (loggingSettings.consoleOutput) {
        logConfig.consoleOutput = loggingSettings.consoleOutput;
      }
      
      // 更新文件输出级别
      if (loggingSettings.fileOutput) {
        logConfig.fileOutput = loggingSettings.fileOutput;
      }
      
      // 更新日志文件大小限制
      if (loggingSettings.maxFileSize) {
        logConfig.maxFileSize = loggingSettings.maxFileSize;
      }
      
      // 更新保留日志文件数量
      if (loggingSettings.maxFiles) {
        logConfig.maxFiles = loggingSettings.maxFiles;
      }
      
      // 更新日志目录
      if (loggingSettings.logDir) {
        logConfig.logDir = loggingSettings.logDir;
        if (!fs.existsSync(logConfig.logDir)) {
          fs.mkdirSync(logConfig.logDir, { recursive: true });
        }
      }
    }
  } catch (error) {
    console.warn('加载日志配置失败，使用默认配置:', error.message);
  }
}

// 延迟加载日志配置（由 server.js 启动时调用，避免模块循环依赖问题）
// loadLogConfig 已被移除顶层调用，改为导出 reloadConfig 供外部触发

// 清理旧日志文件
function cleanupOldLogs() {
  try {
    const logFiles = fs.readdirSync(logConfig.logDir)
      .filter(file => file.startsWith('app.') && file.endsWith('.log'))
      .map(file => ({
        name: file,
        path: path.join(logConfig.logDir, file),
        mtime: fs.statSync(path.join(logConfig.logDir, file)).mtime
      }))
      .sort((a, b) => a.mtime - b.mtime);
    
    // 删除超过保留数量的旧日志文件
    if (logFiles.length > logConfig.maxFiles) {
      const filesToDelete = logFiles.slice(0, logFiles.length - logConfig.maxFiles);
      filesToDelete.forEach(file => {
        fs.unlinkSync(file.path);
        console.info(`已删除旧日志文件: ${file.name}`);
      });
    }
  } catch (error) {
    console.error('清理旧日志文件失败:', error);
  }
}

// 日志轮转函数
function rotateLogFile() {
  try {
    // 关闭当前日志文件
    if (fs.existsSync(LOG_FILE_PATH)) {
      // 生成带时间戳的备份文件名
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const backupPath = path.join(logConfig.logDir, `app.${timestamp}.log`);
      fs.renameSync(LOG_FILE_PATH, backupPath);
      
      // 清理旧日志文件
      cleanupOldLogs();
    }
    logFileSize = 0;
    log(LOG_LEVELS.INFO, '日志文件已轮转');
  } catch (error) {
    console.error('日志轮转失败:', error);
  }
}

// 安全的日志写入函数
function safeLogWrite(message) {
  try {
    // 检查是否需要轮转
    if (logFileSize + message.length > logConfig.maxFileSize) {
      rotateLogFile();
    }
    
    // 写入日志文件
    fs.appendFileSync(LOG_FILE_PATH, message + '\n', 'utf8');
    logFileSize += message.length + 1; // +1 用于换行符
  } catch (error) {
    // 如果日志写入失败，至少输出到控制台
    console.error('日志写入失败:', error);
    console.debug('原日志内容:', message);
  }
}

// 统一日志函数
function log(level, message, context = {}) {
  if (level < currentLogLevel) {
    return;
  }
  
  const timestamp = new Date().toISOString();
  const levelName = Object.keys(LOG_LEVELS).find(key => LOG_LEVELS[key] === level);
  
  // 构建日志内容，支持结构化日志
  let logMessage = `[${timestamp}] [${levelName}]`;
  
  // 添加上下文信息
  if (context.module) {
    logMessage += ` [${context.module}]`;
  }
  if (context.requestId) {
    logMessage += ` [RID:${context.requestId}]`;
  }
  if (context.username) {
    logMessage += ` [USER:${context.username}]`;
  }
  
  // 添加日志消息
  logMessage += ` ${message}`;
  
  // 添加额外上下文数据
  if (Object.keys(context).length > 0) {
    // 过滤掉已经添加到日志头的字段
    const extraContext = { ...context };
    delete extraContext.module;
    delete extraContext.requestId;
    delete extraContext.username;
    
    if (Object.keys(extraContext).length > 0) {
      logMessage += ` ${JSON.stringify(extraContext)}`;
    }
  }
  
  // 写入文件（如果配置了该级别）
  if (logConfig.fileOutput.includes(levelName)) {
    safeLogWrite(logMessage);
  }
  
  // 输出到控制台（如果配置了该级别）
  if (logConfig.consoleOutput.includes(levelName)) {
    switch (level) {
      case LOG_LEVELS.DEBUG:
        console.debug(logMessage);
        break;
      case LOG_LEVELS.INFO:
        console.info(logMessage);
        break;
      case LOG_LEVELS.WARN:
        console.warn(logMessage);
        break;
      case LOG_LEVELS.ERROR:
        console.error(logMessage);
        break;
    }
  }
}

// 日志级别便捷方法
const logger = {
  debug: (message, context = {}) => log(LOG_LEVELS.DEBUG, message, context),
  info: (message, context = {}) => log(LOG_LEVELS.INFO, message, context),
  warn: (message, context = {}) => log(LOG_LEVELS.WARN, message, context),
  error: (message, context = {}) => log(LOG_LEVELS.ERROR, message, context),
  // 暴露LOG_LEVELS常量
  LOG_LEVELS,
  // 设置日志级别
  setLogLevel: (level) => {
    if (LOG_LEVELS[level] !== undefined) {
      logConfig.level = level;
      currentLogLevel = LOG_LEVELS[level];
      log(LOG_LEVELS.INFO, `已设置日志级别为: ${level}`);
    }
  },
  // 重新加载日志配置
  reloadConfig: () => {
    loadLogConfig();
    log(LOG_LEVELS.INFO, '日志配置已重新加载');
  },
  // 获取当前日志配置
  getConfig: () => {
    return { ...logConfig };
  }
};

module.exports = logger;
