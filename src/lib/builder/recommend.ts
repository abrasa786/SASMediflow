import type { FieldSpec } from "./types";

const f = (api_name: string, data_type: FieldSpec["data_type"] = "text", extra: Partial<FieldSpec> = {}): FieldSpec =>
  ({ api_name, data_type, ...extra });

/**
 * Recommended fields for common hospital / clinic objects.
 * Keys are matched against the object name (substring, in order).
 * `lookup_object` fields are only kept when that object exists.
 */
const LIBRARY: { match: string[]; reason: string; fields: FieldSpec[] }[] = [
  { match: ["lab_order", "lab_request", "investigation"], reason: "Typical lab order tracking",
    fields: [f("ordered_on", "date", { required: true }), f("test", "lookup", { lookup_object: "lab_test" }),
      f("status", "picklist", { picklist_values: ["Ordered", "Sample collected", "In progress", "Completed", "Cancelled"] }),
      f("urgent", "boolean"), f("result_summary", "long_text"), f("reported_on", "date")] },
  { match: ["lab_test", "test_catalog"], reason: "Lab test catalogue",
    fields: [f("code"), f("category", "picklist", { picklist_values: ["Blood", "Urine", "Imaging", "Pathology", "Other"] }),
      f("price", "currency"), f("turnaround_hours", "number"), f("fasting_required", "boolean")] },
  { match: ["ward"], reason: "Ward master data",
    fields: [f("floor", "number"), f("ward_type", "picklist", { picklist_values: ["General", "Semi-private", "Private", "ICU", "NICU", "Isolation"] }),
      f("total_beds", "number"), f("nurse_in_charge"), f("daily_rate", "currency")] },
  { match: ["bed"], reason: "Bed management",
    fields: [f("ward", "lookup", { lookup_object: "ward" }), f("bed_number", "text", { required: true }),
      f("status", "picklist", { picklist_values: ["Available", "Occupied", "Cleaning", "Maintenance"] }), f("daily_rate", "currency")] },
  { match: ["admission", "inpatient", "ipd"], reason: "Inpatient admission tracking",
    fields: [f("patient_name", "text", { required: true }), f("phone", "phone"), f("admitted_on", "datetime", { required: true }),
      f("bed", "lookup", { lookup_object: "bed" }), f("diagnosis", "long_text"), f("attending_doctor"),
      f("status", "picklist", { picklist_values: ["Admitted", "Under observation", "Discharged", "Transferred"] }),
      f("discharged_on", "datetime"), f("insurance_provider")] },
  { match: ["prescription", "rx"], reason: "Prescription records",
    fields: [f("patient_name", "text", { required: true }), f("prescribed_on", "date", { required: true }), f("doctor"),
      f("medicines", "long_text"), f("dosage_instructions", "long_text"), f("follow_up_on", "date")] },
  { match: ["medicine", "medication", "drug", "pharmacy"], reason: "Pharmacy item master",
    fields: [f("generic_name"), f("category", "picklist", { picklist_values: ["Tablet", "Syrup", "Injection", "Ointment", "Other"] }),
      f("strength"), f("unit_price", "currency"), f("stock_quantity", "number"), f("reorder_level", "number"), f("expiry_date", "date")] },
  { match: ["claim", "insurance", "tpa"], reason: "Insurance claim workflow",
    fields: [f("patient_name", "text", { required: true }), f("insurer"), f("policy_number"), f("claim_amount", "currency"),
      f("approved_amount", "currency"), f("submitted_on", "date"),
      f("status", "picklist", { picklist_values: ["Draft", "Submitted", "Query raised", "Approved", "Rejected", "Settled"] })] },
  { match: ["referral"], reason: "Patient referrals",
    fields: [f("patient_name", "text", { required: true }), f("phone", "phone"), f("referred_by"), f("referred_to"),
      f("reason", "long_text"), f("referred_on", "date"), f("status", "picklist", { picklist_values: ["New", "Accepted", "Completed", "Declined"] })] },
  { match: ["surgery", "operation", "ot_"], reason: "Surgery scheduling",
    fields: [f("patient_name", "text", { required: true }), f("procedure_name"), f("surgeon"), f("scheduled_at", "datetime", { required: true }),
      f("theatre"), f("anaesthesia_type", "picklist", { picklist_values: ["General", "Spinal", "Local", "Sedation"] }),
      f("status", "picklist", { picklist_values: ["Planned", "Pre-op", "In theatre", "Completed", "Postponed"] })] },
  { match: ["vaccin", "immuni"], reason: "Vaccination register",
    fields: [f("patient_name", "text", { required: true }), f("phone", "phone"), f("vaccine"), f("dose_number", "number"),
      f("given_on", "date"), f("next_due", "date"), f("batch_number")] },
  { match: ["equipment", "asset"], reason: "Equipment and asset register",
    fields: [f("asset_tag", "text", { unique: true }), f("category"), f("location"), f("purchased_on", "date"),
      f("warranty_until", "date"), f("status", "picklist", { picklist_values: ["In use", "Under repair", "Retired"] })] },
  { match: ["maintenance", "service_request"], reason: "Maintenance requests",
    fields: [f("title", "text", { required: true }), f("location"), f("priority", "picklist", { picklist_values: ["Low", "Medium", "High", "Urgent"] }),
      f("reported_on", "date"), f("assigned_to"), f("status", "picklist", { picklist_values: ["Open", "In progress", "Resolved"] })] },
  { match: ["vendor", "supplier"], reason: "Vendor directory",
    fields: [f("contact_person"), f("phone", "phone"), f("email", "email"), f("gst_number"), f("payment_terms")] },
  { match: ["leave", "time_off"], reason: "Staff leave requests",
    fields: [f("staff_name", "text", { required: true }), f("leave_type", "picklist", { picklist_values: ["Casual", "Sick", "Earned", "Unpaid"] }),
      f("from_date", "date", { required: true }), f("to_date", "date", { required: true }), f("reason", "long_text"),
      f("status", "picklist", { picklist_values: ["Pending", "Approved", "Rejected"] })] },
  { match: ["shift", "roster"], reason: "Staff roster",
    fields: [f("staff_name", "text", { required: true }), f("shift_date", "date", { required: true }),
      f("shift", "picklist", { picklist_values: ["Morning", "Evening", "Night"] }), f("department")] },
  { match: ["feedback", "complaint"], reason: "Patient feedback",
    fields: [f("patient_name"), f("phone", "phone"), f("rating", "number"), f("comments", "long_text"),
      f("status", "picklist", { picklist_values: ["New", "Under review", "Resolved"] })] },
  { match: ["ambulance"], reason: "Ambulance dispatch",
    fields: [f("vehicle_number"), f("driver"), f("pickup_location"), f("destination"), f("dispatched_at", "datetime"),
      f("status", "picklist", { picklist_values: ["Available", "Dispatched", "On trip", "Maintenance"] })] },
  { match: ["visitor"], reason: "Visitor log",
    fields: [f("visitor_phone", "phone"), f("patient_name"), f("purpose"), f("checked_in_at", "datetime"), f("checked_out_at", "datetime")] },
];

const GENERIC: FieldSpec[] = [
  f("status", "picklist", { picklist_values: ["New", "In progress", "Completed"] }),
  f("date", "date"),
  f("notes", "long_text"),
];

/** Recommended fields for an object, excluding names already present and lookups whose target is missing. */
export function recommendFields(
  objectApiName: string,
  existingFieldNames: string[] = [],
  existingObjects: string[] = [],
): { fields: FieldSpec[]; reason: string } {
  const key = objectApiName.toLowerCase();
  const hit = LIBRARY.find((e) => e.match.some((m) => key.includes(m)));
  const base = hit ? hit.fields : GENERIC;
  const have = new Set(existingFieldNames);
  const fields = base.filter((x) => !have.has(x.api_name) && (x.data_type !== "lookup" || existingObjects.includes(x.lookup_object || "")));
  return { fields, reason: hit ? hit.reason : "Common starter fields" };
}
