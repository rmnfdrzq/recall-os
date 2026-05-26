import test from 'node:test';
import assert from 'node:assert/strict';
import {
  findActiveDocumentMention,
  findReferencedDocuments,
  getDocumentMentionRanges,
  insertDocumentMention,
  getScopedDocuments,
  getDocumentMentionSuggestions
} from './chatScope.js';

const documents = [
  { id: 'doc-1', filename: 'Project Alpha.pdf', suggested_title: 'Alpha Contract', status: 'processed' },
  { id: 'doc-2', filename: 'Beta Notes.md', suggested_title: 'Meeting Notes', status: 'processed' },
  { id: 'doc-3', filename: 'CV_Fedor.pdf', suggested_title: 'Resume', status: 'processed' }
];

test('findActiveDocumentMention returns the query after the active @ token', () => {
  assert.deepEqual(findActiveDocumentMention('compare @alp', 12), {
    start: 8,
    end: 12,
    query: 'alp'
  });
});

test('getDocumentMentionSuggestions filters documents by filename and suggested title', () => {
  const byFilename = getDocumentMentionSuggestions(documents, 'bet');
  assert.deepEqual(byFilename.map(doc => doc.id), ['doc-2']);

  const byTitle = getDocumentMentionSuggestions(documents, 'contract');
  assert.deepEqual(byTitle.map(doc => doc.id), ['doc-1']);
});

test('getScopedDocuments returns selected documents or all documents when scope is empty', () => {
  assert.deepEqual(getScopedDocuments(documents, ['doc-2']).map(doc => doc.id), ['doc-2']);
  assert.deepEqual(getScopedDocuments(documents, []).map(doc => doc.id), ['doc-1', 'doc-2', 'doc-3']);
});

test('findReferencedDocuments detects explicit filenames in the user query', () => {
  const referenced = findReferencedDocuments('Про что говорится в тексте Beta Notes.md?', documents);

  assert.deepEqual(referenced.map(doc => doc.id), ['doc-2']);
});

test('insertDocumentMention replaces the active mention query with the document label', () => {
  const mention = findActiveDocumentMention('compare @alp with beta', 12);
  const result = insertDocumentMention('compare @alp with beta', mention, documents[0]);

  assert.equal(result.value, 'compare @Alpha Contract with beta');
  assert.equal(result.cursorIndex, 'compare @Alpha Contract '.length);
});

test('getDocumentMentionRanges identifies document mentions in chat input text', () => {
  const ranges = getDocumentMentionRanges('compare @Alpha Contract and @Beta Notes.md', documents);

  assert.deepEqual(ranges.map((range) => ({
    start: range.start,
    end: range.end,
    documentId: range.document.id
  })), [
    { start: 8, end: 23, documentId: 'doc-1' },
    { start: 28, end: 42, documentId: 'doc-2' }
  ]);
});
