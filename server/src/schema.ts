import { index, integer, primaryKey, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

const now = () => new Date();

export const roles = sqliteTable("roles", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().$defaultFn(now),
});

export const permissions = sqliteTable("permissions", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  code: text("code").notNull().unique(),
  label: text("label").notNull(),
});

export const rolePermissions = sqliteTable("role_permissions", {
  roleId: integer("role_id").notNull().references(() => roles.id, { onDelete: "cascade" }),
  permissionId: integer("permission_id").notNull().references(() => permissions.id, { onDelete: "cascade" }),
}, (table) => [primaryKey({ columns: [table.roleId, table.permissionId] })]);

export const users = sqliteTable("users", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  email: text("email").notNull().unique(),
  name: text("name").notNull(),
  passwordHash: text("password_hash").notNull(),
  roleId: integer("role_id").notNull().references(() => roles.id),
  status: text("status", { enum: ["active", "inactive"] }).notNull().default("active"),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().$defaultFn(now),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull().$defaultFn(now),
});

export const sessions = sqliteTable("sessions", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  userId: integer("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  tokenHash: text("token_hash").notNull().unique(),
  expiresAt: integer("expires_at", { mode: "timestamp_ms" }).notNull(),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().$defaultFn(now),
});

export const employees = sqliteTable("employees", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  employeeId: text("employee_id").notNull().unique(),
  name: text("name").notNull(),
  joiningDate: text("joining_date"),
  status: text("status", { enum: ["active", "inactive", "leave", "separated"] }).notNull().default("active"),
  designation: text("designation"),
  contractType: text("contract_type"),
  team: text("team"),
  location: text("location"),
  createdBy: integer("created_by").notNull().references(() => users.id),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().$defaultFn(now),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull().$defaultFn(now),
});

export const employeeIdMappings = sqliteTable("employee_id_mappings", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  employeeId: integer("employee_id").notNull().references(() => employees.id, { onDelete: "cascade" }),
  previousEmployeeId: text("previous_employee_id").notNull().unique(),
  effectiveFrom: text("effective_from"),
  effectiveTo: text("effective_to"),
  note: text("note"),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().$defaultFn(now),
});

export const payrollPeriods = sqliteTable("payroll_periods", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  periodId: text("period_id").notNull().unique(),
  month: integer("month").notNull(),
  year: integer("year").notNull(),
  startDate: text("start_date").notNull(),
  endDate: text("end_date").notNull(),
  status: text("status").notNull().default("Draft"),
  calculationVersion: integer("calculation_version").notNull().default(0),
  createdBy: integer("created_by").notNull().references(() => users.id),
  approverId: integer("approver_id").references(() => users.id),
  approvalAt: integer("approval_at", { mode: "timestamp_ms" }),
  lockAt: integer("lock_at", { mode: "timestamp_ms" }),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().$defaultFn(now),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull().$defaultFn(now),
}, (table) => [uniqueIndex("period_month_year").on(table.month, table.year)]);

export const projects = sqliteTable("projects", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  projectId: text("project_id").notNull().unique(),
  name: text("name").notNull(),
  mainProjectId: text("main_project_id"),
  client: text("client"),
  description: text("description"),
  startDate: text("start_date"),
  endDate: text("end_date"),
  status: text("status", { enum: ["active", "inactive", "archived"] }).notNull().default("active"),
  currency: text("currency").notNull(),
  manager: text("manager"),
  notes: text("notes"),
  createdBy: integer("created_by").notNull().references(() => users.id),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().$defaultFn(now),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull().$defaultFn(now),
});

export const projectPeriodConfigurations = sqliteTable("project_period_configurations", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  payrollPeriodId: integer("payroll_period_id").notNull().references(() => payrollPeriods.id, { onDelete: "cascade" }),
  projectId: integer("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  active: integer("active", { mode: "boolean" }).notNull().default(true),
  copiedFromId: integer("copied_from_id"),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().$defaultFn(now),
}, (table) => [uniqueIndex("period_project_unique").on(table.payrollPeriodId, table.projectId)]);

export const projectCountryConfigurations = sqliteTable("project_country_configurations", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  projectId: integer("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  countryCode: text("country_code").notNull(),
  countryName: text("country_name").notNull(),
  status: text("status", { enum: ["active", "inactive"] }).notNull().default("active"),
  effectiveFrom: text("effective_from").notNull(),
  effectiveTo: text("effective_to"),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().$defaultFn(now),
}, (table) => [uniqueIndex("project_country_effective").on(table.projectId, table.countryCode, table.effectiveFrom)]);

export const workTypes = sqliteTable("work_types", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  projectId: integer("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  code: text("code").notNull(),
  name: text("name").notNull(),
  unit: text("unit").notNull(),
  paymentBasis: text("payment_basis").notNull(),
  status: text("status", { enum: ["active", "inactive"] }).notNull().default("active"),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().$defaultFn(now),
}, (table) => [uniqueIndex("project_work_type").on(table.projectId, table.code)]);

export const characterCategories = sqliteTable("character_categories", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  projectId: integer("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  countryCode: text("country_code"),
  code: text("code").notNull(),
  name: text("name").notNull(),
  description: text("description"),
  paymentBasis: text("payment_basis").notNull(),
  quantitySource: text("quantity_source").notNull(),
  attributionRule: text("attribution_rule").notNull(),
  effectiveFrom: text("effective_from").notNull(),
  status: text("status", { enum: ["active", "inactive"] }).notNull().default("active"),
  displayOrder: integer("display_order").notNull().default(0),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().$defaultFn(now),
}, (table) => [uniqueIndex("project_category").on(table.projectId, table.code)]);

