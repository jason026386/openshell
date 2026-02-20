export function splitTextForPlatform(text: string, limit: number): string[] {
  if (text.length <= limit) {
    return [text];
  }

  const lines = text.split("\n");
  const chunks: string[] = [];
  let current = "";

  const pushCurrent = (): void => {
    if (current) {
      chunks.push(current);
      current = "";
    }
  };

  for (const line of lines) {
    const candidate = current ? `${current}\n${line}` : line;
    if (candidate.length <= limit) {
      current = candidate;
      continue;
    }

    pushCurrent();

    if (line.length <= limit) {
      current = line;
      continue;
    }

    for (let i = 0; i < line.length; i += limit) {
      chunks.push(line.slice(i, i + limit));
    }
  }

  pushCurrent();
  return chunks;
}

