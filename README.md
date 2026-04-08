# WS Fragment Tracker

Alliance fragment inventory tracker for Whiteout Survival.

## Repo Structure

```
ws-puzzle-share/
├── static/
│   ├── index.html        # Member inventory app (served by Render)
│   └── admin.html        # Coordinator dashboard (served by Render)
└── supabase/
    └── functions/
        └── admin-api/
            └── index.ts  # Edge Function — runs inside Supabase
```

## How It Works

- Members open `index.html`, enter their inventory, and tap **Submit to Alliance**
- Submissions are stored in Supabase using the **anon key** (safe to be public)
- The coordinator opens `admin.html`, logs in with a password
- The admin page calls the **Edge Function**, which runs inside Supabase and uses the **service role key** server-side — the key never reaches the browser

---

## One-Time Setup on Windows

### 1. Install Scoop (Windows package manager)

Open **PowerShell as Administrator** and run:

```powershell
Set-ExecutionPolicy -ExecutionPolicy RemoteSigned -Scope CurrentUser
Invoke-RestMethod -Uri https://get.scoop.sh | Invoke-Expression
```

### 2. Install Supabase CLI

```powershell
scoop bucket add supabase https://github.com/supabase/scoop-bucket.git
scoop install supabase
```

Verify:
```powershell
supabase --version
```

### 3. Log in to Supabase

```powershell
supabase login
```

This opens a browser tab. Approve the login and return to PowerShell.

### 4. Set the ADMIN_PASSWORD secret

Replace `YourPasswordHere` with something strong:

```powershell
supabase secrets set ADMIN_PASSWORD=YourPasswordHere --project-ref aevurncobtrfutcfufut
```

### 5. Deploy the Edge Function

From the **root of the repo**:

```powershell
supabase functions deploy admin-api --project-ref aevurncobtrfutcfufut
```

You should see output ending in `Deployed Function admin-api`.

### 6. Verify

Open this in your browser — should return `{"ok":true}`:
```
https://aevurncobtrfutcfufut.supabase.co/functions/v1/admin-api/health
```

---

## Render Static Site Setup

In the Render dashboard for `ws-puzzle-share`:
- **Root Directory:** `static`
- **Publish Directory:** `static`
- No build command needed

Push to GitHub and Render auto-deploys.

---

## URLs

| Page | URL |
|---|---|
| Member app | `https://ws-puzzle-share.onrender.com` |
| Admin dashboard | `https://ws-puzzle-share.onrender.com/admin.html` |
| Edge Function health | `https://aevurncobtrfutcfufut.supabase.co/functions/v1/admin-api/health` |

---

## Redeploying After Changes

Whenever you update the Edge Function:

```powershell
supabase functions deploy admin-api --project-ref aevurncobtrfutcfufut
```

Static site changes deploy automatically on GitHub push.

---

## Supabase Table Setup (if starting fresh)

Run in the Supabase SQL Editor:

```sql
create table submissions (
  id uuid default gen_random_uuid() primary key,
  member_name text not null,
  submitted_at timestamptz default now(),
  inventory jsonb not null
);

alter table submissions enable row level security;

create policy "Allow public insert"
  on submissions for insert to anon
  with check (true);

create policy "Service role reads all"
  on submissions for select to service_role
  using (true);
```
