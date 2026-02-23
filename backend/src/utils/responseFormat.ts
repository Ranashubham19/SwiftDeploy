const codeFencePattern = /```[a-zA-Z0-9_-]*\n?([\s\S]*?)```/g;
const headingPattern = /^\s*#{1,6}\s+/gm;
const hrPattern = /^\s*[-_*]{3,}\s*$/gm;
const boldPattern = /\*\*(.*?)\*\*/g;
const italicPattern = /\*(.*?)\*/g;
const inlineCodePattern = /`([^`]+)`/g;
const tableDividerPattern = /^\s*\|?\s*[-:]+\s*(\|\s*[-:]+\s*)+\|?\s*$/;
const tableRowPattern = /^\s*\|.*\|\s*$/;
const listItemPattern = /^\s*(?:[-*\u2022]+|\d+[.)]|[a-zA-Z][.)])\s+(.*)$/;
const numberedPattern = /^\d+\.\s+/;
const shortHeadingPattern = /^[A-Za-z][A-Za-z0-9 ,()/-]{2,80}:$/;

const normalizeAscii = (input: string): string =>
  input
    .normalize("NFKD")
    .replace(/[^\x09\x0A\x0D\x20-\x7E]/g, "")
    .replace(/[ \t]+/g, " ")
    .replace(/\r\n/g, "\n");

const normalizeAsciiPreserveSpacing = (input: string): string =>
  input
    .normalize("NFKD")
    .replace(/[^\x09\x0A\x0D\x20-\x7E]/g, "")
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

const removeDecorativeSpecialChars = (input: string): string =>
  input
    .replace(/[`|~^]+/g, "")
    .replace(/[#@]+/g, "")
    .replace(/[<>{}]/g, "")
    .replace(/[^\w\s.,:;!?()[\]+\-*/=%'"/]/g, "")
    .replace(/[ ]{2,}/g, " ");

const normalizeOperatorSpacing = (input: string): string =>
  input
    // Keep operator presentation clean for numeric/algebraic expressions.
    .replace(/(\d|\)|\])\s*([+\-*/=])\s*(\d|\(|\[|[A-Za-z_])/g, "$1 $2 $3")
    .replace(/([A-Za-z_])\s*([+\-*/=])\s*(\d|\(|\[)/g, "$1 $2 $3")
    .replace(/([A-Za-z_][A-Za-z0-9_]*)\s*=\s*([A-Za-z_][A-Za-z0-9_]*|\d)/g, "$1 = $2")
    // Normalize compact operator lists like +-*/.
    .replace(/\+\s*-\s*\*\s*\/+/g, "+, -, *, /");

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

const addParagraphSpacing = (lines: string[]): string[] => {
  const out: string[] = [];
  const lastNonBlank = (): string =>
    [...out].reverse().find((line) => line.trim().length > 0) || "";

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) {
      if (out.length > 0 && out[out.length - 1] !== "") {
        out.push("");
      }
      continue;
    }

    const previous = lastNonBlank();
    const isNumbered = numberedPattern.test(line);
    const wasNumbered = numberedPattern.test(previous);
    const isHeading = shortHeadingPattern.test(line);
    const wasHeading = shortHeadingPattern.test(previous);

    if (out.length > 0 && out[out.length - 1] !== "") {
      if (isHeading || (isNumbered && !wasNumbered) || (!isNumbered && wasNumbered && !isHeading)) {
        out.push("");
      } else if (!isNumbered && !wasNumbered && !isHeading && !wasHeading) {
        const previousEndsSentence = /[.!?]$/.test(previous);
        if (previousEndsSentence && line.length > 90) {
          out.push("");
        }
      }
    }

    out.push(line);
  }

  return out;
};

const spreadNumberedItems = (lines: string[]): string[] => {
  const out: string[] = [];
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    const next = i + 1 < lines.length ? lines[i + 1] : "";
    out.push(line);
    if (numberedPattern.test(line) && next && next.trim() !== "" && numberedPattern.test(next)) {
      out.push("");
    }
  }
  return out;
};

export const formatProfessionalReply = (input: string): string => {
  const stripped = removeMarkdownArtifacts(input || "");
  const ascii = normalizeAscii(stripped);
  const cleaned = removeDecorativeSpecialChars(normalizeOperatorSpacing(ascii));

  const lines = cleaned.split("\n");
  const normalizedLines = spreadNumberedItems(addParagraphSpacing(renumberLists(lines)))
    .map((line) => line.replace(/\s{2,}/g, " ").trimEnd())
    .filter((line, index, arr) => {
      if (line !== "") return true;
      return index === 0 || arr[index - 1] !== "";
    });

  const output = normalizedLines.join("\n").trim();
  return output || "I could not generate a clean response. Please try again.";
};

export const formatProfessionalCodeReply = (input: string): string => {
  const ascii = normalizeAsciiPreserveSpacing(input || "");
  const lines = ascii
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((line) => line.replace(/[ \t]+$/g, ""))
    .filter((line, index, arr) => !(line === "" && arr[index - 1] === ""));

  const output = lines.join("\n").replace(/\n{3,}/g, "\n\n").trim();
  return output || "I could not generate code output. Please try again.";
};
