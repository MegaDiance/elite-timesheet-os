/**
 * The walkthrough watches the real app rather than a copy of it. Screens call `tourSignal()` when
 * the person does something a step is waiting for (opens a day, types times, adds leave…). When no
 * walkthrough is running, the event goes nowhere.
 */
export type TourSignal =
  | 'day-editor-opened'
  | 'shift-times-entered'
  | 'break-changed'
  | 'leave-line-added'
  | 'day-editor-closed';

const EVENT = 'simplehours:tour-signal';

export function tourSignal(signal: TourSignal) {
  window.dispatchEvent(new CustomEvent<TourSignal>(EVENT, { detail: signal }));
}

export function onTourSignal(handler: (signal: TourSignal) => void): () => void {
  const listener = (e: Event) => handler((e as CustomEvent<TourSignal>).detail);
  window.addEventListener(EVENT, listener);
  return () => window.removeEventListener(EVENT, listener);
}

/** Opens the walkthrough from anywhere (Help panel, dashboard, navigation). */
export const START_TOUR_EVENT = 'start-simplehours-tutorial';
export const startTour = () => window.dispatchEvent(new Event(START_TOUR_EVENT));

/** Bump when the walkthrough changes enough that everyone should see it once more. */
export const TOUR_VERSION = 2;
