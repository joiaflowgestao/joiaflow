import { LogOut, Menu, X } from 'lucide-react';
import { Suspense, useEffect, useState } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router-dom';
import { Logo } from '@/components/ui/Logo';
import { Spinner } from '@/components/ui/Spinner';
import { useAuth } from '@/contexts/AuthContext';
import { cn } from '@/lib/cn';
import { ROLE_LABELS } from '@/types/database';
import { visibleItems } from './navigation';

function initials(name: string) {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0]!.toUpperCase()).join('');
}

function SidebarContent({ onNavigate }: { onNavigate?: () => void }) {
  const { profile, organization, signOut } = useAuth();
  const items = visibleItems(profile?.role);
  return (
    <div className="flex h-full flex-col">
      <div className="px-6 pb-6 pt-7">
        <Logo light />
        {organization && <p className="mt-2 truncate text-xs uppercase tracking-[0.18em] text-gold-300/80">{organization.name}</p>}
      </div>
      <div className="mx-6 gold-rule opacity-40" />
      <nav className="flex-1 space-y-1 overflow-y-auto px-3 py-5" aria-label="Menu principal">
        {items.map(({ to, label, icon: Icon }) => (
          <NavLink
            key={to}
            to={to}
            end={to === '/'}
            onClick={onNavigate}
            className={({ isActive }) =>
              cn(
                'group flex items-center gap-3 rounded-lg px-3 py-2.5 text-[15px] transition-colors',
                isActive ? 'bg-white/10 text-ivory shadow-[inset_3px_0_0_#B8A66A]' : 'text-ivory/65 hover:bg-white/5 hover:text-ivory',
              )
            }
          >
            {({ isActive }) => (
              <>
                <Icon className={cn('h-[18px] w-[18px]', isActive ? 'text-gold-400' : 'text-ivory/50 group-hover:text-gold-300')} />
                {label}
              </>
            )}
          </NavLink>
        ))}
      </nav>
      <div className="border-t border-white/10 p-4">
        {profile && (
          <div className="mb-3 flex items-center gap-3 px-2">
            <div className="flex h-9 w-9 items-center justify-center rounded-full bg-gold-400 text-sm font-semibold text-navy">{initials(profile.full_name)}</div>
            <div className="min-w-0">
              <p className="truncate text-sm font-medium text-ivory">{profile.full_name}</p>
              <p className="truncate text-xs text-ivory/50">{ROLE_LABELS[profile.role]}</p>
            </div>
          </div>
        )}
        <button
          onClick={signOut}
          className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-[15px] text-ivory/65 transition-colors hover:bg-white/5 hover:text-ivory"
        >
          <LogOut className="h-[18px] w-[18px] text-ivory/50" /> Sair
        </button>
      </div>
    </div>
  );
}

export function AppLayout() {
  const [open, setOpen] = useState(false);
  const { profile } = useAuth();
  const location = useLocation();
  const bottom = visibleItems(profile?.role).filter((i) => i.primary);

  useEffect(() => setOpen(false), [location.pathname]);

  return (
    <div className="min-h-screen bg-ivory">
      {/* Sidebar desktop */}
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-64 bg-navy bg-[radial-gradient(ellipse_at_top,_#21165F_0%,_#0D0737_60%)] lg:block">
        <SidebarContent />
      </aside>

      {/* Topbar celular/tablet */}
      <header className="sticky top-0 z-30 flex h-14 items-center justify-between bg-navy px-4 lg:hidden">
        <Logo light className="scale-90 origin-left" />
        <button onClick={() => setOpen(true)} className="rounded-lg p-2 text-ivory/80 hover:bg-white/10" aria-label="Abrir menu">
          <Menu className="h-5 w-5" />
        </button>
      </header>

      {/* Drawer celular */}
      {open && (
        <div className="fixed inset-0 z-40 lg:hidden" role="dialog" aria-modal="true">
          <div className="absolute inset-0 bg-navy/60 backdrop-blur-sm" onClick={() => setOpen(false)} />
          <aside className="absolute inset-y-0 right-0 w-72 max-w-[85%] bg-navy bg-[radial-gradient(ellipse_at_top,_#21165F_0%,_#0D0737_60%)] shadow-2xl">
            <button onClick={() => setOpen(false)} className="absolute right-3 top-3 rounded-lg p-2 text-ivory/70 hover:bg-white/10" aria-label="Fechar menu">
              <X className="h-5 w-5" />
            </button>
            <SidebarContent onNavigate={() => setOpen(false)} />
          </aside>
        </div>
      )}

      <main className="overflow-x-hidden px-4 pb-28 pt-6 sm:px-6 lg:ml-64 lg:px-10 lg:pb-12 lg:pt-10">
        <div className="mx-auto max-w-6xl">
          <Suspense fallback={<div className="flex justify-center py-24 text-gold-500"><Spinner className="h-7 w-7" /></div>}>
            <Outlet />
          </Suspense>
        </div>
      </main>

      {/* Barra inferior celular */}
      <nav className="fixed inset-x-0 bottom-0 z-30 border-t border-navy/10 bg-white/95 pb-[env(safe-area-inset-bottom)] backdrop-blur lg:hidden" aria-label="Navegação rápida">
        <div className="grid" style={{ gridTemplateColumns: `repeat(${bottom.length}, minmax(0, 1fr))` }}>
          {bottom.map(({ to, short, icon: Icon }) => (
            <NavLink
              key={to}
              to={to}
              end={to === '/'}
              className={({ isActive }) => cn('flex flex-col items-center gap-0.5 py-2.5 text-[11px] font-medium', isActive ? 'text-navy' : 'text-navy/45')}
            >
              {({ isActive }) => (
                <>
                  <span className={cn('rounded-full p-1.5', isActive && 'bg-gold-100')}>
                    <Icon className={cn('h-5 w-5', isActive && 'text-gold-600')} />
                  </span>
                  {short}
                </>
              )}
            </NavLink>
          ))}
        </div>
      </nav>
    </div>
  );
}
