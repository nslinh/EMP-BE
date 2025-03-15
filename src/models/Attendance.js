const mongoose = require('mongoose');

const attendanceSchema = new mongoose.Schema({
  employeeId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Employee',
    required: true
  },
  date: {
    type: Date,
    required: true
  },
  checkIn: {
    type: Date,
    required: true
  },
  standardCheckIn: {
    type: Date,
    required: true
  },
  checkOut: {
    type: Date
  },
  lateMinutes: {
    type: Number,
    default: 0
  },
  workingHours: {
    type: Number,
    default: 0
  },
  overtime: {
    type: Number, // Số giờ làm thêm
    default: 0
  },
  status: {
    type: String,
    enum: ['present', 'absent', 'leave', 'holiday'],
    default: 'present'
  },
  note: String
}, {
  timestamps: true
});

// Index cho hiệu suất query
attendanceSchema.index({ employeeId: 1, date: 1 }, { unique: true });

const Attendance = mongoose.model('Attendance', attendanceSchema);
module.exports = Attendance; 