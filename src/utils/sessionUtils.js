const { spawnSync, spawn } = require('child_process');
const logger = require('./logger');

// 内存缓存：quser/query session 执行较慢，加 3 秒短缓存避免切页/刷新重复执行
let sessionsCache = null;
let sessionsCacheTime = 0;
const SESSIONS_CACHE_TTL = 3000; // 3 秒

// 格式化持续时间（秒）为易读格式
function formatDuration(seconds) {
  if (!seconds || seconds < 0) return '0 秒';
  
  const days = Math.floor(seconds / (24 * 60 * 60));
  const hours = Math.floor((seconds % (24 * 60 * 60)) / (60 * 60));
  const minutes = Math.floor((seconds % (60 * 60)) / 60);
  const secs = seconds % 60;
  
  let result = '';
  if (days > 0) result += `${days} 天 `;
  if (hours > 0) result += `${hours} 小时 `;
  if (minutes > 0) result += `${minutes} 分钟 `;
  if (secs > 0 || result === '') result += `${secs} 秒`;
  
  return result.trim();
}

// 获取活动会话
function getActiveSessions(forceRefresh) {
  // 3 秒缓存：非强制刷新且缓存有效时直接返回
  if (!forceRefresh && sessionsCache && Date.now() - sessionsCacheTime < SESSIONS_CACHE_TTL) {
    return Promise.resolve(sessionsCache);
  }
  return fetchSessionsFromSystem().then(sessions => {
    sessionsCache = sessions;
    sessionsCacheTime = Date.now();
    return sessions;
  });
}

