import React, { useState } from 'react';

interface Props {
  onSubmit: (query: string) => void;
  loading: boolean;
}

export default function SearchBar({ onSubmit, loading }: Props) {
  const [input, setInput] = useState('');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (input.trim() && !loading) {
      onSubmit(input.trim());
    }
  };

  return (
    <form onSubmit={handleSubmit} style={{ marginTop: 32 }}>
      <div style={{
        display: 'flex',
        gap: 8,
        background: 'var(--color-white)',
        borderRadius: 'var(--radius)',
        border: '2px solid var(--color-border)',
        padding: 4,
        boxShadow: 'var(--shadow-md)',
        transition: 'border-color 0.15s',
      }}
      onFocus={(e) => { e.currentTarget.style.borderColor = 'var(--color-accent)'; }}
      onBlur={(e) => { e.currentTarget.style.borderColor = 'var(--color-border)'; }}
      >
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Stellen Sie Ihre pharmazeutische Frage..."
          disabled={loading}
          style={{
            flex: 1,
            padding: '12px 16px',
            border: 'none',
            outline: 'none',
            fontSize: 16,
            fontFamily: 'inherit',
            background: 'transparent',
          }}
        />
        <button
          type="submit"
          disabled={loading || !input.trim()}
          style={{
            padding: '10px 24px',
            background: loading ? 'var(--color-text-light)' : 'var(--color-primary)',
            color: 'white',
            border: 'none',
            borderRadius: 6,
            cursor: loading ? 'not-allowed' : 'pointer',
            fontSize: 15,
            fontWeight: 600,
            fontFamily: 'inherit',
            transition: 'background 0.15s',
          }}
        >
          {loading ? 'Suche...' : 'Suchen'}
        </button>
      </div>
    </form>
  );
}
