import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';

async function main() {
  const sb = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_KEY!);

  // Test 1: Simple search (works)
  const { data, error } = await sb.from('products').select('title').ilike('title', '%liquis%').limit(5);
  console.log('Without lang filter:', data, error);

  // Test 2: With lang='de' filter (what Edge Function does)
  const { data: d2, error: e2 } = await sb.from('products').select('title, lang').ilike('title', '%liquis%').eq('lang', 'de').limit(5);
  console.log('With lang=de:', d2, e2);

  // Test 3: Check what lang values exist
  const { data: d3 } = await sb.from('products').select('lang').ilike('title', '%liquis%').limit(5);
  console.log('Lang values:', d3);

  // Test 4: With anon key (what the Edge Function might be using)
  const sbAnon = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_ANON_KEY!);
  const { data: d4, error: e4 } = await sbAnon.from('products').select('title').ilike('title', '%liquis%').limit(5);
  console.log('Anon key:', d4, e4);
}

main();
