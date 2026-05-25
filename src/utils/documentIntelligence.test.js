import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildSmartChunks,
  buildDocumentSummary,
  classifyQueryIntent,
  extractEntities,
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

test('classifyQueryIntent recognizes broad list questions', () => {
  assert.equal(classifyQueryIntent('Согласно моему CV, в каких компаниях я работал?'), 'list_all');
  assert.equal(classifyQueryIntent('Summarize this contract'), 'summarize');
  assert.equal(classifyQueryIntent('Compare these reports'), 'compare');
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
