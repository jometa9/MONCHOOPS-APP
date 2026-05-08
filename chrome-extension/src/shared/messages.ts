

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
  | { type: 'b2dm/ping' }
  | { type: 'b2dm/url' }
  | { type: 'b2dm/dismissPrompts' }
  | { type: 'b2dm/checkOnStories' }
  | { type: 'b2dm/dwellStory'; dwellMs: number }
  | { type: 'b2dm/detectFollowState' }
  | { type: 'b2dm/clickFollow' }
  | { type: 'b2dm/findPostUrls'; n: number }
  | { type: 'b2dm/detectLikeState' }
  | { type: 'b2dm/clickLike' }
  | { type: 'b2dm/waitForComposer'; timeoutMs?: number }
  | { type: 'b2dm/openNewDmDialog' }
  | { type: 'b2dm/pickFirstSearchResult'; username: string }
  | { type: 'b2dm/typeAndSendDm'; message: string }
  | { type: 'b2dm/threadContains'; needle: string }
  | { type: 'b2dm/waitForUrlMatch'; pattern: string; timeoutMs?: number };

export type CsResponse =
  | { ok: true; data?: unknown }
  | { ok: false; error: string };

export interface CsUrlData { url: string }
export interface CsBoolData { value: boolean }
export interface CsDwellData { stillOnStories: boolean }
export interface CsFollowData { state: FollowState }
export interface CsLikeData { state: LikeState }
export interface CsPostsData { urls: string[] }
