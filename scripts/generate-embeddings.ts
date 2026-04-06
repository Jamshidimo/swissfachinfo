/**
 * Generate embeddings for all sections that don't have one yet.
 * Uses Jina AI Embeddings v3. Resumeable - can be interrupted and restarted.
 * Run: npm run import:embeddings
 */
import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!
);

const JINA_API_KEY = process.env.EMBEDDING_API_KEY!;
const JINA_MODEL = process.env.EMBEDDING_MODEL || 'jina-embeddings-v3';
const BATCH_SIZE = 50;
const RATE_LIMIT_MS = 500;
const MAX_CHARS = 8000; // Jina v3 max input length

async function embedTexts(texts: string[]): Promise<number[][]> {
  const response = await fetch('https://api.jina.ai/v1/embeddings', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${JINA_API_KEY}`
    },
    body: JSON.stringify({
      model: JINA_MODEL,
      input: texts.map(t => t.slice(0, MAX_CHARS)),
      encoding_type: 'float'
    })
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`Jina API error ${response.status}: ${err}`);
  }

  const result = await response.json();
  return result.data.map((d: { embedding: number[] }) => d.embedding);
}

async function generateEmbeddings(): Promise<void> {
  let totalEmbedded = 0;
  let totalErrors = 0;

  // Count remaining
  const { count } = await supabase
    .from('sections')
    .select('*', { count: 'exact', head: true })
    .is('embedding', null);

  console.log(`Sections without embeddings: ${count}`);

  while (true) {
    const { data: sections, error } = await supabase
      .from('sections')
      .select('id, content')
      .is('embedding', null)
      .limit(BATCH_SIZE);

    if (error) throw error;
    if (!sections || sections.length === 0) break;

    try {
      const embeddings = await embedTexts(sections.map(s => s.content));

      // Update each section with its embedding
      for (let i = 0; i < sections.length; i++) {
        const { error: updateError } = await supabase
          .from('sections')
          .update({ embedding: embeddings[i] as any })
          .eq('id', sections[i].id);

        if (updateError) {
          console.error(`Error updating section ${sections[i].id}: ${updateError.message}`);
          totalErrors++;
        } else {
          totalEmbedded++;
        }
      }

      process.stdout.write(`\rEmbedded: ${totalEmbedded} (errors: ${totalErrors}, remaining: ~${(count || 0) - totalEmbedded})`);
    } catch (err) {
      console.error(`\nBatch error: ${err}`);
      totalErrors += sections.length;
      // Wait longer on error (rate limit)
      await new Promise(r => setTimeout(r, 5000));
      continue;
    }

    // Rate limit
    await new Promise(r => setTimeout(r, RATE_LIMIT_MS));
  }

  console.log(`\n\nDone! Embedded: ${totalEmbedded}, Errors: ${totalErrors}`);

  if (totalEmbedded > 0) {
    console.log('\nNow create the IVFFlat index for fast similarity search:');
    console.log('Run in Supabase SQL Editor:');
    console.log('CREATE INDEX idx_sections_embedding ON sections USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);');
  }
}

generateEmbeddings().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
