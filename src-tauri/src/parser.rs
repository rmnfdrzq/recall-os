use std::path::PathBuf;
use serde::{Serialize, Deserialize};

#[derive(Debug, Serialize, Deserialize)]
pub struct LocalFileBytes {
    pub filename: String,
    pub bytes: Vec<u8>,
}

/// Tauri command to read and parse a local document from its absolute file path
#[tauri::command]
pub async fn parse_file(path: String) -> Result<String, String> {
    let path_buf = PathBuf::from(&path);
    if !path_buf.exists() {
        return Err(format!("File does not exist: {}", path));
    }

    let extension = path_buf.extension()
        .and_then(|ext| ext.to_str())
        .map(|ext| ext.to_lowercase());

    match extension.as_deref() {
        // Plain text-based files
        Some("txt") | Some("md") | Some("py") | Some("js") | Some("ts") | Some("jsx") | 
        Some("tsx") | Some("json") | Some("csv") | Some("html") | Some("css") | Some("rs") | 
        Some("go") | Some("yaml") | Some("yml") | Some("ini") | Some("conf") => {
            std::fs::read_to_string(&path_buf)
                .map_err(|e| format!("Failed to read text file: {}", e))
        }
        // PDF documents
        Some("pdf") => {
            let doc = lopdf::Document::load(&path_buf)
                .map_err(|e| format!("Failed to parse PDF document: {}", e))?;
            
            let mut extracted_text = String::new();
            let pages = doc.get_pages();
            
            // Loop through pages and extract plain text streams
            for (page_num, _) in pages.iter() {
                if let Ok(text) = doc.extract_text(&[*page_num]) {
                    extracted_text.push_str(&format!("\n\n[Page {}]\n\n", page_num));
                    extracted_text.push_str(&text);
                    extracted_text.push('\n');
                }
            }
            
            let cleaned = extracted_text.trim().to_string();
            if cleaned.is_empty() {
                Err("PDF text extraction returned empty contents. This document may contain only scanned images; OCR is required.".to_string())
            } else {
                Ok(cleaned)
            }
        }
        // Unsupported or other types
        _ => {
            Err("Unsupported file format. Please upload text files (.txt, .md), code files, or standard PDFs.".to_string())
        }
    }
}

/// Tauri command to trigger a native OS file dialog and return the selected absolute path
#[tauri::command]
pub async fn select_local_file() -> Result<Option<String>, String> {
    let file = rfd::AsyncFileDialog::new()
        .add_filter("Documents", &["txt", "md", "pdf", "py", "js", "ts", "json", "rs", "go", "csv", "html", "css", "png", "jpg", "jpeg", "webp"])
        .pick_file()
        .await;
    
    Ok(file.map(|f| f.path().to_string_lossy().to_string()))
}

#[tauri::command]
pub async fn read_file_bytes(path: String) -> Result<LocalFileBytes, String> {
    let path_buf = PathBuf::from(&path);
    if !path_buf.exists() {
        return Err(format!("File does not exist: {}", path));
    }

    let filename = path_buf.file_name()
        .and_then(|name| name.to_str())
        .unwrap_or("document")
        .to_string();
    let bytes = std::fs::read(&path_buf)
        .map_err(|e| format!("Failed to read local file bytes: {}", e))?;

    Ok(LocalFileBytes { filename, bytes })
}
