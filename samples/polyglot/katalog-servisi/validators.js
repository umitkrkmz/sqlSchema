// mongosh katalog-servisi/validators.js
use('catalog');

db.createCollection('categories', { validator: { $jsonSchema: { bsonType: 'object', required: ['name', 'slug'], properties: {
  name: { bsonType: 'string' }, slug: { bsonType: 'string' }, parentId: { bsonType: ['objectId', 'null'] }, path: { bsonType: 'array', items: { bsonType: 'string' } },
} } } });

db.createCollection('brands', { validator: { $jsonSchema: { bsonType: 'object', required: ['name'], properties: { name: { bsonType: 'string' }, logoUrl: { bsonType: 'string' } } } } });

db.createCollection('products', { validator: { $jsonSchema: {
  bsonType: 'object',
  required: ['title', 'categoryId', 'variants'],
  properties: {
    title: { bsonType: 'string' },
    categoryId: { bsonType: 'objectId' },
    brandId: { bsonType: 'objectId' },
    description: { bsonType: 'string' },
    attributes: { bsonType: 'object', description: 'Kategoriye göre değişen serbest özellikler' },
    variants: { bsonType: 'array', items: { bsonType: 'object', required: ['sku', 'price'], properties: {
      sku: { bsonType: 'string' }, price: { bsonType: 'decimal' }, currency: { bsonType: 'string' }, stock: { bsonType: 'int' },
      options: { bsonType: 'object', properties: { color: { bsonType: 'string' }, size: { bsonType: 'string' } } },
    } } },
    images: { bsonType: 'array', items: { bsonType: 'object', properties: { url: { bsonType: 'string' }, alt: { bsonType: 'string' } } } },
    seo: { bsonType: 'object', properties: { metaTitle: { bsonType: 'string' }, metaDescription: { bsonType: 'string' } } },
  },
} } });

db.createCollection('reviews', { validator: { $jsonSchema: { bsonType: 'object', required: ['productId', 'rating'], properties: {
  productId: { bsonType: 'objectId' }, customerRef: { bsonType: 'long', description: 'Sipariş servisindeki customers.id' }, rating: { bsonType: 'int' }, body: { bsonType: 'string' },
} } } });

db.createCollection('price_history', { validator: { $jsonSchema: { bsonType: 'object', properties: {
  productId: { bsonType: 'objectId' }, sku: { bsonType: 'string' }, price: { bsonType: 'decimal' }, validFrom: { bsonType: 'date' },
} } } });

db.products.createIndex({ 'variants.sku': 1 }, { unique: true });
