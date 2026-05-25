import { convertFileSrc } from "@tauri-apps/api/core";

export const isDesktop = () =>
  typeof window !== "undefined" && window.__TAURI_INTERNALS__ !== undefined;

export const toAssetUrl = (filePath) => convertFileSrc(filePath, "asset");
