const SAFE_LINK_PROTOCOLS = new Set(['http:', 'https:', 'mailto:']);

export function renderInlineMarkdown(text: string): string {
  try {
    const codeBlocks: string[] = [];
    let html = escapeHtml(text);

    // Extract fenced code blocks first
    html = html.replace(/```(\w*)\n([\s\S]*?)```/g, (_match, _lang, code) => {
      const token = `@@DPP_CODE_BLOCK_${codeBlocks.length}@@`;
      codeBlocks.push(`<pre><code>${code}</code></pre>`);
      return token;
    });

    // Tables
    html = renderMarkdownTables(html);

    // Block-level processing: split into lines, build paragraphs and lists
    const lines = html.split('\n');
    const blocks: string[] = [];
    let inList: string[] | null = null;

    function flushList() {
      if (inList && inList.length > 0) {
        blocks.push(`<ul>${inList.map(l => `<li>${l}</li>`).join('')}</ul>`);
      }
      inList = null;
    }

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const trimmed = line.trim();

      // Code block token - emit as-is
      if (/^@@DPP_CODE_BLOCK_\d+@@$/.test(trimmed)) {
        flushList();
        blocks.push(trimmed);
        continue;
      }

      // Table row (starts with |)
      if (trimmed.startsWith('|') && trimmed.endsWith('|')) {
        flushList();
        // Table rows are already rendered by renderMarkdownTables
        blocks.push(trimmed);
        continue;
      }

      // Themed horizontal rule
      if (/^-{3,}$/.test(trimmed)) {
        flushList();
        blocks.push('<hr>');
        continue;
      }

      // Headings
      const hMatch = trimmed.match(/^(#{1,4})\s+(.+)$/);
      if (hMatch) {
        flushList();
        const level = hMatch[1].length;
        const content = renderInlineFormatting(hMatch[2]);
        blocks.push(`<h${level}>${content}</h${level}>`);
        continue;
      }

      // List items
      if (/^[-*]\s+/.test(trimmed)) {
        const content = renderInlineFormatting(trimmed.replace(/^[-*]\s+/, ''));
        inList = inList ?? [];
        inList.push(content);
        continue;
      }

      // Empty line -> paragraph break
      if (trimmed === '') {
        flushList();
        continue;
      }

      // Regular paragraph line
      flushList();
      const content = renderInlineFormatting(line);
      // Check if it's already wrapped (e.g. table)
      if (content.startsWith('<') && content.endsWith('>') && !content.startsWith('<strong') && !content.startsWith('<em') && !content.startsWith('<code')) {
        blocks.push(content);
      } else {
        blocks.push(`<p>${content}</p>`);
      }
    }

    flushList();
    html = blocks.join('\n');

    // Restore code blocks
    html = html.replace(/@@DPP_CODE_BLOCK_(\d+)@@/g, (_match, index) => codeBlocks[Number(index)] ?? '');

    return html;
  } catch {
    // Fallback: basic safe rendering
    return escapeHtml(text).split('\n').map(l => l.trim() ? `<p>${l}</p>` : '').join('\n');
  }
}

/** Apply inline formatting (bold, italic, code, links) to a single line of text. */
function renderInlineFormatting(text: string): string {
  let result = text;

  // Inline code (must be done before bold/italic to avoid conflicts)
  result = result.replace(/`([^`]+)`/g, '<code>$1</code>');

  // Bold
  result = result.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');

  // Italic
  result = result.replace(/\*([^*]+)\*/g, '<em>$1</em>');

  // Links
  result = result.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_match, label, href) => {
    const decodedHref = decodeBasicEntities(href.trim());
    if (!isSafeHref(decodedHref)) return `${label} (${href})`;
    return `<a href="${escapeAttribute(decodedHref)}" target="_blank" rel="noopener noreferrer">${label}</a>`;
  });

  return result;
}

function renderMarkdownTables(html: string): string {
  const lines = html.split('\n');
  const rendered: string[] = [];

  for (let i = 0; i < lines.length; i++) {
    const header = parseMarkdownTableRow(lines[i]);
    const separator = parseMarkdownTableRow(lines[i + 1] ?? '');
    if (!header || !separator || !separator.every(isMarkdownTableSeparatorCell)) {
      rendered.push(lines[i]);
      continue;
    }

    const rows: string[][] = [];
    i += 2;
    while (i < lines.length) {
      const row = parseMarkdownTableRow(lines[i]);
      if (!row) break;
      rows.push(normalizeTableRow(row, header.length));
      i++;
    }
    i--;

    const thead = `<thead><tr>${header.map((cell) => `<th>${cell}</th>`).join('')}</tr></thead>`;
    const tbody = rows.length > 0
      ? `<tbody>${rows.map((row) => `<tr>${row.map((cell) => `<td>${cell}</td>`).join('')}</tr>`).join('')}</tbody>`
      : '';
    rendered.push(`<table>${thead}${tbody}</table>`);
  }

  return rendered.join('\n');
}

function parseMarkdownTableRow(line: string): string[] | null {
  const trimmed = line.trim();
  if (!trimmed.includes('|')) return null;

  const normalized = trimmed
    .replace(/^\|/, '')
    .replace(/\|$/, '');
  const cells = normalized.split('|').map((cell) => cell.trim());
  return cells.length >= 2 && cells.some((cell) => cell.length > 0) ? cells : null;
}

function isMarkdownTableSeparatorCell(cell: string): boolean {
  return /^:?-{3,}:?$/.test(cell.trim());
}

function normalizeTableRow(row: string[], width: number): string[] {
  if (row.length === width) return row;
  if (row.length > width) return row.slice(0, width);
  return [...row, ...Array.from({ length: width - row.length }, () => '')];
}

function isSafeHref(value: string): boolean {
  try {
    const url = new URL(value);
    return SAFE_LINK_PROTOCOLS.has(url.protocol);
  } catch {
    return false;
  }
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function escapeAttribute(value: string): string {
  return escapeHtml(value).replace(/'/g, '&#39;');
}

function decodeBasicEntities(value: string): string {
  return value
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&gt;/g, '>')
    .replace(/&lt;/g, '<')
    .replace(/&amp;/g, '&');
}
