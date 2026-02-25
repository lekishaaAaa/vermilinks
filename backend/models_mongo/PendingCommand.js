const { mongoose } = require('../db/mongo');

const PendingCommandSchema = new mongoose.Schema(
  {
    requestId: { type: String, required: true, unique: true, index: true },
    deviceId: { type: String, required: true, index: true },
    desiredState: { type: mongoose.Schema.Types.Mixed, required: true },
    status: { type: String, required: true, index: true },
    responseState: { type: mongoose.Schema.Types.Mixed, default: null },
    error: { type: String, default: null },
    ackAt: { type: Date, default: null },
  },
  { timestamps: true, collection: 'pending_commands' }
);

PendingCommandSchema.index({ deviceId: 1, status: 1 });

module.exports = mongoose.model('PendingCommand', PendingCommandSchema);
