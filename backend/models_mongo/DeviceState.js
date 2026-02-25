const { mongoose } = require('../db/mongo');

const DeviceStateSchema = new mongoose.Schema(
  {
    deviceId: { type: String, required: true, index: true },
    pump: { type: Boolean, default: false },
    valve1: { type: Boolean, default: false },
    valve2: { type: Boolean, default: false },
    valve3: { type: Boolean, default: false },
    float: { type: String, default: null },
    requestId: { type: String, default: null },
    source: { type: String, default: null },
    ts: { type: Date, default: null },
    online: { type: Boolean, default: false },
    lastSeen: { type: Date, default: null },
  },
  { timestamps: true, collection: 'device_state' }
);

DeviceStateSchema.index({ deviceId: 1 });

module.exports = mongoose.model('DeviceState', DeviceStateSchema);
