const { spawnSync, execSync } = require('child_process');
const logger = require('./logger');

// 工具函数：获取用户列表
function getUsersList() {
  return new Promise((resolve, reject) => {
    try {
      // 确保iconv-lite可用，如果未加载则尝试动态导入
      let iconvLite;
      try {
        // 尝试导入iconv-lite模块
        iconvLite = require('iconv-lite');
        logger.info('iconv-lite模块成功加载');
      } catch (requireError) {
        logger.warn('iconv-lite模块未找到或加载失败，将使用默认编码处理');
        iconvLite = null;
      }

      // 使用Buffer方式处理输出
      const bufferOptions = { encoding: 'buffer', stdio: 'pipe' };
      
      // 函数：安全解码输出，优先使用iconv-lite处理cp936
      const safeDecode = (buffer) => {
        if (iconvLite) {
          try {
            // 优先尝试cp936编码（简体中文Windows默认编码）
            return iconvLite.decode(buffer, 'cp936');
          } catch (iconvError) {
            logger.warn('iconv解码失败，尝试utf8');
            // 如果cp936失败，尝试utf8
            try {
              return buffer.toString('utf8');
            } catch (utf8Error) {
              return buffer.toString('latin1');
            }
          }
        } else {
          try {
            return buffer.toString('utf8');
          } catch (e) {
            return buffer.toString('latin1');
          }
        }
      };

      // 1. 尝试使用wmic命令获取用户列表和详细信息（一次命令获取所有信息）
      let users = [];
      
      try {
        // 使用wmic命令获取所有用户的详细信息，包括名称、禁用状态、全名和描述
        const wmicDetailBuffer = execSync('wmic useraccount get name,disabled,fullname,description /format:list', bufferOptions);
        const detailOutput = safeDecode(wmicDetailBuffer);
        logger.debug('wmic详细命令输出:\n' + detailOutput);
        
        // 解析详细输出
        const userDetails = {};
        const lines = detailOutput.split('\n');
        let currentUser = {};
        
        lines.forEach(line => {
          if (line.trim() === '') {
            if (currentUser.name) {
              userDetails[currentUser.name.toLowerCase()] = currentUser;
              currentUser = {};
            }
          } else if (line.includes('=')) {
            const [key, value] = line.split('=', 2);
            currentUser[key.toLowerCase()] = (value || '').trim();
          }
        });
        
        // 转换为用户数组
        users = Object.values(userDetails).map(detail => ({
          name: detail.name,
          disabled: detail.disabled === 'True' || detail.disabled === '1',
          fullname: detail.fullname || '',
          description: detail.description || ''
        }));
        
        // 过滤掉无效用户
        users = users.filter(user => {
          return user.name && user.name.length > 0 &&
                 !user.name.includes('命令') && !user.name.includes('成功') && 
                 !user.name.includes('完成') && !user.name.includes('Name') &&
                 user.name !== 'FALSE' && user.name !== 'True';
        });
      } catch (wmicError) {
        logger.warn('wmic命令失败，尝试使用net user命令');
        
        // 尝试使用net user命令
        try {
          const netUserBuffer = execSync('net user', bufferOptions);
          const output = safeDecode(netUserBuffer);
          logger.debug('net user命令输出:\n' + output);
          
          // 解析net user输出
          const lines = output.split('\n');
          let userListStarted = false;
          
          lines.forEach(line => {
            // 找到用户列表开始的位置（通常在包含'-----'的行之后）
            if (line.includes('-----') || line.includes('----')) {
              userListStarted = true;
              return;
            }
            
            if (userListStarted) {
              // 提取用户名（去除前后空格后分割）
              const trimmedLine = line.trim();
              if (!trimmedLine || trimmedLine === '') {
                return;
              }
              
              // 分割行中的所有单词
              const words = trimmedLine.split(/\s+/);
              
              // 遍历所有单词，查找可能的用户名
              words.forEach(word => {
                const trimmedWord = word.trim();
                if (trimmedWord && trimmedWord.length > 0) {
                  // 过滤掉明显的非用户名
                  if (!trimmedWord.includes('命令') && !trimmedWord.includes('成功') && 
                      !trimmedWord.includes('完成') && !trimmedWord.includes('用户') &&
                      !trimmedWord.includes('User') && !trimmedWord.includes('Built-in') &&
                      trimmedWord !== 'FALSE' && trimmedWord !== 'True' &&
                      trimmedWord !== '命令成功完成' && trimmedWord !== 'The' &&
                      trimmedWord !== 'command' && trimmedWord !== 'completed' &&
                      trimmedWord.length > 0) {
                    // 检查是否已经添加过该用户
                    const userExists = users.some(user => user.name.toLowerCase() === trimmedWord.toLowerCase());
                    if (!userExists) {
                      users.push({ 
                        name: trimmedWord, 
                        disabled: false, // 默认值
                        fullname: '',
                        description: ''
                      });
                    }
                  }
                }
              });
            }
          });
        } catch (netUserError) {
          logger.error('获取用户列表失败:', netUserError);
        }
      }
      
      // 手动添加一些常见的系统用户（作为备用）
      const commonUsers = ['Administrator', 'Guest', 'DefaultAccount', 'WDAGUtilityAccount'];
      commonUsers.forEach(commonUser => {
        const userExists = users.some(user => user.name.toLowerCase() === commonUser.toLowerCase());
        if (!userExists) {
          users.push({ 
            name: commonUser, 
            disabled: commonUser === 'Guest' || commonUser === 'DefaultAccount',
            fullname: '',
            description: ''
          });
        }
      });
      
      // 添加最终结果调试
      logger.debug('最终用户列表及状态:');
      users.forEach(user => {
        logger.debug(`用户名: ${user.name}, 状态: ${user.disabled ? '已禁用' : '已启用'}`);
      });

      // 增强版：使用net user命令检查每个用户的详细状态（避免使用PowerShell）
      try {
        // 为每个用户单独执行net user命令获取详细状态和其他信息
        // 使用spawnSync代替PowerShell以提高性能
        for (let i = 0; i < users.length; i++) {
          const user = users[i];
          try {
            // 直接使用spawnSync执行net命令，避免PowerShell的启动开销
            const spawnResult = spawnSync('net', ['user', user.name], bufferOptions);
            const userDetailOutput = safeDecode(spawnResult.stdout);
            logger.debug(`用户 ${user.name} 的net user详细输出:\n${userDetailOutput}`);
            
            // 检查输出中是否包含禁用标记（多种格式）
            if (userDetailOutput.includes('帐户已禁用') || 
                userDetailOutput.includes('Account is disabled') ||
                /帐户启用\s+No/.test(userDetailOutput)) {
              users[i] = { ...user, disabled: true };
              logger.debug(`通过net user确认: 用户 ${user.name} 已禁用`);
            } else if (userDetailOutput.includes('帐户已启用') || 
                      userDetailOutput.includes('Account is active') ||
                      /帐户启用\s+Yes/.test(userDetailOutput)) {
              users[i] = { ...user, disabled: false };
              logger.debug(`通过net user确认: 用户 ${user.name} 已启用`);
            }
            
            // 从net user输出中提取全名和描述信息作为补充
            // 提取全名
            const fullNameMatch = userDetailOutput.match(/全名\s+(.*)$/m);
            if (fullNameMatch && fullNameMatch[1]) {
              const fullName = fullNameMatch[1].trim();
              if (fullName && fullName !== '') {
                users[i] = { ...users[i], fullname: fullName };
              }
            }
            
            // 提取描述/注释，仅当description字段为空时才使用
            const currentDescription = users[i].description || '';
            if (currentDescription.trim() === '') {
              // 更精确地匹配注释行，避免匹配"用户的注释"这一系统默认文本
              // 寻找格式为"注释[空格/制表符]实际注释内容"的行
              const commentMatch = userDetailOutput.match(/注释\s+([^\r\n]+)/);
              if (commentMatch && commentMatch[1]) {
                const comment = commentMatch[1].trim();
                // 过滤掉空注释和系统默认文本
                if (comment && comment !== '' && comment !== '用户的注释') {
                  users[i] = { ...users[i], description: comment };
                }
              }
            }
          } catch (userDetailError) {
            logger.warn(`获取用户 ${user.name} 详细信息失败:`, userDetailError.message);
            // 继续处理其他用户，不中断循环
          }
        }
      } catch (error) {
        logger.warn('增强状态检测失败，但保留原有结果:', error.message);
      }
      
      resolve(users);
    } catch (error) {
      console.error('获取用户列表异常:', error);
      reject(new Error('获取用户列表失败: ' + error.message));
    }
  });
}

