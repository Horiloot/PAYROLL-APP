# Data Plan

## Core sources

This artifact is populated only by authorized user entry and uploaded payroll source files. It does not retrieve production data from external websites or connected accounts.

Supported Stage 3 production sources:

- Record Details, including Review Key and Full Key variants
- Doctype
- Proof
- Transmitted Batch List
- Shipdet

Each committed production row retains the source file ID, source row number, import batch ID, payroll period, project, original source payload, normalized fields, and active/reversed state.

## Normalization and identity

- Stage 2 column mappings produce canonical fields. Unmapped columns remain in the original payload.
- Dynamic category columns are stored as normalized child rows, with their source column names preserved.
- Employee attribution uses exact Employee ID first, then approved historical Employee ID mappings. Name similarity is never used to merge employees.
- Unknown employee identifiers create actionable production exceptions.
- Proof entry employee and proof performer are stored separately and resolved independently.

## Project-controlled rules

Per-project production configuration stores:

- Doctype enablement
- Proof enablement
- Approved Proof types
- Whether Review Key and Full Key variants may both remain payable
- Explicit source-status mappings for transmission and acceptance states

Blank or unmapped transmission values normalize to `unknown`; they are never assumed transmitted. Produced, transmitted, accepted, shipped, billable, and approved-for-salary remain distinct fields.

## Integrity and lifecycle

- Production rows are initially inactive while a chunked import is being committed and become active only when the full import completes.
- Reprocessing keeps the prior source active until the replacement commits.
- Reverse operations deactivate both normalized import rows and their linked production rows while preserving traceability.
- Approved, locked, and exported payroll periods reject new imports and production changes.
- Shipdet rows require explicit inspection confirmation before later reconciliation stages may treat them as reviewed.

## Outputs

Stage 3 provides server-filtered and paginated production views, source-row drill-down, exception views, and formula-injection-safe CSV exports. Salary, reconciliation, approval, and Excel workbooks remain later-stage workflows and do not infer payable quantities from production rows.
