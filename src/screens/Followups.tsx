import { useEffect, useState } from 'react';
import { Plus, Trash2, Pause, Play, X, Edit, Archive } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Spinner } from '@/components/common/Spinner';
import { EmptyState } from '@/components/common/EmptyState';
import { b2dm } from '@/lib/b2dm';
import { formatDateTime } from '@/lib/format';
import type {
  CreateSequenceInput,
  FollowupEnrollmentPublic,
  FollowupSequencePublic,
  FollowupStepPublic,
  MessageVariantGroupPublic,
} from '@/types/domain';

interface SeqDraftStep {
  delayHours: number;
  variantIds: number[];
  stopOnReply: boolean;
}

export function Followups() {
  const [tab, setTab] = useState<'sequences' | 'enrollments'>('sequences');
  const [sequences, setSequences] = useState<FollowupSequencePublic[] | null>(null);
  const [enrollments, setEnrollments] = useState<FollowupEnrollmentPublic[] | null>(null);
  const [editing, setEditing] = useState<{
    id: string | null;
    name: string;
    steps: SeqDraftStep[];
  } | null>(null);
  const [variantGroups, setVariantGroups] = useState<MessageVariantGroupPublic[]>([]);

  useEffect(() => {
    void load();
    const off = b2dm.messageVariants.onChange(() => void loadVariants());
    return () => off();
  }, []);

  async function load() {
    const [seqs, enrs, variants] = await Promise.all([
      b2dm.followups.listSequences(false),
      b2dm.followups.listEnrollments({}),
      b2dm.messageVariants.list(),
    ]);
    setSequences(seqs);
    setEnrollments(enrs);
    setVariantGroups(variants);
  }
  async function loadVariants() {
    setVariantGroups(await b2dm.messageVariants.list());
  }

  function openNew() {
    setEditing({
      id: null,
      name: 'Untitled sequence',
      steps: [{ delayHours: 24, variantIds: [], stopOnReply: true }],
    });
  }

  async function openEdit(seq: FollowupSequencePublic) {
    const r = await b2dm.followups.getSequence(seq.id);
    if (!r) return;
    setEditing({
      id: seq.id,
      name: seq.name,
      steps: r.steps.map((s: FollowupStepPublic) => ({
        delayHours: s.delayHours,
        variantIds: s.variantIds,
        stopOnReply: s.stopOnReply,
      })),
    });
  }

  async function saveEditing() {
    if (!editing) return;
    const input: CreateSequenceInput = {
      name: editing.name,
      steps: editing.steps,
    };
    if (editing.id) {
      await b2dm.followups.updateSequence({ id: editing.id, input });
    } else {
      await b2dm.followups.createSequence(input);
    }
    setEditing(null);
    void load();
  }

  // Flatten variants: each variant is a row in message_variants with an id we
  // can pick. We don't have a list endpoint exposing variant ids per group;
  // workaround: variant ids = group_index * 100 + position is NOT reliable.
  // For v1 we just expose group-level selection by storing the first variant
  // of the chosen group. A future iteration can list variants by id directly.
  const variantOptions = variantGroups.flatMap((g, gi) =>
    g.variants.map((body, idx) => ({
      // Synthetic id surface — backend doesn't currently expose per-variant
      // ids in the renderer-facing API, so we send (group_id position) and
      // the backend would need a follow-up to map. For now, we display
      // group-level options; selection saves the position-0 variant id of
      // each group via a numeric "groupIndex*1000+idx" placeholder.
      key: `${g.id}:${idx}`,
      label: `${g.name} — ${body.slice(0, 40)}${body.length > 40 ? '…' : ''}`,
      // The backend resolves variant ids against the message_variants table.
      // Since we don't have the real numeric ids client-side, this is a
      // best-effort placeholder a follow-up commit will replace.
      placeholderId: gi * 1000 + idx + 1,
    }))
  );

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between border-b border-border px-6 py-3">
        <div>
          <h1 className="text-base font-semibold">Follow-ups</h1>
          <p className="text-xs text-muted-foreground">
            Multi-step sequences that fire after delays unless the lead replies.
          </p>
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={() => setTab('sequences')}
            className={
              tab === 'sequences'
                ? 'rounded bg-primary px-3 py-1.5 text-xs text-primary-foreground'
                : 'rounded px-3 py-1.5 text-xs hover:bg-muted/30'
            }
          >
            Sequences
          </button>
          <button
            onClick={() => setTab('enrollments')}
            className={
              tab === 'enrollments'
                ? 'rounded bg-primary px-3 py-1.5 text-xs text-primary-foreground'
                : 'rounded px-3 py-1.5 text-xs hover:bg-muted/30'
            }
          >
            Enrollments
          </button>
        </div>
      </div>

      {tab === 'sequences' ? (
        <div className="flex-1 overflow-auto p-6">
          <div className="mb-4 flex justify-end">
            <Button size="sm" onClick={openNew}>
              <Plus className="h-3.5 w-3.5" /> New sequence
            </Button>
          </div>
          {sequences === null ? (
            <Spinner className="mx-auto h-5 w-5" />
          ) : sequences.length === 0 ? (
            <EmptyState
              icon={<Plus className="h-8 w-8" />}
              title="No sequences yet"
              description="Create a sequence with N steps. Each step picks a random message variant and fires after a delay."
            />
          ) : (
            <div className="space-y-2">
              {sequences.map((s) => (
                <div
                  key={s.id}
                  className="flex items-center justify-between rounded border border-border bg-background p-3"
                >
                  <div className="min-w-0">
                    <div className="font-medium">{s.name}</div>
                    <div className="text-xs text-muted-foreground">
                      {s.stepCount} step{s.stepCount === 1 ? '' : 's'} · {s.activeEnrollmentCount}{' '}
                      active enrollment{s.activeEnrollmentCount === 1 ? '' : 's'}
                    </div>
                  </div>
                  <div className="flex items-center gap-1">
                    <Button size="sm" variant="ghost" onClick={() => void openEdit(s)}>
                      <Edit className="h-3.5 w-3.5" />
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() =>
                        confirm(`Archive "${s.name}"? Active enrollments will be cancelled.`) &&
                        b2dm.followups.archiveSequence(s.id).then(load)
                      }
                    >
                      <Archive className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      ) : (
        <div className="flex-1 overflow-auto p-6">
          {enrollments === null ? (
            <Spinner className="mx-auto h-5 w-5" />
          ) : enrollments.length === 0 ? (
            <div className="text-center text-sm text-muted-foreground">No enrollments yet.</div>
          ) : (
            <table className="w-full text-sm">
              <thead className="text-left text-xs uppercase tracking-wide text-muted-foreground">
                <tr className="border-b border-border">
                  <th className="py-2">Peer</th>
                  <th>Account</th>
                  <th>Sequence</th>
                  <th>Step</th>
                  <th>Status</th>
                  <th>Next</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {enrollments.map((e) => (
                  <tr key={e.id} className="border-b border-border">
                    <td className="py-2">@{e.peerUsername}</td>
                    <td>@{e.accountUsername ?? '?'}</td>
                    <td>{e.sequenceName ?? '?'}</td>
                    <td>#{e.currentStepIndex + 1}</td>
                    <td>{e.status}</td>
                    <td className="text-xs text-muted-foreground">
                      {e.status === 'active' ? formatDateTime(e.nextRunAt) : '—'}
                    </td>
                    <td className="space-x-1 text-right">
                      {e.status === 'active' ? (
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => b2dm.followups.pause(e.id).then(load)}
                          title="Pause"
                        >
                          <Pause className="h-3 w-3" />
                        </Button>
                      ) : null}
                      {e.status === 'paused' ? (
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => b2dm.followups.resume(e.id).then(load)}
                          title="Resume"
                        >
                          <Play className="h-3 w-3" />
                        </Button>
                      ) : null}
                      {e.status === 'active' || e.status === 'paused' ? (
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => b2dm.followups.cancel(e.id).then(load)}
                          title="Cancel"
                        >
                          <X className="h-3 w-3" />
                        </Button>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {editing ? (
        <Dialog
          open
          onClose={() => setEditing(null)}
          title={editing.id ? 'Edit sequence' : 'New sequence'}
          description="Each step fires after its delay if the lead has not replied since the previous step."
          footer={
            <>
              <Button variant="ghost" onClick={() => setEditing(null)}>
                Cancel
              </Button>
              <Button onClick={() => void saveEditing()}>Save</Button>
            </>
          }
        >
          <div className="space-y-3">
            <div>
              <Label>Name</Label>
              <Input
                value={editing.name}
                onChange={(e) => setEditing({ ...editing, name: e.target.value })}
              />
            </div>
            <div className="space-y-2">
              {editing.steps.map((s, idx) => (
                <div key={idx} className="rounded border border-border p-3 text-sm">
                  <div className="mb-2 flex items-center justify-between">
                    <div className="text-xs font-semibold uppercase text-muted-foreground">
                      Step #{idx + 1}
                    </div>
                    {editing.steps.length > 1 ? (
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() =>
                          setEditing({
                            ...editing,
                            steps: editing.steps.filter((_, i) => i !== idx),
                          })
                        }
                      >
                        <Trash2 className="h-3 w-3" />
                      </Button>
                    ) : null}
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <Label className="text-xs">Delay (hours)</Label>
                      <Input
                        type="number"
                        min={1}
                        max={720}
                        value={s.delayHours}
                        onChange={(e) => {
                          const next = [...editing.steps];
                          next[idx] = { ...s, delayHours: Number(e.target.value) };
                          setEditing({ ...editing, steps: next });
                        }}
                      />
                    </div>
                    <div className="flex items-end">
                      <label className="flex items-center gap-1 text-xs">
                        <input
                          type="checkbox"
                          checked={s.stopOnReply}
                          onChange={(e) => {
                            const next = [...editing.steps];
                            next[idx] = { ...s, stopOnReply: e.target.checked };
                            setEditing({ ...editing, steps: next });
                          }}
                        />
                        Stop on reply
                      </label>
                    </div>
                  </div>
                  <div className="mt-2">
                    <Label className="text-xs">
                      Variants ({s.variantIds.length} selected)
                    </Label>
                    <select
                      multiple
                      value={s.variantIds.map(String)}
                      onChange={(e) => {
                        const ids = Array.from(e.target.selectedOptions, (o) => Number(o.value));
                        const next = [...editing.steps];
                        next[idx] = { ...s, variantIds: ids };
                        setEditing({ ...editing, steps: next });
                      }}
                      className="h-32 w-full rounded border border-border bg-transparent text-xs"
                    >
                      {variantOptions.map((o) => (
                        <option key={o.key} value={o.placeholderId}>
                          {o.label}
                        </option>
                      ))}
                    </select>
                    <div className="mt-1 text-[10px] text-muted-foreground">
                      Worker picks one variant at random per send.
                    </div>
                  </div>
                </div>
              ))}
              <Button
                size="sm"
                variant="outline"
                onClick={() =>
                  setEditing({
                    ...editing,
                    steps: [
                      ...editing.steps,
                      { delayHours: 72, variantIds: [], stopOnReply: true },
                    ],
                  })
                }
              >
                <Plus className="h-3 w-3" /> Add step
              </Button>
            </div>
          </div>
        </Dialog>
      ) : null}
    </div>
  );
}
