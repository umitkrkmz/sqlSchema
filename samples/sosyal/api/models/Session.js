const mongoose = require('mongoose');

module.exports = mongoose.model('Session', new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  refreshTokenHash: { type: String, required: true },
  device: { platform: String, appVersion: String, pushToken: String },
  ip: String,
  lastSeenAt: Date,
  revokedAt: Date,
}, { timestamps: true }));
