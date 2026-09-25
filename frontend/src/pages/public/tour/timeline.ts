/**
 * The product tour's playback, as a pure state machine: no timers, no DOM. The player owns one
 * timer at a time (until the next beat or the end of the chapter) and reports back with `advance`.
 */

export interface TimedChapter {
  durationMs: number;
  beats: readonly number[];
}

export type TourStatus = 'idle' | 'playing' | 'paused' | 'ended';

export interface TourState {
  chapter: number;
  /** Milliseconds of the current chapter already played. */
  elapsed: number;
  status: TourStatus;
  /**
   * Who paused it. Only a pause made by the tour itself (scrolled out of view, tab hidden) ever
   * resumes on its own; a visitor's pause is always respected.
   */
  pausedBy: 'visitor' | 'auto' | null;
  /** Goes up every time a chapter starts (or restarts), so the view knows to replay its animation. */
  run: number;
  /** The chapter shown before this one, or null at the very start. */
  from: number | null;
}

export type TourAction =
  | { type: 'autoplay' }
  | { type: 'play' }
  | { type: 'pause'; by: 'visitor' | 'auto'; elapsed: number }
  | { type: 'resume' }
  | { type: 'advance'; elapsed: number }
  | { type: 'go'; chapter: number; play: boolean }
  | { type: 'restart' };

export const initialTourState: TourState = { chapter: 0, elapsed: 0, status: 'idle', pausedBy: null, run: 0, from: null };

const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max);

/** How many of a chapter's beats have happened after `elapsed` ms. */
export function stepAt(beats: readonly number[], elapsed: number): number {
  let step = 0;
  while (step < beats.length && beats[step] <= elapsed) step++;
  return step;
}

/** Milliseconds from `elapsed` until the next beat, or until the chapter ends. Never negative. */
export function nextEventDelay(chapter: TimedChapter, elapsed: number, useBeats = true): number {
  const next = useBeats ? chapter.beats.find(beat => beat > elapsed) : undefined;
  return Math.max(0, (next ?? chapter.durationMs) - elapsed);
}

/** Share of the whole tour already played, 0–1. */
export function overallProgress(chapters: readonly TimedChapter[], state: TourState): number {
  const total = chapters.reduce((sum, c) => sum + c.durationMs, 0);
  if (total <= 0) return 0;
  const before = chapters.slice(0, state.chapter).reduce((sum, c) => sum + c.durationMs, 0);
  return clamp((before + state.elapsed) / total, 0, 1);
}

export function tourReducer(chapters: readonly TimedChapter[], state: TourState, action: TourAction): TourState {
  const last = chapters.length - 1;
  const startChapter = (chapter: number, status: TourStatus, pausedBy: TourState['pausedBy'] = null): TourState => ({
    chapter: clamp(chapter, 0, last),
    elapsed: 0,
    status,
    pausedBy,
    run: state.run + 1,
    from: state.chapter,
  });

  switch (action.type) {
    case 'autoplay':
      // Only ever starts a tour nobody has touched yet.
      return state.status === 'idle' ? { ...state, status: 'playing', pausedBy: null } : state;

    case 'play':
      if (state.status === 'ended') return startChapter(0, 'playing');
      return state.status === 'playing' ? state : { ...state, status: 'playing', pausedBy: null };

    case 'pause':
      if (state.status !== 'playing') {
        // A visitor pausing a tour that is waiting to autoplay stops it from starting by itself.
        return state.status === 'idle' && action.by === 'visitor' ? { ...state, status: 'paused', pausedBy: 'visitor' } : state;
      }
      return {
        ...state,
        status: 'paused',
        pausedBy: action.by,
        elapsed: clamp(action.elapsed, 0, chapters[state.chapter].durationMs),
      };

    case 'resume':
      return state.status === 'paused' && state.pausedBy === 'auto' ? { ...state, status: 'playing', pausedBy: null } : state;

    case 'advance': {
      if (state.status !== 'playing') return state;
      const current = chapters[state.chapter];
      if (action.elapsed < current.durationMs) return { ...state, elapsed: Math.max(state.elapsed, action.elapsed) };
      if (state.chapter >= last) return { ...state, elapsed: current.durationMs, status: 'ended', pausedBy: null };
      return startChapter(state.chapter + 1, 'playing');
    }

    case 'go':
      return startChapter(action.chapter, action.play ? 'playing' : 'paused', action.play ? null : 'visitor');

    case 'restart':
      return startChapter(0, 'playing');
  }
}