export const rateRules = sqliteTable("rate_rules", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  projectId: integer("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  countryCode: text("country_code").notNull(),
  workTypeId: integer("work_type_id").notNull().references(() => workTypes.id),
  categoryId: integer("category_id").references(() => characterCategories.id),
  ruleName: text("rule_name").notNull(),
  ruleType: text("rule_type").notNull(),
  unitRate: text("unit_rate").notNull(),
  thresholdLow: text("threshold_low"),
  thresholdHigh: text("threshold_high"),
  multiplierLow: text("multiplier_low"),
  multiplierMid: text("multiplier_mid"),
  multiplierHigh: text("multiplier_high"),
  priority: integer("priority").notNull().default(100),
  effectiveFrom: text("effective_from").notNull(),
  effectiveTo: text("effective_to"),
  status: text("status", { enum: ["active", "inactive"] }).notNull().default("active"),
  supersedesRateRuleId: integer("supersedes_rate_rule_id"),
  createdBy: integer("created_by").notNull().references(() => users.id),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().$defaultFn(now),
});

export const employeeProjectAssignments = sqliteTable("employee_project_assignments", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  employeeId: integer("employee_id").notNull().references(() => employees.id, { onDelete: "cascade" }),
  projectId: integer("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  payrollPeriodId: integer("payroll_period_id").references(() => payrollPeriods.id, { onDelete: "cascade" }),
  startDate: text("start_date").notNull(),
  endDate: text("end_date"),
  status: text("status", { enum: ["active", "inactive"] }).notNull().default("active"),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().$defaultFn(now),
}, (table) => [uniqueIndex("employee_project_period_start").on(table.employeeId, table.projectId, table.payrollPeriodId, table.startDate)]);

export const auditLogs = sqliteTable("audit_logs", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  userId: integer("user_id").notNull().references(() => users.id),
  action: text("action").notNull(),
  entityType: text("entity_type").notNull(),
  entityId: text("entity_id").notNull(),
  previousValue: text("previous_value"),
  newValue: text("new_value"),
  reason: text("reason"),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().$defaultFn(now),
});


export const importBatches = sqliteTable("import_batches", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  batchId: text("batch_id").notNull().unique(),
  payrollPeriodId: integer("payroll_period_id").notNull().references(() => payrollPeriods.id),
  projectId: integer("project_id").notNull().references(() => projects.id),
  sourceType: text("source_type", { enum: ["employee_information", "record_details", "doctype", "proof", "transmitted_batch", "shipdet"] }).notNull(),
  delimiter: text("delimiter").notNull().default("auto"),
  mappingJson: text("mapping_json"),
  businessKeysJson: text("business_keys_json"),
  status: text("status", { enum: ["uploading", "processing", "mapping_required", "ready", "committed", "failed", "reversed"] }).notNull().default("uploading"),
  totalFiles: integer("total_files").notNull().default(0),
  processedFiles: integer("processed_files").notNull().default(0),
  totalRows: integer("total_rows").notNull().default(0),
  validRows: integer("valid_rows").notNull().default(0),
  rejectedRows: integer("rejected_rows").notNull().default(0),
  duplicateRows: integer("duplicate_rows").notNull().default(0),
  errorSummary: text("error_summary"),
  uploadedBy: integer("uploaded_by").notNull().references(() => users.id),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().$defaultFn(now),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull().$defaultFn(now),
  committedAt: integer("committed_at", { mode: "timestamp_ms" }),
});

export const sourceFiles = sqliteTable("source_files", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  sourceFileId: text("source_file_id").notNull().unique(),
  importBatchId: integer("import_batch_id").notNull().references(() => importBatches.id, { onDelete: "cascade" }),
  payrollPeriodId: integer("payroll_period_id").notNull().references(() => payrollPeriods.id),
  projectId: integer("project_id").notNull().references(() => projects.id),
  sourceType: text("source_type").notNull(),
  originalFilename: text("original_filename").notNull(),
  fileHash: text("file_hash").notNull(),
  mimeType: text("mime_type").notNull(),
  sizeBytes: integer("size_bytes").notNull(),
  expectedChunks: integer("expected_chunks").notNull(),
  uploadedChunks: integer("uploaded_chunks").notNull().default(0),
  blobKey: text("blob_key"),
  status: text("status", { enum: ["uploading", "processing", "ready", "committed", "failed", "reversed"] }).notNull().default("uploading"),
  totalRows: integer("total_rows").notNull().default(0),
  importedRows: integer("imported_rows").notNull().default(0),
  rejectedRows: integer("rejected_rows").notNull().default(0),
  duplicateRows: integer("duplicate_rows").notNull().default(0),
  errorSummary: text("error_summary"),
  replacementOfFileId: integer("replacement_of_file_id"),
  uploadedBy: integer("uploaded_by").notNull().references(() => users.id),
  uploadedAt: integer("uploaded_at", { mode: "timestamp_ms" }).notNull().$defaultFn(now),
  processedAt: integer("processed_at", { mode: "timestamp_ms" }),
  reversedAt: integer("reversed_at", { mode: "timestamp_ms" }),
}, (table) => [
  index("source_files_scope_hash").on(table.payrollPeriodId, table.projectId, table.sourceType, table.fileHash),
  index("source_files_batch").on(table.importBatchId),
]);

export const importUploadChunks = sqliteTable("import_upload_chunks", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  sourceFileId: integer("source_file_id").notNull().references(() => sourceFiles.id, { onDelete: "cascade" }),
  chunkIndex: integer("chunk_index").notNull(),
  blobKey: text("blob_key").notNull(),
  sizeBytes: integer("size_bytes").notNull(),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().$defaultFn(now),
}, (table) => [uniqueIndex("source_file_chunk_unique").on(table.sourceFileId, table.chunkIndex)]);

