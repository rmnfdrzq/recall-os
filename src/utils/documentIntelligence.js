const STOP_WORDS = new Set([
  'a', 'an', 'and', 'are', 'as', 'at', 'be', 'by', 'for', 'from', 'how', 'i',
  'in', 'is', 'it', 'my', 'of', 'on', 'or', 'the', 'to', 'was', 'were', 'what',
  'which', 'who', 'with', 'you', 'your', 'в', 'во', 'и', 'или', 'как', 'какие',
  'каких', 'какой', 'кто', 'мне', 'мой', 'моем', 'моему', 'на', 'о', 'об',
  'по', 'с', 'со', 'что', 'это', 'я'
]);

export const normalizeText = (value = '') => (
  String(value)
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/[^\p{L}\p{N}\s.-]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
);

export const tokenize = (value = '') => (
  normalizeText(value)
    .split(' ')
    .filter(token => token.length > 2 && !STOP_WORDS.has(token))
);

export const buildLibraryInventoryContext = (documents = [], { query = '' } = {}) => {
  void query;

  return documents
    .filter(document => document?.id && document?.filename)
    .map((document, index) => {
      const title = document.suggested_title || document.filename;
      const summary = document.summary || 'No summary available.';
      const category = document.category || 'Uncategorized';
      const status = document.status || 'unknown';
      return {
        document_id: document.id,
        filename: document.filename,
        suggested_title: title,
        chunk_index: 0,
        page_number: null,
        section_title: 'Library Inventory',
        content_type: 'document_metadata',
        reason: 'library_inventory',
        entities: {},
        content: [
          `Library item ${index + 1}`,
          `Filename: ${document.filename}`,
          `Suggested title: ${title}`,
          `Category: ${category}`,
          `Status: ${status}`,
          `Summary: ${summary}`,
        ].join('\n')
      };
    });
};

const processedDocuments = (documents = []) => (
  documents.filter(document => document?.id && document?.filename && document?.status === 'processed')
);

const documentIds = (documents = []) => documents.map(document => document.id);

export const routeChatQuery = (query = '', {
  documents = [],
  selectedDocumentIds = [],
} = {}) => {
  void query;
  const processed = processedDocuments(documents);
  const selectedSet = new Set(selectedDocumentIds);
  const selected = selectedDocumentIds.length
    ? processed.filter(document => selectedSet.has(document.id))
    : [];

  if (selected.length > 0) {
    return {
      query_mode: 'llm_routed',
      scope: {
        source: 'explicit_user_scope',
        document_ids: documentIds(selected),
        filters: {},
      },
      retrieval: { strategy: 'llm_router' },
    };
  }

  return {
    query_mode: 'llm_routed',
    scope: {
      source: 'all_documents',
      document_ids: [],
      filters: {},
    },
    retrieval: { strategy: 'llm_router' },
  };
};

export const buildStructuredChatRequest = ({
  content,
  route,
  contextChunks = [],
  inventoryItems = [],
}) => {
  const payload = {
    content,
    query_mode: route.query_mode,
    scope: route.scope,
    retrieval: route.retrieval,
  };
  if (contextChunks.length > 0) payload.context_chunks = contextChunks;
  if (inventoryItems.length > 0) payload.inventory_items = inventoryItems;
  return payload;
};

export const filterInventoryItemsForToolRequest = (items = [], toolRequest = {}) => {
  const args = toolRequest.args || {};
  const filters = args.filters || {};
  const extension = String(filters.extension || '').toLowerCase().replace(/^\./, '').trim();
  const documentIds = new Set((args.document_ids || []).map(String));

  return items.filter((item) => {
    const documentId = String(item?.document_id || '');
    const filename = String(item?.filename || '').toLowerCase();
    if (documentIds.size > 0 && !documentIds.has(documentId)) return false;
    if (extension && !filename.endsWith(`.${extension}`)) return false;
    return true;
  });
};

export const buildToolResultChatRequest = ({
  content,
  toolRequest,
  items = [],
}) => ({
  content,
  query_mode: 'tool_result',
  user_message_id: toolRequest.user_message_id,
  tool_call_token: toolRequest.tool_call_token,
  tool_result: {
    tool_call_id: toolRequest.tool_call_id,
    tool_call_token: toolRequest.tool_call_token,
    tool: toolRequest.tool,
    args: toolRequest.args || {},
    route: toolRequest.route,
    items,
  },
});

