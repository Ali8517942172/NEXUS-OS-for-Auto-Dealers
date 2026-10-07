/* NEXUS OS — tailwind.config.js

   Tailwind is back (7 Oct 2026) because every screen is now designed in Google
   Stitch, and Stitch emits Tailwind. It was removed once, for a real reason
   (postcss.config.js tells it): `content` scanning silently drops a class that
   is only ever ASSEMBLED at runtime, and the result looks fine in dev and is
   broken in the production build. It is back on three conditions, each of
   which closes one way that happened:

   1. THE THEME IS NOT TYPED HERE. It is read from design/stitch/theme.json,
      which scripts/stitch-theme.mjs extracts from the Stitch exports and checks
      every export against. A colour Stitch uses that this build does not know
      fails `npm run build`, instead of compiling to nothing.

   2. CLASS STRINGS ARE LITERAL. scripts/stitch-classes.mjs runs after every
      `vite build` and fails it when (a) a class attribute glues a token to an
      interpolation (`bg-${tone}`) or a string concatenation (`'bg-' + tone`)
      anywhere Stitch markup lives, or (b) a literal class token Tailwind
      recognises is missing from the CSS that was actually built. A variant is
      chosen from a map of COMPLETE class strings (see lib/stitch-ui.js), never
      built from fragments. QUALITY_GATE.mjs R8 then re-checks the same thing
      from the other end: every class on every element of every rendered
      screen, compared against the built CSS.

   3. THE LEGACY SCREENS ARE NOT RESET. Preflight is OFF. Tailwind's global
      reset would restyle every heading, button and list in the screens that
      have not been migrated yet. The reset Stitch markup depends on is applied
      only inside `.nx-stitch` (lib/stitch.css), at zero specificity.

   `important: '.nx-tw'` — index.html puts that class on <html>, so every
   utility compiles as `.nx-tw .px-3` (0,2,0). Without it, the legacy rules
   `input[type=text]`, `input:focus` and friends (0,1,1) out-rank a single
   utility class (0,1,0), and a Stitch search box or sign-in field would keep
   the legacy 40px height and border. The class is on <html>, not <body>, so
   the body itself can still carry utilities. */
import { readFileSync } from 'node:fs';

const stitch = JSON.parse(readFileSync(new URL('./design/stitch/theme.json', import.meta.url), 'utf8'));

export default {
  darkMode: stitch.darkMode,
  important: '.nx-tw',
  content: [
    './index.html',
    './founder/**/*.{html,js}',
    './app.js',
    './lib/**/*.js',
    './screens/**/*.js',
  ],
  corePlugins: { preflight: false },
  /* Legacy class names that are ALSO Tailwind utilities, measured 7 Oct 2026 by
     compiling the content globs against the pre-Stitch sources: grid, grow,
     sr-only and list-item are used as legacy classes. The first three mean the
     same thing in both (display:grid, flex-grow:1, visually hidden). list-item
     does not: styles.css's `.list-item` is a flex row, Tailwind's is
     `display: list-item`, and the utility (0,2,0) would out-rank the legacy rule
     (0,1,0) and break every list that uses it. No Stitch export uses it. */
  blocklist: ['list-item'],
  theme: { extend: stitch.extend },
  plugins: [],
};
