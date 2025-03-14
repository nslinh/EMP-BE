const errorHandler = (err, req, res, next) => {
  console.error(err.stack);

  // MongoDB Duplicate Key Error
  if (err.code === 11000) {
    return res.status(400).json({
      status: 'error',
      message: 'Duplicate key error',
      detail: err.message
    });
  }

  // MongoDB Validation Error
  if (err.name === 'ValidationError') {
    return res.status(400).json({
      status: 'error',
      message: 'Validation error',
      detail: Object.values(err.errors).map(error => error.message)
    });
  }

  // MongoDB Cast Error
  if (err.name === 'CastError') {
    return res.status(400).json({
      status: 'error',
      message: 'Invalid data format',
      detail: err.message
    });
  }

  // Default Error
  return res.status(err.status || 500).json({
    status: 'error',
    message: err.message || 'Internal server error'
  });
};

module.exports = errorHandler;
