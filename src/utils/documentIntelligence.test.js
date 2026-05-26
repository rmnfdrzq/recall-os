import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildSmartChunks,
  buildDocumentSummary,
  buildLibraryInventoryContext,
  buildToolResultChatRequest,
  buildStructuredChatRequest,
  filterInventoryItemsForToolRequest,
  extractEntities,
  routeChatQuery,
  buildEnhancedContext
} from './documentIntelligence.js';
import {
  getFullDocumentContent,
  normalizeLocalDocument
} from './documentView.js';
import {
  getSummaryText
} from '../lib/summary.js';

test('buildSmartChunks stores section, page and neighbor metadata', () => {
  const chunks = buildSmartChunks(`[Page 1]

Experience

Worked at Acme Technologies Ltd as a backend engineer building React and Django systems.

[Page 2]

Education

Studied computer science.`, { filename: 'CV.pdf', maxLength: 180, overlap: 20 });

  assert.equal(chunks[0].filename, 'CV.pdf');
  assert.equal(chunks[0].section_title, 'Experience');
  assert.equal(chunks[0].page_number, 1);
  assert.equal(chunks[1].section_title, 'Education');
  assert.equal(chunks[1].page_number, 2);
  assert.equal(chunks[0].next_chunk_index, 1);
  assert.equal(chunks[1].prev_chunk_index, 0);
});

test('extractEntities captures organizations, dates and technologies', () => {
  const entities = extractEntities('In 2022 I worked at Acme Technologies Ltd with React, Django and PostgreSQL.');

  assert.deepEqual(entities.organizations, ['Acme Technologies Ltd']);
  assert.ok(entities.dates.includes('2022'));
  assert.ok(entities.technologies.includes('React'));
  assert.ok(entities.technologies.includes('Django'));
});

test('buildLibraryInventoryContext includes every stored document without interpreting the query', () => {
  const docs = [
    {
      id: 'doc-1',
      filename: 'city_architecture.txt',
      suggested_title: 'city_architecture.txt',
      summary: 'This document is about a university student named Mara.',
      category: 'General',
      status: 'processed',
    },
    {
      id: 'doc-2',
      filename: 'large_test_text_english.txt',
      suggested_title: 'large_test_text_english.txt',
      summary: 'This document explores organizational text processing.',
      category: 'General',
      status: 'processed',
    },
    {
      id: 'doc-3',
      filename: 'README.md',
      suggested_title: 'README.md',
      summary: 'This document provides Java source code examples.',
      category: 'General',
      status: 'processed',
    },
    {
      id: 'doc-4',
      filename: 'CV_Fedor_Rumiantsev.pdf',
      suggested_title: 'Frontend Developer Profile and Experience',
      summary: 'A Frontend Engineer with 3+ years of experience.',
      category: 'Technology',
      status: 'processed',
    },
  ];

  const context = buildLibraryInventoryContext(docs);

  assert.deepEqual(context.map(item => item.document_id), ['doc-1', 'doc-2', 'doc-3', 'doc-4']);
  assert.ok(context.every(item => item.reason === 'library_inventory'));
  assert.match(context[2].content, /Filename: README\.md/);
  assert.match(context[3].content, /Frontend Developer Profile and Experience/);

  const txtQuestionContext = buildLibraryInventoryContext(docs, { query: 'какие из них .txt документы?' });

  assert.deepEqual(txtQuestionContext.map(item => item.document_id), ['doc-1', 'doc-2', 'doc-3', 'doc-4']);
});

test('routeChatQuery leaves intent unclassified for the backend LLM router', () => {
  const docs = [
    { id: 'doc-1', filename: 'notes.txt', status: 'processed' },
    { id: 'doc-2', filename: 'CV.pdf', suggested_title: 'Resume', status: 'processed' },
  ];

  assert.deepEqual(routeChatQuery('Какие файлы есть у меня?', { documents: docs }), {
    query_mode: 'llm_routed',
    scope: {
      source: 'all_documents',
      document_ids: [],
      filters: {},
    },
    retrieval: { strategy: 'llm_router' },
  });

  assert.deepEqual(routeChatQuery('какие из них .txt документы?', { documents: docs }), {
    query_mode: 'llm_routed',
    scope: {
      source: 'all_documents',
      document_ids: [],
      filters: {},
    },
    retrieval: { strategy: 'llm_router' },
  });

  assert.deepEqual(routeChatQuery('Что сказано в CV.pdf?', { documents: docs, selectedDocumentIds: ['doc-2'] }), {
    query_mode: 'llm_routed',
    scope: {
      source: 'explicit_user_scope',
      document_ids: ['doc-2'],
      filters: {},
    },
    retrieval: { strategy: 'llm_router' },
  });

  assert.equal(routeChatQuery('Что говорится про архитектуру?', { documents: docs }).query_mode, 'llm_routed');
});

test('buildStructuredChatRequest separates inventory items from retrieved chunks', () => {
  const route = {
    query_mode: 'llm_routed',
    scope: {
      source: 'all_documents',
      document_ids: [],
      filters: {},
    },
    retrieval: { strategy: 'llm_router' },
  };
  const inventoryItems = [
    { document_id: 'doc-1', filename: 'a.txt', content: 'Filename: a.txt' },
    { document_id: 'doc-2', filename: 'b.txt', content: 'Filename: b.txt' },
  ];

  assert.deepEqual(buildStructuredChatRequest({
    content: 'какие .txt документы?',
    route,
    contextChunks: inventoryItems,
    inventoryItems,
  }), {
    content: 'какие .txt документы?',
    query_mode: 'llm_routed',
    scope: route.scope,
    retrieval: route.retrieval,
    context_chunks: inventoryItems,
    inventory_items: inventoryItems,
  });
});

