const express = require('express');
const router = express.Router();
const multer = require('multer');
const { S3Client, PutObjectCommand, DeleteObjectCommand } = require('@aws-sdk/client-s3');
const Employee = require('../models/Employee');
const { auth, isAdmin, isOwner } = require('../middleware/auth');
const Department = require('../models/Department');
const User = require('../models/User');
const mongoose = require('mongoose');
const activityLogger = require('../middleware/activityLogger');

/**
 * @swagger
 * /api/employees:
 *   get:
 *     summary: Lấy danh sách nhân viên với tìm kiếm và lọc
 *     tags: [Employees]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: search
 *         schema:
 *           type: string
 *         description: Tìm kiếm theo tên nhân viên
 *       - in: query
 *         name: department
 *         schema:
 *           type: string
 *         description: Lọc theo phòng ban
 *       - in: query
 *         name: position
 *         schema:
 *           type: string
 *         description: Lọc theo chức vụ
 *       - in: query
 *         name: gender
 *         schema:
 *           type: string
 *           enum: [male, female, other]
 *       - in: query
 *         name: salaryMin
 *         schema:
 *           type: number
 *       - in: query
 *         name: salaryMax
 *         schema:
 *           type: number
 *       - in: query
 *         name: startDateFrom
 *         schema:
 *           type: string
 *           format: date
 *       - in: query
 *         name: startDateTo
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
 *           default: 10
 *     responses:
 *       200:
 *         description: Danh sách nhân viên
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 employees:
 *                   type: array
 *                   items:
 *                     $ref: '#/components/schemas/Employee'
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
router.get('/', auth, async (req, res) => {
  try {
    const {
      search,
      department,
      position,
      gender,
      salaryMin,
      salaryMax,
      startDateFrom,
      startDateTo,
      sortBy = 'createdAt',
      sortOrder = 'desc',
      page = 1,
      limit = 10
    } = req.query;

    const query = {};

    // Tìm kiếm theo tên hoặc email
    if (search) {
      query.$or = [
        { fullName: { $regex: search, $options: 'i' } },
        { email: { $regex: search, $options: 'i' } }
      ];
    }

    // Các điều kiện lọc khác giữ nguyên
    if (department) query.department = department;
    if (position) query.position = position;
    if (gender) query.gender = gender;

    // Lọc theo mức lương với validation
    if (salaryMin || salaryMax) {
      query.salary = {};
      if (salaryMin) query.salary.$gte = Math.max(0, parseInt(salaryMin));
      if (salaryMax) query.salary.$lte = parseInt(salaryMax);
    }

    // Lọc theo ngày với validation
    if (startDateFrom || startDateTo) {
      query.startDate = {};
      if (startDateFrom) {
        const fromDate = new Date(startDateFrom);
        if (!isNaN(fromDate)) query.startDate.$gte = fromDate;
      }
      if (startDateTo) {
        const toDate = new Date(startDateTo);
        if (!isNaN(toDate)) query.startDate.$lte = toDate;
      }
    }

    // Phân quyền: nhân viên chỉ xem được thông tin của mình
    if (req.user.role !== 'admin') {
      query.userId = req.user._id;
    }

    // Sắp xếp
    const sortOptions = {};
    sortOptions[sortBy] = sortOrder === 'desc' ? -1 : 1;

    const skip = (page - 1) * limit;
    
    // Thực hiện query với Promise.all để tối ưu hiệu năng
    const [employees, total, stats] = await Promise.all([
      Employee.find(query)
        .populate('userId', 'email role')
        .populate('department', 'name')
        .sort(sortOptions)
        .skip(skip)
        .limit(parseInt(limit))
        .lean(),
      Employee.countDocuments(query),
      Employee.aggregate([
        { $match: query },
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
                      { $eq: ['$status', 'present'] }
                    ]
                  }
                }
              },
              {
                $group: {
                  _id: null,
                  totalWorkingHours: { $sum: '$workingHours' },
                  totalOvertimeHours: { $sum: '$overtime' }
                }
              }
            ],
            as: 'attendanceStats'
          }
        },
        {
          $addFields: {
            workingHours: { 
              $ifNull: [{ $first: '$attendanceStats.totalWorkingHours' }, 0] 
            },
            overtimeHours: { 
              $ifNull: [{ $first: '$attendanceStats.totalOvertimeHours' }, 0] 
            },
            hourlyRate: { $divide: ['$salary', { $multiply: [8, 22] }] },
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
          $group: {
            _id: '$department',
            count: { $sum: 1 },
            totalBaseSalary: { $sum: '$salary' },
            totalWorkingHours: { $sum: '$workingHours' },
            totalOvertimeHours: { $sum: '$overtimeHours' },
            totalRegularPay: { $sum: { $round: ['$regularPay', 2] } },
            totalOvertimePay: { $sum: { $round: ['$overtimePay', 2] } },
            totalSalary: { 
              $sum: { 
                $round: [{ $add: ['$regularPay', '$overtimePay'] }, 2] 
              } 
            }
          }
        }
      ])
    ]);

    // Format response
    res.json({
      employees: employees.map(emp => ({
        ...emp,
        salary: emp.salary ? emp.salary.toLocaleString('vi-VN') : '0',
        startDate: emp.startDate ? emp.startDate.toLocaleDateString('vi-VN') : null
      })),
      pagination: {
        total,
        page: parseInt(page),
        totalPages: Math.ceil(total / limit)
      },
      stats: stats[0] || {
        totalBaseSalary: 0,
        totalWorkingHours: 0,
        totalOvertimeHours: 0,
        totalRegularPay: 0,
        totalOvertimePay: 0
      }
    });
  } catch (error) {
    res.status(500).json({ 
      message: 'Lỗi khi lấy danh sách nhân viên',
      error: error.message 
    });
  }
});

/**
 * @swagger
 * /api/employees/{id}:
 *   get:
 *     summary: Lấy thông tin chi tiết nhân viên
 *     tags: [Employees]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Thông tin nhân viên
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Employee'
 */
