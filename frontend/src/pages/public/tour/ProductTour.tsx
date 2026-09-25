import { Component, Suspense, lazy, useEffect, useRef, useState, type ReactNode, type RefObject } from 'react';
import { Point, SectionIntro } from '../ui';
import { TOUR_CAPTION_HEIGHT, TOUR_CHAPTERS, TOUR_STAGE_HEIGHT, TOUR_TOTAL_SECONDS } from './chapters';
import { loadTourPlayer } from './loadPlayer';
import { TourTranscript } from './Transcript';

/**
 * "How it works" on the homepage: a short product tour, then why it beats a spreadsheet.
 * The section itself is light; the animated player is fetched only as the section nears the screen.
 * If the player can't load, the tour is shown as text instead.
 */

const TourPlayer = lazy(loadTourPlayer);

const container = 'mx-auto max-w-7xl px-4 sm:px-6 lg:px-8';

/** True once the element is within `margin` of the viewport (or straight away without IntersectionObserver). */
function useNearViewport(ref: RefObject<HTMLElement | null>, margin: string) {
  const [near, setNear] = useState(() => typeof IntersectionObserver !== 'function');
  useEffect(() => {
    const element = ref.current;
    if (near || !element) return;
    const observer = new IntersectionObserver(
      entries => {
        if (entries.some(entry => entry.isIntersecting)) {
          setNear(true);
          observer.disconnect();
        }
      },
      { rootMargin: `${margin} 0px` },
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, [ref, margin, near]);
  return near;
}

/** Shows `fallback` instead of its children if they fail to render (e.g. the player chunk can't be fetched). */
class TourBoundary extends Component<{ fallback: ReactNode; children: ReactNode }, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}

/** Same frame and height as the player, so nothing moves when it arrives. */
function TourPlaceholder() {
  const first = TOUR_CHAPTERS[0];
  return (
    <div className="overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--panel)] shadow-sm">
      <div className={`${TOUR_STAGE_HEIGHT} bg-[var(--bg)]`} />
      <div className="border-t border-[var(--border)] px-3 pt-3 pb-3 sm:px-4">
        <div aria-hidden="true" className="hidden grid-cols-7 gap-1.5 pb-1 text-[11px] font-semibold tracking-wide text-[var(--text)]/60 uppercase md:grid">
          <span className="col-span-3">Set up once</span>
          <span className="col-span-4">Every fortnight</span>
        </div>
        <ol className="grid grid-cols-7 gap-1.5">
          {TOUR_CHAPTERS.map((chapter, i) => (
            <li key={chapter.id} className="flex min-h-8 flex-col justify-center gap-1.5 py-1 lg:min-h-0">
              <span className="block h-1 rounded-full bg-[var(--border-hover)]" />
              <span className="sr-only text-xs font-medium text-[var(--text)]/70 lg:not-sr-only lg:block lg:truncate">
                {i + 1}. {chapter.title}
              </span>
            </li>
          ))}
        </ol>
        <div className="mt-3 flex flex-col gap-3 sm:flex-row sm:items-start sm:gap-5">
          {/* Where the player's buttons go. */}
          <div className="h-10 w-64 shrink-0 sm:h-9" />
          <div className={`${TOUR_CAPTION_HEIGHT} min-w-0 flex-1`}>
            <p className="text-[15px] font-semibold text-[var(--text)]">{first.heading}</p>
            <p className="mt-0.5 text-sm leading-relaxed text-[var(--text)]/75">{first.caption}</p>
          </div>
        </div>
      </div>
    </div>
  );
}

function TourUnavailable() {
  return (
    <div className="rounded-xl border border-[var(--border)] bg-[var(--bg)] p-5 sm:p-8">
      <p className="text-sm font-semibold text-[var(--text)]">The animated tour couldn’t load, so here it is as text.</p>
      <TourTranscript className="mt-5 max-w-2xl" />
    </div>
  );
}

export function ProductTour() {
  const slot = useRef<HTMLDivElement>(null);
  const near = useNearViewport(slot, '400px');

  return (
    <section id="how-it-works" aria-labelledby="how-title" className="scroll-mt-16 border-t border-[var(--border)] bg-[var(--panel)]">
      <div className={`${container} py-16 sm:py-24`}>
        <div className="grid gap-6 lg:grid-cols-12 lg:items-end lg:gap-16">
          <SectionIntro id="how-title" eyebrow="Product tour" title="How it works" className="lg:col-span-7">
            <p>
              Instead of a spreadsheet for every branch, each step has its own place. Set up once, then every fortnight follows
              the same steps, from roster to payroll report.
            </p>
          </SectionIntro>
          <p className="text-sm text-[var(--text)]/70 lg:col-span-5 lg:text-right">
            {TOUR_CHAPTERS.length} steps · about {TOUR_TOTAL_SECONDS} seconds · no sound
          </p>
        </div>

        <div ref={slot} className="mt-10">
          {near ? (
            <TourBoundary fallback={<TourUnavailable />}>
              <Suspense fallback={<TourPlaceholder />}>
                <TourPlayer />
              </Suspense>
            </TourBoundary>
          ) : (
            <TourPlaceholder />
          )}
        </div>

        <div className="mt-14 grid gap-8 border-t border-[var(--border)] pt-10 lg:grid-cols-12 lg:gap-16">
          <h3 className="text-xl font-semibold tracking-tight text-[var(--text)] lg:col-span-4">Why use it instead of a spreadsheet</h3>
          <ul className="grid gap-6 text-[15px] leading-relaxed md:grid-cols-3 lg:col-span-8">
            <Point title="One place for every branch">
              Workers, rosters and timesheets for every branch live in one system, with each Branch Admin limited to their own.
            </Point>
            <Point title="Differences you can see">
              Worked hours sit beside the roster, so a late finish or an afternoon of sick leave shows up before payroll.
            </Point>
            <Point title="Hours that stay put">
              Approved timesheets and a locked pay period mean the report you export is the one that was checked.
            </Point>
          </ul>
        </div>
      </div>
    </section>
  );
}