test('buildStructuredChatRequest sends no local raw data before backend requests a tool', () => {
  const route = routeChatQuery('какие .txt документы?', { documents: [] });

  assert.deepEqual(buildStructuredChatRequest({
    content: 'какие .txt документы?',
    route,
  }), {
    content: 'какие .txt документы?',
    query_mode: 'llm_routed',
    scope: route.scope,
    retrieval: route.retrieval,
  });
});

test('filterInventoryItemsForToolRequest applies backend requested metadata filters locally', () => {
  const items = [
    { document_id: 'doc-1', filename: 'a.txt' },
    { document_id: 'doc-2', filename: 'b.pdf' },
    { document_id: 'doc-3', filename: 'c.txt' },
  ];

  assert.deepEqual(filterInventoryItemsForToolRequest(items, {
    args: { filters: { extension: 'txt' } },
  }).map(item => item.document_id), ['doc-1', 'doc-3']);
});

test('buildToolResultChatRequest returns only the requested local tool result', () => {
  const toolRequest = {
    tool_call_id: 'tool-1',
    tool: 'list_library',
    args: { filters: { extension: 'txt' } },
    route: {
      query_mode: 'extension_filter',
      scope: { source: 'library_metadata', document_ids: [], filters: { extension: 'txt' } },
      retrieval: { strategy: 'metadata_inventory' },
    },
    user_message_id: 12,
    tool_call_token: 'signed-token',
  };
  const items = [{ document_id: 'doc-1', filename: 'a.txt' }];

  assert.deepEqual(buildToolResultChatRequest({
    content: 'какие .txt документы?',
    toolRequest,
    items,
  }), {
    content: 'какие .txt документы?',
    query_mode: 'tool_result',
    user_message_id: 12,
    tool_call_token: 'signed-token',
    tool_result: {
      tool_call_id: 'tool-1',
      tool_call_token: 'signed-token',
      tool: 'list_library',
      args: { filters: { extension: 'txt' } },
      route: toolRequest.route,
      items,
    },
  });
});

test('buildDocumentSummary describes markdown content instead of ingestion metadata', () => {
  const markdown = `# Recall App

Desktop knowledge workspace for importing local documents, extracting text, indexing chunks, and asking questions over the library.

## Features

- Markdown, PDF, text, and image imports
- Local LanceDB storage
- Semantic search and contextual chat`;
  const chunks = buildSmartChunks(markdown, { filename: 'README.md' });

  const summary = buildDocumentSummary('README.md', markdown, chunks);

  assert.doesNotMatch(summary, /Indexed locally|Detected sections/i);
  assert.match(summary, /Recall App/i);
  assert.match(summary, /knowledge workspace|importing local documents|semantic search/i);
});

test('normalizeLocalDocument preserves detail chunks for markdown preview', () => {
  const normalized = normalizeLocalDocument({
    id: 'doc-1',
    filename: 'README.md',
    file_type: 'markdown',
    chunks: [
      { content: '# Title', chunk_index: 0 },
      { content: 'Body text', chunk_index: 1 }
    ]
  });

  assert.equal(normalized.chunks.length, 2);
  assert.equal(getFullDocumentContent(normalized), '# Title\n\nBody text');
});

test('getSummaryText shows generation state while AI summary is pending', () => {
  const summaryText = getSummaryText({
    status: 'summarizing',
    summary: ''
  });

  assert.equal(summaryText, 'Generating AI summary...');
});

test('buildEnhancedContext expands from semantic hit to neighboring and section chunks', async () => {
  const documents = [{
    id: 'doc-1',
    filename: 'CV_Fedor.pdf',
    suggested_title: 'CV Fedor',
  }];
  const chunks = buildSmartChunks(`Experience

Company one: Acme Technologies Ltd. Backend Engineer.

Company two: Beta Labs Inc. Product Engineer.

Skills

React, Django, PostgreSQL.`, { filename: 'CV_Fedor.pdf', maxLength: 90, overlap: 0 });

  const vectorResults = [{
    id: 'chunk-doc-1-0',
    document_id: 'doc-1',
    text: chunks[0].content,
    score: 0.2,
    metadata: JSON.stringify(chunks[0])
  }];

  const context = await buildEnhancedContext({
    query: 'согласно моему CV, в каких компаниях я работал?',
    vectorResults,
    documents,
    fetchDocumentDetail: async () => ({
      ...documents[0],
      chunks: chunks.map(chunk => ({
        id: `chunk-doc-1-${chunk.chunk_index}`,
        document_id: 'doc-1',
        content: chunk.content,
        chunk_index: chunk.chunk_index,
        metadata: JSON.stringify(chunk)
      }))
    }),
    maxContextChars: 2000
  });

  const joined = context.map(item => item.content).join('\n');
  assert.match(joined, /Acme Technologies Ltd/);
  assert.match(joined, /Beta Labs Inc/);
  assert.ok(context.some(item => item.reason === 'list_all_expansion' || item.reason === 'neighbor_window'));
});
