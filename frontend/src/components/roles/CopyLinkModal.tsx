import { useState } from 'react';
import { Check, Copy } from 'lucide-react';
import { Button } from '../ui/Button';
import { Modal } from '../ui/Modal';
import { useToast } from '../ui/Toast';

export interface LinkToShare {
  title: string;
  description: string;
  url: string;
  /** Plain-language note about how long it lasts. */
  note: string;
}

/** A single-use secure link the caller must copy and share themselves. Shown once; never stored by the page. */
export default function CopyLinkModal({ link, onClose }: { link: LinkToShare | null; onClose: () => void }) {
  return (
    <Modal isOpen={Boolean(link)} onClose={onClose} title={link?.title || ''} description={link?.description} maxWidth="md">
      {link && <LinkBody key={link.url} link={link} onClose={onClose} />}
    </Modal>
  );
}

function LinkBody({ link, onClose }: { link: LinkToShare; onClose: () => void }) {
  const toast = useToast();
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(link.url);
      setCopied(true);
      toast.success('Link copied');
    } catch {
      toast.error('Couldn’t copy. Select the link and copy it yourself.');
    }
  };

  return (
        <div className="space-y-4">
          <div>
            <label htmlFor="share-link" className="block text-xs font-semibold text-[var(--muted)] uppercase tracking-wider mb-1.5">Link</label>
            <div className="flex items-center gap-2">
              <input
                id="share-link"
                readOnly
                value={link.url}
                onFocus={e => e.currentTarget.select()}
                className="flex-1 min-w-0 text-xs font-mono px-3 py-2 rounded-lg border border-[var(--border)] bg-[var(--panel-subtle)] text-[var(--text)]"
              />
              <Button type="button" variant="primary" size="sm" onClick={copy} leftIcon={copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}>
                {copied ? 'Copied' : 'Copy'}
              </Button>
            </div>
          </div>
          <p className="text-xs text-[var(--muted)] leading-relaxed">
            {link.note} It’s only shown once. If it’s lost, create a new one.
          </p>
          <div className="flex items-center justify-end pt-4 border-t border-[var(--border)]">
            <Button type="button" variant="secondary" size="sm" onClick={onClose}>Done</Button>
          </div>
        </div>
  );
}
