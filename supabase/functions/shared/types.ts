export interface Product {
  id: number;
  title: string;
  auth_holder: string | null;
  atc_code: string | null;
  substances: string[];
  auth_nrs: string[];
  lang: string;
  version: number | null;
  information_update: string | null;
}

export interface Section {
  id: number;
  product_id: number;
  section_code: string;
  section_title: string;
  content: string;
  content_length: number;
}

export interface ProductWithSections extends Product {
  sections: Section[];
}

export interface ToolCall {
  name: string;
  parameters: Record<string, unknown>;
}

export interface QueryPlan {
  intent: string;
  tool_calls: ToolCall[];
}

export interface ToolResult {
  tool: string;
  params: Record<string, unknown>;
  data: unknown[];
  count: number;
}

export interface QueryResponse {
  answer: string;
  sources: string[];
  tools_used: string[];
  search_scope: string[];
  error?: string;
}

export interface LLMMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface LLMResponse {
  text: string;
  tool_calls?: ToolCall[];
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
  };
}

export interface EmbeddingResponse {
  embeddings: number[][];
}

export type LLMProvider = 'groq' | 'huggingface' | 'mistral' | 'anthropic';
export type EmbeddingProvider = 'jina' | 'voyage' | 'local';
