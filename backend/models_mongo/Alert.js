const { mongoose } = require('../db/mongo');

const AlertSchema = new mongoose.Schema(
  {
    deviceId: { type: String, default: null, index: true },
    type: { type: String, required: true, index: true },
    level: { type: String, required: true, index: true },
    message: { type: String, required: true },
    active: { type: Boolean, default: true, index: true },
    acknowledged: { type: Boolean, default: false, index: true },
    signature: { type: String, required: true, index: true },
    lastSeen: { type: Date, default: null },
    clearedAt: { type: Date, default: null },
  },
  { timestamps: true, collection: 'alerts' }
);

AlertSchema.index({ signature: 1, active: 1 });

module.exports = mongoose.model('Alert', AlertSchema);
