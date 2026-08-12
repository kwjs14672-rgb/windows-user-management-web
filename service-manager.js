const path = require('path');
const { execSync } = require('child_process');
const fs = require('fs');
const readline = require('readline');

// 创建命令行交互界面
const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

// 简单的命令执行函数，不依赖iconv
function simpleExecuteCommand(command) {
  try {
    return execSync(command, {
      encoding: 'utf8',
      windowsHide: true
    });
  } catch (error) {
    if (error.stderr) {
      return error.stderr.toString('utf8');
    }
    throw error;
  }
}

// 安装依赖函数（独立功能，不依赖其他模块）
function installDependencies() {
  console.log('\n正在安装依赖...\n');
  console.log('执行命令: npm install');
  console.log('=========================================');
  
  try {
    const result = simpleExecuteCommand('npm install');
    console.log(result);
    console.log('=========================================');
    console.log('依赖安装成功！');
    console.log('\n请重新运行服务管理器以使用其他功能。');
  } catch (error) {
    console.error('依赖安装失败:', error.message);
  }
  
  rl.question('\n按回车键退出...', () => {
    rl.close();
  });
}

// 检查是否需要安装依赖
const args = process.argv.slice(2);
if (args.length > 0 && args[0] === '0') {
  // 如果明确请求安装依赖，直接执行
  installDependencies();
} else {
  // 否则检查核心依赖是否安装
  let Service, iconv;
  try {
    Service = require('node-windows').Service;
    iconv = require('iconv-lite'); // 用于处理编码转换
  } catch (error) {
    console.error('=========================================');
    console.error('错误：缺少必要的依赖包！');
    console.error('请先安装依赖：npm install');
    console.error('或运行：node service-manager.js 0');
    console.error('=========================================');
    rl.close();
    process.exit(1);
  }
  
  // **辅助函数：执行命令并正确处理编码**
  function executeCommand(command) {
    try {
      // 不指定encoding，获取原始Buffer
      const buffer = execSync(command, {
        windowsHide: true,
        encoding: null // 返回Buffer，不自动解码
      });
      // 使用iconv-lite将GBK编码转换为UTF-8
      return iconv.decode(buffer, 'gbk');
    } catch (error) {
      // 如果是命令执行失败，返回错误信息
      if (error.stderr) {
        return iconv.decode(error.stderr, 'gbk');
      }
      throw error;
    }
  }
  
  // **关键：获取短路径（8.3格式）避免中文乱码**
  function getShortPath(longPath) {
    try {
      // 尝试获取短路径
      const result = executeCommand(`cmd /c for %A in ("${longPath}") do @echo %~sA`).trim();
      return result || longPath;
    } catch (error) {
      return longPath;
    }
  }
  
  // 检查是否存在 server.js 文件
  const serverJsPath = path.join(__dirname, 'server.js');
  if (!fs.existsSync(serverJsPath)) {
    console.error('错误：未找到 server.js 文件');
    rl.close();
    process.exit(1);
  }
  
  // 服务名称常量
  const SERVICE_NAME = 'RemoteUserPasswordManager';
  const SERVICE_NAME_WITH_EXE = 'RemoteUserPasswordManager.exe';
  
  // 显示菜单
  function showMenu() {
    console.clear();
    console.log('=========================================');
    console.log('  远程修改服务器用户密码与资源管理系统');
    console.log('             服务管理程序');
    console.log('=========================================');
    console.log('');
    console.log('  0. 安装依赖 (npm install)');
    console.log('  1. 安装服务（使用本地系统账户）');
    console.log('  2. 卸载服务');
    console.log('  3. 检查服务状态');
    console.log('  4. 退出');
    console.log('');
    
    rl.question('请选择操作 (0-4): ', (answer) => {
      handleMenuChoice(answer.trim());
    });
  }
  
  // 处理菜单选择
  function handleMenuChoice(choice) {
    switch (choice) {
      case '0':
        installDependencies();
        break;
      case '1':
        installService();
        break;
      case '2':
        uninstallService();
        break;
      case '3':
        checkServiceStatus();
        break;
      case '4':
        console.log('\n再见！');
        rl.close();
        break;
      default:
        console.log('\n无效的选择，请重新输入！');
        setTimeout(() => {
          showMenu();
        }, 1500);
        break;
    }
  }
  
  // 检查服务状态
  function checkServiceStatus() {
    console.log('\n正在检查服务状态...\n');
    
    try {
      // 使用短路径查询服务
      const result = executeCommand(`sc query ${SERVICE_NAME_WITH_EXE}`);
      console.log('=========================================');
      console.log('服务状态信息:');
      console.log('=========================================');
      console.log(result);
      
      // 检查是否在运行
      if (result.includes('RUNNING')) {
        console.log('服务正在运行');
      } else if (result.includes('STOPPED')) {
        console.log('服务已停止');
      }
    } catch (error) {
      console.log('服务未安装或无法访问');
    }
    
    rl.question('\n按回车键返回主菜单...', () => {
      showMenu();
    });
  }
  
  // 安装服务 - 使用本地系统账户
  function installService() {
    console.log('\n正在安装服务...\n');
    console.log('服务将使用本地系统账户运行');
    console.log('如需更改登录账户，请在安装后手动设置');
    console.log('');
    
    // **关键：使用短路径**
    const shortScriptPath = getShortPath(serverJsPath);
    const shortWorkingDir = getShortPath(__dirname);
    
    console.log('工作目录:', shortWorkingDir);
    console.log('脚本路径:', shortScriptPath);
    
    // **新增：确保 daemon 目录存在**
    const daemonDir = path.join(__dirname, 'daemon');
    if (!fs.existsSync(daemonDir)) {
      try {
        fs.mkdirSync(daemonDir, { recursive: true });
        console.log('已创建 daemon 目录:', daemonDir);
      } catch (error) {
        console.error('创建 daemon 目录失败:', error.message);
      }
    }
    
    // 创建服务配置
    const serviceConfig = {
      name: SERVICE_NAME,
      description: 'Remote User Password Management System', // **改为英文描述**
      script: shortScriptPath, // **使用短路径**
      wait: 2,
      grow: 0.5,
      maxRestarts: 3,
      // **指定工作目录为短路径**
      workingdirectory: shortWorkingDir
    };
    
    const service = new Service(serviceConfig);
    
    service.on('install', () => {
      console.log('服务安装成功！');
      console.log('账户: 本地系统账户');
      
      // 验证服务配置
      try {
        console.log('\n正在验证服务配置...');
        const configResult = executeCommand(`sc qc ${SERVICE_NAME_WITH_EXE}`);
        console.log('服务配置详情:');
        console.log(configResult);
      } catch (e) {
        console.log('无法验证服务配置，但安装已完成');
      }
      
      console.log('\n正在启动服务...');
      service.start();
    });
    
    service.on('start', () => {
      console.log('服务启动成功！');
      console.log('服务名称:', SERVICE_NAME_WITH_EXE);
      
      // 检查服务状态
      setTimeout(() => {
        try {
          const statusResult = executeCommand(`sc query ${SERVICE_NAME_WITH_EXE}`);
          console.log('\n当前运行状态:');
          console.log(statusResult);
        } catch (error) {
          console.log('无法获取服务状态，建议手动检查');
        }
        
        rl.question('\n按回车键返回主菜单...', () => {
          showMenu();
        });
      }, 2000);
    });
    
    service.on('error', (err) => {
      console.error('服务操作失败:', err.message);
      
      if (err.message.includes('Access is denied')) {
        console.error('权限不足，请以管理员身份运行');
      } else if (err.message.includes('already exists')) {
        console.error('服务已存在，请先卸载');
      }
      
      rl.question('\n按回车键返回主菜单...', () => {
        showMenu();
      });
    });
    
    service.on('alreadyinstalled', () => {
      console.log('服务已存在，请先卸载');
      
      rl.question('\n按回车键返回主菜单...', () => {
        showMenu();
      });
    });
    
    // 开始安装
    service.install();
  }
  
  // 卸载服务
  function uninstallService() {
    console.log('\n正在卸载服务...\n');
    
    const serviceConfig = {
      name: SERVICE_NAME,
      script: serverJsPath
    };
    
    const service = new Service(serviceConfig);
    
    service.on('uninstall', () => {
      console.log('服务卸载成功！');
      
      rl.question('\n按回车键返回主菜单...', () => {
        showMenu();
      });
    });
    
    service.on('alreadyuninstalled', () => {
      console.log('服务未安装');
      
      rl.question('\n按回车键返回主菜单...', () => {
        showMenu();
      });
    });
    
    service.on('error', (err) => {
      console.error('卸载失败:', err.message);
      if (err.message.includes('Access is denied')) {
        console.error('权限不足，请以管理员身份运行');
      }
      
      rl.question('\n按回车键返回主菜单...', () => {
        showMenu();
      });
    });
    
    service.uninstall();
  }
  
  // **中文路径检测函数**
  function checkChinesePath() {
    const currentPath = __dirname;
    // 检测是否包含中文（Unicode范围：\u4e00-\u9fa5）
    if (/[\u4e00-\u9fa5]/.test(currentPath)) {
      console.error('=========================================');
      console.error('错误：当前路径包含中文！');
      console.error('当前路径：', currentPath);
      console.error('为了确保服务正常运行，请将程序放在纯英文路径下。');
      console.error('=========================================');
      rl.close();
      process.exit(1);
    }
  }
  
  // 主程序入口
  function main() {
    // 中文路径检测
    checkChinesePath();
    
    // 显示欢迎信息
    console.log('=========================================');
    console.log('  远程密码管理系统 - 服务管理器');
    console.log('=========================================\n');
    
    showMenu();
  }
  
  // 启动程序
  main();
}