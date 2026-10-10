import React from 'react';
import { Package, Phone, MapPin } from 'lucide-react';
import { useNavigateMall } from '../hooks/useRoute';

export const MallTopStrip: React.FC = () => {
  const go = useNavigateMall();
  return (
    <div className="mall-top-strip text-slate-600 text-[11px]">
      <div className="max-w-7xl mx-auto px-3 sm:px-4 h-8 flex items-center justify-between gap-2">
        <div className="flex items-center gap-3 min-w-0">
          <span className="hidden sm:inline-flex items-center gap-1 text-slate-300">
            <MapPin className="w-3 h-3" /> Uyo, Nigeria
          </span>
          <span className="truncate text-slate-400">Free pickup on all mall orders</span>
        </div>
        <div className="flex items-center gap-3 shrink-0 font-semibold">
          <button type="button" className="hover:text-white hidden sm:inline">Sell on Idofera</button>
          <button type="button" className="hover:text-white hidden sm:inline">Help</button>
          <button type="button" onClick={() => go('/orders')} className="hover:text-white inline-flex items-center gap-1">
            <Package className="w-3 h-3" /> Track Order
          </button>
          <a href="tel:+2348063766861" className="hover:text-white inline-flex items-center gap-1 text-amber-300">
            <Phone className="w-3 h-3" /> Call to Order
          </a>
        </div>
      </div>
    </div>
  );
};
