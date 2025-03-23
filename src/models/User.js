const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const userSchema = new mongoose.Schema({
  email: {
    type: String,
    required: true,
    unique: true,
    trim: true,
    lowercase: true
  },
  password: {
    type: String,
    required: true,
    minlength: 6
  },
  role: {
    type: String,
    enum: ['admin', 'employee'],
    default: 'employee'
  },
  isActive: {
    type: Boolean,
    default: true
  },
  avatarUrl: {
    type: String,
    default: null
  },
}, {
  timestamps: true,
  toJSON: { virtuals: true },
  toObject: { virtuals: true }
});

// Virtual field để lấy thông tin employee
userSchema.virtual('employeeInfo', {
  ref: 'Employee',
  localField: '_id',
  foreignField: 'userId',
  justOne: true
});

// Hash mật khẩu trước khi lưu
userSchema.pre('save', async function(next) {
  if (this.isModified('password')) {
    this.password = await bcrypt.hash(this.password, 8);
  }
  next();
});

// Phương thức so sánh mật khẩu
userSchema.methods.comparePassword = async function(password) {
  return bcrypt.compare(password, this.password);
};

// Phương thức lấy thông tin public của user
userSchema.methods.toPublicJSON = function() {
  const userObject = this.toObject();
  delete userObject.password;
  return userObject;
};

// Middleware xóa employee khi xóa user
userSchema.pre('remove', async function(next) {
  await this.model('Employee').deleteOne({ userId: this._id });
  next();
});

module.exports = mongoose.model('User', userSchema); 