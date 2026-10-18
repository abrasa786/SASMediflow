import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase";

export async function POST(req: NextRequest) {
  try {
    const { clinicId, email, role, name, specialty } = await req.json();

    if (!clinicId || !email || !role) {
      return NextResponse.json({ error: "clinicId, email, and role are required" }, { status: 400 });
    }

    const db = createAdminClient();

    // Create or get the user via admin auth
    let userId: string;

    // Check if user exists
    const { data: existingUser } = await (db as any).auth.admin.getUserByEmail(email);
    if (existingUser?.user) {
      userId = existingUser.user.id;
    } else {
      // Invite new user — they'll get a magic link
      const { data: inviteData, error: inviteErr } = await (db as any).auth.admin.inviteUserByEmail(email, {
        redirectTo: `${process.env.NEXT_PUBLIC_APP_URL}/login?invited=1`,
        data: { name, role },
      });
      if (inviteErr) throw inviteErr;
      userId = inviteData.user.id;
    }

    // Upsert into clinic_staff
    const staffPayload: Record<string, any> = {
      clinic_id: clinicId,
      user_id: userId,
      role,
      is_active: true,
    };

    const { error: staffErr } = await (db as any)
      .from("clinic_staff")
      .upsert(staffPayload, { onConflict: "clinic_id,user_id" });

    if (staffErr) throw staffErr;

    // If doctor, upsert into doctors table
    if (role === "doctor" && name) {
      const { error: docErr } = await (db as any)
        .from("doctors")
        .upsert(
          { clinic_id: clinicId, user_id: userId, name, specialty: specialty ?? "", is_active: true },
          { onConflict: "clinic_id,user_id" }
        );
      if (docErr) console.warn("Doctor upsert warning:", docErr.message);
    }

    return NextResponse.json({ success: true, userId });
  } catch (e: any) {
    console.error("Staff invite error:", e);
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
