/*
 * Sosyal medya — MongoDB. Üç kaynak birlikte:
 *   mongo/validators.js     mongosh ile $jsonSchema doğrulayıcıları ve benzersiz indeksler
 *   api/models/*.js         Node.js servisindeki Mongoose modelleri (ref ile tanımlı ilişkiler)
 *   exports/*.json          mongoexport çıktıları: doğrulayıcısı olmayan koleksiyonlar örnek belgelerden çıkarılır
 * Aynı koleksiyon birden fazla kaynakta geçiyorsa tek tabloda birleşir.
 */
'use strict';

const VALIDATORS = `// mongosh mongo/validators.js
use('sosyal');

db.createCollection('users', {
  validator: {
    $jsonSchema: {
      bsonType: 'object',
      required: ['handle', 'email', 'createdAt'],
      properties: {
        _id: { bsonType: 'objectId' },
        handle: { bsonType: 'string', description: 'Benzersiz kullanıcı adı, @ olmadan' },
        email: { bsonType: 'string' },
        phone: { bsonType: ['string', 'null'] },
        displayName: { bsonType: 'string' },
        profile: {
          bsonType: 'object',
          properties: {
            bio: { bsonType: 'string' },
            avatarUrl: { bsonType: 'string' },
            birthDate: { bsonType: 'date' },
            links: {
              bsonType: 'array',
              items: { bsonType: 'object', required: ['url'], properties: { label: { bsonType: 'string' }, url: { bsonType: 'string' } } },
            },
          },
        },
        settings: {
          bsonType: 'object',
          properties: {
            privateAccount: { bsonType: 'bool' },
            language: { enum: ['tr', 'en', 'de'] },
            notificationPrefs: { bsonType: 'object' },
          },
        },
        followerCount: { bsonType: 'int' },
        followingCount: { bsonType: 'int' },
        status: { enum: ['active', 'suspended', 'deleted'] },
        createdAt: { bsonType: 'date' },
      },
    },
  },
});

db.createCollection('posts', {
  validator: {
    $jsonSchema: {
      bsonType: 'object',
      required: ['userId', 'createdAt', 'visibility'],
      properties: {
        userId: { bsonType: 'objectId', description: 'Gönderiyi yazan kullanıcı' },
        text: { bsonType: 'string' },
        media: {
          bsonType: 'array',
          items: { bsonType: 'object', properties: { mediaId: { bsonType: 'objectId' }, kind: { enum: ['image', 'video', 'gif'] }, width: { bsonType: 'int' }, height: { bsonType: 'int' } } },
        },
        hashtagIds: { bsonType: 'array', items: { bsonType: 'objectId' } },
        mentionUserIds: { bsonType: 'array', items: { bsonType: 'objectId' } },
        replyToPostId: { bsonType: ['objectId', 'null'] },
        repostOfPostId: { bsonType: ['objectId', 'null'] },
        visibility: { enum: ['public', 'followers', 'circle'] },
        stats: { bsonType: 'object', properties: { likes: { bsonType: 'int' }, replies: { bsonType: 'int' }, reposts: { bsonType: 'int' }, views: { bsonType: 'long' } } },
        createdAt: { bsonType: 'date' },
        editedAt: { bsonType: 'date' },
      },
    },
  },
});

db.createCollection('follows', {
  validator: { $jsonSchema: { bsonType: 'object', required: ['followerId', 'followeeId', 'since'], properties: {
    followerId: { bsonType: 'objectId' }, followeeId: { bsonType: 'objectId' }, since: { bsonType: 'date' }, muted: { bsonType: 'bool' },
  } } },
});

db.createCollection('likes', {
  validator: { $jsonSchema: { bsonType: 'object', required: ['userId', 'postId'], properties: {
    userId: { bsonType: 'objectId' }, postId: { bsonType: 'objectId' }, reaction: { enum: ['like', 'love', 'laugh', 'sad'] }, createdAt: { bsonType: 'date' },
  } } },
});

db.createCollection('hashtags', {
  validator: { $jsonSchema: { bsonType: 'object', required: ['tag'], properties: {
    tag: { bsonType: 'string' }, postCount: { bsonType: 'long' }, trendingScore: { bsonType: 'double' },
  } } },
});

db.createCollection('media', {
  validator: { $jsonSchema: { bsonType: 'object', required: ['ownerId', 'storageKey'], properties: {
    ownerId: { bsonType: 'objectId' }, storageKey: { bsonType: 'string' }, mimeType: { bsonType: 'string' }, bytes: { bsonType: 'long' },
    variants: { bsonType: 'array', items: { bsonType: 'object', properties: { size: { bsonType: 'string' }, url: { bsonType: 'string' } } } },
    moderation: { bsonType: 'object', properties: { status: { enum: ['pending', 'approved', 'rejected'] }, labels: { bsonType: 'array', items: { bsonType: 'string' } } } },
  } } },
});

db.createCollection('conversations', {
  validator: { $jsonSchema: { bsonType: 'object', required: ['participantIds'], properties: {
    participantIds: { bsonType: 'array', items: { bsonType: 'objectId' } },
    isGroup: { bsonType: 'bool' }, title: { bsonType: 'string' }, lastMessageAt: { bsonType: 'date' },
  } } },
});

db.createCollection('messages', {
  validator: { $jsonSchema: { bsonType: 'object', required: ['conversationId', 'senderId', 'sentAt'], properties: {
    conversationId: { bsonType: 'objectId' }, senderId: { bsonType: 'objectId' }, body: { bsonType: 'string' },
    attachments: { bsonType: 'array', items: { bsonType: 'object', properties: { mediaId: { bsonType: 'objectId' }, caption: { bsonType: 'string' } } } },
    readBy: { bsonType: 'array', items: { bsonType: 'object', properties: { userId: { bsonType: 'objectId' }, readAt: { bsonType: 'date' } } } },
    sentAt: { bsonType: 'date' },
  } } },
});

db.createCollection('notifications');
db.runCommand({
  collMod: 'notifications',
  validator: { $jsonSchema: { bsonType: 'object', required: ['userId', 'type'], properties: {
    userId: { bsonType: 'objectId' }, actorUserId: { bsonType: 'objectId' }, postId: { bsonType: 'objectId' },
    type: { enum: ['like', 'follow', 'mention', 'reply', 'repost'] }, seen: { bsonType: 'bool' }, createdAt: { bsonType: 'date' },
  } } },
  validationLevel: 'moderate',
});

db.createCollection('reports', {
  validator: { $jsonSchema: { bsonType: 'object', required: ['reporterId', 'targetType', 'targetId'], properties: {
    reporterId: { bsonType: 'objectId' }, targetType: { enum: ['post', 'user', 'message'] }, targetId: { bsonType: 'objectId' },
    reason: { bsonType: 'string' }, resolvedById: { bsonType: 'objectId' }, resolution: { bsonType: 'string' },
  } } },
});

db.users.createIndex({ handle: 1 }, { unique: true });
db.users.createIndex({ email: 1 }, { unique: true });
db.follows.createIndex({ followerId: 1, followeeId: 1 }, { unique: true });
db.likes.createIndex({ userId: 1, postId: 1 }, { unique: true });
db.hashtags.createIndex({ tag: 1 }, { unique: true });
db.getCollection('posts').createIndex({ userId: 1, createdAt: -1 });
`;

