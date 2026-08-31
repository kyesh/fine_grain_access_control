/**
 * Server-side text extraction for Gmail attachments (gmail_get_attachment).
 *
 * Rationale (docs/implementation_plans/gmail-attachment-pagination_v1.md):
 * nearly all agent use of the tool is "read the attachment", and base64 in an
 * MCP response costs ~1 token per 2–3 useless chars — a 300 KB PDF is ~100k
 * tokens of base64 but only a few thousand words of text. Extraction is the
 * primary large-attachment path; raw byte windows are the fallback.
 *
 * The heavy parsers (unpdf's bundled pdf.js, fflate) are dynamic-imported so
 * the MCP route's cold start doesn't pay for them until a PDF/docx actually
 * needs reading.
 */

export type ExtractedText = { text: string; kind: 'pdf' | 'docx' | 'text' };

const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
// Text-family types an agent can consume directly after utf-8 decoding. HTML
// ships as-is (agents strip markup fine); spreadsheets are deliberately absent
// — sheets have their own tools.
const TEXT_MIME = /^(text\/|message\/|application\/(json|xml|[\w.+-]*\+(json|xml)|x-yaml|yaml|javascript|x-sh|sql|rtf)$)/i;
const TEXT_EXT = /\.(txt|csv|tsv|md|markdown|json|jsonl|ndjson|xml|html?|htm|log|ya?ml|ics|eml|sql|sh|js|ts|py|rtf)$/i;
const PDF_EXT = /\.pdf$/i;
const DOCX_EXT = /\.docx$/i;

/** Decode numeric and the five named XML entities docx bodies actually use. */
function decodeXmlEntities(s: string): string {
  return s
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(parseInt(d, 10)))
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
}

function docxToText(bytes: Uint8Array, unzipSync: (data: Uint8Array) => Record<string, Uint8Array>): string {
  const files = unzipSync(bytes);
  const doc = files['word/document.xml'];
  if (!doc) throw new Error('docx has no word/document.xml');
  const xml = Buffer.from(doc).toString('utf8');
  // Paragraphs → newlines, tabs/breaks → their characters, all other markup
  // dropped. Loses tables' structure but keeps every run of text in order.
  const text = xml
    .replace(/<w:tab[^>]*\/>/g, '\t')
    .replace(/<w:br[^>]*\/>/g, '\n')
    .replace(/<\/w:p>/g, '\n')
    .replace(/<[^>]+>/g, '');
  return decodeXmlEntities(text).replace(/\n{3,}/g, '\n\n').trim();
}

/**
 * Extract readable text from an attachment.
 * Returns null when no extractor covers the type (caller falls back to bytes);
 * THROWS when an extractor exists but the payload defeats it (corrupt file,
 * password-protected PDF) — the two cases carry different agent guidance.
 */
export async function extractAttachmentText(
  bytes: Buffer,
  mimeType: string,
  filename: string,
): Promise<ExtractedText | null> {
  const mime = (mimeType || '').toLowerCase().split(';')[0].trim();
  // Metadata can be absent entirely (a caller-supplied attachment id often
  // matches nothing in the fresh parent read, leaving no filename/mime), so
  // magic bytes get a vote alongside mime and extension.
  const generic = mime === '' || mime === 'application/octet-stream';

  if (mime === 'application/pdf' || PDF_EXT.test(filename)
      || (generic && bytes.subarray(0, 5).toString('latin1') === '%PDF-')) {
    const { extractText } = await import('unpdf');
    const { text } = await extractText(new Uint8Array(bytes), { mergePages: true });
    return { text: text.trim(), kind: 'pdf' };
  }

  if (mime === DOCX_MIME || DOCX_EXT.test(filename)) {
    const { unzipSync } = await import('fflate');
    return { text: docxToText(new Uint8Array(bytes), unzipSync), kind: 'docx' };
  }
  // Sniffed ZIP under a generic mime: docx only if the marker entry exists —
  // an xlsx/pptx/plain zip is NOT extractable here, and must not throw.
  if ((generic || mime === 'application/zip') && bytes[0] === 0x50 && bytes[1] === 0x4b) {
    const { unzipSync } = await import('fflate');
    let files: Record<string, Uint8Array>;
    try { files = unzipSync(new Uint8Array(bytes)); } catch { return null; }
    if (!files['word/document.xml']) return null;
    return { text: docxToText(new Uint8Array(bytes), unzipSync), kind: 'docx' };
  }

  if (TEXT_MIME.test(mime) || (generic && TEXT_EXT.test(filename))) {
    const text = bytes.toString('utf8');
    // A mislabeled binary decodes into a soup of U+FFFD — treat as unsupported
    // rather than returning garbage the agent might trust.
    const bad = (text.match(/�/g) ?? []).length;
    if (text.length > 0 && bad / text.length > 0.05) return null;
    return { text: text.replace(/^﻿/, ''), kind: 'text' };
  }
  // Last resort for metadata-less payloads: accept as text only when the
  // decode is essentially clean — a stricter bar than the labeled path above.
  if (generic && bytes.length > 0) {
    const text = bytes.toString('utf8');
    const bad = (text.match(/\uFFFD/g) ?? []).length;
    if (bad / text.length < 0.005 && !text.includes('\u0000')) {
      return { text: text.replace(/^﻿/, ''), kind: 'text' };
    }
  }

  return null;
}
