/**
 * Import products from SQLite (stored in Supabase Storage) into products table.
 * Run: npm run import:products
 */
import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';
import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!
);

const TMP_DB_PATH = '/tmp/aips.sqlite';
const BATCH_SIZE = 500;

interface MedicalInfo {
  id: number;
  title: string;
  auth_holder: string | null;
  atc_code: string | null;
  substances: string | null;
  auth_nrs: string | null;
  remark: string | null;
  type: string | null;
  version: number | null;
  lang: string | null;
  information_update: string | null;
}

async function downloadSqlite(): Promise<void> {
  if (fs.existsSync(TMP_DB_PATH)) {
    console.log('SQLite already downloaded, reusing...');
    return;
  }

  console.log('Downloading SQLite from Supabase Storage...');
  const { data, error } = await supabase.storage
    .from('import')
    .download('aips_db.sqlite');

  if (error) throw new Error(`Download failed: ${error.message}`);

  const buffer = Buffer.from(await data.arrayBuffer());
  fs.writeFileSync(TMP_DB_PATH, buffer);
  console.log(`Downloaded ${(buffer.length / 1024 / 1024).toFixed(1)} MB`);
}

async function getImportedCount(): Promise<number> {
  const { count, error } = await supabase
    .from('products')
    .select('*', { count: 'exact', head: true });

  if (error) throw error;
  return count ?? 0;
}

async function importProducts(): Promise<void> {
  await downloadSqlite();

  const db = new Database(TMP_DB_PATH, { readonly: true });
  const rows = db.prepare('SELECT * FROM medical_information ORDER BY id').all() as MedicalInfo[];

  console.log(`Found ${rows.length} rows in SQLite`);

  const existingCount = await getImportedCount();
  console.log(`Already imported: ${existingCount} products`);

  let imported = 0;
  let skipped = 0;

  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    const batch = rows.slice(i, i + BATCH_SIZE).map(row => ({
      title: row.title,
      auth_holder: row.auth_holder,
      atc_code: row.atc_code,
      substances: row.substances ? row.substances.split(', ').map(s => s.trim()).filter(Boolean) : [],
      auth_nrs: row.auth_nrs ? row.auth_nrs.split(', ').map(s => s.trim()).filter(Boolean) : [],
      lang: row.lang || 'de',
      version: row.version,
      information_update: row.information_update || null
    }));

    const { error } = await supabase
      .from('products')
      .upsert(batch, { onConflict: 'uq_product' });

    if (error) {
      console.error(`Error at batch ${i}: ${error.message}`);
      // Continue with next batch
      skipped += batch.length;
    } else {
      imported += batch.length;
    }

    process.stdout.write(`\rProgress: ${i + batch.length} / ${rows.length} (imported: ${imported}, skipped: ${skipped})`);
  }

  console.log(`\n\nDone! Imported: ${imported}, Skipped: ${skipped}`);

  db.close();
}

importProducts().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
