import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { CheckCircle2, X } from 'lucide-react';
import api from '../../services/apiClient';
import { useAccess } from '../../hooks/useAccess';
import { TimesheetStatusBadge, TIMESHEET_STATE, type TimesheetState } from '../TimesheetStatus';
import { EMPLOYEE_TIMESHEET_STEP, EMPLOYEE_TOUR, MANAGER_TOUR, type TourStep } from './tourSteps';
import { START_TOUR_EVENT, TOUR_VERSION, onTourSignal } from './tourSignals';

const LOCAL_KEY = 'simplehours_tour_version';
const CARD_WIDTH = 340;
const GAP = 12;

interface Rect { top: number; left: number; width: number; height: number }

function findTarget(name?: string): HTMLElement | null {
  if (!name) return null;
  const nodes = Array.from(document.querySelectorAll<HTMLElement>(`[data-tour="${name}"]`));
  // The first one that is actually on screen (a hidden desktop copy on phones doesn't count).
  return nodes.find(n => n.offsetParent !== null && n.getBoundingClientRect().width > 0) ?? null;
}

const rectOf = (el: HTMLElement): Rect => {
  const r = el.getBoundingClientRect();
  return { top: r.top, left: r.left, width: r.width, height: r.height };
};

/**
 * A short, interactive walkthrough of the real app. It highlights the actual control, explains it
 * in a small card beside it, and — where it makes sense — waits for the person to do the thing
 * (open a day, type times, add leave), confirms it, and moves on. Nothing is faked or pre-filled:
 * whatever they enter is a normal, unsaved change they can keep or cancel.
 *
 * Shown once per person (stored on their account), and available again from Help.
 */
