/*
 * Büyük kurum — 30 modül şemasında 2 900 tablo. Büyük şemada açılış, yerleşim ve gezinme hızını denemek için.
 * Adlar modül önekli (CRM_CUSTOMER, BIL_ACCOUNT, GL_JOURNAL...), büyük kurumsal paketlerdeki gibi.
 * Her modülde ana tablolar ve onlara bağlı satır, geçmiş, tip, durum, özellik, not, günlük ve eşleme (M:N) tabloları.
 * İlişkilerin çoğu modül içinde; bir kısmı modüller arası merkez tablolara (müşteri, hesap, ürün, birim...).
 * Çağrı kaydı, arabuluculuk ve veri ambarı modülleri merkez tablolara FK'siz bağlanır: tahmini ilişki.
 * Üretim deterministiktir: sabit tohumlu sayı üreteci, Math.random yok.
 */
'use strict';

const N_TABLES = 2900;

// [şema, önek, açıklama, çekirdek adlar]
const MODULES = [
  ['CRM', 'CRM', 'Müşteri ilişkileri', ['CUSTOMER', 'CONTACT']],
  ['PARTY', 'PTY', 'Taraf', ['PARTY']],
  ['PRODUCT', 'PRD', 'Ürün kataloğu', ['PRODUCT', 'OFFER']],
  ['ORDERING', 'ORD', 'Sipariş', ['ORDER']],
  ['BILLING', 'BIL', 'Faturalama', ['ACCOUNT', 'BILL']],
  ['PAYMENT', 'PAY', 'Tahsilat', ['PAYMENT']],
  ['RATING', 'RAT', 'Ücretlendirme', ['RATE']],
  ['MEDIATION', 'MED', 'Arabuluculuk', ['RECORD']],
  ['CDR', 'CDR', 'Çağrı kayıtları', ['CALL']],
  ['NETWORK', 'NET', 'Şebeke', ['ELEMENT']],
  ['INVENTORY', 'INV', 'Kaynak envanteri', ['RESOURCE']],
  ['PROVISIONING', 'PRV', 'Hizmet açma', ['TASK']],
  ['SERVICE', 'SVC', 'Hizmet', ['SERVICE']],
  ['TICKET', 'TCK', 'Arıza kaydı', ['TICKET']],
  ['FIELD', 'FLD', 'Saha', ['WORK_ORDER']],
  ['WAREHOUSE', 'WMS', 'Depo', ['WAREHOUSE']],
  ['PROCUREMENT', 'PRC', 'Satınalma', ['VENDOR']],
  ['FINANCE', 'FIN', 'Finans', ['LEDGER']],
  ['GL', 'GL', 'Genel muhasebe', ['JOURNAL']],
  ['AR', 'AR', 'Alacaklar', ['RECEIVABLE']],
  ['AP', 'AP', 'Borçlar', ['INVOICE']],
  ['HR', 'HR', 'İnsan kaynakları', ['EMPLOYEE']],
  ['ORG', 'ORG', 'Organizasyon', ['UNIT']],
  ['PARTNER', 'PTN', 'İş ortakları', ['PARTNER']],
  ['DEALER', 'DLR', 'Bayi', ['DEALER']],
  ['CAMPAIGN', 'CMP', 'Kampanya', ['CAMPAIGN']],
  ['LOYALTY', 'LYL', 'Sadakat', ['MEMBER']],
  ['DOCUMENT', 'DOC', 'Belge', ['DOCUMENT']],
  ['SECURITY', 'SEC', 'Güvenlik', ['APP_USER']],
  ['DWH', 'DWH', 'Veri ambarı', ['FACT']],
];

// modüller arası bağlanan merkez tablolar
const HUBS = ['CRM_CUSTOMER', 'BIL_ACCOUNT', 'PRD_PRODUCT', 'ORG_UNIT', 'HR_EMPLOYEE', 'NET_ELEMENT', 'PTY_PARTY', 'SVC_SERVICE'];
// bu modüller merkez tablolara FK'siz bağlanır (yük tabloları, ambar)
const LOOSE = new Set(['CDR', 'MEDIATION', 'DWH']);

