import { EmbeddingProvider } from './types.ts';

async function embedJina(texts: string[]): Promise<number[][]> {
  const apiKey = Deno.env.get('EMBEDDING_API_KEY');
  const model = Deno.env.get('EMBEDDING_MODEL') || 'jina-embeddings-v3';

  const response = await fetch('https://api.jina.ai/v1/embeddings', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      input: texts.map(t => t.slice(0, 8000)),
      encoding_type: 'float',
      task: 'retrieval.query',
      dimensions: 1024,
    }),
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`Jina API error ${response.status}: ${err}`);
  }

  const result = await response.json();
  return result.data.map((d: { embedding: number[] }) => d.embedding);
}

async function embedVoyage(texts: string[]): Promise<number[][]> {
  const apiKey = Deno.env.get('EMBEDDING_API_KEY');
  const model = Deno.env.get('EMBEDDING_MODEL') || 'voyage-multilingual-2';

  const response = await fetch('https://api.voyageai.com/v1/embeddings', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      input: texts,
    }),
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`Voyage API error ${response.status}: ${err}`);
  }

  const result = await response.json();
  return result.data.map((d: { embedding: number[] }) => d.embedding);
}

export async function embedTexts(texts: string[]): Promise<number[][]> {
  const provider = (Deno.env.get('EMBEDDING_PROVIDER') || 'jina') as EmbeddingProvider;

  switch (provider) {
    case 'jina': return embedJina(texts);
    case 'voyage': return embedVoyage(texts);
    default: throw new Error(`Unknown embedding provider: ${provider}`);
  }
}
