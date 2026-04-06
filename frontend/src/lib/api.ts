const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL || '';
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY || '';

export interface QueryResponse {
  answer: string;
  sources: string[];
  tools_used: string[];
  search_scope: string[];
  error?: string;
}

export async function queryApi(question: string): Promise<QueryResponse> {
  const url = `${SUPABASE_URL}/functions/v1/query`;

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
    },
    body: JSON.stringify({ question }),
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`API-Fehler (${response.status}): ${errText}`);
  }

  return response.json();
}
