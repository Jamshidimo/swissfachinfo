import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.0';
import { ToolCall, ToolResult } from './types.ts';
import { embedTexts } from './embedding-adapter.ts';

function getSupabase() {
  return createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  );
}

async function searchByProduct(params: Record<string, unknown>): Promise<unknown[]> {
  const supabase = getSupabase();
  const name = params.product_name as string;
  const sections = params.sections as string[] | undefined;
  const lang = (params.lang as string) || 'de';

  // Find products matching the name (fuzzy)
  let query = supabase
    .from('products')
    .select('id, title, auth_holder, atc_code, substances, information_update')
    .eq('lang', lang)
    .ilike('title', `%${name}%`)
    .limit(10);

  const { data: products, error } = await query;
  if (error) throw error;
  if (!products || products.length === 0) return [];

  // Get sections for found products
  const productIds = products.map(p => p.id);
  let sectionsQuery = supabase
    .from('sections')
    .select('product_id, section_code, section_title, content')
    .in('product_id', productIds);

  if (sections && sections.length > 0) {
    sectionsQuery = sectionsQuery.in('section_code', sections);
  }

  const { data: sectionData, error: secError } = await sectionsQuery;
  if (secError) throw secError;

  // Combine
  return products.map(p => ({
    ...p,
    sections: (sectionData || []).filter(s => s.product_id === p.id),
  }));
}

async function searchBySubstance(params: Record<string, unknown>): Promise<unknown[]> {
  const supabase = getSupabase();
  const substance = params.substance as string;
  const sections = params.sections as string[] | undefined;

  const { data: products, error } = await supabase
    .from('products')
    .select('id, title, auth_holder, atc_code, substances, information_update')
    .eq('lang', 'de')
    .contains('substances', [substance])
    .order('title')
    .limit(50);

  if (error) throw error;
  if (!products || products.length === 0) {
    // Fallback: try ilike on substance array as text
    const { data: fallback } = await supabase
      .from('products')
      .select('id, title, auth_holder, atc_code, substances, information_update')
      .eq('lang', 'de')
      .ilike('title', `%${substance}%`)
      .limit(50);

    if (!fallback || fallback.length === 0) return [];

    const ids = fallback.map(p => p.id);
    let sq = supabase.from('sections').select('product_id, section_code, section_title, content').in('product_id', ids);
    if (sections?.length) sq = sq.in('section_code', sections);
    const { data: sd } = await sq;

    return fallback.map(p => ({ ...p, sections: (sd || []).filter(s => s.product_id === p.id) }));
  }

  const ids = products.map(p => p.id);
  let sq = supabase.from('sections').select('product_id, section_code, section_title, content').in('product_id', ids);
  if (sections?.length) sq = sq.in('section_code', sections);
  const { data: sd } = await sq;

  return products.map(p => ({ ...p, sections: (sd || []).filter(s => s.product_id === p.id) }));
}

async function searchByAtc(params: Record<string, unknown>): Promise<unknown[]> {
  const supabase = getSupabase();
  const atcCode = params.atc_code as string;
  const sections = params.sections as string[] | undefined;

  const { data: products, error } = await supabase
    .from('products')
    .select('id, title, auth_holder, atc_code, substances, information_update')
    .eq('lang', 'de')
    .ilike('atc_code', `${atcCode}%`)
    .order('atc_code, title')
    .limit(100);

  if (error) throw error;
  if (!products || products.length === 0) return [];

  const ids = products.map(p => p.id);
  let sq = supabase.from('sections').select('product_id, section_code, section_title, content').in('product_id', ids);
  if (sections?.length) sq = sq.in('section_code', sections);
  const { data: sd } = await sq;

  return products.map(p => ({ ...p, sections: (sd || []).filter(s => s.product_id === p.id) }));
}

