/**
 * Import Fachinfo sections from local XML file into Supabase sections table.
 * Uses SAX streaming parser for the 2GB XML file.
 * Resumeable: checks which products already have sections.
 * Usage: npm run import:sections
 *   or:  npm run import:sections -- --xml /path/to/aips_xml.xml
 *
 * By default looks for ./data/AipsDownload_20250326.xml
 *
 * XML structure:
 *   <medicalInformation type="fi" lang="de" ...>
 *     <title>Product Name</title>
 *     <content><![CDATA[ ...full HTML with id="section1" markers... ]]></content>
 *     <sections>
 *       <section id="section1"><title>Product Name</title></section>
 *       <section id="section2"><title>Zusammensetzung</title></section>
 *       ...
 *     </sections>
 *   </medicalInformation>
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
    path.resolve('data/AipsDownload_20250326.xml'),
    path.resolve('data/aips_xml.xml'),
    path.resolve('AipsDownload_20250326.xml'),
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
  'galenische form und wirkstoffmenge pro einheit': 'composition',
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
  'darreichungsform und wirkstoffmenge pro einheit': 'composition',
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

/**
 * Split the CDATA HTML content by section ID markers.
 * The HTML contains elements like <div id="section1">, <div id="section2"> etc.
 * Returns a map of sectionId → HTML content for that section.
 */
