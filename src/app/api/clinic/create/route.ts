import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase";

export async function POST(req: NextRequest) {
  try {
    const { clinicName, brandName, specialty, city, adminName, email, password } = await req.json();

    if (!clinicName || !specialty || !adminName || !email || !password) {
      return NextResponse.json({ error: "Missing required fields." }, { status: 400 });
    }

    const supabase = createAdminClient() as any;

    // 1. Create the auth user
    const { data: authData, error: authError } = await supabase.auth.admin.createUser({
      email,
      password,
      email_confirm: false, // sends confirmation email
      user_metadata: { name: adminName },
    });

    if (authError) {
      return NextResponse.json({ error: authError.message }, { status: 400 });
    }

    const userId = authData.user.id;

    // 2. Create the clinic
    const { data: clinic, error: clinicError } = await supabase
      .from("clinics")
      .insert({
        name: clinicName,
        brand_name: brandName || clinicName,
        specialty,
        city: city || null,
        is_active: true,
      })
      .select()
      .single();

    if (clinicError) {
      // Rollback: delete the user we just created
      await supabase.auth.admin.deleteUser(userId);
      return NextResponse.json({ error: clinicError.message }, { status: 500 });
    }

    // 3. Add the admin to clinic_staff
    const { error: staffError } = await supabase
      .from("clinic_staff")
      .insert({
        clinic_id: clinic.id,
        user_id: userId,
        role: "admin",
        name: adminName,
        is_active: true,
      });

    if (staffError) {
      return NextResponse.json({ error: staffError.message }, { status: 500 });
    }

    return NextResponse.json({ success: true, clinicId: clinic.id });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || "Internal server error" }, { status: 500 });
  }
}