async function searchByIndication(params: Record<string, unknown>): Promise<unknown[]> {
  const supabase = getSupabase();
  const query = params.indication_query as string;
  const atcFilter = params.atc_filter as string | undefined;

  // Use fulltext search on indications sections
  const tsQuery = query.split(/\s+/).filter(Boolean).join(' & ');

  let rpcQuery = supabase
    .from('sections')
    .select(`
      id, product_id, section_code, section_title, content,
      products!inner(id, title, atc_code, substances, information_update)
    `)
    .eq('section_code', 'indications')
    .textSearch('content_tsv', tsQuery, { type: 'plain', config: 'german' })
    .limit(30);

  const { data, error } = await rpcQuery;
  if (error) throw error;

  return data || [];
}

async function compareProducts(params: Record<string, unknown>): Promise<unknown[]> {
  const supabase = getSupabase();
  const names = params.product_names as string[];
  const sections = params.sections as string[];

  const results = [];
  for (const name of names) {
    const { data: products } = await supabase
      .from('products')
      .select('id, title, auth_holder, atc_code, substances, information_update')
      .eq('lang', 'de')
      .ilike('title', `%${name}%`)
      .limit(1);

    if (products && products.length > 0) {
      const p = products[0];
      const { data: sd } = await supabase
        .from('sections')
        .select('section_code, section_title, content')
        .eq('product_id', p.id)
        .in('section_code', sections);

      results.push({ ...p, sections: sd || [] });
    }
  }

  return results;
}

async function fulltextSearch(params: Record<string, unknown>): Promise<unknown[]> {
  const supabase = getSupabase();
  const query = params.query as string;
  const sectionFilter = params.section_filter as string[] | undefined;
  const atcFilter = params.atc_filter as string | undefined;
  const limit = (params.limit as number) || 20;

  const tsQuery = query.split(/\s+/).filter(Boolean).join(' & ');

  let q = supabase
    .from('sections')
    .select(`
      id, product_id, section_code, section_title, content,
      products!inner(id, title, atc_code, substances, information_update)
    `)
    .textSearch('content_tsv', tsQuery, { type: 'plain', config: 'german' })
    .limit(limit);

  if (sectionFilter?.length) {
    q = q.in('section_code', sectionFilter);
  }

  if (atcFilter) {
    q = q.ilike('products.atc_code', `${atcFilter}%`);
  }

  const { data, error } = await q;
  if (error) throw error;

  return data || [];
}

async function semanticSearch(params: Record<string, unknown>): Promise<unknown[]> {
  const supabase = getSupabase();
  const query = params.query as string;
  const sectionFilter = params.section_filter as string[] | undefined;
  const atcFilter = params.atc_filter as string | undefined;
  const topK = (params.top_k as number) || 30;

  // Generate query embedding
  const [queryEmbedding] = await embedTexts([query]);

  // Use the match_sections RPC function
  const { data, error } = await supabase.rpc('match_sections', {
    query_embedding: queryEmbedding,
    match_threshold: 0.3,
    match_count: topK,
    filter_section_codes: sectionFilter || null,
    filter_atc_prefix: atcFilter || null,
  });

  if (error) throw error;

  return data || [];
}

export async function executeToolCall(toolCall: ToolCall): Promise<ToolResult> {
  let data: unknown[];

  try {
    switch (toolCall.name) {
      case 'search_by_product':
        data = await searchByProduct(toolCall.parameters);
        break;
      case 'search_by_substance':
        data = await searchBySubstance(toolCall.parameters);
        break;
      case 'search_by_atc':
        data = await searchByAtc(toolCall.parameters);
        break;
      case 'search_by_indication':
        data = await searchByIndication(toolCall.parameters);
        break;
      case 'compare_products':
        data = await compareProducts(toolCall.parameters);
        break;
      case 'fulltext_search':
        data = await fulltextSearch(toolCall.parameters);
        break;
      case 'semantic_search':
        data = await semanticSearch(toolCall.parameters);
        break;
      default:
        throw new Error(`Unknown tool: ${toolCall.name}`);
    }
  } catch (err) {
    console.error(`Tool ${toolCall.name} error:`, err);
    data = [];
  }

  return {
    tool: toolCall.name,
    params: toolCall.parameters,
    data,
    count: data.length,
  };
}
