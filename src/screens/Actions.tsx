import { useTranslation } from 'react-i18next';
import { MessageSquare, Search } from 'lucide-react';
import { Link } from 'react-router-dom';

export function Actions() {
  const { t } = useTranslation();
  return (
    <div className="mx-auto max-w-4xl px-8 py-10">
      <h1 className="text-2xl font-semibold tracking-tight">{t('screens.actions.title')}</h1>
      <p className="mt-1 text-sm text-muted-foreground">{t('screens.actions.subtitle')}</p>
      <div className="mt-8 grid gap-4 sm:grid-cols-2">
        <Link
          to="/actions/mass-dms"
          className="flex items-start gap-3 rounded-xl border border-border bg-background p-5 transition-colors hover:bg-accent/50"
        >
          <MessageSquare className="mt-0.5 h-5 w-5 text-primary" />
          <div>
            <div className="font-medium">{t('screens.actions.massDmsTitle')}</div>
            <p className="text-xs text-muted-foreground">{t('screens.actions.massDmsDescription')}</p>
          </div>
        </Link>
        <Link
          to="/actions/scrape"
          className="flex items-start gap-3 rounded-xl border border-border bg-background p-5 transition-colors hover:bg-accent/50"
        >
          <Search className="mt-0.5 h-5 w-5 text-primary" />
          <div>
            <div className="font-medium">{t('screens.actions.scrapeTitle')}</div>
            <p className="text-xs text-muted-foreground">{t('screens.actions.scrapeDescription')}</p>
          </div>
        </Link>
      </div>
    </div>
  );
}
