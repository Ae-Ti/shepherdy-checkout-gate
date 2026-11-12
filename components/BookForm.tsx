"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function BookForm({ experienceId, defaultDate }: { experienceId: string; defaultDate: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError("");
    const form = new FormData(e.currentTarget);
    const res = await fetch("/api/bookings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        experienceId,
        guestName: form.get("guestName"),
        email: form.get("email"),
        date: form.get("date"),
      }),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok || !json.url) {
      setError("We could not save the booking. Please try again.");
      setBusy(false);
      return;
    }
    router.push(json.url);
  }

  return (
    <form className="form" onSubmit={onSubmit}>
      <label>
        Your name
        <input name="guestName" required maxLength={80} placeholder="Alex Kim" />
      </label>
      <label>
        Email for the receipt
        <input name="email" type="email" required maxLength={120} placeholder="alex@example.com" />
      </label>
      <label>
        Date
        <input name="date" type="date" required defaultValue={defaultDate} />
      </label>
      <button className="button" type="submit" disabled={busy}>
        {busy ? "Saving…" : "Continue to payment"}
      </button>
      {error && <p className="notice error">{error}</p>}
    </form>
  );
}
