/** Which records can be deleted, by whom, and where to go afterwards. Used by the delete API and by the dustbin button. */
export type DelRole = "admin" | "doctor" | "intern" | "nurse" | "receptionist";
export const DELETABLE: Record<string, { label: string; roles: DelRole[] }> = {
  appointments: { label: "appointment", roles: ["admin", "doctor", "receptionist"] },
  clinic_patients: { label: "patient", roles: ["admin"] },
  invoices: { label: "bill", roles: ["admin"] },
  treatment_templates: { label: "treatment", roles: ["admin"] },
  stock_items: { label: "stock item", roles: ["admin", "nurse"] },
  clinic_tasks: { label: "task", roles: ["admin", "doctor", "nurse", "receptionist", "intern"] },
};