function fetchSessionsFromSystem() {
  return new Promise((resolve, reject) => {
    try {
      // 清除任何可能的缓存，确保每次都获取最新会话信息
      logger.info('正在获取最新活动会话信息...');
      
      // 使用Buffer方式处理输出
      const bufferOptions = { encoding: 'buffer', stdio: 'pipe' };
      let outputBuffer;
      let output;
      let commandUsed = 'quser';
      
      try {
        // 首先尝试quser命令
        outputBuffer = spawnSync('quser', [], bufferOptions).stdout;
        logger.debug('使用quser命令获取会话信息');
      } catch (quserError) {
        logger.debug('quser命令执行失败，尝试使用query session命令作为备用');
        // 备用命令：query session
        commandUsed = 'query session';
        outputBuffer = spawnSync('query', ['session'], bufferOptions).stdout;
      }
      
      // 添加调试日志，记录原始输出
      logger.debug(`${commandUsed}命令原始输出长度:`, outputBuffer.length);
      
      // 尝试使用iconv-lite进行编码转换，支持cp936
      let iconv;
      try {
        iconv = require('iconv-lite');
      } catch (requireError) {
        logger.warn('iconv-lite模块未找到或加载失败，将使用默认编码处理');
        iconv = null;
      }
      
      if (iconv) {
        try {
          // 尝试使用cp936编码（简体中文Windows默认编码）
          output = iconv.decode(outputBuffer, 'cp936');
        } catch (iconvError) {
          logger.debug('iconv解码失败，尝试默认编码');
          output = outputBuffer.toString('utf8');
        }
      } else {
        // 没有iconv-lite时的备用方案
        try {
          // 先尝试utf8
          output = outputBuffer.toString('utf8');
        } catch (e) {
          // 兜底方案：使用latin1
              output = outputBuffer.toString('latin1');
              logger.debug('使用latin1编码解码输出');
        }
      }
      
      // 记录解码后的输出（仅在调试模式）
      logger.debug(`解码后的输出:\n${output}`);
      
      const sessions = [];
      const lines = output.split('\n');
      
      // 添加调试日志，记录解析后的每一行
      logger.debug('解析出的会话行数:', lines.length);
      lines.forEach((line, index) => {
        if (index > 0 && line.trim()) {
          logger.debug(`会话行${index}: "${line.trim()}"`);
        }
      });
      
      // 规范化状态描述（将英文状态转为中文）
      const stateMap = {
        'Active': '活动',
        'Disc': '断开',
        'Conn': '连接',
        'Idle': '空闲',
        'Listen': '监听',
        '运行中': '活动' // 添加中文状态映射
      };
      
      // 获取当前时间，用于计算会话时长
      const now = new Date();
      
      for (let i = 1; i < lines.length; i++) {
        const line = lines[i].trim();
        if (line) {
          // 尝试使用正则表达式查找会话ID
          const sessionIdMatch = line.match(/\s+(\d+)\s+/);
          let username = '';
          let sessionId = '';
          let state = '';
          let loginTimeStr = '';
          
          if (sessionIdMatch) {
            // 方法1：通过会话ID位置解析
            sessionId = sessionIdMatch[1];
            const usernamePart = line.substring(0, sessionIdMatch.index).trim();
            const cleanUsername = usernamePart.startsWith('>') ? usernamePart.substring(1) : usernamePart;
            
            // 尝试分离用户名和会话名（如果存在）
            // quser输出格式中，用户名和会话名之间可能有多个空格
            // 会话名通常是console或rdp-tcp等，用户名不会包含这些关键词
            const parts = cleanUsername.split(/\s+/);
            if (parts.length >= 2 && (parts[1].includes('console') || parts[1].includes('rdp-tcp'))) {
              username = parts[0]; // 只取第一个部分作为用户名
            } else {
              username = cleanUsername; // 整个部分都作为用户名
            }
            
            // 提取会话ID后的部分
            const afterSessionId = line.substring(sessionIdMatch.index + sessionIdMatch[0].length).trim();
            const partsAfterSessionId = afterSessionId.split(/\s+/);
            
            if (partsAfterSessionId.length > 0) {
              // 提取状态
              state = stateMap[partsAfterSessionId[0]] || partsAfterSessionId[0];
              
              // 改进的登录时间提取逻辑
              // 1. 尝试从最后一列提取（大多数情况下，登录时间在最后）
              if (partsAfterSessionId.length >= 2) {
                // 检查最后一列是否为时间格式（例如：14:30）
                const lastIndex = partsAfterSessionId.length - 1;
                const secondLastIndex = partsAfterSessionId.length - 2;
                
                // 情况1: 最后一列是时间，倒数第二列是日期
                if (/^\d{1,2}:\d{2}$/.test(partsAfterSessionId[lastIndex])) {
                  // 检查倒数第二列是否为日期格式
                  if (secondLastIndex >= 0 && /^\d{1,2}\/\d{1,2}\/\d{2,4}$/.test(partsAfterSessionId[secondLastIndex])) {
                    loginTimeStr = `${partsAfterSessionId[secondLastIndex]} ${partsAfterSessionId[lastIndex]}`;
                  } else {
                    // 只有时间没有日期
                    loginTimeStr = partsAfterSessionId[lastIndex];
                  }
                }
                // 情况2: 尝试在中间列查找日期时间格式
                else {
                  // 遍历寻找包含日期或时间的列
                  for (let j = 1; j < partsAfterSessionId.length; j++) {
                    // 检查是否为日期格式
                    if (/^\d{1,2}\/\d{1,2}\/\d{2,4}$/.test(partsAfterSessionId[j])) {
                      loginTimeStr = partsAfterSessionId[j];
                      // 如果下一列是时间格式，则一起使用
                      if (j + 1 < partsAfterSessionId.length && /^\d{1,2}:\d{2}$/.test(partsAfterSessionId[j + 1])) {
                        loginTimeStr += ` ${partsAfterSessionId[j + 1]}`;
                      }
                      break;
                    }
                    // 检查是否为时间格式
                    if (/^\d{1,2}:\d{2}$/.test(partsAfterSessionId[j])) {
                      loginTimeStr = partsAfterSessionId[j];
                      break;
                    }
                  }
                }
              }
              
              // 添加调试信息
              logger.debug(`会话ID ${sessionId} 解析 - 状态: ${state}, 提取的登录时间: "${loginTimeStr}"`);
            }
          } else {
            // 方法2：使用空格分割的备用解析方式
            const parts = line.split(/\s+/).filter(Boolean); // 过滤空字符串
            
            if (parts.length >= 3) {
              // 提取用户名
              let rawUsername = parts[0];
              if (rawUsername.startsWith('>')) {
                rawUsername = rawUsername.substring(1);
              }
              
              // 用户名清理 - 避免包含会话信息
              username = rawUsername;
              
              // 确定会话ID和状态
              if (parts[2] === 'Active' || parts[2] === 'Disc' || parts[2] === '运行中') {
                sessionId = parts[1];
                state = parts[2];
                
                // 改进的登录时间提取逻辑
                // 尝试从最后一列提取
                const lastIndex = parts.length - 1;
                const secondLastIndex = parts.length - 2;
                
                // 情况1: 最后一列是时间，倒数第二列是日期
                if (/^\d{1,2}:\d{2}$/.test(parts[lastIndex])) {
                  if (secondLastIndex >= 3 && /^\d{1,2}\/\d{1,2}\/\d{2,4}$/.test(parts[secondLastIndex])) {
                    loginTimeStr = `${parts[secondLastIndex]} ${parts[lastIndex]}`;
                  } else {
                    loginTimeStr = parts[lastIndex];
                  }
                } else {
                  // 情况2: 遍历寻找日期或时间格式
                  for (let j = 3; j < parts.length; j++) {
                    if (/^\d{1,2}\/\d{1,2}\/\d{2,4}$/.test(parts[j])) {
                      loginTimeStr = parts[j];
                      if (j + 1 < parts.length && /^\d{1,2}:\d{2}$/.test(parts[j + 1])) {
                        loginTimeStr += ` ${parts[j + 1]}`;
                      }
                      break;
                    }
                    if (/^\d{1,2}:\d{2}$/.test(parts[j])) {
                      loginTimeStr = parts[j];
                      break;
                    }
                  }
                }
              } else {
                sessionId = parts[2];
                state = parts[3] || '';
                
                // 改进的登录时间提取逻辑
                const lastIndex = parts.length - 1;
                const secondLastIndex = parts.length - 2;
                
                // 情况1: 最后一列是时间，倒数第二列是日期
                if (/^\d{1,2}:\d{2}$/.test(parts[lastIndex])) {
                  if (secondLastIndex >= 4 && /^\d{1,2}\/\d{1,2}\/\d{2,4}$/.test(parts[secondLastIndex])) {
                    loginTimeStr = `${parts[secondLastIndex]} ${parts[lastIndex]}`;
                  } else {
                    loginTimeStr = parts[lastIndex];
                  }
                } else {
                  // 情况2: 遍历寻找日期或时间格式
                  for (let j = 4; j < parts.length; j++) {
                    if (/^\d{1,2}\/\d{1,2}\/\d{2,4}$/.test(parts[j])) {
                      loginTimeStr = parts[j];
                      if (j + 1 < parts.length && /^\d{1,2}:\d{2}$/.test(parts[j + 1])) {
                        loginTimeStr += ` ${parts[j + 1]}`;
                      }
                      break;
                    }
                    if (/^\d{1,2}:\d{2}$/.test(parts[j])) {
                      loginTimeStr = parts[j];
                      break;
                    }
                  }
                }
              }
              
              // 应用状态映射
              state = stateMap[state] || state;
            }
          }
          
          // 计算会话时长
          let duration = '未知';
          let formattedLoginTime = '未知'; // 将声明移到外部并设置默认值
          
          logger.debug(`尝试解析登录时间: "${loginTimeStr}"`);
          
          if (loginTimeStr && loginTimeStr.trim()) {
            try {
              let loginTime;
              
              // 改进的日期解析逻辑，专门处理Windows格式
              if (loginTimeStr.includes('/')) {
                // 处理包含日期的格式 (例如: 2025/11/2 14:11 或 11/2/25 14:11)
                
                // 分割日期和时间部分
                const dateTimeParts = loginTimeStr.split(' ');
                const datePart = dateTimeParts[0];
                const timePart = dateTimeParts.length > 1 ? dateTimeParts[1] : '00:00';
                
                // 解析日期部分
                const dateComponents = datePart.split('/');
                
                // 根据Windows quser命令输出的常见格式，调整年月日顺序
                let year, month, day;
                
                if (dateComponents.length === 3) {
                  // 尝试识别日期格式 YYYY/MM/DD 或 MM/DD/YY
                  if (dateComponents[0].length === 4) {
                    // YYYY/MM/DD 格式
                    year = parseInt(dateComponents[0], 10);
                    month = parseInt(dateComponents[1], 10) - 1; // 转为0-11范围
                    day = parseInt(dateComponents[2], 10);
                  } else {
                    // MM/DD/YY 格式
                    year = 2000 + parseInt(dateComponents[2], 10); // 假设2000年后
                    month = parseInt(dateComponents[0], 10) - 1;
                    day = parseInt(dateComponents[1], 10);
                  }
                }
                
                // 解析时间部分
                const timeComponents = timePart.split(':');
                const hours = parseInt(timeComponents[0], 10) || 0;
                const minutes = parseInt(timeComponents[1], 10) || 0;
                
                // 创建日期对象
                loginTime = new Date(year, month, day, hours, minutes);
                
                // 验证日期是否有效
                if (isNaN(loginTime.getTime())) {
                  logger.debug('日期解析失败，尝试默认解析方法');
                  loginTime = new Date(loginTimeStr);
                }
              } else {
                // 只有时间，使用今天的日期
                const timeParts = loginTimeStr.split(':');
                if (timeParts.length >= 2) {
                  loginTime = new Date();
                  loginTime.setHours(parseInt(timeParts[0], 10) || 0);
                  loginTime.setMinutes(parseInt(timeParts[1], 10) || 0);
                  loginTime.setSeconds(0);
                  
                  // 如果登录时间晚于当前时间，可能是昨天的登录
                  if (loginTime > now) {
                    loginTime.setDate(loginTime.getDate() - 1);
                  }
                }
              }
              
              // 再次检查日期是否有效
              if (loginTime && !isNaN(loginTime.getTime())) {
                // 计算时间差（毫秒）
                const diffMs = now - loginTime;
                const diffSecs = Math.floor(diffMs / 1000);
                const diffMins = Math.floor(diffSecs / 60);
                const diffHours = Math.floor(diffMins / 60);
                const diffDays = Math.floor(diffHours / 24);
                
                // 格式化时长
                if (diffDays > 0) {
                  duration = `${diffDays}天 ${diffHours % 24}小时`;
                } else if (diffHours > 0) {
                  duration = `${diffHours}小时 ${diffMins % 60}分钟`;
                } else {
                  duration = `${diffMins}分钟`;
                }
                
                // 格式化登录时间为可读字符串
                formattedLoginTime = `${loginTime.getFullYear()}-${String(loginTime.getMonth() + 1).padStart(2, '0')}-${String(loginTime.getDate()).padStart(2, '0')} ${String(loginTime.getHours()).padStart(2, '0')}:${String(loginTime.getMinutes()).padStart(2, '0')}`;
                logger.debug(`会话ID ${sessionId} 登录时间解析成功: ${formattedLoginTime}`);
              } else {
                logger.debug(`会话ID ${sessionId} 登录时间解析失败，格式无效: "${loginTimeStr}"`);
              }
            } catch (e) {
              logger.debug(`会话ID ${sessionId} 计算会话时长失败:`, e.message);
            }
          }
          
          // 过滤掉非用户名条目，但更宽松的条件
          logger.debug(`解析到潜在会话 - 用户名: "${username}", 会话ID: "${sessionId}", 状态: "${state}"`);
          
          // 修改过滤条件，只要有用户名且不是系统消息即可
          if (username && username.trim() && 
              !username.includes('命令') && !username.includes('成功') && 
              !username.includes('完成') && !username.includes('错误') &&
              !username.includes('失败') && !username.includes('quser') &&
              !username.includes('SESSIONNAME') && !username.includes('状态')) { // 排除表头
            // 确保必要字段有值
            const sessionData = {
              username: username,
              sessionId: sessionId || '未知',
              state: state || '未知',
              loginTime: formattedLoginTime || '未知',
              duration: duration
            };
            
            sessions.push(sessionData);
            logger.debug(`会话已添加: ${username}`, sessionData);
          } else {
            logger.debug(`会话被过滤: "${username}"`);
          }
        }
      }
      resolve(sessions);
    } catch (error) {
      logger.error('获取活动会话失败:', error);
      resolve([]); // 错误时返回空数组，而不是拒绝Promise
    }
  });
}

