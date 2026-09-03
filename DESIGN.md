<!-- BUSINESS CONTEXT — added 2026-09-02 -->
> **This is a commercial product, not a demo.** NEXUS is a **Revenue Recovery &
> Action OS for dealerships** — it sits above the dealership's existing DMS, CRM
> and inventory systems, finds revenue leaks, decides the next best action and
> executes it. It replaces none of them. See `PRODUCT.md` for the thesis and
> `CLAUDE.md` for how to work here. Ali owns NEXUS OS and is selling it
> to real dealerships on a subscription. Judge changes by whether they make it
> sellable and keep it sellable. The honest commercial position today is a
> **controlled dealership pilot** — not "enterprise-ready", not "compliant".
> Never state more than the evidence supports; "wired but never fired" is a real
> answer. The blocker before a second paying dealership is that the system is
> **single-tenant**: every RLS policy is `USING (true)`, so tenant two would read
> tenant one's customers. See `CLAUDE.md` for how to work here.

# NEXUS OS Design System

## Overall Theme
The design must be a world-class, premium UI that supports BOTH Light and Dark themes. It must STRICTLY adhere to a minimalist color palette (Maximum 2-3 colors total in the entire app).

- **Primary Color**: Deep Indigo (#4F46E5) - Used for primary actions, active states, and main accents.
- **Secondary Color**: Soft Emerald (#10B981) - Used sparingly for positive indicators (like success or growth).
- **Background (Light Theme)**: Pure White (#FFFFFF) to subtle off-white (#F8FAFC).
- **Background (Dark Theme)**: Very dark gray/black (#111827).
- **Text/Grayscale**: Slate grays for text hierarchy.

## Aesthetic Rules
- DO NOT use a rainbow of colors. Stick strictly to Indigo, Emerald, and Grayscale.
- **Aesthetic**: Clean, sharp, and highly professional like enterprise SaaS (Stripe, Linear).
- **Typography**: Modern, sleek sans-serif font like 'Inter'.
- **Shapes**: Rounded corners (border-radius: 8px to 12px) for a sharp but modern look.
- **Animations**: Crisp, snappy transitions.

## Components
- **Cards**: Minimalist cards with very subtle, clean borders (no heavy drop shadows).
- **Buttons**: Solid Indigo background with white text, or sleek ghost buttons.
- **Data Visualizations**: Charts must only use Indigo and Emerald. No other colors.
- **Sidebar Navigation**: Clean sidebar using grayscale icons that turn Indigo when active.
