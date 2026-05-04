type HomeBgProps = {
  // 'sidebar' offsets the bg by w-56 to clear the dashboard sidebar.
  offset?: 'none' | 'sidebar';
};

export function HomeBg({ offset = 'none' }: HomeBgProps = {}) {
  const left = offset === 'sidebar' ? 'left-56' : 'left-0';
  return (
    <div
      aria-hidden
      className={`pointer-events-none fixed bottom-0 ${left} -z-10 h-[50vh] bg-foreground/[0.03]`}
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
  );
}
