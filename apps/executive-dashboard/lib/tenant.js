/* NEXUS OS — lib/tenant.js
   Added 2 Sep 2026, the day tenant isolation landed in the database.

   WHAT THIS IS NOT. It is not a permission check and nothing here decides what
   anybody may read. Every request this app makes is scoped by RLS at the
   database, per request, against the caller's own JWT — that is the security
   boundary and it is the only one. Deleting this file would not leak a row.

   WHAT IT IS. Two things the frontend got wrong the moment there could be more
   than one dealership, both of them about what the screen SAYS rather than what
   it may read:

   1. A signed-in user could not see whose data they were looking at. With one
      dealership that was invisible; with two it is the first question anybody
      asks, and a dashboard that cannot answer it is not one you can sell to a
      second buyer.

   2. A signed-in user with no `tenant_members` row reads zero rows from every
      tenant-scoped table — correctly, that is RLS doing its job — and fourteen
      screens then render those zeros as findings: "There is no lead in the
      database at all", "Every unit in inventory is marked sold", "No document
      has ever been audited". Every one of those sentences is the lie CLAUDE.md
      names: a missing row is not proof the event did not happen. This is not
      hypothetical maintenance — it is what the first mis-provisioned rep at
      dealership two sees on their first morning, and it looks like the product
      losing their data rather than like an account that was never finished.

   So: read the caller's memberships once per signed-in identity, name the
   dealership in the shell, and refuse to render a screen at all when the answer
   is "you belong to no dealership" — because in that state every panel on every
   screen is an unknown being drawn as a zero.

   FAIL OPEN, DELIBERATELY. Only a read that SUCCEEDS and returns no membership
   blocks anything. A read that fails leaves the screens alone to report their
   own errors in their own panels; a network blip must not take the app away. */
import { db, onIdentityChange } from './data.js';

/* The ordering is not cosmetic and must not be "tidied". It is copied from
   public.nexus_current_tenant_id(), which resolves a caller with several
   memberships as

       order by m.created_at, m.tenant_id limit 1

   so reading tenant_members in exactly that order tells us which tenant the
   DATABASE will answer as — rather than this file guessing and then labelling
   the shell with a dealership whose rows are not the ones on screen. If that
   function's tiebreak ever changes, this changes with it. */
const MEMBER_PATH = 'tenant_members?select=tenant_id,role,created_at&order=created_at.asc,tenant_id.asc';
const TENANT_PATH = 'tenants?select=id,name,slug,status';

const EMPTY = { loaded: false, ok: false, memberships: null, tenants: null, active: null, error: null };
let STATE = EMPTY;
let inflight = null;

/* One read per signed-in identity. The result is held because fourteen screens
   and the nav all want the same answer within the same second of boot, not
   because it is expensive.

   A FAILED read is not held. Caching a failure would turn one bad second at
   boot into a dashboard that stays wrong until the tab is reloaded, and the
   identity-change reset below cannot help when the same person simply signs in
   again after a dropped connection. */
function loadTenant() {
  if (STATE.loaded && STATE.ok) return Promise.resolve(STATE);
  if (inflight) return inflight;
  inflight = Promise.all([db(MEMBER_PATH), db(TENANT_PATH)])
    .then(([memberships, tenants]) => {
      const rows = Array.isArray(tenants) ? tenants : [];
      const mine = Array.isArray(memberships) ? memberships : [];
      const byId = new Map(rows.map(t => [String(t.id), t]));
      /* The first membership in the database's own order. `tenants` is read
         separately because tenant_members carries only the id, and a name is
         what the shell has to show. A membership whose tenant row did not come
         back keeps the id — an id is a poor label but it is a true one, and it
         is the only case where the shell shows one. */
      const first = mine[0] || null;
      const active = first
        ? (byId.get(String(first.tenant_id)) || { id: first.tenant_id, name: null, slug: null, status: null })
        : null;
      STATE = { loaded: true, ok: true, memberships: mine, tenants: rows, active, error: null };
      inflight = null;
      return STATE;
    })
    .catch(e => {
      STATE = { loaded: true, ok: false, memberships: null, tenants: null, active: null,
                error: String(e?.message || e).slice(0, 180) };
      inflight = null;
      return STATE;
    });
  return inflight;
}

/* Whatever is known right now, without waiting. Callers that have already
   awaited loadTenant() use this; callers that have not get `loaded: false` and
   must not read anything into it. */
const tenantState = () => STATE;

/* The one condition that blocks a screen: the read WORKED and the answer was
   "no dealership". Anything else — not loaded yet, read failed, one tenant,
   several tenants — is not this. */
const hasNoTenant = (s = STATE) => !!(s.loaded && s.ok && Array.isArray(s.memberships) && s.memberships.length === 0);

/* What to call this dealership in the UI. Null when unknown, so callers render
   a state rather than a placeholder that reads like a real name. */
function tenantLabel(s = STATE) {
  if (!s.loaded || !s.ok || !s.active) return null;
  return s.active.name || s.active.slug || String(s.active.id || '') || null;
}

/* Memberships beyond the first are real and this build cannot switch between
   them: nexus_current_tenant_id() picks one and every read on every screen is
   that one. Saying so is the difference between a dashboard showing a subset
   and a dashboard silently showing the wrong dealership. */
const extraTenants = (s = STATE) =>
  (s.loaded && s.ok && Array.isArray(s.memberships)) ? Math.max(0, s.memberships.length - 1) : 0;

/* Signing in as somebody else must not inherit the previous dealership's name,
   or the previous session's answer to "do you belong anywhere". */
onIdentityChange(() => { STATE = EMPTY; inflight = null; });

export { loadTenant, tenantState, hasNoTenant, tenantLabel, extraTenants };
