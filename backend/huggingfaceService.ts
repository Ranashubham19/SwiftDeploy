import { HfInference } from '@huggingface/inference';

class HuggingFaceService {
  private hf: HfInference;
  private model: string;

  constructor() {
    const apiKey = process.env.HUGGINGFACE_API_KEY || '';
    if (!apiKey) {
      throw new Error('HUGGINGFACE_API_KEY is not set in environment variables');
    }
    
    this.hf = new HfInference(apiKey);
    // Using a model that works with free tier
    this.model = 'microsoft/DialoGPT-medium';
  }

  async generateResponse(prompt: string, context: string = ''): Promise<string> {
    try {
      // Simple prompt for chat model
      const fullPrompt = context 
        ? `${context}\n${prompt}`
        : prompt;

      const response = await this.hf.textGeneration({
        model: this.model,
        inputs: fullPrompt,
        parameters: {
          max_new_tokens: 100,
          temperature: 0.7,
          top_p: 0.9
        }
      });

      let answer = response.generated_text;
      
      // Remove the prompt from the response if it's included
      if (answer.startsWith(fullPrompt)) {
        answer = answer.slice(fullPrompt.length).trim();
      }
      
      return answer || "I'm sorry, I couldn't generate a response.";
    } catch (error) {
      console.error('Hugging Face API Error:', error);
      // Return a simple fallback response
      return "Hello! I'm your AI assistant. I'm currently learning to respond better. Ask me anything!";
    }
  }

  async chat(messages: Array<{role: string, content: string}>): Promise<string> {
    try {
      // Convert messages to prompt format
      let prompt = '';
      for (const message of messages) {
        prompt += `${message.role}: ${message.content}\n`;
      }
      prompt += 'assistant:';

      const response = await this.hf.textGeneration({
        model: this.model,
        inputs: prompt,
        parameters: {
          max_new_tokens: 100,
          temperature: 0.7,
          top_p: 0.9
        }
      });

      let answer = response.generated_text;
      
      // Extract just the assistant's response
      const lastAssistantIndex = answer.toLowerCase().lastIndexOf('assistant:');
      if (lastAssistantIndex !== -1) {
        answer = answer.slice(lastAssistantIndex + 10).trim();
      }
      
      return answer || "I'm sorry, I couldn't generate a response.";
    } catch (error) {
      console.error('Hugging Face Chat Error:', error);
      return "Hello! I'm your AI assistant. I'm currently learning to respond better. Ask me anything!";
    }
  }
}

// Export singleton instance
export const huggingFaceService = new HuggingFaceService();
