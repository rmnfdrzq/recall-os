export const DEFAULT_LAYOUT_COLUMNS = [16.8, 54.464, 28.736];
export const MIN_LAYOUT_COLUMNS = [12, 24, 24];
export const RESIZE_HANDLE_TRACK_WIDTH = '0.75rem';
export const LAYOUT_COLUMNS_STORAGE_KEY = 'recallos.layout.columns';

const roundColumn = (value) => Math.round(value * 1000) / 1000;

const clampDelta = ({ columns, leftIndex, rightIndex, deltaPercent, minColumns }) => {
  const left = columns[leftIndex];
  const right = columns[rightIndex];
  const leftMin = minColumns[leftIndex];
  const rightMin = minColumns[rightIndex];
  const maxPositive = right - rightMin;
  const maxNegative = leftMin - left;
  return Math.max(maxNegative, Math.min(maxPositive, deltaPercent));
};

export const resizeColumns = ({
  columns,
  handle,
  deltaPercent,
  minColumns = MIN_LAYOUT_COLUMNS,
}) => {
  const next = [...columns];
  const [leftIndex, rightIndex] = handle === 'left' ? [0, 1] : [1, 2];
  const delta = clampDelta({ columns, leftIndex, rightIndex, deltaPercent, minColumns });

  next[leftIndex] = roundColumn(next[leftIndex] + delta);
  next[rightIndex] = roundColumn(next[rightIndex] - delta);
  return next;
};

export const isValidLayoutColumns = (columns, minColumns = MIN_LAYOUT_COLUMNS) => {
  if (!Array.isArray(columns) || columns.length !== 3) return false;
  if (!columns.every((column) => Number.isFinite(column))) return false;
  if (!columns.every((column, index) => column >= minColumns[index])) return false;
  const total = columns.reduce((sum, column) => sum + column, 0);
  return Math.abs(total - 100) < 0.01;
};

export const serializeLayoutColumns = (columns) => (
  JSON.stringify(columns.map((column) => roundColumn(column)))
);

export const parseStoredLayoutColumns = (storedValue) => {
  try {
    const parsed = JSON.parse(storedValue);
    return isValidLayoutColumns(parsed) ? parsed : null;
  } catch {
    return null;
  }
};

export const columnsToGridTemplate = (columns) => (
  [
    `minmax(0, ${columns[0]}fr)`,
    RESIZE_HANDLE_TRACK_WIDTH,
    `minmax(0, ${columns[1]}fr)`,
    RESIZE_HANDLE_TRACK_WIDTH,
    `minmax(0, ${columns[2]}fr)`,
  ].join(' ')
);
