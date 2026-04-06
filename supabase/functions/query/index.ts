import { serve } from 'https://deno.land/std@0.208.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.0';
import { callLLM } from '../shared/llm-adapter.ts';
import { extractSources } from '../shared/context-builder.ts';
import { QueryResponse } from '../shared/types.ts';

// --- Deterministic Query Analyzer ---
// No LLM needed: detect product/substance + section from keywords

const SECTION_KEYWORDS: Record<string, string[]> = {
  pregnancy: ['schwangerschaft', 'stillzeit', 'fertilität', 'schwanger', 'stillen', 'gestillt', 'trimester', 'fetus', 'fetal', 'embryo'],
  contraindications: ['kontraindikation', 'kontraindiziert', 'darf nicht', 'gegenanzeige'],
  side_effects: ['nebenwirkung', 'unerwünschte wirkung', 'uaw', 'adverse'],
  dosage: ['dosierung', 'dosis', 'anwendung', 'verabreich', 'einnahme', 'wie viel', 'wieviel'],
  interactions: ['interaktion', 'wechselwirkung', 'kombination', 'zusammen mit', 'gleichzeitig'],
  warnings: ['warnhinweis', 'vorsichtsmassnahme', 'vorsicht', 'cave'],
  indications: ['indikation', 'anwendungsgebiet', 'wofür', 'wozu', 'wann wird'],
  overdose: ['überdosierung', 'überdosis', 'intoxikation', 'vergiftung'],
  composition: ['zusammensetzung', 'wirkstoff', 'darreichungsform', 'hilfsstoff', 'enthält'],
  pharmacokinetics: ['pharmakokinetik', 'halbwertszeit', 'elimination', 'bioverfügbarkeit', 'metabolis'],
  pharmacodynamics: ['pharmakodynamik', 'wirkmechanismus', 'wirkungsweise'],
  other: ['lagerung', 'aufbewahrung', 'haltbarkeit', 'sonstige hinweise'],
  driving: ['fahrtüchtigkeit', 'fahren', 'maschinen bedienen'],
};

function detectSections(question: string): string[] {
  const q = question.toLowerCase();
  const matched: string[] = [];

  for (const [code, keywords] of Object.entries(SECTION_KEYWORDS)) {
    if (keywords.some(kw => q.includes(kw))) {
      matched.push(code);
    }
  }

  // Default to indications + contraindications + dosage if nothing detected
  return matched.length > 0 ? matched : ['indications', 'contraindications', 'dosage'];
}

function extractSearchTerms(question: string): string[] {
  // Remove common question words and section keywords to isolate product/substance names
  const stopWords = new Set([
    'was', 'wie', 'welche', 'welcher', 'welches', 'wann', 'warum', 'wofür', 'wozu',
    'ist', 'sind', 'hat', 'haben', 'kann', 'können', 'soll', 'sollte', 'darf', 'dürfen',
    'bei', 'von', 'für', 'mit', 'und', 'oder', 'der', 'die', 'das', 'den', 'dem', 'des',
    'ein', 'eine', 'einen', 'einem', 'einer', 'nicht', 'kein', 'keine',
    'schwangerschaft', 'stillzeit', 'kontraindikation', 'kontraindikationen',
    'nebenwirkung', 'nebenwirkungen', 'dosierung', 'interaktion', 'interaktionen',
    'warnhinweise', 'indikation', 'indikationen', 'überdosierung',
    'wirkstoff', 'wirkstoffe', 'anwendung', 'zusammensetzung',
    'unerwünschte', 'wirkungen', 'wirkung', 'vorsichtsmassnahmen',
    'vergleich', 'vergleiche', 'verglichen', 'unterschied', 'unterschiede',
    'alle', 'gibt', 'welchem', 'welchen', 'einnehmen', 'eingenommen',
    'dosis', 'therapie', 'behandlung', 'patienten', 'kinder', 'kindern',
    'erwachsene', 'erwachsenen', 'alternativ', 'alternative', 'alternativen',
    'profil', 'profile', 'uaw',
  ]);

  const words = question
    .replace(/[®™°\/?!.,;:()[\]{}""'']/g, ' ')
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

interface SearchResult {
  products: Array<{
    title: string;
    substances: string[];
    atc_code: string;
    information_update: string;
    sections: Array<{
      section_code: string;
      section_title: string;
      content: string;
    }>;
  }>;
  searchType: string;
  query: string;
}

async function searchDatabase(question: string): Promise<SearchResult> {
  const supabase = getSupabase();
  const sectionCodes = detectSections(question);
  const searchTerms = extractSearchTerms(question);
  const searchQuery = searchTerms.join(' ');

  // Strategy 1: Try exact product name match
  for (const term of searchTerms) {
    if (term.length < 3) continue;

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
        query: term,
      };
    }
  }

  // Strategy 2: Try substance search
  for (const term of searchTerms) {
    if (term.length < 3) continue;

    const { data: products } = await supabase
      .from('products')
      .select('id, title, substances, atc_code, information_update')
      .eq('lang', 'de')
      .contains('substances', [term])
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
        searchType: 'substance',
        query: term,
      };
    }
  }

  // Strategy 3: Fulltext search on sections
  const tsQuery = searchTerms.filter(t => t.length >= 3).join(' & ');
  if (tsQuery) {
    const { data: sections } = await supabase
      .from('sections')
      .select(`
        product_id, section_code, section_title, content,
        products!inner(title, substances, atc_code, information_update)
      `)
      .textSearch('content_tsv', tsQuery, { type: 'plain', config: 'german' })
      .in('section_code', sectionCodes)
      .limit(5);

    if (sections && sections.length > 0) {
      // Group by product
      const productMap = new Map<string, any>();
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
        query: tsQuery,
      };
    }
  }

  return { products: [], searchType: 'none', query: searchQuery };
}

