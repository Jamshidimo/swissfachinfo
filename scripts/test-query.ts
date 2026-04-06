import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';

async function main() {
  const sb = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_KEY!);

  const { data, error } = await sb.from('products').select('title').ilike('title', '%liquis%').limit(5);
  console.log('Eliquis search:', data, error);

  const { data: d2 } = await sb.from('products').select('title').limit(3);
  console.log('First 3:', d2);
}

main();
