# Card Theme Playbook (Client + Developer Dashboards)

The sidebar now includes **Card Background Style** with 10 selectable themes on:
- `client_dashboard.html`
- `developer_dashboard.html`

Each theme is subtle and business-safe (no noisy social styling), and only affects card backgrounds (`.card`, `.sc`, `.modal-card`) so layout/UI structure remains unchanged.

## 1) Animated Gradient Flow
- Selector value: `gradient-flow`
- Theme: Modern Tech / Clean SaaS
- Description: Smooth, directional color flow across cards.
- Mood: Innovative, forward-looking, polished.
- Best for: Productized software offers, agency capability highlights.

## 2) Glassmorphism with Moving Light Reflection
- Selector value: `glass-reflection`
- Theme: Premium Digital / Minimal Luxury
- Description: Frosted glass style with soft moving highlight.
- Mood: Refined, premium, modern.
- Best for: High-ticket packages, executive client dashboards.

## 3) Floating Abstract Blobs
- Selector value: `floating-blobs`
- Theme: Creative Startup / Modern Agency
- Description: Organic gradients with gentle motion depth.
- Mood: Creative, energetic, fresh.
- Best for: Branding, UX, and design-focused projects.

## 4) Particle Network (Connected Dots)
- Selector value: `particle-network`
- Theme: Advanced Technology / AI
- Description: Dot-field texture with subtle drift to suggest connected systems.
- Mood: Intelligent, data-driven, technical.
- Best for: AI, automation, and platform engineering storytelling.

## 5) Subtle Moving Grid
- Selector value: `moving-grid`
- Theme: Corporate / Structured Business
- Description: Clean grid movement for operational discipline.
- Mood: Stable, analytical, dependable.
- Best for: B2B workflows, enterprise delivery, PM oversight.

## 6) Animated Wave Background
- Selector value: `animated-waves`
- Theme: Clean SaaS / Friendly Professional
- Description: Layered soft wave motion without distraction.
- Mood: Calm, trustworthy, smooth.
- Best for: Onboarding flows and long-running delivery projects.

## 7) 3D Parallax Layered Background
- Selector value: `parallax-layers`
- Theme: Immersive Digital Experience
- Description: Multi-layer highlight drift for depth.
- Mood: Dynamic, premium, interactive.
- Best for: Featured dashboards and portfolio-driven storytelling.

## 8) Glow Pulse Background
- Selector value: `glow-pulse`
- Theme: Spotlight / Featured Product
- Description: Controlled pulse glow anchored near card header zones.
- Mood: Focused, high-value, intentional.
- Best for: Priority KPIs, revenue highlights, conversion cards.

## 9) Animated Diagonal Light Sweep
- Selector value: `diagonal-sweep`
- Theme: Luxury / High-Value Offer
- Description: Periodic diagonal sheen effect for polished emphasis.
- Mood: Exclusive, premium, high-end.
- Best for: Executive proposal summaries and premium packages.

## 10) Animated Noise / Grain Texture
- Selector value: `noise-grain`
- Theme: Editorial / Professional Depth
- Description: Fine moving grain for subtle material realism.
- Mood: Mature, grounded, professional.
- Best for: Corporate communication, financial summaries, B2B proposals.

## Persistence
- Client dashboard storage key: `clientCardFxTheme`
- Developer dashboard storage key: `developerCardFxTheme`
- Theme state is persisted in `localStorage` and applied by `data-cardfx` on `<html>`.