export default function GuidedTour() {
  const { access } = useAccess();
  const navigate = useNavigate();
  const location = useLocation();
  const [running, setRunning] = useState(false);
  const [index, setIndex] = useState(0);
  const [done, setDone] = useState(false);
  const [rect, setRect] = useState<Rect | null>(null);
  const [isPhone, setIsPhone] = useState(() => window.matchMedia('(max-width: 639px)').matches);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const cardRef = useRef<HTMLElement>(null);

  const steps: TourStep[] = useMemo(() => {
    if (!access) return [];
    if (access.role !== 'EMPLOYEE') return MANAGER_TOUR;
    const withTimesheet = access.employee_capabilities?.can_submit_timesheets;
    return withTimesheet ? [EMPLOYEE_TOUR[0], EMPLOYEE_TOUR[1], EMPLOYEE_TIMESHEET_STEP, ...EMPLOYEE_TOUR.slice(2)] : EMPLOYEE_TOUR;
  }, [access]);
  const step = running ? steps[index] : undefined;

  const start = useCallback(() => {
    setIndex(0);
    setDone(false);
    setRunning(true);
  }, []);

  const finish = useCallback(() => {
    setRunning(false);
    try { localStorage.setItem(LOCAL_KEY, String(TOUR_VERSION)); } catch { /* storage may be unavailable */ }
    // Remembered on the account so it isn't shown again on another device. Best effort.
    api.put('/auth/me/tutorial', { version: TOUR_VERSION }).catch(() => undefined);
  }, []);

  const goTo = useCallback((next: number) => {
    if (next >= steps.length) { finish(); return; }
    setDone(false);
    setIndex(Math.max(0, next));
  }, [steps.length, finish]);

  // Start on request (Help, dashboard), or once for someone who has never finished this version.
  useEffect(() => {
    window.addEventListener(START_TOUR_EVENT, start);
    return () => window.removeEventListener(START_TOUR_EVENT, start);
  }, [start]);

  useEffect(() => {
    if (!access || running) return;
    let seenLocally = 0;
    try { seenLocally = Number(localStorage.getItem(LOCAL_KEY) || 0); } catch { /* ignore */ }
    const seen = Math.max(seenLocally, access.user.tutorial_version ?? 0);
    const onHome = location.pathname === '/dashboard' || location.pathname === '/my/schedule';
    if (seen >= TOUR_VERSION || !onHome) return;
    const timer = setTimeout(start, 900);
    return () => clearTimeout(timer);
    // Only decided once per sign-in, on the home page.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [access?.user.id]);

  // Open the page a step belongs to.
  useEffect(() => {
    if (step?.route && location.pathname !== step.route) navigate(step.route);
  }, [step, location.pathname, navigate]);

  // Follow the highlighted element as the page scrolls, resizes or re-renders.
  useLayoutEffect(() => {
    if (!step) return;
    let scrolled = false;
    const update = () => {
      const el = findTarget(step.target);
      if (el && !scrolled) {
        el.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'smooth' });
        scrolled = true;
      }
      setRect(el ? rectOf(el) : null);
      setIsPhone(window.matchMedia('(max-width: 639px)').matches);
    };
    update();
    const timer = window.setInterval(update, 250);
    window.addEventListener('resize', update);
    window.addEventListener('scroll', update, true);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener('resize', update);
      window.removeEventListener('scroll', update, true);
    };
  }, [step]);

  // Steps that wait for the person to act finish themselves, with a moment of "Done".
  useEffect(() => {
    if (!step?.waitFor) return;
    return onTourSignal(signal => {
      if (signal !== step.waitFor) return;
      setDone(true);
      window.setTimeout(() => goTo(index + 1), 900);
    });
  }, [step, index, goTo]);

  // Move keyboard focus to the card, unless a dialog (e.g. the day editor) is holding it.
  useEffect(() => {
    if (!step) return;
    if (!document.querySelector('[aria-modal="true"]')) headingRef.current?.focus();
  }, [step]);

  useEffect(() => {
    if (!running) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !document.querySelector('[aria-modal="true"]')) finish(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [running, finish]);

  if (!step) return null;

  const hasTarget = Boolean(rect);
  const body = !hasTarget && step.fallback ? [step.fallback] : step.body;

  // Card placement: beside, below or above the highlighted element — wherever it fits without
  // covering it; failing that, the corner furthest from it. On phones, docked above the nav bar.
  let cardStyle: CSSProperties;
  const cardHeight = cardRef.current?.offsetHeight ?? 260;
  if (isPhone) {
    const docked = { left: 8, right: 8, bottom: 'calc(64px + env(safe-area-inset-bottom))' } as CSSProperties;
    // If the element itself sits where the card would go, dock at the top instead.
    cardStyle = rect && rect.top + rect.height > window.innerHeight - cardHeight - 72 ? { left: 8, right: 8, top: 64 } : docked;
  } else if (!rect) {
    cardStyle = { left: '50%', bottom: 24, transform: 'translateX(-50%)', width: CARD_WIDTH };
  } else {
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const clampTop = (y: number) => Math.min(Math.max(8, y), vh - cardHeight - 8);
    const clampLeft = (x: number) => Math.min(Math.max(8, x), vw - CARD_WIDTH - 8);
    const spots: Array<[boolean, CSSProperties]> = [
      [rect.left + rect.width + GAP + CARD_WIDTH < vw - 8, { top: clampTop(rect.top), left: rect.left + rect.width + GAP, width: CARD_WIDTH }],
      [rect.left - GAP - CARD_WIDTH > 8, { top: clampTop(rect.top), left: rect.left - GAP - CARD_WIDTH, width: CARD_WIDTH }],
      [rect.top + rect.height + GAP + cardHeight < vh - 8, { top: rect.top + rect.height + GAP, left: clampLeft(rect.left), width: CARD_WIDTH }],
      [rect.top - GAP - cardHeight > 8, { top: rect.top - GAP - cardHeight, left: clampLeft(rect.left), width: CARD_WIDTH }],
    ];
    const fit = spots.find(([ok]) => ok);
    const centreX = rect.left + rect.width / 2;
    const centreY = rect.top + rect.height / 2;
    cardStyle = fit ? fit[1] : {
      width: CARD_WIDTH,
      ...(centreY > vh / 2 ? { top: 16 } : { bottom: 16 }),
      ...(centreX > vw / 2 ? { left: 16 } : { right: 16 }),
    };
  }

  return (
    <>
      {/* The highlight: a ring around the real element, the rest of the screen dimmed. Clicks pass
          straight through to the app, so the person can do the step themselves. */}
      {rect && (
        <div
          aria-hidden="true"
          className="fixed z-[60] pointer-events-none rounded-lg ring-2 ring-[var(--primary)] transition-all duration-200"
          style={{
            top: rect.top - 4, left: rect.left - 4, width: rect.width + 8, height: rect.height + 8,
            boxShadow: '0 0 0 9999px rgba(8, 10, 20, 0.45)',
          }}
        />
      )}

      <section
        role="dialog"
        aria-modal="false"
        aria-labelledby="tour-title"
        data-tour-card
        ref={cardRef}
        className="fixed z-[61] rounded-xl bg-[var(--panel)] text-[var(--text)] border border-[var(--border)] shadow-2xl p-4 space-y-3"
        style={cardStyle}
      >
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-[11px] font-semibold text-[var(--muted)]">Step {index + 1} of {steps.length}</p>
            <h2 id="tour-title" ref={headingRef} tabIndex={-1} className="text-base font-bold outline-none">{step.title}</h2>
          </div>
          <button type="button" onClick={finish} className="p-2 -m-1 rounded-md text-[var(--muted)] hover:text-[var(--text)]" aria-label="End the tour">
            <X className="w-4 h-4" aria-hidden="true" />
          </button>
        </div>

        <div className="space-y-2 text-sm leading-relaxed" aria-live="polite">
          {body.map(line => <p key={line}>{line}</p>)}
        </div>

        {step.example && (
          <ul className="rounded-lg border border-[var(--border)] divide-y divide-[var(--border)] text-sm">
            {step.example.map(line => (
              <li key={line.time} className="flex items-center justify-between gap-2 px-3 py-1.5">
                <span className="font-mono text-xs">{line.time}</span>
                <span className={`text-xs font-semibold ${line.tone === 'leave' ? 'text-[var(--warn)]' : 'text-[var(--success)]'}`}>{line.kind}</span>
              </li>
            ))}
          </ul>
        )}

        {step.statusGuide && (
          <ol className="space-y-1.5" aria-label="Timesheet status, in order">
            {(Object.keys(TIMESHEET_STATE) as TimesheetState[]).map(s => (
              <li key={s} className="flex items-start gap-2 text-xs">
                <span className="shrink-0 w-20"><TimesheetStatusBadge status={s} /></span>
                <span className="text-[var(--muted)]">{access?.role === 'EMPLOYEE' ? TIMESHEET_STATE[s].employeeMeaning : TIMESHEET_STATE[s].meaning}</span>
              </li>
            ))}
          </ol>
        )}

        {step.waitFor && hasTarget && (
          done ? (
            <p className="flex items-center gap-2 text-sm font-semibold text-[var(--success)]" role="status">
              <CheckCircle2 className="w-4 h-4" aria-hidden="true" /> Done
            </p>
          ) : (
            <p className="text-sm font-semibold text-[var(--primary-text)]">Try it: {step.doThis}</p>
          )
        )}

        <div className="flex items-center justify-between gap-2 pt-1">
          <button
            type="button"
            onClick={() => goTo(index - 1)}
            disabled={index === 0}
            className="h-10 px-3 rounded-lg text-sm font-medium text-[var(--muted)] hover:text-[var(--text)] disabled:invisible"
          >
            Back
          </button>
          <div className="flex items-center gap-1" aria-hidden="true">
            {steps.map((s, i) => <span key={s.id} className={`h-1.5 rounded-full ${i === index ? 'w-4 bg-[var(--primary)]' : 'w-1.5 bg-[var(--border-hover)]'}`} />)}
          </div>
          <button
            type="button"
            onClick={() => goTo(index + 1)}
            className={`h-10 px-4 rounded-lg text-sm font-semibold ${step.waitFor && hasTarget && !done
              ? 'text-[var(--muted)] hover:text-[var(--text)]'
              : 'bg-[var(--primary)] text-white hover:bg-[var(--primary-h)]'}`}
          >
            {index === steps.length - 1 ? 'Finish' : step.waitFor && hasTarget && !done ? 'Skip' : 'Next'}
          </button>
        </div>
      </section>
    </>
  );
}
