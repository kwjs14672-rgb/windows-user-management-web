const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { CONFIG_DIR } = require('../utils/runtimePaths');

// 配置文件路径（pkg 下为 exe 所在目录的 config）
const ADMIN_CONFIG_PATH = path.join(CONFIG_DIR, 'admin_config.json');

/**
 * 管理员管理器 - 处理多管理员账户的创建、查询、更新和删除
 */
class AdminManager {
    constructor(logger) {
        this.logger = logger;
        this.ensureAdminConfigStructure();
    }

    /**
     * 确保管理员配置文件结构支持多管理员
     */
    ensureAdminConfigStructure() {
        try {
            if (!fs.existsSync(ADMIN_CONFIG_PATH)) {
                this.logger.warn('管理员配置文件不存在，正在创建默认配置');
                this.createDefaultConfig();
                return;
            }

            const config = JSON.parse(fs.readFileSync(ADMIN_CONFIG_PATH, 'utf8'));
            
            // 检查是否需要从单管理员结构升级到多管理员结构
            if (config.admin && !config.admins) {
                this.logger.info('检测到旧版单管理员配置，正在升级为多管理员配置');
                const upgradedConfig = {
                    admins: [
                        {
                            username: config.admin.username,
                            passwordHash: config.admin.passwordHash,
                            salt: config.admin.salt,
                            lastChanged: config.admin.lastChanged,
                            createdAt: config.admin.lastChanged
                        }
                    ],
                    settings: config.settings || { authorizationCheckInterval: 10 }
                };
                fs.writeFileSync(ADMIN_CONFIG_PATH, JSON.stringify(upgradedConfig, null, 2));
                this.logger.info('管理员配置已成功升级为多管理员结构');
            }
        } catch (error) {
            this.logger.error('确保管理员配置结构时出错:', error);
            throw new Error('无法初始化管理员配置');
        }
    }

    /**
     * 创建默认管理员配置
     */
    createDefaultConfig() {
        // 生成随机初始密码
        const initialPassword = this.generateRandomPassword();
        const salt = this.generateSalt();
        
        // 使用SHA-256哈希，不使用异步bcrypt以确保同步执行
        const saltedPassword = initialPassword + salt;
        const hash = crypto.createHash('sha256').update(saltedPassword).digest('hex');
        
        const defaultConfig = {
            admins: [
                {
                    username: 'administrator',
                    passwordHash: hash,
                    salt: salt,
                    lastChanged: new Date().toISOString(),
                    createdAt: new Date().toISOString(),
                    forceChangePassword: true // 添加强制修改密码标记
                }
            ],
            settings: {
                authorizationCheckInterval: 10
            }
        };
        
        // 确保目录存在
        const dirPath = path.dirname(ADMIN_CONFIG_PATH);
        if (!fs.existsSync(dirPath)) {
            fs.mkdirSync(dirPath, { recursive: true });
        }
        
        fs.writeFileSync(ADMIN_CONFIG_PATH, JSON.stringify(defaultConfig, null, 2));
        this.logger.info(`已创建默认管理员配置，初始密码为: ${initialPassword}`);
    }
    
    /**
     * 生成随机密码
     */
    generateRandomPassword() {
        const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!@#$%^&*()_+-=[]{}|;:,.<>?';
        let password = '';
        for (let i = 0; i < 12; i++) {
            password += chars.charAt(Math.floor(Math.random() * chars.length));
        }
        return password;
    }

    /**
     * 获取所有管理员账户
     */
    getAllAdmins() {
        try {
            // 确保配置结构正确
            this.ensureAdminConfigStructure();
            
            // 读取管理员配置
            const config = JSON.parse(fs.readFileSync(ADMIN_CONFIG_PATH, 'utf8'));
            
            // 处理对象形式的admins配置
            if (config.admins && typeof config.admins === 'object' && !Array.isArray(config.admins)) {
                // 将对象转换为数组格式，每个管理员对象包含username属性
                return Object.entries(config.admins).map(([username, adminData]) => ({
                    username,
                    ...adminData
                }));
            }
            
            // 确保返回有效的数组
            return Array.isArray(config.admins) ? config.admins : [];
        } catch (error) {
            this.logger.error('获取管理员列表时出错:', error);
            return [];
        }
    }

    /**
     * 根据用户名获取管理员账户
     */
    getAdminByUsername(username) {
        const admins = this.getAllAdmins();
        // 添加过滤，确保只处理有效的admin对象
        return admins.find(admin => admin && admin.username === username);
    }

