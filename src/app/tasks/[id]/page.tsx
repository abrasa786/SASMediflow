"use client";

import RecordForm, { type Field } from "@/components/RecordForm";

const FIELDS: Field[] = [
  { key: "title", label: "Task", required: true, wide: true },
  { key: "status", label: "Status", type: "select", required: true, options: [["todo", "To do"], ["in_progress", "In progress"], ["done", "Done"]].map(([value, label]) => ({ value, label })) },
  { key: "priority", label: "Priority", type: "select", required: true, options: [["low", "Low"], ["medium", "Medium"], ["high", "High"]].map(([value, label]) => ({ value, label })) },
  { key: "assigned_to", label: "Assigned to" }, { key: "due_date", label: "Due date", type: "date" },
  { key: "description", label: "Details", type: "textarea" },
];

export default function TaskRecord({ params }: { params: { id: string } }) {
  return <RecordForm table="clinic_tasks" id={params.id} fields={FIELDS} backHref="/tasks" backLabel="Tasks" title={(r) => r.title} subtitle={(r) => `Created ${new Date(r.created_at).toLocaleDateString("en-IN")}`} />;
}
