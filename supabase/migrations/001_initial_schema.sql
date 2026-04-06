-- Enable required extensions
CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- Stammdaten der Arzneimittel
CREATE TABLE products (
    id SERIAL PRIMARY KEY,
    title TEXT NOT NULL,
    auth_holder TEXT,
    atc_code TEXT,
    substances TEXT[],
    auth_nrs TEXT[],
    lang TEXT DEFAULT 'de',
    version INTEGER,
    information_update DATE,
    created_at TIMESTAMPTZ DEFAULT NOW(),

    CONSTRAINT uq_product UNIQUE (title, lang, version)
);

CREATE INDEX idx_products_atc ON products(atc_code);
CREATE INDEX idx_products_substances ON products USING GIN(substances);
CREATE INDEX idx_products_title_trgm ON products USING GIN(title gin_trgm_ops);
CREATE INDEX idx_products_lang ON products(lang);

-- Fachinfo-Abschnitte (1 Row pro Abschnitt pro Produkt)
CREATE TABLE sections (
    id SERIAL PRIMARY KEY,
    product_id INTEGER REFERENCES products(id) ON DELETE CASCADE,
    section_code TEXT NOT NULL,
    section_title TEXT NOT NULL,
    content TEXT NOT NULL,
    content_length INTEGER GENERATED ALWAYS AS (length(content)) STORED,
    embedding vector(1024),

    UNIQUE(product_id, section_code)
);

CREATE INDEX idx_sections_product ON sections(product_id);
CREATE INDEX idx_sections_code ON sections(section_code);

-- Fulltext search index
ALTER TABLE sections ADD COLUMN content_tsv tsvector
    GENERATED ALWAYS AS (to_tsvector('german', content)) STORED;
CREATE INDEX idx_sections_fts ON sections USING GIN(content_tsv);

-- Embedding index (create AFTER data is loaded for better performance)
-- Run this after import:
-- CREATE INDEX idx_sections_embedding ON sections USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);

-- ATC-Klassifikation
CREATE TABLE atc_codes (
    code TEXT PRIMARY KEY,
    level INTEGER,
    description_de TEXT,
    description_en TEXT,
    parent_code TEXT REFERENCES atc_codes(code)
);

-- RLS Policies (read-only for anon)
ALTER TABLE products ENABLE ROW LEVEL SECURITY;
ALTER TABLE sections ENABLE ROW LEVEL SECURITY;
ALTER TABLE atc_codes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Products are readable by everyone" ON products FOR SELECT USING (true);
CREATE POLICY "Sections are readable by everyone" ON sections FOR SELECT USING (true);
CREATE POLICY "ATC codes are readable by everyone" ON atc_codes FOR SELECT USING (true);

-- Helper function for semantic search
CREATE OR REPLACE FUNCTION match_sections(
    query_embedding vector(1024),
    match_threshold float DEFAULT 0.5,
    match_count int DEFAULT 30,
    filter_section_codes text[] DEFAULT NULL,
    filter_atc_prefix text DEFAULT NULL
)
RETURNS TABLE (
    id int,
    product_id int,
    section_code text,
    section_title text,
    content text,
    product_title text,
    substances text[],
    atc_code text,
    similarity float
)
LANGUAGE plpgsql
AS $$
BEGIN
    RETURN QUERY
    SELECT
        s.id,
        s.product_id,
        s.section_code,
        s.section_title,
        s.content,
        p.title as product_title,
        p.substances,
        p.atc_code,
        1 - (s.embedding <=> query_embedding) as similarity
    FROM sections s
    JOIN products p ON p.id = s.product_id
    WHERE s.embedding IS NOT NULL
        AND 1 - (s.embedding <=> query_embedding) > match_threshold
        AND (filter_section_codes IS NULL OR s.section_code = ANY(filter_section_codes))
        AND (filter_atc_prefix IS NULL OR p.atc_code LIKE filter_atc_prefix || '%')
    ORDER BY s.embedding <=> query_embedding
    LIMIT match_count;
END;
$$;
