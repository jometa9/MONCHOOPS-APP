import { useTranslation } from 'react-i18next';
import { monchoops } from '@/lib/monchoops';
import { cn } from '@/lib/cn';
import type { JobKind, ScrapeResultPublic } from '@/types/domain';

interface Props {
  kind: JobKind;
  params: unknown;
  targetName: string | null;
  className?: string;
}

export function ScrapeSummary({ kind, params, targetName, className }: Props) {
  const { t } = useTranslation();
  const p = (params && typeof params === 'object' ? params : {}) as Record<string, unknown>;

  switch (kind) {
    case 'scrape_by_username': {
      const username = String(p.username ?? '').replace(/^@+/, '').trim() || null;
      return (
        <span className={cn('inline-flex items-center gap-1', className)}>
          {t('components.scrapeSummary.followersOf')}{' '}
          {username ? <ProfileLink username={username} /> : <Unknown label={t('components.scrapeSummary.profile')} />}
        </span>
      );
    }
    case 'scrape_by_post': {
      const url = String(p.postUrl ?? '').trim() || null;
      const isReel = url ? /\/reel\//.test(url) : false;
      return (
        <span className={cn('inline-flex items-center gap-1', className)}>
          {t('components.scrapeSummary.engagersOf')}{' '}
          {url ? (
            <ExternalLinkWord
              url={url}
              label={isReel ? t('components.scrapeSummary.reel') : t('components.scrapeSummary.post')}
            />
          ) : (
            <Unknown label={t('components.scrapeSummary.post')} />
          )}
          {targetName ? (
            <>
              <span>{t('components.scrapeSummary.by')}</span>
              <ProfileLink username={targetName.replace(/^@+/, '')} />
            </>
          ) : null}
        </span>
      );
    }
    case 'scrape_by_hashtag': {
      const hashtag = String(p.hashtag ?? '').replace(/^#+/, '').trim() || null;
      return (
        <span className={cn('inline-flex items-center gap-1', className)}>
          {t('components.scrapeSummary.engagersOf')}{' '}
          {hashtag ? <HashtagLink hashtag={hashtag} /> : <Unknown label={t('components.scrapeSummary.hashtag')} />}
        </span>
      );
    }
    case 'scrape_by_location': {
      const url = String(p.locationUrl ?? '').trim() || null;
      return (
        <span className={cn('inline-flex items-center gap-1', className)}>
          {t('components.scrapeSummary.engagersAt')}{' '}
          {url ? (
            <ExternalLinkWord url={url} label={targetName ?? t('components.scrapeSummary.location')} />
          ) : (
            <Unknown label={targetName ?? t('components.scrapeSummary.location')} />
          )}
        </span>
      );
    }
    default:
      return <span className={className}>{t('components.scrapeSummary.scrapeResult')}</span>;
  }
}

function Unknown({ label }: { label: string }) {
  return <span>{label}</span>;
}

export function ExternalLinkWord({ url, label }: { url: string; label: string }) {
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        void monchoops.openExternalLink(url);
      }}
      className="font-medium underline decoration-dotted underline-offset-2"
    >
      {label}
    </button>
  );
}

function ProfileLink({ username }: { username: string }) {
  const url = `https://www.instagram.com/${encodeURIComponent(username)}/`;
  return <ExternalLinkWord url={url} label={`@${username}`} />;
}

export function HashtagLink({ hashtag }: { hashtag: string }) {
  const clean = hashtag.replace(/^#+/, '');
  const url = `https://www.instagram.com/explore/tags/${encodeURIComponent(clean)}/`;
  return <ExternalLinkWord url={url} label={`#${clean}`} />;
}

export function ScrapeSummaryOf({
  row,
  className,
}: {
  row: Pick<ScrapeResultPublic, 'kind' | 'params' | 'targetName'>;
  className?: string;
}) {
  return (
    <ScrapeSummary
      kind={row.kind}
      params={row.params}
      targetName={row.targetName}
      className={className}
    />
  );
}
