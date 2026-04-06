import { serve } from 'https://deno.land/std@0.208.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.0';
import { embedTexts } from '../shared/embedding-adapter.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_KEY')!
    );

    const { batch_size } = await req.json().catch(() => ({ batch_size: 50 }));
    const limit = Math.min(batch_size || 50, 100);

    const { data: sections, error } = await supabase
      .from('sections')
      .select('id, content')
      .is('embedding', null)
      .limit(limit);

    if (error) throw error;
    if (!sections || sections.length === 0) {
      return new Response(
        JSON.stringify({ message: 'All sections already have embeddings', processed: 0 }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const embeddings = await embedTexts(sections.map(s => s.content));

    let updated = 0;
    for (let i = 0; i < sections.length; i++) {
      const { error: updateError } = await supabase
        .from('sections')
        .update({ embedding: embeddings[i] as any })
        .eq('id', sections[i].id);

      if (!updateError) updated++;
    }

    const { count } = await supabase
      .from('sections')
      .select('*', { count: 'exact', head: true })
      .is('embedding', null);

    return new Response(
      JSON.stringify({ processed: updated, remaining: count }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (err) {
    console.error('Embed error:', err);
    return new Response(
      JSON.stringify({ error: String(err) }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
