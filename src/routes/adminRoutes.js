const express = require('express');
const router = express.Router();

/**
 * 管理员管理路由处理器
 * @param {object} app - Express应用实例
 * @param {object} logger - 日志记录器
 * @param {object} adminManager - 管理员管理器实例
 * @param {object} sessionManager - 会话管理器实例
 * @param {function} requireAuth - 认证中间件
 * @param {function} logoffUser - 系统级下线用户函数（可选）
 */
function setupAdminRoutes(app, logger, adminManager, sessionManager, requireAuth, logoffUser = null) {
    // 系统管理页面路由
    app.get('/admin-management', requireAuth, (req, res) => {
        try {
            const admins = adminManager.getAllAdmins();
            const activeSessions = sessionManager.getActiveSessions();
            
            res.render('admin_management', {
                admins,
                activeSessions,
                username: req.session.username, // 传递当前登录用户的用户名
                error: null,
                success: null
            });
        } catch (error) {
            logger.error('渲染系统管理页面时出错:', error);
            res.render('admin_management', {
                admins: [],
                activeSessions: [],
                error: '加载管理员数据失败',
                success: null
            });
        }
    });

    /**
     * API: 获取所有管理员账户
     */
    app.get('/api/admins', requireAuth, (req, res) => {
        try {
            const admins = adminManager.getAllAdmins();
            // 过滤掉敏感信息
            const sanitizedAdmins = admins.map(admin => ({
                username: admin.username,
                createdAt: admin.createdAt,
                lastChanged: admin.lastChanged
            }));
            
            res.json({
                success: true,
                admins: sanitizedAdmins
            });
        } catch (error) {
            logger.error('获取管理员列表时出错:', error);
            res.json({
                success: false,
                message: '获取管理员列表失败',
                error: error.message
            });
        }
    });

    /**
     * API: 添加新管理员账户
     */
    app.post('/api/admins/add', requireAuth, (req, res) => {
        try {
            const { username, password } = req.body;
            
            // 验证参数
            if (!username || !password || !req.body.confirmPassword) {
                return res.json({
                    success: false,
                    message: '用户名、密码和确认密码不能为空'
                });
            }
            
            // 验证密码和确认密码是否匹配
            if (password !== req.body.confirmPassword) {
                return res.json({
                    success: false,
                    message: '两次输入的密码不一致'
                });
            }
            
            // 创建新管理员
            adminManager.createAdmin(username, password);
            
            logger.info(`管理员 ${req.headers.cookie?.split(';').find(c => c.trim().startsWith('sessionId='))?.split('=')[1] || 'unknown'} 创建了新管理员账户: ${username}`);
            
            res.json({
                success: true,
                message: '管理员账户创建成功',
                username: username
            });
        } catch (error) {
            logger.error('创建管理员账户时出错:', error);
            res.json({
                success: false,
                message: error.message || '创建管理员账户失败'
            });
        }
    });

    /**
     * API: 删除管理员账户
     */
    app.post('/api/admins/delete', requireAuth, (req, res) => {
        try {
            const { username } = req.body;
            
            // 验证参数
            if (!username) {
                return res.json({
                    success: false,
                    message: '用户名不能为空'
                });
            }
            
            // 删除管理员
            adminManager.deleteAdmin(username);
            
            logger.info(`管理员 ${req.headers.cookie?.split(';').find(c => c.trim().startsWith('sessionId='))?.split('=')[1] || 'unknown'} 删除了管理员账户: ${username}`);
            
            res.json({
                success: true,
                message: '管理员账户删除成功',
                username: username
            });
        } catch (error) {
            logger.error('删除管理员账户时出错:', error);
            res.json({
                success: false,
                message: error.message || '删除管理员账户失败'
            });
        }
    });

    /**
     * API: 更新管理员密码
     */
    app.post('/api/admins/update-password', requireAuth, (req, res) => {
        try {
            const { username, newPassword } = req.body;
            
            // 验证参数
            if (!username || !newPassword || !req.body.confirmPassword) {
                return res.json({
                    success: false,
                    message: '用户名、新密码和确认密码不能为空'
                });
            }
            
            // 验证密码和确认密码是否匹配
            if (newPassword !== req.body.confirmPassword) {
                return res.json({
                    success: false,
                    message: '两次输入的密码不一致'
                });
            }
            
            // 限制只有administrator用户可以修改自己的密码
            if (username === 'administrator' && req.session.username !== 'administrator') {
                return res.json({
                    success: false,
                    message: '只有administrator用户本人可以修改其密码'
                });
            }
            
            // 更新密码
            adminManager.updateAdminPassword(username, newPassword);
            
            logger.info(`管理员 ${req.session.username || (req.headers.cookie?.split(';').find(c => c.trim().startsWith('sessionId='))?.split('=')[1] || 'unknown')} 更新了管理员 ${username} 的密码`);
            
            res.json({
                success: true,
                message: '管理员密码更新成功',
                username: username
            });
        } catch (error) {
            logger.error('更新管理员密码时出错:', error);
            res.json({
                success: false,
                message: error.message || '更新管理员密码失败'
            });
        }
    });
    
    /**
     * API: 修改管理员密码（别名路由，向后兼容）
     */
    app.post('/api/admins/change-password', requireAuth, (req, res) => {
        // 添加详细日志记录
        console.log('修改密码API请求:', { 
            username: req.body.username, 
            session: req.username,
            headers: Object.keys(req.headers),
            timestamp: new Date().toISOString()
        });
        
        try {
            // 直接复用已有的密码更新逻辑
            const { username, newPassword, confirmNewPassword } = req.body;
            
            // 验证参数
            if (!username || !newPassword || !confirmNewPassword) {
                console.log('参数验证失败: 缺少必要字段', { username: !!username, newPassword: !!newPassword, confirmNewPassword: !!confirmNewPassword });
                return res.status(400).json({
                    success: false,
                    message: '用户名、新密码和确认密码不能为空',
                    errorCode: 'MISSING_PARAMS'
                });
            }
            
            // 验证密码和确认密码是否匹配
            if (newPassword !== confirmNewPassword) {
                console.log('参数验证失败: 两次密码不一致');
                return res.status(400).json({
                    success: false,
                    message: '两次输入的密码不一致',
                    errorCode: 'PASSWORD_MISMATCH'
                });
            }

            // 限制只有administrator用户可以修改自己的密码
            if (username === 'administrator' && req.username !== 'administrator') {
                console.log('权限验证失败: 非administrator用户尝试修改administrator密码', { 
                    currentUser: req.username, 
                    targetUser: username 
                });
                return res.status(403).json({
                    success: false,
                    message: '只有administrator用户本人可以修改其密码',
                    errorCode: 'PERMISSION_DENIED'
                });
            }
            
            console.log(`开始更新管理员 ${username} 的密码`, { sessionUser: req.username });
            
            // 检查adminManager是否存在
            if (!adminManager || typeof adminManager.updateAdminPassword !== 'function') {
                console.error('严重错误: adminManager未正确初始化或updateAdminPassword方法不存在');
                return res.status(500).json({
                    success: false,
                    message: '系统内部错误: 密码管理功能未正确初始化',
                    errorCode: 'SYSTEM_ERROR'
                });
            }
            
            // 更新密码
            adminManager.updateAdminPassword(username, newPassword);
            
            console.log(`管理员 ${username} 密码更新成功`);
            logger.info(`管理员 ${req.username || (req.headers.cookie?.split(';').find(c => c.trim().startsWith('sessionId='))?.split('=')[1] || 'unknown')} 修改了管理员 ${username} 的密码`);
            
            res.status(200).json({
                success: true,
                message: '密码修改成功',
                username: username,
                timestamp: new Date().toISOString()
            });
        } catch (error) {
            console.error('修改管理员密码时出错:', error.message);
            console.error('错误堆栈:', error.stack);
            logger.error('修改管理员密码时出错:', error);
            
            // 根据错误类型返回不同的状态码
            let statusCode = 500;
            let errorCode = 'INTERNAL_ERROR';
            
            if (error.message.includes('不存在')) {
                statusCode = 404;
                errorCode = 'USER_NOT_FOUND';
            } else if (error.message.includes('权限') || error.message.includes('不允许')) {
                statusCode = 403;
                errorCode = 'PERMISSION_ERROR';
            } else if (error.message.includes('密码')) {
                statusCode = 400;
                errorCode = 'PASSWORD_ERROR';
            }
            
            res.status(statusCode).json({
                success: false,
                message: error.message || '修改管理员密码失败',
                errorCode: errorCode,
                errorDetails: process.env.NODE_ENV === 'development' ? error.stack : undefined
            });
        }
    });

    /**
     * API: 获取活跃会话列表
     */
    app.get('/api/admin/sessions', requireAuth, (req, res) => {
        try {
            const sessions = sessionManager.getActiveSessions();
            
            res.json({
                success: true,
                sessions,
                count: sessions.length
            });
        } catch (error) {
            logger.error('获取活跃会话列表时出错:', error);
            res.json({
                success: false,
                message: '获取活跃会话列表失败',
                error: error.message
            });
        }
    });

    /**
     * API: 强制用户下线
     */
    app.post('/api/admin/force-logout', requireAuth, (req, res) => {
        try {
            const { username } = req.body;
            // 确保使用正确的用户名获取方式
            const currentUser = req.session?.username || req.username || req.session?.user?.username || 'unknown';
            
            // 详细日志记录
            logger.info(`收到强制下线请求: 目标用户=${username}, 操作管理员=${currentUser}`);
            
            // 验证参数
            if (!username) {
                logger.warn(`强制下线请求缺少用户名参数: 管理员=${currentUser}`);
                return res.json({
                    success: false,
                    message: '用户名不能为空'
                });
            }
            
            // 限制1: 不能强制administrator下线
            if (username === 'administrator') {
                logger.warn(`管理员 ${currentUser} 尝试强制administrator账户下线`);
                return res.json({
                    success: false,
                    message: '不能强制管理员账户下线'
                });
            }
            
            // 限制2: 用户不能下线自己
            if (username === currentUser) {
                logger.warn(`管理员 ${currentUser} 尝试强制下线自己的账户`);
                return res.json({
                    success: false,
                    message: '不能强制下线自己的账户'
                });
            }
            
            // 1. 首先在应用内存中使会话失效
            const memoryInvalidationResult = sessionManager.forceLogoutUser(username);
            logger.info(`应用内存会话已失效: 用户=${username}, 管理员=${currentUser}, 结果=${memoryInvalidationResult}`);
            
            // 2. 直接调用传入的logoffUser函数执行系统级下线操作
            if (logoffUser && typeof logoffUser === 'function') {
                try {
                    // 使用用户名调用logoffUser函数，因为我们没有会话ID
                    logoffUser(username, null);
                    logger.info(`系统级下线操作成功: 用户=${username}, 管理员=${currentUser}`);
                    
                    res.json({
                        success: true,
                        message: `用户 ${username} 已被成功强制下线`,
                        details: {
                            memoryInvalidation: memoryInvalidationResult ? 'success' : 'no_active_session',
                            systemLogoff: 'success'
                        }
                    });
                } catch (systemLogoffError) {
                    logger.warn(`系统级下线操作失败: 用户=${username}, 错误=${systemLogoffError.message}`);
                    // 即使系统级下线失败，至少应用会话已被失效
                    res.json({
                        success: true,
                        message: `用户 ${username} 的应用会话已被强制下线，但系统级下线操作失败: ${systemLogoffError.message}`,
                        details: {
                            memoryInvalidation: memoryInvalidationResult ? 'success' : 'no_active_session',
                            systemLogoff: 'failed',
                            error: systemLogoffError.message
                        }
                    });
                }
            } else {
                // 如果没有传入logoffUser函数，仅执行应用级下线
                logger.warn(`系统级下线功能不可用，仅执行了应用级下线: 用户=${username}`);
                res.json({
                    success: true,
                    message: `用户 ${username} 的应用会话已被强制下线，但系统级下线功能未启用`,
                    details: {
                        memoryInvalidation: memoryInvalidationResult ? 'success' : 'no_active_session',
                        systemLogoff: 'not_available'
                    }
                });
            }
        } catch (error) {
            logger.error(`强制用户下线时出现严重错误: ${error.message}`, error);
            res.json({
                success: false,
                message: `强制用户下线失败: ${error.message}`
            });
        }
    });

    logger.info('管理员管理路由已成功注册');
}

module.exports = setupAdminRoutes;
