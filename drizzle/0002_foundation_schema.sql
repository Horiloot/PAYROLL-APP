DROP TABLE entries;
--> statement-breakpoint
CREATE TABLE roles (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  created_at INTEGER NOT NULL
);
--> statement-breakpoint
CREATE TABLE permissions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT NOT NULL UNIQUE,
  label TEXT NOT NULL
);
--> statement-breakpoint
CREATE TABLE role_permissions (
  role_id INTEGER NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  permission_id INTEGER NOT NULL REFERENCES permissions(id) ON DELETE CASCADE,
  PRIMARY KEY (role_id, permission_id)
);
--> statement-breakpoint
CREATE TABLE users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  role_id INTEGER NOT NULL REFERENCES roles(id),
  status TEXT NOT NULL DEFAULT 'active',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
--> statement-breakpoint
CREATE TABLE sessions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  expires_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);
--> statement-breakpoint
CREATE TABLE employees (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  employee_id TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  joining_date TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  designation TEXT,
  contract_type TEXT,
  team TEXT,
  location TEXT,
  created_by INTEGER NOT NULL REFERENCES users(id),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
--> statement-breakpoint
CREATE TABLE employee_id_mappings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  employee_id INTEGER NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  previous_employee_id TEXT NOT NULL UNIQUE,
  effective_from TEXT,
  effective_to TEXT,
  note TEXT,
  created_at INTEGER NOT NULL
);
--> statement-breakpoint
CREATE TABLE payroll_periods (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  period_id TEXT NOT NULL UNIQUE,
  month INTEGER NOT NULL,
  year INTEGER NOT NULL,
  start_date TEXT NOT NULL,
  end_date TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'Draft',
  calculation_version INTEGER NOT NULL DEFAULT 0,
  created_by INTEGER NOT NULL REFERENCES users(id),
  approver_id INTEGER REFERENCES users(id),
  approval_at INTEGER,
  lock_at INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE (month, year)
);
--> statement-breakpoint
CREATE TABLE projects (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  main_project_id TEXT,
  client TEXT,
  description TEXT,
  start_date TEXT,
  end_date TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  currency TEXT NOT NULL,
  manager TEXT,
  notes TEXT,
  created_by INTEGER NOT NULL REFERENCES users(id),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
--> statement-breakpoint
CREATE TABLE project_period_configurations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  payroll_period_id INTEGER NOT NULL REFERENCES payroll_periods(id) ON DELETE CASCADE,
  project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  active INTEGER NOT NULL DEFAULT 1,
  copied_from_id INTEGER,
  created_at INTEGER NOT NULL,
  UNIQUE (payroll_period_id, project_id)
);
--> statement-breakpoint
CREATE TABLE project_country_configurations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  country_code TEXT NOT NULL,
  country_name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  effective_from TEXT NOT NULL,
  effective_to TEXT,
  created_at INTEGER NOT NULL,
  UNIQUE (project_id, country_code, effective_from)
);
--> statement-breakpoint
CREATE TABLE work_types (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  code TEXT NOT NULL,
  name TEXT NOT NULL,
  unit TEXT NOT NULL,
  payment_basis TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  created_at INTEGER NOT NULL,
  UNIQUE (project_id, code)
);
--> statement-breakpoint
CREATE TABLE character_categories (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  country_code TEXT,
  code TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  payment_basis TEXT NOT NULL,
  quantity_source TEXT NOT NULL,
  attribution_rule TEXT NOT NULL,
  effective_from TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  display_order INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  UNIQUE (project_id, code)
);
--> statement-breakpoint
CREATE TABLE rate_rules (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  country_code TEXT NOT NULL,
  work_type_id INTEGER NOT NULL REFERENCES work_types(id),
  category_id INTEGER REFERENCES character_categories(id),
  rule_name TEXT NOT NULL,
  rule_type TEXT NOT NULL,
  unit_rate TEXT NOT NULL,
  threshold_low TEXT,
  threshold_high TEXT,
  multiplier_low TEXT,
  multiplier_mid TEXT,
  multiplier_high TEXT,
  priority INTEGER NOT NULL DEFAULT 100,
  effective_from TEXT NOT NULL,
  effective_to TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  supersedes_rate_rule_id INTEGER REFERENCES rate_rules(id),
  created_by INTEGER NOT NULL REFERENCES users(id),
  created_at INTEGER NOT NULL
);
--> statement-breakpoint
CREATE TABLE employee_project_assignments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  employee_id INTEGER NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  payroll_period_id INTEGER REFERENCES payroll_periods(id) ON DELETE CASCADE,
  start_date TEXT NOT NULL,
  end_date TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  created_at INTEGER NOT NULL,
  UNIQUE (employee_id, project_id, payroll_period_id, start_date)
);
--> statement-breakpoint
CREATE TABLE audit_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id),
  action TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  previous_value TEXT,
  new_value TEXT,
  reason TEXT,
  created_at INTEGER NOT NULL
);
--> statement-breakpoint
CREATE INDEX idx_employees_status ON employees(status);
--> statement-breakpoint
CREATE INDEX idx_periods_status ON payroll_periods(status);
--> statement-breakpoint
CREATE INDEX idx_projects_status ON projects(status);
--> statement-breakpoint
CREATE INDEX idx_rate_scope ON rate_rules(project_id, country_code, work_type_id, effective_from);
--> statement-breakpoint
CREATE INDEX idx_assignments_period ON employee_project_assignments(payroll_period_id, project_id);
--> statement-breakpoint
CREATE INDEX idx_audit_entity ON audit_logs(entity_type, entity_id, created_at);