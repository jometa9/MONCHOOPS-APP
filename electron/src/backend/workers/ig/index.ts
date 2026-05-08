

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
  followUser,
  likeNPostsOfUser,
} from './interactions';
export type {
  InteractionOutcome,
  LikeNResult,
} from './interactions';

export { viewUserStories } from './stories';
export type {
  UserStoriesOpts,
  UserStoriesResult,
} from './stories';
