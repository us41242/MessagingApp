"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

export function StartConversationButton({
  otherProfileId,
}: {
  otherProfileId: string;
}) {
  const [busy, setBusy] = useState(false);
  const router = useRouter();

  async function go() {
    setBusy(true);
    const supabase = createClient();
    const { data, error } = await supabase.rpc("get_or_create_dm", {
      other_profile_id: otherProfileId,
    });
    setBusy(false);
    if (error) {
      alert(error.message);
      return;
    }
    if (typeof data === "string") {
      router.push(`/c/${data}`);
      router.refresh();
    }
  }

  return (
    <button
      type="button"
      onClick={go}
      disabled={busy}
      className="rounded-md bg-zinc-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-zinc-800 disabled:opacity-60 dark:bg-white dark:text-zinc-900 dark:hover:bg-zinc-200"
    >
      {busy ? "…" : "Message"}
    </button>
  );
}
