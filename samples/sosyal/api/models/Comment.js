const mongoose = require('mongoose');
const { Schema } = mongoose;

const ReactionSchema = new Schema({
  user: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  kind: { type: String, enum: ['like', 'love', 'laugh'] },
  at: { type: Date, default: Date.now },
}, { _id: false });

const CommentSchema = new Schema({
  post: { type: Schema.Types.ObjectId, ref: 'Post', required: true, index: true },
  author: { type: Schema.Types.ObjectId, ref: 'User', required: [true, 'yorum yazarı gerekli'] },
  parent: { type: Schema.Types.ObjectId, ref: 'Comment' },
  text: { type: String, required: true, maxlength: 2000 },
  reactions: [ReactionSchema],
  mentions: [{ type: Schema.Types.ObjectId, ref: 'User' }],
  deleted: { type: Boolean, default: false },
}, { timestamps: true });

CommentSchema.index({ post: 1, createdAt: -1 });
CommentSchema.methods.softDelete = function () { this.deleted = true; return this.save(); };

module.exports = mongoose.model('Comment', CommentSchema);
