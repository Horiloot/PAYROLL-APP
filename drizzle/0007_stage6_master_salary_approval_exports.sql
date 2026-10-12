CREATE TABLE master_salary_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id TEXT NOT NULL UNIQUE,
  payroll_period_id INTEGER NOT NULL REFERENCES payroll_periods(id),
  version INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'processing',
  salary_run_ids_json TEXT NOT NULL,
  project_count INTEGER NOT NULL DEFAULT 0,
  employee_count INTEGER NOT NULL DEFAULT 0,
  exception_count INTEGER NOT NULL DEFAULT 0,
  gross_total TEXT NOT NULL DEFAULT '0',
  bonus_total TEXT NOT NULL DEFAULT '0',
  deduction_total TEXT NOT NULL DEFAULT '0',
  final_total TEXT NOT NULL DEFAULT '0',
  generated_by INTEGER NOT NULL REFERENCES users(id),
  generated_at INTEGER NOT NULL,
  UNIQUE(payroll_period_id, version)
);
--> statement-breakpoint
CREATE INDEX master_salary_runs_scope ON master_salary_runs(payroll_period_id, status, version);
--> statement-breakpoint
CREATE TABLE master_salary_results (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  master_run_id INTEGER NOT NULL REFERENCES master_salary_runs(id) ON DELETE CASCADE,
  payroll_period_id INTEGER NOT NULL REFERENCES payroll_periods(id),
  employee_id INTEGER NOT NULL REFERENCES employees(id),
  project_amounts_json TEXT NOT NULL,
  production_salary TEXT NOT NULL DEFAULT '0',
  doctype_salary TEXT NOT NULL DEFAULT '0',
  proof_salary TEXT NOT NULL DEFAULT '0',
  other_components TEXT NOT NULL DEFAULT '0',
  bonuses TEXT NOT NULL DEFAULT '0',
  deductions TEXT NOT NULL DEFAULT '0',
  gross_salary TEXT NOT NULL DEFAULT '0',
  final_payable_salary TEXT NOT NULL DEFAULT '0',
  reconciliation_status TEXT NOT NULL DEFAULT 'clear',
  created_at INTEGER NOT NULL,
  UNIQUE(master_run_id, employee_id)
);
--> statement-breakpoint
CREATE INDEX master_salary_results_scope ON master_salary_results(payroll_period_id, employee_id);
--> statement-breakpoint
CREATE TABLE master_salary_exceptions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  master_run_id INTEGER NOT NULL REFERENCES master_salary_runs(id) ON DELETE CASCADE,
  payroll_period_id INTEGER NOT NULL REFERENCES payroll_periods(id),
  project_id INTEGER REFERENCES projects(id),
  employee_id INTEGER REFERENCES employees(id),
  exception_type TEXT NOT NULL,
  explanation TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
--> statement-breakpoint
CREATE INDEX master_salary_exceptions_scope ON master_salary_exceptions(payroll_period_id, master_run_id, exception_type);
--> statement-breakpoint
CREATE TABLE master_adjustments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  payroll_period_id INTEGER NOT NULL REFERENCES payroll_periods(id),
  employee_id INTEGER NOT NULL REFERENCES employees(id),
  adjustment_type TEXT NOT NULL,
  amount TEXT NOT NULL,
  reason TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'approved',
  authorized_by INTEGER NOT NULL REFERENCES users(id),
  authorized_at INTEGER NOT NULL,
  applied_master_run_id INTEGER REFERENCES master_salary_runs(id)
);
--> statement-breakpoint
CREATE INDEX master_adjustments_scope ON master_adjustments(payroll_period_id, employee_id, status);
--> statement-breakpoint
CREATE TABLE approval_records (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  payroll_period_id INTEGER NOT NULL REFERENCES payroll_periods(id),
  master_run_id INTEGER REFERENCES master_salary_runs(id),
  action TEXT NOT NULL,
  from_status TEXT NOT NULL,
  to_status TEXT NOT NULL,
  reason TEXT NOT NULL,
  acted_by INTEGER NOT NULL REFERENCES users(id),
  acted_at INTEGER NOT NULL
);
--> statement-breakpoint
CREATE INDEX approval_records_scope ON approval_records(payroll_period_id, acted_at);
--> statement-breakpoint
CREATE TABLE export_jobs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  job_id TEXT NOT NULL UNIQUE,
  payroll_period_id INTEGER NOT NULL REFERENCES payroll_periods(id),
  master_run_id INTEGER REFERENCES master_salary_runs(id),
  export_type TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'queued',
  progress INTEGER NOT NULL DEFAULT 0,
  filename TEXT,
  blob_key TEXT,
  row_count INTEGER NOT NULL DEFAULT 0,
  error_message TEXT,
  generated_by INTEGER NOT NULL REFERENCES users(id),
  created_at INTEGER NOT NULL,
  completed_at INTEGER
);
--> statement-breakpoint
CREATE INDEX export_jobs_scope ON export_jobs(payroll_period_id, status, created_at);