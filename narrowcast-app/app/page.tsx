import Link from "next/link";

export default function Home() {
  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center gap-3 p-6">
      <h1 className="text-2xl font-semibold tracking-tight">Narrowcast</h1>
      <Link href="/dashboard" className="rounded-lg border bg-white px-4 py-3 hover:bg-slate-100">
        Command Center →
      </Link>
      <Link href="/receiver" className="rounded-lg border bg-white px-4 py-3 hover:bg-slate-100">
        Receiver (Chromecast) →
      </Link>
    </main>
  );
}
