import { SERVER_SUMMARY_ENDPOINT } from "./appConfig";
import { SUMMARY_GENERATING_TEXT } from "./summaryConstants";

export { SUMMARY_GENERATING_TEXT };

export const generateAiDocumentSummary = async ({ filename, text, modelProfile = "text" }) => {
  const documentText = (text || "").trim();
  if (!documentText) {
    throw new Error("Document text is required to generate AI summary.");
  }

  const response = await fetch(SERVER_SUMMARY_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ filename, text: documentText, model_profile: modelProfile }),
  });

  const responseText = await response.text();
  let data = {};
  if (responseText) {
    try {
      data = JSON.parse(responseText);
    } catch {
      data = {};
    }
  }

  if (!response.ok) {
    if (response.status === 404) {
      throw new Error("AI summary API endpoint was not found. Restart the backend server with the latest code and try again.");
    }
    throw new Error(data.error || `AI summary generation failed (${response.status})`);
  }
  if (!data.summary || !data.summary.trim()) {
    throw new Error("AI summary generation returned an empty summary.");
  }
  return data.summary.trim();
};
