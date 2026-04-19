import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, ExternalLink, Search, Users } from 'lucide-react';
import { EmptyState } from '@/components/common/EmptyState';
import { Spinner } from '@/components/common/Spinner';
import { b2dm } from '@/lib/b2dm';
import { formatDateTime } from '@/lib/format';
import type { LeadCategoryPublic, LeadPublic } from '@/types/domain';

export function CategoryLeadsDetail() {
  const { categoryId = '' } = useParams<{ categoryId: string }>();
  const navigate = useNavigate();
  const [category, setCategory] = useState<LeadCategoryPublic | null>(null);
  const [leads, setLeads] = useState<LeadPublic[] | null>(null);
  const [query, setQuery] = useState('');

  useEffect(() => {
    let cancelled = false;
    async function load() {
      const [list, cats] = await Promise.all([
        b2dm.categories.listLeads({ categoryId, limit: 1000 }),
        b2dm.categories.list(),
      ]);
      if (cancelled) return;
      setLeads(list);
      setCategory(cats.find((c) => c.id === categoryId) ?? null);
    }
    void load();
    return () => { cancelled = true; };
  }, [categoryId]);

  const filteredLeads = useMemo(() => {
    if (!leads) return null;
    const q = query.trim().toLowerCase();
    if (!q) return leads;
    return leads.filter((lead) => lead.username.toLowerCase().includes(q));
  }, [leads, query]);

  function goBack() {
    navigate('/categories');
  }

  if (leads === null) {
    return (
      <div className="flex h-full items-center justify-center">
        <Spinner className="h-6 w-6 text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="bg-background">
      <div className="sticky top-0 z-20 flex items-stretch border-b border-border bg-background">
        <button
          type="button"
          onClick={goBack}
          className="inline-flex h-9 items-center gap-1.5 border-r border-border bg-transparent px-3 text-xs font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          aria-label="Back to categories"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          Back
        </button>
        <div className="relative min-w-0 flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search username…"
            className="h-9 w-full bg-transparent pl-9 pr-3 text-sm outline-none placeholder:text-muted-foreground"
          />
        </div>
        {category ? (
          <div className="flex items-center gap-2 border-l border-border px-3 text-xs text-muted-foreground">
            <span className="truncate">{category.name}</span>
            <span className="tabular-nums">· {leads.length}</span>
          </div>
        ) : null}
      </div>

      {leads.length === 0 ? (
        <EmptyState
          icon={<Users className="h-10 w-10" />}
          title="No leads yet"
          description="Run a scrape tagged with this category to populate it."
        />
      ) : (
        <table className="w-full whitespace-nowrap text-sm">
          <thead className="sticky top-9 z-10 border-t border-border bg-muted text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
            <tr>
              <th className="px-3 py-1.5 text-left">Username</th>
              <th className="px-3 py-1.5 text-left">Source</th>
              <th className="px-3 py-1.5 text-left">Added</th>
              <th className="px-3 py-1.5 text-right">Profile</th>
            </tr>
          </thead>
          <tbody>
            {filteredLeads!.length === 0 ? (
              <tr className="border-t border-border last:border-b">
                <td colSpan={4} className="px-3 py-10 text-center text-sm text-muted-foreground">
                  No leads match your search.
                </td>
              </tr>
            ) : (
              filteredLeads!.map((lead) => {
                const openProfile = () =>
                  void b2dm.openExternalLink(
                    `https://www.instagram.com/${encodeURIComponent(lead.username)}/`
                  );
                return (
                  <tr
                    key={lead.id}
                    onClick={openProfile}
                    className="cursor-pointer border-t border-border transition-colors even:bg-muted/30 last:border-b hover:bg-accent/40"
                  >
                    <td className="px-3 py-1.5 font-medium">@{lead.username}</td>
                    <td className="px-3 py-1.5 text-xs text-muted-foreground">
                      {lead.sourceDetail ?? lead.sourceKind}
                    </td>
                    <td className="px-3 py-1.5 text-xs text-muted-foreground">
                      {formatDateTime(lead.scrapedAt)}
                    </td>
                    <td className="px-2 py-1.5">
                      <div className="flex items-center justify-end">
                        <button
                          type="button"
                          onClick={(e) => { e.stopPropagation(); openProfile(); }}
                          className="inline-flex h-7 w-7 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                          title={`Open @${lead.username} on Instagram`}
                          aria-label={`Open @${lead.username} on Instagram`}
                        >
                          <ExternalLink className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      )}

      {leads.length >= 1000 ? (
        <div className="border-t border-border bg-muted/20 px-3 py-2 text-[11px] text-muted-foreground">
          Showing first 1000 rows — export the CSV for the full list.
        </div>
      ) : null}
    </div>
  );
}
