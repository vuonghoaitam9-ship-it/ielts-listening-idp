import { NavLink, Outlet } from 'react-router-dom';
import { BookOpen, Database, Headphones, Home, Layers } from 'lucide-react';

export function AppShell() {
  const navItems = [
    { to: '/', label: 'Danh sách đề', icon: Home, end: true },
    { to: '/dictation', label: 'Dictation', icon: Headphones, end: false },
    { to: '/vocab', label: 'Flashcard SM-2', icon: Layers, end: false },
    { to: '/data', label: 'Dữ liệu Vol 7–10', icon: Database, end: false },
  ];

  return (
    <div className="min-h-screen flex flex-col bg-[#f4f6f9] text-slate-900">
      <header className="bg-[#0f2942] text-white border-b border-slate-800 sticky top-0 z-30">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 h-14 flex items-center justify-between gap-4">
          <NavLink to="/" className="flex items-center gap-2.5 shrink-0">
            <span className="w-8 h-8 rounded bg-white/10 border border-white/20 flex items-center justify-center">
              <BookOpen className="w-4 h-4 text-slate-100" />
            </span>
            <div className="leading-tight">
              <div className="text-sm font-semibold tracking-tight text-white">
                IELTS Listening Suite
              </div>
              <div className="text-[11px] text-slate-300">
                IDP Computer-Delivered · Vol 7–10
              </div>
            </div>
          </NavLink>

          <nav className="flex items-center gap-1 overflow-x-auto">
            {navItems.map(({ to, label, icon: Icon, end }) => (
              <NavLink
                key={to}
                to={to}
                end={end}
                className={({ isActive }) =>
                  `flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-medium whitespace-nowrap transition-colors ${
                    isActive
                      ? 'bg-white text-[#0f2942]'
                      : 'text-slate-200 hover:bg-white/10 hover:text-white'
                  }`
                }
              >
                <Icon className="w-3.5 h-3.5" />
                <span>{label}</span>
              </NavLink>
            ))}
          </nav>
        </div>
      </header>

      <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 py-6">
        <Outlet />
      </main>

      <footer className="border-t border-slate-200 bg-white py-3 px-4 text-xs text-slate-500">
        <div className="max-w-7xl mx-auto flex flex-wrap items-center justify-between gap-2">
          <span>IELTS Listening Practice — Original Audio Only (Vol 7–10)</span>
          <span>Lưu trữ cục bộ IndexedDB &amp; LocalStorage · Tương thích GitHub Pages</span>
        </div>
      </footer>
    </div>
  );
}