const NOUNS = {
  ACCOUNT: 'Hesap', ADDRESS: 'Adres', AGREEMENT: 'Anlaşma', ALARM: 'Alarm', APP_USER: 'Uygulama kullanıcısı', ASSET: 'Varlık',
  BATCH: 'Toplu iş', BILL: 'Fatura dönemi', BUDGET: 'Bütçe', CALENDAR: 'Takvim', CALL: 'Çağrı', CAMPAIGN: 'Kampanya', CARD: 'Kart',
  CASE: 'Vaka', CATALOG: 'Katalog', CHANNEL: 'Kanal', CHARGE: 'Ücret', CLAIM: 'Hak talebi', CONTACT: 'İletişim kişisi',
  CONTRACT: 'Sözleşme', COUNTER: 'Sayaç', CUSTOMER: 'Müşteri', DEALER: 'Bayi', DEVICE: 'Cihaz', DISCOUNT: 'İndirim',
  DOCUMENT: 'Belge', ELEMENT: 'Şebeke öğesi', EMPLOYEE: 'Çalışan', EVENT: 'Olay', FACT: 'Ölçü kaydı', FEE: 'Harç',
  GROUP: 'Grup', INCIDENT: 'Arıza', INVOICE: 'Fatura', ITEM: 'Kalem', JOB: 'İş', JOURNAL: 'Yevmiye', LEDGER: 'Defter',
  LIMIT: 'Limit', LOCATION: 'Konum', MEMBER: 'Üye', MESSAGE: 'Mesaj', METER: 'Ölçüm', OFFER: 'Teklif', ORDER: 'Sipariş',
  PACKAGE: 'Paket', PARAMETER: 'Parametre', PARTNER: 'İş ortağı', PARTY: 'Taraf', PAYMENT: 'Ödeme', PERIOD: 'Dönem',
  PLAN: 'Plan', POLICY: 'Politika', PORT: 'Port', PRICE: 'Fiyat', PRODUCT: 'Ürün', PROFILE: 'Profil', PROJECT: 'Proje',
  QUOTA: 'Kota', RATE: 'Tarife oranı', RECEIVABLE: 'Alacak', RECORD: 'Ham kayıt', REQUEST: 'İstek', RESOURCE: 'Kaynak',
  ROLE: 'Rol', RULE: 'Kural', SCHEDULE: 'Çizelge', SEGMENT: 'Segment', SERVICE: 'Hizmet', SESSION: 'Oturum', SITE: 'Saha',
  SLOT: 'Yuva', STOCK: 'Stok', TASK: 'Görev', TAX: 'Vergi', TEMPLATE: 'Şablon', TICKET: 'Arıza kaydı', TRANSFER: 'Aktarım',
  UNIT: 'Birim', USAGE: 'Kullanım', VENDOR: 'Tedarikçi', VOUCHER: 'Kupon', WAREHOUSE: 'Depo', WORK_ORDER: 'İş emri', ZONE: 'Bölge',
};
const POOL = Object.keys(NOUNS);

// ana tabloya bağlı tablo türleri: [ek, açıklama eki, olasılık]
const KINDS = [
  ['TYPE', 'tipleri', 0.45], ['STATUS', 'durumları', 0.4], ['LINE', 'satırları', 0.35], ['HIST', 'geçmişi', 0.4],
  ['ATTR', 'özellikleri', 0.25], ['NOTE', 'notları', 0.2], ['LOG', 'günlüğü', 0.2], ['MAP', 'eşlemesi', 0.15],
];

const EXTRA = [
  ['DESCRIPTION', 'str(400)'], ['START_DATE', 'date'], ['END_DATE', 'date'], ['AMOUNT', 'money'], ['CURRENCY_CODE', 'char(3)'],
  ['QUANTITY', 'int'], ['PRIORITY', 'smallint'], ['EXTERNAL_REF', 'str(60)'], ['SOURCE_SYSTEM', 'str(30)'], ['IS_ACTIVE', 'bool'],
  ['VERSION_NO', 'int'], ['VALID_FROM', 'date'], ['VALID_TO', 'date'], ['CHANNEL_CODE', 'str(30)'], ['REGION_CODE', 'str(30)'],
  ['SCORE', 'dec(5,2)'], ['EMAIL', 'str(190)'], ['PHONE', 'str(20)'], ['REMARKS', 'str(400)'], ['EFFECTIVE_DATE', 'date'],
];
const AUDIT = [['CREATED_DATE', 'ts', true], ['CREATED_BY', 'str(30)', true], ['UPDATED_DATE', 'ts'], ['UPDATED_BY', 'str(30)']];