export const extractEntities = (text = '') => {
  const source = String(text);
  const organizations = new Set();
  const dates = new Set();
  const emails = new Set();
  const money = new Set();
  const technologies = new Set();

  for (const match of source.matchAll(/\b[A-Z][A-Za-z0-9&.,-]*(?:\s+[A-Z][A-Za-z0-9&.,-]*){0,4}\s+(?:Inc|LLC|Ltd|GmbH|S\.?A\.?|Corp|Corporation|Company|Group|Bank|Labs|Studio|Studios|Systems|Technologies|Tech)\b/g)) {
    organizations.add(match[0].trim());
  }
  for (const match of source.matchAll(/\b(?:19|20)\d{2}\b|(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\.?\s+(?:19|20)\d{2}/gi)) {
    dates.add(match[0].trim());
  }
  for (const match of source.matchAll(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi)) {
    emails.add(match[0].trim());
  }
  for (const match of source.matchAll(/[$€£]\s?\d[\d,.]*|\d[\d,.]*\s?(?:USD|EUR|GBP|руб|₽)/gi)) {
    money.add(match[0].trim());
  }
  for (const match of source.matchAll(/\b(?:React|Vue|Angular|Node\.js|Python|Django|FastAPI|Rust|Tauri|PostgreSQL|Postgres|Redis|Docker|Kubernetes|AWS|GCP|Azure|TypeScript|JavaScript|LLM|RAG|LanceDB|Ollama)\b/g)) {
    technologies.add(match[0].trim());
  }

  return {
    organizations: Array.from(organizations).slice(0, 24),
    dates: Array.from(dates).slice(0, 24),
    emails: Array.from(emails).slice(0, 12),
    money: Array.from(money).slice(0, 12),
    technologies: Array.from(technologies).slice(0, 32)
  };
};

const isLikelyHeading = (line) => {
  const trimmed = line.trim();
  if (!trimmed || trimmed.length > 90) return false;
  if (/^\[Page\s+\d+\]$/i.test(trimmed)) return false;
  if (/^[#*\-\d.\s]+$/.test(trimmed)) return false;
  if (/^#{1,6}\s+/.test(trimmed)) return true;
  if (/^[A-ZА-ЯЁ][\p{L}\p{N}\s/&,-]{2,}$/.test(trimmed) && !/[.!?]$/.test(trimmed)) return true;
  return /^(experience|work experience|employment|education|skills|projects|summary|contacts|certifications|проект|опыт|образование|навыки|контакты|резюме)\b/i.test(trimmed);
};

const sectionTitleFromHeading = (line) => line.replace(/^#{1,6}\s+/, '').trim();

const splitIntoParagraphs = (text) => (
  String(text)
    .replace(/\r\n/g, '\n')
    .split(/\n{2,}/)
    .map(part => part.trim())
    .filter(Boolean)
);

const stripMarkdownSyntax = (text = '') => (
  String(text)
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/!\[[^\]]*]\([^)]+\)/g, ' ')
    .replace(/\[([^\]]+)]\([^)]+\)/g, '$1')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/^\s*[-*+]\s+/gm, '')
    .replace(/^\s*\d+[.)]\s+/gm, '')
    .replace(/[*_~>|]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
);

const splitIntoSentences = (text = '') => (
  stripMarkdownSyntax(text)
    .split(/(?<=[.!?])\s+|\n+/)
    .map(sentence => sentence.trim())
    .filter(sentence => sentence.length >= 35 && /[\p{L}\p{N}]/u.test(sentence))
);

