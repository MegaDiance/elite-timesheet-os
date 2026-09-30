import { useEffect, useReducer, useRef, useSyncExternalStore } from 'react';
import { ArrowRight, Play, RotateCcw } from 'lucide-react';
import { CtaLink } from '../ui';
import { TOUR_CHAPTERS, TOUR_STAGE_HEIGHT } from './chapters';
import { initialTourState, nextEventDelay, stepAt, tourReducer, type TourAction, type TourState } from './timeline';
import { TourStage } from './scenes';
import { TOUR_FOOTNOTE_ROW, TourCaption } from './TourCaption';
import { TourTranscript } from './Transcript';

/**
 * The homepage product tour: a silent, captioned walk through the app, drawn in HTML so it follows
 * the theme and stays sharp. Loaded on demand (see loadPlayer.ts).
 *
 * The stage is the whole player: the screen, with the step's caption along its bottom edge. The one
 * control is the stage itself, a single button that pauses and resumes.
 *
 * - It starts by itself only when at least half of it is on screen and the visitor hasn't asked for
 *   reduced motion. It pauses when scrolled away or when the tab is hidden, and carries on when it
 *   comes back, unless the visitor paused it. It stops at the end rather than looping.
 * - Where it can't start by itself (reduced motion, no IntersectionObserver) nothing moves until the
 *   visitor presses Play. With reduced motion each chapter then shows its finished screen, and the
 *   tour still stops when the visitor pauses it.
 * - The picture and captions are hidden from screen readers; the same story is in a status message
 *   whenever the chapter changes, and in the text version below the stage.
 */

const TOUR_CSS = `
.ptour-hidden { opacity: 0; }
.ptour-in { animation: ptour-in 380ms cubic-bezier(0.2, 0.7, 0.2, 1) both; }
.ptour-fade { animation: ptour-fade 280ms ease-out both; }
.ptour-type { display: inline-block; max-width: 100%; animation: ptour-type 650ms steps(14, end) both; }
.ptour-press { animation: ptour-press 520ms ease-out both; }
.ptour-ring { box-shadow: 0 0 0 2px var(--primary); animation: ptour-ring 700ms ease-out; }
[data-ptour-paused] .ptour-anim { animation-play-state: paused; }
@keyframes ptour-in { from { opacity: 0; transform: translateY(6px); } }
@keyframes ptour-fade { from { opacity: 0; } }
@keyframes ptour-type { from { clip-path: inset(0 100% 0 0); } to { clip-path: inset(0 0 0 0); } }
@keyframes ptour-press { 40% { transform: scale(0.95); box-shadow: 0 0 0 4px color-mix(in srgb, var(--primary) 35%, transparent); } }
@keyframes ptour-ring { from { box-shadow: 0 0 0 8px transparent; } }
@media (prefers-reduced-motion: reduce) {
  .ptour-in, .ptour-fade, .ptour-type, .ptour-press, .ptour-ring { animation: none; }
}
`;

const REDUCED_MOTION = '(prefers-reduced-motion: reduce)';

function subscribeReducedMotion(onChange: () => void) {
  const query = typeof window.matchMedia === 'function' ? window.matchMedia(REDUCED_MOTION) : null;
  query?.addEventListener('change', onChange);
  return () => query?.removeEventListener('change', onChange);
}

const prefersReducedMotion = () => typeof window.matchMedia === 'function' && window.matchMedia(REDUCED_MOTION).matches;

const reducer = (state: TourState, action: TourAction) => tourReducer(TOUR_CHAPTERS, state, action);

const focusRing = 'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--primary)]';

/** A small label that looks like a button but only decorates the stage, which is the real button. */
const hint = 'inline-flex items-center gap-1.5 text-sm font-semibold';

