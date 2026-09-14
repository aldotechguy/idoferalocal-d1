import React, { useState, useEffect } from 'react';
import { History, MessageCircle, Truck, ShoppingBag } from 'lucide-react';
import { SalesView } from './SalesView';
import { WhatsAppOrdersView } from '../whatsapp/WhatsAppOrdersView';
import { DeliveriesView } from '../deliveries/DeliveriesView';
import { useApp } from '../../context/AppContext';

export type SalesOrdersTab = 'sales' | 'whatsapp-orders' | 'deliveries';

interface SalesOrdersHubViewProps {
  initialTab?: SalesOrdersTab;
  onNavigate: (page: string) => void;
}

export const SalesOrdersHubView: React.FC<SalesOrdersHubViewProps> = ({
  initialTab = 'sales',
  onNavigate,
}) => {
  const [activeTab, setActiveTab] = useState<SalesOrdersTab>(initialTab);
  const { whatsAppPreOrders, deliveryOrders } = useApp();

  const pendingWhatsAppCount = whatsAppPreOrders.filter(
    (o) => o.status !== 'Completed' && o.status !== 'Cancelled'
  ).length;

  const pendingPickupCount = deliveryOrders
    ? deliveryOrders.filter((o) => !o.isPickupConfirmed && o.status !== 'Cancelled').length
    : 0;

  useEffect(() => {
    if (initialTab) {
      setActiveTab(initialTab);
    }
  }, [initialTab]);

  return (
    <div className="space-y-6 max-w-7xl mx-auto">
      {/* Sales & Orders Hub Navigation Banner */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-4 shadow-xs">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="p-2.5 bg-blue-50 dark:bg-blue-950/60 border border-blue-100 dark:border-blue-900/50 text-blue-600 dark:text-blue-400 rounded-xl">
              <ShoppingBag className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-lg font-black text-slate-900 dark:text-white tracking-tight">
                  Sales & Orders Hub
                </h1>
                <span className="px-2 py-0.5 rounded-md text-[10px] font-bold bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 border border-slate-200 dark:border-slate-700">
                  Unified Hub
                </span>
              </div>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Track all completed sales transactions, WhatsApp pre-orders, and dispatch delivery orders.
              </p>
            </div>
          </div>
        </div>

        {/* Tab Selector */}
        <div className="flex items-center gap-2 mt-4 pt-3 border-t border-slate-100 dark:border-slate-800 overflow-x-auto scrollbar-none">
          <button
            onClick={() => setActiveTab('sales')}
            className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-bold transition-all whitespace-nowrap ${
              activeTab === 'sales'
                ? 'bg-blue-600 text-white shadow-sm shadow-blue-500/20'
                : 'text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800'
            }`}
          >
            <History className="w-3.5 h-3.5" />
            <span>Sales Records</span>
          </button>

          <button
            onClick={() => setActiveTab('whatsapp-orders')}
            className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-bold transition-all whitespace-nowrap ${
              activeTab === 'whatsapp-orders'
                ? 'bg-blue-600 text-white shadow-sm shadow-blue-500/20'
                : 'text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800'
            }`}
          >
            <MessageCircle className="w-3.5 h-3.5" />
            <span>WhatsApp Pre-Orders</span>
            {pendingWhatsAppCount > 0 ? (
              <span className="px-1.5 py-0.5 rounded-md text-[9px] font-bold bg-emerald-500 text-white">
                {pendingWhatsAppCount} Active
              </span>
            ) : (
              <span className="px-1.5 py-0.5 rounded-md text-[9px] font-semibold bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300">
                Catalogue
              </span>
            )}
          </button>

          <button
            onClick={() => setActiveTab('deliveries')}
            className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-bold transition-all whitespace-nowrap ${
              activeTab === 'deliveries'
                ? 'bg-blue-600 text-white shadow-sm shadow-blue-500/20'
                : 'text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800'
            }`}
          >
            <Truck className="w-3.5 h-3.5" />
            <span>Deliveries & Pickups</span>
            {pendingPickupCount > 0 && (
              <span className="px-1.5 py-0.5 rounded-md text-[9px] font-bold bg-amber-500 text-white">
                {pendingPickupCount} Pending
              </span>
            )}
          </button>
        </div>
      </div>

      {/* Active Tab Content */}
      <div>
        {activeTab === 'sales' && <SalesView onNavigate={onNavigate} />}
        {activeTab === 'whatsapp-orders' && <WhatsAppOrdersView onNavigate={onNavigate} />}
        {activeTab === 'deliveries' && <DeliveriesView onNavigate={onNavigate} />}
      </div>
    </div>
  );
};
