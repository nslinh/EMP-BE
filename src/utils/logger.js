const winston = require('winston');

// Định nghĩa format log
const logFormat = winston.format.combine(
  winston.format.timestamp(),
  winston.format.json()
);

// Tạo logger instance
const logger = winston.createLogger({
  level: 'info',
  format: logFormat,
  transports: [
    // Ghi log vào file
    new winston.transports.File({ filename: 'error.log', level: 'error' }),
    new winston.transports.File({ filename: 'combined.log' }),
    // Log ra console trong môi trường development
    ...(process.env.NODE_ENV !== 'production' 
      ? [new winston.transports.Console({
          format: winston.format.simple(),
        })]
      : [])
  ],
});

// Hàm helper để log error
const logError = (error, additionalInfo = {}) => {
  logger.error({
    message: error.message,
    stack: error.stack,
    ...additionalInfo
  });
};

// Hàm helper để log info
const logInfo = (message, additionalInfo = {}) => {
  logger.info({
    message,
    ...additionalInfo
  });
};

module.exports = {
  logger,
  logError,
  logInfo
};
