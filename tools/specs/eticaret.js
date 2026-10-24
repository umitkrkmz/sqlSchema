/*
 * Pazaryeri e-ticaret — MySQL 8, `mysqldump --no-data` çıktısı.
 * Rails/Laravel tarzı adlandırma: çoğul tablo adları, her tabloda `id`, başvurular `<tekil>_id`.
 * Arama ve gösterim kayıtları yüksek hacimli olduğu için FK'siz; bağlantı adlardan tahmin edilir.
 */
'use strict';

const SPEC = `
users | Alıcı ve satıcıların oturum hesabı | id pk ai; email:str(190) nn uq; password_hash:str(255) nn; full_name:str(150); phone; is_seller:bool nn; email_verified_at; last_login_at; status:enum nn
addresses | | id pk ai; user_id nn >users; title:str(50); full_name:str(150) nn; phone nn; city:str(60) nn; district:str(60) nn; line:str(255) nn; postal_code:str(10); is_default:bool nn
sellers | Pazaryerinde satış yapan firmalar | id pk ai; user_id nn uq >users; company_name:str(200) nn; tax_no:str(11) nn uq; iban:str(34); commission_rate:dec(5,2) nn; rating:dec(3,2); approved_at
stores | Satıcı mağazası (vitrin) | id pk ai; seller_id nn >sellers; name:str(150) nn; slug:str(160) nn uq; logo_url
categories | Kategori ağacı | id pk ai; parent_id >categories; name:str(150) nn; slug:str(160) nn uq; depth:int nn; commission_rate:dec(5,2)
brands | | id pk ai; name:str(150) nn uq; slug:str(160) nn uq
products | | id pk ai; seller_id nn >sellers; store_id >stores; category_id nn >categories; brand_id >brands; title:str(255) nn; slug:str(270) nn uq; description:text; status:enum nn
product_variants | Satılabilir stok birimi (SKU) | id pk ai; product_id nn >products; sku:str(64) nn uq; barcode:str(32); price:money nn; list_price:money; currency:char(3) nn; weight_grams:int
product_images | | id pk ai; product_id nn >products; variant_id >product_variants; url nn; position:int nn
attributes | Kategoriye özgü özellikler (renk, beden...) | id pk ai; category_id >categories; name:str(100) nn; input_type:str(20) nn
attribute_values | | id pk ai; attribute_id nn >attributes; value:str(150) nn
variant_attribute_values | | variant_id pk >product_variants; attribute_value_id pk >attribute_values
warehouses | | id pk ai; seller_id >sellers; name:str(100) nn; city:str(60)
inventory | | id pk ai; variant_id nn >product_variants; warehouse_id nn >warehouses; quantity nn; reserved:int nn
carts | | id pk ai; user_id >users; session_token:str(64)
cart_items | | id pk ai; cart_id nn >carts; variant_id nn >product_variants; quantity nn
wishlists | | id pk ai; user_id nn >users; name:str(100)
wishlist_items | | wishlist_id pk >wishlists; product_id pk >products
campaigns | | id pk ai; name:str(150) nn; starts_at nn; ends_at; budget
coupons | | id pk ai; code:str(40) nn uq; campaign_id >campaigns; discount_type:enum nn; discount_value:money nn; min_basket:money; starts_at; ends_at; usage_limit:int
orders | Sipariş başlığı | id pk ai; order_no:str(20) nn uq; user_id nn >users; shipping_address_id nn >addresses; billing_address_id >addresses; status:enum nn; subtotal:money nn; discount_total:money nn; shipping_total:money nn; grand_total:money nn; currency:char(3) nn; coupon_id >coupons; placed_at nn
order_items | Satıcı bazında sipariş kalemleri | id pk ai; order_id nn >orders; variant_id nn >product_variants; seller_id nn >sellers; quantity nn; unit_price:money nn; commission_amount:money
order_status_history | | id pk ai; order_id nn >orders; from_status:str(20); to_status:str(20) nn; changed_at nn; changed_by_user_id >users
payments | | id pk ai; order_id nn >orders; provider:str(30) nn; amount nn; status:enum nn; installment_count:int; paid_at
payment_transactions | Ödeme kuruluşu çağrıları | id pk ai; payment_id nn >payments; type:str(20) nn; provider_ref:str(64); amount nn; raw_response:json
refunds | | id pk ai; payment_id nn >payments; order_item_id >order_items; amount nn; reason:str(255); refunded_at
carriers | Kargo firmaları | id pk ai; name:str(100) nn; api_code:str(30) nn uq
shipments | | id pk ai; order_id nn >orders; seller_id nn >sellers; carrier_id nn >carriers; tracking_no:str(40); shipped_at; delivered_at
shipment_items | | shipment_id pk >shipments; order_item_id pk >order_items; quantity nn
coupon_redemptions | | id pk ai; coupon_id nn >coupons; user_id nn >users; order_id >orders; redeemed_at nn
reviews | Ürün değerlendirmesi (yalnızca satın alanlar) | id pk ai; product_id nn >products; user_id nn >users; order_item_id uq >order_items; rating:int nn; title:str(150); body:text; status:enum nn
review_votes | | review_id pk >reviews; user_id pk >users; is_helpful:bool nn
questions | Ürün soruları | id pk ai; product_id nn >products; user_id nn >users; body:text nn; asked_at nn
answers | | id pk ai; question_id nn >questions; seller_id >sellers; body:text nn; answered_at nn
returns | İade talebi | id pk ai; order_id nn >orders; reason:str(255) nn; status:enum nn; requested_at nn
return_items | | return_id pk >returns; order_item_id pk >order_items; quantity nn
seller_payouts | Satıcı hakedişi | id pk ai; seller_id nn >sellers; period_start:date nn; period_end:date nn; gross_amount nn; commission_amount nn; net_amount nn; paid_at
notifications | | id pk ai; user_id nn >users; type:str(40) nn; payload:json; read_at
search_logs | Arama kayıtları; yüksek hacim, FK yok | id:bigint pk ai; user_id; query:str(255) nn; result_count:int; searched_at nn
product_views | Ürün gösterimleri; FK yok | id:bigint pk ai; product_id; user_id; session_token:str(64); viewed_at nn
`;

