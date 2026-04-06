import React from 'react';

interface Metadata {
  tools_used: string[];
  search_scope: string[];
  sources: string[];
}

interface Props {
  metadata: Metadata;
}

const TOOL_LABELS: Record<string, string> = {
  search_by_product: 'Produktsuche',
  search_by_substance: 'Wirkstoffsuche',
  search_by_atc: 'ATC-Klassensuche',
  search_by_indication: 'Indikationssuche',
  compare_products: 'Produktvergleich',
  fulltext_search: 'Volltextsuche',
  semantic_search: 'Semantische Suche',
};

export default function SearchMetadata({ metadata }: Props) {
  return (
    <div style={{
      margin: '16px 0 0',
      padding: '8px 16px',
      display: 'flex',
      flexWrap: 'wrap',
      gap: 8,
      fontSize: 12,
      color: 'var(--color-text-light)',
    }}>
      {metadata.tools_used.map((tool) => (
        <span key={tool} style={{
          background: 'var(--color-primary-lighter)',
          color: 'var(--color-primary)',
          padding: '3px 10px',
          borderRadius: 12,
          fontWeight: 500,
        }}>
          {TOOL_LABELS[tool] || tool}
        </span>
      ))}
      {metadata.search_scope.map((scope, i) => (
        <span key={i} style={{
          background: '#f0fff4',
          color: 'var(--color-success)',
          padding: '3px 10px',
          borderRadius: 12,
        }}>
          {scope}
        </span>
      ))}
      {metadata.sources.length > 0 && (
        <span style={{
          background: '#fffff0',
          color: 'var(--color-warning)',
          padding: '3px 10px',
          borderRadius: 12,
        }}>
          {metadata.sources.length} Quellen
        </span>
      )}
    </div>
  );
}
