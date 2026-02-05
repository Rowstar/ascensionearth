export function wrapText(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  if (words.length === 0) {
    return [""];
  }
  if (maxWidth <= 0) {
    return [text];
  }
  const lines: string[] = [];
  let current = "";

  const splitLongWord = (word: string): string[] => {
    const parts: string[] = [];
    let chunk = "";
    for (const ch of word) {
      const test = `${chunk}${ch}`;
      if (ctx.measureText(test).width > maxWidth && chunk.length > 0) {
        parts.push(chunk);
        chunk = ch;
      } else {
        chunk = test;
      }
    }
    if (chunk.length > 0) {
      parts.push(chunk);
    }
    return parts;
  };

  const pushCurrent = (): void => {
    if (current.length > 0) {
      lines.push(current);
      current = "";
    }
  };

  words.forEach((word) => {
    const parts = ctx.measureText(word).width > maxWidth ? splitLongWord(word) : [word];
    parts.forEach((part) => {
      if (current.length === 0) {
        current = part;
        return;
      }
      const test = `${current} ${part}`;
      if (ctx.measureText(test).width <= maxWidth) {
        current = test;
      } else {
        pushCurrent();
        current = part;
      }
    });
  });

  pushCurrent();
  return lines;
}
