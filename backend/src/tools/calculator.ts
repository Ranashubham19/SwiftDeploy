const SAFE_EXPR_RE = /^[0-9+\-*/().,%\s^]+$/;

const normalizeExpression = (expression: string): string =>
  expression.replace(/,/g, "").replace(/\^/g, "**");

export const evaluateExpression = (expression: string): number => {
  const trimmed = expression.trim();
  if (!trimmed) {
    throw new Error("Expression is required.");
  }
  if (trimmed.length > 300) {
    throw new Error("Expression is too long.");
  }
  if (!SAFE_EXPR_RE.test(trimmed)) {
    throw new Error("Expression contains unsupported characters.");
  }

  const normalized = normalizeExpression(trimmed);
  // Input is restricted to arithmetic symbols only; no names or statements.
  const result = Function(`"use strict"; return (${normalized});`)();

  if (typeof result !== "number" || !Number.isFinite(result)) {
    throw new Error("Expression did not produce a finite number.");
  }

  return result;
};
