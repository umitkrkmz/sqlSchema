const mongoose = require('mongoose');
const { Schema, model } = mongoose;

const MemberSchema = new Schema({
  user: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  role: { type: String, enum: ['owner', 'admin', 'member'], default: 'member' },
  joinedAt: { type: Date, default: Date.now },
}, { _id: false });

const GroupSchema = new Schema({
  name: { type: String, required: true, trim: true },
  slug: { type: String, required: true, unique: true },
  description: String,
  coverMedia: { type: Schema.Types.ObjectId, ref: 'Media' },
  members: [MemberSchema],
  pinnedPosts: [{ type: Schema.Types.ObjectId, ref: 'Post' }],
  rules: [String],
  isPrivate: { type: Boolean, default: false },
}, { timestamps: true });

module.exports = model('Group', GroupSchema);
