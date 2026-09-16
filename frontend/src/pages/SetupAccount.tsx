import React, { useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import api from '../services/apiClient';

export default function SetupAccount() {
  const [password, setPassword] = useState('');
  const [searchParams] = useSearchParams();
  const token = searchParams.get('token');
  const navigate = useNavigate();
  const [error, setError] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await api.post('/auth/claim-invitation', { token, password });
      navigate('/login?setup=success');
    } catch (err: any) {
      setError(err.response?.data?.error || 'Failed to setup account');
    }
  };

  return (
    <div className="flex items-center justify-center min-h-screen bg-[var(--bg)] text-[var(--text)] font-['Inter',sans-serif] p-4">
      <div className="w-full max-w-md p-8 bg-[var(--panel)] rounded-2xl border border-[var(--border)] shadow-xl">
        <h2 className="text-2xl font-bold mb-4 text-[var(--text)]">Setup Account</h2>
        {error && <div className="text-[var(--danger)] bg-[var(--danger-light)] p-3 rounded-xl mb-4 text-sm font-semibold">{error}</div>}
        <form onSubmit={handleSubmit} className="space-y-4">
          <input 
            type="password" 
            value={password}
            onChange={e => setPassword(e.target.value)}
            placeholder="New Password" 
            className="w-full px-4 py-2 bg-[var(--input-bg)] border border-[var(--border)] rounded-xl text-[var(--text)] outline-none focus:border-[var(--primary)]"
            required
          />
          <button type="submit" className="w-full bg-[var(--primary)] hover:bg-[var(--primary-h)] text-white font-bold py-3 rounded-xl shadow-lg transition-colors">Set Password</button>
        </form>
      </div>
    </div>
  );
}
