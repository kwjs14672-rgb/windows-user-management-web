const crypto = require('crypto');

/**
 * 会话管理器 - 处理用户会话，支持多地点登录互斥功能
 */
class SessionManager {
    constructor(logger, options = {}) {
        this.logger = logger;
        this.sessions = {}; // 会话存储
        this.userSessions = {}; // 用户与会话的映射 {username: sessionId}
        this.SESSION_TIMEOUT = options.sessionTimeout || 60 * 60 * 1000; // 60分钟会话超时
        
        // 启动过期会话清理
        this.startCleanupInterval();
    }

    /**
     * 生成会话ID
     */
    generateSessionId() {
        return crypto.randomBytes(32).toString('hex');
    }

    /**
     * 创建新会话
     * @param {string} username - 用户名
     * @returns {string} 会话ID
     */
    createSession(username) {
        const sessionId = this.generateSessionId();
        const now = Date.now();
        
        // 检查用户是否已有会话，如果有则使旧会话失效
        if (this.userSessions[username]) {
            const oldSessionId = this.userSessions[username];
            this.invalidateSession(oldSessionId);
            this.logger.info(`用户 ${username} 的旧会话 ${oldSessionId} 已被新登录会话 ${sessionId} 挤掉`);
        }
        
        // 创建新会话
        this.sessions[sessionId] = {
            username,
            createdAt: now,
            lastActive: now,
            isValid: true
        };
        
        // 更新用户会话映射
        this.userSessions[username] = sessionId;
        
        this.logger.info(`为用户 ${username} 创建了新会话: ${sessionId}`);
        return sessionId;
    }

    /**
     * 验证会话是否有效
     * @param {string} sessionId - 会话ID
     * @returns {boolean} 会话是否有效
     */
    validateSession(sessionId) {
        if (!sessionId || !this.sessions[sessionId]) {
            return false;
        }

        const session = this.sessions[sessionId];
        const now = Date.now();
        
        // 检查会话是否有效
        if (!session.isValid) {
            delete this.sessions[sessionId];
            // 从用户会话映射中移除
            if (this.userSessions[session.username] === sessionId) {
                delete this.userSessions[session.username];
            }
            return false;
        }
        
        // 检查会话是否过期
        if (now - session.lastActive > this.SESSION_TIMEOUT) {
            this.invalidateSession(sessionId);
            return false;
        }
        
        // 更新最后活动时间
        session.lastActive = now;
        return true;
    }

    /**
     * 使会话失效
     * @param {string} sessionId - 会话ID
     */
    invalidateSession(sessionId) {
        if (this.sessions[sessionId]) {
            const username = this.sessions[sessionId].username;
            
            // 设置会话为无效
            this.sessions[sessionId].isValid = false;
            
            // 从用户会话映射中移除
            if (this.userSessions[username] === sessionId) {
                delete this.userSessions[username];
            }
            
            // 延迟删除，确保validateSession有机会检测到会话已失效
            setTimeout(() => {
                if (this.sessions[sessionId] && !this.sessions[sessionId].isValid) {
                    delete this.sessions[sessionId];
                    this.logger.info(`会话 ${sessionId} 已被完全清除`);
                }
            }, 10000); // 10秒后完全删除
            
            this.logger.info(`会话 ${sessionId} (用户: ${username}) 已被标记为失效`);
        }
    }

    /**
     * 获取会话信息
     * @param {string} sessionId - 会话ID
     * @returns {object|null} 会话信息
     */
    getSession(sessionId) {
        return this.sessions[sessionId] || null;
    }
    
    /**
     * 验证会话并获取会话信息
     * @param {string} sessionId - 会话ID
     * @returns {object|null} 会话信息，如果会话无效则返回null
     */
    validateAndGetSession(sessionId) {
        if (!sessionId) {
            return null;
        }
        
        // 先验证会话是否有效
        if (this.validateSession(sessionId)) {
            // 验证通过后返回会话信息
            return this.sessions[sessionId];
        }
        
        return null;
    }

    /**
     * 获取指定用户的当前活跃会话
     * @param {string} username - 用户名
     * @returns {string|null} 会话ID
     */
    getUserSession(username) {
        return this.userSessions[username] || null;
    }

    /**
     * 清理过期会话
     */
    cleanupExpiredSessions() {
        const now = Date.now();
        let cleanupCount = 0;
        
        for (const sessionId in this.sessions) {
            const session = this.sessions[sessionId];
            
            // 清理过期或无效的会话
            if (!session.isValid || now - session.lastActive > this.SESSION_TIMEOUT) {
                // 从用户会话映射中移除
                if (this.userSessions[session.username] === sessionId) {
                    delete this.userSessions[session.username];
                }
                
                delete this.sessions[sessionId];
                cleanupCount++;
            }
        }
        
        if (cleanupCount > 0) {
            this.logger.info(`清理了 ${cleanupCount} 个过期或无效的会话`);
        }
    }

    /**
     * 启动定期清理任务
     */
    startCleanupInterval() {
        setInterval(() => {
            try {
                this.cleanupExpiredSessions();
            } catch (error) {
                this.logger.error('清理过期会话时出错:', error);
            }
        }, 60 * 1000); // 每分钟清理一次
        
        this.logger.info('会话清理定时器已启动');
    }

    /**
     * 获取所有活跃会话
     * @returns {array} 活跃会话列表
     */
    getActiveSessions() {
        const now = Date.now();
        const activeSessions = [];
        
        for (const sessionId in this.sessions) {
            const session = this.sessions[sessionId];
            
            if (session.isValid && now - session.lastActive <= this.SESSION_TIMEOUT) {
                activeSessions.push({
                    sessionId,
                    username: session.username,
                    createdAt: new Date(session.createdAt).toISOString(),
                    lastActive: new Date(session.lastActive).toISOString(),
                    duration: Math.floor((now - session.createdAt) / 1000) // 持续时间（秒）
                });
            }
        }
        
        return activeSessions;
    }

    /**
     * 获取系统中活跃会话的数量
     * @returns {number} 活跃会话数量
     */
    getActiveSessionCount() {
        return this.getActiveSessions().length;
    }

    /**
     * 强制用户下线
     * @param {string} username - 用户名
     * @returns {boolean} 是否成功
     */
    forceLogoutUser(username) {
        const sessionId = this.userSessions[username];
        
        if (sessionId) {
            this.invalidateSession(sessionId);
            this.logger.info(`用户 ${username} 已被强制下线`);
            return true;
        }
        
        this.logger.warn(`尝试强制下线用户 ${username}，但未找到活跃会话`);
        return false;
    }
}

module.exports = SessionManager;
