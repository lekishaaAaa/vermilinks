import React, { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { Leaf } from 'lucide-react';

interface HeaderFrameProps {
  className?: string;
  titleSuffix?: string;
  subtitle?: string;
  badgeLabel?: string;
  badgeTone?: 'default' | 'emerald';
  contextTag?: ReactNode;
  rightSlot: ReactNode;
}

const badgeToneClass: Record<NonNullable<HeaderFrameProps['badgeTone']>, string> = {
  default: 'site-badge',
  emerald: 'site-badge bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-900/20 dark:text-emerald-300 dark:border-emerald-700',
};

export const HeaderFrame: React.FC<HeaderFrameProps> = ({
  className,
  titleSuffix,
  subtitle = '',
  badgeLabel,
  badgeTone = 'default',
  contextTag,
  rightSlot,
}) => {
  const headerClassNames = ['site-header', 'relative', 'z-[2147483647]', 'pointer-events-auto'];
  if (className) headerClassNames.push(className);

  // Centralize the shared header layout so both dashboards stay visually in sync.
  return (
    <header className={headerClassNames.join(' ')} role="banner">
      <div className="mx-auto flex max-w-7xl flex-col gap-4 px-4 py-5 sm:px-6 lg:flex-row lg:items-center lg:justify-between lg:gap-8 lg:px-8">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:gap-6">
          <Link to="/" className="group relative z-[2147483647] inline-flex shrink-0 pointer-events-auto">
            <div className="letran-coffee-gradient rounded-xl p-3 shadow-sm transition-transform duration-200 group-hover:-translate-y-1 group-hover:shadow-md">
              <Leaf className="h-6 w-6 text-white" />
            </div>
          </Link>

          <div className="flex flex-col gap-2">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
              <h1 className="site-title text-lg font-semibold sm:text-xl">
                Vermi<span className="site-accent">Links</span>
                {titleSuffix ? <span className="ml-2 text-sm font-medium sm:text-base">{titleSuffix}</span> : null}
              </h1>
              {badgeLabel ? (
                <span className={badgeToneClass[badgeTone]}>{badgeLabel}</span>
              ) : null}
              {contextTag}
            </div>
            {subtitle ? (
              <p className="site-subtitle text-xs sm:text-sm">{subtitle}</p>
            ) : null}
          </div>
        </div>

        {/* Right slot stays flexible so each role can surface its own controls without breaking structure. */}
        <div className="relative z-[2147483647] pointer-events-auto flex w-full flex-col gap-4 sm:flex-row sm:items-center sm:justify-end">
          {rightSlot}
        </div>
      </div>
      <div className="h-px w-full bg-gradient-to-r from-transparent via-teal-300/60 dark:via-teal-600/60 to-transparent" />
    </header>
  );
};

export default HeaderFrame;
