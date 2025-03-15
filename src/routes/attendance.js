const express = require('express');
const router = express.Router();
const { auth, isAdmin, isOwner } = require('../middleware/auth');
const Attendance = require('../models/Attendance');
const Leave = require('../models/Leave');
const Employee = require('../models/Employee');
const mongoose = require('mongoose');
const OvertimeRequest = require('../models/OvertimeRequest');

/**
 * @swagger
 * components:
 *   schemas:
 *     Attendance:
 *       type: object
 *       properties:
 *         _id:
 *           type: string
 *         employeeId:
 *           type: string
 *           description: ID của nhân viên
 *         date:
 *           type: string
 *           format: date
 *         checkIn:
 *           type: string
 *           format: date-time
 *         checkOut:
 *           type: string
 *           format: date-time
 *         overtime:
 *           type: number
 *           description: Số giờ làm thêm
 *         status:
 *           type: string
 *           enum: [present, absent, leave, holiday]
 *         note:
 *           type: string
 *     Leave:
 *       type: object
 *       properties:
 *         _id:
 *           type: string
 *         employeeId:
 *           type: string
 *           description: ID của nhân viên
 *         startDate:
 *           type: string
 *           format: date
 *         endDate:
 *           type: string
 *           format: date
 *         type:
 *           type: string
 *           enum: [annual, sick, unpaid, other]
 *         status:
 *           type: string
 *           enum: [pending, approved, rejected]
 *         reason:
 *           type: string
 *         approvedBy:
 *           type: string
 */

/**
 * @swagger
 * /api/attendance/check-in:
 *   post:
 *     summary: Check-in cho nhân viên
 *     tags: [Attendance]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       201:
 *         description: Check-in thành công
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 message:
 *                   type: string
 *                 attendance:
 *                   $ref: '#/components/schemas/Attendance'
 */

// Check-in
router.post('/check-in', auth, async (req, res) => {
  try {
    const employee = await Employee.findOne({ userId: req.user._id });
    if (!employee) {
      return res.status(404).json({ message: 'Không tìm thấy nhân viên' });
    }

    const now = new Date();
    const today = new Date(now);
    today.setHours(0, 0, 0, 0);

    // Kiểm tra đã check-in chưa
    const existingAttendance = await Attendance.findOne({
      employeeId: employee._id,
      date: today
    });

    if (existingAttendance) {
      return res.status(400).json({ message: 'Đã check-in hôm nay' });
    }

    // Thiết lập giờ check-in chuẩn (8:00)
    const standardCheckIn = new Date(today);
    standardCheckIn.setHours(8, 0, 0, 0);

    // Tính thời gian đi muộn (nếu có)
    let lateMinutes = 0;
    if (now > standardCheckIn) {
      lateMinutes = Math.floor((now - standardCheckIn) / (1000 * 60));
    }

    const attendance = new Attendance({
      employeeId: employee._id,
      date: today,
      checkIn: now,
      standardCheckIn: standardCheckIn,
      lateMinutes: lateMinutes,
      status: 'present',
      workingHours: 0
    });

    await attendance.save();

    res.status(201).json({
      message: 'Check-in thành công',
      attendance: {
        ...attendance.toObject(),
        isLate: lateMinutes > 0,
        lateMinutes
      }
    });
  } catch (error) {
    console.error('Check-in error:', error);
    res.status(500).json({ 
      message: 'Lỗi khi check-in',
      error: error.message 
    });
  }
});

/**
 * @swagger
 * /api/attendance/check-out:
 *   post:
 *     summary: Check-out cho nhân viên
 *     tags: [Attendance]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Check-out thành công
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 message:
 *                   type: string
 *                 attendance:
 *                   $ref: '#/components/schemas/Attendance'
 */

