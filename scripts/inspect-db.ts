/**
 * Quick inspect of the SQLite database schema.
 * Usage: npx tsx scripts/inspect-db.ts
 */
import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';

const candidates = [
  path.resolve('data/swissmedic_fi_de_sections_v3.db'),
  path.resolve('data/aips_db.sqlite'),
];

const dbPath = candidates.find(p => fs.existsSync(p));
if (!dbPath) { console.error('No DB found'); process.exit(1); }

console.log(`DB: ${dbPath}`);
const db = new Database(dbPath, { readonly: true });

// List tables
const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as { name: string }[];
console.log('\nTables:', tables.map(t => t.name).join(', '));

for (const t of tables) {
  const cols = db.prepare(`PRAGMA table_info("${t.name}")`).all() as { name: string; type: string }[];
  console.log(`\n--- ${t.name} ---`);
  console.log('Columns:', cols.map(c => `${c.name} (${c.type})`).join(', '));

  const count = db.prepare(`SELECT COUNT(*) as cnt FROM "${t.name}"`).get() as { cnt: number };
  console.log(`Rows: ${count.cnt}`);

  // Show first row
  const first = db.prepare(`SELECT * FROM "${t.name}" LIMIT 1`).get() as Record<string, unknown>;
  if (first) {
    console.log('Sample row:');
    for (const [k, v] of Object.entries(first)) {
      const val = typeof v === 'string' && v.length > 200 ? v.slice(0, 200) + '...' : v;
      console.log(`  ${k}: ${val}`);
    }
  }
}

db.close();
