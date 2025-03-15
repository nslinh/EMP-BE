const express = require('express');
const router = express.Router();
const { auth, isAdmin } = require('../middleware/auth');
const OvertimeRequest = require('../models/OvertimeRequest');
const Employee = require('../models/Employee');

/**
 * @swagger
 * tags:
 *   name: Overtime
 *   description: API quản lý làm thêm giờ
 */

/**
 * @swagger
 * /api/overtime/request:
 *   post:
 *     summary: Tạo yêu cầu làm thêm giờ
 *     tags: [Overtime]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - date
 *               - requestedHours
 *             properties:
 *               date:
 *                 type: string
 *                 format: date
 *                 description: Ngày làm thêm
 *               requestedHours:
 *                 type: number
 *                 description: Số giờ yêu cầu làm thêm
 *               reason:
 *                 type: string
 *                 description: Lý do làm thêm giờ
 *     responses:
 *       201:
 *         description: Tạo yêu cầu thành công
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 _id:
 *                   type: string
 *                 employeeId:
 *                   type: string
 *                 date:
 *                   type: string
 *                   format: date
 *                 requestedHours:
 *                   type: number
 *                 reason:
 *                   type: string
 *                 status:
 *                   type: string
 *                   enum: [pending, approved, rejected]
 *       400:
 *         description: Dữ liệu không hợp lệ
 *       401:
 *         description: Không có quyền truy cập
 */
router.post('/request', auth, async (req, res) => {
  try {
    const employee = await Employee.findOne({ userId: req.user._id });
    const { date, requestedHours, reason } = req.body;

    // Kiểm tra ngày hợp lệ
    const requestDate = new Date(date);
    if (requestDate < new Date()) {
      return res.status(400).json({
        message: 'Không thể tạo yêu cầu cho ngày trong quá khứ'
      });
    }

    const overtimeRequest = new OvertimeRequest({
      employeeId: employee._id,
      date: requestDate,
      requestedHours,
      reason
    });

    await overtimeRequest.save();

    res.status(201).json(overtimeRequest);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

/**
 * @swagger
 * /api/overtime/approve/{id}:
 *   put:
 *     summary: Phê duyệt yêu cầu làm thêm giờ
 *     tags: [Overtime]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: ID của yêu cầu làm thêm giờ
 *     responses:
 *       200:
 *         description: Phê duyệt thành công
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 _id:
 *                   type: string
 *                 status:
 *                   type: string
 *                   enum: [approved]
 *                 approvedBy:
 *                   type: string
 *                 approvedAt:
 *                   type: string
 *                   format: date-time
 *       404:
 *         description: Không tìm thấy yêu cầu
 *       401:
 *         description: Không có quyền truy cập
 */
router.put('/approve/:id', [auth, isAdmin], async (req, res) => {
  try {
    const request = await OvertimeRequest.findById(req.params.id);
    if (!request) {
      return res.status(404).json({ message: 'Không tìm thấy yêu cầu' });
    }

    request.status = 'approved';
    request.approvedBy = req.user._id;
    request.approvedAt = new Date();
    await request.save();

    res.json(request);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

module.exports = router; 