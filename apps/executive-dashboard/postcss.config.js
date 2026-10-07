// Tailwind was removed on 2026-08 because its `content` scanning silently
// dropped classes that were built at runtime, which needed a growing safelist
// to work around -- a class of bug that is invisible in dev and only appears in
// the production build.
//
// It is back as of 7 Oct 2026, because the dashboard is now designed in Google
// Stitch and Stitch emits Tailwind. tailwind.config.js says what changed so the
// old bug cannot come back silently: the theme is extracted from the Stitch
// exports, class strings must be literal, and `npm run build` fails if a class
// used in the source is missing from the built CSS (scripts/stitch-classes.mjs).
// The legacy stylesheets (styles.css, lib/theme-*.css) are plain CSS with
// design tokens and still have nothing to purge.
export default {
  plugins: {
    tailwindcss: {},
    autoprefixer: {},
  },
};
