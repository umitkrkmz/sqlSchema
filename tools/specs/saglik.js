/*
 * Hastane bilgi sistemi (HBYS) — PostgreSQL, OMOP CDM dağıtım biçiminde:
 * tablolar, birincil anahtarlar, yabancı anahtarlar, indeksler ve açıklamalar ayrı dosyalarda.
 * Alfabetik sırada constraints.sql, ddl.sql'den önce gelir; FK'ler tablolardan önce okunur.
 */
'use strict';

const SPEC = `
his.country | | country_id:int pk; iso2:char(2) nn uq; name nn
his.payer | Kurum: SGK, özel sigorta, kendi ödeyen | payer_id:int pk; name nn; payer_type:str(20) nn; medula_code:str(10)
his.patient | Hasta kimlik kaydı | patient_id pk; mrn:str(20) nn uq; national_id:char(11) uq; first_name nn; last_name nn; birth_date nn; sex:char(1) nn; blood_type:str(3); nationality_id:int >country; deceased_at
his.patient_contact | | patient_contact_id pk; patient_id nn >patient; contact_type:str(20) nn; value:str(200) nn
his.patient_relative | Hasta yakını | patient_relative_id pk; patient_id nn >patient; full_name nn; relation:str(30); phone
his.patient_insurance | Sağlık güvencesi | patient_insurance_id pk; patient_id nn >patient; payer_id:int nn >payer; policy_no; valid_from nn; valid_to
his.allergy | | allergy_id pk; patient_id nn >patient; substance:str(100) nn; reaction:str(200); severity:str(10); recorded_at
his.department | Klinik / bölüm | department_id:int pk; name nn; parent_department_id:int >department; is_inpatient:bool nn
his.specialty | Uzmanlık dalı | specialty_id:int pk; code:str(10) nn uq; name nn
his.practitioner | Hekim ve sağlık personeli | practitioner_id pk; diploma_no:str(20) uq; full_name nn; title:str(30); specialty_id:int >specialty; department_id:int >department
his.staff_shift | Nöbet / vardiya | staff_shift_id pk; practitioner_id nn >practitioner; ward_id:int >ward; shift_start:ts nn; shift_end:ts nn
his.appointment | Randevu (MHRS dahil) | appointment_id pk; patient_id nn >patient; practitioner_id nn >practitioner; department_id:int nn >department; slot_start:ts nn; slot_end:ts nn; source:str(10) nn; status:str(20) nn
his.encounter | Muayene, yatış ya da acil başvurusu | encounter_id pk; patient_id nn >patient; encounter_type:str(10) nn; department_id:int nn >department; attending_practitioner_id >practitioner; appointment_id >appointment; admitted_at nn; discharged_at; provision_no:str(30)
his.ward | Servis | ward_id:int pk; department_id:int nn >department; name nn; floor:int
his.bed | | bed_id:int pk; ward_id:int nn >ward; bed_no:str(10) nn; bed_type:str(20); is_active:bool nn
his.admission | Yatış (encounter ile 1:1) | admission_id pk; encounter_id nn uq >encounter; bed_id:int >bed; admission_reason:text; expected_discharge:date
his.bed_transfer | Yatak değişikliği | bed_transfer_id pk; admission_id nn >admission; from_bed_id:int >bed; to_bed_id:int nn >bed; transferred_at nn
his.icd10 | ICD-10 tanı kodları | icd10_code:str(8) pk; description nn; chapter:str(10)
his.diagnosis | Tanı | diagnosis_id pk; encounter_id nn >encounter; icd10_code nn >icd10; diagnosis_type:str(20) nn; recorded_by_practitioner_id >practitioner; recorded_at nn
his.vital_sign | Yaşamsal bulgular | vital_sign_id pk; encounter_id nn >encounter; measured_at nn; systolic:int; diastolic:int; pulse:int; temperature:dec(4,1); spo2:int; measured_by_practitioner_id >practitioner
his.clinical_note | | clinical_note_id pk; encounter_id nn >encounter; practitioner_id nn >practitioner; note_type:str(20) nn; body:text nn; signed_at
his.medical_order | Hekim istemi (laboratuvar, görüntüleme, ilaç) | medical_order_id pk; encounter_id nn >encounter; ordered_by_practitioner_id nn >practitioner; order_type:str(20) nn; priority:str(10); ordered_at nn; status:str(20) nn
his.lab_test | Laboratuvar test kataloğu (LOINC) | lab_test_id:int pk; loinc_code:str(10) uq; name nn; unit:str(20); reference_range:str(50)
his.specimen | Numune | specimen_id pk; patient_id nn >patient; specimen_type:str(30) nn; barcode:str(30) nn uq; collected_at
his.lab_order_item | | lab_order_item_id pk; medical_order_id nn >medical_order; lab_test_id:int nn >lab_test; specimen_id >specimen
his.lab_result | | lab_result_id pk; lab_order_item_id nn >lab_order_item; value_numeric:dec(12,4); value_text:str(200); abnormal_flag:char(1); resulted_at nn; verified_by_practitioner_id >practitioner
his.imaging_study | Görüntüleme (PACS) | imaging_study_id pk; medical_order_id nn >medical_order; modality:str(10) nn; study_uid:str(64) nn uq; performed_at; report_text:text
his.medication | İlaç kataloğu | medication_id:int pk; barcode:str(20) nn uq; name nn; atc_code:str(10); form:str(30)
his.prescription | E-reçete | prescription_id pk; encounter_id nn >encounter; practitioner_id nn >practitioner; erecete_no:str(20); prescribed_at nn
his.prescription_item | | prescription_item_id pk; prescription_id nn >prescription; medication_id:int nn >medication; dose:str(50); frequency:str(50); duration_days:int; quantity nn
his.medication_administration | Hemşire ilaç uygulaması | medication_administration_id pk; admission_id nn >admission; medication_id:int nn >medication; prescription_item_id >prescription_item; administered_at nn; administered_by_practitioner_id >practitioner
his.procedure_catalog | SUT işlem kodları | procedure_code:str(10) pk; name:str(300) nn; sut_price:money
his.procedure | Yapılan işlem | procedure_id pk; encounter_id nn >encounter; procedure_code nn >procedure_catalog; practitioner_id >practitioner; performed_at nn; quantity nn
his.operating_room | Ameliyathane | operating_room_id:int pk; name nn; department_id:int >department
his.surgery | Ameliyat | surgery_id pk; encounter_id nn >encounter; operating_room_id:int >operating_room; primary_surgeon_id >practitioner; anesthesia_type:str(20); started_at; ended_at
his.surgery_team | | surgery_id pk >surgery; practitioner_id pk >practitioner; role:str(30) nn
his.consent_form | Onam formu | consent_form_id pk; encounter_id nn >encounter; form_type:str(30) nn; signed_at; signed_by:str(100)
his.invoice | Hasta faturası | invoice_id pk; encounter_id nn >encounter; payer_id:int nn >payer; invoice_no:str(20) nn uq; total_amount nn; issued_at nn; status:str(20) nn
his.invoice_line | | invoice_line_id pk; invoice_id nn >invoice; procedure_id >procedure; medication_administration_id >medication_administration; description:str(300) nn; amount nn
his.claim | Kurum takibi (MEDULA) | claim_id pk; invoice_id nn >invoice; payer_id:int nn >payer; takip_no:str(30); submitted_at; status:str(20); rejection_reason:str(300)
his.payment | | payment_id pk; invoice_id nn >invoice; amount nn; method:str(20) nn; paid_at nn
his.audit_event | KVKK erişim kaydı; FK yok | audit_event_id pk; user_name:str(50) nn; patient_id; action:str(30) nn; occurred_at nn
`;

const COMMENTS = { mrn: 'Hastane protokol / dosya numarası', national_id: 'T.C. kimlik numarası; yabancı hastada boş', provision_no: 'SGK MEDULA provizyon numarası', icd10_code: 'ICD-10 kodu, ör. J18.9' };

module.exports = {
  id: 'saglik',
  title: 'Hastane bilgi sistemi',
  sector: 'Sağlık',
  dialect: 'PostgreSQL',
  scenario: 'OMOP CDM dağıtım biçimi: tablolar, PK\'ler, FK\'ler, indeksler ve açıklamalar beş ayrı dosyada; FK dosyası tablolardan önce okunur.',
  en: { title: 'Hospital information system', sector: 'Healthcare', scenario: 'OMOP CDM distribution layout: tables, PKs, FKs, indexes and comments in five files; the FK file is read before the tables.' },
  build(lib) {
    const t = lib.parseSpec(SPEC);
    for (const x of t.values()) for (const c of x.cols) if (COMMENTS[c.name]) c.comment = COMMENTS[c.name];
    return lib.emitPostgresSplit(t);
  },
};
