import { useEffect, useState } from 'react';
import { b2dm } from '@/lib/b2dm';
import { cn } from '@/lib/cn';

// Draggable title-bar region for the frameless window. On macOS the traffic
// lights are provided by Electron (hiddenInset). On Windows the overlay is
// provided by `titleBarOverlay` in main.ts.
export function TitleBar({ title = 'B2DM' }: { title?: string }) {
  const [platform, setPlatform] = useState<NodeJS.Platform | null>(null);
  const [fullScreen, setFullScreen] = useState(false);

  useEffect(() => {
    void b2dm.getPlatform().then(setPlatform);
    void b2dm.getIsFullScreen().then(setFullScreen);
    const off = b2dm.onFullScreenChange(setFullScreen);
    return off;
  }, []);

  const isMac = platform === 'darwin';

  return (
    <div
      className={cn(
        'titlebar flex items-center justify-center border-b border-border bg-background/90 backdrop-blur',
        isMac && !fullScreen ? 'pl-20' : ''
      )}
    >
      <span className="text-xs font-medium text-muted-foreground">{title}</span>
    </div>
  );
}
