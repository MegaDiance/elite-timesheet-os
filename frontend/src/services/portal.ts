/**
 * SimpleHours has no generic sign-in page: every sign-in happens at an organisation's own portal
 * link, /login/:slug. This remembers the portal this browser last signed in through, so sign-out,
 * session expiry and similar redirects return to that organisation's sign-in page. With no portal
 * remembered they go to the public home page instead — never to a page that lists organisations.
 */
const KEY = 'last_org_slug';
const SLUG_RE = /^[a-z0-9-]{1,64}$/;

export function rememberPortal(slug: string | null | undefined) {
  try {
    if (slug && SLUG_RE.test(slug)) localStorage.setItem(KEY, slug);
  } catch {
    // Storage can be unavailable (private mode); redirects then fall back to the home page.
  }
}

export function rememberedPortal(): string | null {
  try {
    const slug = localStorage.getItem(KEY);
    return slug && SLUG_RE.test(slug) ? slug : null;
  } catch {
    return null;
  }
}

/** The remembered organisation's sign-in page (with an optional notice), or the home page. */
export function portalLoginPath(reason?: string): string {
  const slug = rememberedPortal();
  if (!slug) return '/';
  return `/login/${slug}${reason ? `?reason=${encodeURIComponent(reason)}` : ''}`;
}
