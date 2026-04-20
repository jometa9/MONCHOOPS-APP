import { Outlet } from 'react-router-dom';
import { Sidebar } from './Sidebar';
import { TitleBar } from './TitleBar';

export function AppShell() {
  return (
    <div className="flex h-full flex-col">
      <TitleBar />
      <div className="flex min-h-0 flex-1">
        <Sidebar />
        <main className="relative isolate flex-1 overflow-auto">
          <div
            aria-hidden
            className="pointer-events-none fixed bottom-0 left-56 -z-10 h-[50vh] bg-foreground/[0.03]"
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
          <Outlet />
        </main>
      </div>
    </div>
  );
}