export default function TourPlayer() {
  const reducedMotion = useSyncExternalStore(subscribeReducedMotion, prefersReducedMotion, () => false);
  const [state, dispatch] = useReducer(reducer, initialTourState);
  const frameRef = useRef<HTMLDivElement>(null);
  // When the running stretch of the current chapter started, and how much had played before it.
  const segment = useRef({ startedAt: 0, base: 0 });
  // The latest state, for the visibility observers set up once below.
  const latest = useRef({ state, reducedMotion });
  useEffect(() => {
    latest.current = { state, reducedMotion };
  });

  const chapter = TOUR_CHAPTERS[state.chapter];
  const step = reducedMotion ? chapter.beats.length : stepAt(chapter.beats, state.elapsed);
  const playing = state.status === 'playing';
  const ended = state.status === 'ended';
  // Without autoplay the stage says how to start; otherwise it stays clean until the visitor pauses.
  const showStart = state.status === 'idle' && (reducedMotion || typeof IntersectionObserver !== 'function');
  const pausedByVisitor = state.status === 'paused' && state.pausedBy === 'visitor';

  // One timer at a time: until the next beat (or, with reduced motion, the end of the chapter).
  useEffect(() => {
    if (state.status !== 'playing') return;
    const current = TOUR_CHAPTERS[state.chapter];
    const base = state.elapsed;
    const startedAt = performance.now();
    segment.current = { startedAt, base };
    const delay = nextEventDelay(current, base, !reducedMotion);
    const timer = window.setTimeout(() => {
      dispatch({ type: 'advance', elapsed: Math.max(base + delay, base + performance.now() - startedAt) });
    }, delay);
    return () => window.clearTimeout(timer);
  }, [state.status, state.chapter, state.elapsed, state.run, reducedMotion]);

  // Start when half of the stage is on screen; pause when it scrolls away or the tab is hidden.
  useEffect(() => {
    const frame = frameRef.current;
    if (!frame || typeof IntersectionObserver !== 'function') return;
    let inView = false;
    const update = () => {
      const { state: current, reducedMotion: still } = latest.current;
      if (inView && document.visibilityState !== 'hidden') {
        if (!still) dispatch({ type: 'autoplay' });
        dispatch({ type: 'resume' });
      } else if (current.status === 'playing') {
        const { startedAt, base } = segment.current;
        dispatch({ type: 'pause', by: 'auto', elapsed: base + performance.now() - startedAt });
      }
    };
    const observer = new IntersectionObserver(
      ([entry]) => {
        inView = entry.intersectionRatio >= 0.5;
        update();
      },
      { threshold: [0, 0.5, 1] },
    );
    observer.observe(frame);
    document.addEventListener('visibilitychange', update);
    return () => {
      observer.disconnect();
      document.removeEventListener('visibilitychange', update);
    };
  }, []);

  const toggle = () => {
    if (playing) dispatch({ type: 'pause', by: 'visitor', elapsed: segment.current.base + performance.now() - segment.current.startedAt });
    else dispatch({ type: 'play' });
  };

  const label = playing ? 'Pause the tour' : ended ? 'Replay the tour' : 'Play the tour';
  // Read out whenever the chapter changes, including by itself.
  const announcement =
    state.status === 'idle'
      ? ''
      : `Step ${state.chapter + 1} of ${TOUR_CHAPTERS.length}: ${chapter.heading}. ${chapter.caption}${ended ? ' That is the end of the tour.' : ''}`;

  return (
    <div>
      <style>{TOUR_CSS}</style>
      <div ref={frameRef} className="relative overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--panel)] shadow-sm">
        <div aria-hidden="true" className={`relative z-0 overflow-hidden select-none ${TOUR_STAGE_HEIGHT}`} data-ptour-paused={state.status === 'paused' ? '' : undefined}>
          <TourStage chapter={chapter} step={step} run={state.run} from={state.from === null ? null : TOUR_CHAPTERS[state.from]} />
        </div>
        <TourCaption index={state.chapter} animate />

        {/* The whole stage is one button. Everything drawn over it is just a hint. */}
        <button
          type="button"
          onClick={toggle}
          aria-label={label}
          className="absolute inset-0 z-10 cursor-pointer focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-[color:var(--primary)]"
        />
        <div className={`pointer-events-none absolute inset-x-0 top-0 z-20 flex items-center justify-center ${TOUR_STAGE_HEIGHT}`}>
          {showStart && (
            <div className="ptour-fade absolute inset-0 flex items-center justify-center bg-[var(--bg)]/60">
              <span className={`${hint} rounded-full bg-[var(--primary)] px-4 py-2 text-white shadow-[var(--shadow)]`}>
                <Play className="h-4 w-4" aria-hidden="true" />
                Play the tour
              </span>
            </div>
          )}
          {pausedByVisitor && (
            <span className="ptour-fade flex h-14 w-14 items-center justify-center rounded-full border border-[var(--border)] bg-[var(--panel)]/90 text-[var(--text)] shadow-[var(--shadow)]">
              <Play className="ml-0.5 h-6 w-6" aria-hidden="true" />
            </span>
          )}
          {ended && (
            <div className="ptour-fade absolute inset-x-0 bottom-4 flex justify-center px-3">
              <div className="flex items-center gap-1 rounded-full border border-[var(--border)] bg-[var(--panel)] py-1 pr-1 pl-4 shadow-[var(--shadow)]">
                <span className={`${hint} mr-2 text-[var(--text)]`}>
                  <RotateCcw className="h-4 w-4" aria-hidden="true" />
                  Replay
                </span>
                <CtaLink to="/pricing" size="sm" className="pointer-events-auto rounded-full">
                  Get started
                  <ArrowRight aria-hidden="true" className="h-4 w-4" />
                </CtaLink>
              </div>
            </div>
          )}
        </div>
      </div>

      <p role="status" className="sr-only">
        {announcement}
      </p>

      <div className={TOUR_FOOTNOTE_ROW}>
        <details className="min-w-0 max-w-full">
          <summary className={`cursor-pointer rounded-sm font-medium text-[var(--text)]/80 underline underline-offset-4 hover:text-[var(--text)] ${focusRing}`}>
            Read the tour as text
          </summary>
          <TourTranscript className="mt-4 max-w-2xl" />
        </details>
        <p>Example organisation: names, times and hours are made up.</p>
      </div>
    </div>
  );
}
