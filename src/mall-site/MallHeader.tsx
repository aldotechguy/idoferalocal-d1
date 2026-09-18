import React from 'react';
import { ShoppingCart, User, Menu, Heart, Store } from 'lucide-react';
import { MallHeaderSearch } from './MallHeaderSearch';
import { useMall } from '../context/MallContext';
import { useNavigateMall } from '../hooks/useRoute';

export const MallHeader: React.FC<{ query: string; setQuery: (q: string) => void; onMenu: () => void }> = ({
  query, setQuery, onMenu,
}) => {
  const { cart, setView } = useMall();
  const go = useNavigateMall();
  const count = cart?.items.reduce((a, i) => a + i.qty, 0) ?? 0;


  return (
    <header className="sticky top-0 z-40 bg-white/95 dark:bg-slate-950/95 backdrop-blur border-b border-slate-200 dark:border-slate-800">
      <div className="max-w-7xl mx-auto px-3 sm:px-4 py-2.5 flex items-center gap-2 sm:gap-4">
        <button
          type="button" onClick={onMenu} aria-label="Open categories"
          className="lg:hidden p-2 -ml-1 rounded-lg text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800"
        >
          <Menu className="w-5 h-5" />
        </button>
        <button type="button" onClick={() => go('/')} className="flex items-center gap-2 shrink-0" aria-label="Idofera Mall home">
          <img
            src="/images/mall/logo/logo.png"
            alt=""
            width="1254"
            height="1254"
            className="w-10 h-10 sm:w-11 sm:h-11 object-contain shrink-0"
          />
          <span className="hidden sm:block text-left leading-none">
            <img
              src="/images/mall/logo/wordmark.png"
              alt=""
              width="2172"
              height="724"
              className="block w-[126px] h-auto object-contain"
            />
            <span className="block text-[10px] font-semibold text-slate-400">Packaging and Everyday Goods</span>
          </span>
        </button>
        <MallHeaderSearch query={query} setQuery={setQuery} />
        <div className="hidden md:flex items-center gap-1 shrink-0">
          <button
            type="button" onClick={() => go('/orders')}
            className="flex items-center gap-2 px-3 h-10 rounded-xl text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 text-xs font-bold"
          >
            <User className="w-5 h-5" />
            <span className="text-left leading-tight">Account<br /><span className="text-[10px] font-semibold text-slate-400">Orders</span></span>
          </button>
          <button
            type="button"
            onClick={() => { setView('cart'); go('/checkout'); }}
            className="relative flex items-center gap-2 h-10 px-4 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-sm font-extrabold transition-colors"
          >
            <ShoppingCart className="w-4 h-4" />
            Cart
            {count > 0 && (
              <span className="absolute -top-1.5 -right-1.5 min-w-5 h-5 px-1 rounded-full bg-rose-500 text-white text-[10px] font-black flex items-center justify-center shadow">
                {count.toLocaleString('en-NG')}
              </span>
            )}
          </button>
        </div>
        <button
          type="button" aria-label="Cart"
          onClick={() => { setView('cart'); go('/checkout'); }}
          className="md:hidden relative p-2.5 rounded-xl bg-blue-600 text-white shrink-0"
        >
          <ShoppingCart className="w-5 h-5" />
          {count > 0 && (
            <span className="absolute -top-1 -right-1 min-w-5 h-5 px-1 rounded-full bg-rose-500 text-white text-[10px] font-black flex items-center justify-center">
              {count.toLocaleString('en-NG')}
            </span>
          )}
        </button>
      </div>
      <div className="md:hidden px-3 pb-2 flex items-center gap-2 text-[11px] font-semibold text-slate-500 dark:text-slate-400">
        <button type="button" onClick={() => go('/orders')} className="inline-flex items-center gap-1 hover:text-blue-600">
          <User className="w-3.5 h-3.5" /> Account
        </button>
        <span className="text-slate-200 dark:text-slate-700">•</span>
        <span className="inline-flex items-center gap-1 text-slate-400" aria-label="Wishlist coming soon"><Heart className="w-3.5 h-3.5" /> Wishlist · Soon</span>
        <span className="text-slate-200 dark:text-slate-700">•</span>
        <span className="inline-flex items-center gap-1 text-slate-400" aria-label="Official stores coming soon"><Store className="w-3.5 h-3.5" /> Stores · Soon</span>
      </div>
    </header>
  );
};