function generate() {
  let seed = 7;
  const rnd = n => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return (seed >>> 12) % n; };
  const chance = p => rnd(1000) < p * 1000;
  const tables = new Map();   // ad → tablo
  const mods = MODULES.map(([schema, prefix, title, core], i) => ({ schema, prefix, title, core, quota: Math.floor(N_TABLES / MODULES.length) + (i < N_TABLES % MODULES.length ? 1 : 0), bases: [], list: [] }));

  // 1. tablolar: önce çekirdek adlar, sonra havuzdan rastgele ana tablolar ve bağlı türleri
  for (const m of mods) {
    const add = (name, kind, base, comment) => {
      if (m.list.length >= m.quota || tables.has(name)) return null;
      const t = { schema: m.schema, name, kind, base, comment, cols: [], pk: [], uq: [], fks: [], mod: m };
      tables.set(name, t);
      m.list.push(t);
      if (kind === 'base') m.bases.push(t);
      return t;
    };
    const grow = noun => {
      const base = add(m.prefix + '_' + noun, 'base', null, NOUNS[noun]);
      if (!base) return;
      for (const [suf, label, p] of KINDS) if (chance(p)) add(base.name + '_' + suf, suf, base, NOUNS[noun] + ' ' + label);
    };
    m.core.forEach(grow);
    for (let guard = 0; m.list.length < m.quota && guard < 2000; guard++) grow(POOL[rnd(POOL.length)]);
    // havuz tükendiyse ana tablolara bağlı türlerden tamamlanır
    for (let i = 0; m.list.length < m.quota; i++) {
      const b = m.bases[i % m.bases.length];
      const [suf, label] = KINDS[Math.floor(i / m.bases.length) % KINDS.length];
      add(b.name + '_' + suf, suf, b, b.comment + ' ' + label);
      if (i > 100000) throw new Error(m.schema + ': kota dolmadı');
    }
  }

  // 2. kolonlar ve ilişkiler
  const col = (t, name, type, nn) => { if (!t.cols.some(c => c.name === name)) t.cols.push({ name, type, nn: !!nn }); };
  const fk = (t, target, nn, role) => {
    const c = (role ? role + '_' : '') + target.name + '_ID';
    if (t.cols.some(x => x.name === c)) return;
    // kolon tipi hedefin PK'siyle aynı (tip / durum tabloları smallint); yoksa her FK tip uyuşmazlığı bulgusu olur
    col(t, c, target.kind === 'TYPE' || target.kind === 'STATUS' ? 'smallint' : 'id', nn);
    t.fks.push({ col: c, ref: target.schema + '.' + target.name });
  };
  const audit = t => AUDIT.forEach(([n, ty, nn]) => col(t, n, ty, nn));
  for (const m of mods) {
    for (const t of m.list) {
      const pk = t.name + '_ID';
      if (t.kind === 'MAP') {
        const other = m.bases[rnd(m.bases.length)];
        fk(t, t.base, true);
        if (other !== t.base) fk(t, other, true); else fk(t, t.base, true, 'RELATED');
        t.pk = t.cols.map(c => c.name);
        col(t, 'VALID_FROM', 'date', true);
        col(t, 'VALID_TO', 'date');
        continue;
      }
      col(t, pk, t.kind === 'TYPE' || t.kind === 'STATUS' ? 'smallint' : 'id', true);
      t.pk = [pk];
      if (t.kind === 'TYPE' || t.kind === 'STATUS') {
        col(t, 'CODE', 'str(30)', true); col(t, 'NAME', 'str(100)', true); col(t, 'DESCRIPTION', 'str(400)');
        col(t, 'IS_ACTIVE', 'bool', true); col(t, 'SORT_ORDER', 'smallint');
        t.uq.push('CODE');
        continue;
      }
      if (t.kind === 'base') {
        col(t, 'CODE', 'str(30)', true); col(t, 'NAME', 'str(100)', true);
        const n = 2 + rnd(8);
        for (let i = 0; i < n; i++) { const [c, ty] = EXTRA[rnd(EXTRA.length)]; col(t, c, ty); }
        const ty = tables.get(t.name + '_TYPE'), st = tables.get(t.name + '_STATUS');
        if (ty) fk(t, ty, true);
        if (st) fk(t, st, true);
        // modül içi: önceki ana tablolardan 0–4 tanesi
        const idx = m.bases.indexOf(t);
        for (let k = 0, nk = idx ? rnd(5) : 0; k < nk; k++) fk(t, m.bases[rnd(idx)], chance(0.5));
        // modüller arası merkez tablo; yük ve ambar modüllerinde FK'siz (tahmini ilişki)
        if (chance(LOOSE.has(m.schema) ? 0.6 : 0.5)) {
          const hub = tables.get(HUBS[rnd(HUBS.length)]);
          if (hub && hub !== t && hub.mod !== m) {
            if (LOOSE.has(m.schema)) col(t, hub.name + '_ID', 'id'); else fk(t, hub, false);
          }
        }
        audit(t);
        continue;
      }
      fk(t, t.base, true);
      if (t.kind === 'LINE') {
        col(t, 'LINE_NO', 'int', true); col(t, 'QUANTITY', 'int'); col(t, 'AMOUNT', 'money');
        if (chance(0.3)) fk(t, tables.get('PRD_PRODUCT'), false);
      } else if (t.kind === 'HIST') {
        col(t, 'VALID_FROM', 'date', true); col(t, 'VALID_TO', 'date'); col(t, 'CHANGE_REASON', 'str(200)'); col(t, 'CHANGED_BY', 'str(30)');
        continue;
      } else if (t.kind === 'ATTR') {
        col(t, 'ATTR_NAME', 'str(60)', true); col(t, 'ATTR_VALUE', 'str(400)');
      } else if (t.kind === 'NOTE') {
        col(t, 'NOTE_TEXT', 'str(2000)', true);
      } else if (t.kind === 'LOG') {
        col(t, 'EVENT_TIME', 'ts', true); col(t, 'EVENT_CODE', 'str(30)', true); col(t, 'MESSAGE', 'str(1000)');
        continue;
      }
      audit(t);
    }
  }
  return mods;
}

