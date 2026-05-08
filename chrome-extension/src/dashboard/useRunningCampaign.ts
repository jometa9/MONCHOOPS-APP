import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '@/shared/db';
import type { Campaign } from '@/shared/types';

export function useRunningCampaign(): Campaign | undefined {
  return useLiveQuery(
    () => db.campaigns.where('status').equals('running').first(),
    []
  );
}
