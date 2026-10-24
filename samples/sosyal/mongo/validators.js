// mongosh mongo/validators.js
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