const extractDocumentTitle = (filename, text = '') => {
  const heading = String(text).match(/^\s*#\s+(.+)$/m);
  if (heading?.[1]) return stripMarkdownSyntax(heading[1]).slice(0, 90);

  const fallback = String(filename || 'This document')
    .replace(/\.[^.]+$/, '')
    .replace(/[-_]+/g, ' ')
    .trim();
  return fallback || 'This document';
};

const buildContentSummary = (filename, text) => {
  const title = extractDocumentTitle(filename, text);
  const paragraphs = splitIntoParagraphs(text)
    .map(stripMarkdownSyntax)
    .filter(part => part.length >= 35);
  const sentences = splitIntoSentences(text);
  const candidates = [...sentences, ...paragraphs]
    .map(part => part.replace(/\s+/g, ' ').trim())
    .filter((part, index, all) => part && all.indexOf(part) === index)
    .filter(part => normalizeText(part) !== normalizeText(title));

  const selected = candidates.slice(0, 2);
  if (selected.length === 0) {
    return `${title} contains extracted text, but there is not enough readable prose to summarize meaningfully.`;
  }

  const summaryBody = selected.join(' ');
  return `${title}: ${summaryBody}`.slice(0, 700);
};

export const buildSmartChunks = (text, {
  filename = 'document',
  maxLength = 2000,
  overlap = 100
} = {}) => {
  const chunks = [];
  let pageNumber = 1;
  let sectionTitle = 'Document';
  let sectionIndex = 0;
  let carry = '';

  const flush = ({ keepOverlap = true } = {}) => {
    const content = carry.trim();
    if (content.length < 10) {
      carry = '';
      return;
    }
    const entities = extractEntities(content);
    chunks.push({
      content,
      chunk_index: chunks.length,
      page_number: pageNumber,
      section_title: sectionTitle,
      section_index: sectionIndex,
      content_type: content.includes('|') && content.includes('\n') ? 'table' : 'paragraph',
      keywords: Array.from(new Set(tokenize(content))).slice(0, 24),
      entities
    });
    carry = keepOverlap ? content.slice(Math.max(0, content.length - overlap)) : '';
  };

  for (const paragraph of splitIntoParagraphs(text)) {
    const pageMatch = paragraph.match(/^\[Page\s+(\d+)\]$/i);
    if (pageMatch) {
      if (carry.trim()) flush({ keepOverlap: false });
      pageNumber = Number(pageMatch[1]);
      continue;
    }

    const lines = paragraph.split('\n').map(line => line.trim()).filter(Boolean);
    if (lines.length === 1 && isLikelyHeading(lines[0])) {
      if (carry.trim()) flush({ keepOverlap: false });
      sectionTitle = sectionTitleFromHeading(lines[0]);
      sectionIndex += 1;
      continue;
    }

    const next = carry ? `${carry}\n\n${paragraph}` : paragraph;
    if (next.length > maxLength && carry.trim()) {
      flush();
      carry = paragraph;
    } else {
      carry = next;
    }

    while (carry.length > maxLength * 1.35) {
      const cutAt = carry.lastIndexOf(' ', maxLength);
      const end = cutAt > maxLength * 0.65 ? cutAt : maxLength;
      const head = carry.slice(0, end).trim();
      const tail = carry.slice(Math.max(0, end - overlap)).trim();
      carry = head;
      flush();
      carry = tail;
    }
  }

  if (carry.trim()) flush();

  return chunks.map((chunk, index) => ({
    ...chunk,
    chunk_index: index,
    prev_chunk_index: index > 0 ? index - 1 : null,
    next_chunk_index: index < chunks.length - 1 ? index + 1 : null,
    filename
  }));
};

export const buildDocumentSummary = (filename, text, chunks = []) => {
  const entities = extractEntities(text);
  const technologies = entities.technologies.slice(0, 8);
  const sections = Array.from(new Set(
    chunks
      .map(chunk => chunk.section_title)
      .filter(title => title && title !== 'Document')
  )).slice(0, 4);
  const parts = [buildContentSummary(filename, text)];
  if (sections.length) parts.push(`Main sections: ${sections.join(', ')}.`);
  if (technologies.length) parts.push(`Technologies mentioned: ${technologies.join(', ')}.`);
  return parts.join(' ');
};

const parseMetadata = (metadata) => {
  try {
    return typeof metadata === 'string' ? JSON.parse(metadata || '{}') : (metadata || {});
  } catch {
    return {};
  }
};

const chunkKey = (chunk) => `${chunk.document_id}:${chunk.chunk_index}`;

const scoreChunk = ({ queryTokens, query, result, metadata, document }) => {
  const text = `${result.text || result.content || ''} ${metadata.section_title || ''} ${document?.filename || ''} ${document?.suggested_title || ''}`;
  const tokens = new Set(tokenize(text));
  const keywordHits = queryTokens.filter(token => tokens.has(token)).length;
  const title = normalizeText(`${document?.filename || ''} ${document?.suggested_title || ''}`);
  const asksCv = /\b(cv|resume|резюме)\b/i.test(query);
  const docAffinity = asksCv && /\b(cv|resume|резюме)\b/i.test(title) ? 4 : 0;
  const semantic = Number.isFinite(result.score) ? Math.max(0, 2 - result.score) : 0;
  return semantic + keywordHits * 1.5 + docAffinity;
};

const normalizeCandidate = (item, documents, queryTokens, query) => {
  const metadata = parseMetadata(item.metadata);
  const document = documents.find(doc => doc.id === item.document_id);
  const chunkIndex = Number.isFinite(metadata.chunk_index) ? metadata.chunk_index : Number(metadata.chunk_index ?? 0);
  return {
    id: item.id,
    document_id: item.document_id,
    filename: document?.filename || metadata.filename || 'local-document',
    suggested_title: document?.suggested_title || document?.filename || metadata.filename || 'Local document',
    chunk_index: Number.isFinite(chunkIndex) ? chunkIndex : 0,
    page_number: metadata.page_number || 1,
    section_title: metadata.section_title || 'Document',
    content_type: metadata.content_type || 'paragraph',
    keywords: Array.isArray(metadata.keywords) ? metadata.keywords : [],
    entities: metadata.entities || {},
    content: item.text || item.content || '',
    metadata,
    score: scoreChunk({ queryTokens, query, result: item, metadata, document })
  };
};

export const buildEnhancedContext = async ({
  query,
  vectorResults,
  documents,
  fetchDocumentDetail,
  maxContextChars = 12000
}) => {
  const queryTokens = tokenize(query);
  const baseCandidates = vectorResults
    .map(item => normalizeCandidate(item, documents, queryTokens, query))
    .sort((a, b) => b.score - a.score);

  const selected = new Map();
  const addCandidate = (candidate, reason) => {
    if (!candidate?.content) return;
    const key = chunkKey(candidate);
    const existing = selected.get(key);
    if (!existing || candidate.score > existing.score) {
      selected.set(key, { ...candidate, reason });
    }
  };

  for (const candidate of baseCandidates.slice(0, 16)) {
    addCandidate(candidate, 'semantic_rerank');
  }

  const docIds = Array.from(new Set(baseCandidates.slice(0, 6).map(item => item.document_id)));
  for (const documentId of docIds) {
    const detail = await fetchDocumentDetail(documentId).catch(() => null);
    if (!detail?.chunks?.length) continue;
    const document = documents.find(doc => doc.id === documentId) || detail;
    const chunksByIndex = new Map(detail.chunks.map(chunk => [chunk.chunk_index, chunk]));
    const docBaseCandidates = baseCandidates.filter(candidate => candidate.document_id === documentId).slice(0, 10);

    for (const candidate of docBaseCandidates) {
      for (const neighborIndex of [candidate.chunk_index - 1, candidate.chunk_index + 1]) {
        const neighbor = chunksByIndex.get(neighborIndex);
        if (!neighbor) continue;
        const metadata = parseMetadata(neighbor.metadata);
        addCandidate({
          ...candidate,
          id: neighbor.id,
          chunk_index: neighbor.chunk_index,
          page_number: metadata.page_number || candidate.page_number,
          section_title: metadata.section_title || candidate.section_title,
          content_type: metadata.content_type || candidate.content_type,
          keywords: metadata.keywords || [],
          entities: metadata.entities || {},
          content: neighbor.content,
          score: candidate.score - 0.25
        }, 'neighbor_window');
      }
    }

    const relevantSectionNames = new Set(docBaseCandidates.map(candidate => normalizeText(candidate.section_title)));
    const broadChunks = detail.chunks
      .map(chunk => {
        const metadata = parseMetadata(chunk.metadata);
        const section = normalizeText(metadata.section_title || '');
        const sectionMatch = relevantSectionNames.has(section) || queryTokens.some(token => section.includes(token));
        const textTokens = new Set(tokenize(chunk.content));
        const keywordHits = queryTokens.filter(token => textTokens.has(token)).length;
        return {
          id: chunk.id,
          document_id: documentId,
          filename: document.filename,
          suggested_title: document.suggested_title || document.filename,
          chunk_index: chunk.chunk_index,
          page_number: metadata.page_number || 1,
          section_title: metadata.section_title || 'Document',
          content_type: metadata.content_type || 'paragraph',
          keywords: metadata.keywords || [],
          entities: metadata.entities || {},
          content: chunk.content,
          metadata,
          score: keywordHits + (sectionMatch ? 3 : 0)
        };
      })
      .filter(chunk => chunk.score > 0)
      .sort((a, b) => b.score - a.score || a.chunk_index - b.chunk_index)
      .slice(0, 28);

    for (const chunk of broadChunks) {
      addCandidate(chunk, 'section_expansion');
    }
  }

  let usedChars = 0;
  const context = Array.from(selected.values())
    .sort((a, b) => b.score - a.score || a.document_id.localeCompare(b.document_id) || a.chunk_index - b.chunk_index)
    .filter(candidate => {
      const nextSize = candidate.content.length;
      if (usedChars + nextSize > maxContextChars) return false;
      usedChars += nextSize;
      return true;
    })
    .sort((a, b) => a.filename.localeCompare(b.filename) || a.chunk_index - b.chunk_index);

  return context.map(candidate => ({
    document_id: candidate.document_id,
    filename: candidate.filename,
    suggested_title: candidate.suggested_title,
    chunk_index: candidate.chunk_index,
    page_number: candidate.page_number,
    section_title: candidate.section_title,
    content_type: candidate.content_type,
    reason: candidate.reason,
    entities: candidate.entities,
    content: candidate.content
  }));
};
