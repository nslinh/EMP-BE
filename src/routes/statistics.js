const express = require('express');
const router = express.Router();
const { auth, isAdmin } = require('../middleware/auth');
const Employee = require('../models/Employee');
const Attendance = require('../models/Attendance');
const ExcelJS = require('exceljs');
const PDFDocument = require('pdfkit');

/**
 * @swagger
 * /api/statistics/employees:
 *   get:
 *     summary: Thống kê nhân viên theo nhiều tiêu chí
 *     tags: [Statistics]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: groupBy
 *         schema:
 *           type: string
 *           enum: [department, position, gender]
 *         required: true
 *     responses:
 *       200:
 *         description: Thống kê thành công
 */
router.get('/employees', [auth, isAdmin], async (req, res) => {
  try {
    const { groupBy } = req.query;
    let stats;

    switch (groupBy) {
      case 'department':
        stats = await Employee.aggregate([
          {
            $group: {
              _id: '$department',
              count: { $sum: 1 },
              avgSalary: { $avg: '$salary' },
              totalSalary: { $sum: '$salary' }
            }
          },
          {
            $lookup: {
              from: 'departments',
              localField: '_id',
              foreignField: '_id',
              as: 'departmentInfo'
            }
          },
          { $unwind: '$departmentInfo' }
        ]);
        break;

      case 'position':
        stats = await Employee.aggregate([
          {
            $group: {
              _id: '$position',
              count: { $sum: 1 },
              avgSalary: { $avg: '$salary' }
            }
          }
        ]);
        break;

      case 'gender':
        stats = await Employee.aggregate([
          {
            $group: {
              _id: '$gender',
              count: { $sum: 1 }
            }
          }
        ]);
        break;
    }

    res.json(stats);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

/**
 * @swagger
 * /api/statistics/salary:
 *   get:
 *     summary: Thống kê lương theo thời gian
 *     tags: [Statistics]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: type
 *         schema:
 *           type: string
 *           enum: [month, quarter]
 *         required: true
 *         description: Loại thống kê (theo tháng hoặc quý)
 *       - in: query
 *         name: year
 *         schema:
 *           type: integer
 *         required: true
 *         description: Năm thống kê
 *       - in: query
 *         name: month
 *         schema:
 *           type: integer
 *           minimum: 1
 *           maximum: 12
 *         description: Tháng thống kê (bắt buộc nếu type=month)
 *       - in: query
 *         name: quarter
 *         schema:
 *           type: integer
 *           minimum: 1
 *           maximum: 4
 *         description: Quý thống kê (bắt buộc nếu type=quarter)
 *     responses:
 *       200:
 *         description: Thống kê lương thành công
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 period:
 *                   type: object
 *                   properties:
 *                     type:
 *                       type: string
 *                     year:
 *                       type: integer
 *                     month:
 *                       type: integer
 *                     quarter:
 *                       type: integer
 *                 departments:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       _id:
 *                         type: string
 *                       departmentName:
 *                         type: string
 *                       employees:
 *                         type: array
 *                         items:
 *                           type: object
 *                           properties:
 *                             _id:
 *                               type: string
 *                             fullName:
 *                               type: string
 *                             baseSalary:
 *                               type: number
 *                             workingHours:
 *                               type: number
 *                             overtimeHours:
 *                               type: number
 *                             regularPay:
 *                               type: number
 *                             overtimePay:
 *                               type: number
 *                             totalSalary:
 *                               type: number
 *                       totalEmployees:
 *                         type: integer
 *                       totalBaseSalary:
 *                         type: number
 *                       totalRegularPay:
 *                         type: number
 *                       totalOvertimePay:
 *                         type: number
 *                       totalSalary:
 *                         type: number
 *                       avgSalary:
 *                         type: number
 *                 summary:
 *                   type: object
 *                   properties:
 *                     totalEmployees:
 *                       type: integer
 *                     totalSalary:
 *                       type: number
 *                     avgSalary:
 *                       type: number
 *       400:
 *         description: Lỗi tham số
 *       401:
 *         description: Không có quyền truy cập
 */
router.get('/salary', [auth, isAdmin], async (req, res) => {
  try {
    const { type, year, month, quarter } = req.query;
    
    if (!type || !year) {
      return res.status(400).json({ 
        message: 'Thiếu thông tin type hoặc year' 
      });
    }

    let startDate, endDate;
    if (type === 'month') {
      if (!month) {
        return res.status(400).json({ 
          message: 'Thiếu thông tin tháng' 
        });
      }
      startDate = new Date(year, month - 1, 1);
      endDate = new Date(year, month, 0);
    } else if (type === 'quarter') {
      if (!quarter) {
        return res.status(400).json({ 
          message: 'Thiếu thông tin quý' 
        });
      }
      const startMonth = (quarter - 1) * 3;
      startDate = new Date(year, startMonth, 1);
      endDate = new Date(year, startMonth + 3, 0);
    } else {
      return res.status(400).json({ 
        message: 'Type không hợp lệ' 
      });
    }

    const stats = await Employee.aggregate([
      {
        $lookup: {
          from: 'attendances',
          let: { employeeId: '$_id' },
          pipeline: [
            {
              $match: {
                $expr: {
                  $and: [
                    { $eq: ['$employeeId', '$$employeeId'] },
                    { $gte: ['$date', startDate] },
                    { $lte: ['$date', endDate] },
                    { $eq: ['$status', 'present'] }
                  ]
                }
              }
            },
            {
              $group: {
                _id: null,
                totalWorkingHours: { $sum: { $ifNull: ['$workingHours', 0] } },
                totalOvertimeHours: { $sum: { $ifNull: ['$overtime', 0] } }
              }
            }
          ],
          as: 'attendanceStats'
        }
      },
      {
        $lookup: {
          from: 'departments',
          localField: 'department',
          foreignField: '_id',
          as: 'departmentInfo'
        }
      },
      { $unwind: '$departmentInfo' },
      {
        $addFields: {
          workingHours: { 
            $ifNull: [{ $first: '$attendanceStats.totalWorkingHours' }, 0] 
          },
          overtimeHours: { 
            $ifNull: [{ $first: '$attendanceStats.totalOvertimeHours' }, 0] 
          },
          standardHours: { $multiply: [8, 22] },
          hourlyRate: {
            $divide: ['$salary', { $multiply: [8, 22] }]
          },
          regularPay: {
            $multiply: [
              { $divide: ['$salary', { $multiply: [8, 22] }] },
              { $ifNull: [{ $first: '$attendanceStats.totalWorkingHours' }, 0] }
            ]
          },
          overtimePay: {
            $multiply: [
              { $divide: ['$salary', { $multiply: [8, 22] }] },
              { $ifNull: [{ $first: '$attendanceStats.totalOvertimeHours' }, 0] },
              1.5
            ]
          }
        }
      },
      {
        $project: {
          fullName: 1,
          department: '$departmentInfo.name',
          baseSalary: '$salary',
          workingHours: 1,
          overtimeHours: 1,
          regularPay: { $round: ['$regularPay', 2] },
          overtimePay: { $round: ['$overtimePay', 2] },
          totalSalary: {
            $round: [{ $add: ['$regularPay', '$overtimePay'] }, 2]
          }
        }
      },
      {
        $group: {
          _id: '$department',
          departmentName: { $first: '$department' },
          employees: {
            $push: {
              _id: '$_id',
              fullName: '$fullName',
              baseSalary: '$baseSalary',
              workingHours: '$workingHours',
              overtimeHours: '$overtimeHours', 
              regularPay: '$regularPay',
              overtimePay: '$overtimePay',
              totalSalary: '$totalSalary'
            }
          },
          totalEmployees: { $sum: 1 },
          totalBaseSalary: { $sum: '$baseSalary' },
          totalRegularPay: { $sum: '$regularPay' },
          totalOvertimePay: { $sum: '$overtimePay' },
          totalSalary: { $sum: '$totalSalary' }
        }
      }
    ]);

    // Format response
    const response = {
      period: {
        type,
        year,
        ...(type === 'month' ? { month } : { quarter })
      },
      departments: stats,
      summary: {
        totalEmployees: stats.reduce((sum, dept) => sum + dept.totalEmployees, 0),
        totalSalary: stats.reduce((sum, dept) => sum + dept.totalSalary, 0),
        avgSalary: stats.reduce((sum, dept) => sum + dept.totalSalary, 0) / 
                  stats.reduce((sum, dept) => sum + dept.totalEmployees, 0)
      }
    };

    res.json(response);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

/**
 * @swagger
 * /api/statistics/export:
 *   get:
 *     summary: Xuất báo cáo ra file Excel hoặc PDF
 *     tags: [Statistics]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: format
 *         schema:
 *           type: string
 *           enum: [excel, pdf]
 *         required: true
 *         description: Định dạng file xuất (Excel hoặc PDF)
 *       - in: query
 *         name: type
 *         schema:
 *           type: string
 *           enum: [employees, salary, attendance]
 *         required: true
 *         description: Loại báo cáo cần xuất
 *     responses:
 *       200:
 *         description: Tải file thành công
 *         content:
 *           application/vnd.openxmlformats-officedocument.spreadsheetml.sheet:
 *             schema:
 *               type: string
 *               format: binary
 *               description: File Excel
 *           application/pdf:
 *             schema:
 *               type: string
 *               format: binary
 *               description: File PDF
 *         examples:
 *           excel:
 *             summary: Excel Report
 *             value:
 *               type: employees
 *               columns:
 *                 - Họ Tên
 *                 - Phòng Ban
 *                 - Chức Vụ
 *                 - Lương
 *           pdf:
 *             summary: PDF Report
 *             value:
 *               type: employees
 *               sections:
 *                 - Tiêu đề báo cáo
 *                 - Ngày xuất báo cáo
 *                 - Bảng dữ liệu
 *       400:
 *         description: Lỗi tham số
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 message:
 *                   type: string
 *                   example: Định dạng không hợp lệ
 *       401:
 *         description: Không có quyền truy cập
 *       500:
 *         description: Lỗi server
 */
router.get('/export', [auth, isAdmin], async (req, res) => {
  try {
    const { format, type } = req.query;
    
    if (format !== 'excel' && format !== 'pdf') {
      return res.status(400).json({ 
        message: 'Hien tai chi ho tro xuat file Excel va PDF' 
      });
    }

    let data;
    switch (type) {
      case 'employees':
        data = await Employee.find()
          .populate('department', 'name')
          .select('fullName department position salary')
          .lean()
          .then(employees => employees.map(emp => ({
            ...emp,
            department: emp.department?.name || 'N/A',
            salary: emp.salary.toLocaleString('vi-VN')
          })));
        break;

      case 'salary':
        data = await Employee.aggregate([
          {
            $lookup: {
              from: 'departments',
              localField: 'department',
              foreignField: '_id',
              as: 'departmentInfo'
            }
          },
          { $unwind: '$departmentInfo' },
          {
            $group: {
              _id: '$department',
              department: { $first: '$departmentInfo.name' },
              totalSalary: { $sum: '$salary' },
              avgSalary: { $avg: '$salary' },
              employeeCount: { $sum: 1 }
            }
          }
        ]);
        break;

      case 'attendance':
        const startOfMonth = new Date();
        startOfMonth.setDate(1);
        startOfMonth.setHours(0, 0, 0, 0);
        
        data = await Attendance.aggregate([
          {
            $match: {
              date: { $gte: startOfMonth }
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
              totalDays: { $sum: 1 },
              totalLate: { 
                $sum: { $cond: [{ $gt: ['$lateMinutes', 0] }, 1, 0] }
              },
              avgWorkingHours: { $avg: '$workingHours' }
            }
          },
          {
            $project: {
              employeeName: 1,
              department: 1,
              totalDays: 1,
              totalLate: 1,
              avgWorkingHours: { $round: ['$avgWorkingHours', 2] }
            }
          }
        ]);
        break;

      default:
        return res.status(400).json({
          message: 'Loại báo cáo không hợp lệ'
        });
    }

    if (format === 'excel') {
      const workbook = new ExcelJS.Workbook();
      const worksheet = workbook.addWorksheet('Report');

      // Cấu hình columns theo type
      if (type === 'employees') {
        worksheet.columns = [
          { header: 'Họ Tên', key: 'fullName', width: 30 },
          { header: 'Phòng Ban', key: 'department', width: 20 },
          { header: 'Chức Vụ', key: 'position', width: 20 },
          { header: 'Lương', key: 'salary', width: 15 }
        ];
      } else if (type === 'salary') {
        worksheet.columns = [
          { header: 'Phòng Ban', key: 'department', width: 30 },
          { header: 'Tổng Lương', key: 'totalSalary', width: 20 },
          { header: 'Lương Trung Bình', key: 'avgSalary', width: 20 },
          { header: 'Số Nhân Viên', key: 'employeeCount', width: 15 }
        ];
      }

      // Style cho header
      worksheet.getRow(1).font = { bold: true };
      worksheet.getRow(1).alignment = { vertical: 'middle', horizontal: 'center' };

      // Thêm data
      worksheet.addRows(data);

      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.setHeader('Content-Disposition', `attachment; filename=report-${type}-${new Date().toISOString().split('T')[0]}.xlsx`);
      
      await workbook.xlsx.write(res);
    } else {
      const doc = new PDFDocument({
        size: 'A4',
        margin: 50,
        info: {
          Title: `Bao cao ${type}`,
          Author: 'HR Management System',
        }
      });

      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `attachment; filename=report-${type}-${new Date().toISOString().split('T')[0]}.pdf`);
      doc.pipe(res);

      // Tiêu đề
      doc.fontSize(16)
         .text(`BAO CAO ${type.toUpperCase()}`, {
           align: 'center',
           underline: true
         });
      doc.moveDown();

      // Ngày xuất báo cáo
      doc.fontSize(12)
         .text(`Ngay xuat bao cao: ${new Date().toLocaleDateString('vi-VN')}`, {
           align: 'right'
         });
      doc.moveDown();

      // Tạo bảng dữ liệu
      const tableTop = 150;
      let currentTop = tableTop;

      if (type === 'employees') {
        // Headers
        doc.fontSize(10);
        doc.text('STT', 50, currentTop);
        doc.text('Ho Ten', 100, currentTop);
        doc.text('Phong Ban', 250, currentTop);
        doc.text('Chuc Vu', 350, currentTop);
        doc.text('Luong', 450, currentTop);
        
        currentTop += 20;

        // Data rows
        data.forEach((emp, index) => {
          if (currentTop > 700) {
            doc.addPage();
            currentTop = 50;
          }

          doc.text((index + 1).toString(), 50, currentTop);
          doc.text(removeVietnameseTones(emp.fullName), 100, currentTop);
          doc.text(removeVietnameseTones(emp.department), 250, currentTop);
          doc.text(removeVietnameseTones(emp.position), 350, currentTop);
          doc.text(emp.salary, 450, currentTop);
          
          currentTop += 20;
        });
      }

      // Thêm số trang
      const pages = doc.bufferedPageRange();
      for (let i = 0; i < pages.count; i++) {
        doc.switchToPage(i);
        doc.text(
          `Trang ${i + 1}/${pages.count}`,
          50,
          doc.page.height - 50,
          { align: 'center' }
        );
      }

      doc.end();
    }
  } catch (error) {
    console.error('Export error:', error);
    res.status(500).json({ message: error.message });
  }
});

// Hàm chuyển tiếng Việt có dấu thành không dấu
function removeVietnameseTones(str) {
  if (!str) return '';
  str = str.replace(/à|á|ạ|ả|ã|â|ầ|ấ|ậ|ẩ|ẫ|ă|ằ|ắ|ặ|ẳ|ẵ/g, "a");
  str = str.replace(/è|é|ẹ|ẻ|ẽ|ê|ề|ế|ệ|ể|ễ/g, "e");
  str = str.replace(/ì|í|ị|ỉ|ĩ/g, "i");
  str = str.replace(/ò|ó|ọ|ỏ|õ|ô|ồ|ố|ộ|ổ|ỗ|ơ|ờ|ớ|ợ|ở|ỡ/g, "o");
  str = str.replace(/ù|ú|ụ|ủ|ũ|ư|ừ|ứ|ự|ử|ữ/g, "u");
  str = str.replace(/ỳ|ý|ỵ|ỷ|ỹ/g, "y");
  str = str.replace(/đ/g, "d");
  return str;
}

module.exports = router; 