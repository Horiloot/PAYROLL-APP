import { defineAction, z, type ActionsModule, type Ctx } from "@hatch/space-sdk";
import { and, asc, desc, eq, gt, inArray } from "drizzle-orm";
import * as XLSX from "xlsx";
import Decimal from "decimal.js-light";
import * as schema from "./schema";
import { calculateVerifiedKernel } from "./calculation-kernel";

const ROLE_DEFINITIONS = [
  ["Administrator", "administrator"],
  ["Payroll Manager", "payroll-manager"],
  ["Project Manager", "project-manager"],
  ["Data Import Operator", "data-import-operator"],
  ["Reviewer", "reviewer"],
  ["Approver", "approver"],
  ["Read-only Auditor", "read-only-auditor"],
] as const;

const PERMISSIONS = [
  ["dashboard.read", "View dashboard"],
  ["employees.read", "View employees"],
  ["employees.manage", "Manage employees"],
  ["employees.import", "Import employees"],
  ["periods.read", "View payroll periods"],
  ["periods.manage", "Manage payroll periods"],
  ["projects.read", "View projects"],
  ["projects.manage", "Manage projects"],
  ["rates.read", "View rates and rules"],
  ["rates.manage", "Manage rates and rules"],
  ["assignments.read", "View employee assignments"],
  ["assignments.manage", "Manage employee assignments"],
  ["users.manage", "Manage users"],
  ["audit.read", "View audit log"],
  ["imports.read", "View import center and history"],
  ["imports.manage", "Upload, validate, commit, replace, reprocess, and reverse imports"],
  ["production.read", "View and export normalized production data"],
  ["production.manage", "Configure production streams and confirm shipment data"],
  ["reconciliation.read", "View batch mappings, reconciliation results, and exceptions"],
  ["reconciliation.manage", "Manage mappings, payable policies, allocations, and exception resolutions"],
  ["reconciliation.approve", "Approve completed reconciliation runs"],
  ["reconciliation.export", "Export reconciliation and exception workbooks"],
  ["salary.read", "View salary runs, components, and exceptions"],
  ["salary.calculate", "Run versioned salary calculations"],
  ["salary.adjust", "Authorize salary inputs and manual adjustments"],
  ["master.read", "View Master Salary and consolidation reconciliation"],
  ["master.generate", "Generate versioned Master Salary results"],
  ["payroll.review", "Submit payroll for review"],
  ["payroll.approve", "Approve payroll after review"],
  ["payroll.lock", "Lock approved payroll"],
  ["exports.manage", "Generate and download controlled payroll exports"],
] as const;

type PermissionCode = (typeof PERMISSIONS)[number][0];

const ROLE_ACCESS: Record<string, readonly PermissionCode[]> = {
  administrator: PERMISSIONS.map((item) => item[0]),
  "payroll-manager": ["dashboard.read", "employees.read", "employees.manage", "employees.import", "periods.read", "periods.manage", "projects.read", "projects.manage", "rates.read", "rates.manage", "assignments.read", "assignments.manage", "audit.read", "imports.read", "imports.manage", "production.read", "production.manage", "reconciliation.read", "reconciliation.manage", "reconciliation.approve", "reconciliation.export", "salary.read", "salary.calculate", "salary.adjust", "master.read", "master.generate", "payroll.review", "exports.manage"],
  "project-manager": ["dashboard.read", "employees.read", "periods.read", "projects.read", "projects.manage", "rates.read", "rates.manage", "assignments.read", "assignments.manage", "imports.read", "production.read", "production.manage", "reconciliation.read", "reconciliation.manage", "reconciliation.export", "salary.read", "salary.calculate", "master.read"],
  "data-import-operator": ["dashboard.read", "employees.read", "employees.import", "periods.read", "projects.read", "rates.read", "assignments.read", "imports.read", "imports.manage", "production.read", "reconciliation.read"],
  reviewer: ["dashboard.read", "employees.read", "periods.read", "projects.read", "rates.read", "assignments.read", "audit.read", "imports.read", "production.read", "production.manage", "reconciliation.read", "reconciliation.manage", "reconciliation.export", "salary.read", "master.read", "payroll.review", "exports.manage"],
  approver: ["dashboard.read", "employees.read", "periods.read", "periods.manage", "projects.read", "rates.read", "assignments.read", "audit.read", "imports.read", "production.read", "reconciliation.read", "reconciliation.approve", "reconciliation.export", "salary.read", "salary.adjust", "master.read", "payroll.approve", "exports.manage"],
  "read-only-auditor": ["dashboard.read", "employees.read", "periods.read", "projects.read", "rates.read", "assignments.read", "audit.read", "imports.read", "production.read", "reconciliation.read", "reconciliation.export", "salary.read", "master.read"],
};

const authRequest = z.object({ token: z.string().min(20) });
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const optionalText = z.string().trim().max(500).optional().nullable();
const roleSlugSchema = z.enum(["administrator", "payroll-manager", "project-manager", "data-import-operator", "reviewer", "approver", "read-only-auditor"]);

function normalizeId(value: string) {
  return value.trim().toUpperCase().replace(/\s+/g, "");
}

function bytesToHex(bytes: Uint8Array) {
  return Array.from(bytes, (value) => value.toString(16).padStart(2, "0")).join("");
}

function hexToBytes(value: string) {
  const bytes = new Uint8Array(value.length / 2);
  for (let index = 0; index < bytes.length; index += 1) bytes[index] = Number.parseInt(value.slice(index * 2, index * 2 + 2), 16);
  return bytes;
}

async function tokenHash(token: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
  return bytesToHex(new Uint8Array(digest));
}

async function hashPassword(password: string) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const material = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt, iterations: 150000 }, material, 256);
  return `pbkdf2$150000$${bytesToHex(salt)}$${bytesToHex(new Uint8Array(bits))}`;
}

async function verifyPassword(password: string, stored: string) {
  const parts = stored.split("$");
  const iterations = Number(parts[1] ?? 0);
  const saltHex = parts[2] ?? "";
  const expected = parts[3] ?? "";
  if (parts[0] !== "pbkdf2" || !iterations || !saltHex || !expected) return false;
  const material = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt: hexToBytes(saltHex), iterations }, material, 256);
  const actual = bytesToHex(new Uint8Array(bits));
  if (actual.length !== expected.length) return false;
  let difference = 0;
  for (let index = 0; index < actual.length; index += 1) difference |= actual.charCodeAt(index) ^ expected.charCodeAt(index);
  return difference === 0;
}

async function createSession(ctx: Ctx, userId: number) {
  const db = ctx.db<typeof schema>();
  const token = `${crypto.randomUUID()}${crypto.randomUUID()}`;
  const expiresAt = new Date(Date.now() + 12 * 60 * 60 * 1000);
  await db.insert(schema.sessions).values({ userId, tokenHash: await tokenHash(token), expiresAt });
  return { token, expiresAt };
}

async function requireUser(ctx: Ctx, token: string, permission?: PermissionCode) {
  const db = ctx.db<typeof schema>();
  const hashedToken = await tokenHash(token);
  const row = await db
    .select({ userId: schema.users.id, name: schema.users.name, email: schema.users.email, role: schema.roles.slug, roleName: schema.roles.name })
    .from(schema.sessions)
    .innerJoin(schema.users, eq(schema.sessions.userId, schema.users.id))
    .innerJoin(schema.roles, eq(schema.users.roleId, schema.roles.id))
    .where(and(eq(schema.sessions.tokenHash, hashedToken), gt(schema.sessions.expiresAt, new Date()), eq(schema.users.status, "active")))
    .limit(1);
  const user = row[0];
  if (!user) throw new Error("Your session has expired. Sign in again.");
  if (permission && !(ROLE_ACCESS[user.role] ?? []).includes(permission)) {
    throw new Error("You do not have permission to perform this action.");
  }
  return user;
}

async function audit(ctx: Ctx, userId: number, action: string, entityType: string, entityId: string, next?: unknown, previous?: unknown, reason?: string) {
  const db = ctx.db<typeof schema>();
  await db.insert(schema.auditLogs).values({
    userId,
    action,
    entityType,
    entityId,
    previousValue: previous === undefined ? null : JSON.stringify(previous),
    newValue: next === undefined ? null : JSON.stringify(next),
    reason: reason ?? null,
  });
}

async function ensureRoles(ctx: Ctx) {
  const db = ctx.db<typeof schema>();
  for (const [name, slug] of ROLE_DEFINITIONS) {
    await db.insert(schema.roles).values({ name, slug }).onConflictDoNothing();
  }
  for (const [code, label] of PERMISSIONS) {
    await db.insert(schema.permissions).values({ code, label }).onConflictDoNothing();
  }
  const roleRows = await db.select().from(schema.roles);
  const permissionRows = await db.select().from(schema.permissions);
  for (const role of roleRows) {
    const allowed = ROLE_ACCESS[role.slug] ?? [];
    for (const permission of permissionRows) {
      if (allowed.includes(permission.code as PermissionCode)) {
        await db.insert(schema.rolePermissions).values({ roleId: role.id, permissionId: permission.id }).onConflictDoNothing();
      }
    }
  }
}

const sourceTypeSchema = z.enum(["employee_information", "record_details", "doctype", "proof", "transmitted_batch", "shipdet"]);
type SourceType = z.infer<typeof sourceTypeSchema>;

const CANONICAL_FIELDS: Record<SourceType, Array<{ key: string; label: string; type: "text" | "number" | "date"; required: boolean; aliases: string[] }>> = {
  employee_information: [
    { key: "employeeId", label: "Employee ID", type: "text", required: true, aliases: ["employeeid", "emid", "userid", "productionid"] },
    { key: "employeeName", label: "Employee name", type: "text", required: true, aliases: ["employeename", "name", "username"] },
    { key: "previousEmployeeId", label: "Previous Employee ID", type: "text", required: false, aliases: ["previousemployeeid", "oldid", "previousid"] },
    { key: "joiningDate", label: "Joining date", type: "date", required: false, aliases: ["joiningdate", "dateofjoining", "doj"] },
    { key: "designation", label: "Designation", type: "text", required: false, aliases: ["designation", "jobtitle"] },
    { key: "contractType", label: "Contract type", type: "text", required: false, aliases: ["contracttype", "employmenttype"] },
  ],
  record_details: [
    { key: "sourceVariant", label: "Source dataset variant", type: "text", required: false, aliases: ["sourcevariant", "datasetvariant", "sourcetype", "sheetname"] },
    { key: "employeeId", label: "Employee ID", type: "text", required: true, aliases: ["employeeid", "emid", "userid", "productionid"] },
    { key: "employeeName", label: "Employee name", type: "text", required: false, aliases: ["employeename", "username", "name"] },
    { key: "batchId", label: "Internal batch ID", type: "text", required: true, aliases: ["batchid", "batch", "batches", "iimibatch"] },
    { key: "clientBatchId", label: "Client batch ID", type: "text", required: false, aliases: ["clientbatchid", "clientbatch", "clientbatches"] },
    { key: "productionDate", label: "Production date", type: "date", required: false, aliases: ["date", "productiondate", "entrydate"] },
    { key: "country", label: "Country", type: "text", required: false, aliases: ["country", "location"] },
    { key: "entryGroup", label: "Entry group", type: "text", required: false, aliases: ["entrygroup", "group"] },
    { key: "workType", label: "Work type", type: "text", required: false, aliases: ["worktype", "paymentbase"] },
    { key: "keyType", label: "Key type", type: "text", required: false, aliases: ["keytype", "entrytype"] },
    { key: "recordCount", label: "Record count", type: "number", required: false, aliases: ["recordcount", "totalrecord", "records"] },
    { key: "characterCount", label: "Character count", type: "number", required: false, aliases: ["charactercount", "totalchar", "characters", "totalcharacters"] },
    { key: "documentReference", label: "Document reference", type: "text", required: false, aliases: ["documentreference", "documentref", "docid", "imageid"] },
    { key: "reviewKeyIdentifier", label: "Review Key identifier", type: "text", required: false, aliases: ["reviewkeyidentifier", "reviewkeyid"] },
    { key: "fullKeyIdentifier", label: "Full Key identifier", type: "text", required: false, aliases: ["fullkeyidentifier", "fullkeyid"] },
  ],
  doctype: [
    { key: "batchId", label: "Batch ID", type: "text", required: true, aliases: ["batchid", "batch", "batches", "batchname", "clientbatches"] },
    { key: "employeeId", label: "Employee ID", type: "text", required: true, aliases: ["employeeid", "emid", "operatorsemid", "operatoremid"] },
    { key: "documentCount", label: "Document count", type: "number", required: false, aliases: ["documentcount", "documents", "doctypecount"] },
    { key: "imageCount", label: "Image count", type: "number", required: false, aliases: ["imagecount", "images"] },
    { key: "country", label: "Country", type: "text", required: false, aliases: ["country", "location"] },
    { key: "workType", label: "Work type", type: "text", required: false, aliases: ["worktype", "imagetype"] },
    { key: "transmittedStatus", label: "Status", type: "text", required: false, aliases: ["status", "transmissionstatus"] },
  ],
  proof: [
    { key: "batchId", label: "Batch ID", type: "text", required: true, aliases: ["batchid", "batch", "batches"] },
    { key: "proofEmployeeId", label: "Proof Employee ID", type: "text", required: true, aliases: ["proofemployeeid", "proofuser", "proofemid"] },
    { key: "entryEmployeeId", label: "Entry Employee ID", type: "text", required: true, aliases: ["entryemployeeid", "entryuser", "entryemid"] },
    { key: "workType", label: "Proof type", type: "text", required: false, aliases: ["prooftype", "worktype", "entrygroup"] },
    { key: "recordCount", label: "Proof record quantity", type: "number", required: false, aliases: ["recordcount", "records", "proofquantity", "quantity"] },
    { key: "characterCount", label: "Proof character quantity", type: "number", required: false, aliases: ["charactercount", "characters", "totalchar"] },
    { key: "country", label: "Country", type: "text", required: false, aliases: ["country", "location"] },
    { key: "keyType", label: "Key type", type: "text", required: false, aliases: ["keytype"] },
    { key: "adjustment", label: "Positive or negative adjustment", type: "number", required: false, aliases: ["adjustment", "proofadjustment", "positiveadjustment", "negativeadjustment"] },
  ],
  transmitted_batch: [
    { key: "batchId", label: "Internal batch ID", type: "text", required: true, aliases: ["batchid", "batch", "batches", "iimibatch"] },
    { key: "clientBatchId", label: "Client batch ID", type: "text", required: false, aliases: ["clientbatchid", "clientbatch", "clientbatches"] },
    { key: "batchName", label: "Batch name", type: "text", required: false, aliases: ["batchname"] },
    { key: "recordCount", label: "Record or billable record count", type: "number", required: false, aliases: ["billablerecords", "records", "recordcount"] },
    { key: "characterCount", label: "Character or billable character count", type: "number", required: false, aliases: ["billablecharacters", "characters", "charactercount"] },
    { key: "imageCount", label: "Image count", type: "number", required: false, aliases: ["images", "imagecount"] },
    { key: "productionDate", label: "Transmitted date", type: "date", required: false, aliases: ["transmitteddate", "transmissiondate", "date"] },
    { key: "transmittedStatus", label: "Transmission status", type: "text", required: false, aliases: ["transmissionstatus", "status"] },
    { key: "clientAcceptanceStatus", label: "Client acceptance status", type: "text", required: false, aliases: ["clientacceptancestatus", "acceptancestatus", "clientstatus"] },
    { key: "country", label: "Country", type: "text", required: false, aliases: ["country", "location"] },
    { key: "workType", label: "Payment base or work type", type: "text", required: false, aliases: ["paymentbase", "worktype", "imagetype"] },
    { key: "employeeId", label: "Employee ID for batch payment", type: "text", required: false, aliases: ["employeeidforbatchwisepayment", "employeeid", "emid"] },
  ],
  shipdet: [
    { key: "batchId", label: "Internal batch ID", type: "text", required: false, aliases: ["internalbatchid", "iimibatch", "batchid"] },
    { key: "clientBatchId", label: "Client batch ID", type: "text", required: false, aliases: ["clientbatchid", "clientbatch", "clientbatches", "batch"] },
    { key: "shipmentBatchId", label: "Shipment batch ID", type: "text", required: true, aliases: ["shipmentbatchid", "shipmentbatch", "batches"] },
    { key: "clientProjectName", label: "Client project name", type: "text", required: false, aliases: ["clientprojectname", "project"] },
    { key: "recordCount", label: "Record count", type: "number", required: false, aliases: ["records", "recordcount", "total"] },
    { key: "characterCount", label: "Character or keystroke count", type: "number", required: false, aliases: ["totalkeystrokes", "characters", "charactercount"] },
    { key: "imageCount", label: "Image count", type: "number", required: false, aliases: ["images", "imagecount"] },
    { key: "billableQuantity", label: "Billable quantity", type: "number", required: false, aliases: ["billablequantity", "billable", "billablerecords"] },
    { key: "productionDate", label: "Shipment date", type: "date", required: false, aliases: ["shipmentdate", "shipdate", "transmissiondate"] },
    { key: "transmittedStatus", label: "Client acceptance status", type: "text", required: false, aliases: ["clientacceptancestatus", "acceptancestatus", "status"] },
    { key: "country", label: "Country", type: "text", required: false, aliases: ["country", "location"] },
  ],
};

const DEFAULT_BUSINESS_KEYS: Record<SourceType, string[]> = {
  employee_information: ["employeeId"],
  record_details: ["employeeId", "batchId", "productionDate", "keyType"],
  doctype: ["batchId", "employeeId"],
  proof: ["batchId", "proofEmployeeId", "entryEmployeeId", "workType"],
  transmitted_batch: ["batchId"],
  shipdet: ["shipmentBatchId", "productionDate"],
};

function normalizedHeader(value: string) { return value.toLowerCase().replace(/[^a-z0-9]+/g, ""); }
function automaticMapping(sourceType: SourceType, headers: string[]) {
  const normalized = headers.map((header) => ({ header, normalized: normalizedHeader(header) }));
  return Object.fromEntries(CANONICAL_FIELDS[sourceType].map((field) => [field.key, normalized.find((candidate) => field.aliases.includes(candidate.normalized))?.header ?? ""]));
}
function detectDelimiter(text: string, requested: string) {
  if (requested !== "auto") return requested === "tab" ? "\t" : requested;
  const first = text.replace(/^\uFEFF/, "").split(/\r?\n/, 1)[0] ?? "";
  const candidates = [",", ";", "\t", "|"];
  return candidates.sort((a, b) => first.split(b).length - first.split(a).length)[0] ?? ",";
}
function parseDelimited(text: string, delimiter: string) {
  const rows: string[][] = []; let row: string[] = []; let cell = ""; let quoted = false;
  const source = text.replace(/^\uFEFF/, "");
  for (let index = 0; index < source.length; index += 1) {
    const char = source[index] ?? ""; const next = source[index + 1] ?? "";
    if (char === '"' && quoted && next === '"') { cell += '"'; index += 1; }
    else if (char === '"') quoted = !quoted;
    else if (char === delimiter && !quoted) { row.push(cell); cell = ""; }
    else if ((char === "\n" || char === "\r") && !quoted) { if (char === "\r" && next === "\n") index += 1; row.push(cell); rows.push(row); row = []; cell = ""; }
    else cell += char;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows;
}
function parseFileRows(bytes: Uint8Array, filename: string, delimiter: string) {
  const extension = filename.toLowerCase().split(".").pop() ?? "";
  if (extension === "csv") {
    const text = new TextDecoder("utf-8").decode(bytes);
    const resolved = detectDelimiter(text, delimiter);
    return { matrix: parseDelimited(text, resolved), delimiter: resolved, sheetName: null as string | null };
  }
  const workbook = XLSX.read(bytes, { type: "array", raw: false, cellDates: false });
  for (const name of workbook.SheetNames) {
    const sheet = workbook.Sheets[name];
    if (!sheet) continue;
    const matrix = XLSX.utils.sheet_to_json<string[]>(sheet, { header: 1, raw: false, defval: "", blankrows: false });
    if (matrix.some((row) => row.some((cell) => String(cell).trim()))) return { matrix: matrix.map((row) => row.map((cell) => String(cell))), delimiter: "workbook", sheetName: name };
  }
  return { matrix: [] as string[][], delimiter: "workbook", sheetName: null as string | null };
}
function normalizeNumber(value: string) {
  const clean = value.trim().replace(/,/g, "");
  if (!clean) return null;
  const number = Number(clean);
  if (!Number.isFinite(number)) return undefined;
  return String(number);
}
function normalizeImportedDate(value: string) {
  const clean = value.trim();
  if (!clean) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(clean)) return clean;
  const numeric = Number(clean);
  if (Number.isFinite(numeric) && numeric > 20000 && numeric < 80000) {
    const date = new Date(Date.UTC(1899, 11, 30) + numeric * 86400000);
    return date.toISOString().slice(0, 10);
  }
  const match = clean.match(/^(\d{1,2})[\/-](\d{1,2})[\/-](\d{2}|\d{4})$/);
  if (match) {
    const day = Number(match[1] ?? 0); const month = Number(match[2] ?? 0); let year = Number(match[3] ?? 0); if (year < 100) year += 2000;
    const date = new Date(Date.UTC(year, month - 1, day));
    if (date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day) return date.toISOString().slice(0, 10);
  }
  return undefined;
}
function decodeJsonRecord(value: string) {
  const parsed: unknown = JSON.parse(value);
  return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, string> : {};
}
function validateAndNormalize(sourceType: SourceType, raw: Record<string, string>, mapping: Record<string, string>) {
  const normalized: Record<string, string | null> = {}; const errors: string[] = [];
  for (const field of CANONICAL_FIELDS[sourceType]) {
    const sourceHeader = mapping[field.key] ?? "";
    const rawValue = sourceHeader ? String(raw[sourceHeader] ?? "").trim() : "";
    if (field.required && !rawValue) errors.push(`${field.label} is required.`);
    if (field.type === "number") {
      const value = normalizeNumber(rawValue);
      if (value === undefined) errors.push(`${field.label} must be a valid number.`); else normalized[field.key] = value;
    } else if (field.type === "date") {
      const value = normalizeImportedDate(rawValue);
      if (value === undefined) errors.push(`${field.label} must be a valid date.`); else normalized[field.key] = value;
    } else normalized[field.key] = rawValue || null;
  }
  for (const [header, value] of Object.entries(raw)) if (!Object.values(mapping).includes(header)) normalized[`source:${header}`] = String(value).trim() || null;
  return { normalized, errors };
}
function businessKeyFor(normalized: Record<string, string | null>, keys: string[]) {
  return keys.map((key) => String(normalized[key] ?? "").trim().toUpperCase()).join("|");
}
async function refreshImportCounts(ctx: Ctx, importBatchId: number) {
  const db = ctx.db<typeof schema>();
  const [files, rows] = await Promise.all([db.select().from(schema.sourceFiles).where(eq(schema.sourceFiles.importBatchId, importBatchId)), db.select().from(schema.importRows).where(eq(schema.importRows.importBatchId, importBatchId))]);
  const totalRows = rows.length; const validRows = rows.filter((row) => row.validationStatus === "valid").length; const rejectedRows = rows.filter((row) => row.validationStatus === "rejected").length; const duplicateRows = rows.filter((row) => row.validationStatus === "duplicate").length;
  await db.update(schema.importBatches).set({ processedFiles: files.filter((file) => ["ready", "committed", "reversed"].includes(file.status)).length, totalRows, validRows, rejectedRows, duplicateRows, updatedAt: new Date() }).where(eq(schema.importBatches.id, importBatchId));
  return { totalRows, validRows, rejectedRows, duplicateRows };
}
function safeCsvCell(value: unknown) {
  let text = String(value ?? "");
  if (/^[=+\-@]/.test(text)) text = `'${text}`;
  return `"${text.replace(/"/g, '""')}"`;
}

function parseStringArray(value: string | null | undefined) {
  try { const parsed: unknown = JSON.parse(value ?? "[]"); return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : []; } catch { return []; }
}
function parseStatusMappings(value: string | null | undefined) {
  try {
    const parsed: unknown = JSON.parse(value ?? "{}");
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {} as Record<string, string>;
    return Object.fromEntries(Object.entries(parsed).filter((entry): entry is [string, string] => typeof entry[1] === "string").map(([key, mapped]) => [key.trim().toLowerCase(), mapped.trim().toLowerCase()]));
  } catch { return {} as Record<string, string>; }
}
function normalizeConfiguredStatus(raw: string | null | undefined, mappings: Record<string, string>, kind: "transmission" | "acceptance") {
  const key = String(raw ?? "").trim().toLowerCase();
  if (!key) return "unknown";
  const mapped = mappings[`${kind}:${key}`] ?? mappings[key] ?? key.replace(/[\s-]+/g, "_");
  const allowed = kind === "transmission" ? ["transmitted", "not_transmitted"] : ["accepted", "rejected", "pending"];
  return allowed.includes(mapped) ? mapped : "unknown";
}
function recordVariant(value: string | null | undefined, filename: string, keyType: string | null | undefined) {
  const basis = `${value ?? ""} ${filename} ${keyType ?? ""}`.toLowerCase();
  if (basis.includes("review")) return "review_key";
  if (basis.includes("full")) return "full_key";
  return "record_details";
}
function categoryRows(normalized: Record<string, string | null>) {
  const rows: Array<{ code: string; name: string; unit: "record" | "character"; quantity: string; sourceColumn: string }> = [];
  for (const [key, value] of Object.entries(normalized)) {
    if (!key.startsWith("source:") || value === null || normalizeNumber(value) === undefined || normalizeNumber(value) === null) continue;
    const sourceColumn = key.slice(7).trim();
    const match = sourceColumn.match(/^(.+?)(?:\s+|_)?(record|records|char|chars|character|characters|quantity)$/i);
    if (!match) continue;
    const name = String(match[1] ?? "").trim();
    if (!name || /^(total|billable|proof)$/i.test(name)) continue;
    const unit = /record/i.test(String(match[2] ?? "")) ? "record" as const : "character" as const;
    const code = normalizeId(name).replace(/[^A-Z0-9]+/g, "-");
    rows.push({ code, name, unit, quantity: normalizeNumber(value) ?? "0", sourceColumn });
  }
  return rows;
}
async function resolveEmployee(ctx: Ctx, identifier: string | null | undefined) {
  const clean = identifier ? normalizeId(identifier) : "";
  if (!clean) return null;
  const db = ctx.db<typeof schema>();
  const direct = await db.select({ id: schema.employees.id }).from(schema.employees).where(eq(schema.employees.employeeId, clean)).limit(1);
  if (direct[0]) return direct[0].id;
  const mapped = await db.select({ employeeId: schema.employeeIdMappings.employeeId }).from(schema.employeeIdMappings).where(eq(schema.employeeIdMappings.previousEmployeeId, clean)).limit(1);
  return mapped[0]?.employeeId ?? null;
}
async function addProductionException(ctx: Ctx, input: { payrollPeriodId: number; projectId: number; sourceFileId?: number; importBatchId?: number; stream: string; sourceRowNumber?: number; severity: "warning" | "blocking"; code: string; employeeIdentifier?: string | null; batchIdentifier?: string | null; explanation: string; recommendedAction: string }) {
  const db = ctx.db<typeof schema>();
  await db.insert(schema.productionExceptions).values({ payrollPeriodId: input.payrollPeriodId, projectId: input.projectId, sourceFileId: input.sourceFileId ?? null, importBatchId: input.importBatchId ?? null, stream: input.stream, sourceRowNumber: input.sourceRowNumber ?? null, severity: input.severity, code: input.code, employeeIdentifier: input.employeeIdentifier ?? null, batchIdentifier: input.batchIdentifier ?? null, explanation: input.explanation, recommendedAction: input.recommendedAction });
}
async function getProductionConfig(ctx: Ctx, projectId: number) {
  const db = ctx.db<typeof schema>();
  const rows = await db.select().from(schema.projectProductionConfigurations).where(eq(schema.projectProductionConfigurations.projectId, projectId)).limit(1);
  const row = rows[0];
  return { doctypeEnabled: row?.doctypeEnabled ?? false, proofEnabled: row?.proofEnabled ?? false, allowKeyVariantDoubleCount: row?.allowKeyVariantDoubleCount ?? false, proofTypes: parseStringArray(row?.proofTypesJson), statusMappings: parseStatusMappings(row?.statusMappingsJson) };
}
async function persistProductionRow(ctx: Ctx, batch: typeof schema.importBatches.$inferSelect, row: typeof schema.importRows.$inferSelect) {
  if (!row.normalizedPayload || !row.businessKey) return;
  const db = ctx.db<typeof schema>(); const n = JSON.parse(row.normalizedPayload) as Record<string, string | null>;
  const files = await db.select().from(schema.sourceFiles).where(eq(schema.sourceFiles.id, row.sourceFileId)).limit(1); const file = files[0];
  if (!file) throw new Error("The source file for a normalized row is unavailable.");
  const base = { importRowId: row.id, importBatchId: batch.id, sourceFileId: row.sourceFileId, payrollPeriodId: batch.payrollPeriodId, projectId: batch.projectId, sourceRowNumber: row.sourceRowNumber, originalSourcePayload: row.rawPayload, active: false };
  const config = await getProductionConfig(ctx, batch.projectId);
  if (batch.sourceType === "record_details") {
    const employeeIdentifier = n.employeeId ? normalizeId(n.employeeId) : null; const employeeRecordId = await resolveEmployee(ctx, employeeIdentifier);
    if (employeeIdentifier && !employeeRecordId) await addProductionException(ctx, { ...base, stream: "record_details", severity: "blocking", code: "UNMATCHED_EMPLOYEE", employeeIdentifier, batchIdentifier: n.batchId, explanation: `Employee ID ${employeeIdentifier} could not be matched to the Employee Master or ID history.`, recommendedAction: "Create or map the employee ID, then reprocess this import." });
    const variant = recordVariant(n.sourceVariant, file.originalFilename, n.keyType);
    let payableState: "eligible" | "blocked_overlap" = "eligible";
    if (!config.allowKeyVariantDoubleCount && (variant === "review_key" || variant === "full_key")) {
      const existing = await db.select().from(schema.recordDetails).where(and(eq(schema.recordDetails.payrollPeriodId, batch.payrollPeriodId), eq(schema.recordDetails.projectId, batch.projectId), eq(schema.recordDetails.active, true)));
      const overlap = existing.find((candidate) => candidate.sourceVariant !== variant && [candidate.internalBatchId ?? "", candidate.employeeIdentifier ?? "", candidate.productionDate ?? "", candidate.documentReference ?? ""].join("|") === [n.batchId ?? "", employeeIdentifier ?? "", n.productionDate ?? "", n.documentReference ?? ""].join("|"));
      if (overlap) { payableState = "blocked_overlap"; await addProductionException(ctx, { ...base, stream: "record_details", severity: "blocking", code: "KEY_VARIANT_OVERLAP", employeeIdentifier, batchIdentifier: n.batchId, explanation: "A Review Key and Full Key row share the configured payable identity. The later row is blocked from payable use.", recommendedAction: "Review the business key or explicitly enable both key variants for this project." }); }
    }
    const inserted = await db.insert(schema.recordDetails).values({ ...base, sourceVariant: variant, internalBatchId: n.batchId ?? null, clientBatchId: n.clientBatchId ?? null, employeeRecordId, employeeIdentifier, employeeName: n.employeeName ?? null, productionDate: n.productionDate ?? null, country: n.country?.toUpperCase() ?? null, entryGroup: n.entryGroup ?? null, workType: n.workType ?? null, keyType: n.keyType ?? (variant === "review_key" ? "Review Key" : variant === "full_key" ? "Full Key" : null), recordCount: n.recordCount ?? null, characterCount: n.characterCount ?? null, documentReference: n.documentReference ?? null, reviewKeyIdentifier: n.reviewKeyIdentifier ?? null, fullKeyIdentifier: n.fullKeyIdentifier ?? null, businessKey: row.businessKey, payableState }).onConflictDoNothing().returning({ id: schema.recordDetails.id });
    const record = inserted[0]; if (record) for (const item of categoryRows(n)) await db.insert(schema.recordCategoryQuantities).values({ recordDetailId: record.id, categoryCode: item.code, categoryName: item.name, quantityUnit: item.unit, quantity: item.quantity, sourceColumn: item.sourceColumn }).onConflictDoNothing();
  } else if (batch.sourceType === "doctype") {
    if (!config.doctypeEnabled) throw new Error("Doctype is disabled for this project. Enable it in Production Data configuration before committing this import.");
    const employeeIdentifier = n.employeeId ? normalizeId(n.employeeId) : null; const employeeRecordId = await resolveEmployee(ctx, employeeIdentifier);
    if (!employeeRecordId) await addProductionException(ctx, { ...base, stream: "doctype", severity: "blocking", code: "UNMATCHED_EMPLOYEE", employeeIdentifier, batchIdentifier: n.batchId, explanation: "The Doctype employee could not be matched to the Employee Master or ID history.", recommendedAction: "Create or map the employee ID, then reprocess this import." });
    if (!n.documentCount && !n.imageCount) await addProductionException(ctx, { ...base, stream: "doctype", severity: "blocking", code: "MISSING_QUANTITY", employeeIdentifier, batchIdentifier: n.batchId, explanation: "The Doctype row has neither a document count nor an image count.", recommendedAction: "Correct the source mapping and reprocess the import." });
    await db.insert(schema.doctypeRecords).values({ ...base, batchId: n.batchId ?? null, employeeRecordId, employeeIdentifier, documentCount: n.documentCount ?? null, imageCount: n.imageCount ?? null, workType: n.workType ?? null, country: n.country?.toUpperCase() ?? null, status: n.transmittedStatus ?? null }).onConflictDoNothing();
  } else if (batch.sourceType === "proof") {
    if (!config.proofEnabled) throw new Error("Proof is disabled for this project. Enable it in Production Data configuration before committing this import.");
    const entryIdentifier = n.entryEmployeeId ? normalizeId(n.entryEmployeeId) : null; const proofIdentifier = n.proofEmployeeId ? normalizeId(n.proofEmployeeId) : null;
    const entryEmployeeRecordId = await resolveEmployee(ctx, entryIdentifier); const proofEmployeeRecordId = await resolveEmployee(ctx, proofIdentifier);
    if (!entryEmployeeRecordId) await addProductionException(ctx, { ...base, stream: "proof", severity: "blocking", code: "UNMATCHED_ENTRY_EMPLOYEE", employeeIdentifier: entryIdentifier, batchIdentifier: n.batchId, explanation: "The entry employee for this Proof row is unknown.", recommendedAction: "Create or map the entry employee ID; do not substitute the proof performer." });
    if (!proofEmployeeRecordId) await addProductionException(ctx, { ...base, stream: "proof", severity: "blocking", code: "UNMATCHED_PROOF_EMPLOYEE", employeeIdentifier: proofIdentifier, batchIdentifier: n.batchId, explanation: "The proof employee for this row is unknown.", recommendedAction: "Create or map the proof employee ID; do not copy the entry employee." });
    if (n.workType && config.proofTypes.length && !config.proofTypes.some((item) => item.toLowerCase() === n.workType?.toLowerCase())) await addProductionException(ctx, { ...base, stream: "proof", severity: "blocking", code: "UNKNOWN_PROOF_TYPE", employeeIdentifier: proofIdentifier, batchIdentifier: n.batchId, explanation: `Proof type ${n.workType} is not configured for this project.`, recommendedAction: "Add the proof type to project configuration or correct the source mapping." });
    await db.insert(schema.proofRecords).values({ ...base, batchId: n.batchId ?? null, entryEmployeeRecordId, entryEmployeeIdentifier: entryIdentifier, proofEmployeeRecordId, proofEmployeeIdentifier: proofIdentifier, proofType: n.workType ?? null, recordQuantity: n.recordCount ?? null, characterQuantity: n.characterCount ?? null, country: n.country?.toUpperCase() ?? null, keyType: n.keyType ?? null, adjustment: n.adjustment ?? "0" }).onConflictDoNothing();
  } else if (batch.sourceType === "transmitted_batch") {
    const transmission = normalizeConfiguredStatus(n.transmittedStatus, config.statusMappings, "transmission"); const acceptance = normalizeConfiguredStatus(n.clientAcceptanceStatus, config.statusMappings, "acceptance");
    if (transmission === "unknown") await addProductionException(ctx, { ...base, stream: "transmitted_batch", severity: "blocking", code: "UNKNOWN_TRANSMISSION_STATUS", batchIdentifier: n.batchId, explanation: n.transmittedStatus ? `Transmission status ${n.transmittedStatus} has no approved mapping.` : "Transmission status is blank; blank is never treated as transmitted.", recommendedAction: "Add an explicit project status mapping or correct the source value." });
    await db.insert(schema.transmittedBatches).values({ ...base, internalBatchId: n.batchId ?? null, clientBatchId: n.clientBatchId ?? null, batchName: n.batchName ?? null, country: n.country?.toUpperCase() ?? null, recordCount: n.recordCount ?? null, characterCount: n.characterCount ?? null, imageCount: n.imageCount ?? null, transmittedDate: n.productionDate ?? null, transmissionStatusRaw: n.transmittedStatus ?? null, transmissionStatus: transmission, clientAcceptanceStatusRaw: n.clientAcceptanceStatus ?? null, clientAcceptanceStatus: acceptance, workType: n.workType ?? null }).onConflictDoNothing();
  } else if (batch.sourceType === "shipdet") {
    const acceptance = normalizeConfiguredStatus(n.transmittedStatus, config.statusMappings, "acceptance");
    const inserted = await db.insert(schema.shipdetBatches).values({ ...base, clientProjectName: n.clientProjectName ?? null, internalBatchId: n.batchId ?? null, clientBatchId: n.clientBatchId ?? null, shipmentBatchId: n.shipmentBatchId ?? null, shipmentDate: n.productionDate ?? null, recordCount: n.recordCount ?? null, characterCount: n.characterCount ?? null, imageCount: n.imageCount ?? null, billableQuantity: n.billableQuantity ?? null, acceptanceStatus: acceptance, normalizedFieldsJson: row.normalizedPayload }).onConflictDoNothing().returning({ id: schema.shipdetBatches.id });
    const shipdet = inserted[0]; if (shipdet) for (const item of categoryRows(n)) await db.insert(schema.shipdetCategoryQuantities).values({ shipdetBatchId: shipdet.id, categoryCode: item.code, categoryName: item.name, quantity: item.quantity, sourceColumn: item.sourceColumn }).onConflictDoNothing();
  }
}

