import { SERVER_CATEGORY_ENDPOINT } from "./appConfig";

const chunkContent = (chunk) => (
  typeof chunk === "string" ? chunk : chunk?.content || chunk?.text || ""
);

export const generateAiDocumentCategory = async ({ filename, summary, chunks = [], modelProfile = "text" }) => {
  const normalizedChunks = chunks
    .map(chunkContent)
    .map((content) => content.trim())
    .filter(Boolean)
    .slice(0, 24)
    .map((content) => ({ content: content.slice(0, 2000) }));

  if (!summary?.trim() && normalizedChunks.length === 0) {
    return "General";
  }

  const response = await fetch(SERVER_CATEGORY_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      filename,
      summary: summary || "",
      chunks: normalizedChunks,
      model_profile: modelProfile,
    }),
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
      throw new Error("AI category API endpoint was not found. Restart the backend server with the latest code and try again.");
    }
    throw new Error(data.error || `AI category generation failed (${response.status})`);
  }

  return data.category?.trim() || "General";
};
