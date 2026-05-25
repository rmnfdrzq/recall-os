import { BACKEND_HOST } from "./appConfig";
import { isDesktop, toAssetUrl } from "./desktop";
export { getFullDocumentContent, normalizeLocalDocument } from "../utils/documentView";

export const getFileUrl = (filePath) => {
  if (!filePath) return "";
  if (filePath.startsWith("http://") || filePath.startsWith("https://")) return filePath;
  if (isDesktop() && (filePath.startsWith("/") || /^[A-Za-z]:[\\/]/.test(filePath))) {
    return toAssetUrl(filePath);
  }
  return `${BACKEND_HOST}${filePath}`;
};

export const getPdfPreviewUrl = (filePath) => getFileUrl(filePath);
