export const IMAGE_EXTENSIONS = new Set(["png", "jpg", "jpeg", "webp"]);

export const getFilename = (filePath) =>
  filePath.split("/").pop() || filePath.split("\\").pop() || "document";

export const getExtension = (filename) =>
  filename.split(".").pop()?.toLowerCase() || "";

export const inferFileType = (filename) => {
  const extension = getExtension(filename);
  if (IMAGE_EXTENSIONS.has(extension)) return "image";
  if (extension === "pdf") return "pdf";
  if (extension === "md" || extension === "markdown") return "markdown";
  return "text";
};

export const getStatusBadgeStyles = (status) => {
  switch (status) {
    case "processed":
      return { bg: "rgba(16,185,129,0.1)", color: "#34d399", label: "processed" };
    case "indexed_text":
      return { bg: "rgba(96,165,250,0.1)", color: "#60a5fa", label: "text indexed" };
    case "indexing_vectors":
      return { bg: "rgba(245,158,11,0.1)", color: "#fbbf24", label: "indexing vectors" };
    case "summarizing":
      return { bg: "rgba(245,158,11,0.1)", color: "#fbbf24", label: "generating summary" };
    case "processing":
      return { bg: "rgba(245,158,11,0.1)", color: "#fbbf24", label: "processing" };
    default:
      return { bg: "rgba(239,68,68,0.1)", color: "#f87171", label: status || "failed" };
  }
};
