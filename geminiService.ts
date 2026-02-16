
import { GoogleGenAI, GenerateContentResponse } from "@google/genai";
import { AIModel } from "./types";

/**
 * Dashboard Neural Interface Service
 * Compliant with @google/genai version 1.41.0
 */
export const generateBotResponse = async (
  prompt: string, 
  model: AIModel = AIModel.GEMINI_3_PRO, 
  history: { role: 'user' | 'model', parts: { text: string }[] }[] = [],
  systemInstruction?: string
): Promise<string> => {
  const apiKey = process.env.API_KEY;
  if (!apiKey) {
    throw new Error("NEURAL_LINK_FAILED: API_KEY_MISSING");
  }

  try {
    const ai = new GoogleGenAI({ apiKey });
    const sanitizedPrompt = prompt.trim();

    // Professional AI writing style instructions - Markdown Bolding Strictly Forbidden
    const professionalStyle = `
      You are SwiftDeploy AI, a high-level technical operative. 
      Format your responses for maximum readability and a clean enterprise aesthetic:
      - DO NOT use double asterisks (**) for bolding. Use plain text only.
      - If you need to emphasize a term, use Capital Letters or simply place it at the start of a point.
      - Use simple bullet points (-) for technical breakdowns.
      - Keep paragraphs very short (1-2 sentences).
      - Style: Direct, technical, and minimalist.
      - Ensure there is double spacing between distinct points.
    `;

    const response: GenerateContentResponse = await ai.models.generateContent({
      model: 'gemini-3-pro-preview',
      contents: [
        ...history,
        { role: 'user', parts: [{ text: sanitizedPrompt }] }
      ],
      config: {
        systemInstruction: systemInstruction || professionalStyle,
        temperature: 0.3, // Lower temperature for more consistent formatting
        maxOutputTokens: 4000,
        thinkingConfig: { thinkingBudget: 2000 }
      }
    });

    return response.text || "No signal response detected.";
  } catch (error) {
    console.error("Dashboard AI Core Error:", error);
    throw new Error("AI_GENERATION_FAILED");
  }
};

export const estimateTokens = (text: string): number => {
  return Math.ceil(text.length / 4);
};
