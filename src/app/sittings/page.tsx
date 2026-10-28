"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import ListView from "@/components/ListView";
import Modal from "@/components/Modal";
import SittingForm from "@/components/SittingForm";
import { getActiveClinicId } from "@/lib/auth";

/** Opens the "new sitting" form when the page is reached with ?new=1 (the + New button in the top bar, or a link from a patient or a treatment). */
function NewSitting({ onAdded }: { onAdded: () => void }) {
  const router = useRouter();
  const sp = useSearchParams();
  const [clinicId, setClinicId] = useState("");
  useEffect(() => { setClinicId(getActiveClinicId() ?? ""); }, []);
  if (sp.get("new") !== "1" || !clinicId) return null;
  const close = () => router.replace("/sittings");
  return (
    <Modal title="New sitting" onClose={close} wide>
      <SittingForm clinicId={clinicId} patientId={sp.get("patient") ?? undefined} planId={sp.get("plan") ?? undefined} onCancel={close} onDone={() => { close(); onAdded(); }} />
    </Modal>
  );
}

export default function SittingsPage() {
  const [rk, setRk] = useState(0);        // a new sitting was added: reload the list
  return (
    <>
      <ListView entity="sittings" refreshKey={rk} />
      <Suspense fallback={null}><NewSitting onAdded={() => setRk((n) => n + 1)} /></Suspense>
    </>
  );
}
