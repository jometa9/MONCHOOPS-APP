import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ArrowDownCircle, Download } from 'lucide-react';
import { b2dm, type UpdateStatus } from '@/lib/b2dm';

const PREVIEW: UpdateStatus | null = null;

export function UpdateBanner() {
  const { t } = useTranslation();
  const [state, setState] = useState<UpdateStatus>(PREVIEW ?? { kind: 'idle' });

  useEffect(() => {
    if (PREVIEW) return;
    let cancelled = false;
    void b2dm.updater.getState().then((s) => {
      if (!cancelled) setState(s);
    });
    const off = b2dm.updater.onStateChange((s) => setState(s));
    return () => {
      cancelled = true;
      off();
    };
  }, []);

  if (state.kind !== 'available') return null;

  return (
    <div className="mb-6 flex items-center justify-between gap-3 border border-border bg-muted/40 px-4 py-3">
      <div className="flex min-w-0 items-center gap-3">
        <ArrowDownCircle className="h-4 w-4 text-foreground" />
        <div className="min-w-0">
          <div className="truncate text-sm font-medium">
            {t('components.updateBanner.available', { version: state.version })}
          </div>
          <div className="truncate text-xs text-muted-foreground">
            {t('components.updateBanner.availableHint')}
          </div>
        </div>
      </div>

      <button
        type="button"
        onClick={() => void b2dm.updater.openDownload()}
        className="inline-flex h-9 shrink-0 items-center gap-1.5 bg-primary px-3 text-xs font-medium text-primary-foreground transition-colors hover:bg-primary/90"
      >
        <Download className="h-3.5 w-3.5" />
        {t('components.updateBanner.download')}
      </button>
    </div>
  );
}