type QuantityUnit = "record" | "character" | "image" | "document";
type PayableSource = "produced" | "confirmed_shipped" | "client_billable" | "accepted_transmitted";
type AllocationPolicy = "direct_employee" | "record_attribution" | "category_proportional" | "manual";

function batchKey(value: string | null | undefined) { return String(value ?? "").trim(); }
function quantity(value: string | null | undefined) { const parsed = Number(String(value ?? "0").replace(/,/g, "")); return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0; }
function quantityText(value: number) { return Number.isInteger(value) ? String(value) : value.toFixed(6).replace(/0+$/, "").replace(/\.$/, ""); }
function policyKey(workType: string, unit: QuantityUnit) { return `${workType.trim().toLowerCase()}|${unit}`; }
function dimensionKey(batch: string, workType: string, category: string | null, unit: QuantityUnit) { return `${batch}|${workType.trim().toLowerCase()}|${category ?? ""}|${unit}`; }
function largestRemainder(cap: number, contributions: Array<{ key: string; value: number }>) {
  const integerCap = Math.max(0, Math.floor(cap)); const total = contributions.reduce((sum, item) => sum + item.value, 0);
  if (!total || !integerCap) return Object.fromEntries(contributions.map((item) => [item.key, 0]));
  const shares = contributions.map((item) => { const exact = integerCap * item.value / total; return { ...item, floor: Math.floor(exact), remainder: exact - Math.floor(exact) }; });
  let left = integerCap - shares.reduce((sum, item) => sum + item.floor, 0);
  shares.sort((a, b) => b.remainder - a.remainder || a.key.localeCompare(b.key));
  for (const item of shares) { if (left <= 0) break; item.floor += 1; left -= 1; }
  return Object.fromEntries(shares.map((item) => [item.key, item.floor]));
}
function distinctNonEmpty(values: Array<string | null | undefined>) { return [...new Set(values.map(batchKey).filter(Boolean))]; }

const employeeInput = z.object({
  employeeId: z.string().trim().min(1).max(80),
  name: z.string().trim().min(1).max(200),
  previousIds: z.array(z.string().trim().min(1).max(80)).max(20).default([]),
  joiningDate: isoDate.optional().nullable(),
  status: z.enum(["active", "inactive", "leave", "separated"]).default("active"),
  designation: optionalText,
  contractType: optionalText,
  team: optionalText,
  location: optionalText,
});

const projectInput = z.object({
  id: z.number().int().positive().optional(),
  projectId: z.string().trim().min(1).max(80),
  name: z.string().trim().min(1).max(180),
  mainProjectId: optionalText,
  client: optionalText,
  description: optionalText,
  startDate: isoDate.optional().nullable(),
  endDate: isoDate.optional().nullable(),
  status: z.enum(["active", "inactive", "archived"]).default("active"),
  currency: z.string().trim().min(3).max(8),
  manager: optionalText,
  notes: optionalText,
});

type SalaryActor = { userId: number; name: string };
type SalaryRunResult = { runId: string; version: number; status: "completed" | "blocked"; componentCount: number; exceptionCount: number; finalTotal: string };

function money(value: Decimal, places: number) { return value.toDecimalPlaces(places).toFixed(places); }
function precise(value: Decimal) { return value.toDecimalPlaces(6).toString(); }
function safeSpreadsheetValue(value: unknown) {
  if (typeof value !== "string") return value;
  const trimmed = value.trimStart();
  return /^[=+\-@]/.test(trimmed) ? `'${value}` : value;
}
function safeSheetName(value: string) {
  const clean = value.replace(/[\\/?*\[\]:]/g, " ").replace(/\s+/g, " ").trim() || "Report";
  return clean.slice(0, 31);
}
function makeReportSheet(metadata: Array<[string, string]>, headers: string[], rows: unknown[][], numericColumns: number[] = []) {
  const safeRows = rows.map((row) => row.map(safeSpreadsheetValue));
  const worksheet = XLSX.utils.aoa_to_sheet([...metadata, [], headers, ...safeRows]);
  const headerRow = metadata.length + 2;
  worksheet["!freeze"] = { xSplit: 0, ySplit: headerRow };
  worksheet["!autofilter"] = { ref: `A${headerRow}:${XLSX.utils.encode_col(Math.max(0, headers.length - 1))}${headerRow + Math.max(1, rows.length)}` };
  worksheet["!cols"] = headers.map((header) => ({ wch: Math.min(34, Math.max(12, header.length + 2)) }));
  for (let rowIndex = headerRow; rowIndex < headerRow + rows.length; rowIndex += 1) for (const column of numericColumns) {
    const cell = worksheet[XLSX.utils.encode_cell({ r: rowIndex, c: column })];
    if (cell && typeof cell.v === "number") cell.z = "#,##0.00";
  }
  return worksheet;
}

async function executeSalaryCalculation(ctx: Ctx, actor: SalaryActor, payrollPeriodId: number, projectId: number): Promise<SalaryRunResult> {
  const db = ctx.db<typeof schema>();
  const [period] = await db.select().from(schema.payrollPeriods).where(eq(schema.payrollPeriods.id, payrollPeriodId)).limit(1);
  const [project] = await db.select().from(schema.projects).where(eq(schema.projects.id, projectId)).limit(1);
  if (!period || !project) throw new Error("Select a valid payroll period and project.");
  if (["Approved", "Locked", "Exported"].includes(period.status)) throw new Error("This payroll period is protected. Create a controlled revision instead of recalculating it.");
  const activeProject = (await db.select().from(schema.projectPeriodConfigurations).where(and(eq(schema.projectPeriodConfigurations.payrollPeriodId, payrollPeriodId), eq(schema.projectPeriodConfigurations.projectId, projectId), eq(schema.projectPeriodConfigurations.active, true))).limit(1))[0];
  if (!activeProject) throw new Error("The project is not active for this payroll period.");
  const processing = await db.select().from(schema.salaryCalculationRuns).where(and(eq(schema.salaryCalculationRuns.payrollPeriodId, payrollPeriodId), eq(schema.salaryCalculationRuns.projectId, projectId), eq(schema.salaryCalculationRuns.status, "processing"))).limit(1);
  if (processing[0]) throw new Error("A salary calculation is already running for this period and project.");
  const reconRun = (await db.select().from(schema.reconciliationRuns).where(and(eq(schema.reconciliationRuns.payrollPeriodId, payrollPeriodId), eq(schema.reconciliationRuns.projectId, projectId), eq(schema.reconciliationRuns.status, "approved"))).orderBy(desc(schema.reconciliationRuns.id)).limit(1))[0];
  if (!reconRun) throw new Error("Approve a completed reconciliation run before calculating salary.");
  const approvedRows = await db.select().from(schema.reconciliationResults).where(and(eq(schema.reconciliationResults.reconciliationRunId, reconRun.id), eq(schema.reconciliationResults.salaryApprovalStatus, "approved_for_salary")));
  if (!approvedRows.length) throw new Error("The approved reconciliation run has no salary-approved quantities.");
  const priorRuns = await db.select().from(schema.salaryCalculationRuns).where(and(eq(schema.salaryCalculationRuns.payrollPeriodId, payrollPeriodId), eq(schema.salaryCalculationRuns.projectId, projectId))).orderBy(desc(schema.salaryCalculationRuns.version)).limit(1);
  const version = (priorRuns[0]?.version ?? 0) + 1; const runId = `SAL-${payrollPeriodId}-${projectId}-V${version}-${Date.now().toString(36).toUpperCase()}`;
  const policy = (await db.select().from(schema.salaryCalculationPolicies).where(eq(schema.salaryCalculationPolicies.projectId, projectId)).limit(1))[0];
  const roundingScope = policy?.roundingScope ?? "per_component"; const decimalPlaces = policy?.decimalPlaces ?? 2;
  const insertedRun = (await db.insert(schema.salaryCalculationRuns).values({ runId, version, payrollPeriodId, projectId, status: "processing", roundingScope, decimalPlaces, startedBy: actor.userId }).returning())[0];
  if (!insertedRun) throw new Error("The salary run could not be created.");
  const [workTypes, categories, rates, assignments, inputs, adjustments] = await Promise.all([
    db.select().from(schema.workTypes).where(and(eq(schema.workTypes.projectId, projectId), eq(schema.workTypes.status, "active"))),
    db.select().from(schema.characterCategories).where(and(eq(schema.characterCategories.projectId, projectId), eq(schema.characterCategories.status, "active"))),
    db.select().from(schema.rateRules).where(and(eq(schema.rateRules.projectId, projectId), eq(schema.rateRules.status, "active"))),
    db.select().from(schema.employeeProjectAssignments).where(and(eq(schema.employeeProjectAssignments.projectId, projectId), eq(schema.employeeProjectAssignments.status, "active"))),
    db.select().from(schema.salaryInputs).where(and(eq(schema.salaryInputs.payrollPeriodId, payrollPeriodId), eq(schema.salaryInputs.projectId, projectId))),
    db.select().from(schema.manualAdjustments).where(and(eq(schema.manualAdjustments.payrollPeriodId, payrollPeriodId), eq(schema.manualAdjustments.projectId, projectId), eq(schema.manualAdjustments.status, "approved"))),
  ]);
  const exceptions: Array<typeof schema.salaryExceptions.$inferInsert> = []; const components: Array<typeof schema.salaryComponents.$inferInsert> = [];
  const addException = (row: typeof approvedRows[number], type: string, explanation: string, action: string) => exceptions.push({ salaryRunId: insertedRun.id, payrollPeriodId, projectId, employeeId: row.employeeId, reconciliationResultId: row.id, exceptionType: type, explanation, recommendedAction: action });
  for (const row of approvedRows) {
    if (!row.employeeId) { addException(row, "MISSING_EMPLOYEE", "The approved payable quantity has no employee identity.", "Resolve employee attribution and approve a new reconciliation run."); continue; }
    if (!assignments.some((item) => item.employeeId === row.employeeId && (!item.payrollPeriodId || item.payrollPeriodId === payrollPeriodId) && item.startDate <= period.endDate && (!item.endDate || item.endDate >= period.startDate))) { addException(row, "MISSING_ASSIGNMENT", "The employee is not actively assigned to this project for the payroll period.", "Add an approved employee-project assignment covering this period."); continue; }
    if (!row.country) { addException(row, "MISSING_COUNTRY", "The payable quantity has no approved country.", "Correct the normalized country and rerun reconciliation."); continue; }
    const workType = workTypes.find((item) => item.code.toLowerCase() === row.workType.toLowerCase());
    if (!workType) { addException(row, "MISSING_WORK_TYPE", `No active work type matches ${row.workType}.`, "Configure the project work type with the same code."); continue; }
    const expectedUnit = workType.unit === "fixed" || workType.unit === "batch" ? row.quantityUnit : workType.unit === "image" && row.quantityUnit === "document" ? "document" : workType.unit;
    if (expectedUnit !== row.quantityUnit) { addException(row, "UNIT_MISMATCH", `Payable unit ${row.quantityUnit} does not match the configured ${workType.unit} rate basis.`, "Correct the payable policy or work-type unit; units are never converted implicitly."); continue; }
    const category = row.categoryCode ? categories.find((item) => item.code.toLowerCase() === row.categoryCode?.toLowerCase()) : undefined;
    if (row.categoryCode && !category) { addException(row, "MISSING_CATEGORY", `No active category matches ${row.categoryCode}.`, "Configure the category or correct source mapping."); continue; }
    const eligible = rates.filter((rate) => rate.workTypeId === workType.id && rate.countryCode.toLowerCase() === row.country?.toLowerCase() && (row.categoryCode ? rate.categoryId === category?.id : rate.categoryId === null) && rate.effectiveFrom <= period.endDate && (!rate.effectiveTo || rate.effectiveTo >= period.startDate));
    if (!eligible.length) { addException(row, "MISSING_RATE", `No effective ${row.country} rate matches ${row.workType}${row.categoryCode ? ` / ${row.categoryCode}` : ""}.`, "Create an effective-dated rate with the matching country, work type, category, and unit."); continue; }
    const highest = Math.min(...eligible.map((rate) => rate.priority)); const matching = eligible.filter((rate) => rate.priority === highest);
    if (matching.length !== 1) { addException(row, "AMBIGUOUS_RATE", `${matching.length} effective rate rules share priority ${highest} for this payable quantity.`, "Supersede or deactivate overlapping rate rules so one rule wins."); continue; }
    const rate = matching[0]; if (!rate) continue;
    let unitRate: Decimal; let payable: Decimal; try { unitRate = new Decimal(rate.unitRate); payable = new Decimal(row.employeeAllocatedQuantity); } catch { addException(row, "INVALID_RATE", "The applied rate or payable quantity is not a valid decimal.", "Correct the configured rate or reconciliation quantity."); continue; }
    if (unitRate.isNegative() || payable.isNegative()) { addException(row, "NEGATIVE_VALUE", "Negative rates or payable quantities are not authorized.", "Use a separately authorized adjustment for deductions; correct the rate or quantity."); continue; }
    if (payable.isZero()) continue;
    let multiplier = new Decimal(1); let gross = rate.ruleType === "fixed" ? unitRate : payable.times(unitRate);
    if (rate.ruleType === "slab") {
      if (!rate.thresholdLow || !rate.thresholdHigh || !rate.multiplierLow || !rate.multiplierMid || !rate.multiplierHigh) { addException(row, "INCOMPLETE_SLAB", `Slab rule #${rate.id} is incomplete.`, "Configure both thresholds and all three multipliers."); continue; }
      const input = inputs.find((item) => item.employeeId === row.employeeId); if (!input) { addException(row, "MISSING_AVERAGE_HOURS", "This slab rule requires authorized average working hours for the employee.", "Enter average hours with an authorization reason, then calculate again."); continue; }
      try { const result = calculateVerifiedKernel([{ quantity: row.employeeAllocatedQuantity, rate: rate.unitRate }], input.averageHours, { thresholdLow: rate.thresholdLow, thresholdHigh: rate.thresholdHigh, multiplierLow: rate.multiplierLow, multiplierMid: rate.multiplierMid, multiplierHigh: rate.multiplierHigh }); multiplier = new Decimal(result.multiplier); gross = new Decimal(result.payableAmount); } catch { addException(row, "INVALID_SLAB", `Slab rule #${rate.id} contains invalid decimal values.`, "Correct the slab thresholds, multipliers, rate, or average-hours input."); continue; }
    }
    const related = adjustments.filter((item) => item.employeeId === row.employeeId && item.reconciliationResultId === row.id); const adjustment = related.reduce((sum, item) => sum.plus(item.amount), new Decimal(0));
    const storedGross = roundingScope === "per_component" ? new Decimal(money(gross, decimalPlaces)) : new Decimal(precise(gross)); const final = storedGross.plus(adjustment);
    components.push({ salaryRunId: insertedRun.id, calculationVersion: version, payrollPeriodId, projectId, employeeId: row.employeeId, reconciliationResultId: row.id, country: row.country, workType: row.workType, keyType: null, categoryCode: row.categoryCode, categoryName: row.categoryName, quantityUnit: row.quantityUnit, quantitySource: row.payableSource, approvedPayableQuantity: row.employeeAllocatedQuantity, appliedRate: rate.unitRate, rateRuleId: rate.id, formulaRuleId: `${rate.ruleType}:${rate.id}`, allocationMethod: row.allocationPolicy, multiplier: multiplier.toString(), grossAmount: precise(storedGross), approvedAdjustment: precise(adjustment), finalAmount: precise(final), sourceTraceJson: row.sourceTraceJson });
  }
  for (const item of exceptions) await db.insert(schema.salaryExceptions).values(item);
  for (const item of components) await db.insert(schema.salaryComponents).values(item);
  const grossRaw = components.reduce((sum, item) => sum.plus(item.grossAmount ?? "0"), new Decimal(0)); const adjustmentRaw = components.reduce((sum, item) => sum.plus(item.approvedAdjustment ?? "0"), new Decimal(0)); const finalRaw = grossRaw.plus(adjustmentRaw);
  const grossTotal = money(grossRaw, decimalPlaces); const adjustmentTotal = money(adjustmentRaw, decimalPlaces); const finalTotal = money(finalRaw, decimalPlaces); const status = exceptions.length ? "blocked" as const : "completed" as const;
  await db.update(schema.salaryCalculationRuns).set({ status, componentCount: components.length, exceptionCount: exceptions.length, grossTotal, adjustmentTotal, finalTotal, completedAt: new Date() }).where(eq(schema.salaryCalculationRuns.id, insertedRun.id));
  if (status === "completed") { await db.update(schema.payrollPeriods).set({ calculationVersion: version, status: "Calculated", updatedAt: new Date() }).where(eq(schema.payrollPeriods.id, payrollPeriodId)); if (adjustments.length) await db.update(schema.manualAdjustments).set({ appliedRunId: insertedRun.id }).where(inArray(schema.manualAdjustments.id, adjustments.map((item) => item.id))); }
  await audit(ctx, actor.userId, "calculate", "salary_run", String(insertedRun.id), { runId, version, status, components: components.length, exceptions: exceptions.length, finalTotal }); ctx.invalidateQueries();
  return { runId, version, status, componentCount: components.length, exceptionCount: exceptions.length, finalTotal };
}

