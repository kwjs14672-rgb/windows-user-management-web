const path = require('path');
const fs = require('fs');

/**
 * 运行时路径工具
 * 
 * 解决 pkg 打包后的问题：
 * - 打包后 __dirname 指向只读的 snapshot（C:\snapshot\...），无法在其中创建/写入文件
 * - 运行时需要读写的目录（config、logs）应基于可执行文件所在目录（process.execPath）
 * 
 * 开发模式（node server.js）下仍基于项目根目录，行为不变。
 */

// 是否为 pkg 打包环境
const isPkg = typeof process.pkg !== 'undefined';

// 运行时根目录：pkg 下为 exe 所在目录；开发模式下为项目根目录
const RUNTIME_ROOT = isPkg
  ? path.dirname(process.execPath)
  : path.join(__dirname, '..', '..');

// 配置目录（运行时读写）
const CONFIG_DIR = path.join(RUNTIME_ROOT, 'config');

// 日志目录（运行时读写）
const LOG_DIR = path.join(RUNTIME_ROOT, 'logs');

// 确保目录存在
function ensureDir(dir) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  return dir;
}

module.exports = {
  isPkg,
  RUNTIME_ROOT,
  CONFIG_DIR,
  LOG_DIR,
  ensureDir
};
