import { Link } from 'react-router-dom';
import { Compass } from 'lucide-react';
import { Card } from '../../components/ui/Card';
import { Button } from '../../components/ui/Button';

/**
 * Shown for addresses that are not part of SimpleHours — including /login, which used to be a
 * generic sign-in page. Sign-in only happens at an organisation's own link, so this page never
 * offers a sign-in form, an organisation list or a way to look one up.
 */
export default function NotFound() {
  return (
    <div className="min-h-screen flex items-center justify-center p-4 bg-[var(--bg)]">
      <Card className="max-w-md w-full p-8 text-center space-y-4">
        <div className="w-12 h-12 rounded-full bg-[var(--panel-subtle)] text-[var(--muted)] flex items-center justify-center mx-auto">
          <Compass className="w-6 h-6" />
        </div>
        <h1 className="text-xl font-bold text-[var(--text)]">Page not found</h1>
        <p className="text-xs text-[var(--muted)] leading-relaxed">
          To sign in, use the sign-in link your organisation gave you. If you don’t have it, ask your manager or organisation owner.
        </p>
        <Link to="/" className="block pt-2">
          <Button variant="primary" size="md" className="w-full">Go to the SimpleHours home page</Button>
        </Link>
      </Card>
    </div>
  );
}
