
import { GoogleGenAI } from "@google/genai";

export const recognizeHandwriting = async (base64Image: string): Promise<string> => {
  const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
  
  try {
    const response = await ai.models.generateContent({
      model: 'gemini-3-flash-preview',
      contents: {
        parts: [
          {
            text: "Extract all handwritten text from this image. Only return the text itself. Support both English and Thai. If no text is found, return an empty string."
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
        temperature: 0.1,
      }
    });

    return response.text || "";
  } catch (error) {
    console.error("OCR Error:", error);
    return "Error recognizing text";
  }
};