export const columnMappingTemplates = sqliteTable("column_mapping_templates", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  sourceType: text("source_type").notNull(),
  projectId: integer("project_id").references(() => projects.id, { onDelete: "cascade" }),
  mappingJson: text("mapping_json").notNull(),
  businessKeysJson: text("business_keys_json").notNull(),
  delimiter: text("delimiter").notNull().default("auto"),
  createdBy: integer("created_by").notNull().references(() => users.id),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().$defaultFn(now),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull().$defaultFn(now),
}, (table) => [uniqueIndex("mapping_template_project_name").on(table.sourceType, table.projectId, table.name)]);

export const importRows = sqliteTable("import_rows", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  importBatchId: integer("import_batch_id").notNull().references(() => importBatches.id, { onDelete: "cascade" }),
  sourceFileId: integer("source_file_id").notNull().references(() => sourceFiles.id, { onDelete: "cascade" }),
  sourceRowNumber: integer("source_row_number").notNull(),
  rawPayload: text("raw_payload").notNull(),
  normalizedPayload: text("normalized_payload"),
  businessKey: text("business_key"),
  validationStatus: text("validation_status", { enum: ["pending", "valid", "rejected", "duplicate"] }).notNull().default("pending"),
  validationErrors: text("validation_errors"),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().$defaultFn(now),
}, (table) => [
  uniqueIndex("import_source_row_unique").on(table.sourceFileId, table.sourceRowNumber),
  index("import_rows_batch_status").on(table.importBatchId, table.validationStatus),
]);

export const normalizedImportRows = sqliteTable("normalized_import_rows", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  importBatchId: integer("import_batch_id").notNull().references(() => importBatches.id),
  sourceFileId: integer("source_file_id").notNull().references(() => sourceFiles.id),
  payrollPeriodId: integer("payroll_period_id").notNull().references(() => payrollPeriods.id),
  projectId: integer("project_id").notNull().references(() => projects.id),
  sourceType: text("source_type").notNull(),
  sourceRowNumber: integer("source_row_number").notNull(),
  employeeId: text("employee_id"),
  employeeName: text("employee_name"),
  entryEmployeeId: text("entry_employee_id"),
  proofEmployeeId: text("proof_employee_id"),
  batchId: text("batch_id"),
  clientBatchId: text("client_batch_id"),
  productionDate: text("production_date"),
  country: text("country"),
  workType: text("work_type"),
  keyType: text("key_type"),
  recordCount: text("record_count"),
  characterCount: text("character_count"),
  imageCount: text("image_count"),
  transmittedStatus: text("transmitted_status"),
  originalPayload: text("original_payload").notNull(),
  normalizedPayload: text("normalized_payload").notNull(),
  businessKey: text("business_key").notNull(),
  active: integer("active", { mode: "boolean" }).notNull().default(true),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().$defaultFn(now),
  reversedAt: integer("reversed_at", { mode: "timestamp_ms" }),
}, (table) => [
  uniqueIndex("normalized_source_row_unique").on(table.sourceFileId, table.sourceRowNumber),
  index("normalized_scope_key").on(table.payrollPeriodId, table.projectId, table.sourceType, table.businessKey),
  index("normalized_employee").on(table.employeeId),
  index("normalized_batch").on(table.batchId),
]);


export const projectProductionConfigurations = sqliteTable("project_production_configurations", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  projectId: integer("project_id").notNull().unique().references(() => projects.id, { onDelete: "cascade" }),
  doctypeEnabled: integer("doctype_enabled", { mode: "boolean" }).notNull().default(false),
  proofEnabled: integer("proof_enabled", { mode: "boolean" }).notNull().default(false),
  allowKeyVariantDoubleCount: integer("allow_key_variant_double_count", { mode: "boolean" }).notNull().default(false),
  proofTypesJson: text("proof_types_json").notNull().default("[]"),
  statusMappingsJson: text("status_mappings_json").notNull().default("{}"),
  updatedBy: integer("updated_by").notNull().references(() => users.id),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull().$defaultFn(now),
});

export const productionExceptions = sqliteTable("production_exceptions", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  payrollPeriodId: integer("payroll_period_id").notNull().references(() => payrollPeriods.id),
  projectId: integer("project_id").notNull().references(() => projects.id),
  sourceFileId: integer("source_file_id").references(() => sourceFiles.id),
  importBatchId: integer("import_batch_id").references(() => importBatches.id),
  stream: text("stream").notNull(),
  sourceRowNumber: integer("source_row_number"),
  severity: text("severity", { enum: ["warning", "blocking"] }).notNull(),
  code: text("code").notNull(),
  employeeIdentifier: text("employee_identifier"),
  batchIdentifier: text("batch_identifier"),
  explanation: text("explanation").notNull(),
  recommendedAction: text("recommended_action").notNull(),
  resolutionStatus: text("resolution_status", { enum: ["open", "resolved"] }).notNull().default("open"),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().$defaultFn(now),
  resolvedAt: integer("resolved_at", { mode: "timestamp_ms" }),
}, (table) => [index("production_exceptions_scope").on(table.payrollPeriodId, table.projectId, table.stream, table.resolutionStatus)]);

