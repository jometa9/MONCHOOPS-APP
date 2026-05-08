

import type { FollowState, LikeState } from '@/content/ig-actions';

export type SwRequest =
  | { type: 'sw/ping' }
  | { type: 'sw/openDashboard' }
  | { type: 'sw/igSessionCheck' }
  | { type: 'sw/pauseCampaign'; campaignId: string }
  | { type: 'sw/resumeCampaign'; campaignId: string }
  | { type: 'sw/runCampaignNow'; campaignId: string };

export interface SwResponse {
  ok: boolean;
  error?: string;
  data?: unknown;
}

export type IgSendResult =
  | { ok: true; verified: boolean }
  | { ok: false; error: string };

export type CsRequest =
  | { type: 'monchoops/ping' }
  | { type: 'monchoops/url' }
  | { type: 'monchoops/dismissPrompts' }
  | { type: 'monchoops/checkOnStories' }
  | { type: 'monchoops/dwellStory'; dwellMs: number }
  | { type: 'monchoops/detectFollowState' }
  | { type: 'monchoops/clickFollow' }
  | { type: 'monchoops/findPostUrls'; n: number }
  | { type: 'monchoops/detectLikeState' }
  | { type: 'monchoops/clickLike' }
  | { type: 'monchoops/waitForComposer'; timeoutMs?: number }
  | { type: 'monchoops/openNewDmDialog' }
  | { type: 'monchoops/pickFirstSearchResult'; username: string }
  | { type: 'monchoops/typeAndSendDm'; message: string }
  | { type: 'monchoops/threadContains'; needle: string }
  | { type: 'monchoops/waitForUrlMatch'; pattern: string; timeoutMs?: number };

export type CsResponse =
  | { ok: true; data?: unknown }
  | { ok: false; error: string };

export interface CsUrlData { url: string }
export interface CsBoolData { value: boolean }
export interface CsDwellData { stillOnStories: boolean }
export interface CsFollowData { state: FollowState }
export interface CsLikeData { state: LikeState }
export interface CsPostsData { urls: string[] }
