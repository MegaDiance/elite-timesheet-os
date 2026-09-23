import { useState, useRef, useEffect, type FormEvent } from 'react';
import { X, Send, Bot, User, ArrowRight, ChevronDown } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { ROLE_LABEL, useAccess, type Permission } from '../hooks/useAccess';

interface ChatAction {
  label: string;
  path?: string;
  permission?: Permission;
  triggerTutorial?: boolean;
}

interface ChatMessage {
  id: string;
  sender: 'bot' | 'user';
  text: string;
  action?: ChatAction;
}

interface Topic {
  /** Matched against the lower-cased question. */
  match: RegExp;
  owner: string;
  branchAdmin: string;
  action?: ChatAction;
}

const TOPICS: Topic[] = [
  {
    match: /tutorial|tour|walkthrough/,
    owner: 'Starting the one-minute tour of SimpleHours.',
    branchAdmin: 'Starting the one-minute tour of SimpleHours.',
    action: { label: 'Start the tour', triggerTutorial: true },
  },
  {
    match: /branch admin|invit|access|assign/,
    owner:
      'Invite a Branch Admin from the Branch Admins page: enter their email and choose the branches they look after. They get an email invitation and, once they accept, sign in with your organisation’s sign-in link. You can change their branches or remove their access at any time.',
    branchAdmin:
      'The Organisation Owner decides who is a Branch Admin and which branches they look after. Ask the owner if you need access to another branch.',
    action: { label: 'Open Branch Admins', path: '/branch-admins', permission: 'branch_admins.manage' },
  },
  {
    match: /\block|unlock/,
    owner:
      'Locks are set per branch for each fortnight. A roster lock stops changes to rostered shifts (worked hours can still be entered). A timesheet lock stops all timesheet changes. To lock or unlock, enter your own password or the organisation lock password for that lock. You can set the lock passwords in Settings.',
    branchAdmin:
      'Locks are set per branch for each fortnight. A roster lock stops changes to rostered shifts (worked hours can still be entered). A timesheet lock stops all timesheet changes. To lock or unlock, enter your own password or the organisation lock password the owner gave you.',
    action: { label: 'Go to the Roster', path: '/roster', permission: 'rosters.manage' },
  },
  {
    match: /segment|split|roster|shift|schedule|template|copy/,
    owner:
      'Plan each fortnight on the Roster. A day is a list of segments: use “+ Add segment” for a split shift or part-day leave (for example Normal Work 08:00–12:00 and Annual Leave 13:00–16:00). Segments can’t overlap, and an end time earlier than the start is an overnight shift. You can copy a day to other days or workers, or auto-roster from each worker’s template.',
    branchAdmin:
      'Plan each fortnight for your branches on the Roster. A day is a list of segments: use “+ Add segment” for a split shift or part-day leave (for example Normal Work 08:00–12:00 and Annual Leave 13:00–16:00). Segments can’t overlap, and an end time earlier than the start is an overnight shift. You can copy a day to other days or workers, or auto-roster from each worker’s template.',
    action: { label: 'Go to the Roster', path: '/roster', permission: 'rosters.manage' },
  },
  {
    match: /timesheet|approv|reopen|worked|actual|hours/,
    owner:
      'On Timesheets, record the hours actually worked for each segment; the roster stays as planned. When a worker’s fortnight is right, select Approve (you can approve several at once). Approved timesheets can’t be edited: select Reopen to correct one, then approve it again.',
    branchAdmin:
      'On Timesheets, record the hours actually worked for each segment; the roster stays as planned. When a worker’s fortnight is right, select Approve (you can approve several at once). Approved timesheets can’t be edited: select Reopen to correct one, then approve it again.',
    action: { label: 'Go to Timesheets', path: '/timesheets', permission: 'timesheets.manage' },
  },
  {
    match: /break|lunch|meal/,
    owner:
      'Your organisation’s unpaid break (set in Settings, with separate weekday and weekend lengths) is taken once per day when the day’s segments add up to at least the break threshold and the gaps between them are shorter than the break. It comes off the longest Normal Work segment. SimpleHours calculates this for you.',
    branchAdmin:
      'The organisation’s unpaid break (set by the Organisation Owner, with separate weekday and weekend lengths) is taken once per day when the day’s segments add up to at least the break threshold and the gaps between them are shorter than the break. It comes off the longest Normal Work segment. SimpleHours calculates this for you.',
  },
  {
    match: /leave|sick|annual|\btil\b|lwip|holiday/,
    owner:
      'Leave is recorded as a segment on the day: Sick Leave, Annual Leave, TIL, LWIP (leave without pay) or Other. Add it on the Roster or Timesheets with “+ Add segment”. You set the organisation’s public holidays, and they’re counted separately in reports.',
    branchAdmin:
      'Leave is recorded as a segment on the day: Sick Leave, Annual Leave, TIL, LWIP (leave without pay) or Other. Add it on the Roster or Timesheets with “+ Add segment”.',
    action: { label: 'Go to the Roster', path: '/roster', permission: 'rosters.manage' },
  },
  {
    match: /report|payroll|export|csv|pdf/,
    owner:
      'Reports totals each worker’s fortnight by category: normal, Saturday, Sunday and public holiday hours, Sick Leave, Annual Leave, TIL, LWIP, Other and unplanned hours, next to rostered, worked and contracted hours. Export it as CSV or PDF for payroll.',
    branchAdmin:
      'Reports totals each worker’s fortnight for your branches by category: normal, Saturday, Sunday and public holiday hours, Sick Leave, Annual Leave, TIL, LWIP, Other and unplanned hours. Export it as CSV or PDF for payroll.',
    action: { label: 'Open Reports', path: '/reports', permission: 'reports.view' },
  },
  {
    match: /worker|people|team member|department|contract/,
    owner:
      'Workers are the people you roster and pay. Use Portal access on the Workers page if you want one to see their own schedule. Add them on the Workers page with their branch, department and contracted hours, and give them a fortnight template to speed up rostering.',
    branchAdmin:
      'Workers are the people you roster and pay. Use Portal access on the Workers page if you want one to see their own schedule. Add them to one of your branches on the Workers page with their department and contracted hours, and give them a fortnight template to speed up rostering.',
    action: { label: 'Open Workers', path: '/workers', permission: 'workers.manage' },
  },
  {
    match: /branch|location|site/,
    owner:
      'Create, rename, deactivate and reactivate branches on the Branches page. Each branch has its own address and timezone, and its own roster and timesheet locks. The last active branch can’t be deactivated.',
    branchAdmin:
      'The Branches page shows the branches you look after. Only the Organisation Owner can add or change branches.',
    action: { label: 'Open Branches', path: '/branches', permission: 'branch.view' },
  },
  {
    match: /password|sign in|sign-in|login|log in|2fa|two-step|two factor|security|session/,
    owner:
      'Change your password, turn on two-step verification and see where you’re signed in from Settings. You’re signed out after 15 minutes without activity.',
    branchAdmin:
      'Change your password, turn on two-step verification and see where you’re signed in from Settings. You’re signed out after 15 minutes without activity.',
    action: { label: 'Open Settings', path: '/settings' },
  },
  {
    match: /audit|history|\blogs?\b/,
    owner: 'The Audit Log records sign-ins, approvals, lock changes and other edits, with who made them and when.',
    branchAdmin: 'The Audit Log is available to the Organisation Owner.',
    action: { label: 'Open the Audit Log', path: '/audit', permission: 'audit.view' },
  },
  {
    match: /chat|notice|announce|message/,
    owner: 'Team Chat is where you and your Branch Admins post updates, react and reply.',
    branchAdmin: 'Team Chat is where the Organisation Owner and Branch Admins post updates, react and reply.',
    action: { label: 'Open Team Chat', path: '/announcements' },
  },
];

