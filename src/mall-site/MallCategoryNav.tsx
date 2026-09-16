import React from 'react';
import { Menu, ChevronDown } from 'lucide-react';
import { useNavigateMall } from '../hooks/useRoute';

export const MallCategoryNav: React.FC<{ categories: string[]; active?: string }> = ({ categories, active }) => {
  const go = useNavigateMall();
  const [open, setOpen] = React.useState(false);
  const shown = categories.slice(0, 9);
  return (
    <nav className="hidden lg:block border-b border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-950">
      <div className="max-w-7xl mx-auto px-4 h-11 flex items-center gap-1 text-[13px] font-semibold text-slate-600 dark:text-slate-300">
        <div className="relative">
          <button
            type="button" onClick={() => setOpen((v) => !v)}
            className="flex items-center gap-1.5 h-8 px-3 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-900 dark:text-white font-extrabold"
          >
            <Menu className="w-4 h-4" /> All Categories <ChevronDown className={`w-3.5 h-3.5 transition-transform ${open ? 'rotate-180' : ''}`} />
          </button>
          {open && (
            <>
              <div className="fixed inset-0 z-30" onClick={() => setOpen(false)} />
              <div className="absolute left-0 top-full mt-1 w-64 z-40 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 shadow-xl p-1.5 max-h-96 overflow-y-auto">
                {categories.map((c) => (
                  <button
                    key={c} type="button"
                    onClick={() => { setOpen(false); go(`/category/${encodeURIComponent(c)}`); }}
                    className="w-full text-left px-3 py-2 rounded-lg text-[13px] hover:bg-blue-50 dark:hover:bg-blue-950/50 hover:text-blue-700 dark:hover:text-blue-300"
                  >
                    {c}
                  </button>
                ))}
              </div>
            </>
          )}
        </div>
        <span className="w-px h-5 bg-slate-200 dark:bg-slate-800 mx-1" />
        {shown.map((c) => (
          <button
            key={c} type="button"
            onClick={() => go(`/category/${encodeURIComponent(c)}`)}
            className={`h-8 px-2.5 rounded-lg whitespace-nowrap hover:text-blue-600 dark:hover:text-blue-400 ${active === c ? 'text-blue-600 dark:text-blue-400 font-extrabold' : ''}`}
          >
            {c}
          </button>
        ))}
      </div>
    </nav>
  );
};
