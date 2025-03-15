const express = require('express');
const router = express.Router();
const { auth, isAdmin } = require('../middleware/auth');
const ActivityLog = require('../models/ActivityLog');
const User = require('../models/User');

/**
 * @swagger
 * /api/logs:
 *   get:
 *     summary: Lấy lịch sử hoạt động
 *     tags: [ActivityLogs]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: userId
 *         schema:
 *           type: string
 *       - in: query
 *         name: entityType
 *         schema:
 *           type: string
 *       - in: query
 *         name: action
 *         schema:
 *           type: string
 *       - in: query
 *         name: startDate
 *         schema:
 *           type: string
 *           format: date
 *       - in: query
 *         name: endDate
 *         schema:
 *           type: string
 *           format: date
 *     responses:
 *       200:
 *         description: Lấy lịch sử hoạt động thành công
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 logs:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       userId:
 *                         type: object
 *                         properties:
 *                           email:
 *                             type: string
 *                           fullName:
 *                             type: string
 *                       action:
 *                         type: string
 *                         enum: [create, update, delete]
 *                       entityType:
 *                         type: string
 *                       details:
 *                         type: object
 *                       createdAt:
 *                         type: string
 *                         format: date-time
 *                 pagination:
 *                   type: object
 *                   properties:
 *                     total:
 *                       type: integer
 *                     page:
 *                       type: integer
 *                     totalPages:
 *                       type: integer
 */
router.get('/', [auth, isAdmin], async (req, res) => {
  try {
    const { userId, entityType, action, startDate, endDate, page = 1, limit = 20 } = req.query;
    
    const query = {};
    if (userId) query.userId = userId;
    if (entityType) query.entityType = entityType;
    if (action) query.action = action;
    if (startDate || endDate) {
      query.createdAt = {};
      if (startDate) query.createdAt.$gte = new Date(startDate);
      if (endDate) query.createdAt.$lte = new Date(endDate);
    }

    const [logs, total] = await Promise.all([
      ActivityLog.find(query)
        .populate('userId', 'email fullName')
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(parseInt(limit)),
      ActivityLog.countDocuments(query)
    ]);

    res.json({
      logs,
      pagination: {
        total,
        page: parseInt(page),
        totalPages: Math.ceil(total / limit)
      }
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

/**
 * @swagger
 * /api/logs/user/{userId}:
 *   get:
 *     summary: Lấy lịch sử hoạt động của một tài khoản cụ thể
 *     tags: [ActivityLogs]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: userId
 *         required: true
 *         schema:
 *           type: string
 *       - in: query
 *         name: startDate
 *         schema:
 *           type: string
 *           format: date
 *       - in: query
 *         name: endDate
 *         schema:
 *           type: string
 *           format: date
 *       - in: query
 *         name: page
 *         schema:
 *           type: integer
 *           default: 1
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 20
 *     responses:
 *       200:
 *         description: Lấy lịch sử hoạt động của tài khoản thành công
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 user:
 *                   type: object
 *                   properties:
 *                     id:
 *                       type: string
 *                     email:
 *                       type: string
 *                     role:
 *                       type: string
 *                 summary:
 *                   type: object
 *                   properties:
 *                     totalActions:
 *                       type: integer
 *                     actionBreakdown:
 *                       type: array
 *                       items:
 *                         type: object
 *                         properties:
 *                           _id:
 *                             type: string
 *                           count:
 *                             type: integer
 *                           entities:
 *                             type: array
 *                             items:
 *                               type: string
 *                     lastActive:
 *                       type: string
 *                       format: date-time
 */
router.get('/user/:userId', [auth, isAdmin], async (req, res) => {
  try {
    const { userId } = req.params;
    const { startDate, endDate, page = 1, limit = 20 } = req.query;

    // Kiểm tra user có tồn tại không
    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({ message: 'Không tìm thấy tài khoản' });
    }

    // Xây dựng query
    const query = { userId };
    if (startDate || endDate) {
      query.createdAt = {};
      if (startDate) query.createdAt.$gte = new Date(startDate);
      if (endDate) query.createdAt.$lte = new Date(endDate);
    }

    // Thực hiện query với Promise.all để tối ưu hiệu năng
    const [logs, total, summary] = await Promise.all([
      ActivityLog.find(query)
        .populate('userId', 'email fullName role')
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(parseInt(limit)),
      ActivityLog.countDocuments(query),
      ActivityLog.aggregate([
        { $match: query },
        {
          $group: {
            _id: '$action',
            count: { $sum: 1 },
            entities: {
              $addToSet: '$entityType'
            }
          }
        }
      ])
    ]);

    res.json({
      user: {
        id: user._id,
        email: user.email,
        role: user.role
      },
      summary: {
        totalActions: total,
        actionBreakdown: summary,
        lastActive: logs[0]?.createdAt
      },
      logs,
      pagination: {
        total,
        page: parseInt(page),
        totalPages: Math.ceil(total / limit)
      }
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

/**
 * @swagger
 * /api/logs/summary:
 *   get:
 *     summary: Thống kê hoạt động của tất cả tài khoản quản lý
 *     tags: [ActivityLogs]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: startDate
 *         schema:
 *           type: string
 *           format: date
 *       - in: query
 *         name: endDate
 *         schema:
 *           type: string
 *           format: date
 *     responses:
 *       200:
 *         description: Thống kê hoạt động thành công
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 totalUsers:
 *                   type: integer
 *                 totalActions:
 *                   type: integer
 *                 userActivities:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       email:
 *                         type: string
 *                       role:
 *                         type: string
 *                       totalActions:
 *                         type: integer
 *                       lastActive:
 *                         type: string
 *                         format: date-time
 *                       actionTypes:
 *                         type: array
 *                         items:
 *                           type: string
 *                       entityTypes:
 *                         type: array
 *                         items:
 *                           type: string
 */
router.get('/summary', [auth, isAdmin], async (req, res) => {
  try {
    const { startDate, endDate } = req.query;
    const query = {};
    
    if (startDate || endDate) {
      query.createdAt = {};
      if (startDate) query.createdAt.$gte = new Date(startDate);
      if (endDate) query.createdAt.$lte = new Date(endDate);
    }

    const summary = await ActivityLog.aggregate([
      { $match: query },
      {
        $group: {
          _id: '$userId',
          totalActions: { $sum: 1 },
          lastActive: { $max: '$createdAt' },
          actionTypes: { $addToSet: '$action' },
          entityTypes: { $addToSet: '$entityType' }
        }
      },
      {
        $lookup: {
          from: 'users',
          localField: '_id',
          foreignField: '_id',
          as: 'userInfo'
        }
      },
      { $unwind: '$userInfo' },
      {
        $project: {
          _id: 1,
          email: '$userInfo.email',
          role: '$userInfo.role',
          totalActions: 1,
          lastActive: 1,
          actionTypes: 1,
          entityTypes: 1
        }
      },
      { $sort: { totalActions: -1 } }
    ]);

    res.json({
      totalUsers: summary.length,
      totalActions: summary.reduce((sum, user) => sum + user.totalActions, 0),
      userActivities: summary
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

module.exports = router; 