    /**
     * 验证管理员密码
     */
    verifyPassword(username, password) {
        const admin = this.getAdminByUsername(username);
        if (!admin) {
            return false;
        }

        // 如果没有passwordHash字段，视为无效账户
        if (!admin.passwordHash) {
            this.logger.warn(`管理员账户 ${username} 缺少密码哈希值，登录失败`);
            return false;
        }

        try {
            // 特殊处理默认密码情况
            if (admin.passwordHash === '698d51a19d8a121ce581499d7b701668') {
                // 这是默认密码'admin123'的MD5哈希值
                return password === 'admin123';
            }
            
            // 使用SHA-256验证密码，确保同步执行
            const saltedPassword = password + (admin.salt || '');
            const calculatedHash = crypto.createHash('sha256').update(saltedPassword).digest('hex');
            
            // 比较哈希值
            return calculatedHash === admin.passwordHash;
        } catch (error) {
            this.logger.error('验证密码时出错:', error);
            return false;
        }
    }

    /**
     * 创建新的管理员账户
     */
    createAdmin(username, password) {
        // 检查用户名是否已存在
        if (this.getAdminByUsername(username)) {
            throw new Error('管理员账户已存在');
        }

        // 验证密码强度
        const passwordValidation = this.validatePasswordStrength(password);
        if (!passwordValidation.valid) {
            throw new Error(passwordValidation.errors.join(', '));
        }

        try {
            const salt = this.generateSalt();
            
            // 使用SHA-256哈希，确保同步执行
            const saltedPassword = password + salt;
            const hash = crypto.createHash('sha256').update(saltedPassword).digest('hex');
            
            const now = new Date().toISOString();
            
            const config = JSON.parse(fs.readFileSync(ADMIN_CONFIG_PATH, 'utf8'));
            config.admins.push({
                username,
                passwordHash: hash,
                salt,
                lastChanged: now,
                createdAt: now
            });
            
            // 备份配置文件
            const backupPath = ADMIN_CONFIG_PATH + '.bak';
            if (fs.existsSync(ADMIN_CONFIG_PATH)) {
                fs.copyFileSync(ADMIN_CONFIG_PATH, backupPath);
            }
            
            fs.writeFileSync(ADMIN_CONFIG_PATH, JSON.stringify(config, null, 2));
            this.logger.info(`成功创建新管理员账户: ${username}`);
            return true;
        } catch (error) {
            this.logger.error(`创建管理员账户 ${username} 时出错:`, error);
            throw error;
        }
    }

    /**
     * 更新管理员密码
     */
    updateAdminPassword(username, newPassword) {
        try {
            // 验证输入参数
            if (!username || typeof username !== 'string' || username.trim() === '') {
                throw new Error('用户名无效');
            }
            
            // 为administrator用户提供更宽松的密码要求
            if (username === 'administrator') {
                if (!newPassword || newPassword.trim().length === 0) {
                    throw new Error('密码不能为空');
                }
            } else {
                // 对其他用户进行正常的密码强度验证
                const passwordValidation = this.validatePasswordStrength(newPassword);
                if (!passwordValidation.valid) {
                    throw new Error(passwordValidation.errors.join(', '));
                }
            }
            
            // 检查文件是否存在及权限
            if (!fs.existsSync(ADMIN_CONFIG_PATH)) {
                throw new Error('管理员配置文件不存在');
            }
            
            try {
                fs.accessSync(ADMIN_CONFIG_PATH, fs.constants.R_OK | fs.constants.W_OK);
            } catch (accessError) {
                throw new Error(`配置文件权限不足，无法读写: ${accessError.message}`);
            }
            
            // 读取配置文件
            let config;
            try {
                const fileContent = fs.readFileSync(ADMIN_CONFIG_PATH, 'utf8');
                config = JSON.parse(fileContent);
            } catch (readError) {
                if (readError.name === 'SyntaxError') {
                    throw new Error(`配置文件格式错误: ${readError.message}`);
                }
                throw new Error(`读取配置文件失败: ${readError.message}`);
            }
            
            // 检查config.admins是否存在且为数组
            if (!config.admins || !Array.isArray(config.admins)) {
                throw new Error('管理员配置结构错误');
            }
            
            // 查找管理员位置（过滤掉无效元素）
            const originalIndex = config.admins.findIndex(admin => admin && admin.username === username);
            if (originalIndex === -1) {
                throw new Error('管理员账户不存在');
            }
            
            // 生成密码哈希和盐值
            let salt, hash;
            try {
                salt = this.generateSalt();
                // 使用SHA-256哈希，确保同步执行
                const saltedPassword = newPassword + salt;
                hash = crypto.createHash('sha256').update(saltedPassword).digest('hex');
            } catch (hashError) {
                throw new Error(`密码加密失败: ${hashError.message}`);
            }
            
            // 更新密码信息
            config.admins[originalIndex].passwordHash = hash;
            config.admins[originalIndex].salt = salt;
            config.admins[originalIndex].lastChanged = new Date().toISOString();
            
            // 备份配置文件
            const backupPath = ADMIN_CONFIG_PATH + '.bak';
            try {
                if (fs.existsSync(backupPath)) {
                    fs.unlinkSync(backupPath);
                }
                fs.copyFileSync(ADMIN_CONFIG_PATH, backupPath);
            } catch (backupError) {
                this.logger.warn(`创建配置文件备份失败: ${backupError.message}`);
                // 继续执行，备份失败不应该阻止密码更新
            }
            
            // 写入配置文件 - 简单重试逻辑（无阻塞等待）
            let writeSuccess = false;
            let attempts = 0;
            const maxAttempts = 3;
            
            while (!writeSuccess && attempts < maxAttempts) {
                attempts++;
                try {
                    fs.writeFileSync(ADMIN_CONFIG_PATH, JSON.stringify(config, null, 2), 'utf8');
                    writeSuccess = true;
                } catch (writeError) {
                    this.logger.error(`写入配置文件失败 (尝试 ${attempts}/${maxAttempts}): ${writeError.message}`);
                    // 不做阻塞等待，直接重试（同步写文件失败通常是瞬时问题）
                }
            }
            
            if (!writeSuccess) {
                // 尝试恢复备份
                try {
                    if (fs.existsSync(backupPath)) {
                        fs.copyFileSync(backupPath, ADMIN_CONFIG_PATH);
                        this.logger.warn('已从备份恢复配置文件');
                    }
                } catch (restoreError) {
                    this.logger.error(`恢复配置文件失败: ${restoreError.message}`);
                }
                throw new Error(`更新密码失败: 无法写入配置文件，已尝试${maxAttempts}次`);
            }
            
            this.logger.info(`成功更新管理员 ${username} 的密码`);
            return true;
        } catch (error) {
            this.logger.error(`更新管理员 ${username} 密码时出错:`, error);
            throw error;
        }
    }

