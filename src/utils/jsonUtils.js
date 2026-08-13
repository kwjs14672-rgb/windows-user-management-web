const fs = require('fs');

/**
 * 工具函数：带 BOM 容错的 JSON 文件读取
 *
 * 背景：Windows PowerShell `Out-File -Encoding utf8` 会写入 UTF-8 BOM 头，
 * Node.js 的 JSON.parse 无法解析带 BOM 的内容，导致程序启动即崩溃。
 * 该函数统一处理 BOM，保证配置文件无论是否带 BOM 都能正常读取。
 */

/**
 * 读取 JSON 文件，自动剥离 UTF-8 BOM
 * @param {string} filePath 文件路径
 * @returns {*} 解析后的 JSON 对象；文件不存在返回 null，解析失败抛错
 */
function readJsonFile(filePath) {
  if (!fs.existsSync(filePath)) {
    return null;
  }
  const raw = fs.readFileSync(filePath, 'utf8');
  // 剥离 UTF-8 BOM（\uFEFF）
  const cleaned = raw.replace(/^\uFEFF/, '');
  return JSON.parse(cleaned);
}

/**
 * 安全读取 JSON 文件，失败时返回默认值而不抛错
 * @param {string} filePath 文件路径
 * @param {*} defaultValue 读取失败时的默认值
 * @param {Function} [logFn] 可选日志函数，用于记录错误
 */
function readJsonFileSafe(filePath, defaultValue, logFn) {
  try {
    const data = readJsonFile(filePath);
    return data === null ? defaultValue : data;
  } catch (error) {
    if (logFn) {
      logFn(`读取 JSON 文件失败 ${filePath}:`, error);
    }
    return defaultValue;
  }
}

module.exports = {
  readJsonFile,
  readJsonFileSafe
};
