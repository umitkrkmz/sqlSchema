--postgresql CDM DDL Specification

CREATE TABLE his.country (
			country_id integer NOT NULL,
			iso2 character(2) NOT NULL,
			name character varying(100) NOT NULL );
CREATE TABLE his.payer (
			payer_id integer NOT NULL,
			name character varying(100) NOT NULL,
			payer_type character varying(20) NOT NULL,
			medula_code character varying(10) NULL );
CREATE TABLE his.patient (
			patient_id bigint NOT NULL,
			mrn character varying(20) NOT NULL,
			national_id character(11) NULL,
			first_name character varying(100) NOT NULL,
			last_name character varying(100) NOT NULL,
			birth_date date NOT NULL,
			sex character(1) NOT NULL,
			blood_type character varying(3) NULL,
			nationality_id integer NULL,
			deceased_at timestamp with time zone NULL );
CREATE TABLE his.patient_contact (
			patient_contact_id bigint NOT NULL,
			patient_id bigint NOT NULL,
			contact_type character varying(20) NOT NULL,
			value character varying(200) NOT NULL );
CREATE TABLE his.patient_relative (
			patient_relative_id bigint NOT NULL,
			patient_id bigint NOT NULL,
			full_name character varying(100) NOT NULL,
			relation character varying(30) NULL,
			phone character varying(20) NULL );
CREATE TABLE his.patient_insurance (
			patient_insurance_id bigint NOT NULL,
			patient_id bigint NOT NULL,
			payer_id integer NOT NULL,
			policy_no character varying(30) NULL,
			valid_from date NOT NULL,
			valid_to date NULL );
CREATE TABLE his.allergy (
			allergy_id bigint NOT NULL,
			patient_id bigint NOT NULL,
			substance character varying(100) NOT NULL,
			reaction character varying(200) NULL,
			severity character varying(10) NULL,
			recorded_at timestamp with time zone NULL );
CREATE TABLE his.department (
			department_id integer NOT NULL,
			name character varying(100) NOT NULL,
			parent_department_id integer NULL,
			is_inpatient boolean NOT NULL );
CREATE TABLE his.specialty (
			specialty_id integer NOT NULL,
			code character varying(10) NOT NULL,
			name character varying(100) NOT NULL );
CREATE TABLE his.practitioner (
			practitioner_id bigint NOT NULL,
			diploma_no character varying(20) NULL,
			full_name character varying(100) NOT NULL,
			title character varying(30) NULL,
			specialty_id integer NULL,
			department_id integer NULL );
CREATE TABLE his.staff_shift (
			staff_shift_id bigint NOT NULL,
			practitioner_id bigint NOT NULL,
			ward_id integer NULL,
			shift_start timestamp with time zone NOT NULL,
			shift_end timestamp with time zone NOT NULL );
CREATE TABLE his.appointment (
			appointment_id bigint NOT NULL,
			patient_id bigint NOT NULL,
			practitioner_id bigint NOT NULL,
			department_id integer NOT NULL,
			slot_start timestamp with time zone NOT NULL,
			slot_end timestamp with time zone NOT NULL,
			source character varying(10) NOT NULL,
			status character varying(20) NOT NULL );
CREATE TABLE his.encounter (
			encounter_id bigint NOT NULL,
			patient_id bigint NOT NULL,
			encounter_type character varying(10) NOT NULL,
			department_id integer NOT NULL,
			attending_practitioner_id bigint NULL,
			appointment_id bigint NULL,
			admitted_at timestamp with time zone NOT NULL,
			discharged_at timestamp with time zone NULL,
			provision_no character varying(30) NULL );
CREATE TABLE his.ward (
			ward_id integer NOT NULL,
			department_id integer NOT NULL,
			name character varying(100) NOT NULL,
			floor integer NULL );
CREATE TABLE his.bed (
			bed_id integer NOT NULL,
			ward_id integer NOT NULL,
			bed_no character varying(10) NOT NULL,
			bed_type character varying(20) NULL,
			is_active boolean NOT NULL );
CREATE TABLE his.admission (
			admission_id bigint NOT NULL,
			encounter_id bigint NOT NULL,
			bed_id integer NULL,
			admission_reason text NULL,
			expected_discharge date NULL );
CREATE TABLE his.bed_transfer (
			bed_transfer_id bigint NOT NULL,
			admission_id bigint NOT NULL,
			from_bed_id integer NULL,
			to_bed_id integer NOT NULL,
			transferred_at timestamp with time zone NOT NULL );
CREATE TABLE his.icd10 (
			icd10_code character varying(8) NOT NULL,
			description character varying(400) NOT NULL,
			chapter character varying(10) NULL );
CREATE TABLE his.diagnosis (
			diagnosis_id bigint NOT NULL,
			encounter_id bigint NOT NULL,
			icd10_code character varying(30) NOT NULL,
			diagnosis_type character varying(20) NOT NULL,
			recorded_by_practitioner_id bigint NULL,
			recorded_at timestamp with time zone NOT NULL );
CREATE TABLE his.vital_sign (
			vital_sign_id bigint NOT NULL,
			encounter_id bigint NOT NULL,
			measured_at timestamp with time zone NOT NULL,
			systolic integer NULL,
			diastolic integer NULL,
			pulse integer NULL,
			temperature numeric(4,1) NULL,
			spo2 integer NULL,
			measured_by_practitioner_id bigint NULL );
CREATE TABLE his.clinical_note (
			clinical_note_id bigint NOT NULL,
			encounter_id bigint NOT NULL,
			practitioner_id bigint NOT NULL,
			note_type character varying(20) NOT NULL,
			body text NOT NULL,
			signed_at timestamp with time zone NULL );
