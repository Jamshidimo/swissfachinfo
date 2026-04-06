import React from 'react';
import ReactMarkdown from 'react-markdown';

interface Props {
  answer: string | null;
  loading: boolean;
}

export default function AnswerPanel({ answer, loading }: Props) {
  if (loading) {
    return (
      <div style={{
        margin: '24px 0',
        padding: 32,
        background: 'var(--color-white)',
        borderRadius: 'var(--radius)',
        boxShadow: 'var(--shadow-sm)',
        border: '1px solid var(--color-border)',
        textAlign: 'center',
      }}>
        <div style={{ display: 'inline-block', marginBottom: 12 }}>
          <LoadingSpinner />
        </div>
        <p style={{ color: 'var(--color-text-light)', fontSize: 14 }}>
          Fachinformationen werden durchsucht...
        </p>
      </div>
    );
  }

  if (!answer) return null;

  return (
    <div style={{
      margin: '24px 0',
      padding: '24px 32px',
      background: 'var(--color-white)',
      borderRadius: 'var(--radius)',
      boxShadow: 'var(--shadow-sm)',
      border: '1px solid var(--color-border)',
    }}>
      <div className="answer-content" style={{ fontSize: 15, lineHeight: 1.7 }}>
        <ReactMarkdown
          components={{
            h1: ({ children }) => <h2 style={{ fontSize: 20, fontWeight: 700, margin: '24px 0 12px', color: 'var(--color-primary)' }}>{children}</h2>,
            h2: ({ children }) => <h3 style={{ fontSize: 18, fontWeight: 600, margin: '20px 0 10px', color: 'var(--color-primary)' }}>{children}</h3>,
            h3: ({ children }) => <h4 style={{ fontSize: 16, fontWeight: 600, margin: '16px 0 8px', color: 'var(--color-primary-light)' }}>{children}</h4>,
            p: ({ children }) => <p style={{ margin: '8px 0' }}>{children}</p>,
            table: ({ children }) => (
              <div style={{ overflowX: 'auto', margin: '16px 0' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>{children}</table>
              </div>
            ),
            th: ({ children }) => (
              <th style={{ padding: '8px 12px', background: 'var(--color-primary-lighter)', borderBottom: '2px solid var(--color-border)', textAlign: 'left', fontWeight: 600 }}>{children}</th>
            ),
            td: ({ children }) => (
              <td style={{ padding: '8px 12px', borderBottom: '1px solid var(--color-border)' }}>{children}</td>
            ),
            strong: ({ children }) => {
              const text = String(children);
              if (text.startsWith('[Quelle:')) {
                return (
                  <span style={{
                    display: 'inline-block',
                    background: 'var(--color-primary-lighter)',
                    color: 'var(--color-primary)',
                    padding: '2px 8px',
                    borderRadius: 4,
                    fontSize: 12,
                    fontWeight: 500,
                    margin: '2px 0',
                  }}>
                    {children}
                  </span>
                );
              }
              return <strong>{children}</strong>;
            },
            ul: ({ children }) => <ul style={{ margin: '8px 0', paddingLeft: 24 }}>{children}</ul>,
            li: ({ children }) => <li style={{ margin: '4px 0' }}>{children}</li>,
            blockquote: ({ children }) => (
              <blockquote style={{
                borderLeft: '3px solid var(--color-accent)',
                padding: '8px 16px',
                margin: '12px 0',
                background: 'var(--color-primary-lighter)',
                borderRadius: '0 var(--radius) var(--radius) 0',
              }}>{children}</blockquote>
            ),
          }}
        >
          {answer}
        </ReactMarkdown>
      </div>
    </div>
  );
}

function LoadingSpinner() {
  return (
    <div style={{
      width: 32,
      height: 32,
      border: '3px solid var(--color-border)',
      borderTop: '3px solid var(--color-accent)',
      borderRadius: '50%',
      animation: 'spin 0.8s linear infinite',
    }}>
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}