const MODELS = {
  'Comment.js': `const mongoose = require('mongoose');
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
`,
  'Story.js': `const mongoose = require('mongoose');

const storySchema = new mongoose.Schema({
  author: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  media: { type: mongoose.Schema.Types.ObjectId, ref: 'Media', required: true },
  audience: { type: String, enum: ['public', 'closeFriends'], default: 'public' },
  viewers: [{
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    viewedAt: Date,
  }],
  expiresAt: { type: Date, required: true },
}, { timestamps: true });

storySchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

module.exports = mongoose.model('Story', storySchema, 'stories');
`,
  'Group.js': `const mongoose = require('mongoose');
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
`,
  'Session.js': `const mongoose = require('mongoose');

module.exports = mongoose.model('Session', new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  refreshTokenHash: { type: String, required: true },
  device: { platform: String, appVersion: String, pushToken: String },
  ip: String,
  lastSeenAt: Date,
  revokedAt: Date,
}, { timestamps: true }));
`,
  'User.js': `// Kullanıcı şeması mongo/validators.js'te; burada yalnızca model kaydı ve yardımcılar var
const mongoose = require('mongoose');
const UserSchema = new mongoose.Schema({
  handle: { type: String, required: true, unique: true },
  email: { type: String, required: true, unique: true },
  blockedUsers: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
}, { strict: false, timestamps: true });
UserSchema.virtual('url').get(function () { return '/@' + this.handle; });
module.exports = mongoose.model('User', UserSchema);
`,
};

