CREATE TABLE project_production_configurations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER NOT NULL UNIQUE REFERENCES projects(id) ON DELETE CASCADE,
  doctype_enabled INTEGER NOT NULL DEFAULT 0,
  proof_enabled INTEGER NOT NULL DEFAULT 0,
  allow_key_variant_double_count INTEGER NOT NULL DEFAULT 0,
  proof_types_json TEXT NOT NULL DEFAULT '[]',
  status_mappings_json TEXT NOT NULL DEFAULT '{}',
  updated_by INTEGER NOT NULL REFERENCES users(id),
  updated_at INTEGER NOT NULL
);
--> statement-breakpoint
CREATE TABLE production_exceptions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  payroll_period_id INTEGER NOT NULL REFERENCES payroll_periods(id),
  project_id INTEGER NOT NULL REFERENCES projects(id),
  source_file_id INTEGER REFERENCES source_files(id),
  import_batch_id INTEGER REFERENCES import_batches(id),
  stream TEXT NOT NULL,
  source_row_number INTEGER,
  severity TEXT NOT NULL,
  code TEXT NOT NULL,
  employee_identifier TEXT,
  batch_identifier TEXT,
  explanation TEXT NOT NULL,
  recommended_action TEXT NOT NULL,
  resolution_status TEXT NOT NULL DEFAULT 'open',
  created_at INTEGER NOT NULL,
  resolved_at INTEGER
);
--> statement-breakpoint
CREATE INDEX production_exceptions_scope ON production_exceptions(payroll_period_id, project_id, stream, resolution_status);
--> statement-breakpoint
CREATE TABLE record_details (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  import_row_id INTEGER NOT NULL UNIQUE REFERENCES import_rows(id),
  import_batch_id INTEGER NOT NULL REFERENCES import_batches(id),
  source_file_id INTEGER NOT NULL REFERENCES source_files(id),
  payroll_period_id INTEGER NOT NULL REFERENCES payroll_periods(id),
  project_id INTEGER NOT NULL REFERENCES projects(id),
  source_row_number INTEGER NOT NULL,
  source_variant TEXT NOT NULL,
  internal_batch_id TEXT,
  client_batch_id TEXT,
  employee_record_id INTEGER REFERENCES employees(id),
  employee_identifier TEXT,
  employee_name TEXT,
  production_date TEXT,
  country TEXT,
  entry_group TEXT,
  work_type TEXT,
  key_type TEXT,
  record_count TEXT,
  character_count TEXT,
  document_reference TEXT,
  review_key_identifier TEXT,
  full_key_identifier TEXT,
  business_key TEXT NOT NULL,
  payable_state TEXT NOT NULL DEFAULT 'eligible',
  original_source_payload TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL,
  reversed_at INTEGER
);
--> statement-breakpoint
CREATE INDEX record_details_scope ON record_details(payroll_period_id, project_id, active, production_date);
--> statement-breakpoint
CREATE INDEX record_details_employee ON record_details(employee_identifier);
--> statement-breakpoint
CREATE INDEX record_details_batch ON record_details(internal_batch_id, client_batch_id);
--> statement-breakpoint
CREATE INDEX record_details_key_type ON record_details(key_type, work_type);
--> statement-breakpoint
CREATE TABLE record_category_quantities (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  record_detail_id INTEGER NOT NULL REFERENCES record_details(id) ON DELETE CASCADE,
  category_code TEXT NOT NULL,
  category_name TEXT NOT NULL,
  quantity_unit TEXT NOT NULL,
  quantity TEXT NOT NULL,
  source_column TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  UNIQUE(record_detail_id, category_code, quantity_unit, source_column)
);
--> statement-breakpoint
CREATE INDEX record_categories_lookup ON record_category_quantities(category_code, quantity_unit);
--> statement-breakpoint
CREATE TABLE doctype_records (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  import_row_id INTEGER NOT NULL UNIQUE REFERENCES import_rows(id),
  import_batch_id INTEGER NOT NULL REFERENCES import_batches(id),
  source_file_id INTEGER NOT NULL REFERENCES source_files(id),
  payroll_period_id INTEGER NOT NULL REFERENCES payroll_periods(id),
  project_id INTEGER NOT NULL REFERENCES projects(id),
  source_row_number INTEGER NOT NULL,
  batch_id TEXT,
  employee_record_id INTEGER REFERENCES employees(id),
  employee_identifier TEXT,
  document_count TEXT,
  image_count TEXT,
  work_type TEXT,
  country TEXT,
  status TEXT,
  original_source_payload TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL,
  reversed_at INTEGER
);
--> statement-breakpoint
CREATE INDEX doctype_scope ON doctype_records(payroll_period_id, project_id, active);
--> statement-breakpoint
CREATE INDEX doctype_employee ON doctype_records(employee_identifier);
--> statement-breakpoint
CREATE TABLE proof_records (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  import_row_id INTEGER NOT NULL UNIQUE REFERENCES import_rows(id),
  import_batch_id INTEGER NOT NULL REFERENCES import_batches(id),
  source_file_id INTEGER NOT NULL REFERENCES source_files(id),
  payroll_period_id INTEGER NOT NULL REFERENCES payroll_periods(id),
  project_id INTEGER NOT NULL REFERENCES projects(id),
  source_row_number INTEGER NOT NULL,
  batch_id TEXT,
  entry_employee_record_id INTEGER REFERENCES employees(id),
  entry_employee_identifier TEXT,
  proof_employee_record_id INTEGER REFERENCES employees(id),
  proof_employee_identifier TEXT,
  proof_type TEXT,
  record_quantity TEXT,
  character_quantity TEXT,
  country TEXT,
  key_type TEXT,
  adjustment TEXT NOT NULL DEFAULT '0',
  original_source_payload TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL,
  reversed_at INTEGER
);
--> statement-breakpoint
CREATE INDEX proof_scope ON proof_records(payroll_period_id, project_id, active);
--> statement-breakpoint
CREATE INDEX proof_entry_employee ON proof_records(entry_employee_identifier);
--> statement-breakpoint
CREATE INDEX proof_performer ON proof_records(proof_employee_identifier);
--> statement-breakpoint
CREATE TABLE transmitted_batches (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  import_row_id INTEGER NOT NULL UNIQUE REFERENCES import_rows(id),
  import_batch_id INTEGER NOT NULL REFERENCES import_batches(id),
  source_file_id INTEGER NOT NULL REFERENCES source_files(id),
  payroll_period_id INTEGER NOT NULL REFERENCES payroll_periods(id),
  project_id INTEGER NOT NULL REFERENCES projects(id),
  source_row_number INTEGER NOT NULL,
  internal_batch_id TEXT,
  client_batch_id TEXT,
  batch_name TEXT,
  country TEXT,
  record_count TEXT,
  character_count TEXT,
  image_count TEXT,
  transmitted_date TEXT,
  transmission_status_raw TEXT,
  transmission_status TEXT NOT NULL DEFAULT 'unknown',
  client_acceptance_status_raw TEXT,
  client_acceptance_status TEXT NOT NULL DEFAULT 'unknown',
  work_type TEXT,
  produced_state TEXT NOT NULL DEFAULT 'unknown',
  shipped_state TEXT NOT NULL DEFAULT 'unknown',
  billable_state TEXT NOT NULL DEFAULT 'unknown',
  salary_approval_state TEXT NOT NULL DEFAULT 'unknown',
  original_source_payload TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL,
  reversed_at INTEGER
);
--> statement-breakpoint
CREATE INDEX transmitted_scope ON transmitted_batches(payroll_period_id, project_id, active);
--> statement-breakpoint
CREATE INDEX transmitted_batch_ids ON transmitted_batches(internal_batch_id, client_batch_id);
--> statement-breakpoint
CREATE TABLE shipdet_batches (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  import_row_id INTEGER NOT NULL UNIQUE REFERENCES import_rows(id),
  import_batch_id INTEGER NOT NULL REFERENCES import_batches(id),
  source_file_id INTEGER NOT NULL REFERENCES source_files(id),
  payroll_period_id INTEGER NOT NULL REFERENCES payroll_periods(id),
  project_id INTEGER NOT NULL REFERENCES projects(id),
  source_row_number INTEGER NOT NULL,
  client_project_name TEXT,
  internal_batch_id TEXT,
  client_batch_id TEXT,
  shipment_batch_id TEXT,
  shipment_date TEXT,
  record_count TEXT,
  character_count TEXT,
  image_count TEXT,
  billable_quantity TEXT,
  acceptance_status TEXT NOT NULL DEFAULT 'unknown',
  normalized_fields_json TEXT NOT NULL,
  original_source_payload TEXT NOT NULL,
  review_status TEXT NOT NULL DEFAULT 'pending',
  reviewed_by INTEGER REFERENCES users(id),
  reviewed_at INTEGER,
  active INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL,
  reversed_at INTEGER
);
--> statement-breakpoint
CREATE INDEX shipdet_scope ON shipdet_batches(payroll_period_id, project_id, active, review_status);
--> statement-breakpoint
CREATE INDEX shipdet_batch_ids ON shipdet_batches(internal_batch_id, client_batch_id, shipment_batch_id);
--> statement-breakpoint
CREATE TABLE shipdet_category_quantities (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  shipdet_batch_id INTEGER NOT NULL REFERENCES shipdet_batches(id) ON DELETE CASCADE,
  category_code TEXT NOT NULL,
  category_name TEXT NOT NULL,
  quantity TEXT NOT NULL,
  source_column TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  UNIQUE(shipdet_batch_id, category_code, source_column)
);
--> statement-breakpoint
CREATE INDEX shipdet_categories_lookup ON shipdet_category_quantities(category_code);