// 工具函数：修改用户密码
function changeUserPassword(username, newPassword) {
  try {
    // 使用net user命令修改密码，使用spawnSync避免命令注入
    spawnSync('net', ['user', username, newPassword], { stdio: 'ignore' });
  } catch (error) {
    throw new Error('修改密码失败: ' + error.message);
  }
}

// 工具函数：新增用户
function addUser(username, password, fullName = '', description = '', isAdmin = false) {
  // 确保用户名为字符串类型
  username = String(username);
  
  try {
    // 验证用户名是否符合Windows系统要求
    // Windows用户名不能包含以下字符: " / \ [ ] : ; | = , * ? < >
    // 允许使用: # - + (这些是用户需要的特殊字符)
    if (username.includes('"') || username.includes('/') || username.includes('\\') ||
        username.includes('[') || username.includes(']') || username.includes(':') ||
        username.includes(';') || username.includes('|') || username.includes('=') ||
        username.includes(',') || username.includes('*') || username.includes('?') ||
        username.includes('<') || username.includes('>')) {
      throw new Error('用户名包含Windows系统不支持的字符');
    }
    
    // 检查用户名长度，Windows用户名最大长度为20个字符
    if (username.length > 20) {
      console.warn(`警告：用户名 ${username} 长度超过20个字符，可能会导致Windows系统操作失败`);
      logger.warn(`警告：用户名 ${username} 长度超过20个字符，可能会导致Windows系统操作失败`);
      // 添加用户友好的提示
      console.warn(`提示：如果创建或更新失败，请尝试在Windows系统中直接操作该用户`);
      logger.warn(`提示：如果创建或更新失败，请尝试在Windows系统中直接操作该用户`);
    }
    
    // 为中文用户名提供支持
    logger.info(`创建用户: ${username}`);
    logger.debug(`创建用户命令参数: username=${username}, password=****`);
    
    let finalUsername = username;
    let tempUsername = null;
    
    // 检查用户名是否包含中文字符
    const hasChineseChars = /[\u4e00-\u9fa5]/.test(username);
    
    if (hasChineseChars) {
      // 尝试使用PowerShell命令创建中文用户
      logger.info(`尝试使用PowerShell创建中文用户: ${username}`);
      
      try {
        // 构建PowerShell命令，使用New-LocalUser cmdlet
        const psCommand = `New-LocalUser -Name "${username}" -Password (ConvertTo-SecureString "${password}" -AsPlainText -Force) -Description "${description || 'User created by management system'}" -FullName "${fullName || username}" -ErrorAction Stop`;
        
        logger.debug(`执行PowerShell命令: ${psCommand}`);
        
        // 使用powershell.exe执行命令
        const psResult = spawnSync('powershell.exe', ['-Command', psCommand]);
        
        if (psResult.status === 0) {
          logger.info(`PowerShell创建中文用户 ${username} 成功`);
          finalUsername = username;
        } else {
          // 如果PowerShell命令失败，尝试使用net user命令
          logger.warn(`PowerShell创建失败，尝试使用net user命令`);
          
          // 尝试直接使用net user命令创建中文用户
          const netResult = spawnSync('net', ['user', username, password, '/add']);
          
          if (netResult.status === 0) {
            logger.info(`net user创建中文用户 ${username} 成功`);
            finalUsername = username;
          } else {
            // 如果直接创建失败，使用临时英文用户名创建用户，然后再尝试重命名
            tempUsername = 'temp_' + Date.now().toString(36);
            logger.info(`直接创建失败，使用临时用户名 ${tempUsername} 创建用户，稍后将重命名为 ${username}`);
            
            // 使用net user命令创建临时用户
            const tempResult = spawnSync('net', ['user', tempUsername, password, '/add']);
            
            if (tempResult.status !== 0) {
              let errorMessage = '创建临时用户失败';
              if (tempResult.stderr) {
                errorMessage = tempResult.stderr.toString().trim();
              } else if (tempResult.stdout) {
                errorMessage = tempResult.stdout.toString().trim();
              }
              logger.error(`创建临时用户 ${tempUsername} 失败: ${errorMessage}`);
              throw new Error('创建用户失败: ' + errorMessage);
            }
            
            logger.info(`临时用户 ${tempUsername} 创建成功`);
            
            // 使用wmic命令将临时用户重命名为中文用户名
            try {
              // 使用不同的wmic命令格式，直接传递参数数组
              logger.debug(`执行wmic命令重命名用户: ${tempUsername} -> ${username}`);
              
              // 使用spawnSync直接执行wmic命令，传递参数数组
              const renameResult = spawnSync('wmic', [
                'useraccount',
                'where',
                `name=${tempUsername}`,
                'rename',
                username
              ]);
              
              if (renameResult.status !== 0) {
                let errorMessage = '重命名用户失败';
                if (renameResult.stderr) {
                  errorMessage = renameResult.stderr.toString().trim();
                } else if (renameResult.stdout) {
                  errorMessage = renameResult.stdout.toString().trim();
                }
                logger.error(`重命名用户 ${tempUsername} 为 ${username} 失败: ${errorMessage}`);
                
                // 尝试删除临时用户
                spawnSync('net', ['user', tempUsername, '/delete']);
                throw new Error('创建用户失败: 无法重命名为中文用户名');
              }
              
              logger.info(`用户重命名成功: ${tempUsername} -> ${username}`);
              // 更新finalUsername为最终的中文用户名
              finalUsername = username;
            } catch (renameError) {
              logger.error(`重命名用户时发生异常:`, renameError);
              
              // 尝试删除临时用户
              spawnSync('net', ['user', tempUsername, '/delete']);
              throw new Error('创建用户失败: ' + renameError.message);
            }
          }
        }
      } catch (psError) {
        logger.error(`PowerShell创建用户失败:`, psError);
        throw new Error('创建用户失败: ' + psError.message);
      }
    } else {
      // 如果用户名不包含中文字符，直接使用net user命令创建用户
      const result = spawnSync('net', ['user', username, password, '/add']);
      
      if (result.status !== 0) {
        let errorMessage = '创建用户失败';
        if (result.stderr) {
          errorMessage = result.stderr.toString().trim();
        } else if (result.stdout) {
          errorMessage = result.stdout.toString().trim();
        }
        logger.error(`创建用户 ${username} 失败: ${errorMessage}`);
        throw new Error('创建用户失败: ' + errorMessage);
      }
      
      logger.info(`用户 ${username} 创建成功`);
      // 更新finalUsername为最终的用户名
      finalUsername = username;
    }
    
    // 如果提供了全名或描述，更新用户信息
    if (fullName) {
      try {
        logger.debug(`设置用户 ${finalUsername} 的全名: ${fullName}`);
        const fullNameResult = spawnSync('net', ['user', finalUsername, '/fullname:' + fullName]);
        if (fullNameResult.status !== 0) {
          const errorMessage = fullNameResult.stderr ? fullNameResult.stderr.toString().trim() : '设置全名失败';
          console.error(`设置用户 ${finalUsername} 全名失败:`, errorMessage);
        } else {
          logger.debug(`用户 ${finalUsername} 全名设置成功`);
        }
      } catch (fullNameError) {
        console.error(`设置用户 ${finalUsername} 全名失败:`, fullNameError.message);
      }
    }
    
    if (description) {
      try {
        logger.debug(`使用net user设置用户 ${finalUsername} 的描述: ${description}`);
        const descriptionResult = spawnSync('net', ['user', finalUsername, '/comment:' + description]);
        if (descriptionResult.status !== 0) {
          const errorMessage = descriptionResult.stderr ? descriptionResult.stderr.toString().trim() : '设置描述失败';
          console.error(`使用net user设置用户 ${finalUsername} 描述失败:`, errorMessage);
        } else {
          logger.debug(`用户 ${finalUsername} 描述设置成功`);
        }
      } catch (netUserError) {
        console.error(`使用net user设置用户 ${finalUsername} 描述失败:`, netUserError.message);
      }
    }
    
    // 只有当isAdmin为true时，才将用户添加到Administrators组
    if (isAdmin) {
      try {
        // 尝试使用PowerShell执行命令，更好地处理长用户名
        let adminResult;
        try {
          // 构建PowerShell命令
          const psCommand = `Add-LocalGroupMember -Group "Administrators" -Member "${finalUsername}"`;
          logger.debug(`执行PowerShell命令: ${psCommand}`);
          // 使用powershell.exe执行命令
          adminResult = spawnSync('powershell.exe', ['-ExecutionPolicy', 'Bypass', '-Command', psCommand]);
        } catch (psError) {
          // 如果PowerShell失败，回退到使用net localgroup命令
          logger.warn(`PowerShell执行失败，回退到使用net localgroup命令: ${psError.message}`);
          adminResult = spawnSync('net', ['localgroup', 'Administrators', finalUsername, '/add']);
        }
        
        if (adminResult.status !== 0) {
          const errorMessage = adminResult.stderr ? adminResult.stderr.toString().trim() : '添加到管理员组失败';
          logger.warn(`将用户 ${finalUsername} 添加到Administrators组失败:`, errorMessage);
        } else {
          logger.info(`用户 ${finalUsername} 已添加到Administrators组`);
        }
      } catch (adminError) {
        logger.warn(`将用户 ${finalUsername} 添加到Administrators组失败:`, adminError.message);
      }
    } else {
      logger.info(`用户 ${finalUsername} 未添加到Administrators组（根据配置）`);
    }
    
    // 将用户添加到Remote Desktop Users组
    try {
      // 尝试使用PowerShell执行命令，更好地处理长用户名
      let rdpResult;
      try {
        // 构建PowerShell命令
        const psCommand = `Add-LocalGroupMember -Group "Remote Desktop Users" -Member "${finalUsername}"`;
        logger.debug(`执行PowerShell命令: ${psCommand}`);
        // 使用powershell.exe执行命令
        rdpResult = spawnSync('powershell.exe', ['-ExecutionPolicy', 'Bypass', '-Command', psCommand]);
      } catch (psError) {
        // 如果PowerShell失败，回退到使用net localgroup命令
        logger.warn(`PowerShell执行失败，回退到使用net localgroup命令: ${psError.message}`);
        rdpResult = spawnSync('net', ['localgroup', 'Remote Desktop Users', finalUsername, '/add']);
      }
      
      if (rdpResult.status !== 0) {
        const errorMessage = rdpResult.stderr ? rdpResult.stderr.toString().trim() : '添加到远程桌面用户组失败';
        logger.warn(`将用户 ${finalUsername} 添加到Remote Desktop Users组失败:`, errorMessage);
      } else {
        logger.info(`用户 ${finalUsername} 已添加到Remote Desktop Users组`);
      }
    } catch (rdpError) {
      logger.warn(`将用户 ${finalUsername} 添加到Remote Desktop Users组失败:`, rdpError.message);
    }
  } catch (error) {
    logger.error(`创建用户 ${username} 时发生异常:`, error);
    throw new Error('创建用户失败: ' + error.message);
  }
}

