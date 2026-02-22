import {
  FALLBACK_MODEL_ID,
  MODEL_REGISTRY,
  resolveModelFromKey,
} from "./models.js";

export type Intent =
  | "coding"
  | "math"
  | "general"
  | "current_events"
  | "ambiguous_python";

const codingPattern =
  /\b(code|coding|debug|bug|function|class|typescript|javascript|python|java|c\+\+|node|react|api|stack trace|compile|pip|syntax|install|algorithm)\b/i;

const mathPattern =
  /\b(math|algebra|calculus|equation|differentiate|integrate|solve|probability|statistics|matrix|derive)\b|[0-9]+\s*[\+\-*/]\s*[0-9]+/i;

const currentEventsPattern =
  /\b(news|latest|today|yesterday|breaking|current events|what happened|stock today|election today)\b/i;

const pythonProgrammingPattern =
  /\b(learn|code|function|error|install|pip|syntax|script|programming|debug)\b/i;

const pythonEntertainmentPattern = /\b(monty|movie|comedy|series|show)\b/i;

export const detectIntent = (text: string): Intent => {
  const normalized = text.trim().toLowerCase();

  if (normalized.includes("python")) {
    if (pythonProgrammingPattern.test(normalized)) {
      return "coding";
    }
    if (!pythonEntertainmentPattern.test(normalized)) {
      return "ambiguous_python";
    }
  }

  if (codingPattern.test(normalized)) return "coding";
  if (mathPattern.test(normalized)) return "math";
  if (currentEventsPattern.test(normalized)) return "current_events";
  return "general";
};

export type RoutedModel = {
  modelId: string;
  modelKey: string;
  temperature: number;
  maxTokens: number;
  autoRouted: boolean;
};

export const routeModel = (
  selectedModelKey: string | null | undefined,
  intent: Intent,
): RoutedModel => {
  const selected = resolveModelFromKey(selectedModelKey);

  if (selected && selected.key !== "auto") {
    return {
      modelId: selected.id,
      modelKey: selected.key,
      temperature: selected.temperature,
      maxTokens: selected.maxTokens,
      autoRouted: false,
    };
  }

  if (selectedModelKey && !selected && selectedModelKey !== "auto") {
    return {
      modelId: selectedModelKey,
      modelKey: "custom",
      temperature: 0.4,
      maxTokens: 1200,
      autoRouted: false,
    };
  }

  if (intent === "coding") {
    const model = MODEL_REGISTRY.code;
    return {
      modelId: model.id,
      modelKey: model.key,
      temperature: model.temperature,
      maxTokens: model.maxTokens,
      autoRouted: true,
    };
  }

  if (intent === "math") {
    const model = MODEL_REGISTRY.math;
    return {
      modelId: model.id,
      modelKey: model.key,
      temperature: model.temperature,
      maxTokens: model.maxTokens,
      autoRouted: true,
    };
  }

  if (intent === "current_events") {
    const model = MODEL_REGISTRY.fast;
    return {
      modelId: model.id,
      modelKey: model.key,
      temperature: 0.2,
      maxTokens: model.maxTokens,
      autoRouted: true,
    };
  }

  const model = MODEL_REGISTRY.fast;
  return {
    modelId: model.id || FALLBACK_MODEL_ID,
    modelKey: model.key,
    temperature: model.temperature,
    maxTokens: model.maxTokens,
    autoRouted: true,
  };
};

export const currentEventsDisclaimer =
  "I do not have live web browsing in this setup. I can still help with background context and likely scenarios based on known information.";
