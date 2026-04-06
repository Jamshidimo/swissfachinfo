/**
 * Verify the import was successful. Shows statistics.
 * Run: npm run import:verify
 */
import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!
);

async function verify(): Promise<void> {
  console.log('=== SwissFachinfo Import Verification ===\n');

  // Products count
  const { count: productCount } = await supabase
    .from('products')
    .select('*', { count: 'exact', head: true });
  console.log(`Products total: ${productCount}`);

  // Products by language
  for (const lang of ['de', 'fr', 'it']) {
    const { count } = await supabase
      .from('products')
      .select('*', { count: 'exact', head: true })
      .eq('lang', lang);
    console.log(`  - ${lang}: ${count}`);
  }

  // Sections count
  const { count: sectionCount } = await supabase
    .from('sections')
    .select('*', { count: 'exact', head: true });
  console.log(`\nSections total: ${sectionCount}`);

  // Sections by code
  const { data: sectionStats } = await supabase
    .rpc('get_section_stats');

  // Products without sections
  const { count: orphanCount } = await supabase
    .from('products')
    .select('id', { count: 'exact', head: true })
    .not('id', 'in',
      supabase.from('sections').select('product_id')
    );
  console.log(`\nProducts without sections: ${orphanCount}`);

  // Embeddings
  const { count: embeddedCount } = await supabase
    .from('sections')
    .select('*', { count: 'exact', head: true })
    .not('embedding', 'is', null);
  console.log(`\nSections with embeddings: ${embeddedCount} / ${sectionCount}`);

  // Sample products
  console.log('\n--- Sample Products ---');
  const { data: samples } = await supabase
    .from('products')
    .select('title, atc_code, substances, lang')
    .limit(5);

  for (const s of samples || []) {
    console.log(`  ${s.title} [${s.atc_code}] (${s.lang}) - ${s.substances?.join(', ')}`);
  }

  // Sample sections
  console.log('\n--- Sample Sections ---');
  const { data: sampleSections } = await supabase
    .from('sections')
    .select('section_code, section_title, content_length, product_id')
    .limit(5);

  for (const s of sampleSections || []) {
    console.log(`  Product ${s.product_id}: ${s.section_code} (${s.section_title}) - ${s.content_length} chars`);
  }

  console.log('\n=== Verification Complete ===');
}

verify().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
