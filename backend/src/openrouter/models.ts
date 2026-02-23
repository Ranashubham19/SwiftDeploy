export type ModelRegistryKey =
  | "auto"
  | "fast"
  | "smart"
  | "code"
  | "math"
  | "vision";

export type ModelProfile = {
  key: ModelRegistryKey;
  label: string;
  id: string;
  description: string;
  temperature: number;
  maxTokens: number;
};

const fromEnv = (name: string, fallback: string): string =>
  (process.env[name] || "").trim() || fallback;

export const MODEL_REGISTRY: Record<ModelRegistryKey, ModelProfile> = {
  auto: {
    key: "auto",
    label: "Auto",
    id: fromEnv("DEFAULT_MODEL", "openrouter/free"),
    description: "Intent-based automatic routing.",
    temperature: 0.45,
    maxTokens: 1600,
  },
  fast: {
    key: "fast",
    label: "Fast",
    id: fromEnv("MODEL_FAST_ID", "meta-llama/llama-3.2-3b-instruct:free"),
    description: "Low-latency general assistant.",
    temperature: 0.45,
    maxTokens: 1200,
  },
  smart: {
    key: "smart",
    label: "Smart",
    id: fromEnv("MODEL_SMART_ID", "openrouter/free"),
    description: "High quality general reasoning.",
    temperature: 0.4,
    maxTokens: 1800,
  },
  code: {
    key: "code",
    label: "Code",
    id: fromEnv("MODEL_CODE_ID", "qwen/qwen3-coder:free"),
    description: "Coding, debugging, and architecture.",
    temperature: 0.2,
    maxTokens: 2000,
  },
  math: {
    key: "math",
    label: "Math",
    id: fromEnv("MODEL_MATH_ID", "deepseek/deepseek-r1-0528:free"),
    description: "Mathematics and step-by-step reasoning.",
    temperature: 0.15,
    maxTokens: 2000,
  },
  vision: {
    key: "vision",
    label: "Vision",
    id: fromEnv("MODEL_VISION_ID", "nvidia/nemotron-nano-12b-v2-vl:free"),
    description: "Image-capable model where supported.",
    temperature: 0.35,
    maxTokens: 1400,
  },
};

export const MODEL_LIST: ModelProfile[] = [
  MODEL_REGISTRY.auto,
  MODEL_REGISTRY.fast,
  MODEL_REGISTRY.smart,
  MODEL_REGISTRY.code,
  MODEL_REGISTRY.math,
  MODEL_REGISTRY.vision,
];

export const FALLBACK_MODEL_ID = fromEnv(
  "FALLBACK_MODEL",
  MODEL_REGISTRY.fast.id,
);

export const resolveModelFromKey = (
  key: string | null | undefined,
): ModelProfile | null => {
  if (!key) return null;
  const normalized = key.trim().toLowerCase() as ModelRegistryKey;
  if (normalized in MODEL_REGISTRY) {
    return MODEL_REGISTRY[normalized];
  }
  return null;
};
