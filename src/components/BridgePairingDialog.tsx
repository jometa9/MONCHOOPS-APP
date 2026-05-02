import { useEffect, useState } from 'react';
import { Dialog } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { b2dm } from '@/lib/b2dm';
import type { BridgePairRequest } from '@/lib/b2dm';

// Renders the "Allow extension to read your leads?" modal whenever a
// Chrome extension hits POST /pair on the local bridge. Mounted once at
// the app shell level so any screen can be on top — the modal sits over
// everything until the user accepts or rejects.

export function BridgePairingDialog() {
  const [request, setRequest] = useState<BridgePairRequest | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    return b2dm.bridge.onPairRequest((req) => {
      // If a second pairing request arrives while one is open, replace
      // it. The previous one will time out on the bridge side after 5
      // minutes; queueing here would just confuse the user.
      setRequest(req);
    });
  }, []);

  if (!request) return null;

  async function resolve(accept: boolean) {
    if (!request) return;
    setBusy(true);
    try {
      await b2dm.bridge.resolvePairing(request.pairingId, accept);
    } finally {
      setBusy(false);
      setRequest(null);
    }
  }

  return (
    <Dialog
      open
      onClose={() => {
        if (!busy) void resolve(false);
      }}
      title="Connect Chrome extension?"
      description="Only accept if you just clicked “Connect” inside the B2DM Chrome extension."
      className="max-w-md"
      footer={
        <>
          <Button variant="ghost" onClick={() => void resolve(false)} disabled={busy}>
            Reject
          </Button>
          <Button onClick={() => void resolve(true)} disabled={busy}>
            {busy ? 'Allowing…' : 'Allow access'}
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <div className="border border-border bg-muted/30 p-3">
          <div className="text-[11px] uppercase tracking-wide text-muted-foreground">Client</div>
          <div className="mt-1 text-sm font-medium">{request.name}</div>
        </div>

        <div className="border border-border bg-muted/30 p-3">
          <div className="text-[11px] uppercase tracking-wide text-muted-foreground">
            Verification code
          </div>
          <div className="mt-1 font-mono text-3xl font-bold tracking-[0.5em]">
            {request.code}
          </div>
          <p className="mt-2 text-xs text-muted-foreground">
            Make sure this matches the code shown by the extension. If it doesn't, reject.
          </p>
        </div>

        <p className="text-xs text-muted-foreground">
          The extension will be able to read your lead categories and scrape results. You can
          revoke access anytime from Settings.
        </p>
      </div>
    </Dialog>
  );
}
