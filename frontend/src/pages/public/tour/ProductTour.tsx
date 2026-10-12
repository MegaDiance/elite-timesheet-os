import { Component, Suspense, lazy, useEffect, useRef, useState, type ReactNode, type RefObject } from 'react';
import { Point, SectionIntro } from '../ui';
import { TOUR_CHAPTERS, TOUR_STAGE_HEIGHT, TOUR_TOTAL_SECONDS } from './chapters';
import { loadTourPlayer } from './loadPlayer';
import { TOUR_FOOTNOTE_ROW, TourCaption } from './TourCaption';
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
  return (
    <div>
      <div className="overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--panel)] shadow-sm">
        <div className={`${TOUR_STAGE_HEIGHT} bg-[var(--bg)]`} />
        <TourCaption index={0} />
      </div>
      <div className={TOUR_FOOTNOTE_ROW}>
        <p className="font-medium text-[var(--text)]/80 underline underline-offset-4">Read the tour as text</p>
        <p>Example organisation: names, times and hours are made up.</p>
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
              Set up once, then every fortnight follows the same steps, from roster to payroll report.
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
              Staff, rosters and timesheets for every branch in one system, with each Manager limited to their own branches.
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
