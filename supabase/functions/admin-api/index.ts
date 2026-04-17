// Supabase Edge Function: admin-api
// Handles all coordinator dashboard API calls.
// The service role key never leaves Supabase infrastructure.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PATCH, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, x-user-token',
};

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: CORS_HEADERS });
  }

  const url    = new URL(req.url);
  const path   = url.pathname.replace(/^.*\/admin-api/, '') || '/';
  const method = req.method;

  // GET /health — no auth required
  if (path === '/health' || path === '' || path === '/') {
    return json({ ok: true });
  }

  // ----------------------------------------------------------------
  // Supabase clients
  // ----------------------------------------------------------------
  const supabaseUrl  = Deno.env.get('SUPABASE_URL')!;
  const serviceKey   = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const db = createClient(supabaseUrl, serviceKey);

  // ----------------------------------------------------------------
  // AUTH — verify user token and check admin_users table
  // ----------------------------------------------------------------
  const userToken = req.headers.get('x-user-token');

  // GET /check-admin — verify if user has coordinator access
  if (path === '/check-admin' && method === 'GET') {
    if (!userToken) return json({ error: 'No token' }, 401);
    const userClient = createClient(supabaseUrl, Deno.env.get('SUPABASE_ANON_KEY')!, {
      global: { headers: { Authorization: 'Bearer ' + userToken } }
    });
    const { data: { user }, error } = await userClient.auth.getUser();
    if (error || !user) return json({ error: 'Invalid token' }, 401);
    const { data: adminRow } = await db.from('admin_users').select('user_id').eq('user_id', user.id).single();
    if (!adminRow) return json({ error: 'Not an admin' }, 403);
    return json({ ok: true, user_id: user.id });
  }

  // All other routes require valid admin token
  if (!userToken) return json({ error: 'Unauthorized' }, 401);

  const userClient = createClient(supabaseUrl, Deno.env.get('SUPABASE_ANON_KEY')!, {
    global: { headers: { Authorization: 'Bearer ' + userToken } }
  });
  const { data: { user } } = await userClient.auth.getUser();
  if (!user) return json({ error: 'Invalid token' }, 401);
  const { data: adminRow } = await db.from('admin_users').select('user_id').eq('user_id', user.id).single();
  if (!adminRow) return json({ error: 'Forbidden' }, 403);

  // ----------------------------------------------------------------
  // ROUTES
  // ----------------------------------------------------------------

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

  // PATCH /submissions/:id — update editable fields (alliance, state_number, member_name)
  if (path.startsWith('/submissions/') && !path.includes('/', 14) && method === 'PATCH') {
    const id = path.replace('/submissions/', '');
    const body = await req.json().catch(() => ({}));
    const allowed = ['alliance', 'state_number', 'member_name'];
    const updates: Record<string, unknown> = {};
    for (const key of allowed) {
      if (key in body) updates[key] = body[key];
    }
    if (!Object.keys(updates).length) return json({ error: 'No valid fields to update' }, 400);
    const { data, error } = await db.from('submissions').update(updates).eq('id', id).select().single();
    if (error) return json({ error: error.message }, 500);
    return json(data);
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

  // ----------------------------------------------------------------
  // CORRECTIONS
  // ----------------------------------------------------------------

  // GET /corrections — all corrections
  if (path === '/corrections' && method === 'GET') {
    const { data, error } = await db.from('corrections').select('*').order('created_at', { ascending: true });
    if (error) return json({ error: error.message }, 500);
    return json(data || []);
  }

  // POST /corrections — add a correction
  if (path === '/corrections' && method === 'POST') {
    const body = await req.json().catch(() => ({}));
    const { type, theme, old_name, new_name } = body;
    if (!type || !theme || !old_name || !new_name) return json({ error: 'Missing required fields' }, 400);
    if (old_name.trim() === new_name.trim()) return json({ error: 'Old and new names are the same' }, 400);
    const { data, error } = await db.from('corrections').insert({ type, theme, old_name: old_name.trim(), new_name: new_name.trim() }).select().single();
    if (error) return json({ error: error.message }, 500);
    return json(data);
  }

  // DELETE /corrections/:id — remove a correction
  if (path.startsWith('/corrections/') && method === 'DELETE') {
    const id = path.replace('/corrections/', '');
    const { error } = await db.from('corrections').delete().eq('id', id);
    if (error) return json({ error: error.message }, 500);
    return json({ ok: true });
  }

  // ----------------------------------------------------------------
  // CATALOG OVERRIDES (scene ordering)
  // ----------------------------------------------------------------

  // GET /catalog — all overrides
  if (path === '/catalog' && method === 'GET') {
    const { data, error } = await db.from('catalog_overrides').select('*');
    if (error) return json({ error: error.message }, 500);
    return json(data || []);
  }

  // POST /catalog — upsert scene order for a theme
  if (path === '/catalog' && method === 'POST') {
    const body = await req.json().catch(() => ({}));
    const { theme, scene_order } = body;
    if (!theme || !Array.isArray(scene_order)) return json({ error: 'Missing theme or scene_order' }, 400);
    const { data, error } = await db.from('catalog_overrides')
      .upsert({ theme, scene_order, updated_at: new Date().toISOString() }, { onConflict: 'theme' })
      .select().single();
    if (error) return json({ error: error.message }, 500);
    return json(data);
  }

  // DELETE /catalog/:theme — remove override for a theme
  if (path.startsWith('/catalog/') && method === 'DELETE') {
    const theme = decodeURIComponent(path.replace('/catalog/', ''));
    const { error } = await db.from('catalog_overrides').delete().eq('theme', theme);
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
