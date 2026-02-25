const { mongoose } = require('../db/mongo');

const TelemetrySchema = new mongoose.Schema(
  {
    deviceId: { type: String, required: true, index: true },
    tempC: { type: Number, default: null },
    humidity: { type: Number, default: null },
    soil: { type: Number, default: null },
    waterTempC: { type: Number, default: null },
    ts: { type: Date, required: true, index: true },
    raw: { type: mongoose.Schema.Types.Mixed, default: null },
  },
  { timestamps: true, collection: 'telemetry' }
);

TelemetrySchema.index({ deviceId: 1, ts: -1 });

module.exports = mongoose.model('Telemetry', TelemetrySchema);
