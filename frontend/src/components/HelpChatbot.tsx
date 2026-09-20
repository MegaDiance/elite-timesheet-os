import { useState, useRef, useEffect, type FormEvent } from 'react';
import { 
  X, 
  Send, 
  Bot, 
  User, 
  ArrowRight,
  ChevronDown
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';

interface HelpChatbotProps {
  role: string;
}

interface ChatMessage {
  id: string;
  sender: 'bot' | 'user';
  text: string;
  action?: {
    label: string;
    path?: string;
    triggerTutorial?: boolean;
  };
}

export default function HelpChatbot({ role }: HelpChatbotProps) {
  const navigate = useNavigate();
  const [isOpen, setIsOpen] = useState(false);
  const [input, setInput] = useState('');
  const [isMinimized, setIsMinimized] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const isManager = ['Admin', 'Company Admin', 'Platform Admin', 'Manager'].includes(role);

  // Initial greeting depending on role
  const initialMessages: ChatMessage[] = [
    {
      id: 'welcome',
      sender: 'bot',
      text: isManager
        ? `Hello! I'm your SimpleHours Manager Assistant. I can guide you through managing rosters, approving timesheets, reviewing leave, and running payroll reports. Type "help" or select a quick topic below.`
        : `Hi there! I'm your SimpleHours Assistant. I can help you check your schedule, record your daily hours, submit timesheets, and request leave. Type "help" or select a quick topic below.`
    }
  ];

  const [messages, setMessages] = useState<ChatMessage[]>(initialMessages);

  // Quick suggestion chips
  const employeeChips = [
    { label: 'How to enter hours', query: 'enter hours' },
    { label: 'When to submit', query: 'when to submit' },
    { label: 'How breaks work', query: 'breaks' },
    { label: 'Start visual tour', query: 'tutorial' }
  ];

  const managerChips = [
    { label: 'Review timesheets', query: 'review timesheets' },
    { label: 'Publish roster', query: 'roster' },
    { label: 'Approve leave', query: 'leave' },
    { label: 'Start visual tour', query: 'tutorial' }
  ];

  const chips = isManager ? managerChips : employeeChips;

  useEffect(() => {
    if (isOpen && !isMinimized) {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages, isOpen, isMinimized]);

  const processQuery = (rawQuery: string) => {
    const q = rawQuery.trim().toLowerCase();
    const userMsg: ChatMessage = {
      id: Date.now().toString(),
      sender: 'user',
      text: rawQuery
    };

    let botResponse: ChatMessage = {
      id: (Date.now() + 1).toString(),
      sender: 'bot',
      text: ''
    };

    if (q === 'help' || q === 'commands' || q === '?') {
      if (isManager) {
        botResponse.text = `Available commands for Managers & Admins:\n• "timesheets" - Review and approve pending fortnights\n• "roster" - Build, auto-assign, and publish schedules\n• "leave" - Review and action employee leave requests\n• "employees" - Manage staff profiles and send invitations\n• "reports" - Export payroll and award variance reports\n• "tutorial" - Launch the interactive 1-minute visual tour`;
      } else {
        botResponse.text = `Available commands for Team Members:\n• "timesheet" - Enter today's hours or submit fortnight\n• "schedule" - View your shifts and rostered days off\n• "breaks" - Learn how automatic meal breaks work\n• "leave" - How to check your leave balances\n• "history" - View past pay cycles and approval status\n• "tutorial" - Launch the interactive 1-minute visual tour`;
      }
    } else if (q.includes('tutorial') || q.includes('tour') || q.includes('walkthrough')) {
      botResponse = {
        id: (Date.now() + 1).toString(),
        sender: 'bot',
        text: `Starting the 1-minute visual walkthrough of SimpleHours!`,
        action: {
          label: 'Start 1-Minute Tour',
          triggerTutorial: true
        }
      };
    } else if (isManager && (q.includes('timesheet') || q.includes('approve') || q.includes('review'))) {
      botResponse = {
        id: (Date.now() + 1).toString(),
        sender: 'bot',
        text: `You can review and approve employee timesheets in the Timesheet Review queue. You can approve timesheets with 1-click, approve all in bulk, or return timesheets with specific feedback notes if changes are needed.`,
        action: {
          label: 'Go to Timesheet Review',
          path: '/timesheets'
        }
      };
    } else if (!isManager && (q.includes('enter') || q.includes('hours') || q.includes('clock') || q.includes('timesheet'))) {
      botResponse = {
        id: (Date.now() + 1).toString(),
        sender: 'bot',
        text: `To record your hours:\n1. Open your Timesheet.\n2. Verify your Start and Finish times for each day worked.\n3. Tap "Match Schedule" if your hours matched the roster.\n4. Tap "Save" on that day.\n5. Once all 14 days are recorded, tap "Submit timesheet".`,
        action: {
          label: 'Go to My Timesheet',
          path: '/timesheet'
        }
      };
    } else if (!isManager && (q.includes('when') || q.includes('submit') || q.includes('deadline'))) {
      botResponse = {
        id: (Date.now() + 1).toString(),
        sender: 'bot',
        text: `Submit your timesheet at the end of every 14-day pay fortnight, once your final shift is completed. Your manager will then review and approve it for payroll.`,
        action: {
          label: 'Open Timesheet',
          path: '/timesheet'
        }
      };
    } else if (q.includes('break') || q.includes('lunch') || q.includes('meal')) {
      botResponse = {
        id: (Date.now() + 1).toString(),
        sender: 'bot',
        text: `Under standard award rules, shifts over 6 hours automatically have a 30-minute unpaid meal break deducted. If your actual break was different, you can select None, 15m, 30m, 45m, or 60m from the dropdown when saving your hours.`
      };
    } else if (q.includes('lock') || q.includes('locked')) {
      botResponse = {
        id: (Date.now() + 1).toString(),
        sender: 'bot',
        text: isManager
          ? `Timesheets and rosters are locked once the fortnight payroll period is sealed. You can lock or unlock cycles from the Roster toolbar status indicators.`
          : `Your timesheet is locked once your manager has approved it or closed the pay period. If you need to correct a past shift, contact your manager so they can return it for changes.`
      };
    } else if (isManager && (q.includes('roster') || q.includes('schedule') || q.includes('shift'))) {
      botResponse = {
        id: (Date.now() + 1).toString(),
        sender: 'bot',
        text: `Manage schedules in the Roster Grid. You can add shifts, auto-roster staff according to their weekly availability templates, check budget totals, and publish to your team with 1 click.`,
        action: {
          label: 'Go to Roster Grid',
          path: '/roster'
        }
      };
    } else if (!isManager && (q.includes('schedule') || q.includes('shift') || q.includes('roster') || q.includes('working'))) {
      botResponse = {
        id: (Date.now() + 1).toString(),
        sender: 'bot',
        text: `You can check your upcoming shifts and rostered days off anytime on the Schedule page. It shows your start/finish times and total rostered hours for the 14-day fortnight.`,
        action: {
          label: 'View My Schedule',
          path: '/schedule'
        }
      };
    } else if (q.includes('leave') || q.includes('holiday') || q.includes('sick') || q.includes('annual')) {
      botResponse = {
        id: (Date.now() + 1).toString(),
        sender: 'bot',
        text: isManager
          ? `You can view, approve, or reject employee leave applications from the Leave Board.`
          : `You can check leave balances or apply for leave through your management portal. Shifts approved as leave will automatically show on your schedule.`,
        action: isManager ? { label: 'Open Leave Board', path: '/leave-requests' } : undefined
      };
    } else if (isManager && (q.includes('employee') || q.includes('staff') || q.includes('invite') || q.includes('user'))) {
      botResponse = {
        id: (Date.now() + 1).toString(),
        sender: 'bot',
        text: `Manage your team from the Staff Directory. Add new employees, set pay rates and contracted hours, and generate secure invite links.`,
        action: {
          label: 'Open Staff Directory',
          path: '/employees'
        }
      };
    } else if (isManager && (q.includes('report') || q.includes('payroll') || q.includes('export') || q.includes('xero'))) {
      botResponse = {
        id: (Date.now() + 1).toString(),
        sender: 'bot',
        text: `Export pay runs, award breakdown summaries, and audit logs from the Reports hub. You can download CSVs or sync with Xero.`,
        action: {
          label: 'Open Reports',
          path: '/reports'
        }
      };
    } else {
      botResponse.text = isManager
        ? `I didn't quite catch that. Try asking about "timesheets", "roster", "leave", "employees", "reports", or type "help" for a full list of commands.`
        : `I didn't quite catch that. Try asking about "enter hours", "when to submit", "breaks", "schedule", or type "help" for a list of topics.`;
    }

    setMessages(prev => [...prev, userMsg, botResponse]);
    setInput('');
  };

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (!input.trim()) return;
    processQuery(input);
  };

  const handleActionClick = (action: NonNullable<ChatMessage['action']>) => {
    if (action.triggerTutorial) {
      window.dispatchEvent(new CustomEvent('start-simplehours-tutorial'));
      setIsOpen(false);
    } else if (action.path) {
      navigate(action.path);
      setIsOpen(false);
    }
  };

  return (
    <>
      {/* Floating Launcher Button */}
      {!isOpen && (
        <button
          onClick={() => {
            setIsOpen(true);
            setIsMinimized(false);
          }}
          className="fixed bottom-20 sm:bottom-6 right-5 sm:right-6 z-40 p-3 rounded-full bg-[var(--primary)] text-white shadow-xl hover:bg-[var(--primary-h)] hover:scale-105 active:scale-95 transition-all duration-200 flex items-center gap-2 group"
          title="SimpleHours Help Assistant"
          aria-label="Open SimpleHours Help Assistant"
        >
          <Bot className="w-5 h-5 transition-transform group-hover:rotate-12" />
          <span className="hidden sm:inline-block text-xs font-bold pr-1">Need Help?</span>
          <span className="absolute -top-1 -right-1 w-3 h-3 rounded-full bg-emerald-400 ring-2 ring-[var(--panel)]"></span>
        </button>
      )}

      {/* Chatbot Window */}
      {isOpen && (
        <div 
          className={`fixed bottom-20 sm:bottom-6 right-4 sm:right-6 z-50 w-[calc(100vw-32px)] sm:w-96 bg-[var(--panel)] border border-[var(--border)] rounded-2xl shadow-2xl overflow-hidden flex flex-col transition-all duration-200 animate-in fade-in slide-in-from-bottom-4 ${
            isMinimized ? 'h-14' : 'h-[500px] max-h-[75vh]'
          }`}
          role="dialog"
          aria-label="SimpleHours Help Assistant"
        >
          {/* Header */}
          <div className="px-4 py-3 bg-[var(--sidebar-bg)] text-white border-b border-white/10 flex items-center justify-between shrink-0 select-none">
            <div className="flex items-center gap-2.5">
              <div className="w-7 h-7 rounded-lg bg-[var(--primary)] flex items-center justify-center text-white">
                <Bot className="w-4 h-4" />
              </div>
              <div>
                <div className="font-bold text-xs flex items-center gap-1.5">
                  <span>SimpleHours Assistant</span>
                  <span className="px-1.5 py-0.2 rounded text-[9px] font-semibold bg-white/10 text-emerald-300">
                    {isManager ? 'Manager Mode' : 'Staff Mode'}
                  </span>
                </div>
                <div className="text-[10px] text-white/60">Instant answers & guidance</div>
              </div>
            </div>

            <div className="flex items-center gap-1">
              <button
                onClick={() => setIsMinimized(!isMinimized)}
                className="p-1 rounded text-white/70 hover:text-white hover:bg-white/10 transition-colors"
                title={isMinimized ? 'Expand' : 'Minimize'}
              >
                <ChevronDown className={`w-4 h-4 transition-transform ${isMinimized ? 'rotate-180' : ''}`} />
              </button>
              <button
                onClick={() => setIsOpen(false)}
                className="p-1 rounded text-white/70 hover:text-white hover:bg-white/10 transition-colors"
                title="Close Assistant"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>

          {!isMinimized && (
            <>
              {/* Messages Area */}
              <div className="flex-1 p-4 overflow-y-auto space-y-3 bg-[var(--panel)] text-xs">
                {messages.map((msg) => (
                  <div
                    key={msg.id}
                    className={`flex items-start gap-2.5 ${msg.sender === 'user' ? 'flex-row-reverse' : ''}`}
                  >
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

              {/* Quick Topic Chips */}
              <div className="px-3 py-2 border-t border-[var(--border)] bg-[var(--panel-subtle)]/50 flex flex-wrap gap-1.5 shrink-0">
                {chips.map((chip, idx) => (
                  <button
                    key={idx}
                    type="button"
                    onClick={() => processQuery(chip.query)}
                    className="px-2.5 py-1 rounded-full text-[10px] font-medium bg-[var(--panel)] hover:bg-[var(--primary-light)] hover:text-[var(--primary)] border border-[var(--border)] text-[var(--muted)] transition-colors"
                  >
                    {chip.label}
                  </button>
                ))}
              </div>

              {/* Input Form */}
              <form onSubmit={handleSubmit} className="p-3 border-t border-[var(--border)] bg-[var(--panel)] flex items-center gap-2 shrink-0">
                <input
                  type="text"
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  placeholder={isManager ? "Ask a manager question or type 'help'..." : "Ask a question or type 'help'..."}
                  className="flex-1 px-3 py-2 text-xs rounded-xl bg-[var(--input-bg)] border border-[var(--border)] text-[var(--text)] placeholder-[var(--muted)] focus:outline-none focus:border-[var(--primary)] focus:ring-1 focus:ring-[var(--primary)]"
                />
                <button
                  type="submit"
                  disabled={!input.trim()}
                  className="p-2 rounded-xl bg-[var(--primary)] hover:bg-[var(--primary-h)] disabled:opacity-40 disabled:cursor-not-allowed text-white transition-colors"
                  title="Send message"
                  aria-label="Send message"
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
