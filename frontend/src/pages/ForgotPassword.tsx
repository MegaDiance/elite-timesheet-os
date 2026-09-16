import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import api from '../services/apiClient';

export default function ForgotPassword() {
  const [email, setEmail] = useState('');
  const [status, setStatus] = useState<'idle' | 'loading' | 'success' | 'error'>('idle');
  const [message, setMessage] = useState('');
  const [deliveryNotice, setDeliveryNotice] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setStatus('loading');
    setDeliveryNotice('');
    
    try {
      const response = await api.post('/auth/forgot-password', { email });
      setStatus('success');
      setMessage(response.data.message || 'If an account exists, a reset link was sent.');
      if (response.data.delivery_notice) {
        setDeliveryNotice(response.data.delivery_notice);
      }
    } catch (err: any) {
      setStatus('error');
      setMessage(err.response?.data?.error || err.response?.data?.error?.message || 'An error occurred while requesting password reset.');
    }
  };

  return (
    <div className="flex items-center justify-center min-h-screen bg-[var(--bg)] text-[var(--text)] font-['Inter',sans-serif] p-4">
      <div className="w-full max-w-md p-8 bg-[var(--panel)] rounded-2xl border border-[var(--border)] shadow-2xl">
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-14 h-14 bg-[var(--primary-light)] text-[var(--primary)] rounded-2xl mb-4 border border-[var(--primary)]/20">
            <svg className="w-7 h-7" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect>
              <path d="M7 11V7a5 5 0 0 1 10 0v4"></path>
            </svg>
          </div>
          <h1 className="text-2xl font-black text-[var(--text)]">Reset Password</h1>
          <p className="text-xs font-medium text-[var(--muted)] mt-2">Enter your account email to receive a password reset link</p>
        </div>

        {status === 'success' ? (
          <div className="space-y-6">
            <div className="bg-[var(--success-light)] text-[var(--success)] border border-[var(--success)]/20 p-4 rounded-xl text-center text-xs font-medium leading-relaxed">
              {message}
            </div>
            {deliveryNotice && (
              <div className="bg-indigo-500/10 text-indigo-300 border border-indigo-500/20 p-3 rounded-xl text-center text-xs font-medium leading-relaxed">
                {deliveryNotice}
              </div>
            )}
            <p className="text-xs text-[var(--muted)] text-center">
              Please check your inbox (and spam folder) for the reset link. It expires in 1 hour.
            </p>
            <Link 
              to="/login" 
              className="block w-full text-center bg-[var(--primary)] hover:bg-[var(--primary-h)] text-white font-bold py-3 px-4 rounded-xl transition-colors text-sm shadow-lg shadow-[var(--primary-light)]"
            >
              Return to Login
            </Link>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-5">
            <div className="space-y-1.5">
              <label className="text-xs font-bold text-[var(--muted)] uppercase tracking-wider">Email Address</label>
              <input 
                type="email" 
                required 
                placeholder="name@company.com"
                value={email}
                onChange={e => setEmail(e.target.value)}
                className="w-full px-4 py-3 bg-[var(--input-bg)] border border-[var(--border)] rounded-xl focus:ring-2 focus:ring-[var(--primary)] focus:border-[var(--primary)] text-[var(--text)] outline-none transition-all placeholder:text-[var(--muted)] text-sm"
              />
            </div>

            {status === 'error' && (
              <div className="bg-[var(--danger-light)] border border-[var(--danger)]/20 text-[var(--danger)] p-3 rounded-xl text-xs font-semibold">
                {message}
              </div>
            )}

            <button 
              type="submit" 
              disabled={status === 'loading'}
              className="w-full bg-[var(--primary)] hover:bg-[var(--primary-h)] text-white font-bold py-3 px-4 rounded-xl transition-all shadow-lg shadow-[var(--primary-light)] disabled:opacity-50 text-sm cursor-pointer"
            >
              {status === 'loading' ? 'Sending Reset Link...' : 'Send Reset Link'}
            </button>
            
            <div className="text-center pt-2">
              <Link to="/login" className="text-xs font-semibold text-[var(--muted)] hover:text-[var(--text)] hover:underline">
                Back to Login
              </Link>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
