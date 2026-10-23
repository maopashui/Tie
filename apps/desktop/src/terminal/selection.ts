import type { IBufferLine, Terminal } from "@xterm/xterm";

function sliceEndCol(line: IBufferLine, from: number, to: number): number {
  let end = from;
  for (let x = from; x < to; x++) {
    const cell = line.getCell(x);
    if (!cell) continue;
    // Code 0 = never written; keep real spaces / glyphs.
    if (cell.getCode() === 0) continue;
    end = x + Math.max(cell.getWidth(), 1);
  }
  return end;
}

function sliceHasGlyph(line: IBufferLine, from: number, to: number): boolean {
  for (let x = from; x < to; x++) {
    const cell = line.getCell(x);
    if (cell && cell.getCode() !== 0) return true;
  }
  return false;
}

/** Clipboard text: only rows that contain glyphs; each row right-trimmed to content. */
export function copyableSelection(term: Terminal): string {
  const range = term.getSelectionPosition();
  if (!range) return "";

  const { start, end } = range;
  const parts: string[] = [];

  for (let y = start.y; y <= end.y; y++) {
    const line = term.buffer.active.getLine(y);
    if (!line) continue;
    const x0 = y === start.y ? start.x : 0;
    const x1 = y === end.y ? end.x : term.cols;
    if (!sliceHasGlyph(line, x0, x1)) continue;

    // trimRight drops never-written pad; keeps intentional spaces.
    const text = line.translateToString(true, x0, x1);
    if (!text) continue;

    if (line.isWrapped && parts.length > 0) {
      parts[parts.length - 1] += text;
    } else {
      parts.push(text);
    }
  }

  return parts.join("\n");
}

export function isBlankSelection(term: Terminal): boolean {
  return term.hasSelection() && copyableSelection(term).length === 0;
}

function applyContentSelection(
  term: Terminal,
  firstY: number,
  firstX: number,
  lastY: number,
  lastX: number,
): void {
  if (firstY < 0 || (firstY === lastY && lastX <= firstX)) {
    term.clearSelection();
    return;
  }

  let length = 0;
  for (let y = firstY; y <= lastY; y++) {
    if (y === firstY && y === lastY) length = lastX - firstX;
    else if (y === firstY) length += term.cols - firstX;
    else if (y === lastY) length += lastX;
    else length += term.cols;
  }

  if (length <= 0) {
    term.clearSelection();
    return;
  }

  term.select(firstX, firstY, length);
}

/**
 * Snap the highlight to the first/last rows (and end column) that actually
 * contain glyphs, so empty rows below / pad-only drags do not stay selected.
 */
export function shrinkSelectionToContent(term: Terminal): void {
  const range = term.getSelectionPosition();
  if (!range) return;

  const { start, end } = range;
  const buffer = term.buffer.active;
  let firstY = -1;
  let lastY = -1;
  let firstX = 0;
  let lastX = 0;

  for (let y = start.y; y <= end.y; y++) {
    const line = buffer.getLine(y);
    if (!line) continue;
    const x0 = y === start.y ? start.x : 0;
    const x1 = y === end.y ? end.x : term.cols;
    if (!sliceHasGlyph(line, x0, x1)) continue;

    const contentEnd = sliceEndCol(line, x0, x1);
    if (firstY < 0) {
      firstY = y;
      firstX = x0;
    }
    lastY = y;
    lastX = contentEnd;
  }

  if (
    firstY >= 0 &&
    firstY === start.y &&
    lastY === end.y &&
    firstX === start.x &&
    lastX === end.x
  ) {
    return;
  }

  applyContentSelection(term, firstY, firstX, lastY, lastX);
}

/** Select only buffer rows that contain glyphs (Cmd/Ctrl+A). */
export function selectAllContent(term: Terminal): void {
  const buffer = term.buffer.active;
  let firstY = -1;
  let lastY = -1;
  let firstX = 0;
  let lastX = 0;

  for (let y = 0; y < buffer.length; y++) {
    const line = buffer.getLine(y);
    if (!line || !sliceHasGlyph(line, 0, term.cols)) continue;
    const contentEnd = sliceEndCol(line, 0, term.cols);
    if (firstY < 0) {
      firstY = y;
      firstX = 0;
    }
    lastY = y;
    lastX = contentEnd;
  }

  applyContentSelection(term, firstY, firstX, lastY, lastX);
}