const TAIL = `
--
-- Dumping routines for database 'pazaryeri'
--
DELIMITER ;;
CREATE DEFINER=\`app\`@\`%\` PROCEDURE \`close_expired_carts\`()
BEGIN
  DELETE ci FROM cart_items ci JOIN carts c ON c.id = ci.cart_id WHERE c.updated_at < NOW() - INTERVAL 30 DAY;
  DELETE FROM carts WHERE updated_at < NOW() - INTERVAL 30 DAY;
END ;;
DELIMITER ;
`;

module.exports = {
  id: 'eticaret',
  title: 'Pazaryeri e-ticaret',
  sector: 'E-ticaret',
  dialect: 'MySQL',
  scenario: 'mysqldump --no-data çıktısı: backtick\'li adlar, satır içi FK\'ler, DELIMITER\'lı yordam; arama ve gösterim tabloları FK\'siz.',
  en: { title: 'Marketplace e-commerce', sector: 'E-commerce', scenario: 'mysqldump --no-data output: backtick names, inline FKs, a DELIMITER procedure; search and view logs without FKs.' },
  build(lib) {
    const t = lib.parseSpec(SPEC);
    lib.addAudit(t, [{ name: 'created_at', type: 'ts', nn: true, def: 'CURRENT_TIMESTAMP' }, { name: 'updated_at', type: 'ts', def: 'CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP' }], x => /_logs$|_views$|_votes$|_attribute_values$|_items$/.test(x.name) && x.pk.length > 1);
    return { 'pazaryeri_schema.sql': lib.emitMysql(t, { db: 'pazaryeri' }).replace('-- Dump completed', TAIL.trim() + '\n\n-- Dump completed') };
  },
};