export const recordDetails = sqliteTable("record_details", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  importRowId: integer("import_row_id").notNull().unique().references(() => importRows.id),
  importBatchId: integer("import_batch_id").notNull().references(() => importBatches.id),
  sourceFileId: integer("source_file_id").notNull().references(() => sourceFiles.id),
  payrollPeriodId: integer("payroll_period_id").notNull().references(() => payrollPeriods.id),
  projectId: integer("project_id").notNull().references(() => projects.id),
  sourceRowNumber: integer("source_row_number").notNull(),
  sourceVariant: text("source_variant").notNull(),
  internalBatchId: text("internal_batch_id"),
  clientBatchId: text("client_batch_id"),
  employeeRecordId: integer("employee_record_id").references(() => employees.id),
  employeeIdentifier: text("employee_identifier"),
  employeeName: text("employee_name"),
  productionDate: text("production_date"),
  country: text("country"),
  entryGroup: text("entry_group"),
  workType: text("work_type"),
  keyType: text("key_type"),
  recordCount: text("record_count"),
  characterCount: text("character_count"),
  documentReference: text("document_reference"),
  reviewKeyIdentifier: text("review_key_identifier"),
  fullKeyIdentifier: text("full_key_identifier"),
  businessKey: text("business_key").notNull(),
  payableState: text("payable_state", { enum: ["eligible", "blocked_overlap"] }).notNull().default("eligible"),
  originalSourcePayload: text("original_source_payload").notNull(),
  active: integer("active", { mode: "boolean" }).notNull().default(true),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().$defaultFn(now),
  reversedAt: integer("reversed_at", { mode: "timestamp_ms" }),
}, (table) => [
  index("record_details_scope").on(table.payrollPeriodId, table.projectId, table.active, table.productionDate),
  index("record_details_employee").on(table.employeeIdentifier),
  index("record_details_batch").on(table.internalBatchId, table.clientBatchId),
  index("record_details_key_type").on(table.keyType, table.workType),
]);

export const recordCategoryQuantities = sqliteTable("record_category_quantities", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  recordDetailId: integer("record_detail_id").notNull().references(() => recordDetails.id, { onDelete: "cascade" }),
  categoryCode: text("category_code").notNull(),
  categoryName: text("category_name").notNull(),
  quantityUnit: text("quantity_unit", { enum: ["record", "character"] }).notNull(),
  quantity: text("quantity").notNull(),
  sourceColumn: text("source_column").notNull(),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().$defaultFn(now),
}, (table) => [uniqueIndex("record_category_unique").on(table.recordDetailId, table.categoryCode, table.quantityUnit, table.sourceColumn), index("record_categories_lookup").on(table.categoryCode, table.quantityUnit)]);

export const doctypeRecords = sqliteTable("doctype_records", {
  id: integer("id").primaryKey({ autoIncrement: true }), importRowId: integer("import_row_id").notNull().unique().references(() => importRows.id), importBatchId: integer("import_batch_id").notNull().references(() => importBatches.id), sourceFileId: integer("source_file_id").notNull().references(() => sourceFiles.id), payrollPeriodId: integer("payroll_period_id").notNull().references(() => payrollPeriods.id), projectId: integer("project_id").notNull().references(() => projects.id), sourceRowNumber: integer("source_row_number").notNull(), batchId: text("batch_id"), employeeRecordId: integer("employee_record_id").references(() => employees.id), employeeIdentifier: text("employee_identifier"), documentCount: text("document_count"), imageCount: text("image_count"), workType: text("work_type"), country: text("country"), status: text("status"), originalSourcePayload: text("original_source_payload").notNull(), active: integer("active", { mode: "boolean" }).notNull().default(true), createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().$defaultFn(now), reversedAt: integer("reversed_at", { mode: "timestamp_ms" }),
}, (table) => [index("doctype_scope").on(table.payrollPeriodId, table.projectId, table.active), index("doctype_employee").on(table.employeeIdentifier)]);

export const proofRecords = sqliteTable("proof_records", {
  id: integer("id").primaryKey({ autoIncrement: true }), importRowId: integer("import_row_id").notNull().unique().references(() => importRows.id), importBatchId: integer("import_batch_id").notNull().references(() => importBatches.id), sourceFileId: integer("source_file_id").notNull().references(() => sourceFiles.id), payrollPeriodId: integer("payroll_period_id").notNull().references(() => payrollPeriods.id), projectId: integer("project_id").notNull().references(() => projects.id), sourceRowNumber: integer("source_row_number").notNull(), batchId: text("batch_id"), entryEmployeeRecordId: integer("entry_employee_record_id").references(() => employees.id), entryEmployeeIdentifier: text("entry_employee_identifier"), proofEmployeeRecordId: integer("proof_employee_record_id").references(() => employees.id), proofEmployeeIdentifier: text("proof_employee_identifier"), proofType: text("proof_type"), recordQuantity: text("record_quantity"), characterQuantity: text("character_quantity"), country: text("country"), keyType: text("key_type"), adjustment: text("adjustment").notNull().default("0"), originalSourcePayload: text("original_source_payload").notNull(), active: integer("active", { mode: "boolean" }).notNull().default(true), createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().$defaultFn(now), reversedAt: integer("reversed_at", { mode: "timestamp_ms" }),
}, (table) => [index("proof_scope").on(table.payrollPeriodId, table.projectId, table.active), index("proof_entry_employee").on(table.entryEmployeeIdentifier), index("proof_performer").on(table.proofEmployeeIdentifier)]);

export const transmittedBatches = sqliteTable("transmitted_batches", {
  id: integer("id").primaryKey({ autoIncrement: true }), importRowId: integer("import_row_id").notNull().unique().references(() => importRows.id), importBatchId: integer("import_batch_id").notNull().references(() => importBatches.id), sourceFileId: integer("source_file_id").notNull().references(() => sourceFiles.id), payrollPeriodId: integer("payroll_period_id").notNull().references(() => payrollPeriods.id), projectId: integer("project_id").notNull().references(() => projects.id), sourceRowNumber: integer("source_row_number").notNull(), internalBatchId: text("internal_batch_id"), clientBatchId: text("client_batch_id"), batchName: text("batch_name"), country: text("country"), recordCount: text("record_count"), characterCount: text("character_count"), imageCount: text("image_count"), transmittedDate: text("transmitted_date"), transmissionStatusRaw: text("transmission_status_raw"), transmissionStatus: text("transmission_status").notNull().default("unknown"), clientAcceptanceStatusRaw: text("client_acceptance_status_raw"), clientAcceptanceStatus: text("client_acceptance_status").notNull().default("unknown"), workType: text("work_type"), producedState: text("produced_state").notNull().default("unknown"), shippedState: text("shipped_state").notNull().default("unknown"), billableState: text("billable_state").notNull().default("unknown"), salaryApprovalState: text("salary_approval_state").notNull().default("unknown"), originalSourcePayload: text("original_source_payload").notNull(), active: integer("active", { mode: "boolean" }).notNull().default(true), createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().$defaultFn(now), reversedAt: integer("reversed_at", { mode: "timestamp_ms" }),
}, (table) => [index("transmitted_scope").on(table.payrollPeriodId, table.projectId, table.active), index("transmitted_batch_ids").on(table.internalBatchId, table.clientBatchId)]);

