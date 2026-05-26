import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_LAYOUT_COLUMNS,
  columnsToGridTemplate,
  parseStoredLayoutColumns,
  resizeColumns,
  serializeLayoutColumns
} from './resizableLayout.js';

test('default layout starts library at about 234px on a 1440px viewport', () => {
  const viewportWidth = 1440;
  const gridPadding = 24;
  const handlesWidth = 24;
  const availableColumnWidth = viewportWidth - gridPadding - handlesWidth;
  const libraryWidth = availableColumnWidth * (DEFAULT_LAYOUT_COLUMNS[0] / 100);

  assert.equal(Math.round(libraryWidth), 234);
});

test('default layout starts AI chat at about 400px on a 1440px viewport', () => {
  const viewportWidth = 1440;
  const gridPadding = 24;
  const handlesWidth = 24;
  const availableColumnWidth = viewportWidth - gridPadding - handlesWidth;
  const chatWidth = availableColumnWidth * (DEFAULT_LAYOUT_COLUMNS[2] / 100);

  assert.equal(Math.round(chatWidth), 400);
});

test('resizeColumns moves width between library and preview on the left handle', () => {
  const next = resizeColumns({
    columns: [18, 50, 32],
    handle: 'left',
    deltaPercent: 4,
  });

  assert.deepEqual(next, [22, 46, 32]);
});

test('resizeColumns moves width between preview and chat on the right handle', () => {
  const next = resizeColumns({
    columns: [18, 50, 32],
    handle: 'right',
    deltaPercent: -5,
  });

  assert.deepEqual(next, [18, 45, 37]);
});

test('resizeColumns respects minimum widths while preserving total width', () => {
  const next = resizeColumns({
    columns: [18, 50, 32],
    handle: 'right',
    deltaPercent: 40,
    minColumns: [12, 24, 24],
  });

  assert.deepEqual(next, [18, 58, 24]);
  assert.equal(Math.round(next.reduce((sum, value) => sum + value, 0)), 100);
});

test('columnsToGridTemplate includes centered tracks for resize handles', () => {
  assert.equal(
    columnsToGridTemplate([15, 55, 30]),
    'minmax(0, 15fr) 0.75rem minmax(0, 55fr) 0.75rem minmax(0, 30fr)'
  );
});

test('stored layout columns round-trip and reject invalid values', () => {
  const stored = serializeLayoutColumns([16.25, 51.5, 32.25]);

  assert.equal(stored, '[16.25,51.5,32.25]');
  assert.deepEqual(parseStoredLayoutColumns(stored), [16.25, 51.5, 32.25]);
  assert.equal(parseStoredLayoutColumns('[5,80,15]'), null);
  assert.equal(parseStoredLayoutColumns('not-json'), null);
});
