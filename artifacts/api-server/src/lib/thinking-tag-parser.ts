function partialTagOverlap(text: string, tag: string): number {
  const maxCheck = Math.min(text.length, tag.length - 1);
  for (let len = maxCheck; len >= 1; len--) {
    if (text.endsWith(tag.slice(0, len))) {
      return len;
    }
  }
  return 0;
}

export function createThinkingTagParser(
  onContentChunk: (text: string) => void,
  onThinkingChunk: (text: string) => void,
): { processText: (text: string) => void; flush: () => void } {
  const OPEN_TAG = "<thinking>";
  const CLOSE_TAG = "</thinking>";
  let insideThinking = false;
  let tagBuffer = "";

  const processText = (text: string) => {
    tagBuffer += text;

    while (tagBuffer.length > 0) {
      if (!insideThinking) {
        const openIdx = tagBuffer.indexOf(OPEN_TAG);
        if (openIdx === -1) {
          const overlap = partialTagOverlap(tagBuffer, OPEN_TAG);
          const safe = tagBuffer.slice(0, tagBuffer.length - overlap);
          if (safe) onContentChunk(safe);
          tagBuffer = tagBuffer.slice(tagBuffer.length - overlap);
          break;
        }
        if (openIdx > 0) onContentChunk(tagBuffer.slice(0, openIdx));
        tagBuffer = tagBuffer.slice(openIdx + OPEN_TAG.length);
        insideThinking = true;
      } else {
        const closeIdx = tagBuffer.indexOf(CLOSE_TAG);
        if (closeIdx === -1) {
          const overlap = partialTagOverlap(tagBuffer, CLOSE_TAG);
          const safe = tagBuffer.slice(0, tagBuffer.length - overlap);
          if (safe) onThinkingChunk(safe);
          tagBuffer = tagBuffer.slice(tagBuffer.length - overlap);
          break;
        }
        if (closeIdx > 0) onThinkingChunk(tagBuffer.slice(0, closeIdx));
        tagBuffer = tagBuffer.slice(closeIdx + CLOSE_TAG.length);
        insideThinking = false;
      }
    }
  };

  const flush = () => {
    if (!tagBuffer) return;
    if (insideThinking) {
      onThinkingChunk(tagBuffer);
    } else {
      onContentChunk(tagBuffer);
    }
    tagBuffer = "";
  };

  return { processText, flush };
}
