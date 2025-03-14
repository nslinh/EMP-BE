const express = require('express');
const router = express.Router();
const Department = require('../models/Department');
const Employee = require('../models/Employee');
const { auth, isAdmin } = require('../middleware/auth');

/**
 * @swagger
 * /api/departments:
 *   get:
 *     summary: Lấy danh sách phòng ban
 *     tags: [Departments]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Danh sách phòng ban
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 $ref: '#/components/schemas/Department'
 */
router.get('/', auth, async (req, res) => {
  try {
    const departments = await Department.find({ isActive: true })
    //   .populate('manager', 'fullName')
      .populate('employeeCount');

    res.json(departments);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

/**
 * @swagger
 * /api/departments/{id}:
 *   get:
 *     summary: Lấy chi tiết phòng ban và danh sách nhân viên
 *     tags: [Departments]
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
 *         description: Chi tiết phòng ban và danh sách nhân viên
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 department:
 *                   $ref: '#/components/schemas/Department'
 *                 employees:
 *                   type: array
 *                   items:
 *                     $ref: '#/components/schemas/Employee'
 */
router.get('/:id', auth, async (req, res) => {
  try {
    const department = await Department.findById(req.params.id)
      .populate('manager', 'fullName');
    
    if (!department) {
      return res.status(404).json({ message: 'Không tìm thấy phòng ban' });
    }

    const employees = await Employee.find({ department: department._id })
      .populate('userId', 'email role');

    res.json({
      department,
      employees
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

/**
 * @swagger
 * /api/departments:
 *   post:
 *     summary: Thêm phòng ban mới
 *     tags: [Departments]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - name
 *             properties:
 *               name:
 *                 type: string
 *               description:
 *                 type: string
 *               managerId:
 *                 type: string
 *     responses:
 *       201:
 *         description: Phòng ban đã được tạo
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Department'
 */
router.post('/', [auth, isAdmin], async (req, res) => {
  try {
    const { name, description, managerId } = req.body;

    const existingDepartment = await Department.findOne({ name });
    if (existingDepartment) {
      return res.status(400).json({ message: 'Tên phòng ban đã tồn tại' });
    }

    const department = new Department({
      name,
      description,
      manager: managerId
    });

    await department.save();
    res.status(201).json(department);
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
});

// Cập nhật phòng ban
router.put('/:id', [auth, isAdmin], async (req, res) => {
  try {
    const { name, description, managerId, isActive } = req.body;
    const department = await Department.findById(req.params.id);

    if (!department) {
      return res.status(404).json({ message: 'Không tìm thấy phòng ban' });
    }

    if (name && name !== department.name) {
      const existingDepartment = await Department.findOne({ name });
      if (existingDepartment) {
        return res.status(400).json({ message: 'Tên phòng ban đã tồn tại' });
      }
      department.name = name;
    }

    if (description !== undefined) department.description = description;
    if (managerId !== undefined) department.manager = managerId;
    if (isActive !== undefined) department.isActive = isActive;

    await department.save();
    res.json(department);
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
});

// Xóa phòng ban (soft delete)
router.delete('/:id', [auth, isAdmin], async (req, res) => {
  try {
    const department = await Department.findById(req.params.id);
    if (!department) {
      return res.status(404).json({ message: 'Không tìm thấy phòng ban' });
    }

    // Kiểm tra xem còn nhân viên trong phòng ban không
    const employeeCount = await Employee.countDocuments({ department: department._id });
    if (employeeCount > 0) {
      return res.status(400).json({ 
        message: 'Không thể xóa phòng ban còn nhân viên',
        employeeCount
      });
    }

    department.isActive = false;
    await department.save();
    
    res.json({ message: 'Đã xóa phòng ban thành công' });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

/**
 * @swagger
 * /api/departments/{id}/transfer:
 *   post:
 *     summary: Chuyển nhân viên sang phòng ban khác
 *     tags: [Departments]
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
 *             required:
 *               - employeeIds
 *               - newDepartmentId
 *             properties:
 *               employeeIds:
 *                 type: array
 *                 items:
 *                   type: string
 *               newDepartmentId:
 *                 type: string
 *     responses:
 *       200:
 *         description: Chuyển nhân viên thành công
 */
router.post('/:id/transfer', [auth, isAdmin], async (req, res) => {
  try {
    const { employeeIds, newDepartmentId } = req.body;
    
    // Kiểm tra phòng ban mới tồn tại
    const newDepartment = await Department.findById(newDepartmentId);
    if (!newDepartment) {
      return res.status(404).json({ message: 'Không tìm thấy phòng ban mới' });
    }

    // Cập nhật phòng ban cho các nhân viên
    await Employee.updateMany(
      { _id: { $in: employeeIds } },
      { department: newDepartmentId }
    );

    res.json({ message: 'Đã chuyển nhân viên thành công' });
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
});

module.exports = router; 