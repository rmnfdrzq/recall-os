import { isDesktop } from "./desktop";

export const getBackendHost = () => {
  if (isDesktop()) return "http://127.0.0.1:8000";
  if (import.meta.env.DEV) return "http://127.0.0.1:8000";
  return "https://api.recallos.com";
};

export const BACKEND_HOST = getBackendHost();
export const API_BASE = `${BACKEND_HOST}/api`;
export const SERVER_PROCESS_ENDPOINT = `${API_BASE}/documents/process/`;
export const SERVER_SUMMARY_ENDPOINT = `${API_BASE}/documents/summary/`;
export const SERVER_CATEGORY_ENDPOINT = `${API_BASE}/documents/category/`;
