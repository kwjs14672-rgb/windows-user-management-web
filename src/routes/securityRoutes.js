const path = require('path');
const fs = require('fs');
const { CONFIG_DIR } = require('../utils/runtimePaths');

/**
 * 设置安全相关的路由
 * @param {Object} app - Express应用实例
 * @param {Object} logger - 日志记录器
 * @param {Function} requireAuth - 认证中间件
 */
function setupSecurityRoutes(app, logger, requireAuth) {
  // 安全页面路由
  app.get('/security', requireAuth, (req, res) => {
    res.render('security');
  });

  // 检查管理员权限API
  app.get('/api/security/check-admin', requireAuth, (req, res) => {
    // 检查是否有管理员权限
    const { exec } = require('child_process');
    
    exec('net session', (error, stdout, stderr) => {
      const isAdmin = !error; // net session 命令在非管理员权限下会返回错误
      res.json({
        success: true,
        isAdmin,
        message: isAdmin ? '具有管理员权限' : '无管理员权限'
      });
    });
  });

  // 检查账户安全API
  app.get('/api/security/check-accounts', requireAuth, (req, res) => {
    // 获取管理员账户和最近登录信息
    Promise.all([
      new Promise((resolve, reject) => {
        const { exec } = require('child_process');
        // 获取管理员组成员 - 使用buffer模式避免编码问题
        exec('net localgroup administrators', { encoding: 'buffer' }, (error, stdout) => {
          if (error) {
            resolve([]);
            return;
          }
          
          // 尝试使用iconv-lite库将GBK编码转换为UTF-8
          let output;
          try {
            // 动态导入iconv-lite库
            const iconv = require('iconv-lite');
            // Windows命令输出通常是GBK编码
            output = iconv.decode(stdout, 'gbk').toString();
          } catch (e) {
            // 如果iconv-lite不可用，尝试直接转换
            try {
              output = stdout.toString('utf8');
            } catch (e2) {
              output = stdout.toString();
            }
          }
          
          const lines = output.split('\n');
          const admins = [];
          let inMembersSection = false;
          
          lines.forEach(line => {
            const trimmed = line.trim();
            if (trimmed.includes('-----')) {
              inMembersSection = true;
            } else if (inMembersSection && trimmed) {
              // 过滤掉系统账户
              if (!trimmed.toLowerCase().includes('nt authority') && 
                  !trimmed.toLowerCase().includes('builtin') && 
                  trimmed !== '') {
                admins.push(trimmed);
              }
            }
          });
          
          resolve(admins);
        });
      }),
      // 模拟最近登录数据
      Promise.resolve([
        { username: 'Administrator', time: new Date().toLocaleString(), ip: '本地登录' },
        { username: 'user1', time: new Date(Date.now() - 3600000).toLocaleString(), ip: '192.168.1.100' }
      ])
    ]).then(([adminAccounts, recentLogins]) => {
      const securityTips = [];
      
      // 添加安全建议
      if (adminAccounts.length > 3) {
        securityTips.push('管理员账户数量较多，建议审查不必要的管理员账户');
      }
      
      res.json({
        success: true,
        adminAccounts,
        recentLogins,
        securityTips
      });
    }).catch(error => {
      res.json({ success: false, message: error.message });
    });
  });

  // 获取安全日志API
  app.get('/api/security/logs', requireAuth, (req, res) => {
    try {
      // 读取日志文件（pkg 下为 exe 所在目录的 config/logs）
      const logDir = path.join(CONFIG_DIR, 'logs');
      
      // 获取所有操作日志文件（包括轮转后的文件）
      let logFiles = [];
      if (fs.existsSync(logDir)) {
        logFiles = fs.readdirSync(logDir)
          .filter(file => (file === 'action_logs.json' || file.startsWith('action_logs.')) && file.endsWith('.json'))
          .map(file => path.join(logDir, file));
      }
      
      if (logFiles.length === 0) {
        // 如果没有日志文件，返回空数组
        return res.json({
          success: true,
          logs: []
        });
      }
      
      // 读取所有日志文件内容
      let allLogs = [];
      
      for (const logFilePath of logFiles) {
        try {
          const logContent = fs.readFileSync(logFilePath, 'utf8');
          const logLines = logContent.trim().split('\n');
          
          // 解析日志条目
          const fileLogs = logLines
            .filter(line => line.trim()) // 过滤空行
            .map(line => {
              try {
                return JSON.parse(line);
              } catch (e) {
                return null; // 忽略无法解析的行
              }
            })
            .filter(log => log !== null);
          
          allLogs = allLogs.concat(fileLogs);
        } catch (fileError) {
          console.error(`读取日志文件失败: ${logFilePath}`, fileError);
          // 继续处理其他日志文件
        }
      }
      
      // 按时间排序，最新的在前
      allLogs.sort((a, b) => new Date(b.time) - new Date(a.time));
      
      // 转换时间格式为本地时间显示格式
      const formattedLogs = allLogs.map(log => ({
        ...log,
        time: new Date(log.time).toLocaleString()
      }));
      
      // 返回日志数据
      res.json({
        success: true,
        logs: formattedLogs.slice(0, 100) // 最多返回100条记录
      });
    } catch (error) {
      console.error('读取操作日志失败:', error);
      res.json({
        success: false,
        message: '读取日志失败: ' + error.message
      });
    }
  });

  // 获取/设置账户电源关机权限
  // 配置文件：config/account_perms.json
  const PERMS_FILE = path.join(CONFIG_DIR, 'account_perms.json');
  
  function readPerms() {
    try {
      if (fs.existsSync(PERMS_FILE)) {
        const raw = fs.readFileSync(PERMS_FILE, 'utf8').replace(/^\uFEFF/, '');
        const data = JSON.parse(raw);
        return data.perms || {};
      }
    } catch (e) {
      logger.error('读取账户权限配置失败:', e.message);
    }
    return {};
  }
  
  function writePerms(perms) {
    try {
      if (!fs.existsSync(CONFIG_DIR)) fs.mkdirSync(CONFIG_DIR, { recursive: true });
      fs.writeFileSync(PERMS_FILE, JSON.stringify({ perms: perms }, null, 2), 'utf8');
      return true;
    } catch (e) {
      logger.error('写入账户权限配置失败:', e.message);
      return false;
    }
  }

  // 设置账户电源关机权限
  app.post('/api/security/account-shutdown-perm', requireAuth, (req, res) => {
    try {
      const { username, enabled } = req.body;
      if (!username) {
        return res.json({ success: false, message: '缺少用户名参数' });
      }
      const perms = readPerms();
      if (enabled) {
        delete perms[username]; // 默认可用，删除即恢复默认
      } else {
        perms[username] = false; // 显式禁用
      }
      if (writePerms(perms)) {
        logger.info(`账户权限设置: ${username} 电源关机${enabled ? '可用' : '不可用'}`);
        res.json({ success: true, message: `账户 ${username} 电源关机已设为${enabled ? '可用' : '不可用'}` });
      } else {
        res.json({ success: false, message: '保存配置失败' });
      }
    } catch (error) {
      logger.error('设置账户电源关机权限失败:', error.message);
      res.json({ success: false, message: '设置失败: ' + error.message });
    }
  });

  // 获取账户电源关机权限（合并到用户列表接口的辅助函数，供安全中心使用）
  app.get('/api/security/account-perms', requireAuth, (req, res) => {
    try {
      const perms = readPerms();
      res.json({ success: true, perms: perms });
    } catch (error) {
      res.json({ success: false, message: '读取失败: ' + error.message });
    }
  });

  logger.info('安全相关路由已设置');
}

module.exports = setupSecurityRoutes;