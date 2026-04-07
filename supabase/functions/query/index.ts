import { serve } from 'https://deno.land/std@0.208.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.0';
import { callLLM } from '../shared/llm-adapter.ts';
import { embedTexts } from '../shared/embedding-adapter.ts';
import { extractSources } from '../shared/context-builder.ts';
import { QueryResponse } from '../shared/types.ts';

// --- Deterministic Query Analyzer ---
// Layer 1: Fast keyword matching (free, instant)
// Layer 2: Semantic search via embeddings (fallback for unusual phrasings)

const SECTION_KEYWORDS: Record<string, string[]> = {
  pregnancy: [
    'schwangerschaft', 'stillzeit', 'fertilität', 'schwanger', 'stillen', 'gestillt',
    'trimester', 'fetus', 'fetal', 'embryo', 'baby erwartet', 'geburt', 'wehen',
    'muttermilch', 'säugling', 'neugeboren', 'reproduktion', 'teratogen',
    'gestation', 'prenatal', 'perinatal', 'postnatal', 'laktation',
    'kinderwunsch', 'fruchtbarkeit', 'empfängnis', 'plazenta',
  ],
  contraindications: [
    'kontraindikation', 'kontraindiziert', 'darf nicht', 'gegenanzeige',
    'nicht anwenden', 'nicht einnehmen', 'nicht verwenden', 'verboten',
    'ausgeschlossen', 'nicht geben', 'nicht verabreichen',
  ],
  side_effects: [
    'nebenwirkung', 'unerwünschte wirkung', 'uaw', 'adverse',
    'verträglichkeit', 'unverträglichkeit', 'vertragen',
    'sicherheitsprofil', 'risiken', 'risiko', 'gefährlich', 'schädlich',
    'häufige beschwerden', 'komplikation',
  ],
  dosage: [
    'dosierung', 'dosis', 'anwendung', 'verabreich', 'einnahme',
    'wie viel', 'wieviel', 'maximaldosis', 'tagesdosis', 'einzeldosis',
    'einnehmen', 'applizieren', 'injizieren', 'infundieren',
    'dosisanpassung', 'niereninsuffizienz', 'leberinsuffizienz',
    'mg pro', 'mg/kg', 'tropfen', 'tablette', 'filmtablette',
  ],
  interactions: [
    'interaktion', 'wechselwirkung', 'kombination', 'zusammen mit', 'gleichzeitig',
    'kombinieren', 'komedikation', 'arzneimittelinteraktion', 'cyp',
    'verstärkt', 'abschwächt', 'beeinflusst', 'hemmt', 'induziert',
  ],
  warnings: [
    'warnhinweis', 'vorsichtsmassnahme', 'vorsicht', 'cave', 'achtung',
    'besondere vorsicht', 'sorgfältig', 'überwach', 'monitor',
    'risikofaktor', 'risikogruppe',
  ],
  indications: [
    'indikation', 'anwendungsgebiet', 'wofür', 'wozu', 'wann wird',
    'zugelassen für', 'eingesetzt bei', 'behandlung von', 'therapie von',
    'wirksam bei', 'hilft bei', 'helfen gegen', 'verschrieben bei',
  ],
  overdose: [
    'überdosierung', 'überdosis', 'intoxikation', 'vergiftung',
    'zu viel', 'zuviel eingenommen', 'versehentlich', 'akzidentell',
  ],
  composition: [
    'zusammensetzung', 'darreichungsform', 'hilfsstoff', 'enthält',
    'wirkstoffmenge', 'tablette', 'kapsel', 'lösung', 'galenik',
  ],
  pharmacokinetics: [
    'pharmakokinetik', 'halbwertszeit', 'elimination', 'bioverfügbarkeit',
    'metabolis', 'clearance', 'verteilungsvolumen', 'resorption', 'absorption',
    'ausscheidung', 'wie lange wirkt', 'wie schnell wirkt',
  ],
  pharmacodynamics: [
    'pharmakodynamik', 'wirkmechanismus', 'wirkungsweise', 'wie wirkt',
    'rezeptor', 'mechanismus', 'wirkprinzip',
  ],
  other: [
    'lagerung', 'aufbewahrung', 'haltbarkeit', 'sonstige hinweise',
    'temperatur', 'kühlschrank', 'lichtschutz',
  ],
  driving: [
    'fahrtüchtigkeit', 'fahren', 'maschinen bedienen', 'autofahren',
    'verkehrstüchtigkeit', 'reaktionsfähigkeit',
  ],
};

