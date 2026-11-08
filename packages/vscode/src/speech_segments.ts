/** A source range returned by the sentence segmenter. */
export interface SpeechSentenceRange {
  segment: string;
  index: number;
}

/** An injectable sentence segmenter for platforms without Intl.Segmenter. */
export interface SpeechSegmentation {
  segment?: (text: string) => Iterable<SpeechSentenceRange>;
}

const MAX_PARTS = 4;

/** Uses the host's sentence boundary implementation without modifying text. */
function nativeSegments(text: string): Iterable<SpeechSentenceRange> {
  return new Intl.Segmenter(undefined, { granularity: 'sentence' }).segment(text);
}

/** Splits exact source slices into at most four parts, or keeps uncertain text whole. */
export function speechSegments(text: string, options?: SpeechSegmentation): string[] {
  const segment = options === undefined ? nativeSegments : options.segment;
  if (segment === undefined || text.length === 0) return [text];
  try {
    const parts: string[] = [];
    let offset = 0;
    let finalStart = 0;
    for (const range of segment(text)) {
      if (range.index !== offset || range.segment.length === 0 || !text.startsWith(range.segment, offset)) return [text];
      offset += range.segment.length;
      if (parts.length < MAX_PARTS) {
        if (parts.length === MAX_PARTS - 1) finalStart = range.index;
        parts.push(range.segment);
      } else parts[MAX_PARTS - 1] = text.slice(finalStart, offset);
    }
    return offset === text.length ? parts : [text];
  } catch {
    return [text];
  }
}
