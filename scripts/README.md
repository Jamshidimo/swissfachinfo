# SwissFachinfo Import Scripts

Diese Scripts importieren die Swissmedic-Daten aus lokalen Dateien in die Supabase PostgreSQL-Datenbank.

## Voraussetzungen

1. Supabase-Projekt erstellt mit aktivierten Extensions (`vector`, `pg_trgm`)
2. Migration `001_initial_schema.sql` im Supabase SQL Editor ausgeführt
3. Quelldateien lokal vorhanden:
   - `data/aips_db.sqlite` (~190 MB)
   - `data/aips_xml.xml` (~2 GB)
4. `.env` Datei mit den Supabase-Credentials

## Schritt 1: Umgebung vorbereiten

```bash
# Daten-Ordner erstellen und Dateien ablegen
mkdir -p data
# aips_db.sqlite und aips_xml.xml in ./data/ kopieren

cp .env.example .env
# .env mit echten Werten befüllen
npm install
```

## Schritt 2: Produkte importieren

```bash
npm run import:products
# Oder mit explizitem Pfad:
npm run import:products -- --db /pfad/zu/aips_db.sqlite
```

Liest die SQLite-Datenbank und schreibt die Produkt-Stammdaten in die `products`-Tabelle.

## Schritt 3: Fachinfo-Abschnitte importieren

```bash
npm run import:sections
# Oder mit explizitem Pfad:
npm run import:sections -- --xml /pfad/zu/aips_xml.xml
```

Streamt die XML-Datei (2 GB) mit SAX-Parser und schreibt die Fachinfo-Abschnitte in die `sections`-Tabelle.

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
