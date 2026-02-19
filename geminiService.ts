
import { GoogleGenAI, GenerateContentResponse } from "@google/genai";
import { AIModel } from "./types";

/**
 * Neural Interface Service
 * Compliant with @google/genai version 1.41.0
 */
export const generateBotResponse = async (
  prompt: string, 
  model: AIModel = AIModel.GEMINI_3_FLASH, 
  history: { role: 'user' | 'model', parts: { text: string }[] }[] = [],
  systemInstruction?: string
): Promise<string> => {
  const viteEnv = typeof import.meta !== 'undefined' ? (import.meta as any).env : undefined;
  const apiKey =
    viteEnv?.VITE_GEMINI_API_KEY ||
    viteEnv?.VITE_API_KEY ||
    (typeof process !== 'undefined' ? (process as any).env?.API_KEY : undefined);
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

    // Use Gemini Flash model for better performance
    const modelName = model === AIModel.GEMINI_3_FLASH ? 'gemini-3-flash-preview' : 'gemini-3-pro-preview';
    
    const response: GenerateContentResponse = await ai.models.generateContent({
      model: modelName,
      contents: [
        ...history,
        { role: 'user', parts: [{ text: sanitizedPrompt }] }
      ],
      config: {
        systemInstruction: systemInstruction || professionalStyle,
        temperature: 0.7, // Slightly higher for more creative responses
        maxOutputTokens: 2000, // Reduced for faster responses
        thinkingConfig: { thinkingBudget: 1000 }
      }
    });

    return response.text || "No signal response detected.";
  } catch (error) {
    console.error("AI Core Error:", error);
    
    // Enhanced error handling with specific error types
    if (error instanceof Error) {
      if (error.message.includes('API_KEY')) {
        throw new Error("INVALID_API_KEY: Please check your Gemini API configuration");
      } else if (error.message.includes('quota') || error.message.includes('rate')) {
        throw new Error("RATE_LIMIT_EXCEEDED: Please try again in a few moments");
      } else if (error.message.includes('network') || error.message.includes('fetch')) {
        throw new Error("NETWORK_ERROR: Unable to connect to AI service");
      }
    }
    
    throw new Error(`AI_GENERATION_FAILED: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
};

export const estimateTokens = (text: string): number => {
  return Math.ceil(text.length / 4);
};
