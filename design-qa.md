# Shopiyz Developer Docs Design QA

- Source visual truth: `/tmp/shopiyz-admin-reference-before.png` and `/var/folders/q1/_rqthq3d48g8gfdmf5gwmx8c0000gn/T/codex-clipboard-b70b78e7-7aef-4dfd-98f5-cb0f65c5f8db.png`
- Implementation screenshot: `/tmp/shopiyz-storefront-local-after.png`
- Landing screenshot: `/tmp/shopiyz-docs-landing-local.png`
- OpenAPI screenshot: `/tmp/shopiyz-openapi-local-after.png`
- Mobile screenshots: `/tmp/shopiyz-docs-landing-mobile.png`, `/tmp/shopiyz-storefront-mobile.png`
- Full-view comparison: `/tmp/shopiyz-admin-storefront-comparison.png`
- Focused header/hero comparison: `/tmp/shopiyz-docs-header-hero-comparison.png`
- Viewports: 1440 × 900 desktop and 390 × 844 mobile
- State: Landing default, Admin overview default, Storefront overview default, Storefront Runtime expanded, Storefront search filtered, OpenAPI default

## Findings

- No remaining P0, P1 or P2 findings.
- Fonts and typography: Storefront now uses the Admin page's system sans/mono stack, 40px desktop hero scale, compact 12–15px navigation hierarchy and matching optical weights. Mobile hero scales to 29–32px without clipping.
- Spacing and layout rhythm: The 74px desktop header, 300px sidebar, bordered notice, two-column hero, code surface, 10px radii and 24–34px content rhythm match the Admin reference. Mobile collapses to one column with 14px page gutters.
- Colors and visual tokens: Both docs use the same monochrome surfaces, borders, muted text, black primary actions and code background. Method colors remain semantic and limited to endpoint badges.
- Image quality and asset fidelity: The existing `/favicon.svg` source asset is reused for the brand. No placeholder, generated or approximate image assets were introduced.
- Copy and content: Storefront terminology is product-specific while matching Admin's information hierarchy. The landing page clearly asks Admin versus Storefront, and the OpenAPI page presents both contracts together.
- Accessibility and interaction: Canonical links are semantic anchors; resource headers are buttons with `aria-expanded`; mobile navigation uses native `details`; search fields have labels; keyboard and hash navigation remain available.
- Responsive behavior: Browser checks reported `scrollWidth === innerWidth` at both desktop and 390px mobile. Persistent controls remain visible and no horizontal page overflow was observed.

## Comparison history

1. Initial Storefront evidence: `/tmp/shopiyz-storefront-before.png`.
   - P1: Storefront used a separate, less mature visual system with a 270px sidebar, oversized 48px hero, no Admin-style notice/search/code composition and flatter content hierarchy.
   - P2: OpenAPI linked only the Storefront YAML and the navigation did not expose a shared contract center.
   - Fix: Rebuilt Storefront with the Admin header/sidebar/content tokens, added search and collapsible resource groups, created `/openapi`, and added the `/` API choice page.
2. Post-fix evidence: `/tmp/shopiyz-admin-storefront-comparison.png` and `/tmp/shopiyz-docs-header-hero-comparison.png`.
   - The Admin and Storefront screens now share header height, sidebar width, typography scale, borders, card rhythm, search treatment, hero/code balance and responsive behavior.
   - The prior P1/P2 differences are resolved.

## Primary interactions tested

- Landing Admin and Storefront destinations expose canonical `/admin` and `/storefront` URLs.
- Storefront Runtime link opens its resource group and updates `aria-expanded` to `true`.
- Storefront search for `promotions` narrows the result to one matching operation in `merchandising`.
- OpenAPI page exposes both Admin and Storefront YAML contracts.
- Browser console errors/warnings: none on Storefront and OpenAPI checks.

## Implementation checklist

- [x] Root API choice page
- [x] Canonical `/admin` and `/storefront` destinations
- [x] Shared `/openapi` center with both contracts
- [x] Admin `unversioned` label removed
- [x] Admin Overview subnavigation closed by default
- [x] Storefront visual system aligned with Admin
- [x] Desktop and mobile overflow checks
- [x] Search, resource disclosure and link contracts

## Follow-up polish

- No blocking follow-up polish remains.

final result: passed
