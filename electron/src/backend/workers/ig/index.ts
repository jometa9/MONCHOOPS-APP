// Public surface of the Instagram worker primitives. Workers import from
// here rather than reaching into individual files so we can reorganise
// internals without touching callers.

export { ensureLoggedIn } from './login';
export type { EnsureLoggedInOpts } from './login';

export {
  attachDialogDismisser,
  dismissIgPrompts,
  dismissNotificationsPrompt,
  dismissSaveLoginPrompt,
} from './dialogs';

export { waitForPageReady, waitForLocatorReady } from './network';

export { iterUserPosts, iterUserReels, getFollowers } from './profile';
export type { FollowersOpts } from './profile';

export { getCommenters, getLikers, readPostAuthor } from './post';
export type { LikersResult, ExtractOpts } from './post';

export {
  iterPostsByHashtag,
  iterPostsByLocation,
  readLocationName,
  gotoHashtagGrid,
  gotoLocationGrid,
  iteratePostsOnGrid,
} from './search';
export type { LocationSearchOpts } from './search';

export {
  likePost,
  followUser,
  likeNPostsOfUser,
  viewFeed,
  viewExplore,
  viewReels,
  iterHashtagAndAct,
  iterLocationAndAct,
} from './interactions';
export type {
  InteractionOutcome,
  LikeNResult,
  HashtagActOpts,
  HashtagActResult,
} from './interactions';
