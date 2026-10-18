import { supabase } from "./supabase";

export async function signInWithEmail(email: string, password: string) {
  return supabase.auth.signInWithPassword({ email, password });
}

export async function signOut() {
  return supabase.auth.signOut();
}

export async function getSession() {
  const { data } = await supabase.auth.getSession();
  return data.session;
}

export async function getUser() {
  const { data } = await supabase.auth.getUser();
  return data.user;
}

/** Active clinic stored in localStorage */
export function getActiveClinicId(): string | null {
  if (typeof window === "undefined") return null;
  return localStorage.getItem("mf_active_clinic");
}

export function setActiveClinicId(id: string) {
  localStorage.setItem("mf_active_clinic", id);
}

export function clearActiveClinicId() {
  localStorage.removeItem("mf_active_clinic");
}
