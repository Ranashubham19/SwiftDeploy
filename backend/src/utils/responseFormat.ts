const codeFencePattern = /```[a-zA-Z0-9_-]*\n?([\s\S]*?)```/g;
const headingPattern = /^\s*#{1,6}\s+/gm;
const hrPattern = /^\s*[-_*]{3,}\s*$/gm;
const boldPattern = /\*\*(.*?)\*\*/g;
const italicPattern = /\*(.*?)\*/g;
const inlineCodePattern = /`([^`]+)`/g;
const tableDividerPattern = /^\s*\|?\s*[-:]+\s*(\|\s*[-:]+\s*)+\|?\s*$/;
const tableRowPattern = /^\s*\|.*\|\s*$/;
const listItemPattern = /^\s*(?:[-*•]+|\d+[.)])\s+(.*)$/;

const normalizeAscii = (input: string): string =>
  input
    .normalize("NFKD")
    .replace(/[^\x09\x0A\x0D\x20-\x7E]/g, "")
    .replace(/[ \t]+/g, " ")
    .replace(/\r\n/g, "\n");

const removeMarkdownArtifacts = (input: string): string => {
  let output = input;
  output = output.replace(codeFencePattern, (_match, code: string) => {
    const cleaned = String(code || "")
      .split("\n")
      .map((line) => line.trimEnd())
      .join("\n")
      .trim();
    return cleaned ? `Code Example:\n${cleaned}` : "";
  });
  output = output.replace(headingPattern, "");
  output = output.replace(hrPattern, "");
  output = output.replace(boldPattern, "$1");
  output = output.replace(italicPattern, "$1");
  output = output.replace(inlineCodePattern, "$1");
  return output;
};

const renumberLists = (lines: string[]): string[] => {
  const out: string[] = [];
  let listIndex = 0;
  let inList = false;

  for (const rawLine of lines) {
    const line = rawLine.trim();

    if (!line) {
      out.push("");
      inList = false;
      listIndex = 0;
      continue;
    }

    if (tableDividerPattern.test(line)) {
      continue;
    }
    if (tableRowPattern.test(line)) {
      const cells = line
        .split("|")
        .map((cell) => cell.trim())
        .filter(Boolean);
      if (cells.length > 0) {
        if (!inList) {
          listIndex = 1;
        } else {
          listIndex += 1;
        }
        out.push(`${listIndex}. ${cells.join(" - ")}`);
        inList = true;
      }
      continue;
    }

    const itemMatch = line.match(listItemPattern);
    if (itemMatch) {
      const content = itemMatch[1].trim();
      if (!inList) {
        listIndex = 1;
      } else {
        listIndex += 1;
      }
      out.push(`${listIndex}. ${content}`);
      inList = true;
      continue;
    }

    inList = false;
    listIndex = 0;
    out.push(line);
  }

  return out;
};

export const formatProfessionalReply = (input: string): string => {
  const stripped = removeMarkdownArtifacts(input || "");
  const ascii = normalizeAscii(stripped);

  const lines = ascii.split("\n");
  const normalizedLines = renumberLists(lines)
    .map((line) => line.replace(/\s{2,}/g, " ").trimEnd())
    .filter((line, index, arr) => {
      // Collapse repeated blank lines.
      if (line !== "") return true;
      return index === 0 || arr[index - 1] !== "";
    });

  const output = normalizedLines.join("\n").trim();
  return output || "I could not generate a clean response. Please try again.";
};