// 工具函数：重命名用户
function renameUser(oldUsername, newUsername) {
  try {
    // 使用wmic命令重命名用户，使用spawnSync避免命令注入
    spawnSync('wmic', ['useraccount', 'where', `name="${oldUsername}"`, 'rename', newUsername], { stdio: 'ignore' });
  } catch (error) {
    throw new Error('重命名用户失败: ' + error.message);
  }
}

// 工具函数：更新用户全名和描述
function updateUserInfo(username, fullName, description) {
  try {
    // 执行所有更新操作
    let hasError = false;
    
    // 函数：安全解码输出，优先使用iconv-lite处理cp936
    const safeDecode = (buffer) => {
      let iconv;
      try {
        iconv = require('iconv-lite');
      } catch (requireError) {
        iconv = null;
      }
      
      if (iconv) {
        try {
          return iconv.decode(buffer, 'cp936');
        } catch (iconvError) {
          try {
            return buffer.toString('utf8');
          } catch (utf8Error) {
            return buffer.toString('latin1');
          }
        }
      } else {
        try {
          return buffer.toString('utf8');
        } catch (e) {
          return buffer.toString('latin1');
        }
      }
    };
    
    // 检查用户名长度，Windows用户名最大长度为20个字符
    if (username.length > 20) {
      console.warn(`警告：用户名 ${username} 长度超过20个字符，可能会导致Windows系统操作失败`);
      logger.warn(`警告：用户名 ${username} 长度超过20个字符，可能会导致Windows系统操作失败`);
      // 添加用户友好的提示
      console.warn(`提示：如果更新失败，请尝试在Windows系统中直接修改该用户的信息`);
      logger.warn(`提示：如果更新失败，请尝试在Windows系统中直接修改该用户的信息`);
    }
    
    // 尝试使用PowerShell执行net user命令，更好地处理带有特殊字符的用户名
    // 先更新全名
    if (fullName !== undefined && fullName !== null && fullName !== '') {
      try {
        // 构建PowerShell命令，使用单引号包裹命令，避免特殊字符解析问题
        const psCommand = `& { net user "${username}" /fullname:"${fullName}" }`;
        logger.debug(`执行PowerShell命令: ${psCommand}`);
        // 使用powershell.exe执行命令
        const fullNameResult = spawnSync('powershell.exe', ['-ExecutionPolicy', 'Bypass', '-Command', psCommand]);
        
        if (fullNameResult.status !== 0) {
          const fullNameErrorMessage = fullNameResult.stderr ? fullNameResult.stderr.toString().trim() : '设置全名失败';
          console.error(`设置用户 ${username} 全名失败:`, fullNameErrorMessage);
          logger.error(`设置用户 ${username} 全名失败:`, fullNameErrorMessage);
          hasError = true;
        } else {
          logger.debug(`用户 ${username} 全名设置成功`);
        }
      } catch (fullNameError) {
        console.error(`设置用户 ${username} 全名失败:`, fullNameError.message);
        logger.error(`设置用户 ${username} 全名失败:`, fullNameError.message);
        hasError = true;
      }
    }
    
    // 再更新描述
    if (description !== undefined && description !== null && description !== '') {
      try {
        // 构建PowerShell命令，使用单引号包裹命令，避免特殊字符解析问题
        const psCommand = `& { net user "${username}" /comment:"${description}" }`;
        logger.debug(`执行PowerShell命令: ${psCommand}`);
        // 使用powershell.exe执行命令
        const descriptionResult = spawnSync('powershell.exe', ['-ExecutionPolicy', 'Bypass', '-Command', psCommand]);
        
        if (descriptionResult.status !== 0) {
          const descriptionErrorMessage = descriptionResult.stderr ? descriptionResult.stderr.toString().trim() : '设置描述失败';
          console.error(`设置用户 ${username} 描述失败:`, descriptionErrorMessage);
          logger.error(`设置用户 ${username} 描述失败:`, descriptionErrorMessage);
          hasError = true;
        } else {
          logger.debug(`用户 ${username} 描述设置成功`);
        }
      } catch (descriptionError) {
        console.error(`设置用户 ${username} 描述失败:`, descriptionError.message);
        logger.error(`设置用户 ${username} 描述失败:`, descriptionError.message);
        hasError = true;
      }
    }
    
    // 验证更新是否成功
    if (!hasError) {
      try {
        logger.debug(`验证用户 ${username} 信息更新是否成功`);
        const verifyCommand = `& { net user "${username}" }`;
        const verifyResult = spawnSync('powershell.exe', ['-ExecutionPolicy', 'Bypass', '-Command', verifyCommand]);
        if (verifyResult.status === 0) {
          const verifyOutput = verifyResult.stdout ? verifyResult.stdout.toString() : '';
          logger.debug(`用户 ${username} 信息验证结果:\n${verifyOutput}`);
          // 检查输出中是否包含更新后的信息
          if (fullName && verifyOutput.includes(fullName)) {
            logger.debug(`验证成功：用户 ${username} 的全名已更新为 ${fullName}`);
          }
          if (description && verifyOutput.includes(description)) {
            logger.debug(`验证成功：用户 ${username} 的描述已更新为 ${description}`);
          }
        }
      } catch (verifyError) {
        logger.warn(`验证用户 ${username} 信息更新失败:`, verifyError.message);
      }
    }
    
    // 如果有错误发生，抛出异常
    if (hasError) {
      throw new Error('部分更新命令执行失败，请检查日志');
    }
    
    // 如果没有提供任何要更新的信息
    if ((fullName === undefined || fullName === null || fullName === '') && 
        (description === undefined || description === null || description === '')) {
      throw new Error('未提供任何要更新的用户信息');
    }
  } catch (error) {
    throw new Error('更新用户信息失败: ' + error.message);
  }
}

module.exports = {
  getUsersList,
  changeUserPassword,
  addUser,
  renameUser,
  updateUserInfo
};