const HELP_TEXT = {
  owner:
    'Try asking about:\n• "segments" – split shifts and part-day leave\n• "timesheets" – recording, approving and reopening\n• "locks" – per-branch roster and timesheet locks\n• "breaks" – how the unpaid break is worked out\n• "workers" and "branches"\n• "branch admins" – inviting and assigning\n• "reports" – payroll hours and exports\n• "tour" – the one-minute walkthrough',
  branchAdmin:
    'Try asking about:\n• "segments" – split shifts and part-day leave\n• "timesheets" – recording, approving and reopening\n• "locks" – per-branch roster and timesheet locks\n• "breaks" – how the unpaid break is worked out\n• "workers" – adding workers to your branches\n• "reports" – payroll hours and exports\n• "tour" – the one-minute walkthrough',
};

export default function HelpChatbot() {
  const navigate = useNavigate();
  const { access, isOwner, can } = useAccess();
  const [isOpen, setIsOpen] = useState(false);
  const [input, setInput] = useState('');
  const [isMinimized, setIsMinimized] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const [messages, setMessages] = useState<ChatMessage[]>(() => [
    {
      id: 'welcome',
      sender: 'bot',
      text: isOwner
        ? 'Hi! I can help with branches, Branch Admins, rosters, timesheets, locks and payroll reports. Type "help" or pick a topic below.'
        : 'Hi! I can help with rosters, timesheets, locks, workers and payroll reports for your branches. Type "help" or pick a topic below.',
    },
  ]);

  const chips = isOwner
    ? [
        { label: 'Invite a Branch Admin', query: 'branch admin' },
        { label: 'Add segments', query: 'segments' },
        { label: 'Approve timesheets', query: 'approve timesheets' },
        { label: 'Lock a fortnight', query: 'lock' },
        { label: 'Payroll report', query: 'report' },
        { label: 'Start the tour', query: 'tour' },
      ]
    : [
        { label: 'Add segments', query: 'segments' },
        { label: 'Approve timesheets', query: 'approve timesheets' },
        { label: 'Lock a fortnight', query: 'lock' },
        { label: 'Add a worker', query: 'workers' },
        { label: 'Payroll report', query: 'report' },
        { label: 'Start the tour', query: 'tour' },
      ];

  useEffect(() => {
    if (isOpen && !isMinimized) messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isOpen, isMinimized]);

  const processQuery = (rawQuery: string) => {
    const q = rawQuery.trim().toLowerCase();
    const now = Date.now();
    const userMsg: ChatMessage = { id: `${now}-q`, sender: 'user', text: rawQuery };
    const reply: ChatMessage = { id: `${now}-a`, sender: 'bot', text: '' };

    if (q === 'help' || q === '?' || q === 'commands') {
      reply.text = isOwner ? HELP_TEXT.owner : HELP_TEXT.branchAdmin;
    } else {
      const topic = TOPICS.find(t => t.match.test(q));
      if (topic) {
        reply.text = isOwner ? topic.owner : topic.branchAdmin;
        // Only offer a shortcut to a page this account can open.
        if (topic.action && (!topic.action.permission || can(topic.action.permission))) reply.action = topic.action;
      } else {
        reply.text = 'Sorry, I didn’t catch that. Try "segments", "timesheets", "locks", "breaks", "workers" or "reports", or type "help".';
      }
    }

    setMessages(prev => [...prev, userMsg, reply]);
    setInput('');
  };

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (input.trim()) processQuery(input);
  };

  const handleActionClick = (action: ChatAction) => {
    if (action.triggerTutorial) {
      window.dispatchEvent(new Event('start-simplehours-tutorial'));
    } else if (action.path) {
      navigate(action.path);
    }
    setIsOpen(false);
  };

  return (
    <>
      {!isOpen && (
        <button
          onClick={() => {
            setIsOpen(true);
            setIsMinimized(false);
          }}
          className="fixed bottom-20 sm:bottom-6 right-5 sm:right-6 z-40 p-3 rounded-full bg-[var(--primary)] text-white shadow-xl hover:bg-[var(--primary-h)] hover:scale-105 active:scale-95 transition-all duration-200 flex items-center gap-2 group"
          title="SimpleHours help assistant"
          aria-label="Open the SimpleHours help assistant"
        >
          <Bot className="w-5 h-5 transition-transform group-hover:rotate-12" />
          <span className="hidden sm:inline-block text-xs font-bold pr-1">Need help?</span>
          <span className="absolute -top-1 -right-1 w-3 h-3 rounded-full bg-emerald-400 ring-2 ring-[var(--panel)]"></span>
        </button>
      )}

      {isOpen && (
        <div
          className={`fixed bottom-20 sm:bottom-6 right-4 sm:right-6 z-50 w-[calc(100vw-32px)] sm:w-96 bg-[var(--panel)] border border-[var(--border)] rounded-2xl shadow-2xl overflow-hidden flex flex-col transition-all duration-200 animate-in fade-in slide-in-from-bottom-4 ${
            isMinimized ? 'h-14' : 'h-[500px] max-h-[75vh]'
          }`}
          role="dialog"
          aria-label="SimpleHours help assistant"
        >
          <div className="px-4 py-3 bg-[var(--sidebar-bg)] text-white border-b border-white/10 flex items-center justify-between shrink-0 select-none">
            <div className="flex items-center gap-2.5">
              <div className="w-7 h-7 rounded-lg bg-[var(--primary)] flex items-center justify-center text-white">
                <Bot className="w-4 h-4" />
              </div>
              <div>
                <div className="font-bold text-xs flex items-center gap-1.5">
                  <span>SimpleHours Assistant</span>
                  {access && (
                    <span className="px-1.5 rounded text-[9px] font-semibold bg-white/10 text-emerald-300">{ROLE_LABEL[access.role]}</span>
                  )}
                </div>
                <div className="text-[10px] text-white/60">Quick answers and shortcuts</div>
              </div>
            </div>

            <div className="flex items-center gap-1">
              <button
                onClick={() => setIsMinimized(!isMinimized)}
                className="p-1 rounded text-white/70 hover:text-white hover:bg-white/10 transition-colors"
                title={isMinimized ? 'Expand' : 'Minimise'}
              >
                <ChevronDown className={`w-4 h-4 transition-transform ${isMinimized ? 'rotate-180' : ''}`} />
              </button>
              <button
                onClick={() => setIsOpen(false)}
                className="p-1 rounded text-white/70 hover:text-white hover:bg-white/10 transition-colors"
                title="Close assistant"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>

          {!isMinimized && (
            <>
              <div className="flex-1 p-4 overflow-y-auto space-y-3 bg-[var(--panel)] text-xs">
                {messages.map(msg => (
                  <div key={msg.id} className={`flex items-start gap-2.5 ${msg.sender === 'user' ? 'flex-row-reverse' : ''}`}>
                    <div
                      className={`w-6 h-6 rounded-full flex items-center justify-center shrink-0 text-xs font-bold ${
                        msg.sender === 'user'
                          ? 'bg-[var(--primary)] text-white'
                          : 'bg-[var(--panel-subtle)] border border-[var(--border)] text-[var(--primary)]'
                      }`}
                    >
                      {msg.sender === 'user' ? <User className="w-3.5 h-3.5" /> : <Bot className="w-3.5 h-3.5" />}
                    </div>

                    <div
                      className={`max-w-[82%] rounded-2xl px-3.5 py-2.5 leading-relaxed whitespace-pre-line text-xs ${
                        msg.sender === 'user'
                          ? 'bg-[var(--primary)] text-white rounded-tr-xs font-medium'
                          : 'bg-[var(--panel-subtle)] border border-[var(--border)] text-[var(--text)] rounded-tl-xs'
                      }`}
                    >
                      {msg.text}

                      {msg.action && (
                        <div className="mt-2.5 pt-2 border-t border-[var(--border)]/50">
                          <button
                            type="button"
                            onClick={() => handleActionClick(msg.action!)}
                            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[var(--primary)] hover:bg-[var(--primary-h)] text-white font-semibold text-[11px] shadow-xs transition-colors"
                          >
                            <span>{msg.action.label}</span>
                            <ArrowRight className="w-3 h-3" />
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                ))}
                <div ref={messagesEndRef} />
              </div>

              <div className="px-3 py-2 border-t border-[var(--border)] bg-[var(--panel-subtle)]/50 flex flex-wrap gap-1.5 shrink-0">
                {chips.map(chip => (
                  <button
                    key={chip.label}
                    type="button"
                    onClick={() => processQuery(chip.query)}
                    className="px-2.5 py-1 rounded-full text-[10px] font-medium bg-[var(--panel)] hover:bg-[var(--primary-light)] hover:text-[var(--primary)] border border-[var(--border)] text-[var(--muted)] transition-colors"
                  >
                    {chip.label}
                  </button>
                ))}
              </div>

              <form onSubmit={handleSubmit} className="p-3 border-t border-[var(--border)] bg-[var(--panel)] flex items-center gap-2 shrink-0">
                <input
                  type="text"
                  value={input}
                  onChange={e => setInput(e.target.value)}
                  placeholder="Ask a question or type 'help'…"
                  className="flex-1 px-3 py-2 text-xs rounded-xl bg-[var(--input-bg)] border border-[var(--border)] text-[var(--text)] placeholder-[var(--muted)] focus:outline-none focus:border-[var(--primary)] focus:ring-1 focus:ring-[var(--primary)]"
                />
                <button
                  type="submit"
                  disabled={!input.trim()}
                  className="p-2 rounded-xl bg-[var(--primary)] hover:bg-[var(--primary-h)] disabled:opacity-40 disabled:cursor-not-allowed text-white transition-colors"
                  title="Send"
                  aria-label="Send"
                >
                  <Send className="w-4 h-4" />
                </button>
              </form>
            </>
          )}
        </div>
      )}
    </>
  );
}
