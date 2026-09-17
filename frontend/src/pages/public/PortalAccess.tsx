import React, { useState, useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { 
  Building2, 
  ArrowRight, 
  Search, 
  Clock,
  ShieldCheck,
  Briefcase,
  Layers
} from 'lucide-react';
import api from '../../services/apiClient';
import { Button } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';

interface DiscoveredOrg {
  id: string;
  name: string;
  slug: string;
  logo_url: string | null;
}

export const PortalAccess: React.FC = () => {
  const [searchParams] = useSearchParams();
  const initialQuery = searchParams.get('q') || '';
  
  const [query, setQuery] = useState(initialQuery);
  const [results, setResults] = useState<DiscoveredOrg[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [hasSearched, setHasSearched] = useState(false);
  const [directSlug, setDirectSlug] = useState('');

  // Recent workplace from local cache
  const [recentSlug, setRecentSlug] = useState<string | null>(null);
  const [recentName, setRecentName] = useState<string | null>(null);

  const navigate = useNavigate();

  useEffect(() => {
    const cachedSlug = localStorage.getItem('last_org_slug');
    const cachedName = localStorage.getItem('last_org_name');
    if (cachedSlug) {
      setRecentSlug(cachedSlug);
      setRecentName(cachedName || cachedSlug);
    }
  }, []);

  // Secret easter egg for Platform Administrator (5 taps/clicks on shield)
  const [secretClicks, setSecretClicks] = useState(0);
  const handleSecretShieldClick = () => {
    const next = secretClicks + 1;
    setSecretClicks(next);
    if (next >= 5) {
      setSecretClicks(0);
      navigate('/platform-gate');
    }
  };

  // Debounced search
  useEffect(() => {
    const trimmed = query.trim();
    if (trimmed.length < 2) {
      setResults([]);
      setHasSearched(false);
      setIsSearching(false);
      return;
    }

    setIsSearching(true);
    const timeoutId = setTimeout(async () => {
      try {
        const res = await api.get(`/organisation/discover?q=${encodeURIComponent(trimmed)}`);
        if (res.data?.success && Array.isArray(res.data?.data)) {
          setResults(res.data.data);
          setHasSearched(true);
        } else {
          setResults([]);
          setHasSearched(true);
        }
      } catch (err) {
        setResults([]);
        setHasSearched(true);
      } finally {
        setIsSearching(false);
      }
    }, 200);

    return () => clearTimeout(timeoutId);
  }, [query]);

  const handleGoToPortal = (slug: string, name?: string) => {
    if (!slug) return;
    const cleanSlug = slug.trim().toLowerCase();
    localStorage.setItem('last_org_slug', cleanSlug);
    if (name) {
      localStorage.setItem('last_org_name', name);
    }
    navigate(`/login/${cleanSlug}`);
  };

  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const clean = query.trim().toLowerCase();
    if (!clean) return;

    // If exactly 1 match found, navigate directly
    if (results.length === 1) {
      handleGoToPortal(results[0].slug, results[0].name);
      return;
    }

    // If slug-like format (alphanumeric with hyphens, no spaces), navigate directly to that portal
    if (/^[a-z0-9-]+$/i.test(clean)) {
      handleGoToPortal(clean);
    }
  };

  const handleDirectSlugSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (directSlug.trim()) {
      handleGoToPortal(directSlug.trim());
    }
  };

  return (
    <div className="max-w-xl mx-auto px-4 sm:px-6 lg:px-8 py-16 space-y-8">
      {/* Header */}
      <div className="text-center space-y-3">
        <div className="w-12 h-12 rounded-xl bg-indigo-600/10 border border-indigo-500/20 text-indigo-400 flex items-center justify-center mx-auto">
          <Layers className="w-6 h-6" />
        </div>
        <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-[var(--text)]">
          Workplace Portal
        </h1>
        <p className="text-xs sm:text-sm text-[var(--muted)] max-w-sm mx-auto">
          Locate your organisation to access your dedicated login portal.
        </p>
      </div>

      {/* Recent Workplace Quick Card */}
      {recentSlug && (
        <Card className="p-4 bg-indigo-500/5 border-indigo-500/20 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-lg bg-indigo-600 text-white flex items-center justify-center font-bold text-sm">
              {(recentName || recentSlug).charAt(0).toUpperCase()}
            </div>
            <div>
              <div className="text-[11px] uppercase tracking-wider text-indigo-400 font-semibold">
                Recent Workplace
              </div>
              <div className="font-semibold text-sm text-[var(--text)]">
                {recentName}
              </div>
            </div>
          </div>
          <Button
            variant="primary"
            size="sm"
            onClick={() => handleGoToPortal(recentSlug, recentName || undefined)}
            rightIcon={<ArrowRight className="w-3.5 h-3.5" />}
          >
            Go to Portal
          </Button>
        </Card>
      )}

      {/* Locate Organisation Box */}
      <Card className="p-6 space-y-6">
        <form onSubmit={handleSearchSubmit} className="space-y-4">
          <div>
            <label className="block text-xs font-semibold text-[var(--text)] mb-1.5">
              Organisation Name or Workspace Identifier
            </label>
            <div className="flex items-center gap-2">
              <div className="relative flex-1">
                <Search className="w-4 h-4 text-[var(--muted)] absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                <input
                  type="text"
                  placeholder="e.g. Acme Logistics or acme"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  autoFocus
                  className="w-full bg-[var(--input-bg)] text-[var(--text)] text-sm rounded-md pl-9 pr-3 py-2 border border-[var(--border)] focus:border-indigo-500 focus:outline-none placeholder:text-[var(--muted)]/50"
                />
              </div>
              <Button
                type="submit"
                variant="primary"
                size="md"
                disabled={!query.trim()}
                rightIcon={<ArrowRight className="w-4 h-4" />}
              >
                Go to Portal
              </Button>
            </div>
            <p className="text-[11px] text-[var(--muted)] mt-1.5">
              Enter your workplace name to locate your portal, or enter your workspace slug directly.
            </p>
          </div>
        </form>

        {/* Live Discovered Organisations */}
        {isSearching && (
          <div className="py-4 text-center text-xs text-[var(--muted)] flex items-center justify-center gap-2">
            <Clock className="w-4 h-4 animate-spin text-indigo-400" />
            <span>Locating organisation portal...</span>
          </div>
        )}

        {!isSearching && results.length > 0 && (
          <div className="space-y-2 pt-2 border-t border-[var(--border)]">
            <div className="text-xs font-semibold text-[var(--muted)] uppercase tracking-wider">
              Matching Workplaces ({results.length})
            </div>
            <div className="divide-y divide-[var(--border)] border border-[var(--border)] rounded-lg overflow-hidden">
              {results.map((org) => (
                <div
                  key={org.id}
                  onClick={() => handleGoToPortal(org.slug, org.name)}
                  className="p-3.5 hover:bg-[var(--hover-row)] flex items-center justify-between cursor-pointer transition-colors group"
                >
                  <div className="flex items-center gap-3">
                    <div className="w-9 h-9 rounded-md bg-indigo-600/10 text-indigo-400 border border-indigo-500/20 flex items-center justify-center font-bold text-sm">
                      {org.logo_url ? (
                        <img src={org.logo_url} alt={org.name} className="w-full h-full object-cover rounded-md" />
                      ) : (
                        org.name.charAt(0).toUpperCase()
                      )}
                    </div>
                    <div>
                      <div className="font-semibold text-sm text-[var(--text)] group-hover:text-indigo-400 transition-colors">
                        {org.name}
                      </div>
                      <div className="text-[11px] text-[var(--muted)] font-mono">
                        @{org.slug}
                      </div>
                    </div>
                  </div>

                  <Button
                    variant="secondary"
                    size="sm"
                    rightIcon={<ArrowRight className="w-3.5 h-3.5" />}
                  >
                    Go to Portal
                  </Button>
                </div>
              ))}
            </div>
          </div>
        )}

        {!isSearching && hasSearched && results.length === 0 && query.trim().length >= 2 && (
          <div className="p-4 text-center space-y-3 bg-[var(--panel-subtle)] rounded-lg border border-[var(--border)]">
            <Briefcase className="w-6 h-6 text-[var(--muted)] mx-auto" />
            <div className="text-xs font-semibold text-[var(--text)]">No Listed Workplace Found for "{query}"</div>
            <p className="text-[11px] text-[var(--muted)] max-w-sm mx-auto">
              If your organization uses a private or unlisted workspace identifier, you can proceed directly to your portal URL below.
            </p>
            <Button
              variant="outline"
              size="sm"
              onClick={() => handleGoToPortal(query.trim())}
              rightIcon={<ArrowRight className="w-3.5 h-3.5" />}
            >
              Open /login/{query.trim().toLowerCase()}
            </Button>
          </div>
        )}
      </Card>

      {/* Direct Slug Card */}
      <Card className="p-5 space-y-3">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-[var(--text)] flex items-center gap-1.5">
          <Building2 className="w-3.5 h-3.5 text-indigo-400" />
          <span>Know your workplace URL directly?</span>
        </h3>
        <p className="text-xs text-[var(--muted)]">
          Enter your team's direct slug to jump straight to your branded login screen.
        </p>
        <form onSubmit={handleDirectSlugSubmit} className="flex items-center gap-2 pt-1">
          <div className="relative flex-1">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-xs text-[var(--muted)] font-mono">
              /login/
            </span>
            <input
              type="text"
              placeholder="acme-logistics"
              value={directSlug}
              onChange={(e) => setDirectSlug(e.target.value)}
              className="w-full bg-[var(--input-bg)] text-[var(--text)] text-xs rounded-md pl-16 pr-3 py-2 border border-[var(--border)] focus:border-indigo-500 focus:outline-none font-mono"
            />
          </div>
          <Button type="submit" variant="secondary" size="sm" disabled={!directSlug.trim()}>
            Go to Portal
          </Button>
        </form>
      </Card>

        <div 
          onClick={handleSecretShieldClick}
          className="text-center text-xs text-[var(--muted)] flex items-center justify-center gap-1.5 pt-2 cursor-default select-none transition-colors active:text-indigo-400"
          title="Protected by enterprise multi-tenant isolation"
        >
          <ShieldCheck className={`w-4 h-4 transition-colors ${secretClicks > 0 ? 'text-indigo-400' : 'text-emerald-500'}`} />
          <span>Multi-tenant isolation & enterprise encryption</span>
        </div>
    </div>
  );
};