CREATE TABLE his.medical_order (
			medical_order_id bigint NOT NULL,
			encounter_id bigint NOT NULL,
			ordered_by_practitioner_id bigint NOT NULL,
			order_type character varying(20) NOT NULL,
			priority character varying(10) NULL,
			ordered_at timestamp with time zone NOT NULL,
			status character varying(20) NOT NULL );
CREATE TABLE his.lab_test (
			lab_test_id integer NOT NULL,
			loinc_code character varying(10) NULL,
			name character varying(100) NOT NULL,
			unit character varying(20) NULL,
			reference_range character varying(50) NULL );
CREATE TABLE his.specimen (
			specimen_id bigint NOT NULL,
			patient_id bigint NOT NULL,
			specimen_type character varying(30) NOT NULL,
			barcode character varying(30) NOT NULL,
			collected_at timestamp with time zone NULL );
CREATE TABLE his.lab_order_item (
			lab_order_item_id bigint NOT NULL,
			medical_order_id bigint NOT NULL,
			lab_test_id integer NOT NULL,
			specimen_id bigint NULL );
CREATE TABLE his.lab_result (
			lab_result_id bigint NOT NULL,
			lab_order_item_id bigint NOT NULL,
			value_numeric numeric(12,4) NULL,
			value_text character varying(200) NULL,
			abnormal_flag character(1) NULL,
			resulted_at timestamp with time zone NOT NULL,
			verified_by_practitioner_id bigint NULL );
CREATE TABLE his.imaging_study (
			imaging_study_id bigint NOT NULL,
			medical_order_id bigint NOT NULL,
			modality character varying(10) NOT NULL,
			study_uid character varying(64) NOT NULL,
			performed_at timestamp with time zone NULL,
			report_text text NULL );
CREATE TABLE his.medication (
			medication_id integer NOT NULL,
			barcode character varying(20) NOT NULL,
			name character varying(100) NOT NULL,
			atc_code character varying(10) NULL,
			form character varying(30) NULL );
CREATE TABLE his.prescription (
			prescription_id bigint NOT NULL,
			encounter_id bigint NOT NULL,
			practitioner_id bigint NOT NULL,
			erecete_no character varying(20) NULL,
			prescribed_at timestamp with time zone NOT NULL );
CREATE TABLE his.prescription_item (
			prescription_item_id bigint NOT NULL,
			prescription_id bigint NOT NULL,
			medication_id integer NOT NULL,
			dose character varying(50) NULL,
			frequency character varying(50) NULL,
			duration_days integer NULL,
			quantity integer NOT NULL );
CREATE TABLE his.medication_administration (
			medication_administration_id bigint NOT NULL,
			admission_id bigint NOT NULL,
			medication_id integer NOT NULL,
			prescription_item_id bigint NULL,
			administered_at timestamp with time zone NOT NULL,
			administered_by_practitioner_id bigint NULL );
CREATE TABLE his.procedure_catalog (
			procedure_code character varying(10) NOT NULL,
			name character varying(300) NOT NULL,
			sut_price numeric(14,2) NULL );
CREATE TABLE his.procedure (
			procedure_id bigint NOT NULL,
			encounter_id bigint NOT NULL,
			procedure_code character varying(30) NOT NULL,
			practitioner_id bigint NULL,
			performed_at timestamp with time zone NOT NULL,
			quantity integer NOT NULL );
CREATE TABLE his.operating_room (
			operating_room_id integer NOT NULL,
			name character varying(100) NOT NULL,
			department_id integer NULL );
CREATE TABLE his.surgery (
			surgery_id bigint NOT NULL,
			encounter_id bigint NOT NULL,
			operating_room_id integer NULL,
			primary_surgeon_id bigint NULL,
			anesthesia_type character varying(20) NULL,
			started_at timestamp with time zone NULL,
			ended_at timestamp with time zone NULL );
CREATE TABLE his.surgery_team (
			surgery_id bigint NOT NULL,
			practitioner_id bigint NOT NULL,
			role character varying(30) NOT NULL );
CREATE TABLE his.consent_form (
			consent_form_id bigint NOT NULL,
			encounter_id bigint NOT NULL,
			form_type character varying(30) NOT NULL,
			signed_at timestamp with time zone NULL,
			signed_by character varying(100) NULL );
CREATE TABLE his.invoice (
			invoice_id bigint NOT NULL,
			encounter_id bigint NOT NULL,
			payer_id integer NOT NULL,
			invoice_no character varying(20) NOT NULL,
			total_amount numeric(14,2) NOT NULL,
			issued_at timestamp with time zone NOT NULL,
			status character varying(20) NOT NULL );
CREATE TABLE his.invoice_line (
			invoice_line_id bigint NOT NULL,
			invoice_id bigint NOT NULL,
			procedure_id bigint NULL,
			medication_administration_id bigint NULL,
			description character varying(300) NOT NULL,
			amount numeric(14,2) NOT NULL );
CREATE TABLE his.claim (
			claim_id bigint NOT NULL,
			invoice_id bigint NOT NULL,
			payer_id integer NOT NULL,
			takip_no character varying(30) NULL,
			submitted_at timestamp with time zone NULL,
			status character varying(20) NULL,
			rejection_reason character varying(300) NULL );
CREATE TABLE his.payment (
			payment_id bigint NOT NULL,
			invoice_id bigint NOT NULL,
			amount numeric(14,2) NOT NULL,
			method character varying(20) NOT NULL,
			paid_at timestamp with time zone NOT NULL );
CREATE TABLE his.audit_event (
			audit_event_id bigint NOT NULL,
			user_name character varying(50) NOT NULL,
			patient_id bigint NULL,
			action character varying(30) NOT NULL,
			occurred_at timestamp with time zone NOT NULL );
