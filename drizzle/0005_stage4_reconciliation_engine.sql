CREATE TABLE batch_mappings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  payroll_period_id INTEGER NOT NULL REFERENCES payroll_periods(id) ON DELETE CASCADE,
  project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  internal_batch_id TEXT,
  client_batch_id TEXT,
  shipment_batch_id TEXT,
  normalized_internal_batch_id TEXT,
  normalized_client_batch_id TEXT,
  normalized_shipment_batch_id TEXT,
  country TEXT,
  match_status TEXT NOT NULL DEFAULT 'review',
  match_method TEXT NOT NULL,
  approval_status TEXT NOT NULL DEFAULT 'pending',
  approved_by INTEGER REFERENCES users(id),
  approved_at INTEGER,
  created_by INTEGER NOT NULL REFERENCES users(id),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE(payroll_period_id, project_id, normalized_internal_batch_id, normalized_client_batch_id, normalized_shipment_batch_id)
);
--> statement-breakpoint
CREATE INDEX batch_mappings_scope ON batch_mappings(payroll_period_id, project_id, approval_status, match_status);
--> statement-breakpoint
CREATE TABLE payable_quantity_policies (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  work_type TEXT NOT NULL,
  quantity_unit TEXT NOT NULL,
  payable_source TEXT NOT NULL DEFAULT 'produced',
  allocation_policy TEXT NOT NULL DEFAULT 'direct_employee',
  status_requirement TEXT NOT NULL DEFAULT 'none',
  active INTEGER NOT NULL DEFAULT 1,
  updated_by INTEGER NOT NULL REFERENCES users(id),
  updated_at INTEGER NOT NULL,
  UNIQUE(project_id, work_type, quantity_unit)
);
--> statement-breakpoint
CREATE INDEX payable_policies_project ON payable_quantity_policies(project_id, active);
--> statement-breakpoint
CREATE TABLE manual_allocation_inputs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  payroll_period_id INTEGER NOT NULL REFERENCES payroll_periods(id) ON DELETE CASCADE,
  project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  batch_key TEXT NOT NULL,
  employee_id INTEGER NOT NULL REFERENCES employees(id),
  work_type TEXT NOT NULL,
  category_code TEXT,
  quantity_unit TEXT NOT NULL,
  allocated_quantity TEXT NOT NULL,
  reason TEXT NOT NULL,
  approved_by INTEGER NOT NULL REFERENCES users(id),
  approved_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  UNIQUE(payroll_period_id, project_id, batch_key, employee_id, work_type, category_code, quantity_unit)
);
--> statement-breakpoint
CREATE INDEX manual_allocations_scope ON manual_allocation_inputs(payroll_period_id, project_id, batch_key);
--> statement-breakpoint
CREATE TABLE reconciliation_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id TEXT NOT NULL UNIQUE,
  payroll_period_id INTEGER NOT NULL REFERENCES payroll_periods(id),
  project_id INTEGER NOT NULL REFERENCES projects(id),
  status TEXT NOT NULL DEFAULT 'processing',
  result_count INTEGER NOT NULL DEFAULT 0,
  warning_count INTEGER NOT NULL DEFAULT 0,
  blocking_count INTEGER NOT NULL DEFAULT 0,
  started_by INTEGER NOT NULL REFERENCES users(id),
  started_at INTEGER NOT NULL,
  completed_at INTEGER,
  approved_by INTEGER REFERENCES users(id),
  approved_at INTEGER,
  approval_reason TEXT
);
--> statement-breakpoint
CREATE INDEX reconciliation_runs_scope ON reconciliation_runs(payroll_period_id, project_id, started_at);
--> statement-breakpoint
CREATE TABLE reconciliation_results (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  reconciliation_run_id INTEGER NOT NULL REFERENCES reconciliation_runs(id) ON DELETE CASCADE,
  payroll_period_id INTEGER NOT NULL REFERENCES payroll_periods(id),
  project_id INTEGER NOT NULL REFERENCES projects(id),
  country TEXT,
  batch_key TEXT NOT NULL,
  internal_batch_id TEXT,
  client_batch_id TEXT,
  shipment_batch_id TEXT,
  employee_id INTEGER REFERENCES employees(id),
  employee_identifier TEXT,
  work_type TEXT NOT NULL,
  category_code TEXT,
  category_name TEXT,
  quantity_unit TEXT NOT NULL,
  entry_quantity TEXT NOT NULL DEFAULT '0',
  transmitted_quantity TEXT NOT NULL DEFAULT '0',
  accepted_quantity TEXT NOT NULL DEFAULT '0',
  shipdet_quantity TEXT NOT NULL DEFAULT '0',
  billable_quantity TEXT NOT NULL DEFAULT '0',
  authorized_payable_quantity TEXT NOT NULL DEFAULT '0',
  employee_allocated_quantity TEXT NOT NULL DEFAULT '0',
  non_payable_quantity TEXT NOT NULL DEFAULT '0',
  quantity_difference TEXT NOT NULL DEFAULT '0',
  payable_source TEXT NOT NULL,
  allocation_policy TEXT NOT NULL,
  match_status TEXT NOT NULL,
  exception_status TEXT NOT NULL,
  resolution_status TEXT NOT NULL DEFAULT 'open',
  salary_approval_status TEXT NOT NULL DEFAULT 'pending',
  source_trace_json TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
--> statement-breakpoint
CREATE INDEX reconciliation_results_scope ON reconciliation_results(payroll_period_id, project_id, batch_key, employee_id, work_type, quantity_unit);
--> statement-breakpoint
CREATE TABLE reconciliation_exceptions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  reconciliation_run_id INTEGER NOT NULL REFERENCES reconciliation_runs(id) ON DELETE CASCADE,
  payroll_period_id INTEGER NOT NULL REFERENCES payroll_periods(id),
  project_id INTEGER NOT NULL REFERENCES projects(id),
  batch_key TEXT,
  employee_identifier TEXT,
  source_file_id INTEGER REFERENCES source_files(id),
  exception_type TEXT NOT NULL,
  severity TEXT NOT NULL,
  explanation TEXT NOT NULL,
  recommended_action TEXT NOT NULL,
  resolution_status TEXT NOT NULL DEFAULT 'open',
  resolution_reason TEXT,
  resolved_by INTEGER REFERENCES users(id),
  resolved_at INTEGER,
  created_at INTEGER NOT NULL
);
--> statement-breakpoint
CREATE INDEX reconciliation_exceptions_scope ON reconciliation_exceptions(payroll_period_id, project_id, severity, resolution_status);
