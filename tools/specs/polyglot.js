/*
 * Çok veritabanlı (polyglot) e-ticaret: her servis kendi veritabanında.
 *   siparis-servisi/   MySQL       sipariş, ödeme, kargo
 *   katalog-servisi/   MongoDB     ürün kataloğu ($jsonSchema)
 *   analitik/          PostgreSQL  yıldız şema (raporlama)
 * Klasörler ayrı veritabanı (galaksi) olarak çizilir; veritabanları arasında FK olamaz.
 */
'use strict';

const ORDERS = `
customers | | id pk ai; email:str(190) nn uq; full_name:str(150) nn; phone
addresses | | id pk ai; customer_id nn >customers; city:str(60) nn; line:str(255) nn
orders | | id pk ai; order_no:str(20) nn uq; customer_id nn >customers; address_id nn >addresses; status:enum nn; total:money nn; placed_at nn
order_lines | Ürün bilgisi katalog servisinden; product_id burada yalnızca bir başvuru | id pk ai; order_id nn >orders; product_id:str(24) nn; sku:str(64) nn; quantity nn; unit_price:money nn
payments | | id pk ai; order_id nn >orders; provider:str(30) nn; amount nn; status:enum nn; paid_at
shipments | | id pk ai; order_id nn >orders; carrier:str(40) nn; tracking_no:str(40); shipped_at; delivered_at
outbox_events | Diğer servislere yayınlanacak olaylar | id:bigint pk ai; aggregate:str(40) nn; aggregate_id nn; event_type:str(60) nn; payload:json nn; published_at
`;

const CATALOG = `// mongosh katalog-servisi/validators.js
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
`;

const ANALYTICS = `
dw.dim_date | | date_key:int pk; full_date:date nn uq; year:smallint nn; month:smallint nn; day:smallint nn; is_holiday:bool nn
dw.dim_customer | Müşteri boyutu (SCD-2) | customer_key pk; customer_id nn; city:str(60); segment:str(20); valid_from:date nn; valid_to:date; is_current:bool nn
dw.dim_product | | product_key pk; product_ref:str(24) nn; sku:str(64) nn; title:str(255); category:str(150); brand:str(150)
dw.dim_channel | | channel_key:int pk; name:str(40) nn
dw.fact_sales | Satış olgusu | date_key:int nn >dim_date; customer_key nn >dim_customer; product_key nn >dim_product; channel_key:int >dim_channel; order_no:str(20) nn; quantity nn; revenue:money nn; discount:money
dw.fact_shipments | | date_key:int nn >dim_date; customer_key nn >dim_customer; carrier:str(40); delivery_days:int; on_time:bool
dw.fact_reviews | | date_key:int nn >dim_date; product_key nn >dim_product; rating:smallint nn
etl.load_runs | | id:bigint pk ai; source:str(40) nn; started_at nn; finished_at; rows_loaded:bigint; status:str(20) nn
`;

module.exports = {
  id: 'polyglot',
  title: 'Çok veritabanlı e-ticaret',
  sector: 'E-ticaret',
  dialect: 'MySQL + MongoDB + PostgreSQL',
  scenario: 'Mikroservis mimarisi: her klasör ayrı bir veritabanı (galaksi). Sipariş MySQL\'de, katalog MongoDB\'de, raporlama PostgreSQL yıldız şemasında.',
  en: { title: 'Polyglot e-commerce', sector: 'E-commerce', scenario: 'Microservices: each folder is a separate database (galaxy). Orders in MySQL, catalog in MongoDB, reporting in a PostgreSQL star schema.' },
  separate: true,
  build(lib) {
    const orders = lib.parseSpec(ORDERS);
    lib.addAudit(orders, [{ name: 'created_at', type: 'ts', nn: true, def: 'CURRENT_TIMESTAMP' }], x => x.name === 'outbox_events');
    return {
      'siparis-servisi/schema.sql': lib.emitMysql(orders, { db: 'orders' }),
      'katalog-servisi/validators.js': CATALOG,
      'analitik/schema.sql': lib.emitPostgresDump(lib.parseSpec(ANALYTICS), { owner: 'analytics' }),
    };
  },
};