    /**
     * 删除管理员账户
     */
    deleteAdmin(username) {
        // 不允许删除默认的administrator账户
        if (username === 'administrator') {
            throw new Error('默认管理员账户不允许删除');
        }

        try {
            const config = JSON.parse(fs.readFileSync(ADMIN_CONFIG_PATH, 'utf8'));
            const adminIndex = config.admins.findIndex(admin => admin.username === username);
            
            if (adminIndex === -1) {
                throw new Error('管理员账户不存在');
            }
            
            // 确保至少保留一个管理员账户
            if (config.admins.length <= 1) {
                throw new Error('至少需要保留一个管理员账户');
            }
            
            config.admins.splice(adminIndex, 1);
            
            // 备份配置文件
            const backupPath = ADMIN_CONFIG_PATH + '.bak';
            if (fs.existsSync(ADMIN_CONFIG_PATH)) {
                fs.copyFileSync(ADMIN_CONFIG_PATH, backupPath);
            }
            
            fs.writeFileSync(ADMIN_CONFIG_PATH, JSON.stringify(config, null, 2));
            this.logger.info(`成功删除管理员账户: ${username}`);
            return true;
        } catch (error) {
            this.logger.error(`删除管理员账户 ${username} 时出错:`, error);
            throw error;
        }
    }

    /**
     * 密码哈希函数 - 使用SHA-256算法
     */
    hashPassword(password, salt) {
        try {
            // 使用SHA-256进行密码哈希
            const saltedPassword = password + (salt || '');
            const hash = crypto.createHash('sha256').update(saltedPassword).digest('hex');
            return hash;
        } catch (error) {
            this.logger.error('哈希密码时出错:', error);
            throw new Error('密码哈希失败');
        }
    }

    /**
     * 生成盐值
     */
    generateSalt() {
        return crypto.randomBytes(16).toString('hex');
    }

    /**
     * 验证密码强度
     */
    validatePasswordStrength(password) {
        const errors = [];
        
        // 检查密码长度
        if (!password || password.length < 8) {
            errors.push('密码长度至少为8个字符');
        }
        
        // 检查是否包含数字
        if (!/\d/.test(password)) {
            errors.push('密码必须包含至少一个数字');
        }
        
        // 检查是否包含大小写字母
        if (!/[a-z]/.test(password) || !/[A-Z]/.test(password)) {
            errors.push('密码必须包含大小写字母');
        }
        
        // 检查是否包含特殊字符
        if (!/[^A-Za-z0-9]/.test(password)) {
            errors.push('密码必须包含至少一个特殊字符');
        }
        
        return {
            valid: errors.length === 0,
            errors: errors
        };
    }
}

module.exports = AdminManager;