export const shipdetBatches = sqliteTable("shipdet_batches", {
  id: integer("id").primaryKey({ autoIncrement: true }), importRowId: integer("import_row_id").notNull().unique().references(() => importRows.id), importBatchId: integer("import_batch_id").notNull().references(() => importBatches.id), sourceFileId: integer("source_file_id").notNull().references(() => sourceFiles.id), payrollPeriodId: integer("payroll_period_id").notNull().references(() => payrollPeriods.id), projectId: integer("project_id").notNull().references(() => projects.id), sourceRowNumber: integer("source_row_number").notNull(), clientProjectName: text("client_project_name"), internalBatchId: text("internal_batch_id"), clientBatchId: text("client_batch_id"), shipmentBatchId: text("shipment_batch_id"), shipmentDate: text("shipment_date"), recordCount: text("record_count"), characterCount: text("character_count"), imageCount: text("image_count"), billableQuantity: text("billable_quantity"), acceptanceStatus: text("acceptance_status").notNull().default("unknown"), normalizedFieldsJson: text("normalized_fields_json").notNull(), originalSourcePayload: text("original_source_payload").notNull(), reviewStatus: text("review_status", { enum: ["pending", "confirmed"] }).notNull().default("pending"), reviewedBy: integer("reviewed_by").references(() => users.id), reviewedAt: integer("reviewed_at", { mode: "timestamp_ms" }), active: integer("active", { mode: "boolean" }).notNull().default(true), createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().$defaultFn(now), reversedAt: integer("reversed_at", { mode: "timestamp_ms" }),
}, (table) => [index("shipdet_scope").on(table.payrollPeriodId, table.projectId, table.active, table.reviewStatus), index("shipdet_batch_ids").on(table.internalBatchId, table.clientBatchId, table.shipmentBatchId)]);

export const shipdetCategoryQuantities = sqliteTable("shipdet_category_quantities", {
  id: integer("id").primaryKey({ autoIncrement: true }), shipdetBatchId: integer("shipdet_batch_id").notNull().references(() => shipdetBatches.id, { onDelete: "cascade" }), categoryCode: text("category_code").notNull(), categoryName: text("category_name").notNull(), quantity: text("quantity").notNull(), sourceColumn: text("source_column").notNull(), createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().$defaultFn(now),
}, (table) => [uniqueIndex("shipdet_category_unique").on(table.shipdetBatchId, table.categoryCode, table.sourceColumn), index("shipdet_categories_lookup").on(table.categoryCode)]);


export const batchMappings = sqliteTable("batch_mappings", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  payrollPeriodId: integer("payroll_period_id").notNull().references(() => payrollPeriods.id, { onDelete: "cascade" }),
  projectId: integer("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  internalBatchId: text("internal_batch_id"),
  clientBatchId: text("client_batch_id"),
  shipmentBatchId: text("shipment_batch_id"),
  normalizedInternalBatchId: text("normalized_internal_batch_id"),
  normalizedClientBatchId: text("normalized_client_batch_id"),
  normalizedShipmentBatchId: text("normalized_shipment_batch_id"),
  country: text("country"),
  matchStatus: text("match_status", { enum: ["matched", "review", "unmatched"] }).notNull().default("review"),
  matchMethod: text("match_method", { enum: ["exact_internal", "exact_client", "exact_shipment", "manual", "ambiguous"] }).notNull(),
  approvalStatus: text("approval_status", { enum: ["pending", "approved", "rejected"] }).notNull().default("pending"),
  approvedBy: integer("approved_by").references(() => users.id),
  approvedAt: integer("approved_at", { mode: "timestamp_ms" }),
  createdBy: integer("created_by").notNull().references(() => users.id),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().$defaultFn(now),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull().$defaultFn(now),
}, (table) => [
  uniqueIndex("batch_mapping_identity").on(table.payrollPeriodId, table.projectId, table.normalizedInternalBatchId, table.normalizedClientBatchId, table.normalizedShipmentBatchId),
  index("batch_mappings_scope").on(table.payrollPeriodId, table.projectId, table.approvalStatus, table.matchStatus),
]);

export const payableQuantityPolicies = sqliteTable("payable_quantity_policies", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  projectId: integer("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  workType: text("work_type").notNull(),
  quantityUnit: text("quantity_unit", { enum: ["record", "character", "image", "document"] }).notNull(),
  payableSource: text("payable_source", { enum: ["produced", "confirmed_shipped", "client_billable", "accepted_transmitted"] }).notNull().default("produced"),
  allocationPolicy: text("allocation_policy", { enum: ["direct_employee", "record_attribution", "category_proportional", "manual"] }).notNull().default("direct_employee"),
  statusRequirement: text("status_requirement", { enum: ["none", "transmitted", "accepted", "confirmed_shipped", "client_billable"] }).notNull().default("none"),
  active: integer("active", { mode: "boolean" }).notNull().default(true),
  updatedBy: integer("updated_by").notNull().references(() => users.id),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull().$defaultFn(now),
}, (table) => [uniqueIndex("payable_policy_scope").on(table.projectId, table.workType, table.quantityUnit), index("payable_policies_project").on(table.projectId, table.active)]);

