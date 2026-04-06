/**
 * Import products from local SQLite file into Supabase products table.
 * Usage: npm run import:products
 *   or:  npm run import:products -- --db /path/to/aips_db.sqlite
 *
 * By default looks for ./data/aips_db.sqlite
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

const BATCH_SIZE = 500;

// Parse --db argument or use default path
function getDbPath(): string {
  const args = process.argv.slice(2);
  const dbIdx = args.indexOf('--db');
  if (dbIdx !== -1 && args[dbIdx + 1]) {
    return path.resolve(args[dbIdx + 1]);
  }
  // Default locations (check in order)
  const candidates = [
    path.resolve('data/aips_db.sqlite'),
    path.resolve('aips_db.sqlite'),
    '/tmp/aips.sqlite',
  ];
  for (const p of candidates) {
    if (fs.existsSync(p)) return p;
  }
  return candidates[0]; // Will fail with clear error
}

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

async function getImportedCount(): Promise<number> {
  const { count, error } = await supabase
    .from('products')
    .select('*', { count: 'exact', head: true });

  if (error) throw error;
  return count ?? 0;
}

async function importProducts(): Promise<void> {
  const dbPath = getDbPath();

  if (!fs.existsSync(dbPath)) {
    console.error(`SQLite file not found: ${dbPath}`);
    console.error('Place aips_db.sqlite in ./data/ or specify with --db /path/to/file');
    process.exit(1);
  }

  console.log(`Reading SQLite: ${dbPath} (${(fs.statSync(dbPath).size / 1024 / 1024).toFixed(1)} MB)`);
  const db = new Database(dbPath, { readonly: true });
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
