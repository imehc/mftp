interface TextPiece {
  node: Text;
  start: number;
  end: number;
}

interface DisplayLine {
  start: number;
  end: number;
  range: Range;
}

/** 只测量当前段落，按 UTF-16 范围缓存实际折行，不把折行写回正文。 */
export class SpeechLines {
  private readonly pieces: TextPiece[] = [];
  private readonly boundaries: number[] = [];
  private readonly lines: DisplayLine[] = [];

  constructor(private readonly element: HTMLElement) {
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
    let text = "";
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const start = text.length;
      text += node.textContent ?? "";
      this.pieces.push({ node: node as Text, start, end: text.length });
    }
    // 不能在代理对或组合字符中间切开 Range，否则会出现半个字被高亮。
    for (const part of new Intl.Segmenter(undefined, {
      granularity: "grapheme",
    }).segment(text)) {
      this.boundaries.push(part.index);
    }
    this.boundaries.push(text.length);
  }

  private range(start: number, end: number): Range | null {
    const first = this.pieces.find((piece) => piece.end > start);
    const last = this.pieces.find((piece) => piece.end >= end);
    if (!first || !last) return null;
    const range = this.element.ownerDocument.createRange();
    range.setStart(first.node, start - first.start);
    range.setEnd(last.node, end - last.start);
    return range;
  }

  lineAt(offset: number): Range | null {
    const cached = this.lines.find(
      (line) => offset >= line.start && offset < line.end,
    );
    if (cached) return cached.range;
    const count = this.boundaries.length - 1;
    if (count < 1 || offset < 0 || offset >= this.boundaries[count])
      return null;
    let index = 0;
    let upper = count;
    while (index + 1 < upper) {
      const middle = (index + upper) >>> 1;
      if (this.boundaries[middle] <= offset) index = middle;
      else upper = middle;
    }
    const measure = (at: number) =>
      this.range(
        this.boundaries[at],
        this.boundaries[at + 1],
      )?.getBoundingClientRect();
    const target = measure(index);
    if (!target || !target.height) return null;
    const center = (target.top + target.bottom) / 2;
    const tolerance = target.height / 3;

    // 横排诗词的行纵坐标单调，用二分定位两侧边界，避免逐字触发布局读取。
    const boundary = (after: boolean) => {
      let low = after ? index + 1 : 0;
      let high = after ? count : index;
      while (low < high) {
        const middle = (low + high) >>> 1;
        const rect = measure(middle);
        if (!rect) return after ? index + 1 : index;
        const y = (rect.top + rect.bottom) / 2;
        if (y < center - tolerance || (after && y <= center + tolerance))
          low = middle + 1;
        else high = middle;
      }
      return low;
    };

    const start = this.boundaries[boundary(false)];
    const end = this.boundaries[boundary(true)];
    const range = this.range(start, end);
    if (range) this.lines.push({ start, end, range });
    return range;
  }
}

export function followScrollDelta(
  line: Pick<DOMRect, "top" | "bottom">,
  viewport: Pick<DOMRect, "top" | "bottom">,
  padding: number,
): number {
  if (line.top >= viewport.top && line.bottom <= viewport.bottom) return 0;
  if (line.top < viewport.top) return line.top - viewport.top - padding;
  return line.bottom - viewport.bottom + padding;
}
