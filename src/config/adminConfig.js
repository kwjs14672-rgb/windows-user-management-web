const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const logger = require('../utils/logger');
const { hashPassword, generateSalt } = require('../utils/passwordUtils');
const { CONFIG_DIR, ensureDir } = require('../utils/runtimePaths');
const { readJsonFile } = require('../utils/jsonUtils');

// 管理员配置文件路径（pkg 下为 exe 所在目录的 config，开发模式为项目 config）
const ADMIN_CONFIG_PATH = path.join(CONFIG_DIR, 'admin_config.json');

// 确保管理员配置文件存在
function ensureAdminConfig() {
  try {
    ensureDir(CONFIG_DIR);
    if (!fs.existsSync(ADMIN_CONFIG_PATH)) {
      // 默认管理员密码为 'admin123'，首次使用请修改
      const defaultSalt = generateSalt();
      
      // 生成SHA-256哈希，不使用异步bcrypt以确保同步执行
      const saltedPassword = 'admin123' + defaultSalt;
      const hash = crypto.createHash('sha256').update(saltedPassword).digest('hex');
      
      const defaultConfig = {
        admin: {
          username: 'administrator',
          passwordHash: hash,
          salt: defaultSalt,
          lastChanged: new Date().toISOString()
        },
        settings: {
          logging: {
            level: 'WARN',
            consoleOutput: ['ERROR', 'WARN'],
            fileOutput: ['DEBUG', 'INFO', 'WARN', 'ERROR'],
            maxFileSize: 10 * 1024 * 1024,
            maxFiles: 10
          }
        }
      };
      
      fs.writeFileSync(ADMIN_CONFIG_PATH, JSON.stringify(defaultConfig, null, 2));
      logger.info(`管理员配置文件已创建，默认密码为 'admin123'`);
    }
  } catch (error) {
    logger.error('创建管理员配置文件失败:', error);
    // 即使创建失败，也不抛出错误，允许系统继续运行
  }
}

// 读取管理员配置
function getAdminConfig() {
  try {
    ensureAdminConfig();
    const config = readJsonFile(ADMIN_CONFIG_PATH);
    return config.admin || {};
  } catch (error) {
    logger.error('读取管理员配置失败:', error);
    // 返回默认配置以确保系统能继续运行
    return {
      username: 'administrator',
      passwordHash: '698d51a19d8a121ce581499d7b701668', // 默认密码 'admin123'
      salt: 'admin_salt'
    };
  }
}

