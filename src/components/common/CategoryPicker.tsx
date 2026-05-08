import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Check, Plus, Tag, X } from 'lucide-react';
import { monchoops } from '@/lib/monchoops';
import { cn } from '@/lib/cn';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/common/Spinner';
import type { LeadCategoryPublic } from '@/types/domain';

export type CategorySelection =
  | { mode: 'none' }
  | { mode: 'existing'; categoryId: string };

interface Props {
  value: CategorySelection;
  onChange: (selection: CategorySelection) => void;
  disabled?: boolean;
}

export function CategoryPicker({ value, onChange, disabled }: Props) {
  const { t } = useTranslation();
  const [categories, setCategories] = useState<LeadCategoryPublic[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [drafting, setDrafting] = useState(false);
  const [draftName, setDraftName] = useState('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const list = await monchoops.categories.list();
        if (!cancelled) setCategories(list);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void load();
    const off = monchoops.categories.onChange(() => void load());
    return () => {
      cancelled = true;
      off();
    };
  }, []);

  async function createCategory() {
    const name = draftName.trim();
    if (!name || creating) return;
    setCreating(true);
    setError(null);
    try {
      const existing = categories.find(
        (c) => c.name.toLowerCase() === name.toLowerCase()
      );
      const cat = existing ?? (await monchoops.categories.create(name));
      onChange({ mode: 'existing', categoryId: cat.id });
      setDrafting(false);
      setDraftName('');
    } catch (err) {
      setError(err instanceof Error ? err.message : t('components.categoryPicker.couldNotCreate'));
    } finally {
      setCreating(false);
    }
  }

  function cancelDraft() {
    setDrafting(false);
    setDraftName('');
    setError(null);
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2">
        <Chip
          active={value.mode === 'none'}
          disabled={disabled}
          onClick={() => onChange({ mode: 'none' })}
        >
          <Tag className="h-3 w-3" />
          {t('components.categoryPicker.noCategory')}
        </Chip>
        {loading ? (
          <span className="text-xs text-muted-foreground">{t('common.loading')}</span>
        ) : (
          categories.map((cat) => (
            <Chip
              key={cat.id}
              active={value.mode === 'existing' && value.categoryId === cat.id}
              disabled={disabled}
              onClick={() => onChange({ mode: 'existing', categoryId: cat.id })}
            >
              <Tag className="h-3 w-3" />
              {cat.name}
              <span className="ml-1 text-[10px] text-muted-foreground tabular-nums">
                {cat.leadCount}
              </span>
            </Chip>
          ))
        )}
        {!drafting ? (
          <Chip
            active={false}
            disabled={disabled}
            onClick={() => setDrafting(true)}
          >
            <Plus className="h-3 w-3" />
            {t('components.categoryPicker.createNew')}
          </Chip>
        ) : null}
      </div>

      {drafting ? (
        <div className="flex flex-wrap items-center gap-2">
          <Input
            autoFocus
            value={draftName}
            onChange={(e) => setDraftName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                void createCategory();
              } else if (e.key === 'Escape') {
                e.preventDefault();
                cancelDraft();
              }
            }}
            placeholder={t('components.categoryPicker.namePlaceholder')}
            disabled={disabled || creating}
            className="max-w-xs"
          />
          <Button
            type="button"
            size="sm"
            onClick={() => void createCategory()}
            disabled={disabled || creating || draftName.trim().length === 0}
          >
            {creating ? <Spinner /> : <Check className="h-4 w-4" />}
            {t('components.categoryPicker.create')}
          </Button>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={cancelDraft}
            disabled={creating}
          >
            <X className="h-4 w-4" />
            {t('common.cancel')}
          </Button>
        </div>
      ) : null}

      {error ? <p className="text-xs text-destructive">{error}</p> : null}
    </div>
  );
}

function Chip({
  active,
  disabled,
  onClick,
  children,
}: {
  active: boolean;
  disabled?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={cn(
        'inline-flex items-center gap-1.5 border px-2.5 py-1 text-xs transition-colors disabled:cursor-not-allowed disabled:opacity-60',
        active
          ? 'border-primary bg-primary/10 text-foreground'
          : 'border-border bg-background text-muted-foreground hover:bg-accent'
      )}
    >
      {children}
    </button>
  );
}
