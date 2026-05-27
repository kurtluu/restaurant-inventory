# Restaurant Inventory

Inventory tracking + low-stock alerts for a restaurant. Owner gets a dashboard, servers get a fast mobile-friendly view to log usage and flag items as low.

**Stack:** Next.js 14 (App Router) · Supabase (Postgres + Auth + Realtime) · Tailwind · Twilio (Phase 2)

---

## Phase 1 (this build) — what works now

- Owner & server logins (separate roles)
- Categorized inventory with search & filter
- Servers can log usage (-1, -2, -5, -10) or flag items as low
- Owner dashboard: stat cards, full inventory table, add/edit/delete items, threshold per item
- **Real-time updates** — when a server logs usage, the owner's dashboard updates instantly
- Auto-alert when an item drops below its threshold (DB trigger creates the alert row)
- Manual "alert owner" button for servers
- Alerts tab with acknowledgment
- **SMS is mocked** for now — alerts appear in the Alerts tab. See Phase 2 for wiring up Twilio.

## Phase 2 (next) — production polish

- Wire Twilio for real SMS (Supabase Edge Function watching `alerts` inserts)
- Stock-level history charts
- CSV bulk import
- Weekly summary text to owner

---

## Setup

### 1. Create a Supabase project

1. Go to [supabase.com](https://supabase.com) → New project
2. Save your **Project URL** and **anon public key** from Settings → API
3. Open the SQL Editor → paste `supabase/schema.sql` → Run
4. Settings → Authentication → URL Configuration: add `http://localhost:3000` to Site URL for now

### 2. Configure the app

```bash
cp .env.example .env.local
```

Fill in `.env.local`:

```
NEXT_PUBLIC_SUPABASE_URL=https://<your-project>.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=<your-anon-key>
```

### 3. Install + run

```bash
npm install
npm run dev
```

Open http://localhost:3000 → click "Sign up" → create one **Owner** account first, then **Server** accounts.

> First account should be Owner so you can manage items. Server accounts only see the inventory list view.

### 4. Disable email confirmation (for testing)

Supabase → Authentication → Providers → Email → turn **off** "Confirm email" while you're testing. Re-enable for production.

---

## Deploy to Vercel

1. Push this repo to GitHub
2. [vercel.com](https://vercel.com) → New Project → import repo
3. Add the same two env vars in Vercel project settings
4. Deploy
5. Back in Supabase → Authentication → URL Configuration → add your Vercel URL to Site URL & Redirect URLs

---

## How it works

```
servers               owner
  │                     │
  ▼                     ▼
/server  ◀── realtime ──▶  /owner
  │                     ▲
  │ updates items       │ sees updates instantly
  │ inserts alerts ─────┘
  ▼
  Supabase Postgres
    ├─ items (RLS: anyone auth reads + updates)
    ├─ alerts (RLS: anyone auth inserts)
    └─ trigger: items.quantity ↓ below threshold → INSERT alert
```

The DB trigger means alerts fire reliably even if the front-end logic has a bug. The owner's dashboard subscribes to `postgres_changes` so new alerts and quantity changes show up live without refreshing.

---

## Phase 2: wiring up Twilio

When you're ready for real SMS (cost: ~$1/mo for the number + ~$0.008/text):

1. Sign up at twilio.com → get a phone number ($1/mo)
2. In Supabase → Edge Functions → create a new function that fires on `alerts` insert
3. Function calls Twilio's REST API with the owner's phone (from `profiles.phone`) and the alert message

I left the `sms_status` and `sms_sent` columns and the env-var placeholders ready for that. Just say the word when you're ready and I'll write the Edge Function.

---

## Roles & permissions

Enforced by Postgres RLS, not just the UI:

| Action | Server | Owner |
|---|---|---|
| Read items | ✅ | ✅ |
| Update item quantity | ✅ | ✅ |
| Add/delete items | ❌ | ✅ |
| Manage categories | ❌ | ✅ |
| Insert alerts | ✅ | ✅ |
| Acknowledge alerts | ❌ | ✅ |

A server can't sneak in extra privileges from the browser console — RLS blocks it at the database.
