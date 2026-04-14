import { MessageSquare, Search } from 'lucide-react';
import { Link } from 'react-router-dom';

export function Actions() {
  return (
    <div className="mx-auto max-w-4xl px-8 py-10">
      <h1 className="text-2xl font-semibold tracking-tight">Actions</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        Pick what you want to run. You'll be asked to select an Instagram account next.
      </p>
      <div className="mt-8 grid gap-4 sm:grid-cols-2">
        <Link
          to="/actions/mass-dms"
          className="flex items-start gap-3 rounded-xl border border-border bg-background p-5 transition-colors hover:bg-accent/50"
        >
          <MessageSquare className="mt-0.5 h-5 w-5 text-primary" />
          <div>
            <div className="font-medium">Mass DMs</div>
            <p className="text-xs text-muted-foreground">
              Send a message to a list of usernames, with a configurable interval.
            </p>
          </div>
        </Link>
        <Link
          to="/actions/scrape"
          className="flex items-start gap-3 rounded-xl border border-border bg-background p-5 transition-colors hover:bg-accent/50"
        >
          <Search className="mt-0.5 h-5 w-5 text-primary" />
          <div>
            <div className="font-medium">Scrape usernames</div>
            <p className="text-xs text-muted-foreground">
              Pull usernames from a profile's followers, comments, hashtags, or locations.
            </p>
          </div>
        </Link>
      </div>
    </div>
  );
}
