import { TOUR_CAPTION_HEIGHT, TOUR_CHAPTERS } from './chapters';

/**
 * The caption strip along the bottom of the tour stage: the step's heading and one or two sentences,
 * with a quiet "3 of 7" marker. Shared by the player and the placeholder shown while it loads, so
 * both take the same space. Purely visual: the player announces the same words in a status message.
 */

/** "3 of 7" and a dot per step. Only shows where you are; it is not a control. */
function StepMarker({ index }: { index: number }) {
  return (
    <span className="flex shrink-0 items-center gap-2.5 pt-0.5">
      <span className="hidden items-center gap-1 sm:flex">
        {TOUR_CHAPTERS.map((chapter, i) => (
          <span
            key={chapter.id}
            className={`h-1.5 rounded-full ${i === index ? 'w-4 bg-[var(--primary)]' : i < index ? 'w-1.5 bg-[var(--primary)]/45' : 'w-1.5 bg-[var(--border-hover)]'}`}
          />
        ))}
      </span>
      <span className="font-mono text-xs font-medium whitespace-nowrap text-[var(--text)]/70 tabular-nums">
        {index + 1} of {TOUR_CHAPTERS.length}
      </span>
    </span>
  );
}

export function TourCaption({ index, animate = false }: { index: number; animate?: boolean }) {
  const chapter = TOUR_CHAPTERS[index];
  return (
    <div aria-hidden="true" className={`${TOUR_CAPTION_HEIGHT} border-t border-[var(--border)] bg-[var(--panel)] px-3.5 py-3 select-none sm:px-5`}>
      <div key={chapter.id} className={animate ? 'ptour-fade' : undefined}>
        <div className="flex items-start justify-between gap-3">
          <p className="text-sm font-semibold text-[var(--text)] sm:text-[15px]">{chapter.heading}</p>
          <StepMarker index={index} />
        </div>
        <p className="mt-0.5 text-[13px] leading-snug text-[var(--text)]/80 sm:text-sm sm:leading-relaxed">{chapter.caption}</p>
      </div>
    </div>
  );
}

/** The single quiet line under the stage: the text version's link, and the note about the example. */
export const TOUR_FOOTNOTE_ROW = 'mt-3 flex flex-wrap items-start justify-between gap-x-6 gap-y-1 text-xs text-[var(--text)]/70';
