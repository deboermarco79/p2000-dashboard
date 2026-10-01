// Mocked Chromecast fleet. Replace with real heartbeats (e.g. a `devices` table
// updated by the receiver) when moving beyond the prototype.
const DEVICES = [
  { name: "Newsroom — hoofdscherm", ip: "10.20.4.11", online: true },
  { name: "Perskamer", ip: "10.20.4.12", online: true },
  { name: "Receptie", ip: "10.20.4.13", online: true },
  { name: "Wachtruimte 1e verdieping", ip: "10.20.4.14", online: false },
];

export default function DeviceStatus() {
  const online = DEVICES.filter((d) => d.online).length;
  return (
    <section className="rounded-xl border border-slate-200 bg-white p-4">
      <div className="mb-3 flex items-baseline justify-between">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-slate-500">Systeemstatus</h2>
        <span className="text-xs text-slate-400">
          {online}/{DEVICES.length} online · mock
        </span>
      </div>
      <ul className="divide-y divide-slate-100">
        {DEVICES.map((d) => (
          <li key={d.ip} className="flex items-center gap-3 py-2.5">
            <span
              className={`h-2.5 w-2.5 shrink-0 rounded-full ${
                d.online ? "bg-emerald-500 shadow-[0_0_0_3px_rgba(16,185,129,0.2)]" : "bg-slate-300"
              }`}
            />
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-medium">{d.name}</div>
              <div className="text-xs text-slate-400">{d.ip}</div>
            </div>
            <span className={`text-xs font-medium ${d.online ? "text-emerald-600" : "text-slate-400"}`}>
              {d.online ? "Online" : "Offline"}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}