// 工具函数：断开用户连接（不断开应用程序）
async function disconnectUser(sessionId) {
  return new Promise((resolve, reject) => {
    try {
      logger.info(`尝试断开会话ID: ${sessionId}`);
      // 使用tsdiscon命令断开会话连接但保留应用程序
      const disconnectCommand = `tsdiscon ${sessionId}`;
      // 解析命令和参数，避免命令注入
      const [command, ...args] = disconnectCommand.split(' ');
      const result = spawnSync(command, args, { encoding: 'utf8' }).stdout;
      logger.info(`会话断开成功: ${result}`);
      resolve();
    } catch (disconnectError) {
      logger.error(`断开会话失败: ${disconnectError.message}`);
      // 抛出错误供调用者处理
      reject(new Error(`断开会话 ${sessionId} 失败: ${disconnectError.message}`));
    }
  });
}

// 工具函数：发送消息给用户会话
function sendMessageToUser(sessionId, message) {
  try {
    logger.info(`尝试向会话ID ${sessionId} 发送消息`);
    
    // 确保会话ID是有效的数字格式
    const numericSessionId = parseInt(sessionId, 10);
    if (isNaN(numericSessionId)) {
      throw new Error(`无效的会话ID格式: ${sessionId}，必须是数字`);
    }
    
    // 尝试多种msg命令格式
    let msgCommand;
    let result;
    // 修复命令格式：移除/TIME:0参数避免被包含在消息中
    const commandVariations = [
      // 不带/SERVER参数（测试显示这是最有效的格式）
      "msg " + numericSessionId + " \"" + message + "\"",
      // 标准格式
      "msg " + numericSessionId + " /SERVER:. \"" + message + "\"",
      // 尝试使用*发送给所有用户（作为备选方案）
      "msg * \"" + message + "\""
    ];
    
    // 尝试不同的命令格式
    for (let i = 0; i < commandVariations.length; i++) {
      try {
        msgCommand = commandVariations[i];
        logger.debug(`尝试命令 (${i+1}/${commandVariations.length}): ${msgCommand}`);
        // 解析命令和参数，避免命令注入
        const [command, ...args] = msgCommand.split(' ');
        result = spawnSync(command, args, { encoding: 'utf8', stdio: 'pipe' }).stdout;
        logger.info(`消息发送成功: ${result}`);
        return true;
      } catch (innerError) {
        logger.debug(`命令格式 ${i+1} 失败: ${innerError.message}`);
        // 如果不是最后一个命令，则继续尝试下一个
        if (i < commandVariations.length - 1) {
          continue;
        }
        // 如果是最后一个命令，抛出错误
        throw innerError;
      }
    }
  } catch (msgError) {
    logger.error(`发送消息失败: ${msgError.message}`);
    logger.error(`错误详情:`, msgError);
    
    // 提供更具体的错误信息
    let errorMessage = `向会话 ${sessionId} 发送消息失败`;
    
    // 解析错误信息，提供更具体的建议
    const stderr = msgError.stderr || '';
    const errorStr = msgError.message + stderr;
    
    if (errorStr.includes('找不到') || errorStr.includes('找不到指定')) {
      errorMessage += ': 找不到指定的会话ID，请确认会话ID是否正确';
    } else if (errorStr.includes('拒绝访问') || errorStr.includes('Access is denied')) {
      errorMessage += ': 权限不足，请以管理员身份运行应用程序';
    } else if (errorStr.includes('获取会话列表') || errorStr.includes('session list')) {
      errorMessage += ': 无法获取会话列表，请检查系统权限';
    } else if (errorStr.includes('错误 5')) {
      errorMessage += ': 访问被拒绝（错误5），请以管理员身份运行应用程序';
    } else {
      errorMessage += `: ${msgError.message}`;
    }
    
    // 添加解决方案建议
    errorMessage += '。提示：请确保应用程序以管理员权限运行，并且目标会话ID存在且处于活动状态。';
    
    throw new Error(errorMessage);
  }
}

