CREATE TABLE salary_calculation_policies (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE UNIQUE,
  rounding_scope TEXT NOT NULL DEFAULT 'per_component',
  decimal_places INTEGER NOT NULL DEFAULT 2,
  updated_by INTEGER NOT NULL REFERENCES users(id),
  updated_at INTEGER NOT NULL
);
--> statement-breakpoint
CREATE TABLE salary_inputs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  payroll_period_id INTEGER NOT NULL REFERENCES payroll_periods(id) ON DELETE CASCADE,
  project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  employee_id INTEGER NOT NULL REFERENCES employees(id),
  average_hours TEXT NOT NULL,
  reason TEXT NOT NULL,
  authorized_by INTEGER NOT NULL REFERENCES users(id),
  authorized_at INTEGER NOT NULL,
  UNIQUE(payroll_period_id, project_id, employee_id)
);
--> statement-breakpoint
CREATE INDEX salary_inputs_scope ON salary_inputs(payroll_period_id, project_id, employee_id);
--> statement-breakpoint
CREATE TABLE salary_calculation_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id TEXT NOT NULL UNIQUE,
  version INTEGER NOT NULL,
  payroll_period_id INTEGER NOT NULL REFERENCES payroll_periods(id),
  project_id INTEGER REFERENCES projects(id),
  status TEXT NOT NULL DEFAULT 'processing',
  rounding_scope TEXT NOT NULL,
  decimal_places INTEGER NOT NULL,
  component_count INTEGER NOT NULL DEFAULT 0,
  exception_count INTEGER NOT NULL DEFAULT 0,
  gross_total TEXT NOT NULL DEFAULT '0',
  adjustment_total TEXT NOT NULL DEFAULT '0',
  final_total TEXT NOT NULL DEFAULT '0',
  started_by INTEGER NOT NULL REFERENCES users(id),
  started_at INTEGER NOT NULL,
  completed_at INTEGER,
  UNIQUE(payroll_period_id, project_id, version)
);
--> statement-breakpoint
CREATE INDEX salary_runs_scope ON salary_calculation_runs(payroll_period_id, project_id, version, status);
--> statement-breakpoint
CREATE TABLE manual_adjustments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  payroll_period_id INTEGER NOT NULL REFERENCES payroll_periods(id),
  project_id INTEGER NOT NULL REFERENCES projects(id),
  employee_id INTEGER NOT NULL REFERENCES employees(id),
  reconciliation_result_id INTEGER REFERENCES reconciliation_results(id),
  amount TEXT NOT NULL,
  reason TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'approved',
  authorized_by INTEGER NOT NULL REFERENCES users(id),
  authorized_at INTEGER NOT NULL,
  applied_run_id INTEGER REFERENCES salary_calculation_runs(id),
  created_at INTEGER NOT NULL
);
--> statement-breakpoint
CREATE INDEX manual_adjustments_scope ON manual_adjustments(payroll_period_id, project_id, employee_id, status);
--> statement-breakpoint
CREATE TABLE salary_components (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  salary_run_id INTEGER NOT NULL REFERENCES salary_calculation_runs(id) ON DELETE CASCADE,
  calculation_version INTEGER NOT NULL,
  payroll_period_id INTEGER NOT NULL REFERENCES payroll_periods(id),
  project_id INTEGER NOT NULL REFERENCES projects(id),
  employee_id INTEGER NOT NULL REFERENCES employees(id),
  reconciliation_result_id INTEGER NOT NULL REFERENCES reconciliation_results(id),
  country TEXT NOT NULL,
  work_type TEXT NOT NULL,
  key_type TEXT,
  category_code TEXT,
  category_name TEXT,
  quantity_unit TEXT NOT NULL,
  quantity_source TEXT NOT NULL,
  approved_payable_quantity TEXT NOT NULL,
  applied_rate TEXT NOT NULL,
  rate_rule_id INTEGER NOT NULL REFERENCES rate_rules(id),
  formula_rule_id TEXT NOT NULL,
  allocation_method TEXT NOT NULL,
  multiplier TEXT NOT NULL DEFAULT '1',
  gross_amount TEXT NOT NULL,
  approved_adjustment TEXT NOT NULL DEFAULT '0',
  final_amount TEXT NOT NULL,
  source_trace_json TEXT NOT NULL,
  calculated_at INTEGER NOT NULL,
  UNIQUE(salary_run_id, reconciliation_result_id)
);
--> statement-breakpoint
CREATE INDEX salary_components_scope ON salary_components(payroll_period_id, project_id, employee_id, work_type, category_code);
--> statement-breakpoint
CREATE TABLE salary_exceptions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  salary_run_id INTEGER NOT NULL REFERENCES salary_calculation_runs(id) ON DELETE CASCADE,
  payroll_period_id INTEGER NOT NULL REFERENCES payroll_periods(id),
  project_id INTEGER REFERENCES projects(id),
  employee_id INTEGER REFERENCES employees(id),
  reconciliation_result_id INTEGER REFERENCES reconciliation_results(id),
  exception_type TEXT NOT NULL,
  explanation TEXT NOT NULL,
  recommended_action TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
--> statement-breakpoint
CREATE INDEX salary_exceptions_scope ON salary_exceptions(payroll_period_id, project_id, exception_type);