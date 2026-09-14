import React, { useState, useEffect } from 'react';
import {
  AlertTriangle,
  Cloud,
  HardDrive,
  CheckCircle2,
  X,
  ArrowRight,
  Layers,
  ChevronLeft,
  ChevronRight,
  ShieldAlert,
} from 'lucide-react';
import { SyncConflict, ConflictingField } from '../../types';

interface ConflictResolutionModalProps {
  isOpen: boolean;
  onClose: () => void;
  conflicts: SyncConflict[];
  onResolve: (
    conflictId: string,
    choice: 'keep_local' | 'keep_cloud' | 'merged',
    customMergedItem?: any
  ) => Promise<void>;
  onResolveAll?: (choice: 'keep_local' | 'keep_cloud') => Promise<void>;
}

export const ConflictResolutionModal: React.FC<ConflictResolutionModalProps> = ({
  isOpen,
  onClose,
  conflicts,
  onResolve,
  onResolveAll,
}) => {
  const [currentIndex, setCurrentIndex] = useState(0);
  const [fieldSelections, setFieldSelections] = useState<Record<string, 'local' | 'cloud'>>({});
  const [isBusy, setIsBusy] = useState(false);

  // Active conflict being inspected
  const currentConflict = conflicts[currentIndex] || conflicts[0];

  useEffect(() => {
    if (currentConflict) {
      // Default field selections to 'local' for each conflicting field
      const defaults: Record<string, 'local' | 'cloud'> = {};
      currentConflict.conflictingFields.forEach((cf) => {
        defaults[cf.field] = 'local';
      });
      setFieldSelections(defaults);
    }
  }, [currentConflict?.id]);

  useEffect(() => {
    if (currentIndex >= conflicts.length && conflicts.length > 0) {
      setCurrentIndex(Math.max(0, conflicts.length - 1));
    }
  }, [conflicts.length, currentIndex]);

  if (!isOpen || !currentConflict || conflicts.length === 0) return null;

  const handleFieldChoiceChange = (field: string, choice: 'local' | 'cloud') => {
    setFieldSelections((prev) => ({ ...prev, [field]: choice }));
  };

  const handleResolveSingle = async (choice: 'keep_local' | 'keep_cloud' | 'merged') => {
    setIsBusy(true);
    try {
      if (choice === 'merged') {
        // Construct merged item by copying localItem and overriding fields with fieldSelections
        const mergedItem = { ...currentConflict.localItem };
        currentConflict.conflictingFields.forEach((cf) => {
          const selectedSource = fieldSelections[cf.field];
          if (selectedSource === 'cloud') {
            mergedItem[cf.field] = cf.cloudValue;
          } else {
            mergedItem[cf.field] = cf.localValue;
          }
        });
        await onResolve(currentConflict.id, 'merged', mergedItem);
      } else {
        await onResolve(currentConflict.id, choice);
      }
    } finally {
      setIsBusy(false);
    }
  };

  const handleResolveAllBatch = async (choice: 'keep_local' | 'keep_cloud') => {
    if (!onResolveAll) return;
    setIsBusy(true);
    try {
      await onResolveAll(choice);
    } finally {
      setIsBusy(false);
    }
  };

  const renderValue = (val: any) => {
    if (val === undefined || val === null || val === '') {
      return <span className="italic text-slate-400 dark:text-slate-500 font-mono text-xs">(empty)</span>;
    }
    if (typeof val === 'object') {
      return <pre className="text-[11px] font-mono whitespace-pre-wrap max-h-24 overflow-y-auto">{JSON.stringify(val, null, 2)}</pre>;
    }
    if (typeof val === 'boolean') {
      return <span className="font-semibold text-xs">{val ? 'True' : 'False'}</span>;
    }
    return <span className="font-semibold text-xs">{String(val)}</span>;
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/70 backdrop-blur-md overflow-y-auto animate-fadeIn">
      <div className="relative w-full max-w-4xl max-h-[90vh] flex flex-col bg-slate-900 border border-slate-700/80 rounded-3xl shadow-2xl overflow-hidden text-slate-100 my-auto">
        
        {/* Header Bar */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-800 bg-slate-900/90 backdrop-blur-sm">
          <div className="flex items-center gap-3">
            <div className="p-2.5 bg-amber-500/10 border border-amber-500/30 rounded-2xl text-amber-400">
              <ShieldAlert className="w-6 h-6 animate-pulse" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-lg font-black tracking-tight text-white">
                  Sync Conflict Resolution
                </h2>
                <span className="px-2.5 py-0.5 text-[11px] font-extrabold bg-amber-500/20 text-amber-300 border border-amber-500/40 rounded-full">
                  {conflicts.length} {conflicts.length === 1 ? 'Conflict' : 'Conflicts'} Pending
                </span>
              </div>
              <p className="text-xs text-slate-400 mt-0.5">
                Differences detected between local device storage and central Cloud Firestore.
              </p>
            </div>
          </div>

          <button
            onClick={onClose}
            className="p-2 text-slate-400 hover:text-white hover:bg-slate-800 rounded-xl transition-colors cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Conflict Selector Navigation Tabs (if multiple) */}
        {conflicts.length > 1 && (
          <div className="flex items-center justify-between px-6 py-2.5 bg-slate-950/60 border-b border-slate-800/80 overflow-x-auto gap-2">
            <div className="flex items-center gap-1.5 overflow-x-auto py-1">
              {conflicts.map((c, idx) => (
                <button
                  key={c.id}
                  onClick={() => setCurrentIndex(idx)}
                  className={`px-3 py-1.5 text-xs font-bold rounded-xl transition-all whitespace-nowrap flex items-center gap-1.5 ${
                    idx === currentIndex
                      ? 'bg-indigo-600 text-white shadow-md shadow-indigo-600/30'
                      : 'bg-slate-800/80 text-slate-300 hover:bg-slate-700/80'
                  }`}
                >
                  <Layers className="w-3.5 h-3.5" />
                  <span>
                    #{idx + 1} {c.storeName}: {c.itemName}
                  </span>
                </button>
              ))}
            </div>

            {/* Batch Resolution Buttons */}
            {onResolveAll && (
              <div className="flex items-center gap-2 shrink-0 ml-4">
                <button
                  disabled={isBusy}
                  onClick={() => handleResolveAllBatch('keep_local')}
                  className="px-2.5 py-1 text-[11px] font-extrabold bg-blue-600/20 hover:bg-blue-600/30 text-blue-300 border border-blue-500/40 rounded-lg transition-all cursor-pointer flex items-center gap-1"
                >
                  <HardDrive className="w-3 h-3" />
                  <span>Keep All Local</span>
                </button>
                <button
                  disabled={isBusy}
                  onClick={() => handleResolveAllBatch('keep_cloud')}
                  className="px-2.5 py-1 text-[11px] font-extrabold bg-indigo-600/20 hover:bg-indigo-600/30 text-indigo-300 border border-indigo-500/40 rounded-lg transition-all cursor-pointer flex items-center gap-1"
                >
                  <Cloud className="w-3 h-3" />
                  <span>Keep All Cloud</span>
                </button>
              </div>
            )}
          </div>
        )}

        {/* Body Content */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          
          {/* Active Conflict Banner */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-4 bg-slate-950/70 border border-slate-800 rounded-2xl">
            <div>
              <div className="flex items-center gap-2">
                <span className="uppercase text-[10px] font-black tracking-wider px-2 py-0.5 bg-indigo-500/20 text-indigo-300 rounded border border-indigo-500/30">
                  {currentConflict.storeName}
                </span>
                <span className="text-xs font-mono text-slate-400">
                  ID: {currentConflict.id}
                </span>
              </div>
              <h3 className="text-base font-extrabold text-white mt-1">
                {currentConflict.itemName}
              </h3>
            </div>

            <div className="flex items-center gap-2">
              <button
                disabled={currentIndex === 0}
                onClick={() => setCurrentIndex((prev) => Math.max(0, prev - 1))}
                className="p-1.5 bg-slate-800 disabled:opacity-40 hover:bg-slate-700 text-slate-300 rounded-lg transition-colors cursor-pointer"
                title="Previous conflict"
              >
                <ChevronLeft className="w-4 h-4" />
              </button>
              <span className="text-xs font-bold text-slate-400">
                {currentIndex + 1} of {conflicts.length}
              </span>
              <button
                disabled={currentIndex === conflicts.length - 1}
                onClick={() => setCurrentIndex((prev) => Math.min(conflicts.length - 1, prev + 1))}
                className="p-1.5 bg-slate-800 disabled:opacity-40 hover:bg-slate-700 text-slate-300 rounded-lg transition-colors cursor-pointer"
                title="Next conflict"
              >
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          </div>

          {/* Side-by-Side Macro Version Comparison */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            
            {/* Local Version Box */}
            <div className="p-5 bg-gradient-to-b from-blue-950/40 to-slate-950/60 border border-blue-500/30 rounded-2xl space-y-3 relative group hover:border-blue-500/50 transition-all">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div className="p-2 bg-blue-500/20 rounded-xl text-blue-400">
                    <HardDrive className="w-4 h-4" />
                  </div>
                  <div>
                    <h4 className="text-sm font-bold text-blue-200">Local Version</h4>
                    <p className="text-[11px] text-blue-400/80">Saved on this device</p>
                  </div>
                </div>
                <span className="text-[10px] font-extrabold px-2 py-0.5 bg-blue-500/20 text-blue-300 border border-blue-400/30 rounded-full">
                  IndexedDB
                </span>
              </div>

              <div className="text-xs text-slate-300 space-y-1 bg-slate-900/60 p-3 rounded-xl border border-slate-800">
                <p className="text-[11px] text-slate-400">
                  Last Updated: <span className="text-white font-mono">{currentConflict.localItem.updatedAt || currentConflict.detectedAt}</span>
                </p>
                <p className="text-[11px] text-slate-400">
                  Conflicting Attributes: <span className="text-blue-300 font-bold">{currentConflict.conflictingFields.length}</span>
                </p>
              </div>

              <button
                disabled={isBusy}
                onClick={() => handleResolveSingle('keep_local')}
                className="w-full py-2.5 px-4 bg-blue-600 hover:bg-blue-500 text-white font-extrabold text-xs rounded-xl shadow-md shadow-blue-600/30 transition-all flex items-center justify-center gap-2 cursor-pointer"
              >
                <CheckCircle2 className="w-4 h-4" />
                <span>Keep Entire Local Version</span>
              </button>
            </div>

            {/* Cloud Version Box */}
            <div className="p-5 bg-gradient-to-b from-indigo-950/40 to-slate-950/60 border border-indigo-500/30 rounded-2xl space-y-3 relative group hover:border-indigo-500/50 transition-all">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div className="p-2 bg-indigo-500/20 rounded-xl text-indigo-400">
                    <Cloud className="w-4 h-4" />
                  </div>
                  <div>
                    <h4 className="text-sm font-bold text-indigo-200">Cloud Version</h4>
                    <p className="text-[11px] text-indigo-400/80">Central Firestore Server</p>
                  </div>
                </div>
                <span className="text-[10px] font-extrabold px-2 py-0.5 bg-indigo-500/20 text-indigo-300 border border-indigo-400/30 rounded-full">
                  Cloud Firestore
                </span>
              </div>

              <div className="text-xs text-slate-300 space-y-1 bg-slate-900/60 p-3 rounded-xl border border-slate-800">
                <p className="text-[11px] text-slate-400">
                  Last Updated: <span className="text-white font-mono">{currentConflict.cloudItem.updatedAt || 'Server Document'}</span>
                </p>
                <p className="text-[11px] text-slate-400">
                  Conflicting Attributes: <span className="text-indigo-300 font-bold">{currentConflict.conflictingFields.length}</span>
                </p>
              </div>

              <button
                disabled={isBusy}
                onClick={() => handleResolveSingle('keep_cloud')}
                className="w-full py-2.5 px-4 bg-indigo-600 hover:bg-indigo-500 text-white font-extrabold text-xs rounded-xl shadow-md shadow-indigo-600/30 transition-all flex items-center justify-center gap-2 cursor-pointer"
              >
                <CheckCircle2 className="w-4 h-4" />
                <span>Keep Entire Cloud Version</span>
              </button>
            </div>

          </div>

          {/* Field-by-Field Granular Merging Table */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Layers className="w-4 h-4 text-emerald-400" />
                <h4 className="text-xs font-black uppercase tracking-wider text-slate-200">
                  Field-by-Field Custom Merge
                </h4>
              </div>
              <span className="text-[11px] text-slate-400">
                Select individual values below to combine both versions
              </span>
            </div>

            <div className="border border-slate-800 rounded-2xl overflow-hidden bg-slate-950/80 divide-y divide-slate-800/80">
              {currentConflict.conflictingFields.map((cf) => {
                const isLocalChosen = fieldSelections[cf.field] !== 'cloud';

                return (
                  <div key={cf.field} className="p-4 grid grid-cols-1 md:grid-cols-12 gap-3 items-center">
                    
                    {/* Field Label */}
                    <div className="md:col-span-3">
                      <span className="text-xs font-extrabold text-slate-200 block">
                        {cf.label}
                      </span>
                      <span className="text-[10px] font-mono text-slate-500">
                        key: {cf.field}
                      </span>
                    </div>

                    {/* Local Choice Card */}
                    <div
                      onClick={() => handleFieldChoiceChange(cf.field, 'local')}
                      className={`md:col-span-4 p-3 rounded-xl border transition-all cursor-pointer flex flex-col justify-between gap-1.5 ${
                        isLocalChosen
                          ? 'bg-blue-600/15 border-blue-500/60 ring-2 ring-blue-500/30'
                          : 'bg-slate-900/60 border-slate-800 hover:border-slate-700'
                      }`}
                    >
                      <div className="flex items-center justify-between">
                        <span className="text-[10px] font-extrabold uppercase text-blue-400">
                          Local Device Value
                        </span>
                        <input
                          type="radio"
                          name={`field-${cf.field}`}
                          checked={isLocalChosen}
                          onChange={() => handleFieldChoiceChange(cf.field, 'local')}
                          className="accent-blue-500 cursor-pointer"
                        />
                      </div>
                      <div className="text-slate-100">{renderValue(cf.localValue)}</div>
                    </div>

                    {/* Divider Arrow */}
                    <div className="hidden md:flex md:col-span-1 justify-center items-center text-slate-600">
                      <ArrowRight className="w-4 h-4" />
                    </div>

                    {/* Cloud Choice Card */}
                    <div
                      onClick={() => handleFieldChoiceChange(cf.field, 'cloud')}
                      className={`md:col-span-4 p-3 rounded-xl border transition-all cursor-pointer flex flex-col justify-between gap-1.5 ${
                        !isLocalChosen
                          ? 'bg-indigo-600/15 border-indigo-500/60 ring-2 ring-indigo-500/30'
                          : 'bg-slate-900/60 border-slate-800 hover:border-slate-700'
                      }`}
                    >
                      <div className="flex items-center justify-between">
                        <span className="text-[10px] font-extrabold uppercase text-indigo-400">
                          Cloud Firestore Value
                        </span>
                        <input
                          type="radio"
                          name={`field-${cf.field}`}
                          checked={!isLocalChosen}
                          onChange={() => handleFieldChoiceChange(cf.field, 'cloud')}
                          className="accent-indigo-500 cursor-pointer"
                        />
                      </div>
                      <div className="text-slate-100">{renderValue(cf.cloudValue)}</div>
                    </div>

                  </div>
                );
              })}
            </div>

            {/* Apply Custom Merge Button */}
            <div className="flex justify-end">
              <button
                disabled={isBusy}
                onClick={() => handleResolveSingle('merged')}
                className="px-5 py-2.5 bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white font-extrabold text-xs rounded-xl shadow-lg shadow-emerald-900/30 transition-all flex items-center gap-2 cursor-pointer"
              >
                <CheckCircle2 className="w-4 h-4" />
                <span>Save Custom Merged Version</span>
              </button>
            </div>
          </div>

        </div>

        {/* Footer */}
        <div className="px-6 py-4 bg-slate-950 border-t border-slate-800 flex items-center justify-between">
          <span className="text-xs text-slate-400">
            Resolving conflicts immediately synchronizes state across IndexedDB and Cloud Firestore.
          </span>
          <button
            onClick={onClose}
            className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 font-bold text-xs rounded-xl transition-colors cursor-pointer"
          >
            Resolve Later
          </button>
        </div>

      </div>
    </div>
  );
};
