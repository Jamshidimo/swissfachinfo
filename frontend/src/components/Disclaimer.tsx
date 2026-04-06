import React from 'react';

export default function Disclaimer() {
  return (
    <footer style={{
      marginTop: 48,
      padding: '24px',
      background: 'var(--color-white)',
      borderTop: '1px solid var(--color-border)',
      fontSize: 12,
      color: 'var(--color-text-light)',
      textAlign: 'center',
      lineHeight: 1.6,
    }}>
      <div style={{ maxWidth: 700, margin: '0 auto' }}>
        <p style={{ fontWeight: 600, marginBottom: 4 }}>Rechtlicher Hinweis</p>
        <p>
          SwissFachinfo dient ausschliesslich zu Informationszwecken. Die Angaben basieren auf den offiziellen
          Fachinformationen der Swissmedic-zugelassenen Arzneimittel. Diese Anwendung ersetzt keine ärztliche
          oder pharmazeutische Beratung. Für medizinische Entscheidungen konsultieren Sie bitte eine Fachperson.
        </p>
        <p style={{ marginTop: 8, opacity: 0.7 }}>
          Datenquelle: AIPS (Arzneimittelinformations-Publikationssystem) |
          Keine Gewähr für Vollständigkeit oder Aktualität
        </p>
      </div>
    </footer>
  );
}
