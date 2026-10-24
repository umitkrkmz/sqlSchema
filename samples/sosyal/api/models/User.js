// Kullanıcı şeması mongo/validators.js'te; burada yalnızca model kaydı ve yardımcılar var
const mongoose = require('mongoose');
const UserSchema = new mongoose.Schema({
  handle: { type: String, required: true, unique: true },
  email: { type: String, required: true, unique: true },
  blockedUsers: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
}, { strict: false, timestamps: true });
UserSchema.virtual('url').get(function () { return '/@' + this.handle; });
module.exports = mongoose.model('User', UserSchema);
