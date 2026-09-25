/**
 * The animated player is a chunk of its own: it is fetched only when the tour is about to scroll
 * into view, or when a visitor points at a link to it, so it never delays the homepage itself.
 */
export const loadTourPlayer = () => import('./TourPlayer');
