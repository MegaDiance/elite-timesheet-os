import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate, useSearchParams, Link } from 'react-router-dom';
import { Search, Building2, ArrowRight, Loader2, HelpCircle, Shield, ExternalLink } from 'lucide-react';
import api from '../../services/apiClient';
import { Button } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';
import { Badge } from '../../components/ui/Badge';

interface DiscoveredOrg {
  id: string;
  name: string;
  slug: string;
  logo_url: string | null;
}

export const FindOrg: React.FC = () => {
  const [searchParams, setSearchParams] = useSearchParams();
  const initialQuery = searchParams.get('q') || '';
  
  const [query, setQuery] = useState(initialQuery);
  const [results, setResults] = useState<DiscoveredOrg[]>([]);
  const [loading, setLoading] = useState(false);
  const [hasSearched, setHasSearched] = useState(false);
  const [directSlug, setDirectSlug] = useState('');
  
  const navigate = useNavigate();

  // Load remembered org from localStorage
  const lastOrgSlug = localStorage.getItem('last_org_slug');
  const lastOrgName = localStorage.getItem('last_org_name');

  const executeSearch = useCallback(async (searchTerm: string) => {
    const trimmed = searchTerm.trim();
    if (trimmed.length < 2) {
      setResults([]);
      setLoading(false);
      setHasSearched(false);
      return;
    }

    setLoading(true);
    setHasSearched(true);
    try {
      const res = await api.get(`/organisation/discover?q=${encodeURIComponent(trimmed)}`);
      if (res.data?.success && Array.isArray(res.data?.data)) {
        setResults(res.data.data);
      } else {
        setResults([]);
      }
    } catch (err) {
      console.error('Failed to discover organisations:', err);
      setResults([]);
    } finally {
      setLoading(false);
    }
  }, []);

  // Debounced search effect
  useEffect(() => {
    const timer = setTimeout(() => {
      if (query.trim().length >= 2) {
        setSearchParams({ q: query.trim() }, { replace: true });
        executeSearch(query);
      } else {
        setResults([]);
        setHasSearched(false);
      }
    }, 300);

    return () => clearTimeout(timer);
  }, [query, executeSearch, setSearchParams]);

  const handleSelectOrg = (org: DiscoveredOrg) => {
    localStorage.setItem('last_org_slug', org.slug);
    localStorage.setItem('last_org_name', org.name);
    navigate(`/login/${org.slug}`);
  };

  const handleDirectSlugSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (directSlug.trim()) {
      navigate(`/login/${encodeURIComponent(directSlug.trim().toLowerCase())}`);
    }
  };

  return (
    <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 py-16 space-y-10">
      {/* Page Title */}
      <div className="text-center space-y-3">
        <div className="w-12 h-12 rounded-xl bg-indigo-600/10 border border-indigo-500/20 text-indigo-400 flex items-center justify-center mx-auto">
          <Building2 className="w-6 h-6" />
        </div>
        <h1 className="text-3xl font-bold tracking-tight text-[var(--text)]">
          Find Your Organisation
        </h1>
        <p className="text-sm text-[var(--muted)] max-w-md mx-auto">
          Search for your company to be directed to your dedicated workplace sign-in portal.
        </p>
      </div>

      {/* Remembered Workplace Quick Resume */}
      {lastOrgSlug && (
        <div className="p-4 rounded-lg bg-[var(--panel)] border border-indigo-500/30 shadow-xs flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded bg-indigo-600/20 text-indigo-400 flex items-center justify-center font-bold text-xs">
              {(lastOrgName || lastOrgSlug).charAt(0).toUpperCase()}
            </div>
            <div>
              <div className="text-xs font-semibold text-[var(--text)]">
                Previously visited: {lastOrgName || lastOrgSlug}
              </div>
              <div className="text-[11px] text-[var(--muted)] font-mono">@{lastOrgSlug}</div>
            </div>
          </div>
          <Link to={`/login/${lastOrgSlug}`}>
            <Button variant="primary" size="sm" rightIcon={<ArrowRight className="w-3.5 h-3.5" />}>
              Open Portal
            </Button>
          </Link>
        </div>
      )}

      {/* Main Search Input */}
      <Card className="p-6 space-y-4">
        <div className="relative">
          <Search className="w-4 h-4 text-[var(--muted)] absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
          <input
            type="text"
            placeholder="Type your company name or slug (e.g. Apex, Transport, Acme)..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            autoFocus
            className="w-full bg-[var(--input-bg)] text-[var(--text)] text-sm rounded-lg pl-10 pr-10 py-3 border border-[var(--border)] focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 focus:outline-none transition-all placeholder:text-[var(--muted)]/60"
          />
          {loading && (
            <div className="absolute right-3.5 top-1/2 -translate-y-1/2">
              <Loader2 className="w-4 h-4 text-indigo-400 animate-spin" />
            </div>
          )}
        </div>

        {/* Results list */}
        {results.length > 0 && (
          <div className="divide-y divide-[var(--border)] border border-[var(--border)] rounded-lg overflow-hidden">
            {results.map((org) => (
              <div
                key={org.id}
                onClick={() => handleSelectOrg(org)}
                className="p-4 hover:bg-[var(--hover-row)] flex items-center justify-between cursor-pointer transition-colors group"
              >
                <div className="flex items-center gap-3">
                  <div className="w-9 h-9 rounded-md bg-[var(--panel-subtle)] border border-[var(--border)] flex items-center justify-center font-bold text-xs text-[var(--text)]">
                    {org.name.charAt(0).toUpperCase()}
                  </div>
                  <div>
                    <div className="font-semibold text-sm text-[var(--text)] group-hover:text-indigo-400 transition-colors">
                      {org.name}
                    </div>
                    <div className="flex items-center gap-2 mt-0.5">
                      <Badge variant="purple" size="sm">@{org.slug}</Badge>
                      <span className="text-[11px] text-[var(--muted)] font-mono">ID: {org.id.slice(0, 8)}...</span>
                    </div>
                  </div>
                </div>
                <Button variant="secondary" size="sm" rightIcon={<ArrowRight className="w-3.5 h-3.5" />}>
                  Continue
                </Button>
              </div>
            ))}
          </div>
        )}

        {/* Empty state when searched */}
        {hasSearched && !loading && results.length === 0 && (
          <div className="text-center py-8 space-y-2 border border-dashed border-[var(--border)] rounded-lg">
            <HelpCircle className="w-8 h-8 text-[var(--muted)] mx-auto" />
            <div className="text-sm font-semibold text-[var(--text)]">No workplaces found for "{query}"</div>
            <p className="text-xs text-[var(--muted)] max-w-sm mx-auto">
              If your organisation is unlisted for security reasons, you can enter your team's direct slug below.
            </p>
          </div>
        )}

        {/* Initial tip */}
        {!hasSearched && (
          <p className="text-xs text-[var(--muted)] flex items-center gap-1.5 pt-1">
            <Shield className="w-3.5 h-3.5 text-indigo-400 shrink-0" />
            <span>Search is instant and securely filtered. Minimum 2 characters required.</span>
          </p>
        )}
      </Card>

      {/* Direct Slug Fallback */}
      <Card className="p-6 space-y-3">
        <h3 className="text-sm font-semibold text-[var(--text)]">
          Know your direct organisation slug?
        </h3>
        <p className="text-xs text-[var(--muted)]">
          Some organizations opt out of public directory search for privacy. Enter your assigned slug directly to access your login page.
        </p>
        <form onSubmit={handleDirectSlugSubmit} className="flex items-center gap-2 pt-1">
          <div className="relative flex-1">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-xs text-[var(--muted)] font-mono">/login/</span>
            <input
              type="text"
              placeholder="acme-corp"
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

      {/* General Sign In Fallback */}
      <div className="text-center text-xs text-[var(--muted)] pt-2">
        <span>Are you a Platform Administrator? </span>
        <Link to="/login" className="text-indigo-400 hover:underline font-medium inline-flex items-center gap-0.5">
          General System Sign In <ExternalLink className="w-3 h-3 ml-0.5" />
        </Link>
      </div>
    </div>
  );
};
