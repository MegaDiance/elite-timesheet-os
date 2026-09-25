import { useEffect, useReducer, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import { ArrowRight, Captions, CaptionsOff, ChevronLeft, ChevronRight, Pause, Play, RotateCcw } from 'lucide-react';
import { CtaLink } from '../ui';
import { TOUR_CAPTION_HEIGHT, TOUR_CHAPTERS, TOUR_STAGE_HEIGHT, TOUR_TOTAL_SECONDS } from './chapters';
import { initialTourState, nextEventDelay, stepAt, tourReducer, type TourAction, type TourState } from './timeline';
import { TourStage } from './scenes';
import { TourTranscript } from './Transcript';

/**
 * The homepage product tour: a silent, captioned walk through the app, drawn in HTML so it follows
 * the theme and stays sharp. Loaded on demand (see loadPlayer.ts).
 *
 * - It starts by itself only when at least half of it is on screen and the visitor hasn't asked for
 *   reduced motion. It pauses when scrolled away or when the tab is hidden, and carries on when it
 *   comes back, unless the visitor paused it. It stops at the end rather than looping.
 * - With reduced motion, nothing moves: each chapter shows its finished screen, and chapters only
 *   change when the visitor asks.
 * - The picture is hidden from screen readers; the same story is in the captions, the transcript
 *   and a status message when the visitor changes chapter.
 */

const LAST = TOUR_CHAPTERS.length - 1;

const TOUR_CSS = `
.ptour-hidden { opacity: 0; }
.ptour-in { animation: ptour-in 380ms cubic-bezier(0.2, 0.7, 0.2, 1) both; }
.ptour-fade { animation: ptour-fade 280ms ease-out both; }
.ptour-type { display: inline-block; max-width: 100%; animation: ptour-type 650ms steps(14, end) both; }
.ptour-press { animation: ptour-press 520ms ease-out both; }
.ptour-ring { box-shadow: 0 0 0 2px var(--primary); animation: ptour-ring 700ms ease-out; }
.ptour-progress { transform-origin: left; animation: ptour-progress linear both; }
[data-ptour-paused] .ptour-anim { animation-play-state: paused; }
@keyframes ptour-in { from { opacity: 0; transform: translateY(6px); } }
@keyframes ptour-fade { from { opacity: 0; } }
@keyframes ptour-type { from { clip-path: inset(0 100% 0 0); } to { clip-path: inset(0 0 0 0); } }
@keyframes ptour-press { 40% { transform: scale(0.95); box-shadow: 0 0 0 4px color-mix(in srgb, var(--primary) 35%, transparent); } }
@keyframes ptour-ring { from { box-shadow: 0 0 0 8px transparent; } }
@keyframes ptour-progress { from { transform: scaleX(0); } to { transform: scaleX(1); } }
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

function ControlButton({
  label,
  onClick,
  disabled = false,
  pressed,
  primary = false,
  children,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  pressed?: boolean;
  primary?: boolean;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      aria-pressed={pressed}
      title={label}
      className={`inline-flex h-10 min-w-10 items-center justify-center gap-1.5 rounded-md px-2.5 text-sm font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-40 sm:h-9 sm:min-w-9 ${focusRing} ${
        primary
          ? 'bg-[var(--primary)] text-white hover:bg-[var(--primary-h)]'
          : 'border border-[var(--border-hover)] bg-[var(--panel)] text-[var(--text)] hover:bg-[var(--panel-subtle)]'
      }`}
    >
      {children}
    </button>
  );
}

/** The bar above one chapter button: full once played, filling while it plays. */
function ChapterProgress({ state, index, reducedMotion }: { state: TourState; index: number; reducedMotion: boolean }) {
  const done = index < state.chapter || state.status === 'ended';
  const current = index === state.chapter && !done;
  return (
    <span className={`relative block h-1 w-full overflow-hidden rounded-full ${current ? 'bg-[var(--text)]/25' : 'bg-[var(--border-hover)]'}`}>
      {done && <span className="absolute inset-0 bg-[var(--primary)]" />}
      {current &&
        (reducedMotion ? (
          <span className="absolute inset-0 bg-[var(--primary)]" />
        ) : (
          <span
            key={state.run}
            className="ptour-progress absolute inset-0 bg-[var(--primary)]"
            style={{
              animationDuration: `${TOUR_CHAPTERS[index].durationMs}ms`,
              animationPlayState: state.status === 'playing' ? 'running' : 'paused',
            }}
          />
        ))}
    </span>
  );
}

export default function TourPlayer() {
  const reducedMotion = useSyncExternalStore(subscribeReducedMotion, prefersReducedMotion, () => false);
  const [state, dispatch] = useReducer(reducer, initialTourState);
  const [captions, setCaptions] = useState(true);
  const [announcement, setAnnouncement] = useState('');
  const rootRef = useRef<HTMLDivElement>(null);
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

  // Start when half of the tour is on screen; pause when it scrolls away or the tab is hidden.
  useEffect(() => {
    const root = rootRef.current;
    if (!root || typeof IntersectionObserver !== 'function') return;
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
    observer.observe(root);
    document.addEventListener('visibilitychange', update);
    return () => {
      observer.disconnect();
      document.removeEventListener('visibilitychange', update);
    };
  }, []);

  const elapsedNow = () => (playing ? segment.current.base + performance.now() - segment.current.startedAt : state.elapsed);

  const announce = (index: number) => {
    const target = TOUR_CHAPTERS[index];
    setAnnouncement(`Step ${index + 1} of ${TOUR_CHAPTERS.length}: ${target.heading}. ${target.caption}`);
  };

  const goTo = (index: number) => {
    const target = Math.min(Math.max(index, 0), LAST);
    // Choosing a chapter plays it. With reduced motion it just shows it, unless the tour is already playing.
    dispatch({ type: 'go', chapter: target, play: !reducedMotion || playing });
    announce(target);
  };

  const togglePlay = () => {
    if (playing) {
      dispatch({ type: 'pause', by: 'visitor', elapsed: elapsedNow() });
    } else {
      if (state.status === 'ended') announce(0);
      dispatch({ type: 'play' });
    }
  };

  const restart = () => {
    dispatch({ type: 'restart' });
    announce(0);
  };

  const playLabel = playing ? 'Pause' : state.status === 'ended' ? 'Replay' : 'Play';
  const PlayIcon = playing ? Pause : state.status === 'ended' ? RotateCcw : Play;
  const showStart = state.status === 'idle' && reducedMotion;

  return (
    <div ref={rootRef}>
      <style>{TOUR_CSS}</style>
      <div className="overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--panel)] shadow-sm">
        <div className={`relative overflow-hidden ${TOUR_STAGE_HEIGHT}`}>
          <div aria-hidden="true" className="h-full select-none" data-ptour-paused={state.status === 'paused' ? '' : undefined}>
            <TourStage
              chapter={chapter}
              step={step}
              run={state.run}
              from={state.from === null ? null : TOUR_CHAPTERS[state.from]}
            />
          </div>

          {(showStart || state.status === 'ended') && (
            <div className="ptour-fade absolute inset-0 z-20 flex items-center justify-center bg-[var(--bg)]/80 p-4 backdrop-blur-[2px]">
              <div className="max-w-sm rounded-xl border border-[var(--border)] bg-[var(--panel)] p-5 text-center shadow-[var(--shadow)]">
                {showStart ? (
                  <>
                    <p className="text-base font-semibold text-[var(--text)]">A fortnight in SimpleHours</p>
                    <p className="mt-1 text-sm text-[var(--text)]/75">
                      {TOUR_CHAPTERS.length} steps, about {TOUR_TOTAL_SECONDS} seconds. No sound.
                    </p>
                    <div className="mt-4 flex justify-center">
                      <ControlButton label="Play the tour" onClick={togglePlay} primary>
                        <Play className="h-4 w-4" aria-hidden="true" />
                        Play the tour
                      </ControlButton>
                    </div>
                  </>
                ) : (
                  <>
                    <p className="text-base font-semibold text-[var(--text)]">From roster to payroll report, every fortnight</p>
                    <p className="mt-1 text-sm text-[var(--text)]/75">Set up your organisation once, then repeat the same steps each pay period.</p>
                    <div className="mt-4 flex flex-col justify-center gap-2 sm:flex-row">
                      <ControlButton label="Replay the tour" onClick={restart}>
                        <RotateCcw className="h-4 w-4" aria-hidden="true" />
                        Replay
                      </ControlButton>
                      <CtaLink to="/pricing">
                        Get started
                        <ArrowRight aria-hidden="true" className="h-4 w-4" />
                      </CtaLink>
                    </div>
                  </>
                )}
              </div>
            </div>
          )}
        </div>

        <div className="border-t border-[var(--border)] px-3 pt-3 pb-3 sm:px-4">
          <div aria-hidden="true" className="hidden grid-cols-7 gap-1.5 pb-1 text-[11px] font-semibold tracking-wide text-[var(--text)]/60 uppercase md:grid">
            <span className="col-span-3">Set up once</span>
            <span className="col-span-4">Every fortnight</span>
          </div>
          <ol aria-label="Tour steps" className="grid grid-cols-7 gap-1.5">
            {TOUR_CHAPTERS.map((c, i) => (
              <li key={c.id}>
                <button
                  type="button"
                  onClick={() => goTo(i)}
                  aria-current={i === state.chapter ? 'step' : undefined}
                  className={`flex min-h-8 w-full flex-col justify-center gap-1.5 rounded-md py-1 text-left lg:min-h-0 ${focusRing}`}
                >
                  <ChapterProgress state={state} index={i} reducedMotion={reducedMotion} />
                  <span
                    className={`sr-only text-xs lg:not-sr-only lg:block lg:truncate ${
                      i === state.chapter ? 'font-semibold text-[var(--text)]' : 'font-medium text-[var(--text)]/70'
                    }`}
                  >
                    <span className="sr-only">Step </span>
                    {i + 1}
                    <span className="sr-only"> of {TOUR_CHAPTERS.length}:</span>
                    <span aria-hidden="true">.</span> {c.title}
                  </span>
                </button>
              </li>
            ))}
          </ol>

          <div className="mt-3 flex flex-col gap-3 sm:flex-row sm:items-start sm:gap-5">
            <div role="group" aria-label="Tour controls" className="flex shrink-0 items-center gap-1.5">
              <ControlButton label={`${playLabel} the tour`} onClick={togglePlay} primary>
                <PlayIcon className="h-4 w-4" aria-hidden="true" />
                <span className="hidden w-12 text-left sm:inline">{playLabel}</span>
              </ControlButton>
              <ControlButton label="Restart the tour" onClick={restart}>
                <RotateCcw className="h-4 w-4" aria-hidden="true" />
              </ControlButton>
              <ControlButton label="Previous step" onClick={() => goTo(state.chapter - 1)} disabled={state.chapter === 0}>
                <ChevronLeft className="h-4 w-4" aria-hidden="true" />
              </ControlButton>
              <ControlButton label="Next step" onClick={() => goTo(state.chapter + 1)} disabled={state.chapter === LAST}>
                <ChevronRight className="h-4 w-4" aria-hidden="true" />
              </ControlButton>
              <ControlButton label="Captions" onClick={() => setCaptions(on => !on)} pressed={captions}>
                {captions ? <Captions className="h-4 w-4" aria-hidden="true" /> : <CaptionsOff className="h-4 w-4" aria-hidden="true" />}
              </ControlButton>
            </div>

            <div className={`${TOUR_CAPTION_HEIGHT} min-w-0 flex-1`}>
              <p className="text-[15px] font-semibold text-[var(--text)]">
                <span className="mr-2 font-mono text-xs font-medium text-[var(--text)]/60">
                  {state.chapter + 1}/{TOUR_CHAPTERS.length}
                </span>
                {chapter.heading}
              </p>
              {captions && <p className="mt-0.5 text-sm leading-relaxed text-[var(--text)]/75">{chapter.caption}</p>}
            </div>
          </div>
        </div>
      </div>

      <p role="status" className="sr-only">
        {announcement}
      </p>

      <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between sm:gap-6">
        <details className="text-sm">
          <summary className={`cursor-pointer rounded-sm font-medium text-[var(--text)] underline-offset-4 hover:underline ${focusRing}`}>
            Read the tour as text
          </summary>
          <TourTranscript className="mt-4 max-w-2xl" />
        </details>
        <p className="shrink-0 text-xs text-[var(--text)]/70">Example organisation: names, times and hours are made up.</p>
      </div>
    </div>
  );
}