function splitContentBySections(html: string, sectionIds: string[]): Map<string, string> {
  const result = new Map<string, string>();
  if (!html || sectionIds.length === 0) return result;

  // Build regex pattern to split by section markers
  // Section markers appear as id="section1", id="section2", etc.
  // They can be on div, p, or other elements
  for (let i = 0; i < sectionIds.length; i++) {
    const currentId = sectionIds[i];
    const nextId = sectionIds[i + 1];

    // Find content between current section marker and next section marker (or end)
    const startPattern = new RegExp(`id=["']${currentId}["']`, 'i');
    const startMatch = html.match(startPattern);

    if (!startMatch || startMatch.index === undefined) continue;

    let endIndex = html.length;
    if (nextId) {
      const endPattern = new RegExp(`id=["']${nextId}["']`, 'i');
      const endMatch = html.match(endPattern);
      if (endMatch && endMatch.index !== undefined) {
        // Go back to the start of the opening tag
        const tagStart = html.lastIndexOf('<', endMatch.index);
        if (tagStart !== -1) {
          endIndex = tagStart;
        } else {
          endIndex = endMatch.index;
        }
      }
    }

    const sectionHtml = html.slice(startMatch.index, endIndex);
    result.set(currentId, sectionHtml);
  }

  return result;
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

interface SectionMeta {
  id: string;   // e.g. "section1"
  title: string; // e.g. "Zusammensetzung"
}

interface MedInfoCollector {
  title: string;
  contentCdata: string;
  sectionMetas: SectionMeta[];
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
    console.error('Place the XML file in ./data/ or specify with --xml /path/to/file');
    process.exit(1);
  }

  const xmlSize = fs.statSync(xmlPath).size;
  console.log(`Reading XML: ${xmlPath} (${(xmlSize / 1024 / 1024).toFixed(0)} MB)`);
  console.log('Streaming XML with SAX parser...');

  const parser = sax.parser(true, { trim: false });

  // State tracking
  let inMedInfo = false;
  let inMedInfoTitle = false;    // <title> directly under <medicalInformation>
  let inContent = false;         // <content> under <medicalInformation>
  let inSections = false;        // <sections> block
  let inSectionMeta = false;     // <section> inside <sections>
  let inSectionMetaTitle = false; // <title> inside <section> inside <sections>
  let tagDepth = 0;

  let collector: MedInfoCollector = { title: '', contentCdata: '', sectionMetas: [] };
  let currentSectionMetaId = '';
  let currentSectionMetaTitle = '';

  const pendingSections: Array<{
    product_id: number;
    section_code: string;
    section_title: string;
    content: string;
  }> = [];

  let totalProducts = 0;
  let totalSections = 0;
  let matchedProducts = 0;
  let skippedAlreadyImported = 0;

  async function processCollectedMedInfo() {
    totalProducts++;

    const title = collector.title.trim();
    if (!title) return;

    const productId = productMap.get(title);
    if (!productId) return;

    matchedProducts++;

    if (importedIds.has(productId)) {
      skippedAlreadyImported++;
      return;
    }

    const html = collector.contentCdata;
    const sectionMetas = collector.sectionMetas;

    if (!html || sectionMetas.length === 0) return;

    // Split HTML by section IDs
    const sectionIds = sectionMetas.map(s => s.id);
    const splitSections = splitContentBySections(html, sectionIds);

    // Track seen section_codes to avoid duplicates per product
    const seenCodes = new Set<string>();

    for (const meta of sectionMetas) {
      const sectionHtml = splitSections.get(meta.id);
      if (!sectionHtml) continue;

      const cleaned = cleanContent(sectionHtml);
      if (cleaned.length < 3) continue; // Skip empty/trivial sections

      const sectionCode = normalizeSectionCode(meta.title);

      if (seenCodes.has(sectionCode)) continue;
      seenCodes.add(sectionCode);

      pendingSections.push({
        product_id: productId,
        section_code: sectionCode,
        section_title: meta.title.trim(),
        content: cleaned,
      });
      totalSections++;
    }
  }

  parser.onopentag = (tag) => {
    tagDepth++;

    if (tag.name === 'medicalInformation') {
      inMedInfo = true;
      collector = { title: '', contentCdata: '', sectionMetas: [] };
      return;
    }

    if (!inMedInfo) return;

    // <title> directly under <medicalInformation> (not inside <sections>)
    if (tag.name === 'title' && !inSections && !inContent) {
      inMedInfoTitle = true;
      return;
    }

    // <content> under <medicalInformation>
    if (tag.name === 'content' && !inSections) {
      inContent = true;
      collector.contentCdata = '';
      return;
    }

    // <sections> block
    if (tag.name === 'sections') {
      inSections = true;
      return;
    }

    // <section id="sectionN"> inside <sections>
    if (tag.name === 'section' && inSections) {
      inSectionMeta = true;
      currentSectionMetaId = String(tag.attributes.id || '');
      currentSectionMetaTitle = '';
      return;
    }

    // <title> inside <section> inside <sections>
    if (tag.name === 'title' && inSectionMeta) {
      inSectionMetaTitle = true;
      currentSectionMetaTitle = '';
      return;
    }
  };

  parser.ontext = (text) => {
    if (inMedInfoTitle) {
      collector.title += text;
    }
    if (inContent) {
      collector.contentCdata += text;
    }
    if (inSectionMetaTitle) {
      currentSectionMetaTitle += text;
    }
  };

  parser.oncdata = (cdata) => {
    if (inContent) {
      collector.contentCdata += cdata;
    }
  };

  parser.onclosetag = (tagName) => {
    tagDepth--;

    if (tagName === 'title' && inSectionMetaTitle) {
      inSectionMetaTitle = false;
      return;
    }

    if (tagName === 'title' && inMedInfoTitle) {
      inMedInfoTitle = false;
      return;
    }

    if (tagName === 'content' && inContent) {
      inContent = false;
      return;
    }

    if (tagName === 'section' && inSectionMeta) {
      inSectionMeta = false;
      if (currentSectionMetaId) {
        collector.sectionMetas.push({
          id: currentSectionMetaId,
          title: currentSectionMetaTitle.trim(),
        });
      }
      return;
    }

    if (tagName === 'sections' && inSections) {
      inSections = false;
      return;
    }

    if (tagName === 'medicalInformation' && inMedInfo) {
      inMedInfo = false;
      processCollectedMedInfo();
    }
  };

  parser.onerror = (err) => {
    console.error('XML parse error:', err.message);
    parser.resume();
  };

  // Stream XML file through SAX parser in chunks
  const CHUNK_SIZE = 16 * 1024 * 1024; // 16 MB
  const fd = fs.openSync(xmlPath, 'r');
  const buf = Buffer.alloc(CHUNK_SIZE);
  let bytesRead = 0;
  let totalBytesRead = 0;

  while ((bytesRead = fs.readSync(fd, buf, 0, CHUNK_SIZE, null)) > 0) {
    parser.write(buf.slice(0, bytesRead).toString('utf-8'));
    totalBytesRead += bytesRead;
    process.stdout.write(`\rParsing XML: ${((totalBytesRead / xmlSize) * 100).toFixed(1)}% | Products: ${totalProducts} | Sections: ${totalSections}`);
  }
  fs.closeSync(fd);
  parser.close();
  console.log('');

  console.log(`\nXML parsing complete:`);
  console.log(`  Total products in XML: ${totalProducts}`);
  console.log(`  Matched to DB: ${matchedProducts}`);
  console.log(`  Skipped (already imported): ${skippedAlreadyImported}`);
  console.log(`  Sections to insert: ${pendingSections.length}`);

  if (pendingSections.length === 0) {
    console.log('No sections to insert.');
    return;
  }

  // Batch insert
  let totalInserted = 0;
  let totalSkipped = 0;

  for (let i = 0; i < pendingSections.length; i += BATCH_SIZE) {
    const batch = pendingSections.slice(i, i + BATCH_SIZE);

    const { error: insertError } = await supabase
      .from('sections')
      .upsert(batch, { onConflict: 'product_id,section_code' });

    if (insertError) {
      console.error(`\nBatch error at ${i}: ${insertError.message}`);
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
