import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase";

const GEMINI_API_URL = "https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent";

async function getClinicContext(clinicId: string): Promise<string> {
  const db = createAdminClient();
  const today = new Date().toISOString().split("T")[0];

  const [
    { data: clinic },
    { data: appointments },
    { data: patients },
    { data: invoices },
    { data: stock },
  ] = await Promise.all([
    (db as any).from("clinics").select("name, brand_name, specialty, city").eq("id", clinicId).single(),
    (db as any).from("appointments").select("appointment_date, appointment_time, status, consultation_fee, symptoms, clinic_patients(name, phone), doctors(name)").eq("clinic_id", clinicId).eq("appointment_date", today).order("appointment_time"),
    (db as any).from("clinic_patients").select("name, phone, blood_group, conditions").eq("clinic_id", clinicId).order("created_at", { ascending: false }).limit(20),
    (db as any).from("invoices").select("total, status, payment_method, created_at").eq("clinic_id", clinicId).gte("created_at", `${today}T00:00:00`),
    (db as any).from("stock_items").select("name, quantity, min_quantity, unit").eq("clinic_id", clinicId).lte("quantity", (db as any).raw("min_quantity")),
  ]);

  const totalToday = appointments?.reduce((s: number, a: any) => s + (a.consultation_fee || 0), 0) ?? 0;
  const paidToday = invoices?.filter((i: any) => i.status === "paid").reduce((s: number, i: any) => s + (i.total || 0), 0) ?? 0;
  const lowStock = stock?.filter((s: any) => s.quantity <= s.min_quantity) ?? [];

  return `
CLINIC: ${(clinic as any)?.brand_name || (clinic as any)?.name} (${(clinic as any)?.specialty}, ${(clinic as any)?.city})
DATE: ${today}

TODAY'S APPOINTMENTS (${appointments?.length ?? 0}):
${appointments?.map((a: any) => `- ${a.appointment_time}: ${a.clinic_patients?.name ?? "Unknown"} with ${a.doctors?.name ?? "duty doctor"} [${a.status}] ₹${a.consultation_fee} — ${a.symptoms || "check-up"}`).join("\n") || "None"}

STATUS SUMMARY:
- Confirmed: ${appointments?.filter((a: any) => a.status === "confirmed").length ?? 0}
- Completed: ${appointments?.filter((a: any) => a.status === "completed").length ?? 0}
- Cancelled: ${appointments?.filter((a: any) => a.status === "cancelled").length ?? 0}
- No-show: ${appointments?.filter((a: any) => a.status === "no_show").length ?? 0}

REVENUE TODAY: ₹${paidToday} collected / ₹${totalToday} total billed

RECENT PATIENTS (${patients?.length ?? 0} shown):
${patients?.slice(0, 10).map((p: any) => `- ${p.name} ${p.phone ? `(${p.phone})` : ""} ${p.conditions ? `| ${p.conditions}` : ""}`).join("\n") || "None"}

LOW STOCK ALERTS (${lowStock.length}):
${lowStock.map((s: any) => `- ${s.name}: ${s.quantity} ${s.unit} (min: ${s.min_quantity})`).join("\n") || "All items adequately stocked"}
`.trim();
}

export async function POST(req: NextRequest) {
  try {
    const { clinicId, message, history = [] } = await req.json();
    if (!clinicId || !message) {
      return NextResponse.json({ error: "clinicId and message required" }, { status: 400 });
    }

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      return NextResponse.json({ error: "Gemini API key not configured" }, { status: 500 });
    }

    const clinicContext = await getClinicContext(clinicId);

    const systemPrompt = `You are a smart clinic management AI assistant. You have real-time access to this clinic's data:

${clinicContext}

INSTRUCTIONS:
- Answer questions about appointments, patients, billing, and stock using the data above
- Be concise, professional, and helpful
- Format numbers with ₹ for currency and commas for Indian number format
- If asked about something not in the data, say so clearly
- Keep responses under 200 words unless a detailed breakdown is needed
- Use bullet points for lists
- You can suggest actions like "check the stock page" or "view appointments"`;

    const contents = [
      ...history.slice(-8).map((m: any) => ({
        role: m.role === "assistant" ? "model" : "user",
        parts: [{ text: m.content }],
      })),
      { role: "user", parts: [{ text: message }] },
    ];

    const response = await fetch(`${GEMINI_API_URL}?key=${apiKey}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: systemPrompt }] },
        contents,
        generationConfig: {
          temperature: 0.3,
          maxOutputTokens: 512,
          topP: 0.8,
        },
      }),
    });

    if (!response.ok) {
      const errData = await response.json();
      throw new Error(errData.error?.message ?? "Gemini API error");
    }

    const data = await response.json();
    const reply = data.candidates?.[0]?.content?.parts?.[0]?.text ?? "Sorry, I couldn't generate a response.";

    return NextResponse.json({ reply });
  } catch (e: any) {
    console.error("Chatbot error:", e);
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