export const manualAllocationInputs = sqliteTable("manual_allocation_inputs", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  payrollPeriodId: integer("payroll_period_id").notNull().references(() => payrollPeriods.id, { onDelete: "cascade" }),
  projectId: integer("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  batchKey: text("batch_key").notNull(),
  employeeId: integer("employee_id").notNull().references(() => employees.id),
  workType: text("work_type").notNull(),
  categoryCode: text("category_code"),
  quantityUnit: text("quantity_unit", { enum: ["record", "character", "image", "document"] }).notNull(),
  allocatedQuantity: text("allocated_quantity").notNull(),
  reason: text("reason").notNull(),
  approvedBy: integer("approved_by").notNull().references(() => users.id),
  approvedAt: integer("approved_at", { mode: "timestamp_ms" }).notNull(),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().$defaultFn(now),
}, (table) => [uniqueIndex("manual_allocation_scope").on(table.payrollPeriodId, table.projectId, table.batchKey, table.employeeId, table.workType, table.categoryCode, table.quantityUnit), index("manual_allocations_scope").on(table.payrollPeriodId, table.projectId, table.batchKey)]);

export const reconciliationRuns = sqliteTable("reconciliation_runs", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  runId: text("run_id").notNull().unique(),
  payrollPeriodId: integer("payroll_period_id").notNull().references(() => payrollPeriods.id),
  projectId: integer("project_id").notNull().references(() => projects.id),
  status: text("status", { enum: ["processing", "completed", "approved", "failed"] }).notNull().default("processing"),
  resultCount: integer("result_count").notNull().default(0),
  warningCount: integer("warning_count").notNull().default(0),
  blockingCount: integer("blocking_count").notNull().default(0),
  startedBy: integer("started_by").notNull().references(() => users.id),
  startedAt: integer("started_at", { mode: "timestamp_ms" }).notNull().$defaultFn(now),
  completedAt: integer("completed_at", { mode: "timestamp_ms" }),
  approvedBy: integer("approved_by").references(() => users.id),
  approvedAt: integer("approved_at", { mode: "timestamp_ms" }),
  approvalReason: text("approval_reason"),
}, (table) => [index("reconciliation_runs_scope").on(table.payrollPeriodId, table.projectId, table.startedAt)]);

export const reconciliationResults = sqliteTable("reconciliation_results", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  reconciliationRunId: integer("reconciliation_run_id").notNull().references(() => reconciliationRuns.id, { onDelete: "cascade" }),
  payrollPeriodId: integer("payroll_period_id").notNull().references(() => payrollPeriods.id),
  projectId: integer("project_id").notNull().references(() => projects.id),
  country: text("country"), batchKey: text("batch_key").notNull(), internalBatchId: text("internal_batch_id"), clientBatchId: text("client_batch_id"), shipmentBatchId: text("shipment_batch_id"),
  employeeId: integer("employee_id").references(() => employees.id), employeeIdentifier: text("employee_identifier"), workType: text("work_type").notNull(), categoryCode: text("category_code"), categoryName: text("category_name"),
  quantityUnit: text("quantity_unit", { enum: ["record", "character", "image", "document"] }).notNull(),
  entryQuantity: text("entry_quantity").notNull().default("0"), transmittedQuantity: text("transmitted_quantity").notNull().default("0"), acceptedQuantity: text("accepted_quantity").notNull().default("0"), shipdetQuantity: text("shipdet_quantity").notNull().default("0"), billableQuantity: text("billable_quantity").notNull().default("0"), authorizedPayableQuantity: text("authorized_payable_quantity").notNull().default("0"), employeeAllocatedQuantity: text("employee_allocated_quantity").notNull().default("0"), nonPayableQuantity: text("non_payable_quantity").notNull().default("0"), quantityDifference: text("quantity_difference").notNull().default("0"),
  payableSource: text("payable_source").notNull(), allocationPolicy: text("allocation_policy").notNull(), matchStatus: text("match_status").notNull(), exceptionStatus: text("exception_status").notNull(), resolutionStatus: text("resolution_status").notNull().default("open"), salaryApprovalStatus: text("salary_approval_status").notNull().default("pending"), sourceTraceJson: text("source_trace_json").notNull(), createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().$defaultFn(now),
}, (table) => [index("reconciliation_results_scope").on(table.payrollPeriodId, table.projectId, table.batchKey, table.employeeId, table.workType, table.quantityUnit)]);

export const reconciliationExceptions = sqliteTable("reconciliation_exceptions", {
  id: integer("id").primaryKey({ autoIncrement: true }), reconciliationRunId: integer("reconciliation_run_id").notNull().references(() => reconciliationRuns.id, { onDelete: "cascade" }), payrollPeriodId: integer("payroll_period_id").notNull().references(() => payrollPeriods.id), projectId: integer("project_id").notNull().references(() => projects.id), batchKey: text("batch_key"), employeeIdentifier: text("employee_identifier"), sourceFileId: integer("source_file_id").references(() => sourceFiles.id), exceptionType: text("exception_type").notNull(), severity: text("severity", { enum: ["warning", "blocking"] }).notNull(), explanation: text("explanation").notNull(), recommendedAction: text("recommended_action").notNull(), resolutionStatus: text("resolution_status", { enum: ["open", "resolved"] }).notNull().default("open"), resolutionReason: text("resolution_reason"), resolvedBy: integer("resolved_by").references(() => users.id), resolvedAt: integer("resolved_at", { mode: "timestamp_ms" }), createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().$defaultFn(now),
}, (table) => [index("reconciliation_exceptions_scope").on(table.payrollPeriodId, table.projectId, table.severity, table.resolutionStatus)]);


export const salaryCalculationPolicies = sqliteTable("salary_calculation_policies", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  projectId: integer("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }).unique(),
  roundingScope: text("rounding_scope", { enum: ["per_component", "per_project", "at_total"] }).notNull().default("per_component"),
  decimalPlaces: integer("decimal_places").notNull().default(2),
  updatedBy: integer("updated_by").notNull().references(() => users.id),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull().$defaultFn(now),
});