// 更新管理员密码
function updateAdminPassword(newPassword) {
  try {
    // 生成密码哈希
    let salt, hash;
    try {
      salt = generateSalt();
      
      // 生成SHA-256哈希，不使用异步bcrypt以确保同步执行
      const saltedPassword = newPassword + salt;
      hash = crypto.createHash('sha256').update(saltedPassword).digest('hex');
    } catch (cryptoError) {
      logger.error('密码哈希生成失败:', cryptoError);
      return {
        success: false,
        errorType: 'crypto_error',
        message: '密码加密失败',
        details: cryptoError.message
      };
    }
    
    // 确保配置文件存在
    try {
      ensureAdminConfig();
    } catch (ensureError) {
      logger.error('确保配置文件存在失败:', ensureError);
    }
    
    // 读取配置
    let config;
    try {
      if (fs.existsSync(ADMIN_CONFIG_PATH)) {
        config = readJsonFile(ADMIN_CONFIG_PATH);
      } else {
        config = { admin: {} };
        logger.info('配置文件不存在，创建默认配置');
      }
    } catch (readError) {
      logger.warn('读取配置文件失败，使用默认配置:', readError);
      config = { admin: {} };
    }
    
    if (!config.admin) {
      config.admin = {};
    }
    
    // 更新密码
    config.admin.passwordHash = hash;
    config.admin.salt = salt;
    config.admin.lastChanged = new Date().toISOString();
    
    // 写入配置 - 添加重试机制
    let writeSuccess = false;
    let attempts = 0;
    const maxAttempts = 3;
    let lastError = null;
    
    while (!writeSuccess && attempts < maxAttempts) {
      attempts++;
      try {
        // 确保目录存在
        const dirPath = path.dirname(ADMIN_CONFIG_PATH);
        if (!fs.existsSync(dirPath)) {
          fs.mkdirSync(dirPath, { recursive: true });
          logger.debug(`已创建目录: ${dirPath}`);
        }
        
        // 先尝试创建备份
        try {
          const backupPath = ADMIN_CONFIG_PATH + '.bak';
          if (fs.existsSync(ADMIN_CONFIG_PATH)) {
            fs.copyFileSync(ADMIN_CONFIG_PATH, backupPath);
            logger.debug(`已创建配置文件备份: ${backupPath}`);
          }
        } catch (backupError) {
          logger.warn('创建备份失败，但继续尝试更新:', backupError);
        }
        
        // 尝试写入配置文件
        fs.writeFileSync(ADMIN_CONFIG_PATH, JSON.stringify(config, null, 2));
        
        // 验证写入是否成功
        const verifyContent = fs.readFileSync(ADMIN_CONFIG_PATH, 'utf8').replace(/^\uFEFF/, '');
        const verifyConfig = JSON.parse(verifyContent);
        if (verifyConfig.admin && 
            verifyConfig.admin.passwordHash === hash && 
            verifyConfig.admin.salt === salt) {
          writeSuccess = true;
          logger.info(`管理员密码更新成功 (尝试 ${attempts}/${maxAttempts})`);
        } else {
          throw new Error('配置文件写入验证失败');
        }
      } catch (writeError) {
        lastError = writeError;
        logger.error(`写入配置文件失败 (尝试 ${attempts}/${maxAttempts}):`, writeError);
        // 不做阻塞等待，直接重试
      }
    }
    
    if (!writeSuccess) {
      // 如果写入失败，返回错误详情
      logger.warn('所有写入尝试失败，无法更新配置文件');
      let errorType = 'write_failed';
      let errorMsg = '配置文件写入失败';
      
      if (lastError) {
        if (lastError.code === 'ENOENT') {
          errorType = 'file_not_found';
          errorMsg = '找不到配置文件或目录';
        } else if (lastError.code === 'EACCES' || lastError.code === 'EPERM') {
          errorType = 'permission_denied';
          errorMsg = '没有足够的文件权限';
        } else if (lastError.code === 'EBUSY') {
          errorType = 'file_busy';
          errorMsg = '文件正在被其他程序使用';
        }
      }
      
      return {
        success: false,
        errorType: errorType,
        message: errorMsg,
        details: lastError ? lastError.message : '未知错误',
        attempts: attempts,
        maxAttempts: maxAttempts
      };
    }
    
    return { success: true, message: '密码更新成功' };
  } catch (error) {
    logger.error('更新管理员密码过程中发生未预期错误:', error);
    
    // 返回错误信息而不是抛出错误
    return {
      success: false,
      errorType: 'unexpected_error',
      message: '密码更新过程中发生错误',
      details: error.message || String(error)
    };
  }
}

// 从配置中读取日志级别
function loadLogLevelFromConfig() {
  try {
    // 先加载完整日志配置（含级别/输出/轮转设置）
    const loggerModule = require('../utils/logger');
    if (typeof loggerModule.reloadConfig === 'function') {
      loggerModule.reloadConfig();
    }
    
    const config = getAdminConfig();
    if (config.settings && config.settings.logLevel) {
      const level = config.settings.logLevel.toUpperCase();
      if (logger.LOG_LEVELS[level] !== undefined) {
        logger.setLogLevel(level);
        logger.info(`已设置日志级别为: ${level}`);
      }
    }
  } catch (error) {
    logger.error('加载日志级别配置失败:', error);
  }
}

// 从环境变量或配置文件读取端口号
function getPort() {
  // 首先尝试从环境变量读取
  if (process.env.PORT) {
    return parseInt(process.env.PORT);
  }
  
  // 尝试从配置文件读取（pkg 下为 exe 所在目录的 config）
  try {
    const configPath = path.join(CONFIG_DIR, 'admin_config.json');
    if (fs.existsSync(configPath)) {
      const config = readJsonFile(configPath);
      if (config.settings && config.settings.port) {
        return parseInt(config.settings.port);
      }
    }
  } catch (error) {
    logger.warn('读取端口配置失败:', error);
  }
  
  // 默认端口
  return 3000;
}

module.exports = {
  ensureAdminConfig,
  getAdminConfig,
  updateAdminPassword,
  loadLogLevelFromConfig,
  getPort,
  ADMIN_CONFIG_PATH
};
