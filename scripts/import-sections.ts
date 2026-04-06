/**
 * Import sections from local SQLite file into Supabase sections table.
 * Reads from the section_content table in swissmedic_fi_de_sections_v3.db.
 * Resumeable: checks which products already have sections.
 * Usage: npm run import:sections
 *   or:  npm run import:sections -- --db /path/to/db.sqlite
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

const BATCH_SIZE = 200;

function getDbPath(): string {
  const args = process.argv.slice(2);
  const dbIdx = args.indexOf('--db');
  if (dbIdx !== -1 && args[dbIdx + 1]) {
    return path.resolve(args[dbIdx + 1]);
  }
  const candidates = [
    path.resolve('data/swissmedic_fi_de_sections_v3.db'),
    path.resolve('data/aips_db.sqlite'),
  ];
  for (const p of candidates) {
    if (fs.existsSync(p)) return p;
  }
  return candidates[0];
}

// Section code mapping from German titles
const SECTION_MAP: Record<string, string> = {
  'zusammensetzung': 'composition',
  'galenische form und wirkstoffmenge': 'composition',
  'galenische form und wirkstoffmenge pro einheit': 'composition',
  'darreichungsform und wirkstoffmenge pro einheit': 'composition',
  'indikationen': 'indications',
  'indikationen/anwendungsmöglichkeiten': 'indications',
  'anwendungsgebiete': 'indications',
  'dosierung': 'dosage',
  'dosierung/anwendung': 'dosage',
  'kontraindikationen': 'contraindications',
  'warnhinweise und vorsichtsmassnahmen': 'warnings',
  'warnhinweise': 'warnings',
  'vorsichtsmassnahmen': 'warnings',
  'interaktionen': 'interactions',
  'schwangerschaft': 'pregnancy',
  'schwangerschaft, stillzeit': 'pregnancy',
  'schwangerschaft/stillzeit': 'pregnancy',
  'fertilität, schwangerschaft und stillzeit': 'pregnancy',
  'wirkung auf die fahrtüchtigkeit': 'driving',
  'wirkung auf die fahrtüchtigkeit und auf das bedienen von maschinen': 'driving',
  'fahrtüchtigkeit': 'driving',
  'unerwünschte wirkungen': 'side_effects',
  'nebenwirkungen': 'side_effects',
  'überdosierung': 'overdose',
  'eigenschaften/wirkungen': 'pharmacodynamics',
  'pharmakodynamik': 'pharmacodynamics',
  'pharmakodynamische eigenschaften': 'pharmacodynamics',
  'pharmakokinetik': 'pharmacokinetics',
  'pharmakokinetische eigenschaften': 'pharmacokinetics',
  'präklinische daten': 'preclinical',
  'sonstige hinweise': 'other',
  'weitere angaben': 'other',
  'hinweise für die aufbewahrung': 'storage',
  'aufbewahrung': 'storage',
  'haltbarkeit': 'storage',
  'zulassungsnummer': 'registration',
  'packungen': 'packaging',
  'zulassungsinhaberin': 'manufacturer',
  'stand der information': 'revision',
};

function normalizeSectionCode(title: string): string {
  const lower = title.toLowerCase().trim();
  if (SECTION_MAP[lower]) return SECTION_MAP[lower];
  for (const [key, code] of Object.entries(SECTION_MAP)) {
    if (lower.includes(key) || key.includes(lower)) return code;
  }
  return 'other';
}

interface SectionRow {
  id: number;
  medical_info_id: number;
  section_id: string;
  section_name: string;
  content_text: string;
}

async function getProductMap(): Promise<Map<string, number>> {
  const map = new Map<string, number>();
  let offset = 0;
  const pageSize = 1000;

  while (true) {
    const { data, error } = await supabase
      .from('products')
      .select('id, title')
      .range(offset, offset + pageSize - 1);

    if (error) throw error;
    if (!data || data.length === 0) break;

    for (const row of data) {
      map.set(row.title, row.id);
    }

    offset += data.length;
    if (data.length < pageSize) break;
  }

  return map;
}

async function getImportedProductIds(): Promise<Set<number>> {
  const set = new Set<number>();
  let offset = 0;
  const pageSize = 1000;

  while (true) {
    const { data, error } = await supabase
      .from('sections')
      .select('product_id')
      .range(offset, offset + pageSize - 1);

    if (error) throw error;
    if (!data || data.length === 0) break;

    for (const row of data) {
      set.add(row.product_id);
    }

    offset += data.length;
    if (data.length < pageSize) break;
  }

  return set;
}

async function importSections(): Promise<void> {
  const dbPath = getDbPath();

  if (!fs.existsSync(dbPath)) {
    console.error(`SQLite file not found: ${dbPath}`);
    process.exit(1);
  }

  console.log(`SQLite: ${dbPath} (${(fs.statSync(dbPath).size / 1024 / 1024).toFixed(1)} MB)`);
  const db = new Database(dbPath, { readonly: true });

  // Build SQLite medical_info_id → title map
  const sqliteProducts = db.prepare(
    'SELECT id, title FROM medical_information'
  ).all() as { id: number; title: string }[];

  const sqliteIdToTitle = new Map<number, string>();
  for (const row of sqliteProducts) {
    sqliteIdToTitle.set(row.id, row.title);
  }
  console.log(`SQLite: ${sqliteIdToTitle.size} products`);

  // Load Supabase product map (title → supabase_id)
  console.log('Loading Supabase product map...');
  const supabaseProductMap = await getProductMap();
  console.log(`Supabase: ${supabaseProductMap.size} products`);

  // Check already imported
  console.log('Checking already imported sections...');
  const importedIds = await getImportedProductIds();
  console.log(`Already imported sections for ${importedIds.size} products`);

  // Read all sections from SQLite
  const sectionRows = db.prepare(
    'SELECT id, medical_info_id, section_id, section_name, content_text FROM section_content ORDER BY medical_info_id, id'
  ).all() as SectionRow[];
  console.log(`SQLite: ${sectionRows.length} section rows`);

  db.close();

  // Build pending sections
  const pendingSections: Array<{
    product_id: number;
    section_code: string;
    section_title: string;
    content: string;
  }> = [];

  // Track duplicates per product
  const seenPerProduct = new Map<number, Set<string>>();
  let skippedNoMatch = 0;
  let skippedAlreadyImported = 0;
  let skippedDuplicate = 0;
  let skippedEmpty = 0;

  for (const row of sectionRows) {
    const title = sqliteIdToTitle.get(row.medical_info_id);
    if (!title) { skippedNoMatch++; continue; }

    const productId = supabaseProductMap.get(title);
    if (!productId) { skippedNoMatch++; continue; }

    if (importedIds.has(productId)) { skippedAlreadyImported++; continue; }

    const content = (row.content_text || '').trim();
    if (!content) { skippedEmpty++; continue; }

    const sectionCode = normalizeSectionCode(row.section_name);

    // Deduplicate per product
    if (!seenPerProduct.has(productId)) {
      seenPerProduct.set(productId, new Set());
    }
    const seen = seenPerProduct.get(productId)!;
    if (seen.has(sectionCode)) { skippedDuplicate++; continue; }
    seen.add(sectionCode);

    pendingSections.push({
      product_id: productId,
      section_code: sectionCode,
      section_title: row.section_name.trim(),
      content,
    });
  }

  console.log(`\nReady to insert: ${pendingSections.length} sections`);
  console.log(`  Skipped (no match): ${skippedNoMatch}`);
  console.log(`  Skipped (already imported): ${skippedAlreadyImported}`);
  console.log(`  Skipped (duplicate code): ${skippedDuplicate}`);
  console.log(`  Skipped (empty): ${skippedEmpty}`);

  if (pendingSections.length === 0) {
    console.log('Nothing to insert.');
    return;
  }

  // Batch upsert
  let totalInserted = 0;
  let totalErrors = 0;

  for (let i = 0; i < pendingSections.length; i += BATCH_SIZE) {
    const batch = pendingSections.slice(i, i + BATCH_SIZE);

    const { error } = await supabase
      .from('sections')
      .upsert(batch, { onConflict: 'product_id,section_code' });

    if (error) {
      console.error(`\nBatch error at ${i}: ${error.message}`);
      totalErrors += batch.length;
    } else {
      totalInserted += batch.length;
    }

    process.stdout.write(`\rInserted: ${totalInserted} / ${pendingSections.length} (errors: ${totalErrors})`);
  }

  console.log(`\n\nDone! Inserted: ${totalInserted}, Errors: ${totalErrors}`);
}

importSections().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
