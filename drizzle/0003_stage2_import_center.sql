CREATE TABLE import_batches (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  batch_id TEXT NOT NULL UNIQUE,
  payroll_period_id INTEGER NOT NULL REFERENCES payroll_periods(id),
  project_id INTEGER NOT NULL REFERENCES projects(id),
  source_type TEXT NOT NULL,
  delimiter TEXT NOT NULL DEFAULT 'auto',
  mapping_json TEXT,
  business_keys_json TEXT,
  status TEXT NOT NULL DEFAULT 'uploading',
  total_files INTEGER NOT NULL DEFAULT 0,
  processed_files INTEGER NOT NULL DEFAULT 0,
  total_rows INTEGER NOT NULL DEFAULT 0,
  valid_rows INTEGER NOT NULL DEFAULT 0,
  rejected_rows INTEGER NOT NULL DEFAULT 0,
  duplicate_rows INTEGER NOT NULL DEFAULT 0,
  error_summary TEXT,
  uploaded_by INTEGER NOT NULL REFERENCES users(id),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  committed_at INTEGER
);
--> statement-breakpoint
CREATE TABLE source_files (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source_file_id TEXT NOT NULL UNIQUE,
  import_batch_id INTEGER NOT NULL REFERENCES import_batches(id) ON DELETE CASCADE,
  payroll_period_id INTEGER NOT NULL REFERENCES payroll_periods(id),
  project_id INTEGER NOT NULL REFERENCES projects(id),
  source_type TEXT NOT NULL,
  original_filename TEXT NOT NULL,
  file_hash TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  size_bytes INTEGER NOT NULL,
  expected_chunks INTEGER NOT NULL,
  uploaded_chunks INTEGER NOT NULL DEFAULT 0,
  blob_key TEXT,
  status TEXT NOT NULL DEFAULT 'uploading',
  total_rows INTEGER NOT NULL DEFAULT 0,
  imported_rows INTEGER NOT NULL DEFAULT 0,
  rejected_rows INTEGER NOT NULL DEFAULT 0,
  duplicate_rows INTEGER NOT NULL DEFAULT 0,
  error_summary TEXT,
  replacement_of_file_id INTEGER,
  uploaded_by INTEGER NOT NULL REFERENCES users(id),
  uploaded_at INTEGER NOT NULL,
  processed_at INTEGER,
  reversed_at INTEGER
);
--> statement-breakpoint
CREATE INDEX source_files_scope_hash ON source_files(payroll_period_id, project_id, source_type, file_hash);
--> statement-breakpoint
CREATE INDEX source_files_batch ON source_files(import_batch_id);
--> statement-breakpoint
CREATE TABLE import_upload_chunks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source_file_id INTEGER NOT NULL REFERENCES source_files(id) ON DELETE CASCADE,
  chunk_index INTEGER NOT NULL,
  blob_key TEXT NOT NULL,
  size_bytes INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  UNIQUE(source_file_id, chunk_index)
);
--> statement-breakpoint
CREATE TABLE column_mapping_templates (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  source_type TEXT NOT NULL,
  project_id INTEGER REFERENCES projects(id) ON DELETE CASCADE,
  mapping_json TEXT NOT NULL,
  business_keys_json TEXT NOT NULL,
  delimiter TEXT NOT NULL DEFAULT 'auto',
  created_by INTEGER NOT NULL REFERENCES users(id),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE(source_type, project_id, name)
);
--> statement-breakpoint
CREATE TABLE import_rows (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  import_batch_id INTEGER NOT NULL REFERENCES import_batches(id) ON DELETE CASCADE,
  source_file_id INTEGER NOT NULL REFERENCES source_files(id) ON DELETE CASCADE,
  source_row_number INTEGER NOT NULL,
  raw_payload TEXT NOT NULL,
  normalized_payload TEXT,
  business_key TEXT,
  validation_status TEXT NOT NULL DEFAULT 'pending',
  validation_errors TEXT,
  created_at INTEGER NOT NULL,
  UNIQUE(source_file_id, source_row_number)
);
--> statement-breakpoint
CREATE INDEX import_rows_batch_status ON import_rows(import_batch_id, validation_status);
--> statement-breakpoint
CREATE TABLE normalized_import_rows (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  import_batch_id INTEGER NOT NULL REFERENCES import_batches(id),
  source_file_id INTEGER NOT NULL REFERENCES source_files(id),
  payroll_period_id INTEGER NOT NULL REFERENCES payroll_periods(id),
  project_id INTEGER NOT NULL REFERENCES projects(id),
  source_type TEXT NOT NULL,
  source_row_number INTEGER NOT NULL,
  employee_id TEXT,
  employee_name TEXT,
  entry_employee_id TEXT,
  proof_employee_id TEXT,
  batch_id TEXT,
  client_batch_id TEXT,
  production_date TEXT,
  country TEXT,
  work_type TEXT,
  key_type TEXT,
  record_count TEXT,
  character_count TEXT,
  image_count TEXT,
  transmitted_status TEXT,
  original_payload TEXT NOT NULL,
  normalized_payload TEXT NOT NULL,
  business_key TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL,
  reversed_at INTEGER,
  UNIQUE(source_file_id, source_row_number)
);
--> statement-breakpoint
CREATE INDEX normalized_scope_key ON normalized_import_rows(payroll_period_id, project_id, source_type, business_key);
--> statement-breakpoint
CREATE INDEX normalized_employee ON normalized_import_rows(employee_id);
--> statement-breakpoint
CREATE INDEX normalized_batch ON normalized_import_rows(batch_id);