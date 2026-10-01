# Narrowcast — Command Center + Chromecast Receiver

Lightweight digital signage for a communications team (e.g. a police newsroom).

- **`/receiver`** — 16:9 / 1080p full-screen player, runs as a Google Cast Custom Web Receiver. Loops the active playlist, preloads the next slide, and is instantly overridden by a pulsating red alert overlay.
- **`/dashboard`** — Command Center: mocked device status, the red "acute alarm" button (login required), and playlist management.
- **Stack:** Next.js 14 (App Router), TypeScript, Tailwind CSS, Supabase (Postgres + Realtime).

> This app lives in the `narrowcast-app/` subfolder of the repo, next to the existing static P2000 dashboard. Run all commands below from inside `narrowcast-app/`.

## 1. Supabase setup

1. Create a project at [supabase.com](https://supabase.com).
2. Open **SQL Editor**, paste the contents of [`database.sql`](./database.sql) and run it. This creates the `playlist` and `alerts` tables, enforces *one active alert at a time*, enables Realtime on both tables, and seeds a demo playlist.
3. In **Project Settings → API**, copy the *Project URL* and the *anon public* key.
4. In **Authentication → Users**, add a user (email + password) for each team member. Disable public sign-ups under **Authentication → Providers → Email** so nobody else can register.

## 2. Environment variables

```bash
cp .env.example .env.local
```

```env
NEXT_PUBLIC_SUPABASE_URL=https://your-project-ref.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-public-key
```

Without the Supabase variables the app runs in **demo mode**: the receiver plays a built-in playlist and the dashboard is read-only and needs no login. Preview the alert overlay with `/receiver?alert=SGBO%20UPDATE:%20PERSALARM`.

## 3. Run locally

```bash
npm install
npm run dev
```

- Dashboard: <http://localhost:3000/dashboard>
- Receiver: <http://localhost:3000/receiver> (open in a second window and press the red button)

## 4. Deploy to Vercel (CLI)

The repo root hosts a different (static) site, so deploy this app from its own folder:

```bash
npm i -g vercel
cd narrowcast-app
vercel login
vercel link                      # create a NEW project; do not link the existing P2000 project
vercel env add NEXT_PUBLIC_SUPABASE_URL production
vercel env add NEXT_PUBLIC_SUPABASE_ANON_KEY production
vercel --prod
```

If you deploy through Git instead, set **Root Directory** to `narrowcast-app` in the Vercel project settings.

## 5. Register the Google Cast receiver

1. Go to the [Google Cast SDK Developer Console](https://cast.google.com/publish) (one-time $5 registration).
2. **Add new application → Custom Receiver**, set the URL to `https://<your-app>.vercel.app/receiver`.
3. Add your Chromecast serial numbers under *Add new device* and wait ~15 minutes for them to activate (reboot the device).
4. Cast to it from any Cast *sender* using the application ID you receive. The receiver script loads itself only on real Cast devices (user agent `CrKey`) and disables the idle timeout so the screen never sleeps.

## How it works

| Concern | Approach |
| --- | --- |
| Zero-downtime transitions | The current **and next** slide are always mounted; the next one is hidden (`opacity: 0`) but already loading/decoding, then cross-faded in. |
| Loop timing | One timer per slide based on `duration_seconds`; paused while an alert is shown. Playlist edits keep the current slide playing. |
| Instant alerts | Realtime `postgres_changes` payload is applied directly (no refetch). A 15 s poll and a resync on reconnect are the safety net. |
| One active alert | Unique partial index + trigger: activating a new alert automatically deactivates the previous one. |

## Before production

- Access control is Supabase Auth + RLS: the receiver (anon key) can only read; inserts/updates/deletes require a logged-in user. The redirect to `/login` is a UI convenience, the real protection is the RLS policies. Keep public sign-ups disabled.
- Device status is mocked (`components/DeviceStatus.tsx`). A real version needs a heartbeat from the receiver into a `devices` table.
