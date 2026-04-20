import type { ReactNode } from 'react';
import { TitleBar } from './TitleBar';

export function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div className="relative isolate flex h-full flex-col">
      <TitleBar transparent />
      <div
        aria-hidden
        className="pointer-events-none fixed bottom-0 left-0 -z-10 h-[50vh] bg-foreground/[0.03]"
        style={{
          aspectRatio: '1280 / 1116',
          WebkitMaskImage: 'url(/home-bg.svg)',
          maskImage: 'url(/home-bg.svg)',
          WebkitMaskRepeat: 'no-repeat',
          maskRepeat: 'no-repeat',
          WebkitMaskPosition: 'bottom left',
          maskPosition: 'bottom left',
          WebkitMaskSize: 'contain',
          maskSize: 'contain',
        }}
      />
      <div className="flex flex-1 items-center justify-center p-6">{children}</div>
    </div>
  );
}
