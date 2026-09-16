import React from 'react';
import { Home, LayoutGrid, ShoppingCart, User, Lock } from 'lucide-react';
import { useMall } from '../context/MallContext';
import { useNavigateMall, useRoute } from '../hooks/useRoute';

export const MallBottomNav: React.FC = () => {
  const route = useRoute();
  const { cart } = useMall();
  const go = useNavigateMall();
  const count = cart?.items.reduce((a, i) => a + i.qty, 0) ?? 0;
  const active = route.surface === 'mall' ? route.page : '';
  const items = [
    { key: 'home', label: 'Home', icon: Home, to: '/' },
    { key: 'cats', label: 'Categories', icon: LayoutGrid, to: '/#categories' },
    { key: 'cart', label: 'Cart', icon: ShoppingCart, to: '/checkout', badge: count },
    { key: 'me', label: 'Account', icon: User, to: '/orders' },
  ];
  return (
    <nav className="md:hidden fixed bottom-0 inset-x-0 z-40 bg-white/95 dark:bg-slate-950/95 backdrop-blur border-t border-slate-200 dark:border-slate-800">
      <div className="grid grid-cols-4 h-16">
        {items.map((it) => {
          const isActive = (it.key === 'home' && active === 'home') || (it.key === 'cart' && active === 'checkout') || (it.key === 'me' && active === 'orders');
          return (
            <button
              key={it.key} type="button"
              onClick={() => { if (it.key === 'cats') { go('/'); setTimeout(() => document.getElementById('mall-categories')?.scrollIntoView({ behavior: 'smooth' }), 80); } else go(it.to); }}
              className={`relative flex flex-col items-center justify-center gap-0.5 text-[10px] font-bold ${isActive ? 'text-blue-600 dark:text-blue-400' : 'text-slate-500 dark:text-slate-400'}`}
            >
              <it.icon className="w-5 h-5" />
              {it.label}
              {it.badge != null && it.badge > 0 && (
                <span className="absolute top-1.5 right-1/2 translate-x-5 min-w-4 h-4 px-1 rounded-full bg-rose-500 text-white text-[9px] font-black flex items-center justify-center">
                  {it.badge > 99 ? '99+' : it.badge}
                </span>
              )}
            </button>
          );
        })}
      </div>
    </nav>
  );
};

export const MallFooter: React.FC = () => {
  const go = useNavigateMall();
  return (
    <footer className="mall-footer mt-8 text-slate-600">
      <div className="max-w-7xl mx-auto px-4 py-10 grid grid-cols-2 md:grid-cols-4 gap-6 text-[13px]">
        <div className="col-span-2 md:col-span-1">
          <div className="flex items-center gap-2">
            <span className="w-8 h-8 rounded-lg bg-gradient-to-tr from-blue-600 to-violet-600 text-white font-black flex items-center justify-center">I</span>
            <span className="font-black text-white">IdoferaMall</span>
          </div>
          <p className="mt-2 text-xs text-slate-400 leading-relaxed">Packaging and everyday goods. Order online, pay on pickup at 16 Atakpo Street, off Nwaniba Road, Uyo.</p>
          <p className="mt-2 text-xs font-bold text-amber-300">+234 806 376 6861</p>
        </div>
        <div>
          <p className="text-white font-extrabold text-xs uppercase tracking-wider mb-2.5">Shop</p>
          <ul className="space-y-1.5 font-medium">
            <li><button type="button" onClick={() => go('/')} className="hover:text-white">All Products</button></li>
            <li><button type="button" onClick={() => go('/orders')} className="hover:text-white">Track Order</button></li>
            <li><button type="button" onClick={() => go('/checkout')} className="hover:text-white">Cart &amp; Checkout</button></li>
          </ul>
        </div>
        <div>
          <p className="text-white font-extrabold text-xs uppercase tracking-wider mb-2.5">Help</p>
          <ul className="space-y-1.5 font-medium">
            <li><a href="tel:+2348063766861" className="hover:text-white">Call to Order</a></li>
            <li><span className="text-slate-400">Returns within 2 working days</span></li>
            <li><span className="text-slate-400">Pay on pickup or transfer</span></li>
          </ul>
        </div>
        <div>
          <p className="text-white font-extrabold text-xs uppercase tracking-wider mb-2.5">Payments</p>
          <div className="flex flex-wrap gap-1.5">
            {['Cash', 'Transfer', 'POS'].map((p) => (
              <span key={p} className="px-2 py-1 rounded-md bg-white/10 text-[11px] font-bold">{p}</span>
            ))}
          </div>
          <button
            type="button" onClick={() => { window.location.href = '/app'; }}
            className="mt-4 inline-flex items-center gap-1.5 text-[11px] font-semibold text-slate-500 hover:text-slate-300"
          >
            <Lock className="w-3 h-3" /> Staff Login
          </button>
        </div>
      </div>
      <div className="border-t border-white/10">
        <div className="max-w-7xl mx-auto px-4 h-11 flex items-center justify-between text-[11px] text-slate-500 font-medium">
          <span>© {new Date().getFullYear()} Idofera Packaging. All rights reserved.</span>
          <span className="hidden sm:inline">Secure checkout • No account needed</span>
        </div>
      </div>
      <div className="h-16 md:hidden" />
    </footer>
  );
};
