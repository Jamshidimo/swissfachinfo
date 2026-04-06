import { ToolResult } from './types.ts';

const MAX_CONTEXT_CHARS = 60000; // ~15k tokens

export function buildContext(results: ToolResult[]): string {
  const parts: string[] = [];
  let totalChars = 0;

  for (const result of results) {
    const header = `\n### Tool: ${result.tool} (${result.count} Ergebnisse)\n`;
    parts.push(header);
    totalChars += header.length;

    for (const item of result.data as Record<string, unknown>[]) {
      const formatted = formatItem(item);

      if (totalChars + formatted.length > MAX_CONTEXT_CHARS) {
        parts.push('\n[... weitere Ergebnisse gekürzt wegen Kontextlimit ...]\n');
        break;
      }

      parts.push(formatted);
      totalChars += formatted.length;
    }
  }

  return parts.join('');
}

function formatItem(item: Record<string, unknown>): string {
  const parts: string[] = [];

  // Product info
  const title = item.title || (item as any).product_title;
  if (title) {
    parts.push(`\n---\n**Präparat:** ${title}`);
  }

  if (item.substances) {
    const subs = Array.isArray(item.substances) ? item.substances.join(', ') : item.substances;
    parts.push(`**Wirkstoffe:** ${subs}`);
  }

  if (item.atc_code) {
    parts.push(`**ATC:** ${item.atc_code}`);
  }

  if (item.information_update) {
    parts.push(`**Stand:** ${item.information_update}`);
  }

  // Sections
  const sections = item.sections as Record<string, unknown>[] | undefined;
  if (sections && Array.isArray(sections)) {
    for (const sec of sections) {
      parts.push(`\n#### ${sec.section_title || sec.section_code}`);
      const content = (sec.content as string) || '';
      // Truncate very long sections
      if (content.length > 3000) {
        parts.push(content.slice(0, 3000) + '\n[... gekürzt ...]');
      } else {
        parts.push(content);
      }
    }
  }

  // Direct section content (from semantic search)
  if (item.content && !sections) {
    const secTitle = item.section_title || item.section_code || 'Abschnitt';
    parts.push(`\n#### ${secTitle}`);
    const content = item.content as string;
    if (content.length > 3000) {
      parts.push(content.slice(0, 3000) + '\n[... gekürzt ...]');
    } else {
      parts.push(content);
    }
    if (item.similarity) {
      parts.push(`(Relevanz: ${((item.similarity as number) * 100).toFixed(1)}%)`);
    }
  }

  return parts.join('\n');
}

export function extractSources(text: string): string[] {
  const sourcePattern = /\[Quelle:\s*([^\]]+)\]/g;
  const sources: string[] = [];
  let match;

  while ((match = sourcePattern.exec(text)) !== null) {
    sources.push(match[1].trim());
  }

  return [...new Set(sources)];
}
