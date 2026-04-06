import { LLMMessage, LLMResponse, LLMProvider, ToolCall } from './types.ts';

const TOOL_DEFINITIONS = [
  {
    type: "function",
    function: {
      name: "search_by_product",
      description: "Suche ein Arzneimittel anhand seines Namens. Gibt Abschnitte der Fachinformation zurück.",
      parameters: {
        type: "object",
        properties: {
          product_name: { type: "string", description: "Name oder Teilname des Präparats" },
          sections: { type: "array", items: { type: "string" }, description: "Nur bestimmte Abschnitte (z.B. ['contraindications', 'interactions'])" },
          lang: { type: "string", enum: ["de", "fr", "it"], default: "de" }
        },
        required: ["product_name"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "search_by_substance",
      description: "Suche alle Arzneimittel mit einem bestimmten Wirkstoff.",
      parameters: {
        type: "object",
        properties: {
          substance: { type: "string", description: "Wirkstoffname (z.B. 'Metformin')" },
          sections: { type: "array", items: { type: "string" }, description: "Nur bestimmte Abschnitte" },
          include_generika: { type: "boolean", default: true }
        },
        required: ["substance"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "search_by_atc",
      description: "Suche alle Arzneimittel in einer ATC-Klasse.",
      parameters: {
        type: "object",
        properties: {
          atc_code: { type: "string", description: "ATC-Code (z.B. 'N05AX')" },
          level: { type: "integer", description: "ATC-Level (3-5)" },
          sections: { type: "array", items: { type: "string" } }
        },
        required: ["atc_code"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "search_by_indication",
      description: "Finde Arzneimittel mit einer bestimmten Indikation via Volltextsuche.",
      parameters: {
        type: "object",
        properties: {
          indication_query: { type: "string", description: "Freitext-Beschreibung der Indikation" },
          atc_filter: { type: "string", description: "Optional: ATC-Klassen-Filter" }
        },
        required: ["indication_query"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "compare_products",
      description: "Vergleiche 2-5 Arzneimittel in bestimmten Abschnitten.",
      parameters: {
        type: "object",
        properties: {
          product_names: { type: "array", items: { type: "string" }, description: "Liste der Präparate" },
          sections: { type: "array", items: { type: "string" }, description: "Abschnitte für Vergleich" }
        },
        required: ["product_names", "sections"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "fulltext_search",
      description: "Volltextsuche über alle Fachinformationen.",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: "Suchbegriff(e)" },
          section_filter: { type: "array", items: { type: "string" } },
          atc_filter: { type: "string" },
          limit: { type: "integer", default: 20 }
        },
        required: ["query"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "semantic_search",
      description: "Semantische Suche über Embeddings für komplexe Fragen.",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: "Natürlichsprachliche Frage" },
          section_filter: { type: "array", items: { type: "string" } },
          atc_filter: { type: "string" },
          top_k: { type: "integer", default: 30 },
          rerank: { type: "boolean", default: true },
          exhaustive: { type: "boolean", default: false }
        },
        required: ["query"]
      }
    }
  }
];

async function callGroq(messages: LLMMessage[], useTools: boolean): Promise<LLMResponse> {
  const apiKey = Deno.env.get('LLM_API_KEY');
  const model = Deno.env.get('LLM_MODEL') || 'llama-3.1-70b-versatile';

  const body: Record<string, unknown> = {
    model,
    messages,
    temperature: 0.1,
    max_tokens: 4096,
  };

  if (useTools) {
    body.tools = TOOL_DEFINITIONS;
    body.tool_choice = 'auto';
  }

  const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`Groq API error ${response.status}: ${err}`);
  }

  const result = await response.json();
  const choice = result.choices[0];

  const toolCalls: ToolCall[] = [];
  if (choice.message.tool_calls) {
    for (const tc of choice.message.tool_calls) {
      toolCalls.push({
        name: tc.function.name,
        parameters: JSON.parse(tc.function.arguments),
      });
    }
  }

  return {
    text: choice.message.content || '',
    tool_calls: toolCalls.length > 0 ? toolCalls : undefined,
    usage: result.usage ? {
      prompt_tokens: result.usage.prompt_tokens,
      completion_tokens: result.usage.completion_tokens,
    } : undefined,
  };
}

async function callMistral(messages: LLMMessage[], useTools: boolean): Promise<LLMResponse> {
  const apiKey = Deno.env.get('LLM_API_KEY');
  const model = Deno.env.get('LLM_MODEL') || 'mistral-large-latest';

  const body: Record<string, unknown> = {
    model,
    messages,
    temperature: 0.1,
    max_tokens: 4096,
  };

  if (useTools) {
    body.tools = TOOL_DEFINITIONS;
    body.tool_choice = 'auto';
  }

  const response = await fetch('https://api.mistral.ai/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`Mistral API error ${response.status}: ${err}`);
  }

  const result = await response.json();
  const choice = result.choices[0];

  const toolCalls: ToolCall[] = [];
  if (choice.message.tool_calls) {
    for (const tc of choice.message.tool_calls) {
      toolCalls.push({
        name: tc.function.name,
        parameters: JSON.parse(tc.function.arguments),
      });
    }
  }

  return {
    text: choice.message.content || '',
    tool_calls: toolCalls.length > 0 ? toolCalls : undefined,
    usage: result.usage,
  };
}

async function callAnthropic(messages: LLMMessage[], useTools: boolean): Promise<LLMResponse> {
  const apiKey = Deno.env.get('LLM_API_KEY');
  const model = Deno.env.get('LLM_MODEL') || 'claude-sonnet-4-6';

  const systemMsg = messages.find(m => m.role === 'system');
  const nonSystemMsgs = messages.filter(m => m.role !== 'system');

  const body: Record<string, unknown> = {
    model,
    max_tokens: 4096,
    messages: nonSystemMsgs.map(m => ({ role: m.role, content: m.content })),
  };

  if (systemMsg) {
    body.system = systemMsg.content;
  }

  if (useTools) {
    body.tools = TOOL_DEFINITIONS.map(t => ({
      name: t.function.name,
      description: t.function.description,
      input_schema: t.function.parameters,
    }));
  }

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey!,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`Anthropic API error ${response.status}: ${err}`);
  }

  const result = await response.json();

  let text = '';
  const toolCalls: ToolCall[] = [];

  for (const block of result.content) {
    if (block.type === 'text') {
      text += block.text;
    } else if (block.type === 'tool_use') {
      toolCalls.push({
        name: block.name,
        parameters: block.input,
      });
    }
  }

  return {
    text,
    tool_calls: toolCalls.length > 0 ? toolCalls : undefined,
    usage: result.usage ? {
      prompt_tokens: result.usage.input_tokens,
      completion_tokens: result.usage.output_tokens,
    } : undefined,
  };
}

async function callHuggingFace(messages: LLMMessage[], _useTools: boolean): Promise<LLMResponse> {
  const apiKey = Deno.env.get('LLM_API_KEY');
  const model = Deno.env.get('LLM_MODEL') || 'Qwen/Qwen2.5-72B-Instruct';

  const response = await fetch(`https://api-inference.huggingface.co/models/${model}/v1/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      messages,
      temperature: 0.1,
      max_tokens: 4096,
    }),
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`HuggingFace API error ${response.status}: ${err}`);
  }

  const result = await response.json();

  return {
    text: result.choices[0].message.content || '',
    usage: result.usage,
  };
}

export async function callLLM(messages: LLMMessage[], useTools = false): Promise<LLMResponse> {
  const provider = (Deno.env.get('LLM_PROVIDER') || 'groq') as LLMProvider;

  switch (provider) {
    case 'groq': return callGroq(messages, useTools);
    case 'mistral': return callMistral(messages, useTools);
    case 'anthropic': return callAnthropic(messages, useTools);
    case 'huggingface': return callHuggingFace(messages, useTools);
    default: throw new Error(`Unknown LLM provider: ${provider}`);
  }
}

export function getToolDefinitions() {
  return TOOL_DEFINITIONS;
}
