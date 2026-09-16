import React, { useState, useEffect } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { 
  Building2, 
  Lock, 
  Mail, 
  ArrowRight, 
  KeyRound, 
  AlertCircle, 
  ArrowLeft,
  Briefcase,
  ShieldCheck
} from 'lucide-react';
import api from '../../services/apiClient';
import { Button } from '../../components/ui/Button';
import { Input } from '../../components/ui/Input';
import { Card } from '../../components/ui/Card';
import { Badge } from '../../components/ui/Badge';

interface UserOrg {
  id: string;
  name: string;
  slug?: string;
  role: string;
  logo_url?: string | null;
}

export const FindOrg: React.FC = () => {
  const [step, setStep] = useState<'credentials' | '2fa' | 'select_org'>('credentials');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [twoFactorCode, setTwoFactorCode] = useState('');
  const [tempToken, setTempToken] = useState('');
  const [maskedEmail, setMaskedEmail] = useState('');
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  // Authenticated state
  const [authToken, setAuthToken] = useState<string>('');
  const [authUser, setAuthUser] = useState<any>(null);
  const [userOrgs, setUserOrgs] = useState<UserOrg[]>([]);
  const [selectingOrgId, setSelectingOrgId] = useState<string | null>(null);

  const navigate = useNavigate();

  // If already signed in, fetch organisations directly
  useEffect(() => {
    const existingToken = localStorage.getItem('token');
    const existingUser = localStorage.getItem('user');
    if (existingToken && existingUser) {
      try {
        const parsed = JSON.parse(existingUser);
        setAuthToken(existingToken);
        setAuthUser(parsed);
        if (Array.isArray(parsed.organisations) && parsed.organisations.length > 0) {
          setUserOrgs(parsed.organisations);
          setStep('select_org');
        } else {
          // Fetch fresh list from server
          api.get('/auth/organisations', { headers: { Authorization: `Bearer ${existingToken}` } })
            .then(res => {
              if (res.data?.success && Array.isArray(res.data?.data)) {
                setUserOrgs(res.data.data);
                setStep('select_org');
              }
            })
            .catch(() => {
              // Ignore, allow fresh sign in
            });
        }
      } catch {
        // Ignore
      }
    }
  }, []);

  const finalizeLoginToOrg = (token: string, orgId: string, role: string) => {
    localStorage.setItem('token', token);
    localStorage.setItem('current_org_id', orgId);
    window.dispatchEvent(new Event('auth-change'));

    if (role === 'Employee') {
      navigate('/portal');
    } else if (role === 'Platform Admin') {
      navigate('/platform');
    } else {
      navigate('/roster');
    }
  };

  const handleAuthenticationSuccess = (token: string, user: any) => {
    setAuthToken(token);
    setAuthUser(user);
    localStorage.setItem('user', JSON.stringify(user));

    const orgs: UserOrg[] = Array.isArray(user.organisations) ? user.organisations : [];
    setUserOrgs(orgs);
    setStep('select_org');
  };

  const handleLoginSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setIsLoading(true);

    try {
      const response = await api.post('/auth/login', {
        email: email.trim(),
        password,
      });

      if (response.data.require_2fa) {
        setTempToken(response.data.temp_token);
        setMaskedEmail(response.data.masked_email || email);
        setStep('2fa');
        setTwoFactorCode('');
        return;
      }

      if (response.data.success && response.data.data?.token) {
        handleAuthenticationSuccess(response.data.data.token, response.data.data.user);
      } else {
        setError(response.data?.error?.message || response.data?.error || 'Invalid credentials.');
      }
    } catch (err: any) {
      setError(err.response?.data?.error?.message || err.response?.data?.error || 'Invalid email or password.');
    } finally {
      setIsLoading(false);
    }
  };

  const handleVerify2FASubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!twoFactorCode.trim() || twoFactorCode.trim().length !== 6) {
      setError('Please enter the 6-digit verification code.');
      return;
    }

    setError('');
    setIsLoading(true);

    try {
      const response = await api.post('/auth/verify-2fa', {
        temp_token: tempToken,
        code: twoFactorCode.trim(),
      });

      if (response.data.success && response.data.data?.token) {
        handleAuthenticationSuccess(response.data.data.token, response.data.data.user);
      } else {
        setError(response.data?.error?.message || 'Verification failed.');
      }
    } catch (err: any) {
      setError(err.response?.data?.error?.message || 'Invalid or expired verification code.');
    } finally {
      setIsLoading(false);
    }
  };

  const handleSelectOrganisation = async (org: UserOrg) => {
    setSelectingOrgId(org.id);
    setError('');

    localStorage.setItem('last_org_slug', org.slug || org.id);
    localStorage.setItem('last_org_name', org.name);

    try {
      const currentOrgId = authUser?.organisation_id;
      if (currentOrgId === org.id) {
        finalizeLoginToOrg(authToken, org.id, org.role);
        return;
      }

      const res = await api.post(
        '/auth/switch-organisation',
        { organisation_id: org.id },
        { headers: { Authorization: `Bearer ${authToken}` } }
      );

      if (res.data?.success && res.data?.data?.token) {
        finalizeLoginToOrg(res.data.data.token, org.id, res.data.data.user?.role || org.role);
      } else {
        finalizeLoginToOrg(authToken, org.id, org.role);
      }
    } catch (err) {
      finalizeLoginToOrg(authToken, org.id, org.role);
    } finally {
      setSelectingOrgId(null);
    }
  };

  const handleSignOutAndReset = () => {
    localStorage.removeItem('token');
    localStorage.removeItem('user');
    setAuthToken('');
    setAuthUser(null);
    setUserOrgs([]);
    setStep('credentials');
    setEmail('');
    setPassword('');
    setError('');
  };

  return (
    <div className="max-w-md mx-auto px-4 sm:px-6 lg:px-8 py-16 space-y-8">
      {/* Header */}
      <div className="text-center space-y-3">
        <div className="w-12 h-12 rounded-xl bg-indigo-600/10 border border-indigo-500/20 text-indigo-400 flex items-center justify-center mx-auto">
          <Building2 className="w-6 h-6" />
        </div>
        <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-[var(--text)]">
          {step === 'select_org' ? 'Select Your Organisation' : 'Find Your Organisation'}
        </h1>
        <p className="text-xs sm:text-sm text-[var(--muted)] max-w-sm mx-auto">
          {step === 'select_org'
            ? 'Choose the organisation you want to access today.'
            : 'Sign in with your work credentials to locate and select your organisation.'}
        </p>
      </div>

      {error && (
        <div className="bg-rose-500/10 border border-rose-500/20 text-rose-500 p-3 rounded-md text-xs flex items-start gap-2">
          <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
          <span>{error}</span>
        </div>
      )}

      <Card className="p-8 shadow-sm">
        {/* STEP 1: CREDENTIALS */}
        {step === 'credentials' && (
          <form onSubmit={handleLoginSubmit} className="space-y-4">
            <Input
              label="Work Email Address"
              type="email"
              required
              placeholder="you@company.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoFocus
              leftIcon={<Mail className="w-4 h-4" />}
            />

            <div>
              <Input
                label="Password"
                type="password"
                required
                placeholder="••••••••••••"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                leftIcon={<Lock className="w-4 h-4" />}
              />
              <div className="flex justify-end mt-1.5">
                <Link to="/forgot-password" className="text-xs text-indigo-400 hover:underline">
                  Forgot password?
                </Link>
              </div>
            </div>

            <Button
              type="submit"
              variant="primary"
              size="md"
              className="w-full"
              loading={isLoading}
              rightIcon={<ArrowRight className="w-4 h-4" />}
            >
              Sign In & Locate Organisation
            </Button>
          </form>
        )}

        {/* STEP 2: 2FA */}
        {step === '2fa' && (
          <form onSubmit={handleVerify2FASubmit} className="space-y-5">
            <div className="text-center space-y-1">
              <div className="w-10 h-10 rounded-full bg-indigo-600/10 text-indigo-400 flex items-center justify-center mx-auto">
                <KeyRound className="w-5 h-5" />
              </div>
              <h3 className="text-sm font-semibold text-[var(--text)]">Two-Factor Authentication</h3>
              <p className="text-xs text-[var(--muted)]">
                Enter the code sent to <strong className="text-[var(--text)]">{maskedEmail}</strong>.
              </p>
            </div>

            <Input
              type="text"
              placeholder="123456"
              value={twoFactorCode}
              onChange={(e) => setTwoFactorCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
              maxLength={6}
              required
              autoFocus
              className="text-center text-lg tracking-widest font-mono py-2.5"
            />

            <Button
              type="submit"
              variant="primary"
              size="md"
              className="w-full"
              loading={isLoading}
            >
              Verify & View Organisations
            </Button>
          </form>
        )}

        {/* STEP 3: SELECT YOUR ORGANISATION */}
        {step === 'select_org' && (
          <div className="space-y-5">
            <div className="flex items-center justify-between pb-3 border-b border-[var(--border)]">
              <div>
                <h3 className="text-sm font-bold text-[var(--text)]">Your Workplaces</h3>
                <p className="text-xs text-[var(--muted)]">
                  Signed in as <span className="font-semibold text-[var(--text)]">{authUser?.email}</span>
                </p>
              </div>
              <Badge variant="purple" size="sm">
                {userOrgs.length} {userOrgs.length === 1 ? 'Workplace' : 'Workplaces'}
              </Badge>
            </div>

            {userOrgs.length > 0 ? (
              <div className="divide-y divide-[var(--border)] border border-[var(--border)] rounded-lg overflow-hidden">
                {userOrgs.map((org) => {
                  const isSelected = selectingOrgId === org.id;
                  return (
                    <div
                      key={org.id}
                      onClick={() => !isSelected && handleSelectOrganisation(org)}
                      className="p-4 hover:bg-[var(--hover-row)] flex items-center justify-between cursor-pointer transition-colors group"
                    >
                      <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-md bg-indigo-600/10 text-indigo-400 border border-indigo-500/20 flex items-center justify-center font-bold text-sm">
                          {org.name.charAt(0).toUpperCase()}
                        </div>
                        <div>
                          <div className="font-semibold text-sm text-[var(--text)] group-hover:text-indigo-400 transition-colors">
                            {org.name}
                          </div>
                          <div className="flex items-center gap-2 mt-0.5">
                            <Badge variant={org.role === 'Employee' ? 'default' : 'purple'} size="sm">
                              {org.role}
                            </Badge>
                            {org.slug && (
                              <span className="text-[11px] text-[var(--muted)] font-mono">
                                @{org.slug}
                              </span>
                            )}
                          </div>
                        </div>
                      </div>

                      <Button
                        variant="secondary"
                        size="sm"
                        loading={isSelected}
                        rightIcon={<ArrowRight className="w-3.5 h-3.5" />}
                      >
                        Enter
                      </Button>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="p-6 text-center space-y-2 border border-dashed border-[var(--border)] rounded-lg">
                <Briefcase className="w-8 h-8 text-[var(--muted)] mx-auto" />
                <div className="text-xs font-semibold text-[var(--text)]">No Active Workplaces Found</div>
                <p className="text-[11px] text-[var(--muted)]">
                  Your account ({authUser?.email}) is not linked to any organisation yet.
                </p>
              </div>
            )}

            <div className="pt-2 flex items-center justify-between text-xs">
              <button
                type="button"
                onClick={handleSignOutAndReset}
                className="text-[var(--muted)] hover:text-[var(--text)] inline-flex items-center gap-1 cursor-pointer"
              >
                <ArrowLeft className="w-3.5 h-3.5" />
                <span>Sign in with different account</span>
              </button>
            </div>
          </div>
        )}
      </Card>

      <div className="text-center text-xs text-[var(--muted)] flex items-center justify-center gap-1.5">
        <ShieldCheck className="w-4 h-4 text-emerald-500" />
        <span>Secure authentication and verified organisation access</span>
      </div>
    </div>
  );
};
