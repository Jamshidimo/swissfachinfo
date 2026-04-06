/**
 * Generate embeddings for sections that don't have one yet.
 * Uses Jina AI Embeddings v3. Resumeable - can be interrupted and restarted.
 *
 * Usage:
 *   npm run import:embeddings              # Run embedding generation
 *   npm run import:embeddings -- --dry-run  # Estimate token usage only
 */
import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!
);

const JINA_API_KEY = process.env.EMBEDDING_API_KEY!;
const JINA_MODEL = process.env.EMBEDDING_MODEL || 'jina-embeddings-v3';
const BATCH_SIZE = 25;
const RATE_LIMIT_MS = 2500; // ~60k tokens/min to stay under 100k/min limit
const MAX_CHARS = 1400; // Truncate to save tokens (~9M for 10M budget)

// Only embed these medically relevant section codes
const EMBED_SECTIONS = new Set([
  'composition',       // Zusammensetzung / Darreichungsform und Wirkstoffmenge
  'indications',       // Indikationen
  'dosage',            // Dosierung/Anwendung
  'contraindications', // Kontraindikationen
  'warnings',          // Warnhinweise und Vorsichtsmassnahmen
  'interactions',      // Interaktionen
  'side_effects',      // Unerwünschte Wirkungen
  'pregnancy',         // Schwangerschaft/Stillzeit
  'overdose',          // Überdosierung
  'other',             // Sonstige Hinweise (inkl. Lagerung)
]);

const DRY_RUN = process.argv.includes('--dry-run');

// Rough token estimate: ~4 chars per token for German text
function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

async function embedTexts(texts: string[]): Promise<number[][]> {
  const response = await fetch('https://api.jina.ai/v1/embeddings', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${JINA_API_KEY}`,
    },
    body: JSON.stringify({
      model: JINA_MODEL,
      input: texts,
      encoding_type: 'float',
      task: 'retrieval.passage',
      dimensions: 1024,
    }),
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`Jina API error ${response.status}: ${err}`);
  }

  const result = await response.json();
  return result.data.map((d: { embedding: number[] }) => d.embedding);
}

async function generateEmbeddings(): Promise<void> {
  // First, count all sections without embeddings, grouped by section_code
  console.log('Analyzing sections...\n');

  // Get total count
  const { count: totalCount } = await supabase
    .from('sections')
    .select('*', { count: 'exact', head: true })
    .is('embedding', null);

  console.log(`Total sections without embeddings: ${totalCount}`);

  // Estimate by fetching all sections we'd process
  let totalTokens = 0;
  let sectionsToEmbed = 0;
  let sectionsToSkip = 0;
  let offset = 0;
  const pageSize = 1000;

  // For dry run, scan everything. For real run, we process in batches later.
  if (DRY_RUN) {
    console.log('\n--- DRY RUN: Estimating token usage ---\n');

    const codeCounts: Record<string, { count: number; tokens: number }> = {};

    while (true) {
      const { data, error } = await supabase
        .from('sections')
        .select('section_code, content')
        .is('embedding', null)
        .range(offset, offset + pageSize - 1);

      if (error) throw error;
      if (!data || data.length === 0) break;

      for (const row of data) {
        const code = row.section_code;
        const truncated = row.content.slice(0, MAX_CHARS);
        const tokens = estimateTokens(truncated);

        if (!codeCounts[code]) codeCounts[code] = { count: 0, tokens: 0 };
        codeCounts[code].count++;
        codeCounts[code].tokens += tokens;

        if (EMBED_SECTIONS.has(code)) {
          sectionsToEmbed++;
          totalTokens += tokens;
        } else {
          sectionsToSkip++;
        }
      }

      offset += data.length;
      if (data.length < pageSize) break;
    }

    console.log('Section breakdown:');
    const sorted = Object.entries(codeCounts).sort((a, b) => b[1].tokens - a[1].tokens);
    for (const [code, info] of sorted) {
      const include = EMBED_SECTIONS.has(code) ? '' : ' [SKIP]';
      console.log(`  ${code}: ${info.count} sections, ~${(info.tokens / 1000).toFixed(0)}k tokens${include}`);
    }

    console.log(`\nSections to embed: ${sectionsToEmbed}`);
    console.log(`Sections to skip:  ${sectionsToSkip}`);
    console.log(`Estimated tokens:  ~${(totalTokens / 1_000_000).toFixed(2)}M tokens`);
    console.log(`\n(with MAX_CHARS=${MAX_CHARS} truncation)`);
    return;
  }

  // --- REAL RUN ---
  if (!JINA_API_KEY) {
    console.error('EMBEDDING_API_KEY not set in .env');
    process.exit(1);
  }

  const includeList = Array.from(EMBED_SECTIONS);

  let totalEmbedded = 0;
  let totalErrors = 0;

  // Count how many we'll actually embed
  const { count: embedCount } = await supabase
    .from('sections')
    .select('*', { count: 'exact', head: true })
    .is('embedding', null)
    .in('section_code', includeList);

  console.log(`Sections to embed (${includeList.length} section types): ${embedCount}`);

  while (true) {
    const { data: sections, error } = await supabase
      .from('sections')
      .select('id, section_code, content')
      .is('embedding', null)
      .in('section_code', includeList)
      .limit(BATCH_SIZE);

    if (error) throw error;
    if (!sections || sections.length === 0) break;

    try {
      const texts = sections.map(s => s.content.slice(0, MAX_CHARS));
      const embeddings = await embedTexts(texts);

      for (let i = 0; i < sections.length; i++) {
        const { error: updateError } = await supabase
          .from('sections')
          .update({ embedding: embeddings[i] as any })
          .eq('id', sections[i].id);

        if (updateError) {
          console.error(`\nError updating section ${sections[i].id}: ${updateError.message}`);
          totalErrors++;
        } else {
          totalEmbedded++;
        }
      }

      const remaining = (embedCount || 0) - totalEmbedded;
      process.stdout.write(`\rEmbedded: ${totalEmbedded} / ${embedCount} | Errors: ${totalErrors} | Remaining: ~${remaining}`);
    } catch (err) {
      console.error(`\nBatch error: ${err}`);
      totalErrors += sections.length;
      await new Promise(r => setTimeout(r, 5000));
      continue;
    }

    await new Promise(r => setTimeout(r, RATE_LIMIT_MS));
  }

  console.log(`\n\nDone! Embedded: ${totalEmbedded}, Errors: ${totalErrors}`);

  if (totalEmbedded > 0) {
    console.log('\nRun in Supabase SQL Editor to create the search index:');
    console.log('CREATE INDEX idx_sections_embedding ON sections USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);');
  }
}

generateEmbeddings().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
