/**
 * Import Fachinfo sections from local XML file into Supabase sections table.
 * Uses SAX streaming parser for the 2GB XML file.
 * Resumeable: checks which products already have sections.
 * Usage: npm run import:sections
 *   or:  npm run import:sections -- --xml /path/to/aips_xml.xml
 *
 * By default looks for ./data/aips_xml.xml
 */
import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';
import sax from 'sax';
import fs from 'fs';
import path from 'path';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!
);

const BATCH_SIZE = 100;

function getXmlPath(): string {
  const args = process.argv.slice(2);
  const xmlIdx = args.indexOf('--xml');
  if (xmlIdx !== -1 && args[xmlIdx + 1]) {
    return path.resolve(args[xmlIdx + 1]);
  }
  const candidates = [
    path.resolve('data/aips_xml.xml'),
    path.resolve('aips_xml.xml'),
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

  // Direct match
  if (SECTION_MAP[lower]) return SECTION_MAP[lower];

  // Partial match
  for (const [key, code] of Object.entries(SECTION_MAP)) {
    if (lower.includes(key) || key.includes(lower)) return code;
  }

  return 'other';
}

// Strip HTML tags and clean text
function cleanContent(html: string): string {
  return html
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#\d+;/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

interface SectionData {
  product_title: string;
  section_code: string;
  section_title: string;
  content: string;
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
  console.log('Loading product map...');
  const productMap = await getProductMap();
  console.log(`Found ${productMap.size} products in DB`);

  console.log('Checking already imported sections...');
  const importedIds = await getImportedProductIds();
  console.log(`Already imported sections for ${importedIds.size} products`);

  const xmlPath = getXmlPath();
  if (!fs.existsSync(xmlPath)) {
    console.error(`XML file not found: ${xmlPath}`);
    console.error('Place aips_xml.xml in ./data/ or specify with --xml /path/to/file');
    process.exit(1);
  }

  const xmlSize = fs.statSync(xmlPath).size;
  console.log(`Reading XML: ${xmlPath} (${(xmlSize / 1024 / 1024).toFixed(0)} MB)`);
  console.log('Streaming XML with SAX parser...');

  // Parse XML using SAX
  const parser = sax.parser(true, { trim: true });

  let currentTitle = '';
  let inTitle = false;
  let inSection = false;
  let inContent = false;
  let sectionTitle = '';
  let contentBuffer = '';
  let tagStack: string[] = [];

  const pendingSections: Array<{
    product_id: number;
    section_code: string;
    section_title: string;
    content: string;
  }> = [];

  let totalParsed = 0;
  let totalInserted = 0;
  let totalSkipped = 0;

  parser.onopentag = (tag) => {
    tagStack.push(tag.name);

    if (tag.name === 'medicalInformation' || tag.name === 'fi' || tag.name === 'pi') {
      // Look for title attribute or child
      if (tag.attributes.title) {
        currentTitle = String(tag.attributes.title);
      }
    }

    if (tag.name === 'title' && (tagStack.includes('medicalInformation') || tagStack.includes('fi') || tagStack.includes('pi'))) {
      inTitle = true;
      currentTitle = '';
    }

    if (tag.name === 'section') {
      inSection = true;
      sectionTitle = '';
      contentBuffer = '';
    }

    if (tag.name === 'title' && inSection) {
      inTitle = true;
      sectionTitle = '';
    }

    if (tag.name === 'content' && inSection) {
      inContent = true;
      contentBuffer = '';
    }
  };

  parser.ontext = (text) => {
    if (inTitle && inSection) {
      sectionTitle += text;
    } else if (inTitle) {
      currentTitle += text;
    }
    if (inContent) {
      contentBuffer += text;
    }
  };

  parser.oncdata = (cdata) => {
    if (inContent) {
      contentBuffer += cdata;
    }
  };

  parser.onclosetag = (tagName) => {
    tagStack.pop();

    if (tagName === 'title') {
      inTitle = false;
    }

    if (tagName === 'content') {
      inContent = false;
    }

    if (tagName === 'section' && inSection) {
      inSection = false;

      if (currentTitle && contentBuffer.trim()) {
        const productId = productMap.get(currentTitle);

        if (productId && !importedIds.has(productId)) {
          const cleaned = cleanContent(contentBuffer);
          if (cleaned.length > 0) {
            const sectionCode = normalizeSectionCode(sectionTitle);

            // Avoid duplicate section_codes per product
            const existing = pendingSections.find(
              s => s.product_id === productId && s.section_code === sectionCode
            );

            if (!existing) {
              pendingSections.push({
                product_id: productId,
                section_code: sectionCode,
                section_title: sectionTitle.trim() || sectionCode,
                content: cleaned
              });
            }
          }
        }

        totalParsed++;
      }
    }

    if (tagName === 'medicalInformation' || tagName === 'fi' || tagName === 'pi') {
      // Flush pending sections for this product
      currentTitle = '';
    }
  };

  parser.onerror = (err) => {
    console.error('XML parse error:', err.message);
    parser.resume();
  };

  // Stream XML file through SAX parser in chunks (memory-efficient for 2GB file)
  const CHUNK_SIZE = 16 * 1024 * 1024; // 16 MB chunks
  const fd = fs.openSync(xmlPath, 'r');
  const fileSize = fs.statSync(xmlPath).size;
  const buf = Buffer.alloc(CHUNK_SIZE);
  let bytesRead = 0;
  let totalBytesRead = 0;

  while ((bytesRead = fs.readSync(fd, buf, 0, CHUNK_SIZE, null)) > 0) {
    parser.write(buf.slice(0, bytesRead).toString('utf-8'));
    totalBytesRead += bytesRead;
    process.stdout.write(`\rParsing XML: ${((totalBytesRead / fileSize) * 100).toFixed(1)}%`);
  }
  fs.closeSync(fd);
  parser.close();
  console.log('');

  console.log(`\nParsed ${totalParsed} sections from XML`);
  console.log(`Pending insert: ${pendingSections.length} sections`);

  // Batch insert
  for (let i = 0; i < pendingSections.length; i += BATCH_SIZE) {
    const batch = pendingSections.slice(i, i + BATCH_SIZE);

    const { error: insertError } = await supabase
      .from('sections')
      .upsert(batch, { onConflict: 'product_id,section_code' });

    if (insertError) {
      console.error(`Batch error at ${i}: ${insertError.message}`);
      totalSkipped += batch.length;
    } else {
      totalInserted += batch.length;
    }

    process.stdout.write(`\rInserted: ${totalInserted} / ${pendingSections.length} (skipped: ${totalSkipped})`);
  }

  console.log(`\n\nDone! Inserted: ${totalInserted}, Skipped: ${totalSkipped}`);
}

importSections().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
