import React, { useState, useRef, useEffect } from 'react';
import {
  Activity,
  Wifi,
  WifiOff,
  Database,
  CheckCircle2,
  AlertCircle,
  RefreshCw,
  Clock,
  Zap,
  Layers,
  ExternalLink,
  Key,
  Eye,
  EyeOff,
  Check,
} from 'lucide-react';
import { D1HealthStatus } from '../../services/d1StorageService';

interface D1NetworkHealthBadgeProps {
  health: D1HealthStatus | null;
  isChecking: boolean;
  unsyncedCount: number;
  onPing: () => Promise<D1HealthStatus>;
  isSyncing?: boolean;
  onSync?: () => void;
}

export const D1NetworkHealthBadge: React.FC<D1NetworkHealthBadgeProps> = ({
  health,
  isChecking,
  unsyncedCount,
  onPing,
  isSyncing = false,
  onSync,
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [lastCheckText, setLastCheckText] = useState('Just now');
  const popoverRef = useRef<HTMLDivElement>(null);

  const isConnected = Boolean(health?.connected);
  const isHealthy = health?.status === 'healthy' || (isConnected && (health?.latencyMs || 0) < 2000);
  const isDegraded = health?.status === 'degraded' || (isConnected && (health?.latencyMs || 0) >= 2000);
  const isOffline = !isConnected;

  // Format the time since last check
  useEffect(() => {
    if (!health?.lastChecked) {
      setLastCheckText('Not checked yet');
      return;
    }

    const updateTime = () => {
      const elapsed = Math.floor((Date.now() - health.lastChecked) / 1000);
      if (elapsed < 5) {
        setLastCheckText('Just now');
      } else if (elapsed < 60) {
        setLastCheckText(`${elapsed}s ago`);
      } else {
        setLastCheckText(`${Math.floor(elapsed / 60)}m ago`);
      }
    };

    updateTime();
    const interval = setInterval(updateTime, 3000);
    return () => clearInterval(interval);
  }, [health?.lastChecked]);

  // Handle outside clicks to close popover
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (popoverRef.current && !popoverRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };
    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isOpen]);

  const getLatencyBadge = (latency: number) => {
    if (latency <= 50) return { label: 'Ultra Fast', color: 'text-emerald-500 bg-emerald-500/10' };
    if (latency <= 150) return { label: 'Optimal', color: 'text-emerald-600 bg-emerald-500/10' };
    if (latency <= 350) return { label: 'Normal', color: 'text-amber-500 bg-amber-500/10' };
    return { label: 'High Latency', color: 'text-rose-500 bg-rose-500/10' };
  };

  const latencyRating = health ? getLatencyBadge(health.latencyMs) : null;

  return (
    <div className="relative inline-flex items-center gap-1" ref={popoverRef}>
      {/* Trigger Button / Badge */}
      <button
        type="button"
        id="d1-network-health-badge"
        onClick={() => setIsOpen(!isOpen)}
        className={`group px-2.5 py-1.5 text-xs font-bold rounded-xl transition-all flex items-center gap-2 border shadow-xs cursor-pointer select-none ${
          isOffline
            ? 'bg-rose-500/10 dark:bg-rose-500/15 border-rose-500/40 text-rose-700 dark:text-rose-300 hover:bg-rose-500/20'
            : isDegraded
            ? 'bg-amber-500/10 dark:bg-amber-500/15 border-amber-500/40 text-amber-700 dark:text-amber-300 hover:bg-amber-500/20'
            : 'bg-emerald-500/10 dark:bg-emerald-500/15 border-emerald-500/30 text-emerald-700 dark:text-emerald-300 hover:bg-emerald-500/20'
        }`}
        title={
          isOffline
            ? 'Cloudflare D1: Disconnected or Offline. Click to inspect & ping.'
            : `Cloudflare D1: Connected (${health?.latencyMs || 0}ms latency). Auto-checks every 5 mins. Click to inspect.`
        }
      >
        {/* Status Dot */}
        <span className="relative flex h-2 w-2 shrink-0">
          {isConnected && (
            <span
              className={`animate-ping absolute inline-flex h-full w-full rounded-full opacity-75 ${
                isDegraded ? 'bg-amber-400' : 'bg-emerald-400'
              }`}
            />
          )}
          <span
            className={`relative inline-flex rounded-full h-2 w-2 ${
              isOffline ? 'bg-rose-500' : isDegraded ? 'bg-amber-500' : 'bg-emerald-500'
            }`}
          />
        </span>

        {/* Badge Icon */}
        {isOffline ? (
          <WifiOff className="w-3.5 h-3.5 text-rose-500 shrink-0" />
        ) : (
          <Database className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400 shrink-0" />
        )}

        {/* Text Label */}
        <span className="hidden sm:inline font-semibold">
          {isChecking ? (
            'Checking D1...'
          ) : isOffline ? (
            'D1 Offline'
          ) : (
            'D1 Online'
          )}
        </span>

        {/* Latency Pill (desktop only when connected) */}
        {isConnected && health && (
          <span className="hidden md:inline-block px-1.5 py-0.5 text-[10px] font-mono font-medium rounded-md bg-emerald-500/15 text-emerald-700 dark:text-emerald-300">
            {health.latencyMs}ms
          </span>
        )}

        {/* Sync Status Mini Pill */}
        {unsyncedCount > 0 ? (
          <span className="px-1.5 py-0.5 text-[10px] font-bold rounded-md bg-amber-500/20 text-amber-700 dark:text-amber-300">
            {unsyncedCount} unsynced
          </span>
        ) : isConnected ? (
          <span className="hidden lg:inline-block px-1.5 py-0.5 text-[10px] font-medium rounded-md bg-emerald-500/15 text-emerald-600 dark:text-emerald-400">
            Synced
          </span>
        ) : null}
      </button>

      {/* Quick Ping Button - gives user instant liberty to ping whenever in doubt */}
      <button
        type="button"
        id="d1-quick-ping-btn"
        onClick={async (e) => {
          e.stopPropagation();
          await onPing();
        }}
        disabled={isChecking}
        title="Ping Cloudflare D1 endpoint now (test connectivity & latency anytime)"
        className="p-1.5 text-xs font-semibold rounded-xl border border-slate-200 dark:border-slate-800 bg-white/80 dark:bg-slate-800/80 hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-600 dark:text-slate-300 transition-all cursor-pointer shadow-xs disabled:opacity-50 flex items-center gap-1"
      >
        <RefreshCw className={`w-3.5 h-3.5 ${isChecking ? 'animate-spin text-emerald-500' : 'text-slate-500'}`} />
        <span className="sr-only xl:not-sr-only text-[10px] font-medium hidden xl:inline">
          {isChecking ? 'Pinging...' : 'Ping'}
        </span>
      </button>

      {/* Popover Dropdown Panel */}
      {isOpen && (
        <div
          id="d1-health-popover-panel"
          className="absolute right-0 mt-2 top-full w-80 sm:w-96 p-4 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl shadow-2xl z-50 animate-in fade-in zoom-in-95 duration-150 text-slate-800 dark:text-slate-100"
        >
          {/* Header */}
          <div className="flex items-center justify-between pb-3 border-b border-slate-100 dark:border-slate-800">
            <div className="flex items-center gap-2">
              <div
                className={`p-2 rounded-xl ${
                  isOffline
                    ? 'bg-rose-500/10 text-rose-600 dark:text-rose-400'
                    : 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
                }`}
              >
                {isOffline ? <WifiOff className="w-4 h-4" /> : <Activity className="w-4 h-4" />}
              </div>
              <div>
                <h4 className="text-sm font-bold leading-tight">Cloudflare D1 Network Health</h4>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  Authoritative SQLite Edge Storage
                </p>
              </div>
            </div>

            {/* Live Green/Red Badge */}
            <span
              className={`px-2 py-0.5 text-[11px] font-extrabold uppercase tracking-wide rounded-full border ${
                isOffline
                  ? 'bg-rose-500/10 border-rose-500/30 text-rose-600 dark:text-rose-400'
                  : isDegraded
                  ? 'bg-amber-500/10 border-amber-500/30 text-amber-600 dark:text-amber-400'
                  : 'bg-emerald-500/10 border-emerald-500/30 text-emerald-600 dark:text-emerald-400'
              }`}
            >
              {isOffline ? 'Offline' : isDegraded ? 'Degraded' : 'Healthy'}
            </span>
          </div>

          {/* Diagnostic Metrics Grid */}
          <div className="grid grid-cols-2 gap-2 my-3">
            {/* Latency Metric */}
            <div className="p-2.5 rounded-xl bg-slate-50 dark:bg-slate-800/60 border border-slate-100 dark:border-slate-800">
              <div className="flex items-center justify-between text-xs text-slate-500 dark:text-slate-400 mb-1">
                <span className="flex items-center gap-1 font-medium">
                  <Zap className="w-3 h-3 text-amber-500" /> Latency
                </span>
                {latencyRating && (
                  <span className={`text-[10px] px-1 rounded font-semibold ${latencyRating.color}`}>
                    {latencyRating.label}
                  </span>
                )}
              </div>
              <div className="text-base font-extrabold font-mono text-slate-800 dark:text-slate-100">
                {isConnected ? `${health?.latencyMs || 0} ms` : '—'}
              </div>
            </div>

            {/* Sync State Metric */}
            <div className="p-2.5 rounded-xl bg-slate-50 dark:bg-slate-800/60 border border-slate-100 dark:border-slate-800">
              <div className="flex items-center justify-between text-xs text-slate-500 dark:text-slate-400 mb-1">
                <span className="flex items-center gap-1 font-medium">
                  <Layers className="w-3 h-3 text-blue-500" /> Sync State
                </span>
              </div>
              <div className="text-sm font-bold flex items-center gap-1">
                {unsyncedCount === 0 ? (
                  <span className="text-emerald-600 dark:text-emerald-400 flex items-center gap-1">
                    <CheckCircle2 className="w-3.5 h-3.5" /> Fully Synced
                  </span>
                ) : (
                  <span className="text-amber-600 dark:text-amber-400 flex items-center gap-1">
                    <AlertCircle className="w-3.5 h-3.5" /> {unsyncedCount} Pending
                  </span>
                )}
              </div>
            </div>
          </div>

          {/* Database & Endpoint Details */}
          <div className="space-y-1.5 text-xs bg-slate-50 dark:bg-slate-800/40 p-3 rounded-xl border border-slate-100 dark:border-slate-800 font-mono mb-3">
            <div className="flex justify-between items-center text-slate-600 dark:text-slate-300">
              <span className="text-slate-500 dark:text-slate-400 font-sans">Database ID:</span>
              <span className="truncate max-w-[180px] font-semibold text-[11px]" title="3e95a550-a091-490b-819d-f0acb7ea8dd8">
                3e95a550...ea8dd8
              </span>
            </div>
            <div className="flex justify-between items-center text-slate-600 dark:text-slate-300">
              <span className="text-slate-500 dark:text-slate-400 font-sans">Revision:</span>
              <span className="font-semibold">
                {health?.revision ? `#${health.revision}` : 'v1.0 (authoritative)'}
              </span>
            </div>
            <div className="flex justify-between items-center text-slate-600 dark:text-slate-300">
              <span className="text-slate-500 dark:text-slate-400 font-sans">Endpoint:</span>
              <span className="font-sans font-medium text-[11px] text-slate-700 dark:text-slate-300 truncate max-w-[170px]">
                {health?.endpoint || 'Cloudflare D1 Primary Edge'}
              </span>
            </div>
            <div className="flex justify-between items-center text-slate-600 dark:text-slate-300">
              <span className="text-slate-500 dark:text-slate-400 font-sans">Auto-Monitor:</span>
              <span className="font-sans font-medium text-[11px] text-emerald-600 dark:text-emerald-400">
                Every 5 minutes
              </span>
            </div>
            <div className="flex justify-between items-center text-slate-600 dark:text-slate-300 pt-1 border-t border-slate-200/60 dark:border-slate-700/60">
              <span className="text-slate-500 dark:text-slate-400 font-sans flex items-center gap-1">
                <Clock className="w-3 h-3" /> Last Checked:
              </span>
              <span className="font-sans font-medium text-slate-700 dark:text-slate-300">
                {lastCheckText}
              </span>
            </div>
          </div>

          {/* The Cloudflare API token prompt lived here. D1 writes are now owned
              entirely by the deployed Worker (no local REST bridge), so there is
              no token to configure from the dashboard. */}

          {/* The Cloudflare API token shortcut link lived here; D1 writes are
              owned entirely by the deployed Worker, so no token is needed. */}

          {/* Error notice if offline */}
          {health?.error && (
            <div className="p-2.5 mb-3 bg-rose-500/10 border border-rose-500/30 rounded-xl text-xs text-rose-700 dark:text-rose-300 flex items-start gap-2">
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5 text-rose-500" />
              <div>
                <span className="font-bold block">Connectivity Issue:</span>
                <span className="text-[11px] leading-tight opacity-90">{health.error}</span>
              </div>
            </div>
          )}

          {/* Action Buttons */}
          <div className="pt-1 space-y-1.5">
            {onSync && (
              <button
                type="button"
                onClick={() => onSync()}
                disabled={isSyncing || isOffline}
                className="w-full py-2 px-3 text-xs font-bold rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white transition-all flex items-center justify-center gap-1.5 cursor-pointer disabled:opacity-50 shadow-sm"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${isSyncing ? 'animate-spin' : ''}`} />
                <span>{isSyncing ? 'Synchronizing with D1...' : 'Sync with D1 Now'}</span>
              </button>
            )}
            <button
              type="button"
              id="d1-health-ping-btn"
              onClick={async () => {
                await onPing();
              }}
              disabled={isChecking}
              className="w-full py-2 px-3 text-xs font-bold rounded-xl bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 transition-all flex items-center justify-center gap-1.5 cursor-pointer disabled:opacity-50"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isChecking ? 'animate-spin' : ''}`} />
              <span>{isChecking ? 'Pinging D1 Endpoint...' : 'Ping D1 Endpoint Now'}</span>
            </button>
            <p className="text-[10px] text-slate-400 text-center mt-1">
              Auto-monitors every 5 minutes. Pulls and synchronizes authoritative data on-demand.
            </p>
          </div>
        </div>
      )}
    </div>
  );
};
