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
use serde_json::Value;
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

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct LocalDocument {
    pub id: String,
    pub filename: String,
    pub file_type: String,
    pub status: String,
    pub summary: String,
    pub suggested_title: String,
    pub category: String,
    pub tags: Vec<String>,
    pub file_path: String,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct LocalDocumentChunk {
    pub id: String,
    pub document_id: String,
    pub content: String,
    pub chunk_index: i32,
    pub metadata: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct LocalDocumentDetail {
    #[serde(flatten)]
    pub document: LocalDocument,
    pub chunks: Vec<LocalDocumentChunk>,
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

fn get_documents_schema() -> Arc<Schema> {
    Arc::new(Schema::new(vec![
        Field::new("id", DataType::Utf8, false),
        Field::new("filename", DataType::Utf8, false),
        Field::new("file_type", DataType::Utf8, false),
        Field::new("status", DataType::Utf8, false),
        Field::new("summary", DataType::Utf8, true),
        Field::new("suggested_title", DataType::Utf8, true),
        Field::new("category", DataType::Utf8, true),
        Field::new("tags", DataType::Utf8, true),
        Field::new("file_path", DataType::Utf8, true),
        Field::new("created_at", DataType::Utf8, false),
        Field::new("updated_at", DataType::Utf8, false),
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
    ensure_documents_table_exists(&conn).await?;
    
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

async fn ensure_documents_table_exists(conn: &Connection) -> Result<Table, String> {
    let table_name = "documents";
    match conn.open_table(table_name).execute().await {
        Ok(table) => Ok(table),
        Err(_) => {
            let schema = get_documents_schema();
            conn.create_empty_table(table_name, schema)
                .execute()
                .await
                .map_err(|e| format!("Failed to create documents table: {}", e))
        }
    }
}

async fn collect_table_batches(table: &Table) -> Result<Vec<RecordBatch>, String> {
    let mut stream = table.query()
        .execute()
        .await
        .map_err(|e| format!("Failed to query table: {}", e))?;

    let mut batches = Vec::new();
    while let Some(batch_result) = stream.next().await {
        batches.push(batch_result.map_err(|e: lancedb::Error| format!("Failed to fetch table batch: {}", e))?);
    }
    Ok(batches)
}

fn chunk_index_from_metadata(metadata: &str) -> i32 {
    serde_json::from_str::<Value>(metadata)
        .ok()
        .and_then(|value| value.get("chunk_index").and_then(|idx| idx.as_i64()))
        .unwrap_or(0) as i32
}

fn document_from_batch(batch: &RecordBatch, row: usize) -> Result<LocalDocument, String> {
    let ids = batch.column(0).as_any().downcast_ref::<StringArray>().ok_or_else(|| "Failed to downcast document id column".to_string())?;
    let filenames = batch.column(1).as_any().downcast_ref::<StringArray>().ok_or_else(|| "Failed to downcast filename column".to_string())?;
    let file_types = batch.column(2).as_any().downcast_ref::<StringArray>().ok_or_else(|| "Failed to downcast file_type column".to_string())?;
    let statuses = batch.column(3).as_any().downcast_ref::<StringArray>().ok_or_else(|| "Failed to downcast status column".to_string())?;
    let summaries = batch.column(4).as_any().downcast_ref::<StringArray>().ok_or_else(|| "Failed to downcast summary column".to_string())?;
    let titles = batch.column(5).as_any().downcast_ref::<StringArray>().ok_or_else(|| "Failed to downcast suggested_title column".to_string())?;
    let categories = batch.column(6).as_any().downcast_ref::<StringArray>().ok_or_else(|| "Failed to downcast category column".to_string())?;
    let tags = batch.column(7).as_any().downcast_ref::<StringArray>().ok_or_else(|| "Failed to downcast tags column".to_string())?;
    let file_paths = batch.column(8).as_any().downcast_ref::<StringArray>().ok_or_else(|| "Failed to downcast file_path column".to_string())?;
    let created = batch.column(9).as_any().downcast_ref::<StringArray>().ok_or_else(|| "Failed to downcast created_at column".to_string())?;
    let updated = batch.column(10).as_any().downcast_ref::<StringArray>().ok_or_else(|| "Failed to downcast updated_at column".to_string())?;

    Ok(LocalDocument {
        id: ids.value(row).to_string(),
        filename: filenames.value(row).to_string(),
        file_type: file_types.value(row).to_string(),
        status: statuses.value(row).to_string(),
        summary: summaries.value(row).to_string(),
        suggested_title: titles.value(row).to_string(),
        category: categories.value(row).to_string(),
        tags: serde_json::from_str::<Vec<String>>(tags.value(row)).unwrap_or_else(|_| Vec::new()),
        file_path: file_paths.value(row).to_string(),
        created_at: created.value(row).to_string(),
        updated_at: updated.value(row).to_string(),
    })
}

#[tauri::command]
pub async fn upsert_local_document(
    document: LocalDocument,
    state: tauri::State<'_, DbState>
) -> Result<(), String> {
    let mutex = state.conn.lock().await;
    let conn = mutex.as_ref().ok_or_else(|| "Database connection is uninitialized".to_string())?;
    let table = ensure_documents_table_exists(conn).await?;

    table.delete(&format!("id = '{}'", document.id))
        .await
        .map_err(|e| format!("Failed to replace existing local document: {}", e))?;

    let schema = get_documents_schema();
    let tags_json = serde_json::to_string(&document.tags)
        .map_err(|e| format!("Failed to encode document tags: {}", e))?;

    let batch = RecordBatch::try_new(
        schema.clone(),
        vec![
            Arc::new(StringArray::from(vec![document.id])),
            Arc::new(StringArray::from(vec![document.filename])),
            Arc::new(StringArray::from(vec![document.file_type])),
            Arc::new(StringArray::from(vec![document.status])),
            Arc::new(StringArray::from(vec![document.summary])),
            Arc::new(StringArray::from(vec![document.suggested_title])),
            Arc::new(StringArray::from(vec![document.category])),
            Arc::new(StringArray::from(vec![tags_json])),
            Arc::new(StringArray::from(vec![document.file_path])),
            Arc::new(StringArray::from(vec![document.created_at])),
            Arc::new(StringArray::from(vec![document.updated_at])),
        ]
    ).map_err(|e| format!("Failed to construct local document batch: {}", e))?;

    let reader = RecordBatchIterator::new(vec![Ok(batch)], schema.clone());
    table.add(reader)
        .execute()
        .await
        .map_err(|e| format!("Failed to save local document: {}", e))?;

    Ok(())
}

#[tauri::command]
pub async fn list_local_documents(
    state: tauri::State<'_, DbState>
) -> Result<Vec<LocalDocument>, String> {
    let mutex = state.conn.lock().await;
    let conn = mutex.as_ref().ok_or_else(|| "Database connection is uninitialized".to_string())?;
    let table = ensure_documents_table_exists(conn).await?;
    let batches = collect_table_batches(&table).await?;

    let mut documents = Vec::new();
    for batch in batches {
        for row in 0..batch.num_rows() {
            documents.push(document_from_batch(&batch, row)?);
        }
    }

    documents.sort_by(|a, b| b.created_at.cmp(&a.created_at));
    Ok(documents)
}

#[tauri::command]
pub async fn get_local_document(
    document_id: String,
    state: tauri::State<'_, DbState>
) -> Result<LocalDocumentDetail, String> {
    let mutex = state.conn.lock().await;
    let conn = mutex.as_ref().ok_or_else(|| "Database connection is uninitialized".to_string())?;

    let documents_table = ensure_documents_table_exists(conn).await?;
    let mut document = None;
    for batch in collect_table_batches(&documents_table).await? {
        for row in 0..batch.num_rows() {
            let candidate = document_from_batch(&batch, row)?;
            if candidate.id == document_id {
                document = Some(candidate);
                break;
            }
        }
        if document.is_some() {
            break;
        }
    }
    let document = document.ok_or_else(|| format!("Local document not found: {}", document_id))?;

    let chunks_table = ensure_table_exists(conn).await?;
    let batches = collect_table_batches(&chunks_table).await?;
    let mut chunks = Vec::new();
    for batch in batches {
        let ids = batch.column(0).as_any().downcast_ref::<StringArray>().ok_or_else(|| "Failed to downcast chunk id column".to_string())?;
        let doc_ids = batch.column(1).as_any().downcast_ref::<StringArray>().ok_or_else(|| "Failed to downcast chunk document_id column".to_string())?;
        let texts = batch.column(2).as_any().downcast_ref::<StringArray>().ok_or_else(|| "Failed to downcast chunk text column".to_string())?;
        let metadata = batch.column(4).as_any().downcast_ref::<StringArray>().ok_or_else(|| "Failed to downcast chunk metadata column".to_string())?;

        for row in 0..batch.num_rows() {
            if doc_ids.value(row) == document_id {
                let meta = metadata.value(row).to_string();
                chunks.push(LocalDocumentChunk {
                    id: ids.value(row).to_string(),
                    document_id: doc_ids.value(row).to_string(),
                    content: texts.value(row).to_string(),
                    chunk_index: chunk_index_from_metadata(&meta),
                    metadata: meta,
                });
            }
        }
    }

    chunks.sort_by(|a, b| a.chunk_index.cmp(&b.chunk_index));
    Ok(LocalDocumentDetail { document, chunks })
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

#[tauri::command]
pub async fn delete_local_document(
    document_id: String,
    state: tauri::State<'_, DbState>
) -> Result<(), String> {
    let mutex = state.conn.lock().await;
    let conn = mutex.as_ref().ok_or_else(|| "Database connection is uninitialized".to_string())?;

    // Attempt to delete chunk vectors, ignore errors if the table/dataset does not exist physically yet
    if let Ok(chunks_table) = ensure_table_exists(conn).await {
        let _ = chunks_table.delete(&format!("document_id = '{}'", document_id)).await;
    }

    let documents_table = ensure_documents_table_exists(conn).await?;
    documents_table.delete(&format!("id = '{}'", document_id))
        .await
        .map_err(|e| format!("Failed to delete local document metadata: {}", e))?;

    Ok(())
}
