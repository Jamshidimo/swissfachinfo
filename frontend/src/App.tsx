import React, { useState } from 'react';
import Header from './components/Header';
import SearchBar from './components/SearchBar';
import AnswerPanel from './components/AnswerPanel';
import SearchMetadata from './components/SearchMetadata';
import Disclaimer from './components/Disclaimer';
import { useQuery } from './hooks/useQuery';

export default function App() {
  const { query, answer, loading, error, metadata, submitQuery } = useQuery();

  return (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>
      <Header />
      <main style={{ flex: 1, maxWidth: 900, margin: '0 auto', width: '100%', padding: '0 16px' }}>
        <SearchBar onSubmit={submitQuery} loading={loading} />
        {error && (
          <div style={{
            margin: '16px 0',
            padding: '12px 16px',
            background: '#fff5f5',
            border: '1px solid #fc8181',
            borderRadius: 'var(--radius)',
            color: 'var(--color-error)',
          }}>
            {error}
          </div>
        )}
        {metadata && <SearchMetadata metadata={metadata} />}
        {(answer || loading) && <AnswerPanel answer={answer} loading={loading} />}
        {!answer && !loading && !error && <ExampleQueries onSelect={submitQuery} />}
      </main>
      <Disclaimer />
    </div>
  );
}

function ExampleQueries({ onSelect }: { onSelect: (q: string) => void }) {
  const examples = [
    'Kontraindikationen von Eliquis',
    'Dosierung von Amoxicillin bei Kindern',
    'Welches SSRI hat die wenigsten sexuellen Nebenwirkungen?',
    'Darf Metformin in der Stillzeit eingenommen werden?',
    'Interaktionen von Clopidogrel mit Pantoprazol',
    'Vergleich der UAW-Profile aller Statine',
  ];

  return (
    <div style={{ marginTop: 48 }}>
      <h3 style={{
        fontSize: 14,
        fontWeight: 500,
        color: 'var(--color-text-light)',
        marginBottom: 16,
        textTransform: 'uppercase',
        letterSpacing: '0.05em',
      }}>
        Beispielfragen
      </h3>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 12 }}>
        {examples.map((q) => (
          <button
            key={q}
            onClick={() => onSelect(q)}
            style={{
              padding: '12px 16px',
              background: 'var(--color-white)',
              border: '1px solid var(--color-border)',
              borderRadius: 'var(--radius)',
              cursor: 'pointer',
              textAlign: 'left',
              fontSize: 14,
              color: 'var(--color-text)',
              transition: 'all 0.15s',
              boxShadow: 'var(--shadow-sm)',
            }}
            onMouseOver={(e) => {
              e.currentTarget.style.borderColor = 'var(--color-accent)';
              e.currentTarget.style.boxShadow = 'var(--shadow-md)';
            }}
            onMouseOut={(e) => {
              e.currentTarget.style.borderColor = 'var(--color-border)';
              e.currentTarget.style.boxShadow = 'var(--shadow-sm)';
            }}
          >
            {q}
          </button>
        ))}
      </div>
    </div>
  );
}
