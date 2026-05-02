// Wire protocol between extension contexts. The service worker is the
// single authority — popup, dashboard, and content script all talk to it.
// Keeping every payload typed here means the SW switch and the senders
// can't drift apart silently.

import type { InteractionsConfig } from './types';

export type SwRequest =
  | { type: 'sw/ping' }
  | { type: 'sw/openDashboard' }
  | { type: 'sw/igSessionCheck' }
  | { type: 'sw/scheduleCampaign'; campaignId: string }
  | { type: 'sw/pauseCampaign'; campaignId: string }
  | { type: 'sw/resumeCampaign'; campaignId: string }
  | { type: 'sw/runCampaignNow'; campaignId: string };

export interface SwResponse {
  ok: boolean;
  error?: string;
  data?: unknown;
}

// content-script ↔ service-worker for executing one DM
export interface IgSendRequest {
  type: 'ig/sendDm';
  username: string;
  message: string;
  interactions: InteractionsConfig | null;
}

export type IgSendResult =
  | { ok: true; verified: boolean }
  | { ok: false; error: string };