const oid = n => ({ $oid: (n.toString(16) + 'a'.repeat(24)).slice(0, 24) });
const date = d => ({ $date: d });

const EVENTS = [
  { _id: oid(1), userId: oid(101), type: 'post_view', postId: oid(201), ts: date('2026-10-20T10:00:00Z'), client: { platform: 'ios', appVersion: '7.4.0' }, durationMs: 5300 },
  { _id: oid(2), userId: oid(102), type: 'search', query: 'deprem', ts: date('2026-10-20T10:00:03Z'), client: { platform: 'web' } },
  { _id: oid(3), userId: oid(101), type: 'like', postId: oid(203), ts: date('2026-10-20T10:01:11Z'), client: { platform: 'ios', appVersion: '7.4.0' } },
  { _id: oid(4), type: 'post_view', postId: oid(201), ts: date('2026-10-20T10:02:00Z'), client: { platform: 'android', appVersion: '7.3.9' }, durationMs: 1200, experimentIds: ['feed_v2', 'ads_slot'] },
  { _id: oid(5), userId: oid(104), type: 'share', postId: oid(202), ts: date('2026-10-20T10:03:42Z'), client: { platform: 'android', appVersion: '7.4.0' }, target: 'whatsapp' },
];

const AD_IMPRESSIONS = [
  { _id: oid(11), campaignId: oid(301), userId: oid(101), placement: 'feed', shownAt: date('2026-10-20T09:00:00Z'), cost: { $numberDecimal: '0.0042' }, clicked: false },
  { _id: oid(12), campaignId: oid(302), userId: oid(103), placement: 'story', shownAt: date('2026-10-20T09:00:05Z'), cost: { $numberDecimal: '0.0061' }, clicked: true, clickAt: date('2026-10-20T09:00:09Z') },
  { _id: oid(13), campaignId: oid(301), placement: 'feed', shownAt: date('2026-10-20T09:01:00Z'), cost: { $numberDecimal: '0.0042' }, clicked: false },
];

const AD_CAMPAIGNS = [
  { _id: oid(301), advertiserName: 'Örnek Kahve', budget: { daily: 500, currency: 'TRY' }, targeting: { cities: ['İstanbul', 'İzmir'], ageMin: 18, interests: ['kahve', 'kitap'] }, status: 'active', startsAt: date('2026-10-01T00:00:00Z') },
  { _id: oid(302), advertiserName: 'Örnek Spor', budget: { daily: 1200, currency: 'TRY' }, targeting: { ageMin: 16, ageMax: 35 }, status: 'paused', startsAt: date('2026-09-15T00:00:00Z'), endsAt: date('2026-12-31T00:00:00Z') },
];

module.exports = {
  id: 'sosyal',
  title: 'Sosyal medya',
  sector: 'Sosyal ağ',
  dialect: 'MongoDB',
  scenario: '$jsonSchema doğrulayıcıları, Mongoose modelleri (ref) ve mongoexport belgeleri birlikte; gömülü alt belgeler uydu olarak görünür.',
  en: { title: 'Social network', sector: 'Social media', scenario: '$jsonSchema validators, Mongoose models (ref) and mongoexport documents together; embedded sub-documents appear as satellites.' },
  build: () => {
    const files = { 'mongo/validators.js': VALIDATORS };
    for (const [n, src] of Object.entries(MODELS)) files['api/models/' + n] = src;
    files['exports/sosyal.analytics_events.json'] = EVENTS.map(e => JSON.stringify(e)).join('\n') + '\n';
    files['exports/sosyal.ad_impressions.json'] = AD_IMPRESSIONS.map(e => JSON.stringify(e)).join('\n') + '\n';
    files['exports/sosyal.ad_campaigns.json'] = JSON.stringify(AD_CAMPAIGNS, null, 2) + '\n';
    files['api/package.json'] = JSON.stringify({ name: 'sosyal-api', version: '1.0.0', dependencies: { mongoose: '^8.6.0' } }, null, 2) + '\n';
    return files;
  },
};
