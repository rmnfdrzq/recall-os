use std::sync::Arc;
use tauri::AppHandle;
use tauri::Manager;
use tokio::sync::Mutex;
use lancedb::{connect, Connection, Table};
// Standard direct imports from version-matched arrow dependencies
use arrow_schema::{DataType, Field, Schema, FieldRef};
use arrow_array::{RecordBatch, StringArray, Float32Array, FixedSizeListArray, Array};
use arrow_array::RecordBatchIterator;
use lancedb::query::{QueryBase, ExecutableQuery}; // Provides query methods
use futures::StreamExt;
use serde::{Serialize, Deserialize};
use uuid::Uuid;

// Dimension of BGE-M3 model embeddings
pub const VECTOR_DIMENSION: i32 = 1024;

pub struct DbState {
    pub conn: Arc<Mutex<Option<Connection>>>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct DbChunk {
    pub id: String,
    pub document_id: String,
    pub text: String,
    pub vector: Vec<f32>,
    pub metadata: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct SearchResult {
    pub id: String,
    pub document_id: String,
    pub text: String,
    pub metadata: String,
    pub score: f32,
}

/// Returns the Arrow schema for the document chunks table
fn get_schema() -> Arc<Schema> {
    Arc::new(Schema::new(vec![
        Field::new("id", DataType::Utf8, false),
        Field::new("document_id", DataType::Utf8, false),
        Field::new("text", DataType::Utf8, false),
        Field::new("vector", DataType::FixedSizeList(
            Arc::new(Field::new("item", DataType::Float32, true)),
            VECTOR_DIMENSION
        ), false),
        Field::new("metadata", DataType::Utf8, true),
    ]))
}

/// Initializes the local database directory and establishes a LanceDB connection
pub async fn init_db(app: &AppHandle) -> Result<Connection, String> {
    // Tauri 2.0 app path resolution via Manager trait method .path()
    let app_dir = app.path()
        .app_data_dir()
        .map_err(|e| format!("Failed to resolve app data directory: {}", e))?;
    
    // Create database folder if it doesn't exist
    std::fs::create_dir_all(&app_dir)
        .map_err(|e| format!("Failed to create database directory: {}", e))?;
    
    let db_path = app_dir.join("recallos_lancedb");
    let db_path_str = db_path.to_str()
        .ok_or_else(|| "Invalid database path".to_string())?;

    // Connect to LanceDB (creates directory if missing)
    let conn = connect(db_path_str)
        .execute()
        .await
        .map_err(|e| format!("LanceDB connection failed: {}", e))?;
    
    // Auto-create table if missing
    ensure_table_exists(&conn).await?;
    
    Ok(conn)
}

/// Verifies if the chunks table exists; creates it with schema if missing
async fn ensure_table_exists(conn: &Connection) -> Result<Table, String> {
    let table_name = "document_chunks";
    match conn.open_table(table_name).execute().await {
        Ok(table) => Ok(table),
        Err(_) => {
            let schema = get_schema();
            conn.create_empty_table(table_name, schema)
                .execute()
                .await
                .map_err(|e| format!("Failed to create document_chunks table: {}", e))
        }
    }
}

/// Command to store text chunks and BGE-M3 vectors in the local LanceDB database
#[tauri::command]
pub async fn insert_document_chunks(
    document_id: String,
    chunks: Vec<DbChunk>,
    state: tauri::State<'_, DbState>
) -> Result<(), String> {
    let mutex = state.conn.lock().await;
    let conn = mutex.as_ref().ok_or_else(|| "Database connection is uninitialized".to_string())?;
    
    let table = ensure_table_exists(conn).await?;

    let count = chunks.len();
    if count == 0 {
        return Ok(());
    }

    // Build Arrow arrays from chunks data
    let mut ids = Vec::with_capacity(count);
    let mut doc_ids = Vec::with_capacity(count);
    let mut texts = Vec::with_capacity(count);
    let mut metadata_list = Vec::with_capacity(count);
    let mut flat_vectors = Vec::with_capacity(count * VECTOR_DIMENSION as usize);

    for chunk in chunks {
        ids.push(if chunk.id.is_empty() { Uuid::new_v4().to_string() } else { chunk.id });
        doc_ids.push(document_id.clone());
        texts.push(chunk.text);
        metadata_list.push(chunk.metadata);
        
        let mut vec = chunk.vector;
        if vec.len() != VECTOR_DIMENSION as usize {
            // Pad or truncate to ensure strict 1024d compliance
            vec.resize(VECTOR_DIMENSION as usize, 0.0);
        }
        flat_vectors.extend(vec);
    }

    // Create Arrow Arrays
    let ids_array = StringArray::from(ids);
    let doc_ids_array = StringArray::from(doc_ids);
    let texts_array = StringArray::from(texts);
    let metadata_array = StringArray::from(metadata_list);

    let float_values = Float32Array::from(flat_vectors);
    
    // Explicitly define FixedSizeList field structure matching the schema
    let field: FieldRef = Arc::new(Field::new("item", DataType::Float32, true));
    let vectors_array = FixedSizeListArray::try_new(
        field,
        VECTOR_DIMENSION,
        Arc::new(float_values),
        None
    ).map_err(|e| format!("Failed to create Arrow FixedSizeListArray: {}", e))?;

    let schema = get_schema();
    let batch = RecordBatch::try_new(
        schema.clone(),
        vec![
            Arc::new(ids_array),
            Arc::new(doc_ids_array),
            Arc::new(texts_array),
            Arc::new(vectors_array),
            Arc::new(metadata_array),
        ]
    ).map_err(|e| format!("Failed to construct Arrow RecordBatch: {}", e))?;

    // Use RecordBatchIterator to implement RecordBatchReader cleanly
    let reader = RecordBatchIterator::new(
        vec![Ok(batch)],
        schema.clone()
    );

    table.add(reader)
        .execute()
        .await
        .map_err(|e| format!("Failed to insert chunks into LanceDB: {}", e))?;

    Ok(())
}

/// Command to perform a local vector similarity search against LanceDB
#[tauri::command]
pub async fn search_local_vectors(
    query_vector: Vec<f32>,
    limit: usize,
    state: tauri::State<'_, DbState>
) -> Result<Vec<SearchResult>, String> {
    let mutex = state.conn.lock().await;
    let conn = mutex.as_ref().ok_or_else(|| "Database connection is uninitialized".to_string())?;
    
    let table = ensure_table_exists(conn).await?;
    
    let mut padded_vector = query_vector;
    if padded_vector.len() != VECTOR_DIMENSION as usize {
        padded_vector.resize(VECTOR_DIMENSION as usize, 0.0);
    }

    // Run vector_search and collect the resulting stream asynchronously
    let mut stream = table.vector_search(padded_vector)
        .map_err(|e| format!("LanceDB query building failed: {}", e))?
        .limit(limit)
        .execute()
        .await
        .map_err(|e| format!("LanceDB vector search execution failed: {}", e))?;

    let mut results = Vec::new();

    while let Some(batch_result) = stream.next().await {
        let batch = batch_result.map_err(|e: lancedb::Error| format!("Failed to fetch search result batch: {}", e))?;
        
        let ids_col = batch.column(0).as_any().downcast_ref::<StringArray>()
            .ok_or_else(|| "Failed to downcast ids column".to_string())?;
        let doc_ids_col = batch.column(1).as_any().downcast_ref::<StringArray>()
            .ok_or_else(|| "Failed to downcast doc_ids column".to_string())?;
        let texts_col = batch.column(2).as_any().downcast_ref::<StringArray>()
            .ok_or_else(|| "Failed to downcast texts column".to_string())?;
        let metadata_col = batch.column(4).as_any().downcast_ref::<StringArray>()
            .ok_or_else(|| "Failed to downcast metadata column".to_string())?;
        
        // LanceDB appends an extra column "_distance" or similar in searches
        let distances = if batch.num_columns() > 5 {
            batch.column(5).as_any().downcast_ref::<Float32Array>()
        } else {
            None
        };

        for i in 0..batch.num_rows() {
            let score = distances.map(|d: &Float32Array| d.value(i)).unwrap_or(0.0);
            results.push(SearchResult {
                id: ids_col.value(i).to_string(),
                document_id: doc_ids_col.value(i).to_string(),
                text: texts_col.value(i).to_string(),
                metadata: metadata_col.value(i).to_string(),
                score,
            });
        }
    }

    Ok(results)
}

/// Command to remove all chunks belonging to a deleted document
#[tauri::command]
pub async fn delete_document_chunks(
    document_id: String,
    state: tauri::State<'_, DbState>
) -> Result<(), String> {
    let mutex = state.conn.lock().await;
    let conn = mutex.as_ref().ok_or_else(|| "Database connection is uninitialized".to_string())?;
    
    let table = ensure_table_exists(conn).await?;
    
    // Delete items by document ID
    table.delete(&format!("document_id = '{}'", document_id))
        .await
        .map_err(|e| format!("Failed to delete document chunks from LanceDB: {}", e))?;
        
    Ok(())
}
