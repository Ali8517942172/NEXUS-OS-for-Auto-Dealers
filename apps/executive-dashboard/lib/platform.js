/* NEXUS OS -- lib/platform.js
   The one question this file answers: is the signed-in account the NEXUS
   platform founder. Read from public.nexus_is_platform_admin() -- a
   SECURITY DEFINER RPC that checks public.platform_admin against auth.uid(),
   never inferred here from role, email or any client-side guess.

   THIS IS NOT A SECURITY BOUNDARY. Every founder-only RPC (nexus_founder_*)
   and the founder-invite Edge Function re-check the same nexus_is_platform_
   admin() server-side on every call, independently of anything this file
   decides. What this file controls is only whether the Founder item appears
   in the sidebar and whether Settings offers the founder-scoped invite path
   -- hiding a button is a courtesy to a reader who is not the founder, never
   the reason a founder-only action is safe.

   Read once per signed-in identity, the same shape as lib/tenant.js's
   loadTenant(): a read that FAILS is not cached, so a dropped connection does
   not lock the console hidden until the tab is reloaded; a read that
   SUCCEEDS is cached, so opening Settings a dozen times in one session does
   not refire it.

   UNLIKE lib/data.js's held()/canX() family -- which answers TRUE on an
   unknown authority, so a screen keeps offering an action and lets the
   database refuse it rather than hiding something an owner may be entitled
   to -- this defaults to FALSE (hidden) whenever the answer is not a
   confirmed true. The two mistakes are not the same cost here: an owner who
   briefly does not see a button they hold can refresh; a stranger who
   briefly sees a founder console listing every dealership because a network
   blip read as "unknown, so show it" is not a trade this file will make. */
import { dbWrite, onIdentityChange } from './data.js';

let STATE = { loaded: false, isFounder: false };
let inflight = null;

/* One read per signed-in identity, held once it succeeds. */
function loadPlatformAdmin() {
  if (STATE.loaded) return Promise.resolve(STATE.isFounder);
  if (inflight) return inflight;
  /* POST, not the GET db() uses elsewhere, because this file does not control
     nx1003 (branch feat/subscription) and cannot assume it marked the function
     STABLE -- PostgREST only accepts a GET RPC call for one that is, and
     refuses a VOLATILE one with a 405. POST is accepted either way, and
     nexus_is_platform_admin() takes no argument that a POST body could get
     wrong, so there is no cost to always using the form that cannot 405. */
  inflight = dbWrite('POST', 'rpc/nexus_is_platform_admin', {})
    .then(r => {
      STATE = { loaded: true, isFounder: r === true };
      inflight = null;
      return STATE.isFounder;
    })
    .catch(() => {
      /* Not cached: STATE.loaded stays false, so the next caller (the
         operator opening Settings after a dropped connection, or the next
         boot) tries again instead of being stuck on a guess. */
      inflight = null;
      return false;
    });
  return inflight;
}

/* Whatever is known right now, without waiting. Callers that have not
   awaited loadPlatformAdmin() get false, which is the correct default for a
   button that must not appear before the question has actually been asked. */
const isPlatformAdmin = () => STATE.loaded && STATE.isFounder === true;

/* Signing in as somebody else must not inherit the previous account's
   founder status. */
onIdentityChange(() => { STATE = { loaded: false, isFounder: false }; inflight = null; });

export { loadPlatformAdmin, isPlatformAdmin };
