require('dotenv').config();
const mongoose = require('mongoose');
const User = require('../models/User');

const createAdmin = async () => {
  try {
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('Đã kết nối đến database');

    // Kiểm tra xem đã có admin chưa
    const existingAdmin = await User.findOne({ role: 'admin' });
    if (existingAdmin) {
      console.log('Admin đã tồn tại trong hệ thống');
      return;
    }

    // Tạo tài khoản admin mới
    const admin = new User({
      email: process.env.ADMIN_EMAIL || 'admin@example.com',
      password: process.env.ADMIN_PASSWORD || 'admin123',
      fullName: 'System Admin',
      role: 'admin',
      isActive: true
    });

    await admin.save();
    console.log('Đã tạo tài khoản admin thành công:', {
      email: admin.email,
      fullName: admin.fullName,
      role: admin.role
    });

  } catch (error) {
    console.error('Lỗi:', error.message);
  } finally {
    await mongoose.disconnect();
    console.log('Đã ngắt kết nối database');
  }
};

createAdmin(); 