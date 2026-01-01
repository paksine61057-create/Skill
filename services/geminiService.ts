
import { GoogleGenAI } from "@google/genai";

export const recognizeHandwriting = async (base64Image: string): Promise<string> => {
  const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
  
  try {
    const response = await ai.models.generateContent({
      model: 'gemini-3-flash-preview',
      contents: {
        parts: [
          {
            text: "OCR Task: Extract the text from this handwritten segment. It might be a single character, a syllable, or a short word in Thai or English. Return ONLY the text content. No symbols, no quotes, no extra words. If you see 'ก', just return 'ก'. If it's a mark, return an empty string."
          },
          {
            inlineData: {
              mimeType: 'image/png',
              data: base64Image.split(',')[1],
            },
          },
        ],
      },
      config: {
        temperature: 0.0, // Set to 0 for deterministic results in Scribble mode
      }
    });

    return response.text?.trim() || "";
  } catch (error) {
    console.error("OCR Error:", error);
    return "";
  }
};