function buildContextFromResults(results: SearchResult): string {
  const parts: string[] = [];
  const MAX_SECTION_CHARS = 4000;

  for (const product of results.products) {
    parts.push(`\n---`);
    parts.push(`**Präparat:** ${product.title}`);
    if (product.substances?.length) {
      parts.push(`**Wirkstoffe:** ${Array.isArray(product.substances) ? product.substances.join(', ') : product.substances}`);
    }
    if (product.atc_code) parts.push(`**ATC:** ${product.atc_code}`);
    if (product.information_update) parts.push(`**Stand:** ${product.information_update}`);

    for (const sec of product.sections) {
      parts.push(`\n#### ${sec.section_title || sec.section_code}`);
      if (sec.content.length > MAX_SECTION_CHARS) {
        parts.push(sec.content.slice(0, MAX_SECTION_CHARS) + '\n[... gekürzt ...]');
      } else {
        parts.push(sec.content);
      }
    }
  }

  return parts.join('\n');
}

// Shorter system prompt — only for answer generation (no tool instructions needed)
const ANSWER_PROMPT = `Du bist SwissFachinfo, ein pharmazeutischer Fachinformations-Assistent.

Regeln:
- Beantworte die Frage basierend AUSSCHLIESSLICH auf den bereitgestellten Fachinformationen
- Belege JEDE Aussage: [Quelle: Präparatename, Abschnitt, Stand]
- NIEMALS Informationen erfinden oder aus deinem Training ergänzen
- Strukturiert mit Überschriften, Vergleichstabellen wo sinnvoll
- Sprache: Deutsch, pharmazeutische Fachsprache aber verständlich
- Wenn keine relevanten Informationen gefunden: Sage das ehrlich`;

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

    // Step 1: Deterministic search (no LLM needed!)
    const results = await searchDatabase(question);
    const context = buildContextFromResults(results);
    const detectedSections = detectSections(question);

    // Step 2: Single LLM call for answer generation
    const answerResponse = await callLLM([
      { role: 'system', content: ANSWER_PROMPT },
      {
        role: 'user',
        content: `Frage: ${question}\n\nGefundene Fachinformationen:\n${context || '(Keine Ergebnisse gefunden)'}\n\nBeantworte die Frage präzise mit Quellenangaben.`
      },
    ], false);

    const response: QueryResponse = {
      answer: answerResponse.text,
      sources: extractSources(answerResponse.text),
      tools_used: [`${results.searchType}_search`],
      search_scope: [
        `${results.products.length} Präparate gefunden`,
        `Sektionen: ${detectedSections.join(', ')}`,
        `Suche: "${results.query}"`,
      ],
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
