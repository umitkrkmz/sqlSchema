--
-- PostgreSQL database dump
--

-- Dumped from database version 16.4
-- Dumped by pg_dump version 16.4

SET statement_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET default_tablespace = '';

CREATE SCHEMA dw;

ALTER SCHEMA dw OWNER TO analytics;

CREATE SCHEMA etl;

ALTER SCHEMA etl OWNER TO analytics;

--
-- Name: dim_date; Type: TABLE; Schema: dw; Owner: analytics
--

CREATE TABLE dw.dim_date (
    date_key integer NOT NULL,
    full_date date NOT NULL,
    year smallint NOT NULL,
    month smallint NOT NULL,
    day smallint NOT NULL,
    is_holiday boolean NOT NULL
);

ALTER TABLE dw.dim_date OWNER TO analytics;

--
-- Name: dim_customer; Type: TABLE; Schema: dw; Owner: analytics
--

CREATE TABLE dw.dim_customer (
    customer_key bigint NOT NULL,
    customer_id bigint NOT NULL,
    city character varying(60),
    segment character varying(20),
    valid_from date NOT NULL,
    valid_to date,
    is_current boolean NOT NULL
);

ALTER TABLE dw.dim_customer OWNER TO analytics;

COMMENT ON TABLE dw.dim_customer IS 'Müşteri boyutu (SCD-2)';

--
-- Name: dim_product; Type: TABLE; Schema: dw; Owner: analytics
--

CREATE TABLE dw.dim_product (
    product_key bigint NOT NULL,
    product_ref character varying(24) NOT NULL,
    sku character varying(64) NOT NULL,
    title character varying(255),
    category character varying(150),
    brand character varying(150)
);

ALTER TABLE dw.dim_product OWNER TO analytics;

--
-- Name: dim_channel; Type: TABLE; Schema: dw; Owner: analytics
--

CREATE TABLE dw.dim_channel (
    channel_key integer NOT NULL,
    name character varying(40) NOT NULL
);

ALTER TABLE dw.dim_channel OWNER TO analytics;

--
-- Name: fact_sales; Type: TABLE; Schema: dw; Owner: analytics
--

CREATE TABLE dw.fact_sales (
    date_key integer NOT NULL,
    customer_key bigint NOT NULL,
    product_key bigint NOT NULL,
    channel_key integer,
    order_no character varying(20) NOT NULL,
    quantity integer NOT NULL,
    revenue numeric(14,2) NOT NULL,
    discount numeric(14,2)
);

ALTER TABLE dw.fact_sales OWNER TO analytics;

COMMENT ON TABLE dw.fact_sales IS 'Satış olgusu';

--
-- Name: fact_shipments; Type: TABLE; Schema: dw; Owner: analytics
--

CREATE TABLE dw.fact_shipments (
    date_key integer NOT NULL,
    customer_key bigint NOT NULL,
    carrier character varying(40),
    delivery_days integer,
    on_time boolean
);

ALTER TABLE dw.fact_shipments OWNER TO analytics;

--
-- Name: fact_reviews; Type: TABLE; Schema: dw; Owner: analytics
--

CREATE TABLE dw.fact_reviews (
    date_key integer NOT NULL,
    product_key bigint NOT NULL,
    rating smallint NOT NULL
);

ALTER TABLE dw.fact_reviews OWNER TO analytics;

--
-- Name: load_runs; Type: TABLE; Schema: etl; Owner: analytics
--

CREATE TABLE etl.load_runs (
    id bigint GENERATED ALWAYS AS IDENTITY NOT NULL,
    source character varying(40) NOT NULL,
    started_at timestamp with time zone NOT NULL,
    finished_at timestamp with time zone,
    rows_loaded bigint,
    status character varying(20) NOT NULL
);

ALTER TABLE etl.load_runs OWNER TO analytics;

ALTER TABLE ONLY dw.dim_date
    ADD CONSTRAINT dim_date_pkey PRIMARY KEY (date_key);

ALTER TABLE ONLY dw.dim_date
    ADD CONSTRAINT dim_date_full_date_key UNIQUE (full_date);

ALTER TABLE ONLY dw.dim_customer
    ADD CONSTRAINT dim_customer_pkey PRIMARY KEY (customer_key);

ALTER TABLE ONLY dw.dim_product
    ADD CONSTRAINT dim_product_pkey PRIMARY KEY (product_key);

ALTER TABLE ONLY dw.dim_channel
    ADD CONSTRAINT dim_channel_pkey PRIMARY KEY (channel_key);

ALTER TABLE ONLY etl.load_runs
    ADD CONSTRAINT load_runs_pkey PRIMARY KEY (id);

ALTER TABLE ONLY dw.fact_sales
    ADD CONSTRAINT fact_sales_date_key_fkey FOREIGN KEY (date_key) REFERENCES dw.dim_date(date_key);

ALTER TABLE ONLY dw.fact_sales
    ADD CONSTRAINT fact_sales_customer_key_fkey FOREIGN KEY (customer_key) REFERENCES dw.dim_customer(customer_key);

ALTER TABLE ONLY dw.fact_sales
    ADD CONSTRAINT fact_sales_product_key_fkey FOREIGN KEY (product_key) REFERENCES dw.dim_product(product_key);

ALTER TABLE ONLY dw.fact_sales
    ADD CONSTRAINT fact_sales_channel_key_fkey FOREIGN KEY (channel_key) REFERENCES dw.dim_channel(channel_key);

ALTER TABLE ONLY dw.fact_shipments
    ADD CONSTRAINT fact_shipments_date_key_fkey FOREIGN KEY (date_key) REFERENCES dw.dim_date(date_key);

ALTER TABLE ONLY dw.fact_shipments
    ADD CONSTRAINT fact_shipments_customer_key_fkey FOREIGN KEY (customer_key) REFERENCES dw.dim_customer(customer_key);

ALTER TABLE ONLY dw.fact_reviews
    ADD CONSTRAINT fact_reviews_date_key_fkey FOREIGN KEY (date_key) REFERENCES dw.dim_date(date_key);

ALTER TABLE ONLY dw.fact_reviews
    ADD CONSTRAINT fact_reviews_product_key_fkey FOREIGN KEY (product_key) REFERENCES dw.dim_product(product_key);

--
-- PostgreSQL database dump complete
--
