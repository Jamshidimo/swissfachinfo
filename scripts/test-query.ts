import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';

async function main() {
  const sb = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_KEY!);

  // Find Ibuprofen products
  const { data: products } = await sb.from('products').select('id, title').ilike('title', '%Ibuprofen%').limit(5);
  console.log('Ibuprofen products:', products?.map(p => `${p.id}: ${p.title}`));

  if (products && products.length > 0) {
    const ids = products.map(p => p.id);

    // Check what section codes exist for these products
    const { data: sections } = await sb
      .from('sections')
      .select('product_id, section_code, section_title, content')
      .in('product_id', ids)
      .eq('section_code', 'pregnancy');

    console.log(`\nPregnancy sections found: ${sections?.length || 0}`);
    if (sections && sections.length > 0) {
      for (const s of sections.slice(0, 2)) {
        console.log(`  Product ${s.product_id}: "${s.section_title}" (${s.content.length} chars)`);
        console.log(`  Preview: ${s.content.slice(0, 200)}...`);
      }
    }

    // Show all section codes for first product
    const { data: allSections } = await sb
      .from('sections')
      .select('section_code, section_title')
      .eq('product_id', ids[0]);

    console.log(`\nAll sections for ${products[0].title}:`);
    allSections?.forEach(s => console.log(`  ${s.section_code}: ${s.section_title}`));
  }
}

main();
