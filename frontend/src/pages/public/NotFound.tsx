import { Link } from 'react-router-dom';
import { Compass } from 'lucide-react';
import { Card } from '../../components/ui/Card';
import { Button } from '../../components/ui/Button';

/**
 * Shown for any address that is not a SimpleHours page — including /login, which is deliberately
 * not a sign-in page (the server answers it with a real 404 too). Nothing here mentions signing in,
 * so the page gives no hint that a sign-in system exists or where it lives.
 */
export default function NotFound() {
  const signedIn = Boolean(localStorage.getItem('token'));
  return (
    <main className="min-h-screen flex items-center justify-center p-4 bg-[var(--bg)]">
      <Card className="max-w-md w-full p-8 text-center space-y-4">
        <div className="w-12 h-12 rounded-full bg-[var(--panel-subtle)] text-[var(--muted)] flex items-center justify-center mx-auto">
          <Compass className="w-6 h-6" aria-hidden="true" />
        </div>
        <h1 className="text-xl font-bold text-[var(--text)]">Page not found</h1>
        <p className="text-sm text-[var(--muted)] leading-relaxed">
          This page doesn’t exist. Check the address, or go back to where you came from.
        </p>
        <Link to={signedIn ? '/app' : '/'} className="block pt-2">
          <Button variant="primary" size="md" className="w-full">{signedIn ? 'Go to my home page' : 'Go to the SimpleHours home page'}</Button>
        </Link>
      </Card>
    </main>
  );
}
