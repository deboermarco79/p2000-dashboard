"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { isDemo, supabase } from "@/lib/supabase";

export default function Login() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!supabase) return;
    setBusy(true);
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    setBusy(false);
    if (error) setError(error.message);
    else router.replace("/dashboard");
  }

  return (
    <main className="grid min-h-screen place-items-center p-6">
      <form onSubmit={submit} className="w-full max-w-sm space-y-4 rounded-2xl border border-slate-200 bg-white p-8">
        <div className="flex items-center gap-3">
          <div className="grid h-8 w-8 place-items-center rounded-lg bg-slate-900 text-sm font-black text-white">N</div>
          <h1 className="text-lg font-semibold tracking-tight">Command Center</h1>
        </div>
        {isDemo && (
          <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">
            Demo-modus: geen login nodig. <a href="/dashboard" className="underline">Naar dashboard</a>
          </p>
        )}
        <input
          type="email"
          required
          autoComplete="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="E-mailadres"
          className="w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm outline-none focus:border-slate-500"
        />
        <input
          type="password"
          required
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="Wachtwoord"
          className="w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm outline-none focus:border-slate-500"
        />
        {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
        <button
          disabled={busy || isDemo}
          className="w-full rounded-lg bg-slate-900 py-2.5 text-sm font-semibold text-white hover:bg-slate-700 disabled:opacity-50"
        >
          Inloggen
        </button>
      </form>
    </main>
  );
}