export const Actions = {
  authStatus: defineAction({
    request: z.object({}),
    response: z.object({ needsSetup: z.boolean() }),
    async handler(ctx) {
      const db = ctx.db<typeof schema>();
      const rows = await db.select({ id: schema.users.id }).from(schema.users).limit(1);
      return { needsSetup: rows.length === 0 };
    },
  }),

  bootstrapAdmin: defineAction({
    request: z.object({ name: z.string().trim().min(2).max(120), email: z.string().trim().email().max(200), password: z.string().min(10).max(200) }),
    response: z.object({ token: z.string(), expiresAt: z.string() }),
    async handler(ctx, args) {
      const db = ctx.db<typeof schema>();
      const existing = await db.select({ id: schema.users.id }).from(schema.users).limit(1);
      if (existing.length) throw new Error("Initial setup is already complete. Sign in instead.");
      await ensureRoles(ctx);
      const roleRows = await db.select().from(schema.roles).where(eq(schema.roles.slug, "administrator")).limit(1);
      const role = roleRows[0];
      if (!role) throw new Error("The administrator role could not be initialized.");
      const passwordHash = await hashPassword(args.password);
      const inserted = await db.insert(schema.users).values({ email: args.email.toLowerCase(), name: args.name, passwordHash, roleId: role.id }).returning({ id: schema.users.id });
      const user = inserted[0];
      if (!user) throw new Error("The administrator account could not be created.");
      await audit(ctx, user.id, "create", "user", String(user.id), { email: args.email.toLowerCase(), role: "administrator" });
      const session = await createSession(ctx, user.id);
      ctx.invalidateQueries();
      return { token: session.token, expiresAt: session.expiresAt.toISOString() };
    },
  }),

  login: defineAction({
    request: z.object({ email: z.string().trim().email(), password: z.string().min(1).max(200) }),
    response: z.object({ token: z.string(), expiresAt: z.string() }),
    async handler(ctx, args) {
      const db = ctx.db<typeof schema>();
      const rows = await db.select().from(schema.users).where(eq(schema.users.email, args.email.toLowerCase())).limit(1);
      const user = rows[0];
      if (!user || user.status !== "active" || !(await verifyPassword(args.password, user.passwordHash))) {
        throw new Error("The email or password is incorrect.");
      }
      const session = await createSession(ctx, user.id);
      return { token: session.token, expiresAt: session.expiresAt.toISOString() };
    },
  }),

  sessionInfo: defineAction({
    request: authRequest,
    response: z.object({ id: z.number(), name: z.string(), email: z.string(), role: z.string(), roleName: z.string(), permissions: z.array(z.string()) }),
    async handler(ctx, args) {
      const user = await requireUser(ctx, args.token);
      return { ...user, id: user.userId, permissions: [...(ROLE_ACCESS[user.role] ?? [])] };
    },
  }),

  logout: defineAction({
    request: authRequest,
    response: z.object({ ok: z.boolean() }),
    async handler(ctx, args) {
      const db = ctx.db<typeof schema>();
      await db.delete(schema.sessions).where(eq(schema.sessions.tokenHash, await tokenHash(args.token)));
      return { ok: true };
    },
  }),

  getDashboard: defineAction({
    request: authRequest,
    response: z.object({ employees: z.number(), activeEmployees: z.number(), periods: z.number(), activeProjects: z.number(), rateRules: z.number(), assignments: z.number(), latestPeriod: z.object({ periodId: z.string(), status: z.string(), startDate: z.string(), endDate: z.string() }).nullable() }),
    async handler(ctx, args) {
      await requireUser(ctx, args.token, "dashboard.read");
      const db = ctx.db<typeof schema>();
      const [employees, periods, projects, rates, assignments, latest] = await Promise.all([
        db.select().from(schema.employees), db.select().from(schema.payrollPeriods), db.select().from(schema.projects), db.select().from(schema.rateRules), db.select().from(schema.employeeProjectAssignments), db.select().from(schema.payrollPeriods).orderBy(desc(schema.payrollPeriods.year), desc(schema.payrollPeriods.month)).limit(1),
      ]);
      const p = latest[0];
      return { employees: employees.length, activeEmployees: employees.filter((e) => e.status === "active").length, periods: periods.length, activeProjects: projects.filter((project) => project.status === "active").length, rateRules: rates.length, assignments: assignments.length, latestPeriod: p ? { periodId: p.periodId, status: p.status, startDate: p.startDate, endDate: p.endDate } : null };
    },
  }),

  listEmployees: defineAction({
    request: authRequest.extend({ search: z.string().max(100).default("") }),
    response: z.object({ employees: z.array(z.object({ id: z.number(), employeeId: z.string(), name: z.string(), previousIds: z.array(z.string()), joiningDate: z.string().nullable(), status: z.string(), designation: z.string().nullable(), contractType: z.string().nullable(), team: z.string().nullable(), location: z.string().nullable(), updatedAt: z.string() })) }),
    async handler(ctx, args) {
      await requireUser(ctx, args.token, "employees.read");
      const db = ctx.db<typeof schema>();
      const rows = await db.select().from(schema.employees).orderBy(asc(schema.employees.employeeId));
      const mappings = await db.select().from(schema.employeeIdMappings);
      const q = args.search.trim().toLowerCase();
      return { employees: rows.filter((row) => !q || row.employeeId.toLowerCase().includes(q) || row.name.toLowerCase().includes(q)).map((row) => ({ ...row, previousIds: mappings.filter((m) => m.employeeId === row.id).map((m) => m.previousEmployeeId), updatedAt: row.updatedAt.toISOString() })) };
    },
  }),

  saveEmployee: defineAction({
    request: authRequest.extend({ id: z.number().int().positive().optional(), employee: employeeInput }),
    response: z.object({ id: z.number(), mode: z.enum(["created", "updated"]) }),
    async handler(ctx, args) {
      const actor = await requireUser(ctx, args.token, "employees.manage");
      const db = ctx.db<typeof schema>();
      const cleanId = normalizeId(args.employee.employeeId);
      let id: number;
      let mode: "created" | "updated";
      if (args.id) {
        const beforeRows = await db.select().from(schema.employees).where(eq(schema.employees.id, args.id)).limit(1);
        const before = beforeRows[0];
        if (!before) throw new Error("Employee not found.");
        await db.update(schema.employees).set({ employeeId: cleanId, name: args.employee.name, joiningDate: args.employee.joiningDate ?? null, status: args.employee.status, designation: args.employee.designation ?? null, contractType: args.employee.contractType ?? null, team: args.employee.team ?? null, location: args.employee.location ?? null, updatedAt: new Date() }).where(eq(schema.employees.id, args.id));
        id = args.id;
        mode = "updated";
        await audit(ctx, actor.userId, "update", "employee", String(id), args.employee, before);
      } else {
        const exists = await db.select({ id: schema.employees.id }).from(schema.employees).where(eq(schema.employees.employeeId, cleanId)).limit(1);
        if (exists.length) throw new Error("This Employee ID already exists.");
        const inserted = await db.insert(schema.employees).values({ employeeId: cleanId, name: args.employee.name, joiningDate: args.employee.joiningDate ?? null, status: args.employee.status, designation: args.employee.designation ?? null, contractType: args.employee.contractType ?? null, team: args.employee.team ?? null, location: args.employee.location ?? null, createdBy: actor.userId }).returning({ id: schema.employees.id });
        const row = inserted[0];
        if (!row) throw new Error("Employee could not be saved.");
        id = row.id;
        mode = "created";
        await audit(ctx, actor.userId, "create", "employee", String(id), args.employee);
      }
      for (const previousId of args.employee.previousIds.map(normalizeId).filter(Boolean)) {
        if (previousId === cleanId) continue;
        await db.insert(schema.employeeIdMappings).values({ employeeId: id, previousEmployeeId: previousId }).onConflictDoNothing();
      }
      ctx.invalidateQueries();
      return { id, mode };
    },
  }),

  importEmployees: defineAction({
    request: authRequest.extend({ rows: z.array(employeeInput).min(1).max(1000) }),
    response: z.object({ created: z.number(), updated: z.number(), rejected: z.array(z.object({ employeeId: z.string(), reason: z.string() })) }),
    async handler(ctx, args) {
      const actor = await requireUser(ctx, args.token, "employees.import");
      const db = ctx.db<typeof schema>();
      let created = 0;
      let updated = 0;
      const rejected: Array<{ employeeId: string; reason: string }> = [];
      for (const input of args.rows) {
        const employeeId = normalizeId(input.employeeId);
        try {
          const matches = await db.select().from(schema.employees).where(eq(schema.employees.employeeId, employeeId)).limit(1);
          const match = matches[0];
          let id: number;
          if (match) {
            await db.update(schema.employees).set({ name: input.name, joiningDate: input.joiningDate ?? null, status: input.status, designation: input.designation ?? null, contractType: input.contractType ?? null, team: input.team ?? null, location: input.location ?? null, updatedAt: new Date() }).where(eq(schema.employees.id, match.id));
            id = match.id;
            updated += 1;
          } else {
            const inserted = await db.insert(schema.employees).values({ employeeId, name: input.name, joiningDate: input.joiningDate ?? null, status: input.status, designation: input.designation ?? null, contractType: input.contractType ?? null, team: input.team ?? null, location: input.location ?? null, createdBy: actor.userId }).returning({ id: schema.employees.id });
            const row = inserted[0];
            if (!row) throw new Error("Insert returned no row.");
            id = row.id;
            created += 1;
          }
          for (const previousId of input.previousIds.map(normalizeId).filter(Boolean)) {
            if (previousId !== employeeId) await db.insert(schema.employeeIdMappings).values({ employeeId: id, previousEmployeeId: previousId }).onConflictDoNothing();
          }
        } catch (error) {
          rejected.push({ employeeId, reason: error instanceof Error ? error.message : "Could not import this row." });
        }
      }
      await audit(ctx, actor.userId, "import", "employee", "batch", { created, updated, rejected: rejected.length });
      ctx.invalidateQueries();
      return { created, updated, rejected };
    },
  }),

  listProjects: defineAction({
    request: authRequest,
    response: z.object({ projects: z.array(z.object({ id: z.number(), projectId: z.string(), name: z.string(), mainProjectId: z.string().nullable(), client: z.string().nullable(), description: z.string().nullable(), startDate: z.string().nullable(), endDate: z.string().nullable(), status: z.string(), currency: z.string(), manager: z.string().nullable(), notes: z.string().nullable(), countryCount: z.number(), workTypeCount: z.number(), rateCount: z.number() })) }),
    async handler(ctx, args) {
      await requireUser(ctx, args.token, "projects.read");
      const db = ctx.db<typeof schema>();
      const [projects, countries, workTypes, rates] = await Promise.all([db.select().from(schema.projects).orderBy(asc(schema.projects.projectId)), db.select().from(schema.projectCountryConfigurations), db.select().from(schema.workTypes), db.select().from(schema.rateRules)]);
      return { projects: projects.map((p) => ({ ...p, countryCount: countries.filter((c) => c.projectId === p.id && c.status === "active").length, workTypeCount: workTypes.filter((w) => w.projectId === p.id && w.status === "active").length, rateCount: rates.filter((r) => r.projectId === p.id && r.status === "active").length })) };
    },
  }),

  saveProject: defineAction({
    request: authRequest.extend({ project: projectInput }),
    response: z.object({ id: z.number(), mode: z.enum(["created", "updated"]) }),
    async handler(ctx, args) {
      const actor = await requireUser(ctx, args.token, "projects.manage");
      const db = ctx.db<typeof schema>();
      const p = args.project;
      if (p.id) {
        const beforeRows = await db.select().from(schema.projects).where(eq(schema.projects.id, p.id)).limit(1);
        const before = beforeRows[0];
        if (!before) throw new Error("Project not found.");
        await db.update(schema.projects).set({ projectId: normalizeId(p.projectId), name: p.name, mainProjectId: p.mainProjectId ?? null, client: p.client ?? null, description: p.description ?? null, startDate: p.startDate ?? null, endDate: p.endDate ?? null, status: p.status, currency: p.currency.toUpperCase(), manager: p.manager ?? null, notes: p.notes ?? null, updatedAt: new Date() }).where(eq(schema.projects.id, p.id));
        await audit(ctx, actor.userId, "update", "project", String(p.id), p, before);
        ctx.invalidateQueries();
        return { id: p.id, mode: "updated" as const };
      }
      const inserted = await db.insert(schema.projects).values({ projectId: normalizeId(p.projectId), name: p.name, mainProjectId: p.mainProjectId ?? null, client: p.client ?? null, description: p.description ?? null, startDate: p.startDate ?? null, endDate: p.endDate ?? null, status: p.status, currency: p.currency.toUpperCase(), manager: p.manager ?? null, notes: p.notes ?? null, createdBy: actor.userId }).returning({ id: schema.projects.id });
      const row = inserted[0];
      if (!row) throw new Error("Project could not be saved.");
      await audit(ctx, actor.userId, "create", "project", String(row.id), p);
      ctx.invalidateQueries();
      return { id: row.id, mode: "created" as const };
    },
  }),

  listPeriods: defineAction({
    request: authRequest,
    response: z.object({ periods: z.array(z.object({ id: z.number(), periodId: z.string(), month: z.number(), year: z.number(), startDate: z.string(), endDate: z.string(), status: z.string(), calculationVersion: z.number(), activeProjectIds: z.array(z.number()), createdAt: z.string() })) }),
    async handler(ctx, args) {
      await requireUser(ctx, args.token, "periods.read");
      const db = ctx.db<typeof schema>();
      const [periods, configs] = await Promise.all([db.select().from(schema.payrollPeriods).orderBy(desc(schema.payrollPeriods.year), desc(schema.payrollPeriods.month)), db.select().from(schema.projectPeriodConfigurations)]);
      return { periods: periods.map((p) => ({ ...p, activeProjectIds: configs.filter((c) => c.payrollPeriodId === p.id && c.active).map((c) => c.projectId), createdAt: p.createdAt.toISOString() })) };
    },
  }),

  createPeriod: defineAction({
    request: authRequest.extend({ periodId: z.string().trim().min(1).max(80), month: z.number().int().min(1).max(12), year: z.number().int().min(2020).max(2100), startDate: isoDate, endDate: isoDate, copyFromPeriodId: z.number().int().positive().optional().nullable(), activeProjectIds: z.array(z.number().int().positive()).max(500).default([]) }),
    response: z.object({ id: z.number(), copiedProjects: z.number() }),
    async handler(ctx, args) {
      const actor = await requireUser(ctx, args.token, "periods.manage");
      if (args.endDate < args.startDate) throw new Error("End date must be on or after the start date.");
      const db = ctx.db<typeof schema>();
      const inserted = await db.insert(schema.payrollPeriods).values({ periodId: args.periodId.trim().toUpperCase(), month: args.month, year: args.year, startDate: args.startDate, endDate: args.endDate, createdBy: actor.userId }).returning({ id: schema.payrollPeriods.id });
      const row = inserted[0];
      if (!row) throw new Error("Payroll period could not be created.");
      let projectIds = [...new Set(args.activeProjectIds)];
      if (args.copyFromPeriodId) {
        const previous = await db.select().from(schema.projectPeriodConfigurations).where(and(eq(schema.projectPeriodConfigurations.payrollPeriodId, args.copyFromPeriodId), eq(schema.projectPeriodConfigurations.active, true)));
        projectIds = [...new Set([...projectIds, ...previous.map((p) => p.projectId)])];
      }
      for (const projectId of projectIds) {
        await db.insert(schema.projectPeriodConfigurations).values({ payrollPeriodId: row.id, projectId, active: true, copiedFromId: args.copyFromPeriodId ?? null }).onConflictDoNothing();
      }
      await audit(ctx, actor.userId, "create", "payroll_period", String(row.id), { ...args, copiedProjects: projectIds.length });
      ctx.invalidateQueries();
      return { id: row.id, copiedProjects: projectIds.length };
    },
  }),

  updatePeriodStatus: defineAction({
    request: authRequest.extend({ id: z.number().int().positive(), status: z.enum(["Draft", "Importing", "Reconciliation Pending", "Ready for Calculation", "Calculated", "Under Review", "Approved", "Locked", "Exported"]), reason: z.string().trim().min(3).max(500) }),
    response: z.object({ ok: z.boolean() }),
    async handler(ctx, args) {
      const actor = await requireUser(ctx, args.token, "periods.manage");
      const db = ctx.db<typeof schema>();
      const found = await db.select().from(schema.payrollPeriods).where(eq(schema.payrollPeriods.id, args.id)).limit(1);
      const period = found[0];
      if (!period) throw new Error("Payroll period not found.");
      const allowed: Record<string, string[]> = { Draft: ["Importing"], Importing: ["Reconciliation Pending"], "Reconciliation Pending": ["Ready for Calculation"], "Ready for Calculation": ["Calculated"], Calculated: ["Under Review"], "Under Review": ["Approved", "Calculated"], Approved: ["Locked"], Locked: ["Exported"], Exported: [] };
      if (!(allowed[period.status] ?? []).includes(args.status)) throw new Error(`Status cannot move from ${period.status} to ${args.status}.`);
      const changes: Partial<typeof schema.payrollPeriods.$inferInsert> = { status: args.status, updatedAt: new Date() };
      if (args.status === "Approved") { changes.approverId = actor.userId; changes.approvalAt = new Date(); }
      if (args.status === "Locked") changes.lockAt = new Date();
      await db.update(schema.payrollPeriods).set(changes).where(eq(schema.payrollPeriods.id, args.id));
      await audit(ctx, actor.userId, "status_change", "payroll_period", String(args.id), { status: args.status }, { status: period.status }, args.reason);
      ctx.invalidateQueries();
      return { ok: true };
    },
  }),

  setPeriodProject: defineAction({
    request: authRequest.extend({ payrollPeriodId: z.number().int().positive(), projectId: z.number().int().positive(), active: z.boolean() }),
    response: z.object({ ok: z.boolean() }),
    async handler(ctx, args) {
      const actor = await requireUser(ctx, args.token, "periods.manage");
      const db = ctx.db<typeof schema>();
      const found = await db.select().from(schema.projectPeriodConfigurations).where(and(eq(schema.projectPeriodConfigurations.payrollPeriodId, args.payrollPeriodId), eq(schema.projectPeriodConfigurations.projectId, args.projectId))).limit(1);
      const row = found[0];
      if (row) await db.update(schema.projectPeriodConfigurations).set({ active: args.active }).where(eq(schema.projectPeriodConfigurations.id, row.id));
      else await db.insert(schema.projectPeriodConfigurations).values({ payrollPeriodId: args.payrollPeriodId, projectId: args.projectId, active: args.active });
      await audit(ctx, actor.userId, "project_activation", "payroll_period", String(args.payrollPeriodId), { projectId: args.projectId, active: args.active });
      ctx.invalidateQueries();
      return { ok: true };
    },
  }),

  getProjectConfiguration: defineAction({
    request: authRequest.extend({ projectId: z.number().int().positive() }),
    response: z.object({ countries: z.array(z.object({ id: z.number(), countryCode: z.string(), countryName: z.string(), status: z.string(), effectiveFrom: z.string(), effectiveTo: z.string().nullable() })), workTypes: z.array(z.object({ id: z.number(), code: z.string(), name: z.string(), unit: z.string(), paymentBasis: z.string(), status: z.string() })), categories: z.array(z.object({ id: z.number(), countryCode: z.string().nullable(), code: z.string(), name: z.string(), description: z.string().nullable(), paymentBasis: z.string(), quantitySource: z.string(), attributionRule: z.string(), effectiveFrom: z.string(), status: z.string(), displayOrder: z.number() })), rateRules: z.array(z.object({ id: z.number(), countryCode: z.string(), workTypeId: z.number(), workTypeName: z.string(), categoryId: z.number().nullable(), categoryName: z.string().nullable(), ruleName: z.string(), ruleType: z.string(), unitRate: z.string(), thresholdLow: z.string().nullable(), thresholdHigh: z.string().nullable(), multiplierLow: z.string().nullable(), multiplierMid: z.string().nullable(), multiplierHigh: z.string().nullable(), priority: z.number(), effectiveFrom: z.string(), effectiveTo: z.string().nullable(), status: z.string(), supersedesRateRuleId: z.number().nullable(), createdAt: z.string() })) }),
    async handler(ctx, args) {
      await requireUser(ctx, args.token, "rates.read");
      const db = ctx.db<typeof schema>();
      const [countries, workTypes, categories, rates] = await Promise.all([db.select().from(schema.projectCountryConfigurations).where(eq(schema.projectCountryConfigurations.projectId, args.projectId)).orderBy(asc(schema.projectCountryConfigurations.countryCode)), db.select().from(schema.workTypes).where(eq(schema.workTypes.projectId, args.projectId)).orderBy(asc(schema.workTypes.name)), db.select().from(schema.characterCategories).where(eq(schema.characterCategories.projectId, args.projectId)).orderBy(asc(schema.characterCategories.displayOrder)), db.select().from(schema.rateRules).where(eq(schema.rateRules.projectId, args.projectId)).orderBy(desc(schema.rateRules.effectiveFrom), desc(schema.rateRules.id))]);
      return { countries, workTypes, categories, rateRules: rates.map((r) => ({ ...r, workTypeName: workTypes.find((w) => w.id === r.workTypeId)?.name ?? "Unknown work type", categoryName: r.categoryId ? categories.find((c) => c.id === r.categoryId)?.name ?? "Unknown category" : null, createdAt: r.createdAt.toISOString() })) };
    },
  }),

  saveCountryConfiguration: defineAction({
    request: authRequest.extend({ id: z.number().int().positive().optional(), projectId: z.number().int().positive(), countryCode: z.string().trim().min(2).max(12), countryName: z.string().trim().min(2).max(120), status: z.enum(["active", "inactive"]).default("active"), effectiveFrom: isoDate, effectiveTo: isoDate.optional().nullable() }),
    response: z.object({ id: z.number() }),
    async handler(ctx, args) {
      const actor = await requireUser(ctx, args.token, "rates.manage");
      const db = ctx.db<typeof schema>();
      let id = args.id;
      if (id) await db.update(schema.projectCountryConfigurations).set({ countryCode: args.countryCode.toUpperCase(), countryName: args.countryName, status: args.status, effectiveFrom: args.effectiveFrom, effectiveTo: args.effectiveTo ?? null }).where(eq(schema.projectCountryConfigurations.id, id));
      else { const inserted = await db.insert(schema.projectCountryConfigurations).values({ projectId: args.projectId, countryCode: args.countryCode.toUpperCase(), countryName: args.countryName, status: args.status, effectiveFrom: args.effectiveFrom, effectiveTo: args.effectiveTo ?? null }).returning({ id: schema.projectCountryConfigurations.id }); id = inserted[0]?.id; }
      if (!id) throw new Error("Country configuration could not be saved.");
      await audit(ctx, actor.userId, args.id ? "update" : "create", "project_country", String(id), args);
      ctx.invalidateQueries();
      return { id };
    },
  }),

  saveWorkType: defineAction({
    request: authRequest.extend({ id: z.number().int().positive().optional(), projectId: z.number().int().positive(), code: z.string().trim().min(1).max(50), name: z.string().trim().min(2).max(120), unit: z.enum(["record", "character", "image", "batch", "fixed"]), paymentBasis: z.enum(["record-wise", "character-wise", "record-and-character", "category-wise", "document-image", "fixed", "slab-based", "hybrid", "custom"]), status: z.enum(["active", "inactive"]).default("active") }),
    response: z.object({ id: z.number() }),
    async handler(ctx, args) {
      const actor = await requireUser(ctx, args.token, "rates.manage");
      const db = ctx.db<typeof schema>();
      let id = args.id;
      if (id) await db.update(schema.workTypes).set({ code: normalizeId(args.code), name: args.name, unit: args.unit, paymentBasis: args.paymentBasis, status: args.status }).where(eq(schema.workTypes.id, id));
      else { const inserted = await db.insert(schema.workTypes).values({ projectId: args.projectId, code: normalizeId(args.code), name: args.name, unit: args.unit, paymentBasis: args.paymentBasis, status: args.status }).returning({ id: schema.workTypes.id }); id = inserted[0]?.id; }
      if (!id) throw new Error("Work type could not be saved.");
      await audit(ctx, actor.userId, args.id ? "update" : "create", "work_type", String(id), args);
      ctx.invalidateQueries();
      return { id };
    },
  }),

  saveCategory: defineAction({
    request: authRequest.extend({ id: z.number().int().positive().optional(), projectId: z.number().int().positive(), countryCode: z.string().trim().max(12).optional().nullable(), code: z.string().trim().min(1).max(50), name: z.string().trim().min(2).max(120), description: optionalText, paymentBasis: z.enum(["record", "character"]), quantitySource: z.string().trim().min(2).max(160), attributionRule: z.string().trim().min(2).max(160), effectiveFrom: isoDate, status: z.enum(["active", "inactive"]).default("active"), displayOrder: z.number().int().min(0).max(999).default(0) }),
    response: z.object({ id: z.number() }),
    async handler(ctx, args) {
      const actor = await requireUser(ctx, args.token, "rates.manage");
      const db = ctx.db<typeof schema>();
      let id = args.id;
      const values = { code: normalizeId(args.code), name: args.name, countryCode: args.countryCode?.toUpperCase() ?? null, description: args.description ?? null, paymentBasis: args.paymentBasis, quantitySource: args.quantitySource, attributionRule: args.attributionRule, effectiveFrom: args.effectiveFrom, status: args.status, displayOrder: args.displayOrder };
      if (id) await db.update(schema.characterCategories).set(values).where(eq(schema.characterCategories.id, id));
      else { const inserted = await db.insert(schema.characterCategories).values({ projectId: args.projectId, ...values }).returning({ id: schema.characterCategories.id }); id = inserted[0]?.id; }
      if (!id) throw new Error("Category could not be saved.");
      await audit(ctx, actor.userId, args.id ? "update" : "create", "category", String(id), args);
      ctx.invalidateQueries();
      return { id };
    },
  }),

  addRateRule: defineAction({
    request: authRequest.extend({ projectId: z.number().int().positive(), countryCode: z.string().trim().min(2).max(12), workTypeId: z.number().int().positive(), categoryId: z.number().int().positive().optional().nullable(), ruleName: z.string().trim().min(2).max(160), ruleType: z.enum(["unit-rate", "slab", "fixed", "hybrid"]), unitRate: z.string().regex(/^-?\d+(\.\d+)?$/), thresholdLow: z.string().regex(/^\d+(\.\d+)?$/).optional().nullable(), thresholdHigh: z.string().regex(/^\d+(\.\d+)?$/).optional().nullable(), multiplierLow: z.string().regex(/^\d+(\.\d+)?$/).optional().nullable(), multiplierMid: z.string().regex(/^\d+(\.\d+)?$/).optional().nullable(), multiplierHigh: z.string().regex(/^\d+(\.\d+)?$/).optional().nullable(), priority: z.number().int().min(1).max(999), effectiveFrom: isoDate, effectiveTo: isoDate.optional().nullable(), supersedesRateRuleId: z.number().int().positive().optional().nullable() }),
    response: z.object({ id: z.number() }),
    async handler(ctx, args) {
      const actor = await requireUser(ctx, args.token, "rates.manage");
      const db = ctx.db<typeof schema>();
      if (args.ruleType === "slab" && (!args.thresholdLow || !args.thresholdHigh || !args.multiplierLow || !args.multiplierMid || !args.multiplierHigh)) throw new Error("A slab rule requires both thresholds and all three multipliers.");
      const active = await db.select().from(schema.rateRules).where(and(eq(schema.rateRules.projectId, args.projectId), eq(schema.rateRules.countryCode, args.countryCode.toUpperCase()), eq(schema.rateRules.workTypeId, args.workTypeId), eq(schema.rateRules.status, "active")));
      const overlapping = active.find((rule) => (rule.categoryId ?? null) === (args.categoryId ?? null) && rule.priority === args.priority && (!rule.effectiveTo || rule.effectiveTo >= args.effectiveFrom) && (!args.effectiveTo || rule.effectiveFrom <= args.effectiveTo));
      if (overlapping && overlapping.id !== args.supersedesRateRuleId) throw new Error("An active rule already overlaps this scope, date range, and priority. Supersede it or change the priority.");
      if (args.supersedesRateRuleId) await db.update(schema.rateRules).set({ status: "inactive" }).where(eq(schema.rateRules.id, args.supersedesRateRuleId));
      const inserted = await db.insert(schema.rateRules).values({ projectId: args.projectId, countryCode: args.countryCode.toUpperCase(), workTypeId: args.workTypeId, categoryId: args.categoryId ?? null, ruleName: args.ruleName, ruleType: args.ruleType, unitRate: args.unitRate, thresholdLow: args.thresholdLow ?? null, thresholdHigh: args.thresholdHigh ?? null, multiplierLow: args.multiplierLow ?? null, multiplierMid: args.multiplierMid ?? null, multiplierHigh: args.multiplierHigh ?? null, priority: args.priority, effectiveFrom: args.effectiveFrom, effectiveTo: args.effectiveTo ?? null, supersedesRateRuleId: args.supersedesRateRuleId ?? null, createdBy: actor.userId }).returning({ id: schema.rateRules.id });
      const row = inserted[0];
      if (!row) throw new Error("Rate rule could not be saved.");
      await audit(ctx, actor.userId, "create", "rate_rule", String(row.id), args);
      ctx.invalidateQueries();
      return { id: row.id };
    },
  }),

  previewCalculationKernel: defineAction({
    request: authRequest.extend({ quantityRates: z.array(z.object({ quantity: z.string().regex(/^\d+(\.\d+)?$/), rate: z.string().regex(/^-?\d+(\.\d+)?$/) })).min(1).max(50), averageHours: z.string().regex(/^\d+(\.\d+)?$/), thresholdLow: z.string().regex(/^\d+(\.\d+)?$/), thresholdHigh: z.string().regex(/^\d+(\.\d+)?$/), multiplierLow: z.string().regex(/^\d+(\.\d+)?$/), multiplierMid: z.string().regex(/^\d+(\.\d+)?$/), multiplierHigh: z.string().regex(/^\d+(\.\d+)?$/) }),
    response: z.object({ baseAmount: z.string(), multiplier: z.string(), payableAmount: z.string() }),
    async handler(ctx, args) {
      await requireUser(ctx, args.token, "rates.read");
      return calculateVerifiedKernel(args.quantityRates, args.averageHours, args);
    },
  }),

  listAssignments: defineAction({
    request: authRequest,
    response: z.object({ assignments: z.array(z.object({ id: z.number(), employeeId: z.number(), employeeCode: z.string(), employeeName: z.string(), projectId: z.number(), projectCode: z.string(), projectName: z.string(), payrollPeriodId: z.number().nullable(), periodCode: z.string().nullable(), startDate: z.string(), endDate: z.string().nullable(), status: z.string() })) }),
    async handler(ctx, args) {
      await requireUser(ctx, args.token, "assignments.read");
      const db = ctx.db<typeof schema>();
      const [rows, employees, projects, periods] = await Promise.all([db.select().from(schema.employeeProjectAssignments).orderBy(desc(schema.employeeProjectAssignments.id)), db.select().from(schema.employees), db.select().from(schema.projects), db.select().from(schema.payrollPeriods)]);
      return { assignments: rows.map((row) => ({ ...row, employeeCode: employees.find((e) => e.id === row.employeeId)?.employeeId ?? "Unknown", employeeName: employees.find((e) => e.id === row.employeeId)?.name ?? "Unknown", projectCode: projects.find((p) => p.id === row.projectId)?.projectId ?? "Unknown", projectName: projects.find((p) => p.id === row.projectId)?.name ?? "Unknown", periodCode: row.payrollPeriodId ? periods.find((p) => p.id === row.payrollPeriodId)?.periodId ?? "Unknown" : null })) };
    },
  }),

  saveAssignment: defineAction({
    request: authRequest.extend({ employeeId: z.number().int().positive(), projectId: z.number().int().positive(), payrollPeriodId: z.number().int().positive().optional().nullable(), startDate: isoDate, endDate: isoDate.optional().nullable(), status: z.enum(["active", "inactive"]).default("active") }),
    response: z.object({ id: z.number() }),
    async handler(ctx, args) {
      const actor = await requireUser(ctx, args.token, "assignments.manage");
      const db = ctx.db<typeof schema>();
      const inserted = await db.insert(schema.employeeProjectAssignments).values({ employeeId: args.employeeId, projectId: args.projectId, payrollPeriodId: args.payrollPeriodId ?? null, startDate: args.startDate, endDate: args.endDate ?? null, status: args.status }).returning({ id: schema.employeeProjectAssignments.id });
      const row = inserted[0];
      if (!row) throw new Error("Assignment could not be saved.");
      await audit(ctx, actor.userId, "create", "employee_project_assignment", String(row.id), args);
      ctx.invalidateQueries();
      return { id: row.id };
    },
  }),

  listUsers: defineAction({
    request: authRequest,
    response: z.object({ users: z.array(z.object({ id: z.number(), email: z.string(), name: z.string(), role: z.string(), roleName: z.string(), status: z.string(), createdAt: z.string() })), roles: z.array(z.object({ id: z.number(), slug: z.string(), name: z.string() })) }),
    async handler(ctx, args) {
      await requireUser(ctx, args.token, "users.manage");
      const db = ctx.db<typeof schema>();
      const [users, roles] = await Promise.all([db.select().from(schema.users).orderBy(asc(schema.users.name)), db.select().from(schema.roles).orderBy(asc(schema.roles.name))]);
      return { users: users.map((u) => ({ id: u.id, email: u.email, name: u.name, role: roles.find((r) => r.id === u.roleId)?.slug ?? "unknown", roleName: roles.find((r) => r.id === u.roleId)?.name ?? "Unknown role", status: u.status, createdAt: u.createdAt.toISOString() })), roles: roles.map((r) => ({ id: r.id, slug: r.slug, name: r.name })) };
    },
  }),

  addUser: defineAction({
    request: authRequest.extend({ name: z.string().trim().min(2).max(120), email: z.string().trim().email().max(200), password: z.string().min(10).max(200), role: roleSlugSchema }),
    response: z.object({ id: z.number() }),
    async handler(ctx, args) {
      const actor = await requireUser(ctx, args.token, "users.manage");
      const db = ctx.db<typeof schema>();
      const roles = await db.select().from(schema.roles).where(eq(schema.roles.slug, args.role)).limit(1);
      const role = roles[0];
      if (!role) throw new Error("Selected role is unavailable.");
      const passwordHash = await hashPassword(args.password);
      const inserted = await db.insert(schema.users).values({ name: args.name, email: args.email.toLowerCase(), passwordHash, roleId: role.id }).returning({ id: schema.users.id });
      const row = inserted[0];
      if (!row) throw new Error("User could not be created.");
      await audit(ctx, actor.userId, "create", "user", String(row.id), { name: args.name, email: args.email.toLowerCase(), role: args.role });
      ctx.invalidateQueries();
      return { id: row.id };
    },
  }),

  getImportSetup: defineAction({
    request: authRequest.extend({ sourceType: sourceTypeSchema, projectId: z.number().int().positive().optional().nullable() }),
    response: z.object({
      fields: z.array(z.object({ key: z.string(), label: z.string(), type: z.string(), required: z.boolean() })),
      defaultBusinessKeys: z.array(z.string()),
      templates: z.array(z.object({ id: z.number(), name: z.string(), sourceType: z.string(), projectId: z.number().nullable(), mapping: z.record(z.string(), z.string()), businessKeys: z.array(z.string()), delimiter: z.string() })),
    }),
    async handler(ctx, args) {
      await requireUser(ctx, args.token, "imports.read");
      const db = ctx.db<typeof schema>();
      const rows = await db.select().from(schema.columnMappingTemplates).where(eq(schema.columnMappingTemplates.sourceType, args.sourceType)).orderBy(asc(schema.columnMappingTemplates.name));
      return {
        fields: CANONICAL_FIELDS[args.sourceType].map(({ key, label, type, required }) => ({ key, label, type, required })),
        defaultBusinessKeys: DEFAULT_BUSINESS_KEYS[args.sourceType],
        templates: rows.filter((row) => row.projectId === null || row.projectId === (args.projectId ?? null)).map((row) => ({ id: row.id, name: row.name, sourceType: row.sourceType, projectId: row.projectId, mapping: JSON.parse(row.mappingJson) as Record<string, string>, businessKeys: JSON.parse(row.businessKeysJson) as string[], delimiter: row.delimiter })),
      };
    },
  }),

  createImportBatch: defineAction({
    request: authRequest.extend({
      payrollPeriodId: z.number().int().positive(), projectId: z.number().int().positive(), sourceType: sourceTypeSchema,
      delimiter: z.enum(["auto", ",", ";", "tab", "|"]).default("auto"),
      files: z.array(z.object({ originalFilename: z.string().trim().min(1).max(260), fileHash: z.string().regex(/^[a-f0-9]{64}$/i), mimeType: z.string().max(160), sizeBytes: z.number().int().positive().max(250_000_000), expectedChunks: z.number().int().positive().max(1000), replacementOfFileId: z.number().int().positive().optional().nullable() })).min(1).max(250),
    }),
    response: z.object({ batchId: z.number(), batchCode: z.string(), files: z.array(z.object({ id: z.number(), sourceFileId: z.string(), originalFilename: z.string() })) }),
    async handler(ctx, args) {
      const actor = await requireUser(ctx, args.token, "imports.manage");
      const db = ctx.db<typeof schema>();
      const [periodRows, projectRows] = await Promise.all([db.select().from(schema.payrollPeriods).where(eq(schema.payrollPeriods.id, args.payrollPeriodId)).limit(1), db.select().from(schema.projects).where(eq(schema.projects.id, args.projectId)).limit(1)]);
      const period = periodRows[0]; const project = projectRows[0];
      if (!period || !project) throw new Error("Select a valid payroll period and project.");
      if (["Approved", "Locked", "Exported"].includes(period.status)) throw new Error("Imports are blocked for approved, locked, or exported payroll periods.");
      const productionConfig = await getProductionConfig(ctx, project.id);
      if (args.sourceType === "doctype" && !productionConfig.doctypeEnabled) throw new Error("Doctype is disabled for this project. Enable it in Production Data configuration before uploading a Doctype file.");
      if (args.sourceType === "proof" && !productionConfig.proofEnabled) throw new Error("Proof is disabled for this project. Enable it in Production Data configuration before uploading a Proof file.");
      const allowedExtensions = args.sourceType === "employee_information" || args.sourceType === "record_details" || args.sourceType === "doctype" || args.sourceType === "proof" ? ["csv", "xlsx", "xls"] : ["csv", "xlsx", "xls"];
      for (const file of args.files) {
        const extension = file.originalFilename.toLowerCase().split(".").pop() ?? "";
        if (!allowedExtensions.includes(extension)) throw new Error(`${file.originalFilename} is not a supported CSV, XLSX, or XLS file.`);
        const scoped = await db.select().from(schema.sourceFiles).where(and(eq(schema.sourceFiles.payrollPeriodId, args.payrollPeriodId), eq(schema.sourceFiles.projectId, args.projectId), eq(schema.sourceFiles.sourceType, args.sourceType), eq(schema.sourceFiles.fileHash, file.fileHash.toLowerCase())));
        const activeDuplicate = scoped.find((candidate) => candidate.status !== "reversed" && candidate.id !== file.replacementOfFileId);
        if (activeDuplicate) throw new Error(`${file.originalFilename} matches source file ${activeDuplicate.sourceFileId}. Use reprocess or replacement instead of importing it twice.`);
        if (file.replacementOfFileId) {
          const replacementRows = await db.select().from(schema.sourceFiles).where(eq(schema.sourceFiles.id, file.replacementOfFileId)).limit(1);
          const replacement = replacementRows[0];
          if (!replacement || replacement.payrollPeriodId !== args.payrollPeriodId || replacement.projectId !== args.projectId || replacement.sourceType !== args.sourceType || replacement.status !== "committed") throw new Error(`The replacement target for ${file.originalFilename} is not an active committed file in this scope.`);
        }
      }
      const code = `IMP-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;
      const inserted = await db.insert(schema.importBatches).values({ batchId: code, payrollPeriodId: args.payrollPeriodId, projectId: args.projectId, sourceType: args.sourceType, delimiter: args.delimiter, totalFiles: args.files.length, uploadedBy: actor.userId }).returning({ id: schema.importBatches.id });
      const batch = inserted[0]; if (!batch) throw new Error("The import batch could not be created.");
      const created: Array<{ id: number; sourceFileId: string; originalFilename: string }> = [];
      for (const file of args.files) {
        const sourceFileId = `SRC-${crypto.randomUUID().slice(0, 12).toUpperCase()}`;
        const fileRows = await db.insert(schema.sourceFiles).values({ sourceFileId, importBatchId: batch.id, payrollPeriodId: args.payrollPeriodId, projectId: args.projectId, sourceType: args.sourceType, originalFilename: file.originalFilename, fileHash: file.fileHash.toLowerCase(), mimeType: file.mimeType || "application/octet-stream", sizeBytes: file.sizeBytes, expectedChunks: file.expectedChunks, replacementOfFileId: file.replacementOfFileId ?? null, uploadedBy: actor.userId }).returning({ id: schema.sourceFiles.id });
        const createdFile = fileRows[0]; if (!createdFile) throw new Error(`Could not register ${file.originalFilename}.`);
        created.push({ id: createdFile.id, sourceFileId, originalFilename: file.originalFilename });
      }
      if (period.status === "Draft") await db.update(schema.payrollPeriods).set({ status: "Importing", updatedAt: new Date() }).where(eq(schema.payrollPeriods.id, period.id));
      await audit(ctx, actor.userId, "create", "import_batch", String(batch.id), { batchId: code, sourceType: args.sourceType, payrollPeriodId: args.payrollPeriodId, projectId: args.projectId, totalFiles: args.files.length });
      ctx.invalidateQueries();
      return { batchId: batch.id, batchCode: code, files: created };
    },
  }),

  uploadImportChunk: defineAction({
    request: authRequest.extend({ sourceFileId: z.number().int().positive(), chunkIndex: z.number().int().min(0), dataBase64: z.string().min(1).max(1_500_000) }),
    response: z.object({ uploadedChunks: z.number(), expectedChunks: z.number() }),
    async handler(ctx, args) {
      await requireUser(ctx, args.token, "imports.manage");
      const db = ctx.db<typeof schema>();
      const fileRows = await db.select().from(schema.sourceFiles).where(eq(schema.sourceFiles.id, args.sourceFileId)).limit(1); const file = fileRows[0];
      if (!file || file.status !== "uploading") throw new Error("This source file is not accepting upload chunks.");
      if (args.chunkIndex >= file.expectedChunks) throw new Error("The chunk index is outside the declared file range.");
      const bytes = Uint8Array.from(Buffer.from(args.dataBase64, "base64"));
      const key = `imports/${file.sourceFileId}/chunks/${String(args.chunkIndex).padStart(6, "0")}`;
      await ctx.blobs.put(key, bytes, { contentType: "application/octet-stream" });
      await db.insert(schema.importUploadChunks).values({ sourceFileId: file.id, chunkIndex: args.chunkIndex, blobKey: key, sizeBytes: bytes.byteLength }).onConflictDoNothing();
      const chunks = await db.select().from(schema.importUploadChunks).where(eq(schema.importUploadChunks.sourceFileId, file.id));
      await db.update(schema.sourceFiles).set({ uploadedChunks: chunks.length }).where(eq(schema.sourceFiles.id, file.id));
      return { uploadedChunks: chunks.length, expectedChunks: file.expectedChunks };
    },
  }),

  finalizeImportFile: defineAction({
    request: authRequest.extend({ sourceFileId: z.number().int().positive() }),
    response: z.object({ rows: z.number(), headers: z.array(z.string()), sheetName: z.string().nullable(), delimiter: z.string(), autoMapping: z.record(z.string(), z.string()) }),
    async handler(ctx, args) {
      const actor = await requireUser(ctx, args.token, "imports.manage");
      const db = ctx.db<typeof schema>();
      const fileRows = await db.select().from(schema.sourceFiles).where(eq(schema.sourceFiles.id, args.sourceFileId)).limit(1); const file = fileRows[0];
      if (!file || !["uploading", "failed"].includes(file.status)) throw new Error("This source file cannot be finalized in its current state.");
      const batchRows = await db.select().from(schema.importBatches).where(eq(schema.importBatches.id, file.importBatchId)).limit(1); const batch = batchRows[0];
      if (!batch) throw new Error("Import batch not found.");
      const chunks = await db.select().from(schema.importUploadChunks).where(eq(schema.importUploadChunks.sourceFileId, file.id)).orderBy(asc(schema.importUploadChunks.chunkIndex));
      if (chunks.length !== file.expectedChunks) throw new Error(`Upload is incomplete: ${chunks.length} of ${file.expectedChunks} chunks are present.`);
      await db.update(schema.sourceFiles).set({ status: "processing", errorSummary: null }).where(eq(schema.sourceFiles.id, file.id));
      try {
        const pieces: Uint8Array[] = []; let size = 0;
        for (const chunk of chunks) { const url = await ctx.blobs.getUrl(chunk.blobKey, { expiresInSeconds: 300 }); const response = await fetch(url); if (!response.ok) throw new Error(`Could not read upload chunk ${chunk.chunkIndex + 1}.`); const bytes = new Uint8Array(await response.arrayBuffer()); pieces.push(bytes); size += bytes.byteLength; }
        const merged = new Uint8Array(size); let offset = 0; for (const piece of pieces) { merged.set(piece, offset); offset += piece.byteLength; }
        const digest = bytesToHex(new Uint8Array(await crypto.subtle.digest("SHA-256", merged)));
        if (digest !== file.fileHash) throw new Error("The uploaded file hash does not match the registered file. Retry the upload.");
        const parsed = parseFileRows(merged, file.originalFilename, batch.delimiter);
        const headerIndex = parsed.matrix.findIndex((row) => row.some((cell) => String(cell).trim()));
        if (headerIndex < 0) throw new Error("The selected file contains no readable rows.");
        const seenHeaders = new Map<string, number>();
        const headers = (parsed.matrix[headerIndex] ?? []).map((cell, index) => { const base = String(cell).trim() || `Column ${index + 1}`; const count = (seenHeaders.get(base) ?? 0) + 1; seenHeaders.set(base, count); return count === 1 ? base : `${base} (${count})`; });
        const dataRows = parsed.matrix.slice(headerIndex + 1).filter((row) => row.some((cell) => String(cell).trim()));
        await db.delete(schema.importRows).where(eq(schema.importRows.sourceFileId, file.id));
        for (let start = 0; start < dataRows.length; start += 100) {
          const values = dataRows.slice(start, start + 100).map((row, index) => ({ importBatchId: batch.id, sourceFileId: file.id, sourceRowNumber: headerIndex + start + index + 2, rawPayload: JSON.stringify(Object.fromEntries(headers.map((header, cellIndex) => [header, String(row[cellIndex] ?? "")]))), validationStatus: "pending" as const }));
          if (values.length) await db.insert(schema.importRows).values(values);
        }
        const finalKey = `imports/${file.sourceFileId}/${file.originalFilename.replace(/[^a-zA-Z0-9._-]/g, "_")}`;
        await ctx.blobs.put(finalKey, merged, { contentType: file.mimeType });
        for (const chunk of chunks) await ctx.blobs.delete(chunk.blobKey);
        await db.delete(schema.importUploadChunks).where(eq(schema.importUploadChunks.sourceFileId, file.id));
        await db.update(schema.sourceFiles).set({ blobKey: finalKey, status: "ready", totalRows: dataRows.length, uploadedChunks: file.expectedChunks, processedAt: new Date() }).where(eq(schema.sourceFiles.id, file.id));
        await db.update(schema.importBatches).set({ status: "mapping_required", delimiter: parsed.delimiter, updatedAt: new Date() }).where(eq(schema.importBatches.id, batch.id));
        await refreshImportCounts(ctx, batch.id);
        await audit(ctx, actor.userId, "process", "source_file", String(file.id), { rows: dataRows.length, sheetName: parsed.sheetName, delimiter: parsed.delimiter });
        ctx.invalidateQueries();
        return { rows: dataRows.length, headers, sheetName: parsed.sheetName, delimiter: parsed.delimiter, autoMapping: automaticMapping(batch.sourceType as SourceType, headers) };
      } catch (error) {
        const reason = error instanceof Error ? error.message : "File processing failed.";
        await db.update(schema.sourceFiles).set({ status: "failed", errorSummary: reason }).where(eq(schema.sourceFiles.id, file.id));
        await db.update(schema.importBatches).set({ status: "failed", errorSummary: reason, updatedAt: new Date() }).where(eq(schema.importBatches.id, file.importBatchId));
        throw new Error(reason);
      }
    },
  }),

  getImportBatch: defineAction({
    request: authRequest.extend({ importBatchId: z.number().int().positive() }),
    response: z.object({ id: z.number(), batchId: z.string(), sourceType: z.string(), payrollPeriodId: z.number(), projectId: z.number(), status: z.string(), delimiter: z.string(), totalFiles: z.number(), processedFiles: z.number(), totalRows: z.number(), validRows: z.number(), rejectedRows: z.number(), duplicateRows: z.number(), headers: z.array(z.string()), mapping: z.record(z.string(), z.string()), businessKeys: z.array(z.string()), files: z.array(z.object({ id: z.number(), sourceFileId: z.string(), originalFilename: z.string(), fileHash: z.string(), sizeBytes: z.number(), status: z.string(), totalRows: z.number(), importedRows: z.number(), rejectedRows: z.number(), duplicateRows: z.number(), errorSummary: z.string().nullable(), uploadedAt: z.string(), replacementOfFileId: z.number().nullable() })) }),
    async handler(ctx, args) {
      await requireUser(ctx, args.token, "imports.read"); const db = ctx.db<typeof schema>();
      const batchRows = await db.select().from(schema.importBatches).where(eq(schema.importBatches.id, args.importBatchId)).limit(1); const batch = batchRows[0]; if (!batch) throw new Error("Import batch not found.");
      const files = await db.select().from(schema.sourceFiles).where(eq(schema.sourceFiles.importBatchId, batch.id)).orderBy(asc(schema.sourceFiles.id));
      const sampleRows = await db.select().from(schema.importRows).where(eq(schema.importRows.importBatchId, batch.id)).limit(20);
      const headerSet = new Set<string>(); for (const row of sampleRows) for (const key of Object.keys(decodeJsonRecord(row.rawPayload))) headerSet.add(key);
      const headers = [...headerSet]; const sourceType = batch.sourceType as SourceType;
      return { ...batch, headers, mapping: batch.mappingJson ? JSON.parse(batch.mappingJson) as Record<string, string> : automaticMapping(sourceType, headers), businessKeys: batch.businessKeysJson ? JSON.parse(batch.businessKeysJson) as string[] : DEFAULT_BUSINESS_KEYS[sourceType], files: files.map((file) => ({ ...file, uploadedAt: file.uploadedAt.toISOString() })) };
    },
  }),

  beginImportValidation: defineAction({
    request: authRequest.extend({ importBatchId: z.number().int().positive(), mapping: z.record(z.string(), z.string()), businessKeys: z.array(z.string()).min(1).max(8), saveTemplateName: z.string().trim().max(120).optional().nullable() }),
    response: z.object({ ok: z.boolean() }),
    async handler(ctx, args) {
      const actor = await requireUser(ctx, args.token, "imports.manage"); const db = ctx.db<typeof schema>();
      const batchRows = await db.select().from(schema.importBatches).where(eq(schema.importBatches.id, args.importBatchId)).limit(1); const batch = batchRows[0]; if (!batch) throw new Error("Import batch not found.");
      const sourceType = batch.sourceType as SourceType; const fields = CANONICAL_FIELDS[sourceType]; const fieldKeys = new Set(fields.map((field) => field.key));
      for (const required of fields.filter((field) => field.required)) if (!args.mapping[required.key]) throw new Error(`${required.label} must be mapped before validation.`);
      for (const key of args.businessKeys) if (!fieldKeys.has(key)) throw new Error(`Business key ${key} is not valid for this source type.`);
      await db.update(schema.importRows).set({ validationStatus: "pending", normalizedPayload: null, businessKey: null, validationErrors: null }).where(eq(schema.importRows.importBatchId, batch.id));
      await db.update(schema.importBatches).set({ mappingJson: JSON.stringify(args.mapping), businessKeysJson: JSON.stringify(args.businessKeys), status: "processing", validRows: 0, rejectedRows: 0, duplicateRows: 0, errorSummary: null, updatedAt: new Date() }).where(eq(schema.importBatches.id, batch.id));
      if (args.saveTemplateName) await db.insert(schema.columnMappingTemplates).values({ name: args.saveTemplateName, sourceType, projectId: batch.projectId, mappingJson: JSON.stringify(args.mapping), businessKeysJson: JSON.stringify(args.businessKeys), delimiter: batch.delimiter, createdBy: actor.userId }).onConflictDoUpdate({ target: [schema.columnMappingTemplates.sourceType, schema.columnMappingTemplates.projectId, schema.columnMappingTemplates.name], set: { mappingJson: JSON.stringify(args.mapping), businessKeysJson: JSON.stringify(args.businessKeys), delimiter: batch.delimiter, updatedAt: new Date() } });
      await audit(ctx, actor.userId, "begin_validation", "import_batch", String(batch.id), { mapping: args.mapping, businessKeys: args.businessKeys, savedTemplate: args.saveTemplateName ?? null });
      ctx.invalidateQueries(); return { ok: true };
    },
  }),

  validateImportChunk: defineAction({
    request: authRequest.extend({ importBatchId: z.number().int().positive(), cursor: z.number().int().min(0).default(0), limit: z.number().int().min(25).max(500).default(250) }),
    response: z.object({ done: z.boolean(), nextCursor: z.number(), processed: z.number(), totalRows: z.number(), validRows: z.number(), rejectedRows: z.number(), duplicateRows: z.number() }),
    async handler(ctx, args) {
      await requireUser(ctx, args.token, "imports.manage"); const db = ctx.db<typeof schema>();
      const batchRows = await db.select().from(schema.importBatches).where(eq(schema.importBatches.id, args.importBatchId)).limit(1); const batch = batchRows[0]; if (!batch || !batch.mappingJson || !batch.businessKeysJson) throw new Error("Save the column mapping before validating rows.");
      const sourceType = batch.sourceType as SourceType; const mapping = JSON.parse(batch.mappingJson) as Record<string, string>; const businessKeys = JSON.parse(batch.businessKeysJson) as string[];
      const rows = await db.select().from(schema.importRows).where(and(eq(schema.importRows.importBatchId, batch.id), gt(schema.importRows.id, args.cursor))).orderBy(asc(schema.importRows.id)).limit(args.limit);
      const existing = await db.select({ businessKey: schema.normalizedImportRows.businessKey }).from(schema.normalizedImportRows).where(and(eq(schema.normalizedImportRows.payrollPeriodId, batch.payrollPeriodId), eq(schema.normalizedImportRows.projectId, batch.projectId), eq(schema.normalizedImportRows.sourceType, sourceType), eq(schema.normalizedImportRows.active, true)));
      const seen = new Set(existing.map((row) => row.businessKey));
      const earlier = await db.select({ businessKey: schema.importRows.businessKey }).from(schema.importRows).where(and(eq(schema.importRows.importBatchId, batch.id), eq(schema.importRows.validationStatus, "valid")));
      for (const row of earlier) if (row.businessKey) seen.add(row.businessKey);
      for (const row of rows) {
        const raw = decodeJsonRecord(row.rawPayload); const result = validateAndNormalize(sourceType, raw, mapping); const key = businessKeyFor(result.normalized, businessKeys);
        if (!key.replace(/\|/g, "")) result.errors.push("The configured business key is empty.");
        const duplicate = !result.errors.length && seen.has(key); const validationStatus = result.errors.length ? "rejected" as const : duplicate ? "duplicate" as const : "valid" as const;
        if (validationStatus === "valid") seen.add(key);
        await db.update(schema.importRows).set({ normalizedPayload: JSON.stringify(result.normalized), businessKey: key || null, validationStatus, validationErrors: result.errors.length ? JSON.stringify(result.errors) : duplicate ? JSON.stringify(["Potential duplicate business key."]) : null }).where(eq(schema.importRows.id, row.id));
      }
      const counts = await refreshImportCounts(ctx, batch.id); const last = rows[rows.length - 1]; const done = rows.length < args.limit;
      if (done) await db.update(schema.importBatches).set({ status: "ready", updatedAt: new Date() }).where(eq(schema.importBatches.id, batch.id));
      ctx.invalidateQueries();
      return { done, nextCursor: last?.id ?? args.cursor, processed: rows.length, ...counts };
    },
  }),

  listImportPreview: defineAction({
    request: authRequest.extend({ importBatchId: z.number().int().positive(), status: z.enum(["all", "valid", "rejected", "duplicate"]).default("all"), page: z.number().int().min(1).default(1), pageSize: z.number().int().min(5).max(50).default(20) }),
    response: z.object({ total: z.number(), rows: z.array(z.object({ id: z.number(), sourceFileName: z.string(), sourceRowNumber: z.number(), status: z.string(), businessKey: z.string().nullable(), errors: z.array(z.string()), normalized: z.record(z.string(), z.string().nullable()) })) }),
    async handler(ctx, args) {
      await requireUser(ctx, args.token, "imports.read"); const db = ctx.db<typeof schema>();
      const allRows = await db.select().from(schema.importRows).where(eq(schema.importRows.importBatchId, args.importBatchId)).orderBy(asc(schema.importRows.id));
      const files = await db.select().from(schema.sourceFiles).where(eq(schema.sourceFiles.importBatchId, args.importBatchId));
      const filtered = args.status === "all" ? allRows : allRows.filter((row) => row.validationStatus === args.status); const start = (args.page - 1) * args.pageSize;
      return { total: filtered.length, rows: filtered.slice(start, start + args.pageSize).map((row) => ({ id: row.id, sourceFileName: files.find((file) => file.id === row.sourceFileId)?.originalFilename ?? "Unknown file", sourceRowNumber: row.sourceRowNumber, status: row.validationStatus, businessKey: row.businessKey, errors: row.validationErrors ? JSON.parse(row.validationErrors) as string[] : [], normalized: row.normalizedPayload ? JSON.parse(row.normalizedPayload) as Record<string, string | null> : {} })) };
    },
  }),

  commitImportChunk: defineAction({
    request: authRequest.extend({ importBatchId: z.number().int().positive(), cursor: z.number().int().min(0).default(0), limit: z.number().int().min(25).max(250).default(100), includeDuplicateCandidates: z.boolean().default(false) }),
    response: z.object({ done: z.boolean(), nextCursor: z.number(), inserted: z.number() }),
    async handler(ctx, args) {
      const actor = await requireUser(ctx, args.token, "imports.manage"); const db = ctx.db<typeof schema>();
      const batchRows = await db.select().from(schema.importBatches).where(eq(schema.importBatches.id, args.importBatchId)).limit(1); const batch = batchRows[0]; if (!batch || !["ready", "processing"].includes(batch.status)) throw new Error("Validate the import before committing it.");
      await db.update(schema.importBatches).set({ status: "processing", updatedAt: new Date() }).where(eq(schema.importBatches.id, batch.id));
      const candidates = await db.select().from(schema.importRows).where(and(eq(schema.importRows.importBatchId, batch.id), gt(schema.importRows.id, args.cursor))).orderBy(asc(schema.importRows.id)).limit(args.limit);
      const allowed = candidates.filter((row) => row.validationStatus === "valid" || (args.includeDuplicateCandidates && row.validationStatus === "duplicate"));
      let inserted = 0;
      for (let start = 0; start < allowed.length; start += 25) {
        const values = allowed.slice(start, start + 25).flatMap((row) => {
          if (!row.normalizedPayload || !row.businessKey) return [];
          const n = JSON.parse(row.normalizedPayload) as Record<string, string | null>;
          return [{ importBatchId: batch.id, sourceFileId: row.sourceFileId, payrollPeriodId: batch.payrollPeriodId, projectId: batch.projectId, sourceType: batch.sourceType, sourceRowNumber: row.sourceRowNumber, employeeId: n.employeeId ?? null, employeeName: n.employeeName ?? null, entryEmployeeId: n.entryEmployeeId ?? null, proofEmployeeId: n.proofEmployeeId ?? null, batchId: n.batchId ?? null, clientBatchId: n.clientBatchId ?? null, productionDate: n.productionDate ?? null, country: n.country ?? null, workType: n.workType ?? null, keyType: n.keyType ?? null, recordCount: n.recordCount ?? null, characterCount: n.characterCount ?? null, imageCount: n.imageCount ?? null, transmittedStatus: n.transmittedStatus ?? null, originalPayload: row.rawPayload, normalizedPayload: row.normalizedPayload, businessKey: row.businessKey, active: false }];
        });
        if (values.length) { const result = await db.insert(schema.normalizedImportRows).values(values).onConflictDoNothing().returning({ id: schema.normalizedImportRows.id }); inserted += result.length; }
        for (const sourceRow of allowed.slice(start, start + 25)) await persistProductionRow(ctx, batch, sourceRow);
      }
      const last = candidates[candidates.length - 1]; const done = candidates.length < args.limit;
      if (done) {
        const files = await db.select().from(schema.sourceFiles).where(eq(schema.sourceFiles.importBatchId, batch.id));
        const replacements = files.map((file) => file.replacementOfFileId).filter((id): id is number => Boolean(id));
        for (const replacementId of replacements) {
          const reversedAt = new Date();
          await db.update(schema.normalizedImportRows).set({ active: false, reversedAt }).where(eq(schema.normalizedImportRows.sourceFileId, replacementId));
          await db.update(schema.recordDetails).set({ active: false, reversedAt }).where(eq(schema.recordDetails.sourceFileId, replacementId));
          await db.update(schema.doctypeRecords).set({ active: false, reversedAt }).where(eq(schema.doctypeRecords.sourceFileId, replacementId));
          await db.update(schema.proofRecords).set({ active: false, reversedAt }).where(eq(schema.proofRecords.sourceFileId, replacementId));
          await db.update(schema.transmittedBatches).set({ active: false, reversedAt }).where(eq(schema.transmittedBatches.sourceFileId, replacementId));
          await db.update(schema.shipdetBatches).set({ active: false, reversedAt }).where(eq(schema.shipdetBatches.sourceFileId, replacementId));
          await db.update(schema.sourceFiles).set({ status: "reversed", reversedAt }).where(eq(schema.sourceFiles.id, replacementId));
        }
        await db.update(schema.normalizedImportRows).set({ active: true }).where(eq(schema.normalizedImportRows.importBatchId, batch.id));
        await db.update(schema.recordDetails).set({ active: true }).where(eq(schema.recordDetails.importBatchId, batch.id));
        await db.update(schema.doctypeRecords).set({ active: true }).where(eq(schema.doctypeRecords.importBatchId, batch.id));
        await db.update(schema.proofRecords).set({ active: true }).where(eq(schema.proofRecords.importBatchId, batch.id));
        await db.update(schema.transmittedBatches).set({ active: true }).where(eq(schema.transmittedBatches.importBatchId, batch.id));
        await db.update(schema.shipdetBatches).set({ active: true }).where(eq(schema.shipdetBatches.importBatchId, batch.id));
        const normalized = await db.select().from(schema.normalizedImportRows).where(eq(schema.normalizedImportRows.importBatchId, batch.id));
        for (const file of files) {
          const sourceRows = await db.select().from(schema.importRows).where(eq(schema.importRows.sourceFileId, file.id));
          await db.update(schema.sourceFiles).set({ status: "committed", importedRows: normalized.filter((row) => row.sourceFileId === file.id).length, rejectedRows: sourceRows.filter((row) => row.validationStatus === "rejected").length, duplicateRows: sourceRows.filter((row) => row.validationStatus === "duplicate").length }).where(eq(schema.sourceFiles.id, file.id));
        }
        await db.update(schema.importBatches).set({ status: "committed", committedAt: new Date(), updatedAt: new Date() }).where(eq(schema.importBatches.id, batch.id));
        await audit(ctx, actor.userId, "commit", "import_batch", String(batch.id), { importedRows: normalized.length, rejectedRows: batch.rejectedRows, duplicateRows: batch.duplicateRows, replacements });
      }
      ctx.invalidateQueries(); return { done, nextCursor: last?.id ?? args.cursor, inserted };
    },
  }),

  listImportHistory: defineAction({
    request: authRequest.extend({ payrollPeriodId: z.number().int().positive().optional().nullable(), projectId: z.number().int().positive().optional().nullable(), sourceType: sourceTypeSchema.optional().nullable(), status: z.string().max(40).optional().nullable() }),
    response: z.object({ batches: z.array(z.object({ id: z.number(), batchId: z.string(), periodCode: z.string(), projectCode: z.string(), sourceType: z.string(), status: z.string(), totalFiles: z.number(), totalRows: z.number(), validRows: z.number(), rejectedRows: z.number(), duplicateRows: z.number(), uploadedBy: z.string(), createdAt: z.string(), committedAt: z.string().nullable() })) }),
    async handler(ctx, args) {
      await requireUser(ctx, args.token, "imports.read"); const db = ctx.db<typeof schema>();
      const [batches, periods, projects, users] = await Promise.all([db.select().from(schema.importBatches).orderBy(desc(schema.importBatches.id)), db.select().from(schema.payrollPeriods), db.select().from(schema.projects), db.select().from(schema.users)]);
      const filtered = batches.filter((batch) => (!args.payrollPeriodId || batch.payrollPeriodId === args.payrollPeriodId) && (!args.projectId || batch.projectId === args.projectId) && (!args.sourceType || batch.sourceType === args.sourceType) && (!args.status || batch.status === args.status));
      return { batches: filtered.map((batch) => ({ id: batch.id, batchId: batch.batchId, periodCode: periods.find((period) => period.id === batch.payrollPeriodId)?.periodId ?? "Unknown period", projectCode: projects.find((project) => project.id === batch.projectId)?.projectId ?? "Unknown project", sourceType: batch.sourceType, status: batch.status, totalFiles: batch.totalFiles, totalRows: batch.totalRows, validRows: batch.validRows, rejectedRows: batch.rejectedRows, duplicateRows: batch.duplicateRows, uploadedBy: users.find((user) => user.id === batch.uploadedBy)?.name ?? "Unknown user", createdAt: batch.createdAt.toISOString(), committedAt: batch.committedAt?.toISOString() ?? null })) };
    },
  }),

  reprocessImportBatch: defineAction({
    request: authRequest.extend({ importBatchId: z.number().int().positive(), reason: z.string().trim().min(3).max(500) }),
    response: z.object({ batchId: z.number() }),
    async handler(ctx, args) {
      const actor = await requireUser(ctx, args.token, "imports.manage"); const db = ctx.db<typeof schema>();
      const oldRows = await db.select().from(schema.importBatches).where(eq(schema.importBatches.id, args.importBatchId)).limit(1); const old = oldRows[0]; if (!old || old.status !== "committed") throw new Error("Only a committed import can be reprocessed.");
      const code = `IMP-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;
      const created = await db.insert(schema.importBatches).values({ batchId: code, payrollPeriodId: old.payrollPeriodId, projectId: old.projectId, sourceType: old.sourceType as SourceType, delimiter: old.delimiter, mappingJson: old.mappingJson, businessKeysJson: old.businessKeysJson, status: "mapping_required", totalFiles: old.totalFiles, uploadedBy: actor.userId }).returning({ id: schema.importBatches.id });
      const next = created[0]; if (!next) throw new Error("Reprocessing batch could not be created.");
      const oldFiles = await db.select().from(schema.sourceFiles).where(eq(schema.sourceFiles.importBatchId, old.id));
      for (const file of oldFiles) {
        const cloned = await db.insert(schema.sourceFiles).values({ sourceFileId: `SRC-${crypto.randomUUID().slice(0, 12).toUpperCase()}`, importBatchId: next.id, payrollPeriodId: file.payrollPeriodId, projectId: file.projectId, sourceType: file.sourceType, originalFilename: file.originalFilename, fileHash: file.fileHash, mimeType: file.mimeType, sizeBytes: file.sizeBytes, expectedChunks: file.expectedChunks, uploadedChunks: file.expectedChunks, blobKey: file.blobKey, status: "ready", totalRows: file.totalRows, replacementOfFileId: file.id, uploadedBy: actor.userId, processedAt: new Date() }).returning({ id: schema.sourceFiles.id });
        const nextFile = cloned[0]; if (!nextFile) throw new Error("A source file could not be prepared for reprocessing.");
        const rawRows = await db.select().from(schema.importRows).where(eq(schema.importRows.sourceFileId, file.id)).orderBy(asc(schema.importRows.id));
        for (let start = 0; start < rawRows.length; start += 100) { const values = rawRows.slice(start, start + 100).map((row) => ({ importBatchId: next.id, sourceFileId: nextFile.id, sourceRowNumber: row.sourceRowNumber, rawPayload: row.rawPayload, validationStatus: "pending" as const })); if (values.length) await db.insert(schema.importRows).values(values); }
      }
      await refreshImportCounts(ctx, next.id); await audit(ctx, actor.userId, "reprocess", "import_batch", String(old.id), { newBatchId: next.id }, undefined, args.reason); ctx.invalidateQueries(); return { batchId: next.id };
    },
  }),

  reverseImportBatch: defineAction({
    request: authRequest.extend({ importBatchId: z.number().int().positive(), reason: z.string().trim().min(3).max(500) }),
    response: z.object({ ok: z.boolean() }),
    async handler(ctx, args) {
      const actor = await requireUser(ctx, args.token, "imports.manage"); const db = ctx.db<typeof schema>();
      const batches = await db.select().from(schema.importBatches).where(eq(schema.importBatches.id, args.importBatchId)).limit(1); const batch = batches[0]; if (!batch || batch.status !== "committed") throw new Error("Only a committed import can be reversed.");
      const periodRows = await db.select().from(schema.payrollPeriods).where(eq(schema.payrollPeriods.id, batch.payrollPeriodId)).limit(1); if (["Approved", "Locked", "Exported"].includes(periodRows[0]?.status ?? "")) throw new Error("This import belongs to a protected payroll period and cannot be reversed.");
      const reversedAt = new Date();
      await db.update(schema.normalizedImportRows).set({ active: false, reversedAt }).where(eq(schema.normalizedImportRows.importBatchId, batch.id));
      await db.update(schema.recordDetails).set({ active: false, reversedAt }).where(eq(schema.recordDetails.importBatchId, batch.id));
      await db.update(schema.doctypeRecords).set({ active: false, reversedAt }).where(eq(schema.doctypeRecords.importBatchId, batch.id));
      await db.update(schema.proofRecords).set({ active: false, reversedAt }).where(eq(schema.proofRecords.importBatchId, batch.id));
      await db.update(schema.transmittedBatches).set({ active: false, reversedAt }).where(eq(schema.transmittedBatches.importBatchId, batch.id));
      await db.update(schema.shipdetBatches).set({ active: false, reversedAt }).where(eq(schema.shipdetBatches.importBatchId, batch.id));
      await db.update(schema.sourceFiles).set({ status: "reversed", reversedAt }).where(eq(schema.sourceFiles.importBatchId, batch.id));
      await db.update(schema.importBatches).set({ status: "reversed", updatedAt: new Date() }).where(eq(schema.importBatches.id, batch.id));
      await audit(ctx, actor.userId, "reverse", "import_batch", String(batch.id), { active: false }, { active: true }, args.reason); ctx.invalidateQueries(); return { ok: true };
    },
  }),

  downloadImportErrors: defineAction({
    request: authRequest.extend({ importBatchId: z.number().int().positive() }),
    response: z.object({ filename: z.string(), content: z.string(), rowCount: z.number() }),
    async handler(ctx, args) {
      await requireUser(ctx, args.token, "imports.read"); const db = ctx.db<typeof schema>();
      const batches = await db.select().from(schema.importBatches).where(eq(schema.importBatches.id, args.importBatchId)).limit(1); const batch = batches[0]; if (!batch) throw new Error("Import batch not found.");
      const [rows, files] = await Promise.all([db.select().from(schema.importRows).where(eq(schema.importRows.importBatchId, batch.id)).orderBy(asc(schema.importRows.id)), db.select().from(schema.sourceFiles).where(eq(schema.sourceFiles.importBatchId, batch.id))]);
      const failures = rows.filter((row) => row.validationStatus === "rejected");
      const lines = [["Source File ID", "Original Filename", "Source Row", "Reasons", "Original Source Payload"].map(safeCsvCell).join(",")];
      for (const row of failures) { const file = files.find((candidate) => candidate.id === row.sourceFileId); lines.push([file?.sourceFileId ?? "", file?.originalFilename ?? "", row.sourceRowNumber, row.validationErrors ? (JSON.parse(row.validationErrors) as string[]).join("; ") : "Validation failed", row.rawPayload].map(safeCsvCell).join(",")); }
      return { filename: `${batch.batchId}-error-report.csv`, content: `\uFEFF${lines.join("\r\n")}`, rowCount: failures.length };
    },
  }),

  getProductionConfiguration: defineAction({
    request: authRequest.extend({ projectId: z.number().int().positive() }),
    response: z.object({ doctypeEnabled: z.boolean(), proofEnabled: z.boolean(), allowKeyVariantDoubleCount: z.boolean(), proofTypes: z.array(z.string()), statusMappings: z.record(z.string(), z.string()) }),
    async handler(ctx, args) {
      await requireUser(ctx, args.token, "production.read");
      return getProductionConfig(ctx, args.projectId);
    },
  }),

  saveProductionConfiguration: defineAction({
    request: authRequest.extend({ projectId: z.number().int().positive(), doctypeEnabled: z.boolean(), proofEnabled: z.boolean(), allowKeyVariantDoubleCount: z.boolean(), proofTypes: z.array(z.string().trim().min(2).max(120)).max(50), statusMappings: z.record(z.string(), z.string()) }),
    response: z.object({ ok: z.literal(true) }),
    async handler(ctx, args): Promise<{ ok: true }> {
      const actor = await requireUser(ctx, args.token, "production.manage"); const db = ctx.db<typeof schema>();
      const cleanProofTypes = [...new Set(args.proofTypes.map((item) => item.trim()).filter(Boolean))];
      const cleanMappings = Object.fromEntries(Object.entries(args.statusMappings).map(([key, value]) => [key.trim().toLowerCase(), value.trim().toLowerCase()]).filter(([key, value]) => key && value));
      const existing = await db.select().from(schema.projectProductionConfigurations).where(eq(schema.projectProductionConfigurations.projectId, args.projectId)).limit(1);
      const values = { doctypeEnabled: args.doctypeEnabled, proofEnabled: args.proofEnabled, allowKeyVariantDoubleCount: args.allowKeyVariantDoubleCount, proofTypesJson: JSON.stringify(cleanProofTypes), statusMappingsJson: JSON.stringify(cleanMappings), updatedBy: actor.userId, updatedAt: new Date() };
      if (existing[0]) await db.update(schema.projectProductionConfigurations).set(values).where(eq(schema.projectProductionConfigurations.id, existing[0].id));
      else await db.insert(schema.projectProductionConfigurations).values({ projectId: args.projectId, ...values });
      await audit(ctx, actor.userId, existing[0] ? "update" : "create", "production_configuration", String(args.projectId), { ...args, proofTypes: cleanProofTypes, statusMappings: cleanMappings }, existing[0]);
      ctx.invalidateQueries(); return { ok: true };
    },
  }),

  getProductionOverview: defineAction({
    request: authRequest.extend({ payrollPeriodId: z.number().int().positive().optional().nullable(), projectId: z.number().int().positive().optional().nullable() }),
    response: z.object({ recordDetails: z.number(), categoryQuantities: z.number(), doctype: z.number(), proof: z.number(), transmitted: z.number(), shipdet: z.number(), pendingShipdet: z.number(), openExceptions: z.number(), blockingExceptions: z.number() }),
    async handler(ctx, args) {
      await requireUser(ctx, args.token, "production.read"); const db = ctx.db<typeof schema>();
      const [records, categories, doctypes, proofs, transmitted, shipdet, exceptions] = await Promise.all([db.select().from(schema.recordDetails), db.select().from(schema.recordCategoryQuantities), db.select().from(schema.doctypeRecords), db.select().from(schema.proofRecords), db.select().from(schema.transmittedBatches), db.select().from(schema.shipdetBatches), db.select().from(schema.productionExceptions)]);
      const scope = <T extends { payrollPeriodId: number; projectId: number; active: boolean }>(rows: T[]) => rows.filter((row) => row.active && (!args.payrollPeriodId || row.payrollPeriodId === args.payrollPeriodId) && (!args.projectId || row.projectId === args.projectId));
      const scopedRecords = scope(records); const recordIds = new Set(scopedRecords.map((row) => row.id)); const scopedShipdet = scope(shipdet);
      const scopedExceptions = exceptions.filter((row) => row.resolutionStatus === "open" && (!args.payrollPeriodId || row.payrollPeriodId === args.payrollPeriodId) && (!args.projectId || row.projectId === args.projectId));
      return { recordDetails: scopedRecords.length, categoryQuantities: categories.filter((row) => recordIds.has(row.recordDetailId)).length, doctype: scope(doctypes).length, proof: scope(proofs).length, transmitted: scope(transmitted).length, shipdet: scopedShipdet.length, pendingShipdet: scopedShipdet.filter((row) => row.reviewStatus === "pending").length, openExceptions: scopedExceptions.length, blockingExceptions: scopedExceptions.filter((row) => row.severity === "blocking").length };
    },
  }),

  listRecordDetails: defineAction({
    request: authRequest.extend({ payrollPeriodId: z.number().int().positive().optional().nullable(), projectId: z.number().int().positive().optional().nullable(), country: z.string().max(30).optional().nullable(), employee: z.string().max(100).optional().nullable(), batch: z.string().max(160).optional().nullable(), workType: z.string().max(120).optional().nullable(), keyType: z.string().max(120).optional().nullable(), category: z.string().max(120).optional().nullable(), sourceFile: z.string().max(260).optional().nullable(), dateFrom: isoDate.optional().nullable(), dateTo: isoDate.optional().nullable(), sortBy: z.enum(["productionDate", "employeeIdentifier", "internalBatchId", "recordCount", "characterCount", "sourceRowNumber"]).default("productionDate"), direction: z.enum(["asc", "desc"]).default("desc"), page: z.number().int().min(1).default(1), pageSize: z.number().int().min(10).max(100).default(25) }),
    response: z.object({ total: z.number(), page: z.number(), pageSize: z.number(), rows: z.array(z.object({ id: z.number(), periodCode: z.string(), projectCode: z.string(), sourceFile: z.string(), sourceRowNumber: z.number(), sourceVariant: z.string(), internalBatchId: z.string().nullable(), clientBatchId: z.string().nullable(), employeeIdentifier: z.string().nullable(), employeeName: z.string().nullable(), employeeMatched: z.boolean(), productionDate: z.string().nullable(), country: z.string().nullable(), entryGroup: z.string().nullable(), workType: z.string().nullable(), keyType: z.string().nullable(), recordCount: z.string().nullable(), characterCount: z.string().nullable(), documentReference: z.string().nullable(), reviewKeyIdentifier: z.string().nullable(), fullKeyIdentifier: z.string().nullable(), payableState: z.string(), categories: z.array(z.object({ code: z.string(), name: z.string(), unit: z.string(), quantity: z.string(), sourceColumn: z.string() })) })) }),
    async handler(ctx, args) {
      await requireUser(ctx, args.token, "production.read"); const db = ctx.db<typeof schema>();
      const [records, quantities, files, periods, projects] = await Promise.all([db.select().from(schema.recordDetails), db.select().from(schema.recordCategoryQuantities), db.select().from(schema.sourceFiles), db.select().from(schema.payrollPeriods), db.select().from(schema.projects)]);
      const textMatch = (value: string | null, query: string | null | undefined) => !query || String(value ?? "").toLowerCase().includes(query.toLowerCase());
      let rows = records.filter((row) => row.active && (!args.payrollPeriodId || row.payrollPeriodId === args.payrollPeriodId) && (!args.projectId || row.projectId === args.projectId) && textMatch(row.country, args.country) && (textMatch(row.employeeIdentifier, args.employee) || textMatch(row.employeeName, args.employee)) && (textMatch(row.internalBatchId, args.batch) || textMatch(row.clientBatchId, args.batch)) && textMatch(row.workType, args.workType) && textMatch(row.keyType, args.keyType) && (!args.sourceFile || textMatch(files.find((file) => file.id === row.sourceFileId)?.originalFilename ?? null, args.sourceFile)) && (!args.dateFrom || (row.productionDate ?? "") >= args.dateFrom) && (!args.dateTo || (row.productionDate ?? "") <= args.dateTo));
      if (args.category) rows = rows.filter((row) => quantities.some((q) => q.recordDetailId === row.id && (q.categoryCode.toLowerCase().includes(args.category!.toLowerCase()) || q.categoryName.toLowerCase().includes(args.category!.toLowerCase()))));
      const direction = args.direction === "asc" ? 1 : -1; rows.sort((a, b) => String(a[args.sortBy] ?? "").localeCompare(String(b[args.sortBy] ?? ""), undefined, { numeric: true }) * direction);
      const total = rows.length; const paged = rows.slice((args.page - 1) * args.pageSize, args.page * args.pageSize);
      return { total, page: args.page, pageSize: args.pageSize, rows: paged.map((row) => ({ id: row.id, periodCode: periods.find((p) => p.id === row.payrollPeriodId)?.periodId ?? "Unknown", projectCode: projects.find((p) => p.id === row.projectId)?.projectId ?? "Unknown", sourceFile: files.find((file) => file.id === row.sourceFileId)?.originalFilename ?? "Unknown", sourceRowNumber: row.sourceRowNumber, sourceVariant: row.sourceVariant, internalBatchId: row.internalBatchId, clientBatchId: row.clientBatchId, employeeIdentifier: row.employeeIdentifier, employeeName: row.employeeName, employeeMatched: row.employeeRecordId !== null, productionDate: row.productionDate, country: row.country, entryGroup: row.entryGroup, workType: row.workType, keyType: row.keyType, recordCount: row.recordCount, characterCount: row.characterCount, documentReference: row.documentReference, reviewKeyIdentifier: row.reviewKeyIdentifier, fullKeyIdentifier: row.fullKeyIdentifier, payableState: row.payableState, categories: quantities.filter((q) => q.recordDetailId === row.id).map((q) => ({ code: q.categoryCode, name: q.categoryName, unit: q.quantityUnit, quantity: q.quantity, sourceColumn: q.sourceColumn })) })) };
    },
  }),

  getRecordDetail: defineAction({
    request: authRequest.extend({ id: z.number().int().positive() }),
    response: z.object({ id: z.number(), sourceFile: z.string(), sourceRowNumber: z.number(), sourceVariant: z.string(), originalPayload: z.record(z.string(), z.unknown()), categories: z.array(z.object({ code: z.string(), name: z.string(), unit: z.string(), quantity: z.string(), sourceColumn: z.string() })) }),
    async handler(ctx, args) {
      await requireUser(ctx, args.token, "production.read"); const db = ctx.db<typeof schema>(); const rows = await db.select().from(schema.recordDetails).where(eq(schema.recordDetails.id, args.id)).limit(1); const row = rows[0]; if (!row || !row.active) throw new Error("Record Details row not found.");
      const [file] = await db.select().from(schema.sourceFiles).where(eq(schema.sourceFiles.id, row.sourceFileId)).limit(1); const quantities = await db.select().from(schema.recordCategoryQuantities).where(eq(schema.recordCategoryQuantities.recordDetailId, row.id));
      let payload: Record<string, unknown> = {}; try { payload = JSON.parse(row.originalSourcePayload) as Record<string, unknown>; } catch { payload = {}; }
      return { id: row.id, sourceFile: file?.originalFilename ?? "Unknown", sourceRowNumber: row.sourceRowNumber, sourceVariant: row.sourceVariant, originalPayload: payload, categories: quantities.map((q) => ({ code: q.categoryCode, name: q.categoryName, unit: q.quantityUnit, quantity: q.quantity, sourceColumn: q.sourceColumn })) };
    },
  }),

  listProductionStream: defineAction({
    request: authRequest.extend({ stream: z.enum(["doctype", "proof", "transmitted_batch", "shipdet"]), payrollPeriodId: z.number().int().positive().optional().nullable(), projectId: z.number().int().positive().optional().nullable(), search: z.string().max(160).default(""), page: z.number().int().min(1).default(1), pageSize: z.number().int().min(10).max(100).default(25) }),
    response: z.object({ total: z.number(), page: z.number(), pageSize: z.number(), rows: z.array(z.object({ id: z.number(), sourceFile: z.string(), sourceRowNumber: z.number(), periodCode: z.string(), projectCode: z.string(), fields: z.record(z.string(), z.string().nullable()) })) }),
    async handler(ctx, args) {
      await requireUser(ctx, args.token, "production.read"); const db = ctx.db<typeof schema>(); const [files, periods, projects] = await Promise.all([db.select().from(schema.sourceFiles), db.select().from(schema.payrollPeriods), db.select().from(schema.projects)]);
      let raw: Array<{ id: number; sourceFileId: number; sourceRowNumber: number; payrollPeriodId: number; projectId: number; active: boolean; fields: Record<string, string | null> }> = [];
      if (args.stream === "doctype") raw = (await db.select().from(schema.doctypeRecords)).map((row) => ({ ...row, fields: { batchId: row.batchId, employeeId: row.employeeIdentifier, employeeMatch: row.employeeRecordId ? "Matched" : "Exception", documentCount: row.documentCount, imageCount: row.imageCount, workType: row.workType, country: row.country, status: row.status } }));
      if (args.stream === "proof") raw = (await db.select().from(schema.proofRecords)).map((row) => ({ ...row, fields: { batchId: row.batchId, entryEmployeeId: row.entryEmployeeIdentifier, entryMatch: row.entryEmployeeRecordId ? "Matched" : "Exception", proofEmployeeId: row.proofEmployeeIdentifier, proofMatch: row.proofEmployeeRecordId ? "Matched" : "Exception", proofType: row.proofType, recordQuantity: row.recordQuantity, characterQuantity: row.characterQuantity, adjustment: row.adjustment, country: row.country, keyType: row.keyType } }));
      if (args.stream === "transmitted_batch") raw = (await db.select().from(schema.transmittedBatches)).map((row) => ({ ...row, fields: { internalBatchId: row.internalBatchId, clientBatchId: row.clientBatchId, batchName: row.batchName, country: row.country, recordCount: row.recordCount, characterCount: row.characterCount, imageCount: row.imageCount, transmittedDate: row.transmittedDate, transmissionStatus: row.transmissionStatus, acceptanceStatus: row.clientAcceptanceStatus, produced: row.producedState, shipped: row.shippedState, billable: row.billableState, salaryApproved: row.salaryApprovalState, workType: row.workType } }));
      if (args.stream === "shipdet") raw = (await db.select().from(schema.shipdetBatches)).map((row) => ({ ...row, fields: { clientProjectName: row.clientProjectName, internalBatchId: row.internalBatchId, clientBatchId: row.clientBatchId, shipmentBatchId: row.shipmentBatchId, shipmentDate: row.shipmentDate, recordCount: row.recordCount, characterCount: row.characterCount, imageCount: row.imageCount, billableQuantity: row.billableQuantity, acceptanceStatus: row.acceptanceStatus, reviewStatus: row.reviewStatus } }));
      const q = args.search.trim().toLowerCase(); const filtered = raw.filter((row) => row.active && (!args.payrollPeriodId || row.payrollPeriodId === args.payrollPeriodId) && (!args.projectId || row.projectId === args.projectId) && (!q || Object.values(row.fields).some((value) => String(value ?? "").toLowerCase().includes(q))));
      const total = filtered.length; const paged = filtered.slice((args.page - 1) * args.pageSize, args.page * args.pageSize);
      return { total, page: args.page, pageSize: args.pageSize, rows: paged.map((row) => ({ id: row.id, sourceFile: files.find((file) => file.id === row.sourceFileId)?.originalFilename ?? "Unknown", sourceRowNumber: row.sourceRowNumber, periodCode: periods.find((period) => period.id === row.payrollPeriodId)?.periodId ?? "Unknown", projectCode: projects.find((project) => project.id === row.projectId)?.projectId ?? "Unknown", fields: row.fields })) };
    },
  }),

  listProductionExceptions: defineAction({
    request: authRequest.extend({ payrollPeriodId: z.number().int().positive().optional().nullable(), projectId: z.number().int().positive().optional().nullable(), stream: z.string().max(50).optional().nullable(), status: z.enum(["open", "resolved"]).default("open"), page: z.number().int().min(1).default(1), pageSize: z.number().int().min(10).max(100).default(25) }),
    response: z.object({ total: z.number(), rows: z.array(z.object({ id: z.number(), periodCode: z.string(), projectCode: z.string(), sourceFile: z.string().nullable(), sourceRowNumber: z.number().nullable(), stream: z.string(), severity: z.string(), code: z.string(), employeeIdentifier: z.string().nullable(), batchIdentifier: z.string().nullable(), explanation: z.string(), recommendedAction: z.string(), resolutionStatus: z.string(), createdAt: z.string() })) }),
    async handler(ctx, args) {
      await requireUser(ctx, args.token, "production.read"); const db = ctx.db<typeof schema>(); const [all, periods, projects, files] = await Promise.all([db.select().from(schema.productionExceptions).orderBy(desc(schema.productionExceptions.id)), db.select().from(schema.payrollPeriods), db.select().from(schema.projects), db.select().from(schema.sourceFiles)]);
      const filtered = all.filter((row) => row.resolutionStatus === args.status && (!args.payrollPeriodId || row.payrollPeriodId === args.payrollPeriodId) && (!args.projectId || row.projectId === args.projectId) && (!args.stream || row.stream === args.stream)); const page = filtered.slice((args.page - 1) * args.pageSize, args.page * args.pageSize);
      return { total: filtered.length, rows: page.map((row) => ({ id: row.id, periodCode: periods.find((p) => p.id === row.payrollPeriodId)?.periodId ?? "Unknown", projectCode: projects.find((p) => p.id === row.projectId)?.projectId ?? "Unknown", sourceFile: row.sourceFileId ? files.find((f) => f.id === row.sourceFileId)?.originalFilename ?? null : null, sourceRowNumber: row.sourceRowNumber, stream: row.stream, severity: row.severity, code: row.code, employeeIdentifier: row.employeeIdentifier, batchIdentifier: row.batchIdentifier, explanation: row.explanation, recommendedAction: row.recommendedAction, resolutionStatus: row.resolutionStatus, createdAt: row.createdAt.toISOString() })) };
    },
  }),

  confirmShipdetRows: defineAction({
    request: authRequest.extend({ ids: z.array(z.number().int().positive()).min(1).max(500), reason: z.string().trim().min(3).max(500) }),
    response: z.object({ confirmed: z.number() }),
    async handler(ctx, args) {
      const actor = await requireUser(ctx, args.token, "production.manage"); const db = ctx.db<typeof schema>(); const rows = await db.select().from(schema.shipdetBatches).where(inArray(schema.shipdetBatches.id, args.ids));
      if (!rows.length) throw new Error("No Shipdet rows were found for confirmation.");
      const protectedPeriods = await db.select().from(schema.payrollPeriods); if (rows.some((row) => ["Approved", "Locked", "Exported"].includes(protectedPeriods.find((period) => period.id === row.payrollPeriodId)?.status ?? ""))) throw new Error("Shipdet rows in protected payroll periods cannot be changed.");
      await db.update(schema.shipdetBatches).set({ reviewStatus: "confirmed", reviewedBy: actor.userId, reviewedAt: new Date() }).where(inArray(schema.shipdetBatches.id, rows.map((row) => row.id)));
      await audit(ctx, actor.userId, "confirm", "shipdet_rows", rows.map((row) => row.id).join(","), { confirmed: rows.length }, undefined, args.reason); ctx.invalidateQueries(); return { confirmed: rows.length };
    },
  }),

  exportProductionCsv: defineAction({
    request: authRequest.extend({ stream: z.enum(["record_details", "doctype", "proof", "transmitted_batch", "shipdet"]), payrollPeriodId: z.number().int().positive().optional().nullable(), projectId: z.number().int().positive().optional().nullable() }),
    response: z.object({ filename: z.string(), content: z.string(), rowCount: z.number() }),
    async handler(ctx, args) {
      await requireUser(ctx, args.token, "production.read"); const db = ctx.db<typeof schema>(); const files = await db.select().from(schema.sourceFiles);
      const scoped = <T extends { payrollPeriodId: number; projectId: number; active: boolean }>(rows: T[]) => rows.filter((row) => row.active && (!args.payrollPeriodId || row.payrollPeriodId === args.payrollPeriodId) && (!args.projectId || row.projectId === args.projectId));
      let headers: string[] = []; let values: unknown[][] = [];
      if (args.stream === "record_details") { const rows = scoped(await db.select().from(schema.recordDetails)); headers = ["Source file", "Source row", "Variant", "Internal batch ID", "Client batch ID", "Employee ID", "Employee name", "Production date", "Country", "Entry group", "Work type", "Key type", "Record count", "Character count", "Document reference", "Payable state"]; values = rows.map((row) => [files.find((file) => file.id === row.sourceFileId)?.originalFilename, row.sourceRowNumber, row.sourceVariant, row.internalBatchId, row.clientBatchId, row.employeeIdentifier, row.employeeName, row.productionDate, row.country, row.entryGroup, row.workType, row.keyType, row.recordCount, row.characterCount, row.documentReference, row.payableState]); }
      if (args.stream === "doctype") { const rows = scoped(await db.select().from(schema.doctypeRecords)); headers = ["Source file", "Source row", "Batch ID", "Employee ID", "Document count", "Image count", "Work type", "Country", "Status"]; values = rows.map((row) => [files.find((file) => file.id === row.sourceFileId)?.originalFilename, row.sourceRowNumber, row.batchId, row.employeeIdentifier, row.documentCount, row.imageCount, row.workType, row.country, row.status]); }
      if (args.stream === "proof") { const rows = scoped(await db.select().from(schema.proofRecords)); headers = ["Source file", "Source row", "Batch ID", "Entry Employee ID", "Proof Employee ID", "Proof type", "Record quantity", "Character quantity", "Country", "Key type", "Adjustment"]; values = rows.map((row) => [files.find((file) => file.id === row.sourceFileId)?.originalFilename, row.sourceRowNumber, row.batchId, row.entryEmployeeIdentifier, row.proofEmployeeIdentifier, row.proofType, row.recordQuantity, row.characterQuantity, row.country, row.keyType, row.adjustment]); }
      if (args.stream === "transmitted_batch") { const rows = scoped(await db.select().from(schema.transmittedBatches)); headers = ["Source file", "Source row", "Internal batch ID", "Client batch ID", "Batch name", "Country", "Records", "Characters", "Images", "Transmitted date", "Transmission status", "Client acceptance", "Produced", "Shipped", "Billable", "Approved for salary", "Work type"]; values = rows.map((row) => [files.find((file) => file.id === row.sourceFileId)?.originalFilename, row.sourceRowNumber, row.internalBatchId, row.clientBatchId, row.batchName, row.country, row.recordCount, row.characterCount, row.imageCount, row.transmittedDate, row.transmissionStatus, row.clientAcceptanceStatus, row.producedState, row.shippedState, row.billableState, row.salaryApprovalState, row.workType]); }
      if (args.stream === "shipdet") { const rows = scoped(await db.select().from(schema.shipdetBatches)); headers = ["Source file", "Source row", "Client project", "Internal batch ID", "Client batch ID", "Shipment batch ID", "Shipment date", "Records", "Characters", "Images", "Billable quantity", "Acceptance status", "Review status"]; values = rows.map((row) => [files.find((file) => file.id === row.sourceFileId)?.originalFilename, row.sourceRowNumber, row.clientProjectName, row.internalBatchId, row.clientBatchId, row.shipmentBatchId, row.shipmentDate, row.recordCount, row.characterCount, row.imageCount, row.billableQuantity, row.acceptanceStatus, row.reviewStatus]); }
      const lines = [headers.map(safeCsvCell).join(","), ...values.map((row) => row.map(safeCsvCell).join(","))]; return { filename: `${args.stream}-production-export.csv`, content: `\uFEFF${lines.join("\r\n")}`, rowCount: values.length };
    },
  }),

  listBatchMappings: defineAction({
    request: authRequest.extend({ payrollPeriodId: z.number().int().positive().optional().nullable(), projectId: z.number().int().positive().optional().nullable(), status: z.string().max(30).optional().nullable(), search: z.string().max(160).default("") }),
    response: z.object({ mappings: z.array(z.object({ id: z.number(), periodCode: z.string(), projectCode: z.string(), internalBatchId: z.string().nullable(), clientBatchId: z.string().nullable(), shipmentBatchId: z.string().nullable(), country: z.string().nullable(), matchStatus: z.string(), matchMethod: z.string(), approvalStatus: z.string(), approvedBy: z.string().nullable(), approvedAt: z.string().nullable() })) }),
    async handler(ctx, args) {
      await requireUser(ctx, args.token, "reconciliation.read"); const db = ctx.db<typeof schema>();
      const [rows, periods, projects, users] = await Promise.all([db.select().from(schema.batchMappings).orderBy(desc(schema.batchMappings.id)), db.select().from(schema.payrollPeriods), db.select().from(schema.projects), db.select().from(schema.users)]);
      const q = args.search.trim().toLowerCase(); const filtered = rows.filter((row) => (!args.payrollPeriodId || row.payrollPeriodId === args.payrollPeriodId) && (!args.projectId || row.projectId === args.projectId) && (!args.status || row.approvalStatus === args.status || row.matchStatus === args.status) && (!q || [row.internalBatchId, row.clientBatchId, row.shipmentBatchId, row.country].some((value) => String(value ?? "").toLowerCase().includes(q))));
      return { mappings: filtered.map((row) => ({ id: row.id, periodCode: periods.find((item) => item.id === row.payrollPeriodId)?.periodId ?? "Unknown", projectCode: projects.find((item) => item.id === row.projectId)?.projectId ?? "Unknown", internalBatchId: row.internalBatchId, clientBatchId: row.clientBatchId, shipmentBatchId: row.shipmentBatchId, country: row.country, matchStatus: row.matchStatus, matchMethod: row.matchMethod, approvalStatus: row.approvalStatus, approvedBy: row.approvedBy ? users.find((item) => item.id === row.approvedBy)?.name ?? "Unknown user" : null, approvedAt: row.approvedAt?.toISOString() ?? null })) };
    },
  }),

  saveBatchMapping: defineAction({
    request: authRequest.extend({ id: z.number().int().positive().optional(), payrollPeriodId: z.number().int().positive(), projectId: z.number().int().positive(), internalBatchId: z.string().trim().max(160).optional().nullable(), clientBatchId: z.string().trim().max(160).optional().nullable(), shipmentBatchId: z.string().trim().max(160).optional().nullable(), country: z.string().trim().max(60).optional().nullable() }),
    response: z.object({ id: z.number() }),
    async handler(ctx, args) {
      const actor = await requireUser(ctx, args.token, "reconciliation.manage"); const db = ctx.db<typeof schema>();
      const internal = batchKey(args.internalBatchId); const client = batchKey(args.clientBatchId); const shipment = batchKey(args.shipmentBatchId); if (!internal && !client && !shipment) throw new Error("Enter at least one batch identifier.");
      const period = (await db.select().from(schema.payrollPeriods).where(eq(schema.payrollPeriods.id, args.payrollPeriodId)).limit(1))[0]; if (!period || ["Approved", "Locked", "Exported"].includes(period.status)) throw new Error("Mappings in a protected payroll period cannot be changed.");
      const values = { payrollPeriodId: args.payrollPeriodId, projectId: args.projectId, internalBatchId: internal || null, clientBatchId: client || null, shipmentBatchId: shipment || null, normalizedInternalBatchId: internal || null, normalizedClientBatchId: client || null, normalizedShipmentBatchId: shipment || null, country: args.country?.trim().toUpperCase() || null, matchStatus: "review" as const, matchMethod: "manual" as const, approvalStatus: "pending" as const, approvedBy: null, approvedAt: null, updatedAt: new Date() };
      let id: number;
      if (args.id) { const before = (await db.select().from(schema.batchMappings).where(eq(schema.batchMappings.id, args.id)).limit(1))[0]; if (!before) throw new Error("Batch mapping not found."); await db.update(schema.batchMappings).set(values).where(eq(schema.batchMappings.id, args.id)); id = args.id; await audit(ctx, actor.userId, "update", "batch_mapping", String(id), values, before); }
      else { const inserted = await db.insert(schema.batchMappings).values({ ...values, createdBy: actor.userId }).returning({ id: schema.batchMappings.id }); const row = inserted[0]; if (!row) throw new Error("Batch mapping could not be saved."); id = row.id; await audit(ctx, actor.userId, "create", "batch_mapping", String(id), values); }
      ctx.invalidateQueries(); return { id };
    },
  }),

  reviewBatchMappings: defineAction({
    request: authRequest.extend({ ids: z.array(z.number().int().positive()).min(1).max(500), decision: z.enum(["approved", "rejected"]), reason: z.string().trim().min(3).max(500) }),
    response: z.object({ updated: z.number() }),
    async handler(ctx, args) {
      const actor = await requireUser(ctx, args.token, "reconciliation.manage"); const db = ctx.db<typeof schema>(); const rows = await db.select().from(schema.batchMappings).where(inArray(schema.batchMappings.id, args.ids)); if (!rows.length) throw new Error("No batch mappings were selected.");
      await db.update(schema.batchMappings).set({ approvalStatus: args.decision, matchStatus: args.decision === "approved" ? "matched" : "unmatched", approvedBy: actor.userId, approvedAt: new Date(), updatedAt: new Date() }).where(inArray(schema.batchMappings.id, rows.map((row) => row.id)));
      await audit(ctx, actor.userId, args.decision, "batch_mapping", rows.map((row) => row.id).join(","), { count: rows.length }, undefined, args.reason); ctx.invalidateQueries(); return { updated: rows.length };
    },
  }),

  getPayablePolicies: defineAction({
    request: authRequest.extend({ projectId: z.number().int().positive() }),
    response: z.object({ policies: z.array(z.object({ id: z.number(), workType: z.string(), quantityUnit: z.string(), payableSource: z.string(), allocationPolicy: z.string(), statusRequirement: z.string(), active: z.boolean() })), workTypes: z.array(z.object({ code: z.string(), name: z.string(), unit: z.string() })) }),
    async handler(ctx, args) {
      await requireUser(ctx, args.token, "reconciliation.read"); const db = ctx.db<typeof schema>(); const [policies, workTypes] = await Promise.all([db.select().from(schema.payableQuantityPolicies).where(eq(schema.payableQuantityPolicies.projectId, args.projectId)).orderBy(asc(schema.payableQuantityPolicies.workType)), db.select().from(schema.workTypes).where(eq(schema.workTypes.projectId, args.projectId))]);
      return { policies: policies.map((row) => ({ id: row.id, workType: row.workType, quantityUnit: row.quantityUnit, payableSource: row.payableSource, allocationPolicy: row.allocationPolicy, statusRequirement: row.statusRequirement, active: row.active })), workTypes: workTypes.filter((row) => row.status === "active").map((row) => ({ code: row.code, name: row.name, unit: row.unit })) };
    },
  }),

  savePayablePolicy: defineAction({
    request: authRequest.extend({ projectId: z.number().int().positive(), workType: z.string().trim().min(1).max(120), quantityUnit: z.enum(["record", "character", "image", "document"]), payableSource: z.enum(["produced", "confirmed_shipped", "client_billable", "accepted_transmitted"]), allocationPolicy: z.enum(["direct_employee", "record_attribution", "category_proportional", "manual"]), statusRequirement: z.enum(["none", "transmitted", "accepted", "confirmed_shipped", "client_billable"]), active: z.boolean().default(true) }),
    response: z.object({ ok: z.literal(true) }),
    async handler(ctx, args): Promise<{ ok: true }> {
      const actor = await requireUser(ctx, args.token, "reconciliation.manage"); const db = ctx.db<typeof schema>(); const existing = (await db.select().from(schema.payableQuantityPolicies).where(and(eq(schema.payableQuantityPolicies.projectId, args.projectId), eq(schema.payableQuantityPolicies.workType, args.workType), eq(schema.payableQuantityPolicies.quantityUnit, args.quantityUnit))).limit(1))[0];
      const values = { payableSource: args.payableSource, allocationPolicy: args.allocationPolicy, statusRequirement: args.statusRequirement, active: args.active, updatedBy: actor.userId, updatedAt: new Date() };
      if (existing) await db.update(schema.payableQuantityPolicies).set(values).where(eq(schema.payableQuantityPolicies.id, existing.id)); else await db.insert(schema.payableQuantityPolicies).values({ projectId: args.projectId, workType: args.workType, quantityUnit: args.quantityUnit, ...values });
      await audit(ctx, actor.userId, existing ? "update" : "create", "payable_quantity_policy", existing ? String(existing.id) : `${args.projectId}:${args.workType}:${args.quantityUnit}`, { ...args, token: undefined }, existing); ctx.invalidateQueries(); return { ok: true };
    },
  }),

  saveManualAllocation: defineAction({
    request: authRequest.extend({ payrollPeriodId: z.number().int().positive(), projectId: z.number().int().positive(), batchKey: z.string().trim().min(1).max(160), employeeId: z.number().int().positive(), workType: z.string().trim().min(1).max(120), categoryCode: z.string().trim().max(120).optional().nullable(), quantityUnit: z.enum(["record", "character", "image", "document"]), allocatedQuantity: z.number().nonnegative(), reason: z.string().trim().min(3).max(500) }),
    response: z.object({ ok: z.literal(true) }),
    async handler(ctx, args): Promise<{ ok: true }> {
      const actor = await requireUser(ctx, args.token, "reconciliation.manage"); const db = ctx.db<typeof schema>(); const period = (await db.select().from(schema.payrollPeriods).where(eq(schema.payrollPeriods.id, args.payrollPeriodId)).limit(1))[0]; if (!period || ["Approved", "Locked", "Exported"].includes(period.status)) throw new Error("Manual allocations in a protected period cannot be changed.");
      const existing = (await db.select().from(schema.manualAllocationInputs).where(and(eq(schema.manualAllocationInputs.payrollPeriodId, args.payrollPeriodId), eq(schema.manualAllocationInputs.projectId, args.projectId), eq(schema.manualAllocationInputs.batchKey, batchKey(args.batchKey)), eq(schema.manualAllocationInputs.employeeId, args.employeeId), eq(schema.manualAllocationInputs.workType, args.workType), eq(schema.manualAllocationInputs.quantityUnit, args.quantityUnit))).limit(1))[0];
      const values = { allocatedQuantity: quantityText(args.allocatedQuantity), reason: args.reason, approvedBy: actor.userId, approvedAt: new Date() };
      if (existing) await db.update(schema.manualAllocationInputs).set(values).where(eq(schema.manualAllocationInputs.id, existing.id)); else await db.insert(schema.manualAllocationInputs).values({ payrollPeriodId: args.payrollPeriodId, projectId: args.projectId, batchKey: batchKey(args.batchKey), employeeId: args.employeeId, workType: args.workType, categoryCode: args.categoryCode || null, quantityUnit: args.quantityUnit, ...values });
      await audit(ctx, actor.userId, existing ? "update" : "create", "manual_allocation", existing ? String(existing.id) : batchKey(args.batchKey), values, existing, args.reason); ctx.invalidateQueries(); return { ok: true };
    },
  }),

  runReconciliation: defineAction({
    request: authRequest.extend({ payrollPeriodId: z.number().int().positive(), projectId: z.number().int().positive() }),
    response: z.object({ runId: z.string(), resultCount: z.number(), warningCount: z.number(), blockingCount: z.number() }),
    async handler(ctx, args) {
      const actor = await requireUser(ctx, args.token, "reconciliation.manage"); const db = ctx.db<typeof schema>(); const period = (await db.select().from(schema.payrollPeriods).where(eq(schema.payrollPeriods.id, args.payrollPeriodId)).limit(1))[0]; if (!period) throw new Error("Payroll period not found."); if (["Approved", "Locked", "Exported"].includes(period.status)) throw new Error("A protected payroll period cannot be reconciled again.");
      const runCode = `REC-${crypto.randomUUID().slice(0, 8).toUpperCase()}`; const runInsert = await db.insert(schema.reconciliationRuns).values({ runId: runCode, payrollPeriodId: args.payrollPeriodId, projectId: args.projectId, startedBy: actor.userId }).returning({ id: schema.reconciliationRuns.id }); const run = runInsert[0]; if (!run) throw new Error("Reconciliation run could not be created.");
      type ProducedLine = { batch: string; internal: string | null; client: string | null; employeeId: number | null; employeeIdentifier: string | null; workType: string; country: string | null; categoryCode: string | null; categoryName: string | null; unit: QuantityUnit; amount: number; source: string; sourceId: number; hasRecordIdentity: boolean };
      const [records, categories, doctypes, proofs, transmitted, shipdet, shipCategories, mappings, policies, manual, workTypes, projectCountries, configuredCategories, rates, assignments, files, importRows] = await Promise.all([
        db.select().from(schema.recordDetails), db.select().from(schema.recordCategoryQuantities), db.select().from(schema.doctypeRecords), db.select().from(schema.proofRecords), db.select().from(schema.transmittedBatches), db.select().from(schema.shipdetBatches), db.select().from(schema.shipdetCategoryQuantities), db.select().from(schema.batchMappings), db.select().from(schema.payableQuantityPolicies), db.select().from(schema.manualAllocationInputs), db.select().from(schema.workTypes), db.select().from(schema.projectCountryConfigurations), db.select().from(schema.characterCategories), db.select().from(schema.rateRules), db.select().from(schema.employeeProjectAssignments), db.select().from(schema.sourceFiles), db.select().from(schema.importRows),
      ]);
      const inScope = <T extends { payrollPeriodId: number; projectId: number; active: boolean }>(rows: T[]) => rows.filter((row) => row.active && row.payrollPeriodId === args.payrollPeriodId && row.projectId === args.projectId);
      const recordScope = inScope(records); const transmittedScope = inScope(transmitted); const shipScope = inScope(shipdet); const lines: ProducedLine[] = [];
      const pushLine = (line: ProducedLine) => { if (line.batch && line.amount > 0) lines.push(line); };
      for (const row of recordScope) {
        const batch = batchKey(row.internalBatchId || row.clientBatchId); if (!batch) continue; const ownCategories = categories.filter((item) => item.recordDetailId === row.id);
        for (const unit of ["record", "character"] as const) { const categoryForUnit = ownCategories.filter((item) => item.quantityUnit === unit); if (categoryForUnit.length) for (const item of categoryForUnit) pushLine({ batch, internal: row.internalBatchId, client: row.clientBatchId, employeeId: row.employeeRecordId, employeeIdentifier: row.employeeIdentifier, workType: row.workType || row.entryGroup || "Record Details", country: row.country, categoryCode: item.categoryCode, categoryName: item.categoryName, unit, amount: quantity(item.quantity), source: "record_details", sourceId: row.id, hasRecordIdentity: Boolean(row.documentReference) }); else pushLine({ batch, internal: row.internalBatchId, client: row.clientBatchId, employeeId: row.employeeRecordId, employeeIdentifier: row.employeeIdentifier, workType: row.workType || row.entryGroup || "Record Details", country: row.country, categoryCode: null, categoryName: null, unit, amount: quantity(unit === "record" ? row.recordCount : row.characterCount), source: "record_details", sourceId: row.id, hasRecordIdentity: Boolean(row.documentReference) }); }
      }
      for (const row of inScope(doctypes)) { const batch = batchKey(row.batchId); pushLine({ batch, internal: row.batchId, client: null, employeeId: row.employeeRecordId, employeeIdentifier: row.employeeIdentifier, workType: row.workType || "Doctype", country: row.country, categoryCode: null, categoryName: null, unit: "document", amount: quantity(row.documentCount), source: "doctype", sourceId: row.id, hasRecordIdentity: false }); pushLine({ batch, internal: row.batchId, client: null, employeeId: row.employeeRecordId, employeeIdentifier: row.employeeIdentifier, workType: row.workType || "Doctype", country: row.country, categoryCode: null, categoryName: null, unit: "image", amount: quantity(row.imageCount), source: "doctype", sourceId: row.id, hasRecordIdentity: false }); }
      for (const row of inScope(proofs)) { const batch = batchKey(row.batchId); pushLine({ batch, internal: row.batchId, client: null, employeeId: row.proofEmployeeRecordId, employeeIdentifier: row.proofEmployeeIdentifier, workType: row.proofType || "Proof", country: row.country, categoryCode: null, categoryName: null, unit: "record", amount: quantity(row.recordQuantity), source: "proof", sourceId: row.id, hasRecordIdentity: false }); pushLine({ batch, internal: row.batchId, client: null, employeeId: row.proofEmployeeRecordId, employeeIdentifier: row.proofEmployeeIdentifier, workType: row.proofType || "Proof", country: row.country, categoryCode: null, categoryName: null, unit: "character", amount: quantity(row.characterQuantity), source: "proof", sourceId: row.id, hasRecordIdentity: false }); }
      type ExceptionInput = { batch: string | null; employee: string | null; sourceFileId?: number | null; type: string; severity: "warning" | "blocking"; explanation: string; action: string };
      const exceptions: ExceptionInput[] = []; const addException = (input: ExceptionInput) => { if (!exceptions.some((item) => item.batch === input.batch && item.employee === input.employee && item.type === input.type && item.explanation === input.explanation)) exceptions.push(input); };
      const scopedMappings = mappings.filter((row) => row.payrollPeriodId === args.payrollPeriodId && row.projectId === args.projectId); const activePolicies = policies.filter((row) => row.projectId === args.projectId && row.active); const policyMap = new Map(activePolicies.map((row) => [policyKey(row.workType, row.quantityUnit), row])); const scopedManual = manual.filter((row) => row.payrollPeriodId === args.payrollPeriodId && row.projectId === args.projectId);
      const observedBatches = distinctNonEmpty(lines.map((line) => line.batch));
      const matchRows = (batch: string) => { const approved = scopedMappings.find((row) => row.approvalStatus === "approved" && [row.normalizedInternalBatchId, row.normalizedClientBatchId, row.normalizedShipmentBatchId].some((value) => batchKey(value) === batch)); const ids = approved ? distinctNonEmpty([approved.normalizedInternalBatchId, approved.normalizedClientBatchId, approved.normalizedShipmentBatchId]) : [batch]; const tx = transmittedScope.filter((row) => ids.some((id) => [row.internalBatchId, row.clientBatchId].some((value) => batchKey(value) === id))); const sh = shipScope.filter((row) => ids.some((id) => [row.internalBatchId, row.clientBatchId, row.shipmentBatchId].some((value) => batchKey(value) === id))); return { approved, ids, tx, sh }; };
      for (const batch of observedBatches) { const matched = matchRows(batch); const txIds = distinctNonEmpty(matched.tx.flatMap((row) => [row.internalBatchId, row.clientBatchId])); const shIds = distinctNonEmpty(matched.sh.flatMap((row) => [row.internalBatchId, row.clientBatchId, row.shipmentBatchId])); if (txIds.length > 2 || shIds.length > 3) addException({ batch, employee: null, type: "AMBIGUOUS_BATCH_MATCH", severity: "blocking", explanation: "More than one source identity matched this batch. No fuzzy or ambiguous match was confirmed.", action: "Create and approve one explicit batch mapping." }); else if (!matched.approved && (matched.tx.length || matched.sh.length)) { const first = lines.find((line) => line.batch === batch); const existing = scopedMappings.find((row) => [row.normalizedInternalBatchId, row.normalizedClientBatchId, row.normalizedShipmentBatchId].some((value) => batchKey(value) === batch)); if (!existing) await db.insert(schema.batchMappings).values({ payrollPeriodId: args.payrollPeriodId, projectId: args.projectId, internalBatchId: first?.internal ?? batch, clientBatchId: first?.client ?? matched.tx[0]?.clientBatchId ?? matched.sh[0]?.clientBatchId ?? null, shipmentBatchId: matched.sh[0]?.shipmentBatchId ?? null, normalizedInternalBatchId: batchKey(first?.internal ?? batch) || null, normalizedClientBatchId: batchKey(first?.client ?? matched.tx[0]?.clientBatchId ?? matched.sh[0]?.clientBatchId) || null, normalizedShipmentBatchId: batchKey(matched.sh[0]?.shipmentBatchId) || null, country: first?.country ?? null, matchStatus: "matched", matchMethod: matched.tx.some((row) => batchKey(row.internalBatchId) === batch) || matched.sh.some((row) => batchKey(row.internalBatchId) === batch) ? "exact_internal" : matched.tx.some((row) => batchKey(row.clientBatchId) === batch) || matched.sh.some((row) => batchKey(row.clientBatchId) === batch) ? "exact_client" : "exact_shipment", approvalStatus: "pending", createdBy: actor.userId }).onConflictDoNothing(); } }
      for (const line of lines) { if (!line.employeeId) addException({ batch: line.batch, employee: line.employeeIdentifier, type: "UNATTRIBUTED_EMPLOYEE", severity: "blocking", explanation: `A ${line.source} quantity has no reliably matched employee.`, action: "Map the Employee ID and reprocess the source before approval." }); const assigned = line.employeeId && assignments.some((row) => row.employeeId === line.employeeId && row.projectId === args.projectId && row.status === "active" && (!row.payrollPeriodId || row.payrollPeriodId === args.payrollPeriodId)); if (line.employeeId && !assigned) addException({ batch: line.batch, employee: line.employeeIdentifier, type: "MISSING_EMPLOYEE_ASSIGNMENT", severity: "blocking", explanation: "The employee is not assigned to this project for the payroll period.", action: "Create the employee-project assignment or correct the source Employee ID." }); const knownWork = workTypes.some((row) => row.projectId === args.projectId && row.status === "active" && [row.code, row.name].some((value) => value.toLowerCase() === line.workType.toLowerCase())); if (!knownWork) addException({ batch: line.batch, employee: line.employeeIdentifier, type: "UNKNOWN_WORK_TYPE", severity: "blocking", explanation: `Work type ${line.workType} is not configured for this project.`, action: "Configure the work type or correct the mapped source value." }); if (line.country && !projectCountries.some((row) => row.projectId === args.projectId && row.status === "active" && row.countryCode.toLowerCase() === line.country?.toLowerCase())) addException({ batch: line.batch, employee: line.employeeIdentifier, type: "UNKNOWN_COUNTRY", severity: "blocking", explanation: `Country ${line.country} is not active for this project.`, action: "Add the country configuration or correct the source value." }); if (line.categoryCode && !configuredCategories.some((row) => row.projectId === args.projectId && row.status === "active" && row.code.toLowerCase() === line.categoryCode?.toLowerCase())) addException({ batch: line.batch, employee: line.employeeIdentifier, type: "UNKNOWN_CATEGORY", severity: "blocking", explanation: `Category ${line.categoryCode} is not configured for this project.`, action: "Configure the category or correct the source column mapping." }); const work = workTypes.find((row) => row.projectId === args.projectId && [row.code, row.name].some((value) => value.toLowerCase() === line.workType.toLowerCase())); const hasRate = work && rates.some((row) => row.projectId === args.projectId && row.workTypeId === work.id && row.status === "active" && (!line.country || row.countryCode.toLowerCase() === line.country.toLowerCase())); if (!hasRate) addException({ batch: line.batch, employee: line.employeeIdentifier, type: "MISSING_RATE_RULE", severity: "blocking", explanation: `No active rate rule matches ${line.workType}${line.country ? ` / ${line.country}` : ""}.`, action: "Create an effective rate rule before salary calculation." }); }
      for (const row of recordScope.filter((item) => item.payableState === "blocked_overlap")) addException({ batch: batchKey(row.internalBatchId || row.clientBatchId) || null, employee: row.employeeIdentifier, sourceFileId: row.sourceFileId, type: "DOUBLE_COUNTED_QUANTITY", severity: "blocking", explanation: "This Full Key or Review Key row overlaps another payable identity.", action: "Resolve the key-variant overlap before approval." });
      const duplicateFiles = files.filter((file) => file.payrollPeriodId === args.payrollPeriodId && file.projectId === args.projectId && file.status === "committed"); for (const file of duplicateFiles) if (duplicateFiles.some((other) => other.id !== file.id && other.sourceType === file.sourceType && other.fileHash === file.fileHash)) addException({ batch: null, employee: null, sourceFileId: file.id, type: "DUPLICATE_SOURCE_FILE", severity: "blocking", explanation: `Committed file ${file.originalFilename} has the same hash as another active source file.`, action: "Reverse the duplicate import before reconciliation approval." });
      if (importRows.some((row) => row.validationStatus === "duplicate" && duplicateFiles.some((file) => file.id === row.sourceFileId))) addException({ batch: null, employee: null, type: "DUPLICATE_SOURCE_ROWS", severity: "warning", explanation: "Duplicate candidate rows were detected in this scope.", action: "Review the import preview and confirm that duplicate candidates were not committed unintentionally." });
      const productionBatchSet = new Set(observedBatches); for (const row of shipScope) { const ids = distinctNonEmpty([row.internalBatchId, row.clientBatchId, row.shipmentBatchId]); if (!ids.some((id) => productionBatchSet.has(id))) addException({ batch: ids[0] ?? null, employee: null, sourceFileId: row.sourceFileId, type: "SHIPMENT_WITHOUT_PRODUCTION", severity: "blocking", explanation: "A Shipdet row has no matching production batch.", action: "Create an approved batch mapping or import the missing production source." }); }
      type Group = { key: string; batch: string; workType: string; categoryCode: string | null; categoryName: string | null; unit: QuantityUnit; country: string | null; lines: ProducedLine[] };
      const groups = new Map<string, Group>(); for (const line of lines) { const key = dimensionKey(line.batch, line.workType, line.categoryCode, line.unit); const current = groups.get(key) ?? { key, batch: line.batch, workType: line.workType, categoryCode: line.categoryCode, categoryName: line.categoryName, unit: line.unit, country: line.country, lines: [] }; current.lines.push(line); groups.set(key, current); }
      const results: Array<typeof schema.reconciliationResults.$inferInsert> = [];
      for (const group of groups.values()) {
        const matched = matchRows(group.batch); const prodTotal = group.lines.reduce((sum, line) => sum + line.amount, 0); const policy = policyMap.get(policyKey(group.workType, group.unit)); const payableSource = (policy?.payableSource ?? "produced") as PayableSource; const allocationPolicy = (policy?.allocationPolicy ?? "direct_employee") as AllocationPolicy;
        const txForWork = matched.tx.filter((row) => !row.workType || row.workType.toLowerCase() === group.workType.toLowerCase()); const transmittedQuantity = txForWork.filter((row) => row.transmissionStatus === "transmitted").reduce((sum, row) => sum + quantity(group.unit === "record" ? row.recordCount : group.unit === "character" ? row.characterCount : row.imageCount), 0); const acceptedQuantity = txForWork.filter((row) => row.clientAcceptanceStatus === "accepted").reduce((sum, row) => sum + quantity(group.unit === "record" ? row.recordCount : group.unit === "character" ? row.characterCount : row.imageCount), 0);
        const confirmedShip = matched.sh.filter((row) => row.reviewStatus === "confirmed"); let shippedQuantity = confirmedShip.reduce((sum, row) => sum + quantity(group.unit === "record" ? row.recordCount : group.unit === "character" ? row.characterCount : row.imageCount), 0); if (group.categoryCode) shippedQuantity = confirmedShip.reduce((sum, row) => sum + shipCategories.filter((item) => item.shipdetBatchId === row.id && item.categoryCode.toLowerCase() === group.categoryCode?.toLowerCase()).reduce((subtotal, item) => subtotal + quantity(item.quantity), 0), 0); const billableQuantity = confirmedShip.filter((row) => row.acceptanceStatus === "accepted").reduce((sum, row) => sum + quantity(row.billableQuantity), 0);
        let sourceQuantity = payableSource === "produced" ? prodTotal : payableSource === "confirmed_shipped" ? shippedQuantity : payableSource === "client_billable" ? billableQuantity : acceptedQuantity; const authorized = Math.min(prodTotal, sourceQuantity); if (payableSource !== "produced" && !matched.approved && !matched.tx.length && !matched.sh.length) addException({ batch: group.batch, employee: null, type: "MISSING_BATCH_MAPPING", severity: "blocking", explanation: `The ${payableSource.replace(/_/g, " ")} policy requires a mapped downstream batch.`, action: "Create and approve a stable batch mapping, then run reconciliation again." }); if (payableSource === "confirmed_shipped" && !confirmedShip.length) addException({ batch: group.batch, employee: null, type: "MISSING_CONFIRMED_SHIPMENT", severity: "blocking", explanation: "Confirmed Shipdet quantity is required by this payable policy but is unavailable.", action: "Inspect and confirm Shipdet rows or change the approved project policy." }); if (payableSource === "client_billable" && !billableQuantity) addException({ batch: group.batch, employee: null, type: "MISSING_BILLABLE_QUANTITY", severity: "blocking", explanation: "Client-confirmed billable quantity is required but unavailable.", action: "Import and confirm a billable Shipdet quantity." }); if (payableSource === "accepted_transmitted" && !acceptedQuantity) addException({ batch: group.batch, employee: null, type: "MISSING_ACCEPTED_TRANSMISSION", severity: "blocking", explanation: "Accepted transmitted quantity is required but unavailable.", action: "Import an explicitly accepted transmission row." }); if (!transmittedQuantity) addException({ batch: group.batch, employee: null, type: "PRODUCTION_WITHOUT_TRANSMISSION", severity: payableSource === "produced" ? "warning" : "blocking", explanation: "Production exists without transmitted quantity for the compatible work type and unit.", action: "Import or map the Transmitted Batch List; produced-pay policy may proceed after review." }); if (prodTotal > sourceQuantity && payableSource !== "produced") addException({ batch: group.batch, employee: null, type: "ENTRY_EXCEEDS_PAYABLE_CAP", severity: "warning", explanation: `Produced ${quantityText(prodTotal)} ${group.unit} units exceed the authorized source quantity ${quantityText(sourceQuantity)}. This is a normal stage difference and the cap is enforced.`, action: "Review the difference; change nothing unless a source or policy is incorrect." });
        const employees = new Map<string, { employeeId: number | null; identifier: string | null; amount: number; traces: number[]; allIdentified: boolean }>(); for (const line of group.lines) { const key = line.employeeId ? String(line.employeeId) : `unmatched:${line.employeeIdentifier ?? ""}`; const current = employees.get(key) ?? { employeeId: line.employeeId, identifier: line.employeeIdentifier, amount: 0, traces: [], allIdentified: true }; current.amount += line.amount; current.traces.push(line.sourceId); current.allIdentified = current.allIdentified && line.hasRecordIdentity; employees.set(key, current); }
        const allocations: Record<string, number> = {}; const contributions = [...employees.entries()].map(([key, value]) => ({ key, value: value.amount })); if (payableSource === "produced") for (const item of contributions) allocations[item.key] = item.value; else if (employees.size === 1) { const first = contributions[0]; if (first) allocations[first.key] = authorized; } else if (allocationPolicy === "category_proportional") Object.assign(allocations, largestRemainder(authorized, contributions)); else if (allocationPolicy === "manual") { for (const [key, employee] of employees) { const selected = scopedManual.find((row) => row.batchKey === group.batch && row.employeeId === employee.employeeId && row.workType.toLowerCase() === group.workType.toLowerCase() && row.quantityUnit === group.unit && (row.categoryCode ?? null) === group.categoryCode); allocations[key] = selected ? quantity(selected.allocatedQuantity) : 0; } const totalManual = Object.values(allocations).reduce((sum, value) => sum + value, 0); if (totalManual !== authorized) addException({ batch: group.batch, employee: null, type: "MANUAL_ALLOCATION_MISMATCH", severity: "blocking", explanation: `Approved manual allocations total ${quantityText(totalManual)} but the authorized cap is ${quantityText(authorized)}.`, action: "Enter authorized manual quantities with a reason so allocations sum exactly to the cap." }); } else if (allocationPolicy === "record_attribution" && group.unit === "record" && [...employees.values()].every((item) => item.allIdentified)) { Object.assign(allocations, largestRemainder(authorized, contributions)); } else { addException({ batch: group.batch, employee: null, type: "AMBIGUOUS_EMPLOYEE_ALLOCATION", severity: "blocking", explanation: `${employees.size} employees share this batch, but ${allocationPolicy.replace(/_/g, " ")} cannot reliably attribute the authorized quantity from available source identifiers.`, action: "Choose category proportional allocation, provide reliable record identities, or enter approved manual allocations." }); }
        const allocatedTotal = Object.values(allocations).reduce((sum, value) => sum + value, 0); if (allocatedTotal > authorized + 0.000001) addException({ batch: group.batch, employee: null, type: "ALLOCATION_EXCEEDS_CAP", severity: "blocking", explanation: `Employee allocations ${quantityText(allocatedTotal)} exceed the authorized cap ${quantityText(authorized)}.`, action: "Correct the allocation policy or manual quantities." }); if (allocatedTotal + 0.000001 < authorized && !exceptions.some((item) => item.batch === group.batch && item.type.includes("ALLOCATION"))) addException({ batch: group.batch, employee: null, type: "TOTALS_DO_NOT_RECONCILE", severity: "blocking", explanation: `Employee allocations ${quantityText(allocatedTotal)} do not reconcile to the authorized cap ${quantityText(authorized)}.`, action: "Resolve attribution and run reconciliation again." });
        for (const [key, employee] of employees) { const allocated = allocations[key] ?? 0; const relevantExceptions = exceptions.filter((item) => item.batch === group.batch && (!item.employee || item.employee === employee.identifier)); results.push({ reconciliationRunId: run.id, payrollPeriodId: args.payrollPeriodId, projectId: args.projectId, country: group.country, batchKey: group.batch, internalBatchId: group.lines[0]?.internal ?? null, clientBatchId: group.lines[0]?.client ?? null, shipmentBatchId: matched.sh[0]?.shipmentBatchId ?? null, employeeId: employee.employeeId, employeeIdentifier: employee.identifier, workType: group.workType, categoryCode: group.categoryCode, categoryName: group.categoryName, quantityUnit: group.unit, entryQuantity: quantityText(employee.amount), transmittedQuantity: quantityText(transmittedQuantity), acceptedQuantity: quantityText(acceptedQuantity), shipdetQuantity: quantityText(shippedQuantity), billableQuantity: quantityText(billableQuantity), authorizedPayableQuantity: quantityText(authorized), employeeAllocatedQuantity: quantityText(allocated), nonPayableQuantity: quantityText(Math.max(0, employee.amount - allocated)), quantityDifference: quantityText(employee.amount - allocated), payableSource, allocationPolicy, matchStatus: matched.approved ? "approved_mapping" : matched.tx.length || matched.sh.length ? "exact_match" : "unmatched", exceptionStatus: relevantExceptions.some((item) => item.severity === "blocking") ? "blocking" : relevantExceptions.length ? "warning" : "clear", resolutionStatus: relevantExceptions.length ? "open" : "resolved", salaryApprovalStatus: "pending", sourceTraceJson: JSON.stringify({ production: employee.traces, transmitted: matched.tx.map((row) => row.id), shipdet: matched.sh.map((row) => row.id) }) }); }
      }
      for (const input of exceptions) await db.insert(schema.reconciliationExceptions).values({ reconciliationRunId: run.id, payrollPeriodId: args.payrollPeriodId, projectId: args.projectId, batchKey: input.batch, employeeIdentifier: input.employee, sourceFileId: input.sourceFileId ?? null, exceptionType: input.type, severity: input.severity, explanation: input.explanation, recommendedAction: input.action });
      for (let start = 0; start < results.length; start += 100) { const values = results.slice(start, start + 100); if (values.length) await db.insert(schema.reconciliationResults).values(values); }
      const warningCount = exceptions.filter((item) => item.severity === "warning").length; const blockingCount = exceptions.filter((item) => item.severity === "blocking").length; await db.update(schema.reconciliationRuns).set({ status: "completed", resultCount: results.length, warningCount, blockingCount, completedAt: new Date() }).where(eq(schema.reconciliationRuns.id, run.id)); await audit(ctx, actor.userId, "run", "reconciliation", String(run.id), { runId: runCode, resultCount: results.length, warningCount, blockingCount }); ctx.invalidateQueries(); return { runId: runCode, resultCount: results.length, warningCount, blockingCount };
    },
  }),

  listReconciliationReport: defineAction({
    request: authRequest.extend({ payrollPeriodId: z.number().int().positive().optional().nullable(), projectId: z.number().int().positive().optional().nullable(), search: z.string().max(160).default(""), country: z.string().max(60).default(""), workType: z.string().max(120).default(""), unit: z.string().max(30).default(""), exceptionStatus: z.string().max(30).default(""), resolutionStatus: z.string().max(30).default(""), sortBy: z.enum(["batchKey", "employeeIdentifier", "workType", "entryQuantity", "employeeAllocatedQuantity", "quantityDifference"]).default("batchKey"), direction: z.enum(["asc", "desc"]).default("asc"), page: z.number().int().min(1).default(1), pageSize: z.number().int().min(10).max(100).default(25) }),
    response: z.object({ total: z.number(), latestRun: z.object({ id: z.number(), runId: z.string(), status: z.string(), resultCount: z.number(), warningCount: z.number(), blockingCount: z.number(), startedAt: z.string(), approvedAt: z.string().nullable() }).nullable(), rows: z.array(z.object({ id: z.number(), periodCode: z.string(), projectCode: z.string(), country: z.string().nullable(), batchKey: z.string(), employeeIdentifier: z.string().nullable(), employeeName: z.string().nullable(), employeeId: z.number().nullable(), workType: z.string(), categoryCode: z.string().nullable(), categoryName: z.string().nullable(), quantityUnit: z.string(), entryQuantity: z.string(), transmittedQuantity: z.string(), acceptedQuantity: z.string(), shipdetQuantity: z.string(), billableQuantity: z.string(), authorizedPayableQuantity: z.string(), employeeAllocatedQuantity: z.string(), nonPayableQuantity: z.string(), quantityDifference: z.string(), payableSource: z.string(), allocationPolicy: z.string(), matchStatus: z.string(), exceptionStatus: z.string(), resolutionStatus: z.string(), salaryApprovalStatus: z.string() })) }),
    async handler(ctx, args) {
      await requireUser(ctx, args.token, "reconciliation.read"); const db = ctx.db<typeof schema>(); const [runs, all, periods, projects, employees] = await Promise.all([db.select().from(schema.reconciliationRuns).orderBy(desc(schema.reconciliationRuns.id)), db.select().from(schema.reconciliationResults), db.select().from(schema.payrollPeriods), db.select().from(schema.projects), db.select().from(schema.employees)]); const latest = runs.find((row) => (!args.payrollPeriodId || row.payrollPeriodId === args.payrollPeriodId) && (!args.projectId || row.projectId === args.projectId)) ?? null; const q = args.search.trim().toLowerCase(); let rows = all.filter((row) => (!latest || row.reconciliationRunId === latest.id) && (!args.payrollPeriodId || row.payrollPeriodId === args.payrollPeriodId) && (!args.projectId || row.projectId === args.projectId) && (!args.country || String(row.country ?? "").toLowerCase().includes(args.country.toLowerCase())) && (!args.workType || row.workType.toLowerCase().includes(args.workType.toLowerCase())) && (!args.unit || row.quantityUnit === args.unit) && (!args.exceptionStatus || row.exceptionStatus === args.exceptionStatus) && (!args.resolutionStatus || row.resolutionStatus === args.resolutionStatus) && (!q || [row.batchKey, row.employeeIdentifier, row.workType, row.categoryCode].some((value) => String(value ?? "").toLowerCase().includes(q)))); const direction = args.direction === "asc" ? 1 : -1; rows.sort((a, b) => String(a[args.sortBy] ?? "").localeCompare(String(b[args.sortBy] ?? ""), undefined, { numeric: true }) * direction); const total = rows.length; const paged = rows.slice((args.page - 1) * args.pageSize, args.page * args.pageSize);
      return { total, latestRun: latest ? { id: latest.id, runId: latest.runId, status: latest.status, resultCount: latest.resultCount, warningCount: latest.warningCount, blockingCount: latest.blockingCount, startedAt: latest.startedAt.toISOString(), approvedAt: latest.approvedAt?.toISOString() ?? null } : null, rows: paged.map((row) => ({ id: row.id, periodCode: periods.find((item) => item.id === row.payrollPeriodId)?.periodId ?? "Unknown", projectCode: projects.find((item) => item.id === row.projectId)?.projectId ?? "Unknown", country: row.country, batchKey: row.batchKey, employeeIdentifier: row.employeeIdentifier, employeeName: row.employeeId ? employees.find((item) => item.id === row.employeeId)?.name ?? null : null, employeeId: row.employeeId, workType: row.workType, categoryCode: row.categoryCode, categoryName: row.categoryName, quantityUnit: row.quantityUnit, entryQuantity: row.entryQuantity, transmittedQuantity: row.transmittedQuantity, acceptedQuantity: row.acceptedQuantity, shipdetQuantity: row.shipdetQuantity, billableQuantity: row.billableQuantity, authorizedPayableQuantity: row.authorizedPayableQuantity, employeeAllocatedQuantity: row.employeeAllocatedQuantity, nonPayableQuantity: row.nonPayableQuantity, quantityDifference: row.quantityDifference, payableSource: row.payableSource, allocationPolicy: row.allocationPolicy, matchStatus: row.matchStatus, exceptionStatus: row.exceptionStatus, resolutionStatus: row.resolutionStatus, salaryApprovalStatus: row.salaryApprovalStatus })) };
    },
  }),

  listReconciliationExceptions: defineAction({
    request: authRequest.extend({ payrollPeriodId: z.number().int().positive().optional().nullable(), projectId: z.number().int().positive().optional().nullable(), severity: z.string().max(20).default(""), status: z.enum(["open", "resolved"]).default("open"), search: z.string().max(160).default(""), page: z.number().int().min(1).default(1), pageSize: z.number().int().min(10).max(100).default(25) }),
    response: z.object({ total: z.number(), blockingOpen: z.number(), rows: z.array(z.object({ id: z.number(), periodCode: z.string(), projectCode: z.string(), batchKey: z.string().nullable(), employeeIdentifier: z.string().nullable(), sourceFile: z.string().nullable(), exceptionType: z.string(), severity: z.string(), explanation: z.string(), recommendedAction: z.string(), resolutionStatus: z.string(), resolutionReason: z.string().nullable(), resolvedBy: z.string().nullable(), resolvedAt: z.string().nullable(), createdAt: z.string() })) }),
    async handler(ctx, args) {
      await requireUser(ctx, args.token, "reconciliation.read"); const db = ctx.db<typeof schema>(); const [runs, all, periods, projects, files, users] = await Promise.all([db.select().from(schema.reconciliationRuns).orderBy(desc(schema.reconciliationRuns.id)), db.select().from(schema.reconciliationExceptions).orderBy(desc(schema.reconciliationExceptions.id)), db.select().from(schema.payrollPeriods), db.select().from(schema.projects), db.select().from(schema.sourceFiles), db.select().from(schema.users)]); const latest = runs.find((row) => (!args.payrollPeriodId || row.payrollPeriodId === args.payrollPeriodId) && (!args.projectId || row.projectId === args.projectId)); const q = args.search.trim().toLowerCase(); const scoped = all.filter((row) => (!latest || row.reconciliationRunId === latest.id) && (!args.payrollPeriodId || row.payrollPeriodId === args.payrollPeriodId) && (!args.projectId || row.projectId === args.projectId)); const filtered = scoped.filter((row) => row.resolutionStatus === args.status && (!args.severity || row.severity === args.severity) && (!q || [row.batchKey, row.employeeIdentifier, row.exceptionType, row.explanation].some((value) => String(value ?? "").toLowerCase().includes(q)))); const page = filtered.slice((args.page - 1) * args.pageSize, args.page * args.pageSize);
      return { total: filtered.length, blockingOpen: scoped.filter((row) => row.severity === "blocking" && row.resolutionStatus === "open").length, rows: page.map((row) => ({ id: row.id, periodCode: periods.find((item) => item.id === row.payrollPeriodId)?.periodId ?? "Unknown", projectCode: projects.find((item) => item.id === row.projectId)?.projectId ?? "Unknown", batchKey: row.batchKey, employeeIdentifier: row.employeeIdentifier, sourceFile: row.sourceFileId ? files.find((item) => item.id === row.sourceFileId)?.originalFilename ?? null : null, exceptionType: row.exceptionType, severity: row.severity, explanation: row.explanation, recommendedAction: row.recommendedAction, resolutionStatus: row.resolutionStatus, resolutionReason: row.resolutionReason, resolvedBy: row.resolvedBy ? users.find((item) => item.id === row.resolvedBy)?.name ?? "Unknown user" : null, resolvedAt: row.resolvedAt?.toISOString() ?? null, createdAt: row.createdAt.toISOString() })) };
    },
  }),

  resolveReconciliationExceptions: defineAction({
    request: authRequest.extend({ ids: z.array(z.number().int().positive()).min(1).max(500), reason: z.string().trim().min(3).max(500) }),
    response: z.object({ resolved: z.number() }),
    async handler(ctx, args) {
      const actor = await requireUser(ctx, args.token, "reconciliation.manage"); const db = ctx.db<typeof schema>(); const rows = await db.select().from(schema.reconciliationExceptions).where(inArray(schema.reconciliationExceptions.id, args.ids)); if (!rows.length) throw new Error("No reconciliation exceptions were selected."); await db.update(schema.reconciliationExceptions).set({ resolutionStatus: "resolved", resolutionReason: args.reason, resolvedBy: actor.userId, resolvedAt: new Date() }).where(inArray(schema.reconciliationExceptions.id, rows.map((row) => row.id))); await db.update(schema.reconciliationResults).set({ resolutionStatus: "resolved" }).where(inArray(schema.reconciliationResults.reconciliationRunId, [...new Set(rows.map((row) => row.reconciliationRunId))])); await audit(ctx, actor.userId, "resolve", "reconciliation_exception", rows.map((row) => row.id).join(","), { resolved: rows.length }, undefined, args.reason); ctx.invalidateQueries(); return { resolved: rows.length };
    },
  }),

  approveReconciliation: defineAction({
    request: authRequest.extend({ reconciliationRunId: z.number().int().positive(), reason: z.string().trim().min(3).max(500) }),
    response: z.object({ approved: z.number() }),
    async handler(ctx, args) {
      const actor = await requireUser(ctx, args.token, "reconciliation.approve"); const db = ctx.db<typeof schema>(); const run = (await db.select().from(schema.reconciliationRuns).where(eq(schema.reconciliationRuns.id, args.reconciliationRunId)).limit(1))[0]; if (!run || run.status !== "completed") throw new Error("Only a completed reconciliation run can be approved."); const blockers = await db.select().from(schema.reconciliationExceptions).where(and(eq(schema.reconciliationExceptions.reconciliationRunId, run.id), eq(schema.reconciliationExceptions.severity, "blocking"), eq(schema.reconciliationExceptions.resolutionStatus, "open"))); if (blockers.length) throw new Error(`${blockers.length} unresolved blocking exceptions prevent approval.`); const results = await db.select().from(schema.reconciliationResults).where(eq(schema.reconciliationResults.reconciliationRunId, run.id)); if (!results.length) throw new Error("A reconciliation run with no result rows cannot be approved."); await db.update(schema.reconciliationRuns).set({ status: "approved", approvedBy: actor.userId, approvedAt: new Date(), approvalReason: args.reason }).where(eq(schema.reconciliationRuns.id, run.id)); await db.update(schema.reconciliationResults).set({ salaryApprovalStatus: "approved_for_salary", resolutionStatus: "resolved" }).where(eq(schema.reconciliationResults.reconciliationRunId, run.id)); await audit(ctx, actor.userId, "approve", "reconciliation", String(run.id), { approvedRows: results.length }, undefined, args.reason); ctx.invalidateQueries(); return { approved: results.length };
    },
  }),

  exportReconciliationWorkbook: defineAction({
    request: authRequest.extend({ payrollPeriodId: z.number().int().positive(), projectId: z.number().int().positive() }),
    response: z.object({ filename: z.string(), base64: z.string(), rowCount: z.number() }),
    async handler(ctx, args) {
      await requireUser(ctx, args.token, "reconciliation.export"); const db = ctx.db<typeof schema>(); const runs = await db.select().from(schema.reconciliationRuns).where(and(eq(schema.reconciliationRuns.payrollPeriodId, args.payrollPeriodId), eq(schema.reconciliationRuns.projectId, args.projectId))).orderBy(desc(schema.reconciliationRuns.id)).limit(1); const run = runs[0]; if (!run) throw new Error("Run reconciliation before exporting a workbook."); const [results, exceptions, periods, projects] = await Promise.all([db.select().from(schema.reconciliationResults).where(eq(schema.reconciliationResults.reconciliationRunId, run.id)), db.select().from(schema.reconciliationExceptions).where(eq(schema.reconciliationExceptions.reconciliationRunId, run.id)), db.select().from(schema.payrollPeriods).where(eq(schema.payrollPeriods.id, args.payrollPeriodId)).limit(1), db.select().from(schema.projects).where(eq(schema.projects.id, args.projectId)).limit(1)]); const reportRows = results.map((row) => ({ "Payroll Period": periods[0]?.periodId ?? "", Project: projects[0]?.projectId ?? "", Country: row.country ?? "", Batch: row.batchKey, Employee: row.employeeIdentifier ?? "", "Work Type": row.workType, Category: row.categoryName ?? row.categoryCode ?? "", Unit: row.quantityUnit, Entry: Number(row.entryQuantity), Transmitted: Number(row.transmittedQuantity), Accepted: Number(row.acceptedQuantity), Shipdet: Number(row.shipdetQuantity), Billable: Number(row.billableQuantity), "Authorized Payable": Number(row.authorizedPayableQuantity), "Employee Allocated": Number(row.employeeAllocatedQuantity), "Non-payable": Number(row.nonPayableQuantity), Difference: Number(row.quantityDifference), "Payable Source": row.payableSource, "Allocation Policy": row.allocationPolicy, "Match Status": row.matchStatus, "Exception Status": row.exceptionStatus, "Resolution Status": row.resolutionStatus })); const exceptionRows = exceptions.map((row) => ({ Severity: row.severity, Type: row.exceptionType, Batch: row.batchKey ?? "", Employee: row.employeeIdentifier ?? "", Explanation: row.explanation, "Recommended Action": row.recommendedAction, Status: row.resolutionStatus, "Resolution Reason": row.resolutionReason ?? "" })); const workbook = XLSX.utils.book_new(); const reportSheet = XLSX.utils.json_to_sheet(reportRows); const exceptionSheet = XLSX.utils.json_to_sheet(exceptionRows); reportSheet["!autofilter"] = { ref: reportSheet["!ref"] ?? "A1:A1" }; exceptionSheet["!autofilter"] = { ref: exceptionSheet["!ref"] ?? "A1:A1" }; reportSheet["!freeze"] = { xSplit: 0, ySplit: 1 }; exceptionSheet["!freeze"] = { xSplit: 0, ySplit: 1 }; XLSX.utils.book_append_sheet(workbook, reportSheet, "Reconciliation"); XLSX.utils.book_append_sheet(workbook, exceptionSheet, "Exceptions"); const base64 = XLSX.write(workbook, { type: "base64", bookType: "xlsx" }); return { filename: `${periods[0]?.periodId ?? "period"}-${projects[0]?.projectId ?? "project"}-reconciliation.xlsx`, base64, rowCount: results.length };
    },
  }),


  getSalarySetup: defineAction({
    request: authRequest.extend({ payrollPeriodId: z.number().int().positive(), projectId: z.number().int().positive() }),
    response: z.object({ policy: z.object({ roundingScope: z.string(), decimalPlaces: z.number() }), employees: z.array(z.object({ id: z.number(), employeeId: z.string(), name: z.string(), averageHours: z.string().nullable() })) }),
    async handler(ctx, args) {
      await requireUser(ctx, args.token, "salary.read"); const db = ctx.db<typeof schema>();
      const [policy, assignments, employees, inputs] = await Promise.all([db.select().from(schema.salaryCalculationPolicies).where(eq(schema.salaryCalculationPolicies.projectId, args.projectId)).limit(1), db.select().from(schema.employeeProjectAssignments).where(and(eq(schema.employeeProjectAssignments.projectId, args.projectId), eq(schema.employeeProjectAssignments.status, "active"))), db.select().from(schema.employees), db.select().from(schema.salaryInputs).where(and(eq(schema.salaryInputs.payrollPeriodId, args.payrollPeriodId), eq(schema.salaryInputs.projectId, args.projectId)))]);
      const ids = new Set(assignments.filter((item) => !item.payrollPeriodId || item.payrollPeriodId === args.payrollPeriodId).map((item) => item.employeeId));
      return { policy: { roundingScope: policy[0]?.roundingScope ?? "per_component", decimalPlaces: policy[0]?.decimalPlaces ?? 2 }, employees: employees.filter((item) => ids.has(item.id)).map((item) => ({ id: item.id, employeeId: item.employeeId, name: item.name, averageHours: inputs.find((input) => input.employeeId === item.id)?.averageHours ?? null })) };
    },
  }),

  saveSalaryPolicy: defineAction({
    request: authRequest.extend({ projectId: z.number().int().positive(), roundingScope: z.enum(["per_component", "per_project", "at_total"]), decimalPlaces: z.number().int().min(0).max(6) }),
    response: z.object({ saved: z.boolean() }),
    async handler(ctx, args) { const actor = await requireUser(ctx, args.token, "salary.adjust"); const db = ctx.db<typeof schema>(); await db.insert(schema.salaryCalculationPolicies).values({ projectId: args.projectId, roundingScope: args.roundingScope, decimalPlaces: args.decimalPlaces, updatedBy: actor.userId, updatedAt: new Date() }).onConflictDoUpdate({ target: schema.salaryCalculationPolicies.projectId, set: { roundingScope: args.roundingScope, decimalPlaces: args.decimalPlaces, updatedBy: actor.userId, updatedAt: new Date() } }); await audit(ctx, actor.userId, "configure", "salary_rounding_policy", String(args.projectId), { roundingScope: args.roundingScope, decimalPlaces: args.decimalPlaces }); ctx.invalidateQueries(); return { saved: true }; },
  }),

  saveSalaryInput: defineAction({
    request: authRequest.extend({ payrollPeriodId: z.number().int().positive(), projectId: z.number().int().positive(), employeeId: z.number().int().positive(), averageHours: z.string().trim().min(1).max(30), reason: z.string().trim().min(3).max(500) }),
    response: z.object({ saved: z.boolean() }),
    async handler(ctx, args) { const actor = await requireUser(ctx, args.token, "salary.adjust"); let hours: Decimal; try { hours = new Decimal(args.averageHours); } catch { throw new Error("Average hours must be a valid decimal."); } if (hours.isNegative() || hours.gt(24)) throw new Error("Average hours must be between 0 and 24."); const db = ctx.db<typeof schema>(); const values = { averageHours: hours.toString(), reason: args.reason, authorizedBy: actor.userId, authorizedAt: new Date() }; await db.insert(schema.salaryInputs).values({ payrollPeriodId: args.payrollPeriodId, projectId: args.projectId, employeeId: args.employeeId, ...values }).onConflictDoUpdate({ target: [schema.salaryInputs.payrollPeriodId, schema.salaryInputs.projectId, schema.salaryInputs.employeeId], set: values }); await audit(ctx, actor.userId, "authorize", "salary_average_hours", `${args.payrollPeriodId}:${args.projectId}:${args.employeeId}`, { averageHours: hours.toString() }, undefined, args.reason); ctx.invalidateQueries(); return { saved: true }; },
  }),

  runSalaryCalculation: defineAction({
    request: authRequest.extend({ payrollPeriodId: z.number().int().positive(), projectId: z.number().int().positive() }),
    response: z.object({ runId: z.string(), version: z.number(), status: z.enum(["completed", "blocked"]), componentCount: z.number(), exceptionCount: z.number(), finalTotal: z.string() }),
    async handler(ctx, args) { const actor = await requireUser(ctx, args.token, "salary.calculate"); return executeSalaryCalculation(ctx, actor, args.payrollPeriodId, args.projectId); },
  }),

  listSalaryRuns: defineAction({
    request: authRequest.extend({ payrollPeriodId: z.number().int().positive().nullable(), projectId: z.number().int().positive().nullable() }),
    response: z.object({ runs: z.array(z.object({ id: z.number(), runId: z.string(), version: z.number(), periodCode: z.string(), projectCode: z.string(), projectName: z.string(), currency: z.string(), status: z.string(), roundingScope: z.string(), decimalPlaces: z.number(), componentCount: z.number(), exceptionCount: z.number(), grossTotal: z.string(), adjustmentTotal: z.string(), finalTotal: z.string(), startedBy: z.string(), startedAt: z.string(), completedAt: z.string().nullable() })) }),
    async handler(ctx, args) { await requireUser(ctx, args.token, "salary.read"); const db = ctx.db<typeof schema>(); const [runs, periods, projects, users] = await Promise.all([db.select().from(schema.salaryCalculationRuns).orderBy(desc(schema.salaryCalculationRuns.id)), db.select().from(schema.payrollPeriods), db.select().from(schema.projects), db.select().from(schema.users)]); return { runs: runs.filter((run) => (!args.payrollPeriodId || run.payrollPeriodId === args.payrollPeriodId) && (!args.projectId || run.projectId === args.projectId)).map((run) => { const project = projects.find((item) => item.id === run.projectId); return { id: run.id, runId: run.runId, version: run.version, periodCode: periods.find((item) => item.id === run.payrollPeriodId)?.periodId ?? "Unknown", projectCode: project?.projectId ?? "Unknown", projectName: project?.name ?? "Unknown", currency: project?.currency ?? "", status: run.status, roundingScope: run.roundingScope, decimalPlaces: run.decimalPlaces, componentCount: run.componentCount, exceptionCount: run.exceptionCount, grossTotal: run.grossTotal, adjustmentTotal: run.adjustmentTotal, finalTotal: run.finalTotal, startedBy: users.find((item) => item.id === run.startedBy)?.name ?? "Unknown", startedAt: run.startedAt.toISOString(), completedAt: run.completedAt?.toISOString() ?? null }; }) }; },
  }),

  getSalaryRun: defineAction({
    request: authRequest.extend({ salaryRunId: z.number().int().positive() }),
    response: z.object({ run: z.object({ id: z.number(), runId: z.string(), version: z.number(), status: z.string(), payrollPeriodId: z.number(), projectId: z.number(), periodCode: z.string(), projectCode: z.string(), projectName: z.string(), currency: z.string(), roundingScope: z.string(), decimalPlaces: z.number(), grossTotal: z.string(), adjustmentTotal: z.string(), finalTotal: z.string() }), components: z.array(z.object({ id: z.number(), reconciliationResultId: z.number(), employeeId: z.number(), employeeIdentifier: z.string(), employeeName: z.string(), country: z.string(), workType: z.string(), category: z.string().nullable(), quantityUnit: z.string(), quantitySource: z.string(), approvedPayableQuantity: z.string(), entryQuantity: z.string(), transmittedQuantity: z.string(), acceptedQuantity: z.string(), shippedQuantity: z.string(), appliedRate: z.string(), rateRuleId: z.number(), formulaRuleId: z.string(), allocationMethod: z.string(), multiplier: z.string(), grossAmount: z.string(), approvedAdjustment: z.string(), finalAmount: z.string(), sourceTraceJson: z.string() })), exceptions: z.array(z.object({ id: z.number(), type: z.string(), explanation: z.string(), recommendedAction: z.string(), employeeIdentifier: z.string().nullable() })) }),
    async handler(ctx, args) { await requireUser(ctx, args.token, "salary.read"); const db = ctx.db<typeof schema>(); const run = (await db.select().from(schema.salaryCalculationRuns).where(eq(schema.salaryCalculationRuns.id, args.salaryRunId)).limit(1))[0]; if (!run) throw new Error("Salary run not found."); const [period, project, components, exceptions, employees, recon] = await Promise.all([db.select().from(schema.payrollPeriods).where(eq(schema.payrollPeriods.id, run.payrollPeriodId)).limit(1), db.select().from(schema.projects).where(eq(schema.projects.id, run.projectId ?? 0)).limit(1), db.select().from(schema.salaryComponents).where(eq(schema.salaryComponents.salaryRunId, run.id)), db.select().from(schema.salaryExceptions).where(eq(schema.salaryExceptions.salaryRunId, run.id)), db.select().from(schema.employees), db.select().from(schema.reconciliationResults).where(eq(schema.reconciliationResults.reconciliationRunId, (await db.select().from(schema.reconciliationRuns).where(and(eq(schema.reconciliationRuns.payrollPeriodId, run.payrollPeriodId), eq(schema.reconciliationRuns.projectId, run.projectId ?? 0), eq(schema.reconciliationRuns.status, "approved"))).orderBy(desc(schema.reconciliationRuns.id)).limit(1))[0]?.id ?? 0))]); const reconMap = new Map(recon.map((item) => [item.id, item])); return { run: { id: run.id, runId: run.runId, version: run.version, status: run.status, payrollPeriodId: run.payrollPeriodId, projectId: run.projectId ?? 0, periodCode: period[0]?.periodId ?? "Unknown", projectCode: project[0]?.projectId ?? "Unknown", projectName: project[0]?.name ?? "Unknown", currency: project[0]?.currency ?? "", roundingScope: run.roundingScope, decimalPlaces: run.decimalPlaces, grossTotal: run.grossTotal, adjustmentTotal: run.adjustmentTotal, finalTotal: run.finalTotal }, components: components.map((item) => { const employee = employees.find((row) => row.id === item.employeeId); const source = reconMap.get(item.reconciliationResultId); return { id: item.id, reconciliationResultId: item.reconciliationResultId, employeeId: item.employeeId, employeeIdentifier: employee?.employeeId ?? "Unknown", employeeName: employee?.name ?? "Unknown", country: item.country, workType: item.workType, category: item.categoryName ?? item.categoryCode, quantityUnit: item.quantityUnit, quantitySource: item.quantitySource, approvedPayableQuantity: item.approvedPayableQuantity, entryQuantity: source?.entryQuantity ?? "0", transmittedQuantity: source?.transmittedQuantity ?? "0", acceptedQuantity: source?.acceptedQuantity ?? "0", shippedQuantity: source?.shipdetQuantity ?? "0", appliedRate: item.appliedRate, rateRuleId: item.rateRuleId, formulaRuleId: item.formulaRuleId, allocationMethod: item.allocationMethod, multiplier: item.multiplier, grossAmount: item.grossAmount, approvedAdjustment: item.approvedAdjustment, finalAmount: item.finalAmount, sourceTraceJson: item.sourceTraceJson }; }), exceptions: exceptions.map((item) => ({ id: item.id, type: item.exceptionType, explanation: item.explanation, recommendedAction: item.recommendedAction, employeeIdentifier: employees.find((row) => row.id === item.employeeId)?.employeeId ?? null })) }; },
  }),

  applyManualAdjustment: defineAction({
    request: authRequest.extend({ payrollPeriodId: z.number().int().positive(), projectId: z.number().int().positive(), employeeId: z.number().int().positive(), reconciliationResultId: z.number().int().positive(), amount: z.string().trim().min(1).max(40), reason: z.string().trim().min(3).max(500) }),
    response: z.object({ adjustmentId: z.number(), runId: z.string(), version: z.number(), status: z.enum(["completed", "blocked"]), componentCount: z.number(), exceptionCount: z.number(), finalTotal: z.string() }),
    async handler(ctx, args) { const actor = await requireUser(ctx, args.token, "salary.adjust"); let amount: Decimal; try { amount = new Decimal(args.amount); } catch { throw new Error("Adjustment amount must be a valid decimal."); } if (amount.isZero()) throw new Error("Adjustment amount cannot be zero."); const db = ctx.db<typeof schema>(); const source = (await db.select().from(schema.reconciliationResults).where(and(eq(schema.reconciliationResults.id, args.reconciliationResultId), eq(schema.reconciliationResults.payrollPeriodId, args.payrollPeriodId), eq(schema.reconciliationResults.projectId, args.projectId), eq(schema.reconciliationResults.employeeId, args.employeeId), eq(schema.reconciliationResults.salaryApprovalStatus, "approved_for_salary"))).limit(1))[0]; if (!source) throw new Error("The adjustment must reference an approved payable quantity for this employee."); const inserted = (await db.insert(schema.manualAdjustments).values({ payrollPeriodId: args.payrollPeriodId, projectId: args.projectId, employeeId: args.employeeId, reconciliationResultId: args.reconciliationResultId, amount: amount.toString(), reason: args.reason, authorizedBy: actor.userId }).returning())[0]; if (!inserted) throw new Error("The adjustment could not be recorded."); await audit(ctx, actor.userId, "authorize", "manual_salary_adjustment", String(inserted.id), { amount: amount.toString(), reconciliationResultId: args.reconciliationResultId }, undefined, args.reason); const result = await executeSalaryCalculation(ctx, actor, args.payrollPeriodId, args.projectId); return { adjustmentId: inserted.id, ...result }; },
  }),

  getEmployeeSalaryDetails: defineAction({
    request: authRequest.extend({ payrollPeriodId: z.number().int().positive(), employeeId: z.number().int().positive().nullable() }),
    response: z.object({ employees: z.array(z.object({ id: z.number(), employeeId: z.string(), name: z.string(), grandTotal: z.string(), projects: z.array(z.object({ projectId: z.number(), salaryRunId: z.number(), projectCode: z.string(), projectName: z.string(), currency: z.string(), subtotal: z.string(), componentCount: z.number(), runVersion: z.number() })) })) }),
    async handler(ctx, args) { await requireUser(ctx, args.token, "salary.read"); const db = ctx.db<typeof schema>(); const [runs, projects, employees] = await Promise.all([db.select().from(schema.salaryCalculationRuns).where(and(eq(schema.salaryCalculationRuns.payrollPeriodId, args.payrollPeriodId), eq(schema.salaryCalculationRuns.status, "completed"))).orderBy(desc(schema.salaryCalculationRuns.version)), db.select().from(schema.projects), db.select().from(schema.employees)]); const latest = new Map<number, typeof runs[number]>(); for (const run of runs) if (run.projectId && !latest.has(run.projectId)) latest.set(run.projectId, run); const runIds = [...latest.values()].map((run) => run.id); const components = runIds.length ? await db.select().from(schema.salaryComponents).where(inArray(schema.salaryComponents.salaryRunId, runIds)) : []; const employeeIds = [...new Set(components.map((item) => item.employeeId))].filter((id) => !args.employeeId || id === args.employeeId); return { employees: employeeIds.map((id) => { const employee = employees.find((item) => item.id === id); const own = components.filter((item) => item.employeeId === id); const projectIds = [...new Set(own.map((item) => item.projectId))]; const projectRows = projectIds.map((projectId) => { const project = projects.find((item) => item.id === projectId); const items = own.filter((item) => item.projectId === projectId); const run = latest.get(projectId); return { projectId, salaryRunId: run?.id ?? 0, projectCode: project?.projectId ?? "Unknown", projectName: project?.name ?? "Unknown", currency: project?.currency ?? "", subtotal: items.reduce((sum, item) => sum.plus(item.finalAmount), new Decimal(0)).toFixed(run?.decimalPlaces ?? 2), componentCount: items.length, runVersion: run?.version ?? 0 }; }); return { id, employeeId: employee?.employeeId ?? "Unknown", name: employee?.name ?? "Unknown", grandTotal: own.reduce((sum, item) => sum.plus(item.finalAmount), new Decimal(0)).toFixed(2), projects: projectRows }; }) }; },
  }),

  generateMasterSalary: defineAction({
    request: authRequest.extend({ payrollPeriodId: z.number().int().positive() }),
    response: z.object({ runId: z.string(), version: z.number(), status: z.enum(["completed", "blocked"]), projectCount: z.number(), employeeCount: z.number(), exceptionCount: z.number(), finalTotal: z.string() }),
    async handler(ctx, args) {
      const actor = await requireUser(ctx, args.token, "master.generate"); const db = ctx.db<typeof schema>();
      const period = (await db.select().from(schema.payrollPeriods).where(eq(schema.payrollPeriods.id, args.payrollPeriodId)).limit(1))[0];
      if (!period) throw new Error("Payroll period not found.");
      if (["Approved", "Locked", "Exported"].includes(period.status)) throw new Error("Protected payroll cannot be consolidated again. Record a controlled correction instead.");
      const [periodProjects, projects, allRuns, _employees, _mappings, adjustments] = await Promise.all([
        db.select().from(schema.projectPeriodConfigurations).where(and(eq(schema.projectPeriodConfigurations.payrollPeriodId, args.payrollPeriodId), eq(schema.projectPeriodConfigurations.active, true))),
        db.select().from(schema.projects),
        db.select().from(schema.salaryCalculationRuns).where(eq(schema.salaryCalculationRuns.payrollPeriodId, args.payrollPeriodId)).orderBy(desc(schema.salaryCalculationRuns.version)),
        db.select().from(schema.employees), db.select().from(schema.employeeIdMappings),
        db.select().from(schema.masterAdjustments).where(and(eq(schema.masterAdjustments.payrollPeriodId, args.payrollPeriodId), eq(schema.masterAdjustments.status, "approved"))),
      ]);
      const activeProjectIds = periodProjects.map((item) => item.projectId); const latestRuns = activeProjectIds.map((projectId) => allRuns.find((run) => run.projectId === projectId && run.status === "completed")).filter((run): run is NonNullable<typeof run> => Boolean(run));
      const prior = await db.select().from(schema.masterSalaryRuns).where(eq(schema.masterSalaryRuns.payrollPeriodId, args.payrollPeriodId)).orderBy(desc(schema.masterSalaryRuns.version)).limit(1); const version = (prior[0]?.version ?? 0) + 1; const runCode = `MST-${args.payrollPeriodId}-V${version}-${Date.now().toString(36).toUpperCase()}`;
      const inserted = (await db.insert(schema.masterSalaryRuns).values({ runId: runCode, payrollPeriodId: args.payrollPeriodId, version, salaryRunIdsJson: JSON.stringify(latestRuns.map((run) => run.id)), projectCount: activeProjectIds.length, generatedBy: actor.userId }).returning())[0]; if (!inserted) throw new Error("Master Salary run could not be created.");
      const exceptions: Array<typeof schema.masterSalaryExceptions.$inferInsert> = [];
      for (const projectId of activeProjectIds) if (!latestRuns.some((run) => run.projectId === projectId)) exceptions.push({ masterRunId: inserted.id, payrollPeriodId: args.payrollPeriodId, projectId, exceptionType: "MISSING_COMPLETED_PROJECT_SALARY", explanation: `Active project ${projects.find((item) => item.id === projectId)?.projectId ?? projectId} has no completed salary version.` });
      const currencies = [...new Set(activeProjectIds.map((id) => projects.find((item) => item.id === id)?.currency).filter(Boolean))]; if (currencies.length > 1) exceptions.push({ masterRunId: inserted.id, payrollPeriodId: args.payrollPeriodId, exceptionType: "INCONSISTENT_CURRENCY", explanation: `Active projects use multiple currencies (${currencies.join(", ")}); Master Salary cannot combine them without an approved conversion rule.` });
      const runIds = latestRuns.map((run) => run.id); const components = runIds.length ? await db.select().from(schema.salaryComponents).where(inArray(schema.salaryComponents.salaryRunId, runIds)) : [];
      for (const run of latestRuns) { const componentTotal = components.filter((item) => item.salaryRunId === run.id).reduce((sum, item) => sum.plus(item.finalAmount), new Decimal(0)).toDecimalPlaces(run.decimalPlaces); if (!componentTotal.eq(new Decimal(run.finalTotal))) exceptions.push({ masterRunId: inserted.id, payrollPeriodId: args.payrollPeriodId, projectId: run.projectId, exceptionType: "PROJECT_TOTAL_MISMATCH", explanation: `Project component total ${componentTotal.toFixed(run.decimalPlaces)} does not equal approved salary run total ${run.finalTotal}.` }); }
      const employeeIds = [...new Set([...components.map((item) => item.employeeId), ...adjustments.map((item) => item.employeeId)])]; let grandGross = new Decimal(0); let grandBonus = new Decimal(0); let grandDeduction = new Decimal(0); let grandFinal = new Decimal(0);
      for (const employeeId of employeeIds) {
        const own = components.filter((item) => item.employeeId === employeeId); const projectAmounts: Record<string, string> = {}; for (const projectId of activeProjectIds) { const total = own.filter((item) => item.projectId === projectId).reduce((sum, item) => sum.plus(item.finalAmount), new Decimal(0)); projectAmounts[String(projectId)] = money(total, 2); }
        const classify = (name: string) => name.trim().toLowerCase(); const production = own.filter((item) => !classify(item.workType).includes("doctype") && !classify(item.workType).includes("proof")).reduce((sum, item) => sum.plus(item.finalAmount), new Decimal(0)); const doctype = own.filter((item) => classify(item.workType).includes("doctype")).reduce((sum, item) => sum.plus(item.finalAmount), new Decimal(0)); const proof = own.filter((item) => classify(item.workType).includes("proof")).reduce((sum, item) => sum.plus(item.finalAmount), new Decimal(0));
        const ownAdjustments = adjustments.filter((item) => item.employeeId === employeeId); const bonuses = ownAdjustments.filter((item) => item.adjustmentType === "bonus").reduce((sum, item) => sum.plus(item.amount), new Decimal(0)); const deductions = ownAdjustments.filter((item) => item.adjustmentType === "deduction").reduce((sum, item) => sum.plus(item.amount), new Decimal(0)); const other = ownAdjustments.filter((item) => item.adjustmentType === "other").reduce((sum, item) => sum.plus(item.amount), new Decimal(0));
        const projectTotal = Object.values(projectAmounts).reduce((sum, value) => sum.plus(value), new Decimal(0)); const componentTotal = production.plus(doctype).plus(proof); if (!projectTotal.eq(componentTotal)) exceptions.push({ masterRunId: inserted.id, payrollPeriodId: args.payrollPeriodId, employeeId, exceptionType: "EMPLOYEE_PROJECT_MISMATCH", explanation: `Employee project totals ${projectTotal.toFixed(2)} do not equal detail totals ${componentTotal.toFixed(2)}.` });
        const gross = componentTotal.plus(other).plus(bonuses); const final = gross.minus(deductions); if (final.isNegative()) exceptions.push({ masterRunId: inserted.id, payrollPeriodId: args.payrollPeriodId, employeeId, exceptionType: "NEGATIVE_FINAL_PAYABLE", explanation: "Approved deductions exceed gross salary; review is required before approval." });
        await db.insert(schema.masterSalaryResults).values({ masterRunId: inserted.id, payrollPeriodId: args.payrollPeriodId, employeeId, projectAmountsJson: JSON.stringify(projectAmounts), productionSalary: money(production, 2), doctypeSalary: money(doctype, 2), proofSalary: money(proof, 2), otherComponents: money(other, 2), bonuses: money(bonuses, 2), deductions: money(deductions, 2), grossSalary: money(gross, 2), finalPayableSalary: money(final, 2), reconciliationStatus: final.isNegative() ? "blocking" : "clear" }); grandGross = grandGross.plus(gross); grandBonus = grandBonus.plus(bonuses); grandDeduction = grandDeduction.plus(deductions); grandFinal = grandFinal.plus(final);
      }
      for (const item of exceptions) await db.insert(schema.masterSalaryExceptions).values(item);
      const status = exceptions.length ? "blocked" as const : "completed" as const; await db.update(schema.masterSalaryRuns).set({ status, employeeCount: employeeIds.length, exceptionCount: exceptions.length, grossTotal: money(grandGross, 2), bonusTotal: money(grandBonus, 2), deductionTotal: money(grandDeduction, 2), finalTotal: money(grandFinal, 2) }).where(eq(schema.masterSalaryRuns.id, inserted.id));
      if (status === "completed" && adjustments.length) await db.update(schema.masterAdjustments).set({ appliedMasterRunId: inserted.id }).where(inArray(schema.masterAdjustments.id, adjustments.map((item) => item.id)));
      await audit(ctx, actor.userId, "generate", "master_salary", String(inserted.id), { runCode, version, status, projectCount: activeProjectIds.length, employeeCount: employeeIds.length, exceptions: exceptions.length, finalTotal: money(grandFinal, 2) }); ctx.invalidateQueries(); return { runId: runCode, version, status, projectCount: activeProjectIds.length, employeeCount: employeeIds.length, exceptionCount: exceptions.length, finalTotal: money(grandFinal, 2) };
    },
  }),

  getMasterSalary: defineAction({
    request: authRequest.extend({ payrollPeriodId: z.number().int().positive() }),
    response: z.object({ period: z.object({ id: z.number(), periodId: z.string(), status: z.string() }), projects: z.array(z.object({ id: z.number(), projectId: z.string(), name: z.string(), currency: z.string() })), run: z.object({ id: z.number(), runId: z.string(), version: z.number(), status: z.string(), projectCount: z.number(), employeeCount: z.number(), exceptionCount: z.number(), grossTotal: z.string(), bonusTotal: z.string(), deductionTotal: z.string(), finalTotal: z.string(), generatedAt: z.string() }).nullable(), rows: z.array(z.object({ id: z.number(), employeeId: z.number(), employeeCode: z.string(), employeeName: z.string(), previousIds: z.array(z.string()), joiningDate: z.string().nullable(), designation: z.string().nullable(), contractType: z.string().nullable(), projectAmounts: z.record(z.string(), z.string()), productionSalary: z.string(), doctypeSalary: z.string(), proofSalary: z.string(), otherComponents: z.string(), bonuses: z.string(), deductions: z.string(), grossSalary: z.string(), finalPayableSalary: z.string(), reconciliationStatus: z.string() })), exceptions: z.array(z.object({ id: z.number(), type: z.string(), explanation: z.string(), projectCode: z.string().nullable(), employeeCode: z.string().nullable() })) }),
    async handler(ctx, args) {
      await requireUser(ctx, args.token, "master.read"); const db = ctx.db<typeof schema>(); const period = (await db.select().from(schema.payrollPeriods).where(eq(schema.payrollPeriods.id, args.payrollPeriodId)).limit(1))[0]; if (!period) throw new Error("Payroll period not found."); const run = (await db.select().from(schema.masterSalaryRuns).where(eq(schema.masterSalaryRuns.payrollPeriodId, args.payrollPeriodId)).orderBy(desc(schema.masterSalaryRuns.version)).limit(1))[0]; const [periodProjects, projects, employees, mappings] = await Promise.all([db.select().from(schema.projectPeriodConfigurations).where(and(eq(schema.projectPeriodConfigurations.payrollPeriodId, args.payrollPeriodId), eq(schema.projectPeriodConfigurations.active, true))), db.select().from(schema.projects), db.select().from(schema.employees), db.select().from(schema.employeeIdMappings)]); const projectRows = periodProjects.map((item) => projects.find((project) => project.id === item.projectId)).filter((project): project is NonNullable<typeof project> => Boolean(project)); if (!run) return { period: { id: period.id, periodId: period.periodId, status: period.status }, projects: projectRows.map((item) => ({ id: item.id, projectId: item.projectId, name: item.name, currency: item.currency })), run: null, rows: [], exceptions: [] }; const [rows, exceptions] = await Promise.all([db.select().from(schema.masterSalaryResults).where(eq(schema.masterSalaryResults.masterRunId, run.id)), db.select().from(schema.masterSalaryExceptions).where(eq(schema.masterSalaryExceptions.masterRunId, run.id))]); return { period: { id: period.id, periodId: period.periodId, status: period.status }, projects: projectRows.map((item) => ({ id: item.id, projectId: item.projectId, name: item.name, currency: item.currency })), run: { id: run.id, runId: run.runId, version: run.version, status: run.status, projectCount: run.projectCount, employeeCount: run.employeeCount, exceptionCount: run.exceptionCount, grossTotal: run.grossTotal, bonusTotal: run.bonusTotal, deductionTotal: run.deductionTotal, finalTotal: run.finalTotal, generatedAt: run.generatedAt.toISOString() }, rows: rows.map((row) => { const employee = employees.find((item) => item.id === row.employeeId); let amounts: Record<string, string> = {}; try { amounts = JSON.parse(row.projectAmountsJson) as Record<string, string>; } catch { amounts = {}; } return { id: row.id, employeeId: row.employeeId, employeeCode: employee?.employeeId ?? "Unknown", employeeName: employee?.name ?? "Unknown", previousIds: mappings.filter((item) => item.employeeId === row.employeeId).map((item) => item.previousEmployeeId), joiningDate: employee?.joiningDate ?? null, designation: employee?.designation ?? null, contractType: employee?.contractType ?? null, projectAmounts: amounts, productionSalary: row.productionSalary, doctypeSalary: row.doctypeSalary, proofSalary: row.proofSalary, otherComponents: row.otherComponents, bonuses: row.bonuses, deductions: row.deductions, grossSalary: row.grossSalary, finalPayableSalary: row.finalPayableSalary, reconciliationStatus: row.reconciliationStatus }; }), exceptions: exceptions.map((item) => ({ id: item.id, type: item.exceptionType, explanation: item.explanation, projectCode: item.projectId ? projects.find((project) => project.id === item.projectId)?.projectId ?? null : null, employeeCode: item.employeeId ? employees.find((employee) => employee.id === item.employeeId)?.employeeId ?? null : null })) };
    },
  }),

  addMasterAdjustment: defineAction({
    request: authRequest.extend({ payrollPeriodId: z.number().int().positive(), employeeId: z.number().int().positive(), adjustmentType: z.enum(["bonus", "deduction", "other"]), amount: z.string().trim().min(1).max(40), reason: z.string().trim().min(3).max(500) }),
    response: z.object({ id: z.number(), status: z.string() }),
    async handler(ctx, args) { const actor = await requireUser(ctx, args.token, "salary.adjust"); const db = ctx.db<typeof schema>(); const period = (await db.select().from(schema.payrollPeriods).where(eq(schema.payrollPeriods.id, args.payrollPeriodId)).limit(1))[0]; if (!period) throw new Error("Payroll period not found."); let amount: Decimal; try { amount = new Decimal(args.amount); } catch { throw new Error("Amount must be a valid decimal."); } if (amount.lte(0)) throw new Error("Enter a positive amount; the adjustment type determines how it is applied."); const status = ["Locked", "Exported"].includes(period.status) ? "pending_revision" as const : "approved" as const; const inserted = (await db.insert(schema.masterAdjustments).values({ payrollPeriodId: args.payrollPeriodId, employeeId: args.employeeId, adjustmentType: args.adjustmentType, amount: amount.toString(), reason: args.reason, status, authorizedBy: actor.userId }).returning())[0]; if (!inserted) throw new Error("Adjustment could not be recorded."); await audit(ctx, actor.userId, status === "pending_revision" ? "request_correction" : "authorize", "master_adjustment", String(inserted.id), { type: args.adjustmentType, amount: amount.toString(), status }, undefined, args.reason); ctx.invalidateQueries(); return { id: inserted.id, status }; },
  }),

  getPayrollApproval: defineAction({
    request: authRequest.extend({ payrollPeriodId: z.number().int().positive() }),
    response: z.object({ period: z.object({ id: z.number(), periodId: z.string(), status: z.string(), approvalAt: z.string().nullable(), lockAt: z.string().nullable() }), latestMaster: z.object({ id: z.number(), runId: z.string(), version: z.number(), status: z.string(), exceptionCount: z.number(), finalTotal: z.string() }).nullable(), blocking: z.object({ reconciliation: z.number(), salary: z.number(), master: z.number() }), records: z.array(z.object({ id: z.number(), action: z.string(), fromStatus: z.string(), toStatus: z.string(), reason: z.string(), actor: z.string(), actedAt: z.string() })) }),
    async handler(ctx, args) { await requireUser(ctx, args.token, "master.read"); const db = ctx.db<typeof schema>(); const period = (await db.select().from(schema.payrollPeriods).where(eq(schema.payrollPeriods.id, args.payrollPeriodId)).limit(1))[0]; if (!period) throw new Error("Payroll period not found."); const master = (await db.select().from(schema.masterSalaryRuns).where(eq(schema.masterSalaryRuns.payrollPeriodId, args.payrollPeriodId)).orderBy(desc(schema.masterSalaryRuns.version)).limit(1))[0]; const [recon, salary, masterExceptions, records, users] = await Promise.all([db.select().from(schema.reconciliationExceptions).where(and(eq(schema.reconciliationExceptions.payrollPeriodId, args.payrollPeriodId), eq(schema.reconciliationExceptions.severity, "blocking"), eq(schema.reconciliationExceptions.resolutionStatus, "open"))), db.select().from(schema.salaryExceptions).where(eq(schema.salaryExceptions.payrollPeriodId, args.payrollPeriodId)), master ? db.select().from(schema.masterSalaryExceptions).where(eq(schema.masterSalaryExceptions.masterRunId, master.id)) : Promise.resolve([]), db.select().from(schema.approvalRecords).where(eq(schema.approvalRecords.payrollPeriodId, args.payrollPeriodId)).orderBy(desc(schema.approvalRecords.id)), db.select().from(schema.users)]); return { period: { id: period.id, periodId: period.periodId, status: period.status, approvalAt: period.approvalAt?.toISOString() ?? null, lockAt: period.lockAt?.toISOString() ?? null }, latestMaster: master ? { id: master.id, runId: master.runId, version: master.version, status: master.status, exceptionCount: master.exceptionCount, finalTotal: master.finalTotal } : null, blocking: { reconciliation: recon.length, salary: salary.length, master: masterExceptions.length }, records: records.map((item) => ({ id: item.id, action: item.action, fromStatus: item.fromStatus, toStatus: item.toStatus, reason: item.reason, actor: users.find((user) => user.id === item.actedBy)?.name ?? "Unknown", actedAt: item.actedAt.toISOString() })) }; },
  }),

  advancePayrollApproval: defineAction({
    request: authRequest.extend({ payrollPeriodId: z.number().int().positive(), action: z.enum(["submitted_for_review", "approved", "returned", "locked", "exported"]), reason: z.string().trim().min(3).max(500) }),
    response: z.object({ status: z.string() }),
    async handler(ctx, args) { const required: PermissionCode = args.action === "submitted_for_review" || args.action === "returned" ? "payroll.review" : args.action === "approved" ? "payroll.approve" : "payroll.lock"; const actor = await requireUser(ctx, args.token, required); const db = ctx.db<typeof schema>(); const period = (await db.select().from(schema.payrollPeriods).where(eq(schema.payrollPeriods.id, args.payrollPeriodId)).limit(1))[0]; if (!period) throw new Error("Payroll period not found."); const master = (await db.select().from(schema.masterSalaryRuns).where(and(eq(schema.masterSalaryRuns.payrollPeriodId, args.payrollPeriodId), eq(schema.masterSalaryRuns.status, "completed"))).orderBy(desc(schema.masterSalaryRuns.version)).limit(1))[0]; const map: Record<string, { from: string[]; to: string }> = { submitted_for_review: { from: ["Calculated"], to: "Under Review" }, returned: { from: ["Under Review"], to: "Calculated" }, approved: { from: ["Under Review"], to: "Approved" }, locked: { from: ["Approved"], to: "Locked" }, exported: { from: ["Locked"], to: "Exported" } }; const next = map[args.action]; if (!next || !next.from.includes(period.status)) throw new Error(`Action ${args.action.replace(/_/g, " ")} is not allowed from ${period.status}.`); if (args.action !== "returned" && !master) throw new Error("A completed Master Salary version is required."); if (args.action === "approved") { const [reconBlockers, salaryBlockers, masterBlockers] = await Promise.all([db.select().from(schema.reconciliationExceptions).where(and(eq(schema.reconciliationExceptions.payrollPeriodId, args.payrollPeriodId), eq(schema.reconciliationExceptions.severity, "blocking"), eq(schema.reconciliationExceptions.resolutionStatus, "open"))), db.select().from(schema.salaryExceptions).where(eq(schema.salaryExceptions.payrollPeriodId, args.payrollPeriodId)), master ? db.select().from(schema.masterSalaryExceptions).where(eq(schema.masterSalaryExceptions.masterRunId, master.id)) : Promise.resolve([])]); const blocking = reconBlockers.length + salaryBlockers.length + masterBlockers.length; if (blocking) throw new Error(`${blocking} unresolved blocking exceptions prevent approval.`); } if (args.action === "exported") { const exports = await db.select().from(schema.exportJobs).where(and(eq(schema.exportJobs.payrollPeriodId, args.payrollPeriodId), eq(schema.exportJobs.status, "completed"), eq(schema.exportJobs.exportType, "master_salary"))).limit(1); if (!exports[0]) throw new Error("Generate the Master Salary workbook before marking payroll exported."); } const changes: Partial<typeof schema.payrollPeriods.$inferInsert> = { status: next.to, updatedAt: new Date() }; if (next.to === "Approved") { changes.approverId = actor.userId; changes.approvalAt = new Date(); } if (next.to === "Locked") changes.lockAt = new Date(); await db.update(schema.payrollPeriods).set(changes).where(eq(schema.payrollPeriods.id, period.id)); await db.insert(schema.approvalRecords).values({ payrollPeriodId: period.id, masterRunId: master?.id ?? null, action: args.action, fromStatus: period.status, toStatus: next.to, reason: args.reason, actedBy: actor.userId }); await audit(ctx, actor.userId, args.action, "payroll_period", String(period.id), { status: next.to, masterRunId: master?.id ?? null }, { status: period.status }, args.reason); ctx.invalidateQueries(); return { status: next.to }; },
  }),

  createExportJob: defineAction({
    request: authRequest.extend({ payrollPeriodId: z.number().int().positive(), exportType: z.enum(["project_salary", "employee_salary", "master_salary", "production_reconciliation", "transmitted_reconciliation", "shipdet_reconciliation", "doctype_salary", "proof_salary", "exception_report", "payroll_audit"]) }),
    response: z.object({ id: z.number(), jobId: z.string(), status: z.string(), filename: z.string(), rowCount: z.number(), downloadUrl: z.string() }),
    async handler(ctx, args) {
      const actor = await requireUser(ctx, args.token, "exports.manage"); const db = ctx.db<typeof schema>(); const period = (await db.select().from(schema.payrollPeriods).where(eq(schema.payrollPeriods.id, args.payrollPeriodId)).limit(1))[0]; if (!period) throw new Error("Payroll period not found."); const master = (await db.select().from(schema.masterSalaryRuns).where(and(eq(schema.masterSalaryRuns.payrollPeriodId, args.payrollPeriodId), eq(schema.masterSalaryRuns.status, "completed"))).orderBy(desc(schema.masterSalaryRuns.version)).limit(1))[0]; if (!master) throw new Error("Generate a completed Master Salary version before exporting."); const jobCode = `EXP-${Date.now().toString(36).toUpperCase()}-${crypto.randomUUID().slice(0, 6).toUpperCase()}`; const inserted = (await db.insert(schema.exportJobs).values({ jobId: jobCode, payrollPeriodId: args.payrollPeriodId, masterRunId: master.id, exportType: args.exportType, status: "processing", progress: 5, generatedBy: actor.userId }).returning())[0]; if (!inserted) throw new Error("Export job could not be created.");
      try {
        const [projects, employees, mappings, components, recon, transmitted, shipdet, reconExceptions, salaryExceptions, masterExceptions, auditRows, masterRows, salaryRuns, users] = await Promise.all([db.select().from(schema.projects), db.select().from(schema.employees), db.select().from(schema.employeeIdMappings), db.select().from(schema.salaryComponents).where(eq(schema.salaryComponents.payrollPeriodId, args.payrollPeriodId)), db.select().from(schema.reconciliationResults).where(eq(schema.reconciliationResults.payrollPeriodId, args.payrollPeriodId)), db.select().from(schema.transmittedBatches).where(eq(schema.transmittedBatches.payrollPeriodId, args.payrollPeriodId)), db.select().from(schema.shipdetBatches).where(eq(schema.shipdetBatches.payrollPeriodId, args.payrollPeriodId)), db.select().from(schema.reconciliationExceptions).where(eq(schema.reconciliationExceptions.payrollPeriodId, args.payrollPeriodId)), db.select().from(schema.salaryExceptions).where(eq(schema.salaryExceptions.payrollPeriodId, args.payrollPeriodId)), db.select().from(schema.masterSalaryExceptions).where(eq(schema.masterSalaryExceptions.masterRunId, master.id)), db.select().from(schema.auditLogs).orderBy(asc(schema.auditLogs.id)), db.select().from(schema.masterSalaryResults).where(eq(schema.masterSalaryResults.masterRunId, master.id)), db.select().from(schema.salaryCalculationRuns).where(eq(schema.salaryCalculationRuns.payrollPeriodId, args.payrollPeriodId)), db.select().from(schema.users)]);
        const approvedRunIds = (() => { let ids: number[] = []; try { ids = JSON.parse(master.salaryRunIdsJson) as number[]; } catch { ids = []; } return new Set(ids); })(); const approvedComponents = components.filter((item) => approvedRunIds.has(item.salaryRunId)); const metadata: Array<[string, string]> = [["Payroll Period", period.periodId], ["Report", args.exportType.replace(/_/g, " ")], ["Calculation Versions", salaryRuns.filter((run) => approvedRunIds.has(run.id)).map((run) => `${projects.find((p) => p.id === run.projectId)?.projectId ?? run.projectId}:V${run.version}`).join(", ")], ["Export Timestamp", new Date().toISOString()]];
        let headers: string[] = []; let rows: unknown[][] = []; let numeric: number[] = [];
        if (args.exportType === "master_salary") { const projectIds = [...new Set(approvedComponents.map((item) => item.projectId))]; headers = ["Serial Number", "Employee ID", "Previous Employee IDs", "Employee Name", "Joining Date", "Designation", "Contract Type", ...projectIds.map((id) => projects.find((p) => p.id === id)?.projectId ?? `Project ${id}`), "Production Salary", "Doctype Salary", "Proof Salary", "Other Components", "Bonuses", "Deductions", "Gross Salary", "Final Payable Salary"]; rows = masterRows.map((item, index) => { const employee = employees.find((e) => e.id === item.employeeId); let amounts: Record<string, string> = {}; try { amounts = JSON.parse(item.projectAmountsJson) as Record<string, string>; } catch { amounts = {}; } return [index + 1, employee?.employeeId ?? "", mappings.filter((m) => m.employeeId === item.employeeId).map((m) => m.previousEmployeeId).join(", "), employee?.name ?? "", employee?.joiningDate ?? "", employee?.designation ?? "", employee?.contractType ?? "", ...projectIds.map((id) => Number(amounts[String(id)] ?? 0)), Number(item.productionSalary), Number(item.doctypeSalary), Number(item.proofSalary), Number(item.otherComponents), Number(item.bonuses), Number(item.deductions), Number(item.grossSalary), Number(item.finalPayableSalary)]; }); numeric = Array.from({ length: headers.length - 7 }, (_, index) => index + 7); rows.push(["", "", "", "Grand Total", "", "", "", ...projectIds.map((id) => approvedComponents.filter((item) => item.projectId === id).reduce((sum, item) => sum.plus(item.finalAmount), new Decimal(0)).toNumber()), "", "", "", "", Number(master.bonusTotal), Number(master.deductionTotal), Number(master.grossTotal), Number(master.finalTotal)]); }
        else if (["project_salary", "employee_salary", "doctype_salary", "proof_salary"].includes(args.exportType)) { headers = ["Employee ID", "Employee Name", "Project", "Work Type", "Category", "Country", "Payable Quantity", "Unit", "Rate", "Multiplier", "Gross Amount", "Adjustment", "Final Amount", "Calculation Version"]; const source = approvedComponents.filter((item) => args.exportType === "doctype_salary" ? item.workType.toLowerCase().includes("doctype") : args.exportType === "proof_salary" ? item.workType.toLowerCase().includes("proof") : true); rows = source.map((item) => { const employee = employees.find((e) => e.id === item.employeeId); const run = salaryRuns.find((r) => r.id === item.salaryRunId); return [employee?.employeeId ?? "", employee?.name ?? "", projects.find((p) => p.id === item.projectId)?.projectId ?? "", item.workType, item.categoryName ?? item.categoryCode ?? "", item.country, Number(item.approvedPayableQuantity), item.quantityUnit, Number(item.appliedRate), Number(item.multiplier), Number(item.grossAmount), Number(item.approvedAdjustment), Number(item.finalAmount), run?.version ?? item.calculationVersion]; }); numeric = [6,8,9,10,11,12]; rows.push(["", "Grand Total", "", "", "", "", "", "", "", "", "", "", source.reduce((sum, item) => sum.plus(item.finalAmount), new Decimal(0)).toNumber(), ""]); }
        else if (args.exportType === "production_reconciliation") { headers = ["Project", "Batch", "Employee ID", "Work Type", "Category", "Unit", "Produced", "Transmitted", "Accepted", "Shipped", "Billable", "Authorized Payable", "Allocated", "Difference", "Status"]; rows = recon.filter((item) => approvedComponents.some((component) => component.reconciliationResultId === item.id)).map((item) => [projects.find((p) => p.id === item.projectId)?.projectId ?? "", item.batchKey, item.employeeIdentifier ?? "", item.workType, item.categoryName ?? item.categoryCode ?? "", item.quantityUnit, Number(item.entryQuantity), Number(item.transmittedQuantity), Number(item.acceptedQuantity), Number(item.shipdetQuantity), Number(item.billableQuantity), Number(item.authorizedPayableQuantity), Number(item.employeeAllocatedQuantity), Number(item.quantityDifference), item.exceptionStatus]); numeric = [6,7,8,9,10,11,12,13]; }
        else if (args.exportType === "transmitted_reconciliation") { headers = ["Project", "Internal Batch ID", "Client Batch ID", "Country", "Records", "Characters", "Images", "Transmitted Date", "Transmission Status", "Client Acceptance", "Work Type"]; rows = transmitted.filter((item) => item.active).map((item) => [projects.find((p) => p.id === item.projectId)?.projectId ?? "", item.internalBatchId ?? "", item.clientBatchId ?? "", item.country ?? "", Number(item.recordCount ?? 0), Number(item.characterCount ?? 0), Number(item.imageCount ?? 0), item.transmittedDate ?? "", item.transmissionStatus, item.clientAcceptanceStatus, item.workType ?? ""]); numeric = [4,5,6]; }
        else if (args.exportType === "shipdet_reconciliation") { headers = ["Project", "Internal Batch ID", "Client Batch ID", "Shipment Batch ID", "Shipment Date", "Records", "Characters", "Images", "Billable Quantity", "Acceptance", "Review Status"]; rows = shipdet.filter((item) => item.active).map((item) => [projects.find((p) => p.id === item.projectId)?.projectId ?? "", item.internalBatchId ?? "", item.clientBatchId ?? "", item.shipmentBatchId ?? "", item.shipmentDate ?? "", Number(item.recordCount ?? 0), Number(item.characterCount ?? 0), Number(item.imageCount ?? 0), Number(item.billableQuantity ?? 0), item.acceptanceStatus, item.reviewStatus]); numeric = [5,6,7,8]; }
        else if (args.exportType === "exception_report") { headers = ["Source", "Project", "Employee ID", "Type", "Severity", "Explanation", "Status"]; rows = [...reconExceptions.map((item) => ["Reconciliation", projects.find((p) => p.id === item.projectId)?.projectId ?? "", item.employeeIdentifier ?? "", item.exceptionType, item.severity, item.explanation, item.resolutionStatus]), ...salaryExceptions.map((item) => ["Salary", projects.find((p) => p.id === item.projectId)?.projectId ?? "", item.employeeId ? employees.find((e) => e.id === item.employeeId)?.employeeId ?? "" : "", item.exceptionType, "blocking", item.explanation, "open"]), ...masterExceptions.map((item) => ["Master Salary", item.projectId ? projects.find((p) => p.id === item.projectId)?.projectId ?? "" : "", item.employeeId ? employees.find((e) => e.id === item.employeeId)?.employeeId ?? "" : "", item.exceptionType, "blocking", item.explanation, "open"])]; }
        else { headers = ["Timestamp", "Actor", "Action", "Entity Type", "Entity ID", "Reason"]; rows = auditRows.filter((item) => item.createdAt >= period.createdAt).map((item) => [item.createdAt.toISOString(), users.find((user) => user.id === item.userId)?.name ?? "Unknown", item.action, item.entityType, item.entityId, item.reason ?? ""]); }
        const workbook = XLSX.utils.book_new(); const worksheet = makeReportSheet(metadata, headers, rows, numeric); XLSX.utils.book_append_sheet(workbook, worksheet, safeSheetName(args.exportType.replace(/_/g, " "))); const bytes = new Uint8Array(XLSX.write(workbook, { type: "array", bookType: "xlsx" }) as ArrayBuffer); const filename = `${period.periodId}-${args.exportType.replace(/_/g, "-")}-v${master.version}.xlsx`; const blobKey = `exports/${args.payrollPeriodId}/${jobCode}/${filename}`; await ctx.blobs.put(blobKey, bytes, { contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }); await db.update(schema.exportJobs).set({ status: "completed", progress: 100, filename, blobKey, rowCount: rows.length, completedAt: new Date() }).where(eq(schema.exportJobs.id, inserted.id)); await audit(ctx, actor.userId, "generate", "export_job", String(inserted.id), { jobCode, exportType: args.exportType, filename, rowCount: rows.length, masterRunId: master.id }); const downloadUrl = await ctx.blobs.getUrl(blobKey, { expiresInSeconds: 1800 }); ctx.invalidateQueries(); return { id: inserted.id, jobId: jobCode, status: "completed", filename, rowCount: rows.length, downloadUrl };
      } catch (error) { const text = error instanceof Error ? error.message : "Export generation failed."; await db.update(schema.exportJobs).set({ status: "failed", progress: 100, errorMessage: text, completedAt: new Date() }).where(eq(schema.exportJobs.id, inserted.id)); throw new Error(text); }
    },
  }),

  listExportJobs: defineAction({
    request: authRequest.extend({ payrollPeriodId: z.number().int().positive() }),
    response: z.object({ jobs: z.array(z.object({ id: z.number(), jobId: z.string(), exportType: z.string(), status: z.string(), progress: z.number(), filename: z.string().nullable(), rowCount: z.number(), errorMessage: z.string().nullable(), generatedBy: z.string(), createdAt: z.string(), completedAt: z.string().nullable(), downloadUrl: z.string().nullable() })) }),
    async handler(ctx, args) { await requireUser(ctx, args.token, "master.read"); const db = ctx.db<typeof schema>(); const [jobs, users] = await Promise.all([db.select().from(schema.exportJobs).where(eq(schema.exportJobs.payrollPeriodId, args.payrollPeriodId)).orderBy(desc(schema.exportJobs.id)), db.select().from(schema.users)]); const output = []; for (const job of jobs) output.push({ id: job.id, jobId: job.jobId, exportType: job.exportType, status: job.status, progress: job.progress, filename: job.filename, rowCount: job.rowCount, errorMessage: job.errorMessage, generatedBy: users.find((user) => user.id === job.generatedBy)?.name ?? "Unknown", createdAt: job.createdAt.toISOString(), completedAt: job.completedAt?.toISOString() ?? null, downloadUrl: job.status === "completed" && job.blobKey ? await ctx.blobs.getUrl(job.blobKey, { expiresInSeconds: 1800 }) : null }); return { jobs: output }; },
  }),

  listAuditLogs: defineAction({
    request: authRequest.extend({ limit: z.number().int().min(1).max(200).default(80) }),
    response: z.object({ logs: z.array(z.object({ id: z.number(), actor: z.string(), action: z.string(), entityType: z.string(), entityId: z.string(), reason: z.string().nullable(), createdAt: z.string() })) }),
    async handler(ctx, args) {
      await requireUser(ctx, args.token, "audit.read");
      const db = ctx.db<typeof schema>();
      const [logs, users] = await Promise.all([db.select().from(schema.auditLogs).orderBy(desc(schema.auditLogs.id)).limit(args.limit), db.select().from(schema.users)]);
      return { logs: logs.map((log) => ({ id: log.id, actor: users.find((u) => u.id === log.userId)?.name ?? "Unknown user", action: log.action, entityType: log.entityType, entityId: log.entityId, reason: log.reason, createdAt: log.createdAt.toISOString() })) };
    },
  }),
} satisfies ActionsModule;