router.get('/:id', [auth, isOwner], async (req, res) => {
  try {
    const employee = await Employee.findById(req.params.id)
      .populate('userId', 'email role')
      .populate('department', 'name');

    // Kiểm tra quyền truy cập
    if (!employee) {
      return res.status(404).json({ message: 'Không tìm thấy nhân viên' });
    }

    // Nếu không phải admin và không phải chính nhân viên đó
    if (req.user.role !== 'admin' && employee.userId._id.toString() !== req.user._id.toString()) {
      return res.status(403).json({ message: 'Không có quyền truy cập' });
    }

    res.json(employee);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

/**
 * @swagger
 * /api/employees/stats/department:
 *   get:
 *     summary: Thống kê nhân viên theo phòng ban
 *     tags: [Employees]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Thống kê theo phòng ban
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 type: object
 *                 properties:
 *                   _id:
 *                     type: string
 *                   count:
 *                     type: integer
 *                   totalSalary:
 *                     type: number
 *                   avgSalary:
 *                     type: number
 */
router.get('/stats/department', auth, isAdmin, async (req, res) => {
  try {
    const stats = await Employee.aggregate([
      {
        $group: {
          _id: '$department',
          count: { $sum: 1 },
          totalBaseSalary: { $sum: '$baseSalary' },
          totalWorkingHours: { $sum: '$workingHours' },
          totalOvertimeHours: { $sum: '$overtimeHours' },
          totalRegularPay: {
            $sum: {
              $multiply: [
                { $divide: ['$baseSalary', { $multiply: [8, 22] }] },
                '$workingHours'
              ]
            }
          },
          totalOvertimePay: {
            $sum: {
              $multiply: [
                { $divide: ['$baseSalary', { $multiply: [8, 22] }] },
                '$overtimeHours',
                1.5
              ]
            }
          }
        }
      }
    ]);

    res.json(stats);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// Cấu hình S3
const s3 = new S3Client({
  region: process.env.AWS_REGION,
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  }
});

// Cấu hình multer với validation
const upload = multer({
  limits: {
    fileSize: 5 * 1024 * 1024, // giới hạn 5MB
  },
  fileFilter: (req, file, cb) => {
    if (!file.mimetype.match(/^image\/(jpg|jpeg|png|gif)$/)) {
      return cb(new Error('Chỉ chấp nhận file ảnh (jpg, jpeg, png, gif)'), false);
    }
    cb(null, true);
  }
});

/**
 * @swagger
 * /api/employees:
 *   post:
 *     summary: Thêm nhân viên mới kèm tài khoản (chỉ admin)
 *     tags: [Employees]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - email
 *               - password
 *               - fullName
 *               - dateOfBirth
 *               - gender
 *               - address
 *               - phoneNumber
 *               - department
 *               - position
 *               - salary
 *               - startDate
 *             properties:
 *               email:
 *                 type: string
 *                 format: email
 *               password:
 *                 type: string
 *                 minLength: 6
 *               fullName:
 *                 type: string
 *               dateOfBirth:
 *                 type: string
 *                 format: date
 *               gender:
 *                 type: string
 *                 enum: [male, female, other]
 *               address:
 *                 type: string
 *               phoneNumber:
 *                 type: string
 *               department:
 *                 type: string
 *               position:
 *                 type: string
 *               salary:
 *                 type: number
 *               startDate:
 *                 type: string
 *                 format: date
 */
router.post('/', [auth, isAdmin], async (req, res, next) => {
  try {
    console.log('Bắt đầu xử lý thêm nhân viên:', req.body);
    
    const {
      email,
      password,
      fullName,
      dateOfBirth,
      gender,
      address,
      phoneNumber,
      department,
      position,
      salary,
      startDate
    } = req.body;

    // Tập hợp tất cả lỗi validation
    const errors = [];

    // Kiểm tra các trường bắt buộc
    if (!email) errors.push('Email là bắt buộc');
    if (!password) errors.push('Mật khẩu là bắt buộc');
    if (!fullName) errors.push('Họ tên là bắt buộc');
    if (!dateOfBirth) errors.push('Ngày sinh là bắt buộc');
    if (!gender) errors.push('Giới tính là bắt buộc');
    if (!department) errors.push('Phòng ban là bắt buộc');
    if (!position) errors.push('Chức vụ là bắt buộc');
    if (!salary) errors.push('Lương là bắt buộc');
    if (!startDate) errors.push('Ngày bắt đầu là bắt buộc');

    // Trả về tất cả lỗi nếu có
    if (errors.length > 0) {
      console.log('Lỗi validation:', errors);
      return res.status(400).json({
        message: 'Dữ liệu không hợp lệ',
        errors
      });
    }

    // Validate email format nếu có email
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      console.log('Email không hợp lệ:', email);
      return res.status(400).json({ message: 'Email không hợp lệ' });
    }

    // Validate salary nếu có salary
    if (salary && (isNaN(salary) || Number(salary) < 0)) {
      console.log('Lương không hợp lệ:', salary);
      return res.status(400).json({ message: 'Mức lương không hợp lệ' });
    }

    // Kiểm tra email tồn tại
    const existingUserCheck = await User.findOne({ email });
    if (existingUserCheck) {
      console.log('Email đã tồn tại:', email);
      return res.status(400).json({ message: 'Email đã tồn tại' });
    }

    // Kiểm tra department tồn tại
    const departmentCheck = await Department.findById(department);
    if (!departmentCheck) {
      console.log('Phòng ban không tồn tại:', department);
      return res.status(400).json({ message: 'Phòng ban không tồn tại' });
    }

    // Tiếp tục xử lý nếu không có lỗi validation
    console.log('Validation thành công, tiếp tục xử lý');
    
    // Tạo user mới
    const user = new User({
      email,
      password,
      role: 'employee'
    });
    await user.save();

    // Tạo employee mới
    const employee = new Employee({
      userId: user._id,
      fullName,
      dateOfBirth: new Date(dateOfBirth),
      gender,
      address,
      phoneNumber,
      department,
      position,
      salary: Number(salary),
      baseSalary: Number(salary),
      hourlyRate: Number(salary) / (8 * 22),
      startDate: new Date(startDate)
    });

    await employee.save();

    // Cập nhật số lượng nhân viên trong department
    await Department.findByIdAndUpdate(
      department,
      { $inc: { employeeCount: 1 } },
      { new: true }
    );

    // Populate thông tin liên quan
    const populatedEmployee = await Employee.findById(employee._id)
      .populate('department', 'name')
      .populate('userId', 'email role');

    await activityLogger('create', 'employee')(req, res);

    res.status(201).json({
      message: 'Thêm nhân viên và tạo tài khoản thành công',
      employee: populatedEmployee
    });

  } catch (error) {
    console.error('Lỗi khi thêm nhân viên:', error);
    
    // Nếu đã tạo user nhưng chưa tạo employee, xóa user đó
    if (error.message.includes('employee') && req.body.email) {
      try {
        const user = await User.findOne({ email: req.body.email });
        if (user) {
          await User.deleteOne({ _id: user._id });
          console.log('Đã xóa user do lỗi khi tạo employee');
        }
      } catch (cleanupError) {
        console.error('Lỗi khi dọn dẹp:', cleanupError);
      }
    }
    
    return res.status(500).json({
      message: 'Lỗi khi thêm nhân viên',
      error: error.message
    });
  }
});

/**
 * @swagger
 * /api/employees/{id}:
 *   put:
 *     summary: Cập nhật thông tin nhân viên (chỉ admin)
 *     tags: [Employees]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               fullName:
 *                 type: string
 *               dateOfBirth:
 *                 type: string
 *                 format: date
 *               gender:
 *                 type: string
 *                 enum: [male, female, other]
 *               address:
 *                 type: string
 *               phoneNumber:
 *                 type: string
 *               department:
 *                 type: string
 *               position:
 *                 type: string
 *               salary:
 *                 type: number
 *               startDate:
 *                 type: string
 *                 format: date
 */
router.put('/:id', [auth, isAdmin], async (req, res) => {
  try {
    const employee = await Employee.findById(req.params.id);
    if (!employee) {
      return res.status(404).json({ message: 'Không tìm thấy nhân viên' });
    }

    // Lưu trạng thái trước khi cập nhật để log
    req.originalBody = employee.toObject();

    const updateData = req.body;
    if (updateData.department && updateData.department !== employee.department.toString()) {
      const newDepartment = await Department.findById(updateData.department);
      if (!newDepartment) {
        return res.status(400).json({ message: 'Phòng ban không tồn tại' });
      }
    }

    // Chuyển đổi các trường ngày tháng
    if (updateData.dateOfBirth) {
      updateData.dateOfBirth = new Date(updateData.dateOfBirth);
    }
    if (updateData.startDate) {
      updateData.startDate = new Date(updateData.startDate);
    }
    if (updateData.salary) {
      updateData.salary = Number(updateData.salary);
    }

    // Tính toán những thay đổi để log
    const changes = {};
    Object.keys(updateData).forEach(key => {
      if (JSON.stringify(employee[key]) !== JSON.stringify(updateData[key])) {
        changes[key] = {
          from: employee[key],
          to: updateData[key]
        };
      }
    });
    req.changes = changes;

    // Cập nhật thông tin
    Object.assign(employee, updateData);
    await employee.save();

    // Populate thông tin liên quan
    const updatedEmployee = await Employee.findById(employee._id)
      .populate('department', 'name')
      .populate('userId', 'email role');

    // Log hoạt động
    await activityLogger('update', 'employee')(req, res);

    res.json({
      message: 'Cập nhật thông tin thành công',
      employee: updatedEmployee
    });

  } catch (error) {
    res.status(400).json({
      message: 'Lỗi khi cập nhật thông tin',
      error: error.message
    });
  }
});

/**
 * @swagger
 * /api/employees/{id}:
 *   delete:
 *     summary: Xóa nhân viên và tài khoản (chỉ admin)
 *     tags: [Employees]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Xóa nhân viên thành công
 *       404:
 *         description: Không tìm thấy nhân viên
 */
router.delete('/:id', [auth, isAdmin], async (req, res) => {
  try {
    const employee = await Employee.findById(req.params.id);
    if (!employee) {
      return res.status(404).json({ message: 'Không tìm thấy nhân viên' });
    }

    // Lưu thông tin nhân viên trước khi xóa để log
    req.originalBody = employee.toObject();

    // Xóa user account nếu có
    if (employee.userId) {
      await User.findByIdAndDelete(employee.userId);
    }

    // Xóa nhân viên bằng findByIdAndDelete thay vì remove()
    await Employee.findByIdAndDelete(req.params.id);

    // Giảm số lượng nhân viên trong department
    if (employee.department) {
      await Department.findByIdAndUpdate(
        employee.department,
        { $inc: { employeeCount: -1 } }
      );
    }

    // Log hoạt động
    await activityLogger('delete', 'employee')(req, res);

    res.json({ 
      message: 'Xóa nhân viên thành công',
      deletedEmployee: {
        id: employee._id,
        fullName: employee.fullName,
        email: employee.email
      }
    });
  } catch (error) {
    res.status(500).json({ 
      message: 'Lỗi khi xóa nhân viên',
      error: error.message 
    });
  }
});

// Thêm route xuất báo cáo
router.get('/export', [auth, isAdmin], async (req, res) => {
  try {
    const employees = await Employee.find()
      .populate('department', 'name')
      .lean();

    // TODO: Implement export to Excel/PDF
    res.json({ message: 'Tính năng đang được phát triển' });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

/**
 * @swagger
 * /api/employees/avatar:
 *   post:
 *     summary: Upload avatar cho nhân viên
 *     tags: [Employees]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             required:
 *               - avatar
 *             properties:
 *               avatar:
 *                 type: string
 *                 format: binary
 *     responses:
 *       200:
 *         description: Avatar đã được cập nhật
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 avatarUrl:
 *                   type: string
 */
router.post('/avatar', [auth, isOwner, upload.single('avatar')], async (req, res) => {
  try {
    const employee = req.employee;

    if (!req.file) {
      return res.status(400).json({ message: 'Vui lòng upload file ảnh' });
    }

    // Xóa avatar cũ nếu có
    if (employee.avatarUrl) {
      try {
        const oldKey = employee.avatarUrl.split('/').pop();
        await s3.send(new DeleteObjectCommand({
          Bucket: process.env.AWS_S3_BUCKET,
          Key: `avatars/${oldKey}`
        }));
      } catch (error) {
        console.error('Lỗi khi xóa avatar cũ:', error);
      }
    }

    // Upload avatar mới
    const key = `avatars/${employee._id}-${Date.now()}-${req.file.originalname}`;
    await s3.send(new PutObjectCommand({
      Bucket: process.env.AWS_S3_BUCKET,
      Key: key,
      Body: req.file.buffer,
      ContentType: req.file.mimetype
    }));

    const avatarUrl = `https://${process.env.AWS_S3_BUCKET}.s3.${process.env.AWS_REGION}.amazonaws.com/${key}`;
    
    // Cập nhật URL trong database
    employee.avatarUrl = avatarUrl;
    await employee.save();

    res.json({ 
      message: 'Upload avatar thành công',
      avatarUrl 
    });

  } catch (error) {
    res.status(500).json({ 
      message: 'Lỗi khi upload avatar',
      error: error.message 
    });
  }
});

/**
 * @swagger
 * /api/employees/avatar:
 *   delete:
 *     summary: Xóa avatar của nhân viên
 *     tags: [Employees]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Avatar đã được xóa
 */
router.delete('/avatar', [auth, isOwner], async (req, res) => {
  try {
    const employee = req.employee;

    if (!employee.avatarUrl) {
      return res.status(400).json({ message: 'Nhân viên chưa có avatar' });
    }

    // Xóa file từ S3
    const key = employee.avatarUrl.split('/').pop();
    await s3.send(new DeleteObjectCommand({
      Bucket: process.env.AWS_S3_BUCKET,
      Key: `avatars/${key}`
    }));

    // Xóa URL từ database
    employee.avatarUrl = null;
    await employee.save();

    res.json({ message: 'Đã xóa avatar thành công' });

  } catch (error) {
    res.status(500).json({ 
      message: 'Lỗi khi xóa avatar',
      error: error.message 
    });
  }
});

module.exports = router; 