// Chunking Service — splits parsed document text into overlapping chunks for RAG embedding

export interface ChunkMetadata {
  sourceId: string;
  chunkIndex: number;
  startChar: number;
  endChar: number;
}

export interface TextChunk {
  text: string;
  metadata: ChunkMetadata;
}

/** ~800 tokens ≈ 3200 chars, overlap ~100 tokens ≈ 400 chars */
const DEFAULT_CHUNK_SIZE = 3200;
const DEFAULT_OVERLAP = 400;

const MD_HEADER_RE = /^#{1,4}\s/m;
const PARAGRAPH_BREAK = /\n\n+/;
const TABLE_ROW_RE = /^\|/m;

/**
 * Split text into overlapping chunks, aware of content structure.
 */
export function chunkText(
  text: string,
  sourceId: string,
  chunkSize = DEFAULT_CHUNK_SIZE,
  overlap = DEFAULT_OVERLAP,
): TextChunk[] {
  if (!text.trim()) return [];

  // Choose split strategy based on content
  const isMarkdown = MD_HEADER_RE.test(text);
  const isTable = TABLE_ROW_RE.test(text) && text.split('\n').filter(l => l.startsWith('|')).length > 3;

  let sections: string[];
  if (isTable) {
    sections = splitTable(text);
  } else if (isMarkdown) {
    sections = splitMarkdown(text);
  } else {
    sections = splitParagraphs(text);
  }

  // Merge small sections, split large ones, apply overlap
  return mergeAndChunk(sections, sourceId, chunkSize, overlap);
}

function splitMarkdown(text: string): string[] {
  // Split on markdown headers, keeping the header with its content
  const parts: string[] = [];
  const lines = text.split('\n');
  let current = '';

  for (const line of lines) {
    if (MD_HEADER_RE.test(line) && current.trim()) {
      parts.push(current.trim());
      current = '';
    }
    current += line + '\n';
  }
  if (current.trim()) parts.push(current.trim());
  return parts;
}

function splitParagraphs(text: string): string[] {
  return text.split(PARAGRAPH_BREAK).map(p => p.trim()).filter(Boolean);
}

function splitTable(text: string): string[] {
  // Split tables into groups of rows, keep header with each group
  const lines = text.split('\n');
  const headerLines: string[] = [];
  const dataLines: string[] = [];

  let pastHeader = false;
  for (const line of lines) {
    if (!pastHeader) {
      headerLines.push(line);
      // Separator line (|---|---|) marks end of header
      if (/^\|[\s-|]+\|$/.test(line.trim())) pastHeader = true;
    } else {
      dataLines.push(line);
    }
  }

  if (dataLines.length === 0) return [text];

  const header = headerLines.join('\n');
  const groups: string[] = [];
  const rowsPerChunk = 20;

  for (let i = 0; i < dataLines.length; i += rowsPerChunk) {
    const slice = dataLines.slice(i, i + rowsPerChunk).join('\n');
    groups.push(header + '\n' + slice);
  }
  return groups;
}

function mergeAndChunk(
  sections: string[],
  sourceId: string,
  chunkSize: number,
  overlap: number,
): TextChunk[] {
  const chunks: TextChunk[] = [];
  let buffer = '';
  let charOffset = 0;

  const flush = () => {
    if (!buffer.trim()) return;
    const startChar = charOffset - buffer.length;
    chunks.push({
      text: buffer.trim(),
      metadata: { sourceId, chunkIndex: chunks.length, startChar, endChar: charOffset },
    });
    // Keep overlap from end of buffer
    const overlapText = buffer.slice(-overlap);
    buffer = overlapText;
  };

  for (const section of sections) {
    if (buffer.length + section.length > chunkSize && buffer.trim()) {
      flush();
    }

    // Section itself is too large — force-split by character boundary
    if (section.length > chunkSize) {
      if (buffer.trim()) flush();
      let pos = 0;
      while (pos < section.length) {
        const end = Math.min(pos + chunkSize, section.length);
        const slice = section.slice(pos, end);
        charOffset += slice.length;
        chunks.push({
          text: slice.trim(),
          metadata: { sourceId, chunkIndex: chunks.length, startChar: charOffset - slice.length, endChar: charOffset },
        });
        pos = end - overlap;
        if (pos < 0) pos = 0;
        if (end === section.length) break;
      }
      buffer = '';
      continue;
    }

    buffer += (buffer ? '\n\n' : '') + section;
    charOffset += section.length + (buffer.length > section.length ? 2 : 0);
  }

  // Flush remaining
  if (buffer.trim()) {
    const startChar = charOffset - buffer.length;
    chunks.push({
      text: buffer.trim(),
      metadata: { sourceId, chunkIndex: chunks.length, startChar, endChar: charOffset },
    });
  }

  return chunks;
}