// Sade bir DBMS_METADATA dökümü: depolama ayrıntısı olmadan, modül başına bir dosya, FK'ler en sonda
function emit(lib, mods) {
  const q = s => '"' + s + '"';
  const head = m => ['--------------------------------------------------------', `--  ${m.schema}: ${m.title} (${m.list.length} tablo)`, '--  sqlSchema sentetik örneği; gerçek bir kuruma ait değildir.', '--------------------------------------------------------', 'SET DEFINE OFF;', ''];
  const files = {}, refs = [];
  mods.forEach((m, i) => {
    const out = head(m);
    for (const t of m.list) {
      const fq = q(t.schema) + '.' + q(t.name);
      const lines = t.cols.map(c => '\t' + q(c.name) + ' ' + lib.typeFor('oracle', c.type) + (c.nn ? ' NOT NULL ENABLE' : ''));
      lines.push('\t CONSTRAINT ' + q(('PK_' + t.name).slice(0, 30)) + ' PRIMARY KEY (' + t.pk.map(q).join(', ') + ') ENABLE');
      for (const u of t.uq) lines.push('\t CONSTRAINT ' + q(('UK_' + t.name).slice(0, 27) + '_' + u.slice(0, 2)) + ' UNIQUE (' + q(u) + ') ENABLE');
      out.push('--------------------------------------------------------', '--  DDL for Table ' + t.name, '--------------------------------------------------------', '');
      out.push('  CREATE TABLE ' + fq + '\n   (' + lines.join(',\n') + '\n   ) TABLESPACE ' + q(t.schema + '_DATA') + ' ;', '');
      out.push('   COMMENT ON TABLE ' + fq + "  IS '" + t.comment.replace(/'/g, "''") + "';", '');
      t.fks.forEach((f, k) => {
        const [ts, tn] = f.ref.split('.');
        refs.push('  ALTER TABLE ' + fq + ' ADD CONSTRAINT ' + q(('FK_' + t.name).slice(0, 26) + '_' + (k + 1)) + ' FOREIGN KEY (' + q(f.col) + ')\n\t  REFERENCES ' + q(ts) + '.' + q(tn) + ' (' + q(tn + '_ID') + ') ENABLE;');
      });
    }
    files[String(i + 1).padStart(2, '0') + '_' + m.schema + '.sql'] = out.join('\n') + '\n';
  });
  files['99_ref_constraints.sql'] = ['--------------------------------------------------------', '--  Ref Constraints (bütün modüller)', '--------------------------------------------------------', ...refs].join('\n') + '\n';
  return files;
}

module.exports = {
  id: 'buyuk',
  title: 'Büyük kurum (2 900 tablo)',
  sector: 'Telekom, kurumsal paket',
  dialect: 'Oracle',
  scenario: '30 modül şeması, 2 900 tablo, 4 000\'i aşkın FK; modül önekli adlar (CRM_, BIL_, GL_...). Büyük şemada açılış ve gezinme hızını denemek için.',
  en: { title: 'Large enterprise (2,900 tables)', sector: 'Telecom, enterprise suite', scenario: '30 module schemas, 2,900 tables, more than 4,000 FKs; module-prefixed names (CRM_, BIL_, GL_...). For trying how a large schema opens and how navigation feels.' },
  build(lib) {
    return emit(lib, generate());
  },
};
