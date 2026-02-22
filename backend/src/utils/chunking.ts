export const chunkText = (input: string, maxChars = 3500): string[] => {
  const text = input.trim();
  if (!text) return [""];
  if (text.length <= maxChars) return [text];

  const chunks: string[] = [];
  let cursor = 0;

  while (cursor < text.length) {
    const remaining = text.slice(cursor);
    if (remaining.length <= maxChars) {
      chunks.push(remaining);
      break;
    }

    const segment = remaining.slice(0, maxChars);
    const splitAt =
      segment.lastIndexOf("\n\n") > maxChars * 0.5
        ? segment.lastIndexOf("\n\n")
        : segment.lastIndexOf("\n") > maxChars * 0.5
          ? segment.lastIndexOf("\n")
          : segment.lastIndexOf(" ") > maxChars * 0.5
            ? segment.lastIndexOf(" ")
            : maxChars;

    chunks.push(remaining.slice(0, splitAt).trimEnd());
    cursor += splitAt;
  }

  return chunks.filter(Boolean);
};