function detectSections(question: string): string[] {
  const q = question.toLowerCase();
  const matched: string[] = [];

  for (const [code, keywords] of Object.entries(SECTION_KEYWORDS)) {
    if (keywords.some(kw => q.includes(kw))) {
      matched.push(code);
    }
  }

  return matched; // Empty = no keywords matched → will trigger semantic search
}

function extractSearchTerms(question: string): string[] {
  const stopWords = new Set([
    'was', 'wie', 'welche', 'welcher', 'welches', 'wann', 'warum', 'wofür', 'wozu',
    'ist', 'sind', 'hat', 'haben', 'kann', 'können', 'soll', 'sollte', 'darf', 'dürfen',
    'bei', 'von', 'für', 'mit', 'und', 'oder', 'der', 'die', 'das', 'den', 'dem', 'des',
    'ein', 'eine', 'einen', 'einem', 'einer', 'nicht', 'kein', 'keine', 'wenn', 'ich',
    'man', 'mein', 'meine', 'meinem', 'meinen', 'sich', 'dieses', 'diesem', 'dieser',
    'auch', 'aber', 'noch', 'schon', 'dann', 'nur', 'sehr', 'mehr', 'werden', 'wird',
    'wurde', 'worden', 'wäre', 'wäre', 'könnte', 'müsste', 'würde', 'möchte',
    'nehmen', 'nehme', 'nimmt', 'eingenommen', 'einnehmen', 'geben', 'gibt',
    'medikament', 'medikamente', 'arzneimittel', 'präparat', 'mittel',
    'schwangerschaft', 'stillzeit', 'kontraindikation', 'kontraindikationen',
    'nebenwirkung', 'nebenwirkungen', 'dosierung', 'interaktion', 'interaktionen',
    'warnhinweise', 'indikation', 'indikationen', 'überdosierung',
    'wirkstoff', 'wirkstoffe', 'anwendung', 'zusammensetzung',
    'unerwünschte', 'wirkungen', 'wirkung', 'vorsichtsmassnahmen',
    'vergleich', 'vergleiche', 'verglichen', 'unterschied', 'unterschiede',
    'alle', 'welchem', 'welchen', 'dosis', 'therapie', 'behandlung',
    'patienten', 'kinder', 'kindern', 'erwachsene', 'erwachsenen',
    'profil', 'profile', 'uaw', 'während', 'nach', 'vor', 'über', 'unter',
    'baby', 'erwartet', 'erwartet', 'gleichzeitig', 'zusammen',
  ]);

  const words = question
    .replace(/[®™°\/?!.,;:()[\]{}""''„"«»]/g, ' ')
    .split(/\s+/)
    .filter(w => w.length > 2 && !stopWords.has(w.toLowerCase()));

  return words;
}

function getSupabase() {
  return createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  );
}

interface ProductResult {
  title: string;
  substances: string[];
  atc_code: string;
  information_update: string;
  sections: Array<{
    section_code: string;
    section_title: string;
    content: string;
    similarity?: number;
  }>;
}

interface SearchResult {
  products: ProductResult[];
  searchType: string;
  searchDetails: string[];
}

// --- Strategy 1 & 2: Product name / Substance match with keyword-detected sections ---
async function searchByNameAndSubstance(
  searchTerms: string[],
  sectionCodes: string[]
): Promise<SearchResult | null> {
  const supabase = getSupabase();

  for (const term of searchTerms) {
    if (term.length < 3) continue;

    // Try product name
    const { data: products } = await supabase
      .from('products')
      .select('id, title, substances, atc_code, information_update')
      .eq('lang', 'de')
      .ilike('title', `%${term}%`)
      .limit(3);

    if (products && products.length > 0) {
      const ids = products.map(p => p.id);
      const { data: sections } = await supabase
        .from('sections')
        .select('product_id, section_code, section_title, content')
        .in('product_id', ids)
        .in('section_code', sectionCodes);

      return {
        products: products.map(p => ({
          ...p,
          sections: (sections || []).filter(s => s.product_id === p.id),
        })),
        searchType: 'product_name',
        searchDetails: [`Produkt: "${term}"`, `Sektionen: ${sectionCodes.join(', ')}`],
      };
    }

    // Try substance
    const { data: subProducts } = await supabase
      .from('products')
      .select('id, title, substances, atc_code, information_update')
      .eq('lang', 'de')
      .contains('substances', [term])
      .limit(3);

    if (subProducts && subProducts.length > 0) {
      const ids = subProducts.map(p => p.id);
      const { data: sections } = await supabase
        .from('sections')
        .select('product_id, section_code, section_title, content')
        .in('product_id', ids)
        .in('section_code', sectionCodes);

      return {
        products: subProducts.map(p => ({
          ...p,
          sections: (sections || []).filter(s => s.product_id === p.id),
        })),
        searchType: 'substance',
        searchDetails: [`Wirkstoff: "${term}"`, `Sektionen: ${sectionCodes.join(', ')}`],
      };
    }
  }

  return null;
}

// --- Strategy 3: Semantic search (embedding-based) ---
// Finds relevant sections regardless of phrasing
async function searchSemantic(question: string, searchTerms: string[]): Promise<SearchResult> {
  const supabase = getSupabase();

  try {
    // Generate embedding for the question
    const [queryEmbedding] = await embedTexts([question]);

    // Find similar sections via the match_sections RPC
    const { data, error } = await supabase.rpc('match_sections', {
      query_embedding: queryEmbedding,
      match_threshold: 0.3,
      match_count: 10,
    });

    if (error) throw error;
    if (!data || data.length === 0) return { products: [], searchType: 'semantic', searchDetails: ['Keine semantischen Treffer'] };

    // Group by product
    const productMap = new Map<string, ProductResult>();
    for (const row of data) {
      const key = row.product_title;
      if (!productMap.has(key)) {
        productMap.set(key, {
          title: row.product_title,
          substances: row.substances || [],
          atc_code: row.atc_code || '',
          information_update: '',
          sections: [],
        });
      }
      productMap.get(key)!.sections.push({
        section_code: row.section_code,
        section_title: row.section_title,
        content: row.content,
        similarity: row.similarity,
      });
    }

    // If we have search terms, prioritize products matching those terms
    let products = Array.from(productMap.values());
    if (searchTerms.length > 0) {
      const matching = products.filter(p =>
        searchTerms.some(t =>
          p.title.toLowerCase().includes(t.toLowerCase()) ||
          p.substances.some(s => s.toLowerCase().includes(t.toLowerCase()))
        )
      );
      if (matching.length > 0) products = matching;
    }

    return {
      products: products.slice(0, 5),
      searchType: 'semantic',
      searchDetails: [`Top ${data.length} semantische Treffer`, `Beste Relevanz: ${((data[0]?.similarity || 0) * 100).toFixed(0)}%`],
    };
  } catch (err) {
    console.error('Semantic search error:', err);
    return { products: [], searchType: 'semantic_error', searchDetails: [String(err)] };
  }
}

// --- Strategy 4: Fulltext fallback ---
async function searchFulltext(searchTerms: string[], sectionCodes: string[]): Promise<SearchResult | null> {
  const supabase = getSupabase();
  const tsQuery = searchTerms.filter(t => t.length >= 3).join(' & ');
  if (!tsQuery) return null;

  const filterCodes = sectionCodes.length > 0 ? sectionCodes : undefined;

  let query = supabase
    .from('sections')
    .select(`
      product_id, section_code, section_title, content,
      products!inner(title, substances, atc_code, information_update)
    `)
    .textSearch('content_tsv', tsQuery, { type: 'plain', config: 'german' })
    .limit(8);

  if (filterCodes) {
    query = query.in('section_code', filterCodes);
  }

  const { data: sections } = await query;
  if (!sections || sections.length === 0) return null;

  const productMap = new Map<string, ProductResult>();
  for (const s of sections) {
    const p = (s as any).products;
    const key = p.title;
    if (!productMap.has(key)) {
      productMap.set(key, { ...p, sections: [] });
    }
    productMap.get(key)!.sections.push({
      section_code: s.section_code,
      section_title: s.section_title,
      content: s.content,
    });
  }

  return {
    products: Array.from(productMap.values()),
    searchType: 'fulltext',
    searchDetails: [`Volltext: "${tsQuery}"`],
  };
}

// --- Main search orchestrator ---
async function searchDatabase(question: string): Promise<SearchResult> {
  const sectionCodes = detectSections(question);
  const searchTerms = extractSearchTerms(question);
  const keywordsMatched = sectionCodes.length > 0;

  // Path A: Keywords matched sections → deterministic search (fast, free)
  if (keywordsMatched && searchTerms.length > 0) {
    const result = await searchByNameAndSubstance(searchTerms, sectionCodes);
    if (result && result.products.some(p => p.sections.length > 0)) {
      return result;
    }
  }

  // Path B: No keywords OR no product found → semantic search (uses embeddings)
  // This handles unusual phrasings like "Darf ich das Medikament nehmen wenn ich ein Baby erwarte?"
  const semanticResult = await searchSemantic(question, searchTerms);
  if (semanticResult.products.some(p => p.sections.length > 0)) {
    return semanticResult;
  }

  // Path C: Fulltext fallback
  if (searchTerms.length > 0) {
    const fulltextResult = await searchFulltext(searchTerms, sectionCodes);
    if (fulltextResult) return fulltextResult;
  }

  return { products: [], searchType: 'none', searchDetails: ['Keine Ergebnisse'] };
}

function buildContextFromResults(results: SearchResult): string {
  const parts: string[] = [];
  const MAX_SECTION_CHARS = 5000;

  for (const product of results.products) {
    parts.push(`\n---`);
    parts.push(`**Präparat:** ${product.title}`);
    if (product.substances?.length) {
      parts.push(`**Wirkstoffe:** ${Array.isArray(product.substances) ? product.substances.join(', ') : product.substances}`);
    }
    if (product.atc_code) parts.push(`**ATC:** ${product.atc_code}`);
    if (product.information_update) parts.push(`**Stand:** ${product.information_update}`);

    for (const sec of product.sections) {
      const title = sec.section_title || sec.section_code;
      const simNote = sec.similarity ? ` (Relevanz: ${(sec.similarity * 100).toFixed(0)}%)` : '';
      parts.push(`\n#### ${title}${simNote}`);
      if (sec.content.length > MAX_SECTION_CHARS) {
        parts.push(sec.content.slice(0, MAX_SECTION_CHARS) + '\n[... gekürzt ...]');
      } else {
        parts.push(sec.content);
      }
    }
  }

  return parts.join('\n');
}

const ANSWER_PROMPT = `Du bist SwissFachinfo, ein pharmazeutischer Fachinformations-Assistent.

Regeln:
- Beantworte die Frage basierend AUSSCHLIESSLICH auf den bereitgestellten Fachinformationen
- Belege JEDE Aussage: [Quelle: Präparatename, Abschnitt, Stand]
- NIEMALS Informationen erfinden oder aus deinem Training ergänzen
- Strukturiert mit Überschriften, Vergleichstabellen wo sinnvoll
- Sprache: Deutsch, pharmazeutische Fachsprache aber verständlich
- Wenn keine relevanten Informationen gefunden: Sage das ehrlich
- Gib die Informationen vollständig und detailliert wieder, kürze nicht unnötig`;

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const { question } = await req.json();

    if (!question || typeof question !== 'string') {
      return new Response(
        JSON.stringify({ error: 'Missing "question" field' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Step 1: Smart search (keywords → semantic → fulltext)
    const results = await searchDatabase(question);
    const context = buildContextFromResults(results);

    // Step 2: Single LLM call for answer generation
    const answerResponse = await callLLM([
      { role: 'system', content: ANSWER_PROMPT },
      {
        role: 'user',
        content: `Frage: ${question}\n\nGefundene Fachinformationen:\n${context || '(Keine Ergebnisse gefunden)'}\n\nBeantworte die Frage präzise und vollständig mit Quellenangaben.`
      },
    ], false);

    const response: QueryResponse = {
      answer: answerResponse.text,
      sources: extractSources(answerResponse.text),
      tools_used: [results.searchType],
      search_scope: results.searchDetails,
    };

    return new Response(
      JSON.stringify(response),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (err) {
    console.error('Query error:', err);
    return new Response(
      JSON.stringify({ error: 'Internal error', details: String(err) }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
