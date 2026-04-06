import React from 'react';

export default function Header() {
  return (
    <header style={{
      background: 'var(--color-primary)',
      color: 'white',
      padding: '16px 24px',
      boxShadow: 'var(--shadow-md)',
    }}>
      <div style={{ maxWidth: 900, margin: '0 auto', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <div style={{
            width: 36,
            height: 36,
            background: 'rgba(255,255,255,0.15)',
            borderRadius: 8,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontWeight: 700,
            fontSize: 16,
          }}>
            SF
          </div>
          <div>
            <h1 style={{ fontSize: 20, fontWeight: 700, lineHeight: 1.2 }}>SwissFachinfo</h1>
            <p style={{ fontSize: 12, opacity: 0.8, lineHeight: 1.2 }}>Pharmazeutische Fachinformationen</p>
          </div>
        </div>
        <nav style={{ display: 'flex', gap: 16, fontSize: 14 }}>
          <a href="#" style={{ color: 'rgba(255,255,255,0.9)', textDecoration: 'none' }}>Suche</a>
          <a href="#about" style={{ color: 'rgba(255,255,255,0.7)', textDecoration: 'none' }}>Info</a>
        </nav>
      </div>
    </header>
  );
}