export const salaryInputs = sqliteTable("salary_inputs", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  payrollPeriodId: integer("payroll_period_id").notNull().references(() => payrollPeriods.id, { onDelete: "cascade" }),
  projectId: integer("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  employeeId: integer("employee_id").notNull().references(() => employees.id),
  averageHours: text("average_hours").notNull(),
  reason: text("reason").notNull(),
  authorizedBy: integer("authorized_by").notNull().references(() => users.id),
  authorizedAt: integer("authorized_at", { mode: "timestamp_ms" }).notNull().$defaultFn(now),
}, (table) => [uniqueIndex("salary_inputs_scope_unique").on(table.payrollPeriodId, table.projectId, table.employeeId), index("salary_inputs_scope").on(table.payrollPeriodId, table.projectId, table.employeeId)]);

export const salaryCalculationRuns = sqliteTable("salary_calculation_runs", {
  id: integer("id").primaryKey({ autoIncrement: true }), runId: text("run_id").notNull().unique(), version: integer("version").notNull(),
  payrollPeriodId: integer("payroll_period_id").notNull().references(() => payrollPeriods.id), projectId: integer("project_id").references(() => projects.id),
  status: text("status", { enum: ["processing", "completed", "blocked"] }).notNull().default("processing"),
  roundingScope: text("rounding_scope", { enum: ["per_component", "per_project", "at_total"] }).notNull(), decimalPlaces: integer("decimal_places").notNull(),
  componentCount: integer("component_count").notNull().default(0), exceptionCount: integer("exception_count").notNull().default(0),
  grossTotal: text("gross_total").notNull().default("0"), adjustmentTotal: text("adjustment_total").notNull().default("0"), finalTotal: text("final_total").notNull().default("0"),
  startedBy: integer("started_by").notNull().references(() => users.id), startedAt: integer("started_at", { mode: "timestamp_ms" }).notNull().$defaultFn(now), completedAt: integer("completed_at", { mode: "timestamp_ms" }),
}, (table) => [uniqueIndex("salary_runs_version_unique").on(table.payrollPeriodId, table.projectId, table.version), index("salary_runs_scope").on(table.payrollPeriodId, table.projectId, table.version, table.status)]);

export const manualAdjustments = sqliteTable("manual_adjustments", {
  id: integer("id").primaryKey({ autoIncrement: true }), payrollPeriodId: integer("payroll_period_id").notNull().references(() => payrollPeriods.id),
  projectId: integer("project_id").notNull().references(() => projects.id), employeeId: integer("employee_id").notNull().references(() => employees.id),
  reconciliationResultId: integer("reconciliation_result_id").references(() => reconciliationResults.id), amount: text("amount").notNull(), reason: text("reason").notNull(),
  status: text("status", { enum: ["approved", "superseded"] }).notNull().default("approved"), authorizedBy: integer("authorized_by").notNull().references(() => users.id),
  authorizedAt: integer("authorized_at", { mode: "timestamp_ms" }).notNull().$defaultFn(now), appliedRunId: integer("applied_run_id").references(() => salaryCalculationRuns.id), createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().$defaultFn(now),
}, (table) => [index("manual_adjustments_scope").on(table.payrollPeriodId, table.projectId, table.employeeId, table.status)]);

export const salaryComponents = sqliteTable("salary_components", {
  id: integer("id").primaryKey({ autoIncrement: true }), salaryRunId: integer("salary_run_id").notNull().references(() => salaryCalculationRuns.id, { onDelete: "cascade" }), calculationVersion: integer("calculation_version").notNull(),
  payrollPeriodId: integer("payroll_period_id").notNull().references(() => payrollPeriods.id), projectId: integer("project_id").notNull().references(() => projects.id), employeeId: integer("employee_id").notNull().references(() => employees.id), reconciliationResultId: integer("reconciliation_result_id").notNull().references(() => reconciliationResults.id),
  country: text("country").notNull(), workType: text("work_type").notNull(), keyType: text("key_type"), categoryCode: text("category_code"), categoryName: text("category_name"), quantityUnit: text("quantity_unit").notNull(), quantitySource: text("quantity_source").notNull(), approvedPayableQuantity: text("approved_payable_quantity").notNull(), appliedRate: text("applied_rate").notNull(), rateRuleId: integer("rate_rule_id").notNull().references(() => rateRules.id), formulaRuleId: text("formula_rule_id").notNull(), allocationMethod: text("allocation_method").notNull(), multiplier: text("multiplier").notNull().default("1"), grossAmount: text("gross_amount").notNull(), approvedAdjustment: text("approved_adjustment").notNull().default("0"), finalAmount: text("final_amount").notNull(), sourceTraceJson: text("source_trace_json").notNull(), calculatedAt: integer("calculated_at", { mode: "timestamp_ms" }).notNull().$defaultFn(now),
}, (table) => [uniqueIndex("salary_components_run_result_unique").on(table.salaryRunId, table.reconciliationResultId), index("salary_components_scope").on(table.payrollPeriodId, table.projectId, table.employeeId, table.workType, table.categoryCode)]);

export const salaryExceptions = sqliteTable("salary_exceptions", {
  id: integer("id").primaryKey({ autoIncrement: true }), salaryRunId: integer("salary_run_id").notNull().references(() => salaryCalculationRuns.id, { onDelete: "cascade" }), payrollPeriodId: integer("payroll_period_id").notNull().references(() => payrollPeriods.id), projectId: integer("project_id").references(() => projects.id), employeeId: integer("employee_id").references(() => employees.id), reconciliationResultId: integer("reconciliation_result_id").references(() => reconciliationResults.id), exceptionType: text("exception_type").notNull(), explanation: text("explanation").notNull(), recommendedAction: text("recommended_action").notNull(), createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().$defaultFn(now),
}, (table) => [index("salary_exceptions_scope").on(table.payrollPeriodId, table.projectId, table.exceptionType)]);

