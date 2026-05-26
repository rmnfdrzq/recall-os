mod db;
mod parser;

use std::sync::Arc;
use tokio::sync::Mutex;
use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  // Create shared, thread-safe placeholder for LanceDB connection
  let db_conn = Arc::new(Mutex::new(None));

  tauri::Builder::default()
    .manage(db::DbState { conn: db_conn.clone() })
    .setup(|app| {
      if cfg!(debug_assertions) {
        app.handle().plugin(
          tauri_plugin_log::Builder::default()
            .level(log::LevelFilter::Info)
            .build(),
        )?;
      }

      // Initialize LanceDB asynchronously on start
      let handle = app.handle().clone();
      tauri::async_runtime::spawn(async move {
        match db::init_db(&handle).await {
          Ok(conn) => {
            let state = handle.state::<db::DbState>();
            *state.conn.lock().await = Some(conn);
            log::info!("Local LanceDB connection established successfully.");
          }
          Err(e) => {
            log::error!("Local LanceDB initialization failed: {}", e);
          }
        }
      });

      Ok(())
    })
    .invoke_handler(tauri::generate_handler![
      db::upsert_local_document,
      db::list_local_documents,
      db::get_local_document,
      db::delete_local_document,
      db::insert_document_chunks,
      db::search_local_vectors,
      db::delete_document_chunks,
      parser::parse_file,
      parser::read_file_bytes,
      parser::select_local_file
    ])
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}
