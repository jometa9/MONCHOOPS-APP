import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '@/shared/db';
import type { Campaign } from '@/shared/types';

/** Returns the currently-running campaign if any. The dashboard locks
 *  navigation while this is non-null so the user cannot start a second
 *  campaign in parallel — the IG content script can only handle one
 *  send at a time and stacking campaigns races the SW tick. */
export function useRunningCampaign(): Campaign | undefined {
  return useLiveQuery(
    () => db.campaigns.where('status').equals('running').first(),
    []
  );
}
