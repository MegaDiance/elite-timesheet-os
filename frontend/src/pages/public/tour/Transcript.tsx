import { TOUR_CHAPTERS } from './chapters';

/** The whole tour as text: the transcript under the player, and what shows if the player can't load. */
export function TourTranscript({ className = '' }: { className?: string }) {
  return (
    <ol className={`space-y-4 ${className}`}>
      {TOUR_CHAPTERS.map((chapter, i) => (
        <li key={chapter.id} className="flex gap-3">
          <span
            aria-hidden="true"
            className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-[var(--border-hover)] font-mono text-xs font-semibold text-[var(--text)]"
          >
            {i + 1}
          </span>
          <div>
            <p className="text-[15px] font-semibold text-[var(--text)]">{chapter.heading}</p>
            <p className="mt-0.5 text-[15px] leading-relaxed text-[var(--text)]/75">{chapter.caption}</p>
          </div>
        </li>
      ))}
    </ol>
  );
}
