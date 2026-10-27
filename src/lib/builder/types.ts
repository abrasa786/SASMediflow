export const FIELD_TYPES = [
  "text", "long_text", "number", "currency", "date", "datetime",
  "boolean", "picklist", "email", "phone", "url", "lookup",
] as const;
export type FieldType = (typeof FIELD_TYPES)[number];

export interface FieldSpec {
  api_name: string;
  label?: string;
  data_type?: FieldType;
  required?: boolean;
  unique?: boolean;
  picklist_values?: string[];
  lookup_object?: string;
  help_text?: string;
}

import type { AgentStep } from "./agent-tools";

export type Step =
  | AgentStep
  | { tool: "create_object"; args: { api_name: string; label?: string; plural_label?: string; description?: string; icon?: string; fields?: FieldSpec[] } }
  | { tool: "add_field"; args: { object: string; field: FieldSpec } }
  | { tool: "hide_field"; args: { object: string; field: string } }
  | { tool: "create_app"; args: { api_name: string; label?: string; icon?: string; description?: string; objects?: string[] } }
  | { tool: "add_tab"; args: { app: string; kind?: "object" | "dashboard" | "report" | "page"; object?: string; label?: string } };

export interface Recommendation {
  object: string;
  reason: string;
  fields: FieldSpec[];
}

export interface Plan {
  summary: string;
  steps: Step[];
  recommendations?: Recommendation[];
}

export interface SchemaField {
  api_name: string;
  label: string;
  data_type: FieldType;
  required?: boolean;
  picklist_values?: string[] | null;
  lookup_object?: string | null;
  custom?: boolean;            // a field the clinic added to a built-in record (the base columns are not custom)
}
export interface SchemaObject {
  api_name: string;
  label: string;
  plural_label: string;
  icon?: string;
  is_system?: boolean;
  builtin?: boolean;           // patients, appointments, invoices, stock, tasks, doctors: fields go in custom_field_defs
  fields: SchemaField[];
}
export interface SchemaApp {
  api_name: string;
  label: string;
  icon?: string;
  tabs: { label: string; kind: string; object?: string | null }[];
}
export interface Schema {
  objects: SchemaObject[];
  apps: SchemaApp[];
}
