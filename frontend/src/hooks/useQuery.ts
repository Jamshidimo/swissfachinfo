import { useState, useCallback } from 'react';
import { queryApi, type QueryResponse } from '../lib/api';

interface QueryState {
  query: string | null;
  answer: string | null;
  loading: boolean;
  error: string | null;
  metadata: {
    tools_used: string[];
    search_scope: string[];
    sources: string[];
  } | null;
}

export function useQuery() {
  const [state, setState] = useState<QueryState>({
    query: null,
    answer: null,
    loading: false,
    error: null,
    metadata: null,
  });

  const submitQuery = useCallback(async (question: string) => {
    setState({
      query: question,
      answer: null,
      loading: true,
      error: null,
      metadata: null,
    });

    try {
      const response = await queryApi(question);

      setState({
        query: question,
        answer: response.answer,
        loading: false,
        error: response.error || null,
        metadata: {
          tools_used: response.tools_used || [],
          search_scope: response.search_scope || [],
          sources: response.sources || [],
        },
      });
    } catch (err) {
      setState(prev => ({
        ...prev,
        loading: false,
        error: err instanceof Error ? err.message : 'Ein Fehler ist aufgetreten.',
      }));
    }
  }, []);

  return { ...state, submitQuery };
}
