import { NavLink, Outlet } from 'react-router-dom';
import { cn } from '../lib/cn';

const NAV = [
  { to: '/', label: 'Dashboard' },
  { to: '/profiles', label: 'Profiles' },
  { to: '/benchmark', label: 'Benchmark' },
  { to: '/chat', label: 'Chat' },
  { to: '/experiments', label: 'Experiments' },
  { to: '/logs', label: 'Logs' },
  { to: '/settings', label: 'Settings' },
];

export function Layout() {
  return (
    <div className="flex h-screen bg-bg-primary">
      <aside className="w-48 border-r border-border bg-bg-secondary p-3 flex flex-col gap-1">
        <div className="text-sm font-semibold text-text-primary px-2 mb-3">Control Tower</div>
        {NAV.map(item => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.to === '/'}
            className={({ isActive }) =>
              cn(
                'px-2 py-1.5 text-sm rounded transition-colors',
                isActive ? 'bg-bg-hover text-text-primary' : 'text-text-secondary hover:text-text-primary'
              )
            }
          >
            {item.label}
          </NavLink>
        ))}
      </aside>
      <main className="flex-1 overflow-auto p-6">
        <Outlet />
      </main>
    </div>
  );
}
