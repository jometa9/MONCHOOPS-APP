import { useEffect, useState } from 'react';
import { monchoops } from '@/lib/monchoops';
import { cn } from '@/lib/cn';

interface TitleBarProps {
  title?: string;
  transparent?: boolean;
}

export function TitleBar({ title = 'MonchoOps', transparent = false }: TitleBarProps) {
  const [platform, setPlatform] = useState<NodeJS.Platform | null>(null);
  const [fullScreen, setFullScreen] = useState(false);

  useEffect(() => {
    void monchoops.getPlatform().then(setPlatform);
    void monchoops.getIsFullScreen().then(setFullScreen);
    const off = monchoops.onFullScreenChange(setFullScreen);
    return off;
  }, []);

  const isMac = platform === 'darwin';
  const isWin = platform === 'win32';

  if (fullScreen) return null;

  return (
    <div
      className={cn(
        'titlebar flex items-center justify-center',
        transparent ? 'bg-transparent' : 'border-b border-border bg-background/90 backdrop-blur',
        isMac ? 'pl-20' : '',
        isWin ? 'is-win' : ''
      )}
    >
      {transparent ? null : (
        <span className="text-xs font-medium text-muted-foreground">{title}</span>
      )}
    </div>
  );
}
