const jwt = require('jsonwebtoken');
const User = require('../models/User');
const Employee = require('../models/Employee');

const auth = async (req, res, next) => {
  try {
    const token = req.header('Authorization')?.replace('Bearer ', '');
    
    if (!token) {
      return res.status(401).json({ message: 'Token không tồn tại' });
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const user = await User.findById(decoded.userId).select('-password');

    if (!user || !user.isActive) {
      throw new Error();
    }

    // Kiểm tra token hết hạn
    const tokenExp = decoded.exp * 1000; // Convert to milliseconds
    if (Date.now() >= tokenExp) {
      return res.status(401).json({ message: 'Token đã hết hạn' });
    }

    req.token = token;
    req.user = user;
    next();
  } catch (error) {
    res.status(401).json({ message: 'Xác thực không hợp lệ' });
  }
};

const isAdmin = (req, res, next) => {
  if (req.user.role !== 'admin') {
    return res.status(403).json({ message: 'Không có quyền truy cập' });
  }
  next();
};

// Middleware kiểm tra quyền sở hữu
const isOwner = async (req, res, next) => {
  try {
    const employee = await Employee.findOne({ userId: req.user.id });
    if (!employee) {
      return res.status(404).json({ message: 'Không tìm thấy nhân viên' });
    }

    if (req.user.role !== 'admin' && employee.userId.toString() !== req.user._id.toString()) {
      return res.status(403).json({ message: 'Không có quyền truy cập' });
    }

    req.employee = employee;
    next();
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

module.exports = { auth, isAdmin, isOwner }; 