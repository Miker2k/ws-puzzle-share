// Supabase Edge Function: admin-api
// Handles all coordinator dashboard API calls.
// The service role key never leaves Supabase infrastructure.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, x-admin-password',
};

Deno.serve(async (req: Request) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: CORS_HEADERS });
  }

  const url    = new URL(req.url);
  // Supabase invokes functions at /functions/v1/admin-api/...
  // Strip everything up to and including the function name
  const path   = url.pathname.replace(/^.*\/admin-api/, '') || '/';
  const method = req.method;

  // GET /health — no auth required
  if (path === '/health' || path === '' || path === '/') {
    return json({ ok: true, path });
  }

  // ----------------------------------------------------------------
  // AUTH CHECK — password sent as x-admin-password header
  // ----------------------------------------------------------------
  const ADMIN_PASSWORD = Deno.env.get('ADMIN_PASSWORD');

  if (path !== '/auth') {
    const pw = req.headers.get('x-admin-password');
    if (!pw || pw !== ADMIN_PASSWORD) {
      return json({ error: 'Unauthorized' }, 401);
    }
  }

  // ----------------------------------------------------------------
  // Supabase client using service role key (built-in Supabase secret)
  // ----------------------------------------------------------------
  const supabaseUrl  = Deno.env.get('SUPABASE_URL')!;
  const serviceKey   = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const db = createClient(supabaseUrl, serviceKey);

  // ----------------------------------------------------------------
  // ROUTES
  // ----------------------------------------------------------------

  // POST /auth — validate password
  if (path === '/auth' && method === 'POST') {
    const body = await req.json().catch(() => ({}));
    if (body.password === ADMIN_PASSWORD) {
      return json({ ok: true });
    }
    return json({ error: 'Incorrect password' }, 401);
  }

  // GET /submissions — all submissions, deduplicated to latest per member
  if (path === '/submissions' && method === 'GET') {
    const { data, error } = await db
      .from('submissions')
      .select('*')
      .order('submitted_at', { ascending: false });

    if (error) return json({ error: error.message }, 500);

    // Deduplicate: keep only latest per member_name
    const seen: Record<string, boolean> = {};
    const deduped = (data || []).filter(r => {
      if (!seen[r.member_name]) { seen[r.member_name] = true; return true; }
      return false;
    });

    return json(deduped);
  }

  // DELETE /submissions/:id — delete single submission
  if (path.startsWith('/submissions/') && method === 'DELETE') {
    const id = path.replace('/submissions/', '');
    console.log('DELETE submission id:', id);
    const { error } = await db.from('submissions').delete().eq('id', id);
    if (error) return json({ error: error.message }, 500);
    return json({ ok: true });
  }

  // DELETE /submissions — delete all submissions
  if (path === '/submissions' && method === 'DELETE') {
    console.log('DELETE all submissions');
    const { error } = await db
      .from('submissions')
      .delete()
      .neq('id', '00000000-0000-0000-0000-000000000000');
    if (error) return json({ error: error.message }, 500);
    return json({ ok: true });
  }

  return json({ error: 'Not found' }, 404);
});

// ----------------------------------------------------------------
// HELPER
// ----------------------------------------------------------------
function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
  });
}
