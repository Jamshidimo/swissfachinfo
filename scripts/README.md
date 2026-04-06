# SwissFachinfo Import Scripts

Diese Scripts importieren die Swissmedic-Daten aus Supabase Storage in die PostgreSQL-Datenbank.

## Voraussetzungen

1. Supabase-Projekt erstellt mit aktivierten Extensions (`vector`, `pg_trgm`)
2. Migration `001_initial_schema.sql` im Supabase SQL Editor ausgeführt
3. Dateien in Supabase Storage hochgeladen:
   - Bucket: `import`
   - `aips_db.sqlite` (~190 MB)
   - `aips_xml.xml` (~2 GB)
4. `.env` Datei mit den Supabase-Credentials

## Schritt 1: Umgebung vorbereiten

```bash
cp .env.example .env
# .env mit echten Werten befüllen
npm install
```

## Schritt 2: Produkte importieren

```bash
npm run import:products
```

Liest die SQLite-Datenbank aus Supabase Storage und schreibt die Produkt-Stammdaten in die `products`-Tabelle.

## Schritt 3: Fachinfo-Abschnitte importieren

```bash
npm run import:sections
```

Parst die XML-Datei und schreibt die Fachinfo-Abschnitte in die `sections`-Tabelle.

## Schritt 4: Import verifizieren

```bash
npm run import:verify
```

## Schritt 5: Embeddings generieren (optional)

```bash
npm run import:embeddings
```

Nach Abschluss den IVFFlat-Index erstellen:

```sql
CREATE INDEX idx_sections_embedding ON sections
  USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);
```
