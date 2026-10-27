/** Show a short message at the top of the screen: toast("Appointment created successfully"). Works from any page or component. */
export function toast(text: string, ok = true) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent("mf:toast", { detail: { text, ok } }));
}
