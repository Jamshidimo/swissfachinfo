import { serve } from 'https://deno.land/std@0.208.0/http/server.ts';
import { callLLM } from '../shared/llm-adapter.ts';
import { executeToolCall } from '../shared/tools.ts';
import { buildContext, extractSources } from '../shared/context-builder.ts';
import { QueryResponse, ToolCall } from '../shared/types.ts';

const SYSTEM_PROMPT = `Du bist SwissFachinfo, ein pharmazeutischer Fachinformations-Assistent für in der Schweiz zugelassene Arzneimittel.

## Deine Datenquelle
Du hast Zugriff auf die offiziellen Fachinformationen (FI) aller von Swissmedic zugelassenen Arzneimittel. Diese Daten stammen aus der AIPS-Datenbank (Arzneimittelinformations-Publikationssystem).

## Deine Aufgabe
1. Verstehe die pharmazeutische Frage des Users
2. Plane die optimale Suchstrategie (welche Tools, welche Abschnitte)
3. Rufe die nötigen Tools auf, um die relevanten Fachinformationen zu laden
4. Formuliere eine präzise, quellenbasierte Antwort

## Regeln

### UNVERHANDELBAR:
- JEDE Aussage muss mit einer Quelle belegt sein: [Quelle: Präparatename, Abschnitt, Stand MM.YYYY]
- NIEMALS Informationen erfinden oder aus deinem Training ergänzen
- Wenn die Fachinformation keine Antwort enthält: Sage das ehrlich
- Bei Vergleichsfragen: ALLE relevanten Wirkstoffe systematisch durchgehen, nicht nur 2-3

### Suchstrategie:
- Beginne IMMER mit der Analyse der Frage: Was wird gefragt? Welcher Wirkstoff/Produkt/Klasse?
- Verwende search_by_product oder search_by_substance für konkrete Fragen
- Verwende search_by_atc + semantic_search für Vergleiche und offene Fragen
- Verwende NIEMALS nur Keyword-Matching. Verstehe die INTENTION der Frage.
- Bei Vergleichsfragen: Setze exhaustive=true um alle Wirkstoffe zu erfassen

### Antwortformat:
- Strukturiert mit Überschriften
- Vergleichstabellen wo sinnvoll
- Quellenangaben am Ende jedes Abschnitts
- Einschränkungen und Disclaimer am Ende
- Sprache: Deutsch (Fachsprache, aber verständlich)`;

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req: Request) => {
  // Handle CORS
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const { question, lang } = await req.json();

    if (!question || typeof question !== 'string') {
      return new Response(
        JSON.stringify({ error: 'Missing "question" field' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Step 1: Ask LLM to plan tool calls
    const planResponse = await callLLM([
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: question },
    ], true); // useTools = true

    let toolCalls: ToolCall[] = planResponse.tool_calls || [];

    // If no tool calls, the LLM answered directly (shouldn't happen, but handle it)
    if (toolCalls.length === 0) {
      // Fallback: try fulltext search
      toolCalls = [{
        name: 'fulltext_search',
        parameters: { query: question, limit: 20 }
      }];
    }

    // Step 2: Execute tool calls
    const results = [];
    for (const tc of toolCalls) {
      const result = await executeToolCall(tc);
      results.push(result);
    }

    // Step 3: Build context
    const context = buildContext(results);

    // Step 4: Generate answer with context
    const answerResponse = await callLLM([
      { role: 'system', content: SYSTEM_PROMPT },
      {
        role: 'user',
        content: `Frage: ${question}\n\nGefundene Fachinformationen:\n${context}\n\nBitte beantworte die Frage basierend AUSSCHLIEẞLICH auf den oben gezeigten Fachinformationen. Belege JEDE Aussage mit [Quelle: Präparatename, Abschnitt, Stand].`
      },
    ], false); // no tools for answer generation

    // Step 5: Build response
    const response: QueryResponse = {
      answer: answerResponse.text,
      sources: extractSources(answerResponse.text),
      tools_used: toolCalls.map(t => t.name),
      search_scope: results.map(r => `${r.tool}: ${r.count} Ergebnisse`),
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