// Check-out
router.post('/check-out', auth, async (req, res) => {
  try {
    const employee = await Employee.findOne({ userId: req.user._id });
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const attendance = await Attendance.findOne({
      employeeId: employee._id,
      date: today
    });

    if (!attendance) {
      return res.status(404).json({ message: 'Chưa check-in hôm nay' });
    }

    if (attendance.checkOut) {
      return res.status(400).json({ message: 'Đã check-out hôm nay' });
    }

    // Kiểm tra yêu cầu làm thêm giờ
    const overtimeRequest = await OvertimeRequest.findOne({
      employeeId: employee._id,
      date: today,
      status: 'approved'
    });

    attendance.checkOut = new Date();
    
    // Tính số giờ làm việc
    const workingHours = (attendance.checkOut - attendance.checkIn) / (1000 * 60 * 60);
    attendance.workingHours = Number(workingHours.toFixed(2));

    // Tính giờ làm thêm nếu có yêu cầu được duyệt
    const standardHours = 8;
    if (overtimeRequest && workingHours > standardHours) {
      const actualOvertime = workingHours - standardHours;
      attendance.overtime = Math.min(actualOvertime, overtimeRequest.requestedHours);
    }

    await attendance.save();

    res.json({
      message: 'Check-out thành công',
      attendance: {
        ...attendance.toObject(),
        isLate: attendance.lateMinutes > 0
      }
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

/**
 * @swagger
 * /api/attendance/leave:
 *   post:
 *     summary: Gửi đơn xin nghỉ phép
 *     tags: [Attendance]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - startDate
 *               - endDate
 *               - type
 *               - reason
 *             properties:
 *               startDate:
 *                 type: string
 *                 format: date
 *               endDate:
 *                 type: string
 *                 format: date
 *               type:
 *                 type: string
 *                 enum: [annual, sick, unpaid, other]
 *               reason:
 *                 type: string
 *     responses:
 *       201:
 *         description: Gửi đơn xin nghỉ thành công
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Leave'
 */

// Xin nghỉ phép
router.post('/leave', auth, async (req, res) => {
  try {
    const { startDate, endDate, type, reason } = req.body;
    const employee = await Employee.findOne({ userId: req.user._id });

    const leave = new Leave({
      employeeId: employee._id,
      startDate,
      endDate,
      type,
      reason
    });

    await leave.save();

    res.status(201).json({
      message: 'Đã gửi đơn xin nghỉ phép',
      leave
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

/**
 * @swagger
 * /api/attendance/report:
 *   get:
 *     summary: Báo cáo chấm công theo tháng
 *     tags: [Attendance]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: month
 *         required: true
 *         schema:
 *           type: integer
 *           minimum: 1
 *           maximum: 12
 *       - in: query
 *         name: year
 *         required: true
 *         schema:
 *           type: integer
 *     responses:
 *       200:
 *         description: Báo cáo chấm công
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 month:
 *                   type: integer
 *                 year:
 *                   type: integer
 *                 report:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       _id:
 *                         type: string
 *                       totalDays:
 *                         type: integer
 *                       totalOvertime:
 *                         type: number
 *                       presentDays:
 *                         type: integer
 *                       absentDays:
 *                         type: integer
 *                       leaveDays:
 *                         type: integer
 *                       employee:
 *                         $ref: '#/components/schemas/Employee'
 */

// Báo cáo chấm công theo tháng
router.get('/report', auth, async (req, res) => {
  try {
    const { month, year } = req.query;
    const startDate = new Date(year, month - 1, 1);
    const endDate = new Date(year, month, 0);

    const report = await Attendance.aggregate([
      {
        $match: {
          date: { $gte: startDate, $lte: endDate }
        }
      },
      {
        $group: {
          _id: '$employeeId',
          totalDays: { $sum: 1 },
          totalWorkingHours: { $sum: '$workingHours' },
          totalOvertime: { $sum: '$overtime' },
          totalLateMinutes: { $sum: '$lateMinutes' },
          presentDays: {
            $sum: { $cond: [{ $eq: ['$status', 'present'] }, 1, 0] }
          },
          absentDays: {
            $sum: { $cond: [{ $eq: ['$status', 'absent'] }, 1, 0] }
          },
          leaveDays: {
            $sum: { $cond: [{ $eq: ['$status', 'leave'] }, 1, 0] }
          }
        }
      },
      {
        $lookup: {
          from: 'employees',
          localField: '_id',
          foreignField: '_id',
          as: 'employee'
        }
      },
      {
        $unwind: '$employee'
      },
      {
        $project: {
          employee: {
            _id: '$employee._id',
            fullName: '$employee.fullName',
            department: '$employee.department'
          },
          totalDays: 1,
          totalWorkingHours: { $round: ['$totalWorkingHours', 2] },
          totalOvertime: { $round: ['$totalOvertime', 2] },
          totalLateMinutes: 1,
          presentDays: 1,
          absentDays: 1,
          leaveDays: 1
        }
      }
    ]);

    res.json({
      month,
      year,
      report
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

/**
 * @swagger
 * /api/attendance/report/me:
 *   get:
 *     summary: Báo cáo chấm công cá nhân theo tháng
 *     tags: [Attendance]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: month
 *         required: true
 *         schema:
 *           type: integer
 *           minimum: 1
 *           maximum: 12
 *       - in: query
 *         name: year
 *         required: true
 *         schema:
 *           type: integer
 *     responses:
 *       200:
 *         description: Báo cáo chấm công cá nhân
 */
router.get('/report/me', auth, async (req, res) => {
  try {
    const { month, year } = req.query;
    const employee = await Employee.findOne({ userId: req.user._id });

    const startDate = new Date(year, month - 1, 1);
    const endDate = new Date(year, month, 0);

    const attendances = await Attendance.find({
      employeeId: employee._id,
      date: { $gte: startDate, $lte: endDate }
    }).sort({ date: 1 });

    // Tính tổng số liệu
    const summary = {
      totalDays: attendances.length,
      totalWorkingHours: Number(attendances.reduce((sum, att) => sum + (att.workingHours || 0), 0).toFixed(2)),
      totalOvertime: Number(attendances.reduce((sum, att) => sum + (att.overtime || 0), 0).toFixed(2)),
      totalLateMinutes: attendances.reduce((sum, att) => sum + (att.lateMinutes || 0), 0),
      presentDays: attendances.filter(att => att.status === 'present').length,
      absentDays: attendances.filter(att => att.status === 'absent').length,
      leaveDays: attendances.filter(att => att.status === 'leave').length
    };

    res.json({
      month,
      year,
      employee: {
        id: employee._id,
        fullName: employee.fullName,
        department: employee.department
      },
      summary,
      details: attendances
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

/**
 * @swagger
 * /api/attendance/report/all:
 *   get:
 *     summary: Báo cáo chấm công tất cả nhân viên (chỉ admin)
 *     tags: [Attendance]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: month
 *         required: true
 *         schema:
 *           type: integer
 *           minimum: 1
 *           maximum: 12
 *       - in: query
 *         name: year
 *         required: true
 *         schema:
 *           type: integer
 *       - in: query
 *         name: department
 *         schema:
 *           type: string
 *         description: ID phòng ban (không bắt buộc)
 *     responses:
 *       200:
 *         description: Báo cáo chấm công tất cả nhân viên
 */
router.get('/report/all', [auth, isAdmin], async (req, res) => {
  try {
    const { month, year, department } = req.query;
    const startDate = new Date(year, month - 1, 1);
    const endDate = new Date(year, month, 0);

    const data = await Attendance.aggregate([
      {
        $match: {
          date: { $gte: startDate, $lte: endDate }
        }
      },
      {
        $lookup: {
          from: 'employees',
          localField: 'employeeId',
          foreignField: '_id',
          as: 'employeeInfo'
        }
      },
      { $unwind: '$employeeInfo' },
      {
        $lookup: {
          from: 'departments',
          localField: 'employeeInfo.department',
          foreignField: '_id',
          as: 'departmentInfo'
        }
      },
      { $unwind: '$departmentInfo' },
      {
        $group: {
          _id: '$employeeId',
          employeeName: { $first: '$employeeInfo.fullName' },
          department: { $first: '$departmentInfo.name' },
          totalWorkingHours: { $sum: '$workingHours' },
          totalOvertimeHours: { $sum: '$overtime' },
          totalLateMinutes: { $sum: '$lateMinutes' },
          presentDays: {
            $sum: { $cond: [{ $eq: ['$status', 'present'] }, 1, 0] }
          },
          absentDays: {
            $sum: { $cond: [{ $eq: ['$status', 'absent'] }, 1, 0] }
          },
          leaveDays: {
            $sum: { $cond: [{ $eq: ['$status', 'leave'] }, 1, 0] }
          }
        }
      },
      {
        $project: {
          employeeName: 1,
          department: 1,
          totalWorkingHours: { $round: ['$totalWorkingHours', 2] },
          totalOvertimeHours: { $round: ['$totalOvertimeHours', 2] },
          totalLateMinutes: 1,
          presentDays: 1,
          absentDays: 1,
          leaveDays: 1
        }
      }
    ]);

    // Thêm filter theo phòng ban nếu có
    if (department) {
      data.push({
        $match: {
          department: new mongoose.Types.ObjectId(department)
        }
      });
    }

    // Thêm project để format kết quả
    data.push({
      $project: {
        employeeName: 1,
        department: 1,
        totalWorkingHours: { $round: ['$totalWorkingHours', 2] },
        totalOvertimeHours: { $round: ['$totalOvertimeHours', 2] },
        totalLateMinutes: 1,
        presentDays: 1,
        absentDays: 1,
        leaveDays: 1
      }
    });

    const report = await Attendance.aggregate(data);

    // Tính tổng số liệu cho toàn bộ báo cáo
    const totalSummary = {
      totalEmployees: report.length,
      avgWorkingHours: Number((report.reduce((sum, r) => sum + r.totalWorkingHours, 0) / report.length).toFixed(2)),
      avgOvertime: Number((report.reduce((sum, r) => sum + r.totalOvertimeHours, 0) / report.length).toFixed(2)),
      totalLateCount: report.reduce((sum, r) => sum + (r.totalLateMinutes > 0 ? 1 : 0), 0)
    };

    res.json({
      month,
      year,
      department,
      totalSummary,
      details: report
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// Trong route checkout
router.post('/checkout', auth, async (req, res) => {
  try {
    const attendance = await Attendance.findOne({
      employeeId: req.employee._id,
      date: {
        $gte: startOfDay,
        $lte: endOfDay
      }
    });

    // Kiểm tra yêu cầu làm thêm giờ
    const overtimeRequest = await OvertimeRequest.findOne({
      employeeId: req.employee._id,
      date: {
        $gte: startOfDay,
        $lte: endOfDay
      },
      status: 'approved'
    });

    const checkoutTime = new Date();
    const workingHours = (checkoutTime - attendance.checkinTime) / (1000 * 60 * 60);
    
    let overtime = 0;
    if (overtimeRequest && workingHours > 8) {
      overtime = Math.min(workingHours - 8, overtimeRequest.requestedHours);
    }

    attendance.checkoutTime = checkoutTime;
    attendance.workingHours = workingHours;
    attendance.overtime = overtime;
    await attendance.save();

    res.json(attendance);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

module.exports = router; 