const { mongoose } = require('../db/mongo');

const ThresholdSchema = new mongoose.Schema(
  {
    key: { type: String, required: true, unique: true, index: true },
    temperatureLow: { type: Number, required: true },
    temperatureCriticalLow: { type: Number, required: true },
    temperatureHigh: { type: Number, required: true },
    temperatureCriticalHigh: { type: Number, required: true },
    humidityLow: { type: Number, required: true },
    humidityHigh: { type: Number, required: true },
  },
  { timestamps: true, collection: 'thresholds' }
);

module.exports = mongoose.model('Threshold', ThresholdSchema);