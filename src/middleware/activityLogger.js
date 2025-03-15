const ActivityLog = require('../models/ActivityLog');

const activityLogger = (action, entityType) => {
  return async (req, res, oldResponse) => {
    try {
      const log = new ActivityLog({
        userId: req.user._id,
        action,
        entityType,
        entityId: req.params.id || req.body._id,
        details: {
          before: req.originalBody,
          after: req.body,
          changes: req.changes
        },
        ipAddress: req.ip,
        userAgent: req.get('user-agent')
      });

      await log.save();
    } catch (error) {
      console.error('Activity logging error:', error);
    }
  };
};

module.exports = activityLogger; 