export const masterSalaryRuns = sqliteTable("master_salary_runs", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  runId: text("run_id").notNull().unique(),
  payrollPeriodId: integer("payroll_period_id").notNull().references(() => payrollPeriods.id),
  version: integer("version").notNull(),
  status: text("status", { enum: ["processing", "completed", "blocked"] }).notNull().default("processing"),
  salaryRunIdsJson: text("salary_run_ids_json").notNull(),
  projectCount: integer("project_count").notNull().default(0),
  employeeCount: integer("employee_count").notNull().default(0),
  exceptionCount: integer("exception_count").notNull().default(0),
  grossTotal: text("gross_total").notNull().default("0"),
  bonusTotal: text("bonus_total").notNull().default("0"),
  deductionTotal: text("deduction_total").notNull().default("0"),
  finalTotal: text("final_total").notNull().default("0"),
  generatedBy: integer("generated_by").notNull().references(() => users.id),
  generatedAt: integer("generated_at", { mode: "timestamp_ms" }).notNull().$defaultFn(now),
}, (table) => [uniqueIndex("master_salary_period_version").on(table.payrollPeriodId, table.version), index("master_salary_runs_scope").on(table.payrollPeriodId, table.status, table.version)]);

export const masterSalaryResults = sqliteTable("master_salary_results", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  masterRunId: integer("master_run_id").notNull().references(() => masterSalaryRuns.id, { onDelete: "cascade" }),
  payrollPeriodId: integer("payroll_period_id").notNull().references(() => payrollPeriods.id),
  employeeId: integer("employee_id").notNull().references(() => employees.id),
  projectAmountsJson: text("project_amounts_json").notNull(),
  productionSalary: text("production_salary").notNull().default("0"),
  doctypeSalary: text("doctype_salary").notNull().default("0"),
  proofSalary: text("proof_salary").notNull().default("0"),
  otherComponents: text("other_components").notNull().default("0"),
  bonuses: text("bonuses").notNull().default("0"),
  deductions: text("deductions").notNull().default("0"),
  grossSalary: text("gross_salary").notNull().default("0"),
  finalPayableSalary: text("final_payable_salary").notNull().default("0"),
  reconciliationStatus: text("reconciliation_status", { enum: ["clear", "blocking"] }).notNull().default("clear"),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().$defaultFn(now),
}, (table) => [uniqueIndex("master_salary_employee_unique").on(table.masterRunId, table.employeeId), index("master_salary_results_scope").on(table.payrollPeriodId, table.employeeId)]);

export const masterSalaryExceptions = sqliteTable("master_salary_exceptions", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  masterRunId: integer("master_run_id").notNull().references(() => masterSalaryRuns.id, { onDelete: "cascade" }),
  payrollPeriodId: integer("payroll_period_id").notNull().references(() => payrollPeriods.id),
  projectId: integer("project_id").references(() => projects.id),
  employeeId: integer("employee_id").references(() => employees.id),
  exceptionType: text("exception_type").notNull(),
  explanation: text("explanation").notNull(),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().$defaultFn(now),
}, (table) => [index("master_salary_exceptions_scope").on(table.payrollPeriodId, table.masterRunId, table.exceptionType)]);

export const masterAdjustments = sqliteTable("master_adjustments", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  payrollPeriodId: integer("payroll_period_id").notNull().references(() => payrollPeriods.id),
  employeeId: integer("employee_id").notNull().references(() => employees.id),
  adjustmentType: text("adjustment_type", { enum: ["bonus", "deduction", "other"] }).notNull(),
  amount: text("amount").notNull(),
  reason: text("reason").notNull(),
  status: text("status", { enum: ["approved", "pending_revision", "superseded"] }).notNull().default("approved"),
  authorizedBy: integer("authorized_by").notNull().references(() => users.id),
  authorizedAt: integer("authorized_at", { mode: "timestamp_ms" }).notNull().$defaultFn(now),
  appliedMasterRunId: integer("applied_master_run_id").references(() => masterSalaryRuns.id),
}, (table) => [index("master_adjustments_scope").on(table.payrollPeriodId, table.employeeId, table.status)]);

export const approvalRecords = sqliteTable("approval_records", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  payrollPeriodId: integer("payroll_period_id").notNull().references(() => payrollPeriods.id),
  masterRunId: integer("master_run_id").references(() => masterSalaryRuns.id),
  action: text("action", { enum: ["submitted_for_review", "approved", "returned", "locked", "exported"] }).notNull(),
  fromStatus: text("from_status").notNull(),
  toStatus: text("to_status").notNull(),
  reason: text("reason").notNull(),
  actedBy: integer("acted_by").notNull().references(() => users.id),
  actedAt: integer("acted_at", { mode: "timestamp_ms" }).notNull().$defaultFn(now),
}, (table) => [index("approval_records_scope").on(table.payrollPeriodId, table.actedAt)]);

export const exportJobs = sqliteTable("export_jobs", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  jobId: text("job_id").notNull().unique(),
  payrollPeriodId: integer("payroll_period_id").notNull().references(() => payrollPeriods.id),
  masterRunId: integer("master_run_id").references(() => masterSalaryRuns.id),
  exportType: text("export_type").notNull(),
  status: text("status", { enum: ["queued", "processing", "completed", "failed"] }).notNull().default("queued"),
  progress: integer("progress").notNull().default(0),
  filename: text("filename"),
  blobKey: text("blob_key"),
  rowCount: integer("row_count").notNull().default(0),
  errorMessage: text("error_message"),
  generatedBy: integer("generated_by").notNull().references(() => users.id),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().$defaultFn(now),
  completedAt: integer("completed_at", { mode: "timestamp_ms" }),
}, (table) => [index("export_jobs_scope").on(table.payrollPeriodId, table.status, table.createdAt)]);
