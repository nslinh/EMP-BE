const express = require('express');
const router = express.Router();
const User = require('../models/User');
const { auth } = require('../middleware/auth');
const bcrypt = require('bcryptjs');

/**
 * @swagger
 * /api/users/change-password:
 *   post:
 *     summary: Đổi mật khẩu người dùng
 *     tags: [Users]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - currentPassword
 *               - newPassword
 *             properties:
 *               currentPassword:
 *                 type: string
 *                 description: Mật khẩu hiện tại
 *               newPassword:
 *                 type: string
 *                 description: Mật khẩu mới
 *     responses:
 *       200:
 *         description: Đổi mật khẩu thành công
 *       400:
 *         description: Mật khẩu hiện tại không đúng
 *       401:
 *         description: Không có quyền truy cập
 */
router.post('/change-password', auth, async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;

    // Validate input
    if (!currentPassword || !newPassword) {
      return res.status(400).json({ 
        message: 'Vui lòng nhập đầy đủ mật khẩu hiện tại và mật khẩu mới' 
      });
    }

    // Validate độ dài mật khẩu mới
    if (newPassword.length < 6) {
      return res.status(400).json({
        message: 'Mật khẩu mới phải có ít nhất 6 ký tự'
      });
    }

    // Tìm user hiện tại
    const user = await User.findById(req.user._id);
    if (!user) {
      return res.status(404).json({ message: 'Không tìm thấy người dùng' });
    }

    // Kiểm tra mật khẩu hiện tại
    const isMatch = await bcrypt.compare(currentPassword, user.password);
    if (!isMatch) {
      return res.status(400).json({ message: 'Mật khẩu hiện tại không đúng' });
    }

    // Hash mật khẩu mới
    const salt = await bcrypt.genSalt(10);
    user.password = await bcrypt.hash(newPassword, salt);

    // Lưu vào database
    await user.save();

    res.json({ message: 'Đổi mật khẩu thành công' });

  } catch (error) {
    res.status(500).json({ 
      message: 'Lỗi khi đổi mật khẩu',
      error: error.message 
    });
  }
});

module.exports = router; 