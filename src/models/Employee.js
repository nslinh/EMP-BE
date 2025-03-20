const mongoose = require('mongoose');

const employeeSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    unique: true
  },
  fullName: {
    type: String,
    required: true,
    trim: true
  },
  dateOfBirth: {
    type: Date,
    required: true
  },
  gender: {
    type: String,
    enum: ['male', 'female', 'other'],
    required: true
  },
  address: {
    type: String,
    required: true,
    trim: true
  },
  phoneNumber: {
    type: String,
    required: true,
    trim: true
  },
  department: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Department',
    required: true
  },
  position: {
    type: String,
    required: true,
    trim: true
  },
  salary: {
    type: Number,
    required: true,
    min: 0
  },
  startDate: {
    type: Date,
    required: true
  },
  avatarUrl: {
    type: String,
    default: null
  },
  baseSalary: {
    type: Number,
    required: false
  },
  hourlyRate: {
    type: Number,
    required: false
  },
  overtimeRate: {
    type: Number,
    default: 1.5 // Hệ số lương làm thêm giờ
  }
}, {
  timestamps: true,
  toJSON: { virtuals: true },
  toObject: { virtuals: true }
});

// Index cho tìm kiếm
employeeSchema.index({ fullName: 'text' });
employeeSchema.index({ department: 1 });
employeeSchema.index({ position: 1 });
employeeSchema.index({ salary: 1 });

// Virtual field để lấy thông tin user
employeeSchema.virtual('userInfo', {
  ref: 'User',
  localField: 'userId',
  foreignField: '_id',
  justOne: true
});

// Middleware tự động cập nhật department stats
employeeSchema.post('save', async function() {
  await this.model('Department').updateOne(
    { _id: this.department },
    { $inc: { employeeCount: 1 } }
  );
});

// Format salary
employeeSchema.methods.formatSalary = function() {
  return new Intl.NumberFormat('vi-VN', {
    style: 'currency',
    currency: 'VND'
  }).format(this.salary);
};

// Tính tuổi
employeeSchema.methods.getAge = function() {
  return new Date().getFullYear() - this.dateOfBirth.getFullYear();
};

// Thêm method tính lương
employeeSchema.methods.calculateSalary = async function(month, year) {
  const startDate = new Date(year, month - 1, 1);
  const endDate = new Date(year, month, 0);

  const attendance = await mongoose.model('Attendance').aggregate([
    {
      $match: {
        employeeId: this._id,
        date: { $gte: startDate, $lte: endDate },
        status: 'present'
      }
    },
    {
      $group: {
        _id: null,
        totalWorkingHours: { $sum: '$workingHours' },
        totalOvertimeHours: { $sum: '$overtime' }
      }
    }
  ]);

  const stats = attendance[0] || { totalWorkingHours: 0, totalOvertimeHours: 0 };
  const hourlyRate = this.salary / (8 * 22); // Lương theo giờ = lương cơ bản / (8h * 22 ngày)
  
  const regularPay = stats.totalWorkingHours * hourlyRate;
  const overtimePay = stats.totalOvertimeHours * hourlyRate * 1.5;
  
  return {
    baseSalary: this.salary,
    workingHours: stats.totalWorkingHours,
    overtimeHours: stats.totalOvertimeHours,
    regularPay: Number(regularPay.toFixed(2)),
    overtimePay: Number(overtimePay.toFixed(2)),
    totalSalary: Number((regularPay + overtimePay).toFixed(2))
  };
};

module.exports = mongoose.model('Employee', employeeSchema); 