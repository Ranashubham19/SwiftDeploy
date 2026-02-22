import { evaluateExpression } from "./calculator.js";
import { getDateTime } from "./datetime.js";
import { convertUnit } from "./convert.js";

export type ToolSchema = {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
};

export type ExecutedTool = {
  name: string;
  input: Record<string, unknown>;
  output: string;
  isError: boolean;
};

const summarizeText = (text: string): string => {
  const cleaned = text.trim().replace(/\s+/g, " ");
  if (!cleaned) return "No text provided.";

  const sentences = cleaned
    .split(/(?<=[.!?])\s+/)
    .map((sentence) => sentence.trim())
    .filter(Boolean);

  if (sentences.length <= 3) return sentences.join(" ");
  return `${sentences.slice(0, 3).join(" ")} ...`;
};

const rewriteText = (text: string, tone = "professional"): string => {
  const cleaned = text.trim();
  if (!cleaned) return "No text provided.";

  const lowerTone = tone.toLowerCase();
  if (lowerTone === "concise") {
    const summarized = summarizeText(cleaned);
    return summarized.length > 260
      ? `${summarized.slice(0, 257).trimEnd()}...`
      : summarized;
  }
  if (lowerTone === "formal") {
    return cleaned
      .replace(/\bcan't\b/gi, "cannot")
      .replace(/\bwon't\b/gi, "will not")
      .replace(/\bI'm\b/gi, "I am");
  }
  if (lowerTone === "casual") {
    return cleaned
      .replace(/\bdo not\b/gi, "don't")
      .replace(/\bcannot\b/gi, "can't")
      .replace(/\bi am\b/gi, "I'm");
  }
  return cleaned;
};

const extractKeyPoints = (text: string): string => {
  const cleaned = text.trim();
  if (!cleaned) return "No text provided.";

  const lines = cleaned
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean);

  const points = lines.length > 1 ? lines : cleaned.split(/(?<=[.!?])\s+/);
  return points
    .slice(0, 8)
    .map((point, index) => `${index + 1}. ${point.trim()}`)
    .join("\n");
};

export const TOOL_SCHEMAS: ToolSchema[] = [
  {
    type: "function",
    function: {
      name: "calculator",
      description: "Evaluate a math expression safely.",
      parameters: {
        type: "object",
        properties: {
          expression: {
            type: "string",
            description: "Arithmetic expression, e.g. (12*4)+3^2",
          },
        },
        required: ["expression"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "date_time",
      description: "Get the current date and time in a timezone.",
      parameters: {
        type: "object",
        properties: {
          timezone: {
            type: "string",
            description: "IANA timezone, e.g. Asia/Kolkata or America/New_York",
          },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "unit_convert",
      description: "Convert values between common units.",
      parameters: {
        type: "object",
        properties: {
          value: { type: "number" },
          from: { type: "string" },
          to: { type: "string" },
        },
        required: ["value", "from", "to"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "text_summarize",
      description: "Summarize text into a short compact version.",
      parameters: {
        type: "object",
        properties: {
          text: { type: "string" },
        },
        required: ["text"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "text_rewrite",
      description: "Rewrite text in a different tone.",
      parameters: {
        type: "object",
        properties: {
          text: { type: "string" },
          tone: {
            type: "string",
            enum: ["professional", "formal", "casual", "concise"],
          },
        },
        required: ["text"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "text_extract_key_points",
      description: "Extract key points from text.",
      parameters: {
        type: "object",
        properties: {
          text: { type: "string" },
        },
        required: ["text"],
      },
    },
  },
];

const parseArgs = (
  args: string | Record<string, unknown> | undefined,
): Record<string, unknown> => {
  if (!args) return {};
  if (typeof args === "string") {
    try {
      const parsed = JSON.parse(args) as Record<string, unknown>;
      return parsed;
    } catch {
      return {};
    }
  }
  return args;
};

export const executeTool = async (
  name: string,
  argsRaw: string | Record<string, unknown> | undefined,
): Promise<ExecutedTool> => {
  const input = parseArgs(argsRaw);

  try {
    if (name === "calculator") {
      const expression = String(input.expression ?? "");
      const result = evaluateExpression(expression);
      return {
        name,
        input,
        output: String(result),
        isError: false,
      };
    }

    if (name === "date_time") {
      const timezone = String(input.timezone ?? "UTC");
      const result = getDateTime(timezone);
      return {
        name,
        input,
        output: result,
        isError: false,
      };
    }

    if (name === "unit_convert") {
      const value = Number(input.value);
      const from = String(input.from ?? "");
      const to = String(input.to ?? "");
      const result = convertUnit(value, from, to);
      return {
        name,
        input,
        output: `${value} ${from} = ${result} ${to}`,
        isError: false,
      };
    }

    if (name === "text_summarize") {
      const text = String(input.text ?? "");
      return {
        name,
        input,
        output: summarizeText(text),
        isError: false,
      };
    }

    if (name === "text_rewrite") {
      const text = String(input.text ?? "");
      const tone = String(input.tone ?? "professional");
      return {
        name,
        input,
        output: rewriteText(text, tone),
        isError: false,
      };
    }

    if (name === "text_extract_key_points") {
      const text = String(input.text ?? "");
      return {
        name,
        input,
        output: extractKeyPoints(text),
        isError: false,
      };
    }

    return {
      name,
      input,
      output: `Unsupported tool: ${name}`,
      isError: true,
    };
  } catch (error) {
    return {
      name,
      input,
      output: error instanceof Error ? error.message : String(error),
      isError: true,
    };
  }
};

export const shouldEnableTools = (text: string): boolean => {
  const message = text.toLowerCase();
  const patterns = [
    /\bcalculate\b/,
    /\bsolve\b/,
    /\bconvert\b/,
    /\btimezone\b/,
    /\btime in\b/,
    /\bsummarize\b/,
    /\brewrite\b/,
    /\bkey points?\b/,
    /[0-9]+\s*(\+|-|\*|\/)\s*[0-9]+/,
  ];
  return patterns.some((pattern) => pattern.test(message));
};
