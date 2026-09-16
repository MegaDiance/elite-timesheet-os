import React, { useState, useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import api from '../services/apiClient';

export default function AcceptInvite() {
  const [searchParams] = useSearchParams();
  const token = searchParams.get('token');
  const navigate = useNavigate();
  
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [status, setStatus] = useState<'validating' | 'idle' | 'loading' | 'error'>('validating');
  const [message, setMessage] = useState('');

  useEffect(() => {
    if (!token) {
      setStatus('error');
      setMessage('Invalid or missing invitation token.');
      return;
    }

    api.get(`/auth/invitation?token=${token}`)
      .then(res => {
        setEmail(res.data.data.email);
        setStatus('idle');
      })
      .catch(err => {
        setStatus('error');
        setMessage(err.response?.data?.error || 'Invalid or expired invitation.');
      });
  }, [token]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (password !== confirmPassword) {
      setStatus('error');
      setMessage('Passwords do not match');
      return;
    }

    setStatus('loading');
    
    try {
      await api.post('/auth/claim-invitation', { token, password });
      navigate('/login?setup=success');
    } catch (err: any) {
      setStatus('error');
      setMessage(err.response?.data?.error || 'An error occurred');
    }
  };

  return (
    <div className="flex items-center justify-center min-h-screen bg-slate-50 dark:bg-slate-900 transition-colors duration-200">
      <div className="w-full max-w-md p-8 bg-white dark:bg-slate-800 rounded-2xl shadow-xl border border-slate-200 dark:border-slate-700">
        <div className="text-center mb-8">
          <h1 className="text-2xl font-bold text-slate-900 dark:text-white">Accept Invitation</h1>
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-2">Set up your account password to continue</p>
        </div>

        {status === 'validating' ? (
          <div className="text-center text-slate-500">Validating invitation...</div>
        ) : status === 'error' && !email ? (
          <div className="bg-red-50 dark:bg-red-900/30 text-red-600 dark:text-red-400 p-3 rounded-lg text-sm font-semibold text-center">
            {message}
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-5">
            <div className="space-y-1.5">
              <label className="text-sm font-semibold text-slate-700 dark:text-slate-300">Email Address</label>
              <input 
                type="email" 
                disabled 
                value={email}
                className="w-full px-4 py-2.5 bg-slate-100 dark:bg-slate-800/50 border border-slate-300 dark:border-slate-700 rounded-xl text-slate-500 dark:text-slate-400 outline-none cursor-not-allowed"
              />
            </div>

            <div className="space-y-1.5">
              <label className="text-sm font-semibold text-slate-700 dark:text-slate-300">New Password</label>
              <input 
                type="password" 
                required 
                value={password}
                onChange={e => setPassword(e.target.value)}
                className="w-full px-4 py-2.5 bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-slate-900 dark:text-white outline-none transition-all"
              />
            </div>

            <div className="space-y-1.5">
              <label className="text-sm font-semibold text-slate-700 dark:text-slate-300">Confirm Password</label>
              <input 
                type="password" 
                required 
                value={confirmPassword}
                onChange={e => setConfirmPassword(e.target.value)}
                className="w-full px-4 py-2.5 bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-slate-900 dark:text-white outline-none transition-all"
              />
            </div>

            {status === 'error' && (
              <div className="bg-red-50 dark:bg-red-900/30 text-red-600 dark:text-red-400 p-3 rounded-lg text-sm font-semibold">
                {message}
              </div>
            )}

            <button 
              type="submit" 
              disabled={status === 'loading'}
              className="w-full bg-blue-600 hover:bg-blue-700 active:bg-blue-800 text-white font-bold py-3 px-4 rounded-xl transition-colors shadow-sm disabled:opacity-50"
            >
              {status === 'loading' ? 'Creating Account...' : 'Complete Setup'}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