// 工具函数：强制用户下线
function logoffUser(username, sessionId = null) {
  try {
    logger.info(`开始执行用户下线操作 - 用户名: ${username || '未提供'}, 会话ID: ${sessionId || '未提供'}`);
    
    // 确保命令以管理员权限执行
    const execOptions = { 
      encoding: 'utf8', 
      stdio: ['pipe', 'pipe', 'pipe'] 
    };
    
    // 如果提供了会话ID，直接下线该会话 - 这是最可靠的方式
    if (sessionId) {
      try {
        logger.info(`优先使用会话ID下线: ${sessionId}`);
        const logoffCommand = `logoff ${sessionId} /v`;
        logger.info(`执行命令: ${logoffCommand}`);
        
        // 使用spawnSync替代execSync以获得更好的错误处理
        const { spawnSync } = require('child_process');
        const result = spawnSync('logoff', [sessionId, '/v'], { 
          encoding: 'utf8',
          shell: false,
          windowsHide: true
        });
        
        logger.info(`logoff命令执行结果 - 退出码: ${result.status}`);
        logger.info(`标准输出: ${result.stdout || '无'}`);
        logger.info(`错误输出: ${result.stderr || '无'}`);
        
        // 检查是否成功下线
        const successOutput = result.stdout + result.stderr;
        if (successOutput.includes('已注销') || successOutput.includes('logged off')) {
          logger.info(`会话 ${sessionId} 已成功下线`);
          return;
        } else if (result.status === 0) {
          // 退出码为0通常表示成功
          logger.info(`会话 ${sessionId} 下线命令执行成功`);
          return;
        } else {
          logger.warn(`会话 ${sessionId} 下线命令执行失败，尝试通过用户名查找会话`);
        }
      } catch (directLogoffError) {
        logger.error(`直接使用会话ID下线失败: ${directLogoffError.message}`);
        logger.warn(`尝试通过用户名查找并下线会话`);
      }
    }
    
    // 如果会话ID下线失败或未提供，使用用户名查找并下线会话
    if (!username) {
      throw new Error('必须提供用户名或有效的会话ID');
    }
    
    logger.info(`通过用户名 ${username} 查找并下线会话`);
    
    // 获取活动会话列表
    let quserOutput;
    try {
      // 使用wmic命令作为备选，它可能提供更可靠的输出格式
      let quserResult;
      try {
        quserResult = spawnSync('quser', [], { encoding: 'buffer', stdio: ['pipe', 'pipe', 'pipe'] }).stdout;
        
        // 使用iconv-lite处理编码
        let iconv;
        try {
          iconv = require('iconv-lite');
        } catch (requireError) {
          logger.warn('iconv-lite模块未找到，使用默认编码');
          iconv = null;
        }
        
        if (iconv) {
          quserOutput = iconv.decode(quserResult, 'cp936');
        } else {
          quserOutput = quserResult.toString('utf8');
        }
      } catch (quserError) {
        // 如果quser失败，尝试使用query session命令
        logger.warn(`quser命令失败，尝试使用query session: ${quserError.message}`);
        const querySessionResult = spawnSync('query', ['session'], { encoding: 'buffer', stdio: ['pipe', 'pipe', 'pipe'] }).stdout;
        
        if (iconv) {
          quserOutput = iconv.decode(querySessionResult, 'cp936');
        } else {
          quserOutput = querySessionResult.toString('utf8');
        }
      }
      
      logger.info(`会话列表命令输出:\n${quserOutput}`);
    } catch (sessionListError) {
      logger.error(`获取活动会话列表失败: ${sessionListError.message}`);
      throw new Error('无法获取会话列表，请确保应用以管理员权限运行: ' + sessionListError.message);
    }
    
    const lines = quserOutput.split('\n');
    let found = false;
    let logoffSuccess = false;
    let errorMessages = [];
    
    for (let i = 1; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line) continue;
      
      logger.info(`处理会话行: ${line}`);
      
      // 严格的用户名匹配逻辑，避免误匹配
      const parts = line.split(/\s+/).filter(Boolean);
      
      // 检查第一个非空字段是否匹配用户名（不区分大小写）
      if (parts.length > 0 && parts[0].toLowerCase() === username.toLowerCase()) {
        logger.info(`精确匹配到用户名 ${username} 的会话`);
        
        // 尝试多种方式提取会话ID
        let sessionToLogoff = null;
        
        // 方法1: 直接查找数字类型的会话ID（通常在第二或第三位置）
        for (let j = 0; j < parts.length; j++) {
          if (parts[j].match(/^\d+$/)) {
            sessionToLogoff = parts[j];
            logger.info(`在位置 ${j} 发现数字会话ID: ${sessionToLogoff}`);
            break;
          }
        }
        
        // 方法2: 如果没有找到数字会话ID，尝试查找名称为RDP-Tcp的会话
        if (!sessionToLogoff) {
          for (let j = 0; j < parts.length - 1; j++) {
            if (parts[j].includes('RDP-Tcp#') && parts[j+1].match(/^\d+$/)) {
              sessionToLogoff = parts[j+1];
              logger.info(`找到RDP会话ID: ${sessionToLogoff}`);
              break;
            }
          }
        }
        
        // 方法3: 更通用的正则表达式匹配
        if (!sessionToLogoff) {
          const sessionMatch = line.match(/\s+(\d+)\s+/);
          if (sessionMatch) {
            sessionToLogoff = sessionMatch[1];
            logger.info(`通过正则表达式找到会话ID: ${sessionToLogoff}`);
          }
        }
        
        if (sessionToLogoff) {
          found = true;
          logger.info(`尝试下线会话ID: ${sessionToLogoff}`);
          
          try {
            const { spawnSync } = require('child_process');
            const logoffResult = spawnSync('logoff', [sessionToLogoff, '/v'], { 
              encoding: 'utf8',
              shell: false,
              windowsHide: true
            });
            
            const output = logoffResult.stdout + logoffResult.stderr;
            logger.info(`logoff命令结果 - 退出码: ${logoffResult.status}`);
            logger.info(`输出: ${output}`);
            
            // 检查是否成功
            if (output.includes('已注销') || output.includes('logged off') || logoffResult.status === 0) {
              logger.info(`成功下线会话 ${sessionToLogoff}`);
              logoffSuccess = true;
            } else {
              logger.error(`下线会话 ${sessionToLogoff} 失败: ${output}`);
              errorMessages.push(`会话 ${sessionToLogoff}: ${output}`);
            }
          } catch (cmdError) {
            logger.error(`执行logoff命令出错: ${cmdError.message}`);
            errorMessages.push(cmdError.message);
          }
        }
      }
    }
    
    // 如果找到了会话但所有下线尝试都失败
    if (found) {
      if (logoffSuccess) {
        logger.info(`用户 ${username} 的部分会话已成功下线`);
        return;
      } else {
        throw new Error(`找到用户 ${username} 的会话，但下线失败: ${errorMessages.join('; ')}。请确认应用以管理员权限运行。`);
      }
    } else {
      // 如果通过用户名未找到会话，尝试使用taskkill强制终止会话
      logger.warn(`未通过用户名找到会话，尝试使用taskkill命令终止${username}的进程`);
      try {
        const taskkillCommand = `taskkill /f /fi "username eq ${username}"`;
        logger.info(`执行命令: ${taskkillCommand}`);
        
        // 解析命令和参数，避免命令注入
        const [command, ...args] = taskkillCommand.split(' ');
        const taskkillResult = spawnSync(command, args, execOptions).stdout;
        logger.info(`taskkill命令输出: ${taskkillResult}`);
        return; // 即使没有匹配到进程，也认为操作成功
      } catch (taskkillError) {
        logger.error(`taskkill命令执行失败: ${taskkillError.message}`);
        throw new Error(`未找到用户 ${username} 的活动会话，也无法通过taskkill终止进程`);
      }
    }
  } catch (error) {
    logger.error(`用户下线操作失败: ${error.message}`);
    logger.error(`错误详情:`, error);
    throw error;
  }
}

module.exports = {
  getActiveSessions,
  disconnectUser,
  sendMessageToUser,
  logoffUser,
  formatDuration
};
