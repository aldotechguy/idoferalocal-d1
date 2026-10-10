import React from 'react';
import { Package, Truck } from 'lucide-react';
import { MallProductCard } from './MallProductCard';
import type { MallProductsResponse } from '../../types/mall';

interface Props {
  products: MallProductsResponse | null;
}

export const MallCatalogGrid: React.FC<Props> = ({ products }) => {
  if (!products) {
    return (
      <div className="text-center py-12 text-sm text-slate-400 dark:text-slate-500">
        No catalog data yet.
      </div>
    );
  }

  const isProductAvailable = (p: any) => (p.available !== undefined ? Boolean(p.available) : Number(p.stock) > 0);
  const available = products.products.filter(isProductAvailable);
  const unavailable = products.products.filter((p) => !isProductAvailable(p));


  return (
    <div className="space-y-6">
      {products.categories.length > 0 && (
        <div className="flex items-center gap-2 text-xs text-slate-400 dark:text-slate-500">
          <Truck className="w-3.5 h-3.5" />
          <span className="font-semibold">Categories:</span>
          {products.categories.map((c) => {
            const name = typeof c === 'string' ? c : c?.name || 'Uncategorized';
            const count = typeof c === 'object' && c?.count != null ? c.count : null;
            return (
              <span
                key={name}
                className="px-2 py-0.5 rounded-md bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 font-medium"
              >
                {name}
                {count != null && <span className="ml-1 opacity-60">({count})</span>}
              </span>
            );
          })}

        </div>
      )}

      <div className="flex items-center justify-between">
        <p className="text-sm text-slate-500 dark:text-slate-400">
          {products.total} product{products.total === 1 ? '' : 's'} · showing {products.products.length}
        </p>
      </div>

      {available.length === 0 ? (
        <div className="text-center py-12 bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800">
          <Package className="w-8 h-8 mx-auto text-slate-300 dark:text-slate-600 mb-2" />
          <p className="text-sm font-bold text-slate-700 dark:text-slate-300">No available products</p>
          <p className="text-xs text-slate-400 dark:text-slate-500 mt-1">Check back later for new stock.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {available.map((product) => (
            <MallProductCard key={product.id} product={product} />
          ))}
        </div>
      )}

      {unavailable.length > 0 && (
        <div className="pt-2">
          <p className="text-xs font-semibold uppercase tracking-wider text-slate-400 dark:text-slate-500 mb-2">
            Currently unavailable ({unavailable.length})
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4 opacity-60">
            {unavailable.map((product) => (
              <MallProductCard key={product.id} product={product} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
};
