import React, { useState, useEffect } from 'react';
import {
  Settings,
  Shield,
  History,
  Save,
  Building2,
  Check,
  UserPlus,
  Users,
  Edit2,
  Trash2,
  UserCheck,
  Search,
  ShieldAlert,
  CheckCircle2,
  XCircle,
  X,
  KeyRound,
  Lock,
  Database,
  Download,
  Upload,
  RefreshCw,
  HardDrive,
  PieChart,
  Server,
  Filter,
  FileSpreadsheet,
  Activity,
  Calendar,
  Clock,
  Tag,
  AlertCircle,
  PlusCircle,
  Smartphone,
  Monitor,
  Wifi,
  WifiOff,
  Globe,
  Cloud,
  CloudOff,
  Eye,
  Mail,
  LogOut,
  Key,
} from 'lucide-react';
import { usePWAInstall } from '../../hooks/usePWAInstall';
import { useCloudSync } from '../../hooks/useCloudSync';
import { DesktopInstallModal } from '../modals/DesktopInstallModal';
import { UnsyncedChangesModal } from '../common/UnsyncedChangesModal';
import { GoogleDriveAuthModal } from '../modals/GoogleDriveAuthModal';
import { useApp } from '../../context/AppContext';
import { useAuth, isSuperUser } from '../../context/AuthContext';
import { useToast } from '../../context/ToastContext';
import { UserModal } from '../modals/UserModal';
import { ConfirmModal } from '../common/ConfirmModal';
import { ResetPasswordModal } from '../modals/ResetPasswordModal';
import { UserProfile, UserRole } from '../../types';
import {
  getStoreRecordCounts,
  getStorageEstimate,
  exportDatabaseJSON,
  importDatabaseJSON,
  deleteItem,
  ALL_STORES,
  type StoreName,
} from '../../db/indexedDB';
import {
  createD1BackupExport,
  clearUnsyncedLocalChanges,
  getUnsyncedItemKeys,
} from '../../services/googleDriveService';
import { clearD1PendingSync, getD1PendingDeletions, groupPendingD1KeysByStore } from '../../services/d1StorageService';

export const SettingsView: React.FC = () => {
  const { settings, updateSettings, auditLogs, logAudit, clearAuditLogs } = useApp();
  const { users, currentUser, isSuperAdmin, switchUser, deleteUser, updateUser } = useAuth();
  const { showToast } = useToast();
  const { isInstallable, isInstalled, isOnline, swRegistered, triggerInstall } = usePWAInstall();
  const {
    isSyncing: isCloudSyncing,
    syncProgress: cloudSyncProgress,
    stats: cloudSyncStats,
    conflicts,
    setIsConflictModalOpen,
    isSyncButtonActive: isCloudSyncButtonActive,
    isLiveSyncActive,
    isQuotaExceeded,
    syncMode,
    toggleSyncMode,
    d1Health,
    pingD1Health,
    triggerSync: triggerCloudSync,
    triggerSyncAll,
    triggerD1Pull,
    pullCentralRecords,
    triggerDriveSync,
    restoreDriveBackup,
    prepareDriveRestore,
    driveRestorePreview,
    hasDriveUnsynced,
    lastDriveBackupFile,
    lastDriveBackupTime,
    driveAuthStatus,
    isDriveAuthModalOpen,
    setIsDriveAuthModalOpen,
    disconnectDrive,
  } = useCloudSync();

  const isAdmin = currentUser?.role === 'Administrator' || isSuperAdmin;
  const isAccountant = currentUser?.role === 'Accountant';
  const isSalesStaff = currentUser?.role === 'Sales Staff';
  const canAccessDatabaseTab = isAdmin || isAccountant;

  const [activeTab, setActiveTab] = useState<'users' | 'security' | 'store' | 'audit' | 'indexeddb'>(
    isAdmin ? 'users' : 'security'
  );
  const [formData, setFormData] = useState({ ...settings });
  const [savedToast, setSavedToast] = useState(false);

  useEffect(() => {
    setFormData({ ...settings });
  }, [settings]);

  // Audit Trail states
  const [auditSearch, setAuditSearch] = useState('');
  const [auditCategoryFilter, setAuditCategoryFilter] = useState<string>('All');
  const [auditUserFilter, setAuditUserFilter] = useState<string>('All');
  const [auditDateFilter, setAuditDateFilter] = useState<string>('All');
  const [showConfirmClearAudit, setShowConfirmClearAudit] = useState(false);

  // IndexedDB & Firebase status states
  const [dbCounts, setDbCounts] = useState<Record<string, number>>({});
  const [storageEstimate, setStorageEstimate] = useState<{ usage: number; quota: number; jsonSizeBytes: number }>({
    usage: 0,
    quota: 0,
    jsonSizeBytes: 0,
  });
  const [isRefreshingCounts, setIsRefreshingCounts] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [isClearingDB, setIsClearingDB] = useState(false);
  const [showConfirmResetDB, setShowConfirmResetDB] = useState(false);
  const [isUnsyncedChangesModalOpen, setIsUnsyncedChangesModalOpen] = useState(false);

  const [showDesktopInstallModal, setShowDesktopInstallModal] = useState(false);

  const refreshDBCounts = async (isManualClick: boolean = false) => {
    setIsRefreshingCounts(true);
    try {
      const counts = await getStoreRecordCounts();
      setDbCounts(counts);
      const est = await getStorageEstimate();
      setStorageEstimate(est);

      if (isManualClick) {
        const total = Object.values(counts).reduce((acc: number, curr: number) => acc + curr, 0);
        const health = await pingD1Health().catch(() => null);
        showToast({
          title: 'Database Record Counts Refreshed',
          message: `IndexedDB: ${total} local records. Cloudflare D1: ${health?.totalDocuments ?? d1Health?.totalDocuments ?? 'Connected'} remote records.`,
          type: 'success',
        });
      }
    } catch (err: any) {
      if (isManualClick) {
        showToast({
          title: 'Refresh Error',
          message: err?.message || 'Failed to refresh record counts.',
          type: 'error',
        });
      }
    } finally {
      setIsRefreshingCounts(false);
    }
  };

  useEffect(() => {
    if (activeTab === 'indexeddb') {
      refreshDBCounts(false);
    }
  }, [activeTab]);

  const handleDiscardLocalRecords = async () => {
    if (!isAdmin) {
      showToast({
        title: 'Access Denied',
        message: 'Only Super-user and Administrator roles can discard local records.',
        type: 'error',
      });
      setShowConfirmResetDB(false);
      return;
    }
    setIsClearingDB(true);
    try {
      // Discard exactly the local records pending D1 sync. In-sync records stay intact,
      // and D1 is never written: pending deletion intents are dropped so the cloud keeps them.
      const pendingKeys = getUnsyncedItemKeys();
      const pendingDeletions = getD1PendingDeletions();
      const validStores = new Set<string>(ALL_STORES as readonly string[]);
      const byStore = groupPendingD1KeysByStore(pendingKeys, pendingDeletions, validStores);

      let discardedCount = 0;
      for (const [collection, ids] of byStore) {
        for (const id of ids) {
          try {
            await deleteItem(collection as StoreName, id);
            discardedCount += 1;
          } catch (err) {
            console.warn(`Discard unsynced record failed for ${collection}/${id}:`, err);
          }
        }
      }

      // Drop the pending sync queues only. D1 is left untouched and never reloaded here;
      // AppContext refreshes its in-memory lists from the same-tab broadcast below.
      clearUnsyncedLocalChanges();
      clearD1PendingSync();
      try {
        if (typeof window !== 'undefined' && typeof window.dispatchEvent === 'function') {
          const touchedStores = [...byStore.keys()];
          window.dispatchEvent(new CustomEvent('idofera_unsynced_discarded', { detail: { stores: touchedStores } }));
        }
      } catch (err) {
        console.warn('Discard broadcast warning:', err);
      }

      showToast({
        title: 'Unsynced Local Records Discarded',
        message:
          discardedCount > 0
            ? `Discarded ${discardedCount} unsynced local record(s) pending D1 sync. In-sync local records and D1 were not modified.`
            : 'No unsynced local records were pending D1 sync. In-sync local records and D1 were not modified.',
        type: 'success',
      });
    } catch (err: any) {
      showToast({
        title: 'Discard Failed',
        message: err.message || 'Failed to discard unsynced local records.',
        type: 'error',
      });
    } finally {
      setIsClearingDB(false);
      setShowConfirmResetDB(false);
    }
  };

  const handleExportBackup = async () => {
    if (isSalesStaff) {
      showToast({ title: 'Access Denied', message: 'Sales staff cannot access Offline Data Backup & Migration Tools.', type: 'error' });
      return;
    }
    if (!isAdmin && !isAccountant) {
      showToast({ title: 'Access Denied', message: 'Administrator, Super Admin, or Accountant role required to export database backups.', type: 'error' });
      return;
    }
    setIsExporting(true);
    try {
      const { fileName, revision, totalRecords, blob } = await createD1BackupExport();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = fileName;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      showToast({
        title: 'Backup Exported',
        message: `Downloaded ${fileName} (D1 Rev #${revision}) with ${totalRecords} records.`,
        type: 'success',
      });
    } catch (err: any) {
      showToast({ title: 'Export Failed', message: err.message || 'Error exporting D1 database backup.', type: 'error' });
    } finally {
      setIsExporting(false);
    }
  };

  const handleImportBackup = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!isAdmin) {
      showToast({
        title: 'Access Denied',
        message: 'Only Super-user and Administrator roles can Restore / Import JSON Backup. Accountants and Sales Staff are restricted.',
        type: 'error',
      });
      return;
    }
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = async (event) => {
      const content = event.target?.result as string;
      if (content) {
        const success = await importDatabaseJSON(content);
        if (success) {
          showToast({ title: 'Backup Restored', message: 'IndexedDB data restored successfully. Reloading page...', type: 'success' });
          setTimeout(() => {
            window.location.reload();
          }, 1500);
        } else {
          showToast({ title: 'Import Failed', message: 'Invalid backup file format.', type: 'error' });
        }
      }
    };
    reader.readAsText(file);
  };


  // User management states
  const [isUserModalOpen, setIsUserModalOpen] = useState(false);
  const [editingUser, setEditingUser] = useState<UserProfile | null>(null);
  const [userToDelete, setUserToDelete] = useState<UserProfile | null>(null);
  const [userSearch, setUserSearch] = useState('');
  const [roleFilter, setRoleFilter] = useState<string>('All');
  const [actionError, setActionError] = useState<string | null>(null);

  // Google Drive restore confirm state
  const [showConfirmRestoreDrive, setShowConfirmRestoreDrive] = useState(false);
  const [isResetPasswordModalOpen, setIsResetPasswordModalOpen] = useState(false);
  const [targetPasswordResetUser, setTargetPasswordResetUser] = useState<UserProfile | null>(null);

  const handleOpenResetPassword = (user: UserProfile) => {
    setTargetPasswordResetUser(user);
    setIsResetPasswordModalOpen(true);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    updateSettings(formData);
    setSavedToast(true);
    setTimeout(() => setSavedToast(false), 3000);
  };

  const handleOpenAddUser = () => {
    setEditingUser(null);
    setIsUserModalOpen(true);
  };

  const handleOpenEditUser = (user: UserProfile) => {
    setEditingUser(user);
    setIsUserModalOpen(true);
  };

  const confirmDeleteUser = () => {
    if (!userToDelete) return;
    setActionError(null);
    try {
      deleteUser(userToDelete.id);
      logAudit(
        'DELETE_USER',
        'User',
        userToDelete.id,
        currentUser?.displayName || 'Admin',
        `Removed user account ${userToDelete.displayName} (${userToDelete.email}).`
      );
      setUserToDelete(null);
    } catch (err: any) {
      setActionError(err.message || 'Failed to delete user.');
      setUserToDelete(null);
    }
  };

  const handleToggleStatus = (user: UserProfile) => {
    setActionError(null);
    const newStatus = user.status === 'Active' ? 'Inactive' : 'Active';
    try {
      updateUser(user.id, { status: newStatus });
      logAudit(
        'UPDATE_USER_STATUS',
        'User',
        user.id,
        currentUser?.displayName || 'Admin',
        `Changed status of ${user.displayName} to ${newStatus}.`
      );
    } catch (err: any) {
      setActionError(err.message || 'Failed to update user status.');
    }
  };

  const filteredUsers = users.filter((u) => {
    if (!u) return false;
    const q = (userSearch || '').trim().toLowerCase();
    const matchesSearch =
      (u.displayName || '').toLowerCase().includes(q) ||
      (u.username && u.username.toLowerCase().includes(q)) ||
      (u.email || '').toLowerCase().includes(q);
    const matchesRole = roleFilter === 'All' || u.role === roleFilter;
    return matchesSearch && matchesRole;
  });

  const getRoleBadgeColor = (role: UserRole) => {
    switch (role) {
      case 'Administrator':
        return 'bg-blue-100 dark:bg-blue-950/80 text-blue-700 dark:text-blue-300 border-blue-200 dark:border-blue-900';
      case 'Sales Staff':
        return 'bg-emerald-100 dark:bg-emerald-950/80 text-emerald-700 dark:text-emerald-300 border-emerald-200 dark:border-emerald-900';
      case 'Accountant':
        return 'bg-amber-100 dark:bg-amber-950/80 text-amber-700 dark:text-amber-300 border-amber-200 dark:border-amber-900';
      default:
        return 'bg-slate-100 text-slate-700';
    }
  };

  // Audit Trail filtering & export logic (User Events only, excluding System Auto-Sync)
  const userAuditLogs = auditLogs.filter(
    (l) => l && l.performedBy !== 'System Auto-Sync' && l.action !== 'AUTO_RESOLVE_CONFLICT' && !(l.performedBy || '').toLowerCase().includes('auto-sync')
  );

  const uniqueAuditUsers = Array.from(new Set(userAuditLogs.map((l) => l?.performedBy))).filter(Boolean);

  const filteredAuditLogs = userAuditLogs.filter((log) => {
    if (!log) return false;
    const searchLower = (auditSearch || '').toLowerCase();
    const matchesSearch =
      (log.action || '').toLowerCase().includes(searchLower) ||
      (log.entity || '').toLowerCase().includes(searchLower) ||
      (log.entityId && log.entityId.toLowerCase().includes(searchLower)) ||
      (log.performedBy || '').toLowerCase().includes(searchLower) ||
      (log.details || '').toLowerCase().includes(searchLower);

    const matchesCategory =
      auditCategoryFilter === 'All' ||
      (log.entity || '').toLowerCase() === (auditCategoryFilter || '').toLowerCase() ||
      (auditCategoryFilter === 'Sales' && ((log.entity || '') === 'Sale' || (log.action || '').includes('SALE'))) ||
      (auditCategoryFilter === 'Inventory' && ((log.entity || '') === 'Inventory' || (log.entity || '') === 'Product' || (log.action || '').includes('STOCK') || (log.action || '').includes('INVENTORY'))) ||
      (auditCategoryFilter === 'User' && ((log.entity || '') === 'User' || (log.action || '').includes('USER') || (log.action || '').includes('PASSWORD'))) ||
      (auditCategoryFilter === 'Pricing' && ((log.entity || '') === 'Pricing' || (log.action || '').includes('PRICE')));

    const matchesUser = auditUserFilter === 'All' || log.performedBy === auditUserFilter;

    let matchesDate = true;
    if (auditDateFilter === 'Today') {
      const logDate = new Date(log.createdAt).toDateString();
      const today = new Date().toDateString();
      matchesDate = logDate === today;
    } else if (auditDateFilter === '7days') {
      const logTime = new Date(log.createdAt).getTime();
      const SevenDaysAgo = Date.now() - 7 * 86400000;
      matchesDate = logTime >= SevenDaysAgo;
    } else if (auditDateFilter === '30days') {
      const logTime = new Date(log.createdAt).getTime();
      const ThirtyDaysAgo = Date.now() - 30 * 86400000;
      matchesDate = logTime >= ThirtyDaysAgo;
    }

    return matchesSearch && matchesCategory && matchesUser && matchesDate;
  });

  const getActionBadgeStyle = (action: string) => {
    const upper = action.toUpperCase();
    if (upper.includes('CREATE') || upper.includes('IMPORT') || upper.includes('ADD') || upper.includes('RESTORE')) {
      return 'bg-emerald-100 dark:bg-emerald-950/80 text-emerald-800 dark:text-emerald-300 border-emerald-200 dark:border-emerald-900';
    }
    if (upper.includes('UPDATE') || upper.includes('PRICE') || upper.includes('CHANGE') || upper.includes('EDIT')) {
      return 'bg-blue-100 dark:bg-blue-950/80 text-blue-800 dark:text-blue-300 border-blue-200 dark:border-blue-900';
    }
    if (upper.includes('DELETE') || upper.includes('REMOVE') || upper.includes('CLEAR') || upper.includes('WIPE')) {
      return 'bg-rose-100 dark:bg-rose-950/80 text-rose-800 dark:text-rose-300 border-rose-200 dark:border-rose-900';
    }
    if (upper.includes('REFUND') || upper.includes('ADJUST') || upper.includes('INVENTORY') || upper.includes('CHECKPOINT')) {
      return 'bg-amber-100 dark:bg-amber-950/80 text-amber-800 dark:text-amber-300 border-amber-200 dark:border-amber-900';
    }
    if (upper.includes('USER') || upper.includes('ROLE') || upper.includes('PASSWORD') || upper.includes('SECURITY')) {
      return 'bg-purple-100 dark:bg-purple-950/80 text-purple-800 dark:text-purple-300 border-purple-200 dark:border-purple-900';
    }
    return 'bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 border-slate-200 dark:border-slate-700';
  };

  const handleExportAuditCSV = () => {
    if (filteredAuditLogs.length === 0) {
      showToast({ title: 'No Logs to Export', message: 'There are no audit logs matching your current filters.', type: 'info' });
      return;
    }
    const headers = ['Audit ID', 'Timestamp', 'Action Type', 'Entity', 'Entity ID', 'Performed By', 'Details'];
    const rows = filteredAuditLogs.map((log) => [
      log.id,
      new Date(log.createdAt).toLocaleString(),
      log.action,
      log.entity,
      log.entityId || 'N/A',
      `"${(log.performedBy || 'System').replace(/"/g, '""')}"`,
      `"${(log.details || '').replace(/"/g, '""')}"`,
    ]);
    const csvString = [headers.join(','), ...rows.map((r) => r.join(','))].join('\n');
    const blob = new Blob([csvString], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', `system_audit_trail_${new Date().toISOString().slice(0, 10)}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    showToast({ title: 'Audit Trail Exported', message: `${filteredAuditLogs.length} audit records exported to CSV.`, type: 'success' });
  };

  const handleCreateManualCheckpoint = () => {
    logAudit(
      'MANUAL_CHECKPOINT',
      'AuditTrail',
      'chk-' + Date.now(),
      currentUser?.displayName || 'Administrator',
      'Logged manual administrative system audit checkpoint.'
    );
    showToast({ title: 'Checkpoint Recorded', message: 'Manual audit log entry successfully created.', type: 'success' });
  };

  const handleConfirmClearAudit = () => {
    clearAuditLogs();
    logAudit(
      'CLEAR_AUDIT_TRAIL',
      'AuditTrail',
      undefined,
      currentUser?.displayName || 'Admin',
      'Cleared system audit log history.'
    );
    setShowConfirmClearAudit(false);
    showToast({ title: 'Audit Trail Cleared', message: 'Audit history has been reset.', type: 'success' });
  };

  return (
    <div className="space-y-6 pb-12">
      <div>
        <h1 className="text-2xl font-black text-slate-900 dark:text-white tracking-tight">
          System Settings & Staff Administration
        </h1>
        <p className="text-xs text-slate-500">
          Manage user accounts, roles & permissions, store settings, tax rates, and security audit logs.
        </p>
      </div>

      {/* Tabs */}
      <div className="flex items-center gap-2 border-b border-slate-200 dark:border-slate-800 pb-2 overflow-x-auto">
        <button
          onClick={() => setActiveTab('users')}
          className={`flex items-center gap-2 px-4 py-2.5 rounded-xl text-xs font-bold transition-all whitespace-nowrap ${
            activeTab === 'users'
              ? 'bg-blue-600 text-white shadow-md shadow-blue-500/20'
              : 'text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800'
          }`}
        >
          <Users className="w-4 h-4" />
          <span>User & Role Management</span>
          <span
            className={`px-1.5 py-0.5 rounded-full text-[10px] font-extrabold ${
              activeTab === 'users' ? 'bg-white/20 text-white' : 'bg-slate-200 dark:bg-slate-700 text-slate-700 dark:text-slate-300'
            }`}
          >
            {users.length}
          </span>
        </button>

        <button
          onClick={() => setActiveTab('security')}
          className={`flex items-center gap-2 px-4 py-2.5 rounded-xl text-xs font-bold transition-all whitespace-nowrap ${
            activeTab === 'security'
              ? 'bg-blue-600 text-white shadow-md shadow-blue-500/20'
              : 'text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800'
          }`}
        >
          <KeyRound className="w-4 h-4" />
          <span>My Account & Password</span>
        </button>

        <button
          onClick={() => setActiveTab('store')}
          className={`flex items-center gap-2 px-4 py-2.5 rounded-xl text-xs font-bold transition-all whitespace-nowrap ${
            activeTab === 'store'
              ? 'bg-blue-600 text-white shadow-md shadow-blue-500/20'
              : 'text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800'
          }`}
        >
          <Building2 className="w-4 h-4" />
          <span>Store Profile & Receipts</span>
        </button>

        <button
          onClick={() => setActiveTab('audit')}
          className={`flex items-center gap-2 px-4 py-2.5 rounded-xl text-xs font-bold transition-all whitespace-nowrap ${
            activeTab === 'audit'
              ? 'bg-blue-600 text-white shadow-md shadow-blue-500/20'
              : 'text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800'
          }`}
        >
          <History className="w-4 h-4" />
          <span>System Audit Trail</span>
        </button>

        {canAccessDatabaseTab && (
          <button
            onClick={() => setActiveTab('indexeddb')}
            className={`flex items-center gap-2 px-4 py-2.5 rounded-xl text-xs font-bold transition-all whitespace-nowrap ${
              activeTab === 'indexeddb'
                ? 'bg-blue-600 text-white shadow-md shadow-blue-500/20'
                : 'text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800'
            }`}
          >
            <Database className="w-4 h-4 text-emerald-400" />
            <span>IndexedDB Storage & Offline Tools</span>
          </button>
        )}
      </div>

      {/* Global Action Error Alert */}
      {actionError && (
        <div className="p-4 bg-rose-50 dark:bg-rose-950/50 border border-rose-200 dark:border-rose-900/60 rounded-2xl flex items-center justify-between gap-3 text-rose-700 dark:text-rose-300 text-xs font-semibold animate-in fade-in duration-150">
          <div className="flex items-center gap-2">
            <ShieldAlert className="w-5 h-5 shrink-0 text-rose-500" />
            <span>{actionError}</span>
          </div>
          <button
            onClick={() => setActionError(null)}
            className="text-xs text-rose-500 hover:underline font-bold"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* USER & ROLE MANAGEMENT TAB */}
      {activeTab === 'users' && (
        <div className="bg-white dark:bg-slate-900 p-6 rounded-3xl border border-slate-200/80 dark:border-slate-800 shadow-xs space-y-5">
          {/* Top Bar */}
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 border-b border-slate-100 dark:border-slate-800 pb-4">
            <div>
              <h2 className="font-extrabold text-lg text-slate-900 dark:text-white flex items-center gap-2">
                <Shield className="w-5 h-5 text-blue-600" />
                <span>Staff Accounts & Role Permissions</span>
              </h2>
              <p className="text-xs text-slate-500">
                {isAdmin
                  ? 'Create new staff members, edit roles (Administrator, Sales Staff, Accountant), activate or deactivate access, and remove accounts.'
                  : 'View active team members and staff account roles.'}
              </p>
            </div>

            {isSuperAdmin && (
              <button
                onClick={handleOpenAddUser}
                className="flex items-center gap-2 px-4 py-2.5 bg-blue-600 hover:bg-blue-700 text-white font-extrabold rounded-2xl text-xs shadow-md shadow-blue-500/20 transition-all hover:scale-105"
              >
                <UserPlus className="w-4 h-4" />
                <span>Add Staff Member</span>
              </button>
            )}
          </div>

          {!isSuperAdmin && (
            <div className="p-3 bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-900/60 rounded-2xl flex items-center gap-2.5 text-amber-800 dark:text-amber-300 text-xs font-medium">
              <ShieldAlert className="w-4 h-4 text-amber-500 shrink-0" />
              <span>
                {isAdmin
                  ? '🔒 Regular Administrator privileges: You can edit existing staff profiles (except the Super-User). Creating accounts, auto account switching, and account deletion are restricted to the Super-User session.'
                  : 'Read-only staff directory. Adding accounts, modifying roles, deactivating staff, and resetting other users passwords requires Administrator access.'}
              </span>
            </div>
          )}

          {/* Filters & Search */}
          <div className="flex flex-col sm:flex-row items-center justify-between gap-3">
            <div className="relative flex-1 w-full min-w-0">
              <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                type="text"
                placeholder="Search staff by name, username or email..."
                value={userSearch}
                onChange={(e) => setUserSearch(e.target.value)}
                className="w-full pl-9 pr-8 py-2 bg-slate-100 dark:bg-slate-800 rounded-xl text-xs font-medium text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              {userSearch && (
                <button
                  onClick={() => setUserSearch('')}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
                  title="Clear search"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>

            <div className="flex items-center gap-2 w-full sm:w-auto">
              <span className="text-xs font-bold text-slate-500">Filter Role:</span>
              <select
                value={roleFilter}
                onChange={(e) => setRoleFilter(e.target.value)}
                className="p-2 bg-slate-100 dark:bg-slate-800 rounded-xl text-xs font-bold text-slate-900 dark:text-white focus:outline-none"
              >
                <option value="All">All Roles</option>
                <option value="Administrator">Administrator</option>
                <option value="Sales Staff">Sales Staff</option>
                <option value="Accountant">Accountant</option>
              </select>
            </div>
          </div>

          {/* Users Directory Table */}
          <div className="overflow-x-auto rounded-2xl border border-slate-200/80 dark:border-slate-800">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-50 dark:bg-slate-800/50 text-slate-500 font-bold uppercase tracking-wider text-[10px] border-b border-slate-200/80 dark:border-slate-800">
                <tr>
                  <th className="p-3.5">User Details</th>
                  <th className="p-3.5">Email</th>
                  <th className="p-3.5">Assigned Role</th>
                  <th className="p-3.5">Status</th>
                  <th className="p-3.5">Active Session</th>
                  <th className="p-3.5 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800 font-medium">
                {filteredUsers.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="p-8 text-center text-slate-400">
                      No staff users match your search criteria.
                    </td>
                  </tr>
                ) : (
                  filteredUsers.map((user) => {
                    const isSelf = currentUser?.id === user.id;

                    return (
                      <tr
                        key={user.id}
                        className={`hover:bg-slate-50/80 dark:hover:bg-slate-800/40 transition-colors ${
                          isSelf ? 'bg-blue-50/40 dark:bg-blue-950/20' : ''
                        }`}
                      >
                        <td className="p-3.5">
                          <div className="flex items-center gap-3">
                            {user.avatarUrl ? (
                              <img
                                src={user.avatarUrl}
                                alt={user.displayName}
                                referrerPolicy="no-referrer"
                                className="w-9 h-9 rounded-xl object-cover ring-2 ring-slate-200 dark:ring-slate-700"
                              />
                            ) : (
                              <div className="w-9 h-9 rounded-xl bg-blue-100 dark:bg-blue-900/60 text-blue-600 dark:text-blue-300 flex items-center justify-center font-extrabold text-xs">
                                {user.displayName.charAt(0)}
                              </div>
                            )}
                            <div>
                              <p className="font-bold text-slate-900 dark:text-white flex items-center gap-1.5">
                                {user.displayName}
                                {user.username && (
                                  <span className="text-[10px] text-blue-600 dark:text-blue-400 font-semibold bg-blue-50 dark:bg-blue-950/60 px-1.5 py-0.2 rounded border border-blue-200/60 dark:border-blue-900/60">
                                    @{user.username}
                                  </span>
                                )}
                                {isSelf && (
                                  <span className="px-1.5 py-0.5 bg-blue-600 text-white rounded text-[9px] font-extrabold uppercase">
                                    You
                                  </span>
                                )}
                              </p>
                              <p className="text-[10px] text-slate-400">ID: {user.id}</p>
                            </div>
                          </div>
                        </td>

                        <td className="p-3.5 font-mono text-slate-600 dark:text-slate-300">
                          {user.email}
                        </td>

                        <td className="p-3.5">
                          <span
                            className={`px-2.5 py-1 rounded-xl text-[11px] font-extrabold border ${getRoleBadgeColor(
                              user.role
                            )}`}
                          >
                            {user.role}
                          </span>
                        </td>

                        <td className="p-3.5">
                          <button
                            onClick={() => isAdmin && handleToggleStatus(user)}
                            disabled={!isAdmin}
                            className={`flex items-center gap-1.5 px-2.5 py-1 rounded-xl text-[11px] font-bold border transition-all ${
                              !isAdmin
                                ? 'opacity-60 cursor-not-allowed bg-slate-100 dark:bg-slate-800 text-slate-500 border-slate-200 dark:border-slate-700'
                                : user.status === 'Active'
                                ? 'bg-emerald-50 dark:bg-emerald-950/50 text-emerald-600 dark:text-emerald-400 border-emerald-200 dark:border-emerald-800/60 hover:bg-emerald-100 cursor-pointer'
                                : 'bg-slate-100 dark:bg-slate-800 text-slate-500 border-slate-200 dark:border-slate-700 hover:bg-slate-200 cursor-pointer'
                            }`}
                            title={isAdmin ? 'Click to toggle active status' : 'Administrator access required'}
                          >
                            {user.status === 'Active' ? (
                              <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" />
                            ) : (
                              <XCircle className="w-3.5 h-3.5 text-slate-400" />
                            )}
                            <span>{user.status}</span>
                          </button>
                        </td>

                        <td className="p-3.5">
                          {isSelf ? (
                            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 bg-blue-100 dark:bg-blue-950/80 text-blue-600 dark:text-blue-400 rounded-xl text-[11px] font-bold">
                              <UserCheck className="w-3.5 h-3.5" /> Logged In
                            </span>
                          ) : isSuperAdmin ? (
                            <button
                              onClick={() => switchUser(user.id)}
                              className="px-2.5 py-1 bg-slate-100 dark:bg-slate-800 hover:bg-blue-50 dark:hover:bg-blue-950/50 text-slate-700 dark:text-slate-300 hover:text-blue-600 dark:hover:text-blue-400 rounded-xl text-[11px] font-bold transition-colors border border-slate-200/80 dark:border-slate-700 cursor-pointer"
                            >
                              Switch to User
                            </button>
                          ) : (
                            <span className="text-[11px] text-slate-400 font-medium">Team Member</span>
                          )}
                        </td>

                        <td className="p-3.5 text-right">
                          <div className="flex items-center justify-end gap-1.5">
                            {/* Reset Password button: only self, or admins editing non-super-user, or super-admin */}
                            {(isSelf || (isAdmin && (!isSuperUser(user) || isSuperAdmin))) && (
                              <button
                                onClick={() => handleOpenResetPassword(user)}
                                className="p-1.5 text-slate-500 hover:text-indigo-600 dark:hover:text-indigo-400 hover:bg-indigo-50 dark:hover:bg-indigo-950/50 rounded-lg transition-colors flex items-center gap-1 text-[11px] font-bold cursor-pointer"
                                title={isSelf ? 'Set or change your own password' : `Reset log-in password for ${user.displayName}`}
                              >
                                <KeyRound className="w-4 h-4 text-indigo-500" />
                                <span className="hidden sm:inline">{isSelf ? 'Change Password' : 'Reset Password'}</span>
                              </button>
                            )}

                            {/* Edit User button: self, or admin editing non-super-user, or super-admin */}
                            {(isSelf || (isAdmin && (!isSuperUser(user) || isSuperAdmin))) && (
                              <button
                                onClick={() => handleOpenEditUser(user)}
                                className="p-1.5 text-slate-500 hover:text-blue-600 dark:hover:text-blue-400 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg transition-colors cursor-pointer"
                                title="Edit user details and role"
                              >
                                <Edit2 className="w-4 h-4" />
                              </button>
                            )}

                            {/* Delete User button: ONLY Super-User session can delete user accounts */}
                            {isSuperAdmin && !isSelf && !isSuperUser(user) && (
                              <button
                                onClick={() => setUserToDelete(user)}
                                className="p-1.5 text-slate-400 hover:text-rose-600 dark:hover:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/50 transition-colors rounded-lg cursor-pointer"
                                title="Delete user"
                              >
                                <Trash2 className="w-4 h-4" />
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* MY ACCOUNT & SECURITY TAB */}
      {activeTab === 'security' && (
        <div className="bg-white dark:bg-slate-900 p-6 rounded-3xl border border-slate-200/80 dark:border-slate-800 shadow-xs space-y-6 max-w-2xl">
          <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-4">
            <div className="flex items-center gap-3">
              <div className="p-2.5 bg-indigo-100 dark:bg-indigo-950/60 text-indigo-600 dark:text-indigo-400 rounded-2xl">
                <Lock className="w-6 h-6" />
              </div>
              <div>
                <h3 className="font-extrabold text-base text-slate-900 dark:text-white">
                  My Account Credentials & Security
                </h3>
                <p className="text-xs text-slate-500">
                  Manage your log-in password and account security settings
                </p>
              </div>
            </div>
          </div>

          {/* User Account Info Card */}
          <div className="p-4 bg-slate-50 dark:bg-slate-800/50 border border-slate-200/70 dark:border-slate-700/60 rounded-2xl flex items-center justify-between gap-4">
            <div className="flex items-center gap-3 min-w-0">
              {currentUser?.avatarUrl ? (
                <img
                  src={currentUser.avatarUrl}
                  alt={currentUser.displayName}
                  referrerPolicy="no-referrer"
                  className="w-12 h-12 rounded-2xl object-cover ring-2 ring-indigo-500/40"
                />
              ) : (
                <div className="w-12 h-12 rounded-2xl bg-indigo-600 text-white font-extrabold text-base flex items-center justify-center">
                  {currentUser?.displayName.charAt(0)}
                </div>
              )}
              <div className="min-w-0">
                <h4 className="font-bold text-slate-900 dark:text-white text-sm truncate">
                  {currentUser?.displayName}
                </h4>
                <p className="text-xs text-slate-500 dark:text-slate-400 truncate">
                  {currentUser?.email}
                </p>
                <div className="flex items-center gap-2 mt-1">
                  <span className="text-[10px] font-extrabold px-2 py-0.5 rounded-full bg-indigo-100 dark:bg-indigo-950 text-indigo-700 dark:text-indigo-300">
                    {currentUser?.role}
                  </span>
                  <span className="text-[10px] text-slate-400">
                    ID: {currentUser?.id}
                  </span>
                </div>
              </div>
            </div>

            <button
              onClick={() => handleOpenResetPassword(currentUser!)}
              className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-xs font-bold shadow-sm transition-all flex items-center gap-2 cursor-pointer shrink-0"
            >
              <KeyRound className="w-4 h-4" />
              <span>Change Password</span>
            </button>
          </div>

          {/* Password Security Card */}
          <div className="p-4 bg-white dark:bg-slate-800/30 border border-slate-200/80 dark:border-slate-700/80 rounded-2xl space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-slate-700 dark:text-slate-300">
                Log-in Password Status
              </span>
              <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-emerald-100 dark:bg-emerald-950/80 text-emerald-700 dark:text-emerald-400 text-[11px] font-bold">
                <CheckCircle2 className="w-3.5 h-3.5" /> Password Configured
              </span>
            </div>
            
            <p className="text-xs text-slate-500 dark:text-slate-400">
              {currentUser?.passwordLastChanged ? (
                <>Password last updated: <span className="font-mono font-bold text-slate-700 dark:text-slate-300">{new Date(currentUser.passwordLastChanged).toLocaleString()}</span></>
              ) : (
                <>Using default user log-in credentials.</>
              )}
            </p>

            {currentUser?.role === 'Administrator' && (
              <div className="pt-3 border-t border-slate-100 dark:border-slate-800 text-[11px] text-indigo-600 dark:text-indigo-400 font-medium flex items-center gap-1.5">
                <KeyRound className="w-3.5 h-3.5 text-indigo-500 shrink-0" />
                <span>As Administrator, you can also reset log-in passwords for all staff members from the "User & Role Management" tab.</span>
              </div>
            )}
          </div>
        </div>
      )}

      {/* STORE PROFILE TAB */}
      {activeTab === 'store' && (
        !isAdmin ? (
          <div className="bg-white dark:bg-slate-900 p-8 rounded-3xl border border-slate-200/80 dark:border-slate-800 shadow-xs max-w-xl mx-auto text-center space-y-3">
            <div className="w-12 h-12 bg-amber-100 dark:bg-amber-950/80 text-amber-600 dark:text-amber-400 rounded-2xl flex items-center justify-center mx-auto">
              <ShieldAlert className="w-6 h-6" />
            </div>
            <h3 className="font-extrabold text-base text-slate-900 dark:text-white">
              Store Configuration Restricted
            </h3>
            <p className="text-xs text-slate-500">
              Editing store profile details, tax defaults, currency symbols, and receipt headers/footers requires Administrator privileges.
            </p>
          </div>
        ) : (
          <div className="bg-white dark:bg-slate-900 p-6 rounded-3xl border border-slate-200/80 dark:border-slate-800 shadow-xs space-y-4 max-w-3xl">
            <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-3">
              <h3 className="font-extrabold text-base text-slate-900 dark:text-white flex items-center gap-2">
                <Building2 className="w-5 h-5 text-blue-600" />
                Store Profile & Tax Defaults
              </h3>
              {savedToast && (
                <span className="flex items-center gap-1 text-xs font-bold text-emerald-600">
                  <Check className="w-4 h-4" /> Settings Saved!
                </span>
              )}
            </div>

            <form onSubmit={handleSubmit} className="space-y-4 text-xs">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block font-bold mb-1">Store Name</label>
                  <input
                    type="text"
                    value={formData.storeName}
                    onChange={(e) => setFormData({ ...formData, storeName: e.target.value })}
                    className="w-full p-2.5 bg-slate-100 dark:bg-slate-800 rounded-xl"
                  />
                </div>

                <div>
                  <label className="block font-bold mb-1">Phone Number</label>
                  <input
                    type="text"
                    value={formData.phone}
                    onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
                    className="w-full p-2.5 bg-slate-100 dark:bg-slate-800 rounded-xl"
                  />
                </div>

                <div>
                  <label className="block font-bold mb-1">Store Email</label>
                  <input
                    type="email"
                    value={formData.email}
                    onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                    className="w-full p-2.5 bg-slate-100 dark:bg-slate-800 rounded-xl"
                  />
                </div>

                <div>
                  <label className="block font-bold mb-1">Store Physical Address</label>
                  <input
                    type="text"
                    value={formData.address}
                    onChange={(e) => setFormData({ ...formData, address: e.target.value })}
                    className="w-full p-2.5 bg-slate-100 dark:bg-slate-800 rounded-xl"
                  />
                </div>

                <div>
                  <label className="block font-bold mb-1">Tax Rate (%)</label>
                  <input
                    type="number"
                    step="0.1"
                    value={formData.taxRatePct}
                    onChange={(e) => setFormData({ ...formData, taxRatePct: parseFloat(e.target.value) || 0 })}
                    className="w-full p-2.5 bg-slate-100 dark:bg-slate-800 rounded-xl font-bold"
                  />
                </div>

                <div>
                  <label className="block font-bold mb-1">Currency Symbol</label>
                  <input
                    type="text"
                    value={formData.currencySymbol}
                    onChange={(e) => setFormData({ ...formData, currencySymbol: e.target.value })}
                    className="w-full p-2.5 bg-slate-100 dark:bg-slate-800 rounded-xl font-bold"
                  />
                </div>

                <div>
                  <label className="block font-bold mb-1">Default Min Wholesale Qty</label>
                  <input
                    type="number"
                    value={formData.defaultMinWholesaleQty}
                    onChange={(e) => setFormData({ ...formData, defaultMinWholesaleQty: parseInt(e.target.value) || 1 })}
                    className="w-full p-2.5 bg-slate-100 dark:bg-slate-800 rounded-xl font-bold"
                  />
                </div>
              </div>

              <div>
                <label className="block font-bold mb-1">Receipt Header Note</label>
                <input
                  type="text"
                  value={formData.receiptHeader}
                  onChange={(e) => setFormData({ ...formData, receiptHeader: e.target.value })}
                  className="w-full p-2.5 bg-slate-100 dark:bg-slate-800 rounded-xl"
                />
              </div>

              <div>
                <label className="block font-bold mb-1">Receipt Footer Note</label>
                <input
                  type="text"
                  value={formData.receiptFooter}
                  onChange={(e) => setFormData({ ...formData, receiptFooter: e.target.value })}
                  className="w-full p-2.5 bg-slate-100 dark:bg-slate-800 rounded-xl"
                />
              </div>

              <div className="p-4 bg-emerald-50/60 dark:bg-emerald-950/30 rounded-2xl border border-emerald-200/80 dark:border-emerald-800/80 space-y-2">
                <label className="block font-bold text-slate-900 dark:text-white text-sm">
                  WhatsApp Pre-Order Sales Attribution Default Rule
                </label>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  Select how sales commission/'Served By' credit is assigned when converting WhatsApp pre-orders created by one staff member and finalized by another:
                </p>
                <select
                  value={formData.whatsAppSalesAttributionRule || 'converter'}
                  onChange={(e) =>
                    setFormData({
                      ...formData,
                      whatsAppSalesAttributionRule: e.target.value as 'converter' | 'creator' | 'custom',
                    })
                  }
                  className="w-full p-2.5 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl text-xs font-semibold dark:text-white"
                >
                  <option value="converter">Approach 1: Converting Cashier (Person who finalized the sale gets credit)</option>
                  <option value="creator">Approach 2: Order Creator (Person who originally took down the pre-order gets credit)</option>
                  <option value="custom">Approach 3: Prompt & Select (Cashier chooses/splits credit at conversion modal)</option>
                </select>
              </div>

              <button
                type="submit"
                className="w-full py-3 bg-blue-600 hover:bg-blue-700 text-white font-bold rounded-xl shadow-xs transition-colors flex items-center justify-center gap-2"
              >
                <Save className="w-4 h-4" />
                <span>Save System Settings</span>
              </button>
            </form>
          </div>
        )
      )}

      {/* SYSTEM AUDIT TRAIL TAB */}
      {activeTab === 'audit' && (
        <div className="bg-white dark:bg-slate-900 p-6 rounded-3xl border border-slate-200/80 dark:border-slate-800 shadow-xs space-y-6">
          {/* Audit Header */}
          <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 border-b border-slate-100 dark:border-slate-800 pb-4">
            <div className="flex items-center gap-3">
              <div className="p-3 bg-blue-100 dark:bg-blue-950/80 text-blue-600 dark:text-blue-400 rounded-2xl">
                <History className="w-6 h-6" />
              </div>
              <div>
                <h2 className="font-extrabold text-lg text-slate-900 dark:text-white flex items-center gap-2">
                  <span>System Audit Trail & Security Event Logs</span>
                  <span className="px-2 py-0.5 rounded-full bg-emerald-100 dark:bg-emerald-950 text-emerald-700 dark:text-emerald-400 text-[10px] font-extrabold uppercase tracking-wide flex items-center gap-1">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse"></span>
                    Active Tracking
                  </span>
                </h2>
                <p className="text-xs text-slate-500">
                  Comprehensive history of sales transactions, price overrides, inventory stock movements, staff user actions, and system data changes.
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <button
                onClick={handleCreateManualCheckpoint}
                className="flex items-center gap-1.5 px-3 py-2 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 rounded-xl text-xs font-bold transition-all cursor-pointer"
                title="Create manual audit checkpoint log"
              >
                <PlusCircle className="w-3.5 h-3.5 text-blue-600 dark:text-blue-400" />
                <span>Log Checkpoint</span>
              </button>

              <button
                onClick={handleExportAuditCSV}
                className="flex items-center gap-1.5 px-3 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-xs font-extrabold shadow-sm shadow-blue-500/20 transition-all cursor-pointer"
                title="Export filtered audit logs to CSV spreadsheet"
              >
                <FileSpreadsheet className="w-3.5 h-3.5" />
                <span>Export CSV</span>
              </button>

              {isAdmin && (
                <button
                  onClick={() => setShowConfirmClearAudit(true)}
                  className="flex items-center gap-1.5 px-3 py-2 bg-rose-50 dark:bg-rose-950/60 hover:bg-rose-100 text-rose-700 dark:text-rose-300 rounded-xl text-xs font-bold transition-all border border-rose-200 dark:border-rose-900/50 cursor-pointer"
                  title="Clear audit log history (Administrator access required)"
                >
                  <Trash2 className="w-3.5 h-3.5 text-rose-500" />
                  <span>Clear Logs</span>
                </button>
              )}
            </div>
          </div>

          {/* Audit Metrics */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div className="p-4 bg-slate-50 dark:bg-slate-800/40 border border-slate-200/60 dark:border-slate-800 rounded-2xl space-y-1">
              <div className="flex items-center justify-between text-slate-500">
                <span className="text-[10px] font-extrabold uppercase tracking-wider">Total Audit Events</span>
                <Activity className="w-4 h-4 text-blue-500" />
              </div>
              <p className="text-xl font-black text-slate-900 dark:text-white font-mono">{userAuditLogs.length}</p>
            </div>

            <div className="p-4 bg-slate-50 dark:bg-slate-800/40 border border-slate-200/60 dark:border-slate-800 rounded-2xl space-y-1">
              <div className="flex items-center justify-between text-slate-500">
                <span className="text-[10px] font-extrabold uppercase tracking-wider">Events Today</span>
                <Clock className="w-4 h-4 text-emerald-500" />
              </div>
              <p className="text-xl font-black text-slate-900 dark:text-white font-mono">
                {userAuditLogs.filter((l) => new Date(l.createdAt).toDateString() === new Date().toDateString()).length}
              </p>
            </div>

            <div className="p-4 bg-slate-50 dark:bg-slate-800/40 border border-slate-200/60 dark:border-slate-800 rounded-2xl space-y-1">
              <div className="flex items-center justify-between text-slate-500">
                <span className="text-[10px] font-extrabold uppercase tracking-wider">Active Staff Logs</span>
                <Users className="w-4 h-4 text-purple-500" />
              </div>
              <p className="text-xl font-black text-slate-900 dark:text-white font-mono">{uniqueAuditUsers.length}</p>
            </div>

            <div className="p-4 bg-slate-50 dark:bg-slate-800/40 border border-slate-200/60 dark:border-slate-800 rounded-2xl space-y-1">
              <div className="flex items-center justify-between text-slate-500">
                <span className="text-[10px] font-extrabold uppercase tracking-wider">Price/Stock Overrides</span>
                <Tag className="w-4 h-4 text-amber-500" />
              </div>
              <p className="text-xl font-black text-slate-900 dark:text-white font-mono">
                {
                  userAuditLogs.filter(
                    (l) =>
                      l.action.includes('PRICE') ||
                      l.action.includes('ADJUST') ||
                      l.action.includes('REFUND') ||
                      l.action.includes('DELETE')
                  ).length
                }
              </p>
            </div>
          </div>

          {/* Filters Bar */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 bg-slate-50 dark:bg-slate-800/30 p-3.5 rounded-2xl border border-slate-200/60 dark:border-slate-800">
            {/* Search Input */}
            <div className="relative">
              <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                type="text"
                placeholder="Search audit records..."
                value={auditSearch}
                onChange={(e) => setAuditSearch(e.target.value)}
                className="w-full pl-9 pr-3 py-2 bg-white dark:bg-slate-900 rounded-xl text-xs font-medium text-slate-900 dark:text-white border border-slate-200 dark:border-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>

            {/* Category Filter */}
            <div className="flex items-center gap-2">
              <Filter className="w-4 h-4 text-slate-400 shrink-0" />
              <select
                value={auditCategoryFilter}
                onChange={(e) => setAuditCategoryFilter(e.target.value)}
                className="w-full p-2 bg-white dark:bg-slate-900 rounded-xl text-xs font-bold text-slate-900 dark:text-white border border-slate-200 dark:border-slate-700 focus:outline-none"
              >
                <option value="All">All Categories</option>
                <option value="Sales">Sales & Transactions</option>
                <option value="Inventory">Inventory & Products</option>
                <option value="User">Users & Role Security</option>
                <option value="Pricing">Price Adjustments</option>
                <option value="Supplier">Suppliers & Customers</option>
                <option value="PO">Purchase Orders & Expenses</option>
              </select>
            </div>

            {/* Performed By Filter */}
            <div className="flex items-center gap-2">
              <Users className="w-4 h-4 text-slate-400 shrink-0" />
              <select
                value={auditUserFilter}
                onChange={(e) => setAuditUserFilter(e.target.value)}
                className="w-full p-2 bg-white dark:bg-slate-900 rounded-xl text-xs font-bold text-slate-900 dark:text-white border border-slate-200 dark:border-slate-700 focus:outline-none"
              >
                <option value="All">All Staff / Users</option>
                {uniqueAuditUsers.map((u) => (
                  <option key={u} value={u}>
                    {u}
                  </option>
                ))}
              </select>
            </div>

            {/* Time Filter */}
            <div className="flex items-center gap-2">
              <Calendar className="w-4 h-4 text-slate-400 shrink-0" />
              <select
                value={auditDateFilter}
                onChange={(e) => setAuditDateFilter(e.target.value)}
                className="w-full p-2 bg-white dark:bg-slate-900 rounded-xl text-xs font-bold text-slate-900 dark:text-white border border-slate-200 dark:border-slate-700 focus:outline-none"
              >
                <option value="All">All Time</option>
                <option value="Today">Today Only</option>
                <option value="7days">Last 7 Days</option>
                <option value="30days">Last 30 Days</option>
              </select>
            </div>
          </div>

          {/* Audit Logs Table */}
          <div className="overflow-x-auto rounded-2xl border border-slate-200/80 dark:border-slate-800">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-50 dark:bg-slate-800/50 text-slate-500 font-bold uppercase tracking-wider text-[10px] border-b border-slate-200/80 dark:border-slate-800">
                <tr>
                  <th className="p-3.5">Timestamp</th>
                  <th className="p-3.5">Action Event</th>
                  <th className="p-3.5">Target Entity & ID</th>
                  <th className="p-3.5">Performed By</th>
                  <th className="p-3.5">Activity Details</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800 font-medium">
                {filteredAuditLogs.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="p-10 text-center text-slate-400">
                      <div className="max-w-xs mx-auto space-y-2">
                        <AlertCircle className="w-8 h-8 text-slate-300 dark:text-slate-600 mx-auto" />
                        <p className="font-bold text-slate-600 dark:text-slate-300 text-sm">No Audit Records Found</p>
                        <p className="text-xs text-slate-400">
                          {auditSearch || auditCategoryFilter !== 'All' || auditUserFilter !== 'All' || auditDateFilter !== 'All'
                            ? 'No logs match your current search and filter criteria. Try resetting filters.'
                            : 'No system audit logs recorded yet.'}
                        </p>
                      </div>
                    </td>
                  </tr>
                ) : (
                  filteredAuditLogs.map((log) => (
                    <tr
                      key={log.id}
                      className="hover:bg-slate-50/80 dark:hover:bg-slate-800/40 transition-colors"
                    >
                      <td className="p-3.5 whitespace-nowrap">
                        <div className="font-mono text-slate-700 dark:text-slate-300 font-bold text-[11px]">
                          {new Date(log.createdAt).toLocaleDateString()}
                        </div>
                        <div className="text-[10px] text-slate-400 font-mono">
                          {new Date(log.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                        </div>
                      </td>

                      <td className="p-3.5 whitespace-nowrap">
                        <span className={`px-2.5 py-1 rounded-xl text-[10px] font-black border uppercase tracking-wider ${getActionBadgeStyle(log.action)}`}>
                          {log.action.replace(/_/g, ' ')}
                        </span>
                      </td>

                      <td className="p-3.5 whitespace-nowrap">
                        <div className="font-bold text-slate-900 dark:text-white flex items-center gap-1.5">
                          <Tag className="w-3 h-3 text-slate-400" />
                          <span>{log.entity}</span>
                        </div>
                        {log.entityId && (
                          <div className="text-[10px] font-mono text-slate-400 truncate max-w-[120px]">
                            ID: {log.entityId}
                          </div>
                        )}
                      </td>

                      <td className="p-3.5 whitespace-nowrap">
                        <div className="flex items-center gap-2">
                          <div className="w-6 h-6 rounded-full bg-slate-200 dark:bg-slate-700 text-slate-700 dark:text-slate-300 font-extrabold text-[10px] flex items-center justify-center">
                            {log.performedBy ? log.performedBy.charAt(0) : 'S'}
                          </div>
                          <span className="font-bold text-slate-800 dark:text-slate-200">{log.performedBy || 'System'}</span>
                        </div>
                      </td>

                      <td className="p-3.5 text-slate-700 dark:text-slate-300 text-xs leading-relaxed max-w-md break-words">
                        {log.details}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          <div className="flex items-center justify-between text-xs text-slate-500 pt-1">
            <span>
              Showing <strong className="text-slate-900 dark:text-white font-bold">{filteredAuditLogs.length}</strong> of{' '}
              <strong className="text-slate-900 dark:text-white font-bold">{userAuditLogs.length}</strong> total user audit records
            </span>
            <span>Local IndexedDB Encrypted Audit Storage</span>
          </div>
        </div>
      )}

      {/* INDEXEDDB STORAGE TAB */}
      {activeTab === 'indexeddb' && (
        !canAccessDatabaseTab ? (
          <div className="bg-white dark:bg-slate-900 p-8 rounded-3xl border border-slate-200/80 dark:border-slate-800 shadow-xs text-center space-y-3 max-w-2xl mx-auto">
            <ShieldAlert className="w-10 h-10 text-amber-500 mx-auto" />
            <h3 className="text-base font-extrabold text-slate-900 dark:text-white">Access Restricted</h3>
            <p className="text-xs text-slate-600 dark:text-slate-400">
              Sales Staff users do not have access to Offline Data Backup & Migration Tools.
            </p>
          </div>
        ) : (
          <div className="bg-white dark:bg-slate-900 p-6 rounded-3xl border border-slate-200/80 dark:border-slate-800 shadow-xs space-y-6 max-w-4xl">
            <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 border-b border-slate-100 dark:border-slate-800 pb-4">
            <div className="flex items-center gap-3">
              <div className="p-3 bg-emerald-100 dark:bg-emerald-950/80 text-emerald-600 dark:text-emerald-400 rounded-2xl">
                <Database className="w-6 h-6" />
              </div>
              <div>
                <h3 className="font-extrabold text-base text-slate-900 dark:text-white flex items-center gap-2">
                  <span>IndexedDB Local Storage & Offline Engine</span>
                  <span className="px-2 py-0.5 rounded-full bg-emerald-100 dark:bg-emerald-950 text-emerald-700 dark:text-emerald-400 text-[10px] font-extrabold uppercase tracking-wide">
                    Active (Offline Mode)
                  </span>
                </h3>
                <p className="text-xs text-slate-500">
                  All store data (Products, Invoices, Customers, Suppliers, Expenses, Logs) is stored locally in Chrome IndexedDB (<span className="font-mono font-bold text-slate-700 dark:text-slate-300">IdoferaLabs_OfflineDB</span>).
                </p>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2 w-full lg:w-auto shrink-0">
              <button
                type="button"
                onClick={triggerCloudSync}
                disabled={isCloudSyncing}
                className="h-10 px-4 py-2 bg-amber-500/10 hover:bg-amber-500/20 text-amber-700 dark:text-amber-300 border border-amber-500/30 rounded-xl text-xs font-bold transition-all flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50 whitespace-nowrap shadow-xs"
                title="Bidirectional sync: push pending local changes and pull latest data from Cloudflare D1"
              >
                <RefreshCw className={`w-3.5 h-3.5 shrink-0 ${isCloudSyncing ? 'animate-spin' : ''}`} />
                <span>Sync Now</span>
              </button>

              <button
                type="button"
                onClick={triggerD1Pull}
                disabled={isCloudSyncing}
                className="h-10 px-4 py-2 bg-sky-500/10 hover:bg-sky-500/20 text-sky-700 dark:text-sky-300 border border-sky-500/30 rounded-xl text-xs font-bold transition-all flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50 whitespace-nowrap shadow-xs"
                title="Directly pull and refresh all records from Cloudflare D1 (3e95a550-a091-490b-819d-f0acb7ea8dd8)"
              >
                <Download className="w-3.5 h-3.5 shrink-0 text-sky-600 dark:text-sky-400" />
                <span>Pull from D1</span>
              </button>

              <button
                type="button"
                onClick={triggerSyncAll}
                disabled={isCloudSyncing}
                className="h-10 px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl text-xs font-bold transition-all shadow-md shadow-emerald-600/20 flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50 whitespace-nowrap"
                title="Push all records from Local Storage (IndexedDB) directly to Cloudflare D1 (3e95a550-a091-490b-819d-f0acb7ea8dd8)"
              >
                <Database className="w-3.5 h-3.5 shrink-0" />
                <span>{isCloudSyncing ? 'Syncing All...' : 'Sync All'}</span>
              </button>

              <button
                type="button"
                onClick={() => refreshDBCounts(true)}
                disabled={isRefreshingCounts}
                className="h-10 px-4 py-2 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 border border-slate-200/80 dark:border-slate-700 rounded-xl text-xs font-bold transition-all flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50 whitespace-nowrap shadow-xs"
                title="Refresh local database record counts and check D1 connection"
              >
                <RefreshCw className={`w-3.5 h-3.5 shrink-0 ${isRefreshingCounts ? 'animate-spin text-emerald-500' : ''}`} />
                <span>{isRefreshingCounts ? 'Refreshing...' : 'Refresh Count'}</span>
              </button>
            </div>
          </div>

          {/* Database System Info Banner */}
          <div className="p-4 bg-slate-50 dark:bg-slate-800/50 border border-slate-200/80 dark:border-slate-700/60 rounded-2xl space-y-2">
            <div className="flex items-center justify-between gap-2 text-slate-900 dark:text-white font-bold text-xs">
              <div className="flex items-center gap-2">
                <HardDrive className="w-4 h-4 text-emerald-500" />
                <span>Authoritative Cloud Database: Cloudflare D1</span>
              </div>
              <span className="font-mono text-[11px] px-2 py-0.5 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20 rounded-md">
                DB ID: 3e95a550-a091-490b-819d-f0acb7ea8dd8
              </span>
            </div>
            <p className="text-xs text-slate-600 dark:text-slate-300 leading-relaxed">
              Cloudflare D1 is the authoritative cloud database (Database ID: <code className="font-mono text-emerald-500 font-semibold">3e95a550-a091-490b-819d-f0acb7ea8dd8</code>). IndexedDB provides zero-latency offline transactions on this device. Clicking <strong>Sync Now</strong> pushes all pending and current local records directly to Cloudflare D1.
            </p>
          </div>

          {/* Google Drive Local-First Dedicated Folder Backup & Restore Card */}
          <div className="p-5 bg-gradient-to-br from-emerald-950 via-slate-900 to-slate-950 text-white border border-emerald-500/40 rounded-2xl space-y-4 shadow-lg">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-emerald-500/20 pb-3">
              <div className="space-y-1">
                <div className="flex flex-wrap items-center gap-2 font-black text-sm text-emerald-400">
                  <HardDrive className="w-5 h-5 text-emerald-400" />
                  <span>Google Drive Dedicated Folder Sync</span>
                  {driveAuthStatus?.isAuthorizedWithOAuth ? (
                    <span className="px-2 py-0.5 bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 text-[10px] font-black rounded-full flex items-center gap-1">
                      <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                      OAuth Connected
                    </span>
                  ) : (
                    <span className="px-2 py-0.5 bg-amber-500/20 text-amber-300 border border-amber-500/40 text-[10px] font-black rounded-full flex items-center gap-1">
                      <span className="w-1.5 h-1.5 rounded-full bg-amber-400" />
                      API Key Mode
                    </span>
                  )}
                </div>
                <p className="text-xs text-slate-300 leading-relaxed max-w-2xl">
                  Inspect unsynced local changes, upload the current database backup to your dedicated Google Drive folder, or restore a previous snapshot.
                </p>
                {/* Live Connected Account Email Indicator */}
                {driveAuthStatus?.email && (
                  <div className="flex items-center gap-1.5 text-[11px] text-emerald-300 font-mono pt-0.5">
                    <Mail className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                    <span>Connected Google Account: <strong className="text-white">{driveAuthStatus.email}</strong></span>
                  </div>
                )}
              </div>

              <div className="flex flex-wrap items-center gap-2 shrink-0 w-full sm:w-auto">
                <button
                  type="button"
                  onClick={() => setIsUnsyncedChangesModalOpen(true)}
                  className="w-full sm:w-auto min-w-32 px-3.5 py-2.5 text-xs font-black rounded-xl bg-slate-800 hover:bg-slate-700 text-amber-300 border border-amber-500/40 shadow-md flex items-center justify-center gap-2 cursor-pointer transition-all"
                >
                  <Eye className="w-4 h-4 text-amber-400" />
                  <span>Inspect Changes</span>
                </button>

                <button
                  type="button"
                  onClick={async () => {
                    try {
                      await triggerDriveSync();
                    } catch (err: any) {
                      if (!driveAuthStatus?.isAuthorizedWithOAuth) {
                        setIsDriveAuthModalOpen(true);
                      }
                    }
                  }}
                  disabled={isCloudSyncing}
                  className="w-full sm:w-auto min-w-32 px-4 py-2.5 text-xs font-black rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 shadow-md flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50 transition-all"
                >
                  <Upload className="w-4 h-4 text-emerald-400" />
                  <span>Upload to Drive</span>
                </button>

                <button
                  type="button"
                  onClick={async () => {
                    const preview = await prepareDriveRestore();
                    if (preview) setShowConfirmRestoreDrive(true);
                  }}
                  disabled={isCloudSyncing}
                  className="w-full sm:w-auto min-w-32 px-3.5 py-2.5 text-xs font-black rounded-xl bg-slate-800 hover:bg-slate-700 text-emerald-300 border border-emerald-500/30 shadow-md flex items-center justify-center gap-2 cursor-pointer transition-all"
                >
                  <Download className="w-4 h-4 text-emerald-400" />
                  <span>Restore from Drive</span>
                </button>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-4 gap-3 text-xs">
              {/* Account Connection Status Card */}
              <div className="p-3 bg-slate-950/80 border border-emerald-900/60 rounded-xl space-y-1 flex flex-col justify-between">
                <div>
                  <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Drive Authorization</p>
                  <div className="flex items-center gap-1.5 pt-0.5">
                    <span className={`w-2 h-2 rounded-full ${driveAuthStatus?.isAuthorizedWithOAuth ? 'bg-emerald-400' : 'bg-amber-400'}`} />
                    <span className={`text-xs font-black truncate ${driveAuthStatus?.isAuthorizedWithOAuth ? 'text-emerald-300' : 'text-amber-300'}`}>
                      {driveAuthStatus?.isAuthorizedWithOAuth ? 'Google Account Active' : 'API Key Fallback'}
                    </span>
                  </div>
                  {driveAuthStatus?.email && (
                    <p className="text-[10px] text-slate-400 font-mono truncate mt-0.5">{driveAuthStatus.email}</p>
                  )}
                </div>
                <div className="pt-2 flex items-center gap-1.5">
                  {driveAuthStatus?.isAuthorizedWithOAuth ? (
                    <button
                      type="button"
                      onClick={() => {
                        disconnectDrive();
                        showToast({
                          title: 'Google Drive Disconnected',
                          message: 'Signed out of Google Drive OAuth session.',
                          type: 'info',
                        });
                      }}
                      className="text-[10px] font-bold text-slate-400 hover:text-rose-400 flex items-center gap-1 cursor-pointer transition-colors"
                    >
                      <LogOut className="w-3 h-3" />
                      <span>Disconnect</span>
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={() => setIsDriveAuthModalOpen(true)}
                      className="text-[10px] font-bold text-emerald-400 hover:text-emerald-300 flex items-center gap-1 cursor-pointer transition-colors"
                    >
                      <Key className="w-3 h-3" />
                      <span>Authorize Drive</span>
                    </button>
                  )}
                </div>
              </div>

              <div className="p-3 bg-slate-950/80 border border-emerald-900/60 rounded-xl space-y-1">
                <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Dedicated Drive Folder ID</p>
                <p className="text-[11px] font-mono font-bold text-emerald-300 truncate">11KHJv7CPD7OLcI5w_1MCc_YO70Re8CV9</p>
                <a
                  href="https://drive.google.com/drive/folders/11KHJv7CPD7OLcI5w_1MCc_YO70Re8CV9?usp=sharing"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-[10px] text-emerald-400 hover:underline flex items-center gap-1 mt-1 font-bold"
                >
                  <Globe className="w-3 h-3" />
                  <span>Open Drive Folder</span>
                </a>
              </div>

              <div className="p-3 bg-slate-950/80 border border-emerald-900/60 rounded-xl space-y-1">
                <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Most Recent Drive Backup File</p>
                <p className="text-xs font-mono font-bold text-white truncate">{lastDriveBackupFile || 'No backup created yet'}</p>
                {lastDriveBackupTime && (
                  <p className="text-[10px] text-slate-400 font-mono">Last backup: {new Date(lastDriveBackupTime).toLocaleString()}</p>
                )}
              </div>

              <div className="p-3 bg-slate-950/80 border border-emerald-900/60 rounded-xl space-y-1">
                <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Local Change Status</p>
                <div className="flex items-center gap-1.5 pt-0.5">
                  <span className={`w-2 h-2 rounded-full ${hasDriveUnsynced ? 'bg-amber-400 animate-ping' : 'bg-emerald-400'}`} />
                  <span className={`text-xs font-black ${hasDriveUnsynced ? 'text-amber-300' : 'text-emerald-400'}`}>
                    {hasDriveUnsynced ? 'Unsynced Local Edits' : 'Up to Date with Drive'}
                  </span>
                </div>
              </div>
            </div>
          </div>

          {/* Storage Estimate Usage Metrics */}
          <div className="p-4 bg-slate-50 dark:bg-slate-800/40 border border-slate-200/80 dark:border-slate-800 rounded-2xl space-y-3">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
              <div className="flex items-center gap-2 text-slate-900 dark:text-white font-extrabold text-xs">
                <PieChart className="w-4 h-4 text-emerald-500" />
                <span>IndexedDB Chrome Storage Usage & Quota</span>
              </div>
              <div className="text-[11px] font-mono text-slate-500">
                Estimated Backup Size: <span className="font-bold text-slate-900 dark:text-white">{(storageEstimate.jsonSizeBytes / 1024).toFixed(2)} KB</span>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div className="p-3 bg-white dark:bg-slate-900 border border-slate-200/60 dark:border-slate-800 rounded-xl space-y-0.5">
                <p className="text-[10px] font-bold text-slate-500 uppercase">Current Usage</p>
                <p className="text-sm font-black text-slate-900 dark:text-white font-mono">
                  {storageEstimate.usage > 0 ? `${(storageEstimate.usage / (1024 * 1024)).toFixed(2)} MB` : '< 1.0 MB'}
                </p>
              </div>

              <div className="p-3 bg-white dark:bg-slate-900 border border-slate-200/60 dark:border-slate-800 rounded-xl space-y-0.5">
                <p className="text-[10px] font-bold text-slate-500 uppercase">Available Storage Quota</p>
                <p className="text-sm font-black text-slate-900 dark:text-white font-mono">
                  {storageEstimate.quota > 0 ? `${(storageEstimate.quota / (1024 * 1024 * 1024)).toFixed(2)} GB` : 'Browser Standard'}
                </p>
              </div>

              <div className="p-3 bg-white dark:bg-slate-900 border border-slate-200/60 dark:border-slate-800 rounded-xl space-y-0.5">
                <p className="text-[10px] font-bold text-slate-500 uppercase">Total Local Records</p>
                <p className="text-sm font-black text-slate-900 dark:text-white font-mono">
                  {Object.values(dbCounts).reduce((acc: number, curr: number) => acc + curr, 0)} items
                </p>
              </div>
            </div>

            {storageEstimate.quota > 0 && (
              <div className="space-y-1 pt-1">
                <div className="flex justify-between text-[10px] font-bold text-slate-500">
                  <span>Browser Storage Occupied</span>
                  <span>{((storageEstimate.usage / storageEstimate.quota) * 100).toFixed(4)}%</span>
                </div>
                <div className="w-full bg-slate-200 dark:bg-slate-700 h-2 rounded-full overflow-hidden">
                  <div
                    className="bg-emerald-500 h-full rounded-full transition-all duration-300"
                    style={{ width: `${Math.max(1, Math.min(100, (storageEstimate.usage / storageEstimate.quota) * 100))}%` }}
                  />
                </div>
              </div>
            )}
          </div>

          {/* PWA Service Worker & Offline Cache Status Card */}
          <div className="p-4 bg-slate-900 text-white border border-blue-500/30 rounded-2xl space-y-3">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
              <div className="flex items-center gap-2 font-black text-xs text-blue-400">
                <Smartphone className="w-4 h-4 text-blue-400" />
                <span>PWA Service Worker & Offline Cache Status</span>
              </div>
              <div className="flex items-center gap-2">
                <span className={`px-2 py-0.5 rounded-full text-[10px] font-extrabold flex items-center gap-1 ${
                  isOnline ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30' : 'bg-amber-500/20 text-amber-300 border border-amber-500/30'
                }`}>
                  {isOnline ? <Wifi className="w-3 h-3" /> : <WifiOff className="w-3 h-3" />}
                  <span>{isOnline ? 'Online Sync Active' : 'Offline Mode Active'}</span>
                </span>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-1">
              <div className="p-3 bg-slate-800/80 border border-slate-700 rounded-xl space-y-1">
                <p className="text-[10px] font-bold text-slate-400 uppercase">Service Worker Engine</p>
                <div className="flex items-center gap-1.5">
                  <span className={`w-2 h-2 rounded-full ${swRegistered ? 'bg-emerald-400 animate-pulse' : 'bg-amber-400'}`} />
                  <p className="text-xs font-black text-white">{swRegistered ? 'Active & Registered' : 'Initializing...'}</p>
                </div>
              </div>

              <div className="p-3 bg-slate-800/80 border border-slate-700 rounded-xl space-y-1">
                <p className="text-[10px] font-bold text-slate-400 uppercase">App Shell Cache Version</p>
                <p className="text-xs font-black text-blue-300 font-mono">idofera-pos-v1</p>
              </div>

              <div className="p-3 bg-slate-800/80 border border-slate-700 rounded-xl space-y-1">
                <p className="text-[10px] font-bold text-slate-400 uppercase">PWA Installation Status</p>
                <p className="text-xs font-black text-emerald-400 flex items-center gap-1">
                  {isInstalled ? 'Standalone Mode Active' : isInstallable ? 'Ready to Install' : 'Web Browser Session'}
                </p>
              </div>
            </div>

            {!isInstalled && (
              <div className="pt-2 flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-t border-slate-800">
                <p className="text-[11px] text-slate-300">
                  Install Idofera Packaging POS app onto your computer (Windows, macOS, Linux) or mobile device for standalone offline usage.
                </p>
                <div className="flex items-center gap-2 shrink-0">
                  {isInstallable && (
                    <button
                      type="button"
                      onClick={triggerInstall}
                      className="px-3.5 py-2 bg-blue-600 hover:bg-blue-500 text-white font-extrabold text-xs rounded-xl transition-all shadow-md flex items-center gap-1.5 cursor-pointer"
                    >
                      <Download className="w-3.5 h-3.5" />
                      <span>Install App Now</span>
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => setShowDesktopInstallModal(true)}
                    className="px-3.5 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 font-extrabold text-xs rounded-xl transition-all flex items-center gap-1.5 cursor-pointer border border-slate-700"
                  >
                    <Monitor className="w-3.5 h-3.5 text-blue-400" />
                    <span>PC Install Guide</span>
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* Record Counts Grid */}
          <div>
            <h4 className="text-xs font-black text-slate-900 dark:text-white uppercase tracking-wider mb-3">
              IndexedDB Object Stores & Live Record Counts
            </h4>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              {ALL_STORES.map((store) => (
                <div
                  key={store}
                  className="p-3 bg-slate-50 dark:bg-slate-800/40 border border-slate-200/60 dark:border-slate-800 rounded-xl space-y-1"
                >
                  <p className="text-[10px] font-bold text-slate-500 uppercase tracking-wider truncate">
                    {store}
                  </p>
                  <p className="text-lg font-black text-slate-900 dark:text-white">
                    {dbCounts[store] ?? 0} <span className="text-[10px] font-normal text-slate-400">records</span>
                  </p>
                </div>
              ))}
            </div>
          </div>

          {/* Backup Export & Import Section */}
          <div className="pt-4 border-t border-slate-100 dark:border-slate-800 space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
              <h4 className="text-xs font-black text-slate-900 dark:text-white uppercase tracking-wider">
                Offline Data Backup & Migration Tools
              </h4>
              {isAccountant && (
                <span className="text-[11px] font-semibold text-amber-700 dark:text-amber-300 bg-amber-50 dark:bg-amber-950/60 px-2.5 py-1 rounded-lg border border-amber-200 dark:border-amber-900/60 flex items-center gap-1.5">
                  <ShieldAlert className="w-3.5 h-3.5 shrink-0 text-amber-500" />
                  Accountant Permission: Export JSON allowed. Restore & Reset tools restricted to Admin/Super-user.
                </span>
              )}
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {/* Export JSON */}
              <div className="p-4 bg-blue-50/50 dark:bg-blue-950/20 border border-blue-200/60 dark:border-blue-900/40 rounded-2xl space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2 text-blue-900 dark:text-blue-200 font-bold text-xs">
                    <Download className="w-4 h-4 text-blue-600 dark:text-blue-400" />
                    <span>Export Database Backup (.JSON)</span>
                  </div>
                  <span className="text-[10px] font-extrabold text-blue-700 dark:text-blue-300 bg-blue-100 dark:bg-blue-950 px-2 py-0.5 rounded-full border border-blue-200 dark:border-blue-900">
                    {isAdmin ? 'Admin & Accountant Allowed' : 'Accountant Allowed'}
                  </span>
                </div>
                <p className="text-[11px] text-slate-600 dark:text-slate-300">
                  Download an authoritative D1 database JSON snapshot to transfer to another computer, upload to Google Drive, or keep as an offline backup.
                </p>
                <div className="flex gap-2 pt-1">
                  <button
                    onClick={handleExportBackup}
                    disabled={isExporting}
                    className="flex-1 py-2.5 bg-blue-600 hover:bg-blue-700 text-white font-bold rounded-xl text-xs transition-colors flex items-center justify-center gap-2 cursor-pointer shadow-xs"
                  >
                    <Download className="w-4 h-4" />
                    <span>{isExporting ? 'Generating...' : 'Export Backup (.json)'}</span>
                  </button>
                  <a
                    href="/idofera_backup_template.json"
                    download="idofera_backup_template.json"
                    className="py-2.5 px-3 bg-slate-200 dark:bg-slate-800 hover:bg-slate-300 dark:hover:bg-slate-700 text-slate-800 dark:text-slate-200 font-bold rounded-xl text-xs transition-colors flex items-center justify-center gap-1.5 cursor-pointer shadow-xs"
                    title="Download clean JSON template for manual data migration"
                  >
                    <Download className="w-3.5 h-3.5 text-blue-500" />
                    <span>Download Template</span>
                  </a>
                </div>
              </div>

              {/* Import JSON */}
              <div className={`p-4 rounded-2xl space-y-3 border ${
                isAdmin
                  ? 'bg-purple-50/50 dark:bg-purple-950/20 border-purple-200/60 dark:border-purple-900/40'
                  : 'bg-slate-100/70 dark:bg-slate-900/40 border-slate-200 dark:border-slate-800'
              }`}>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2 text-purple-900 dark:text-purple-200 font-bold text-xs">
                    <Upload className="w-4 h-4 text-purple-600 dark:text-purple-400" />
                    <span>Restore / Import JSON Backup</span>
                  </div>
                  {!isAdmin && (
                    <span className="text-[10px] font-bold text-amber-700 dark:text-amber-300 bg-amber-100 dark:bg-amber-950 px-2 py-0.5 rounded-full border border-amber-200 dark:border-amber-900">
                      Super-user & Admin Only
                    </span>
                  )}
                </div>
                <p className="text-[11px] text-slate-600 dark:text-slate-300">
                  Restore an existing IndexedDB JSON backup file into your browser local system storage.
                </p>
                {isAdmin ? (
                  <label className="w-full py-2.5 bg-purple-600 hover:bg-purple-700 text-white font-bold rounded-xl text-xs transition-colors flex items-center justify-center gap-2 cursor-pointer shadow-xs text-center">
                    <Upload className="w-4 h-4" />
                    <span>Select JSON File to Restore</span>
                    <input
                      type="file"
                      accept=".json"
                      onChange={handleImportBackup}
                      className="hidden"
                    />
                  </label>
                ) : (
                  <button
                    type="button"
                    disabled
                    className="w-full py-2.5 bg-slate-200 dark:bg-slate-800 text-slate-500 dark:text-slate-400 font-bold rounded-xl text-xs flex items-center justify-center gap-2 cursor-not-allowed border border-slate-300/60 dark:border-slate-700/60"
                  >
                    <Lock className="w-4 h-4 text-slate-400" />
                    <span>Restore Restricted (Super-user & Admin Only)</span>
                  </button>
                )}
              </div>
            </div>

            {/* Discard local pending sync changes */}
            <div className={`p-4 rounded-2xl space-y-3 border ${
              isAdmin
                ? 'bg-rose-50/60 dark:bg-rose-950/20 border-rose-200/80 dark:border-rose-900/40'
                : 'bg-slate-100/70 dark:bg-slate-900/40 border-slate-200 dark:border-slate-800'
            }`}>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 text-rose-900 dark:text-rose-200 font-bold text-xs">
                  <Trash2 className="w-4 h-4 text-rose-600 dark:text-rose-400" />
                  <span>Discard Local Records</span>
                </div>
                {!isAdmin && (
                  <span className="text-[10px] font-bold text-amber-700 dark:text-amber-300 bg-amber-100 dark:bg-amber-950 px-2 py-0.5 rounded-full border border-amber-200 dark:border-amber-900">
                    Super-user & Admin Only
                  </span>
                )}
              </div>
              <p className="text-[11px] text-slate-600 dark:text-slate-300">
                Discards unsynced local records pending D1 sync and clears their pending sync queue. In-sync local records and D1 records are not modified, deleted, or reloaded.
              </p>
              {isAdmin ? (
                <button
                  onClick={() => setShowConfirmResetDB(true)}
                  className="px-4 py-2.5 bg-rose-600 hover:bg-rose-700 text-white font-bold rounded-xl text-xs transition-colors flex items-center gap-2 shadow-xs cursor-pointer"
                >
                  <Trash2 className="w-4 h-4" />
                  <span>Discard Local Records</span>
                </button>
              ) : (
                <button
                  type="button"
                  disabled
                  className="px-4 py-2.5 bg-slate-200 dark:bg-slate-800 text-slate-500 dark:text-slate-400 font-bold rounded-xl text-xs flex items-center gap-2 cursor-not-allowed border border-slate-300/60 dark:border-slate-700/60"
                >
                  <Lock className="w-4 h-4 text-slate-400" />
                  <span>Discard Restricted (Super-user & Admin Only)</span>
                </button>
              )}
            </div>
          </div>
        </div>
      )
    )}

      {/* User Modal */}
      <UserModal
        isOpen={isUserModalOpen}
        onClose={() => setIsUserModalOpen(false)}
        userToEdit={editingUser}
      />

      {/* Delete User Confirmation Modal */}
      <ConfirmModal
        isOpen={!!userToDelete}
        title="Remove Staff Account"
        message={`Are you sure you want to permanently remove staff account "${userToDelete?.displayName}" (${userToDelete?.email})? They will immediately lose access to the system.`}
        confirmText="Remove User Account"
        variant="danger"
        onClose={() => setUserToDelete(null)}
        onConfirm={confirmDeleteUser}
      />

      {/* Password Reset / Change Modal */}
      <ResetPasswordModal
        isOpen={isResetPasswordModalOpen}
        onClose={() => {
          setIsResetPasswordModalOpen(false);
          setTargetPasswordResetUser(null);
        }}
        targetUser={targetPasswordResetUser}
      />

      {/* Discard Unsynced Local Records Confirmation Modal */}
      <ConfirmModal
        isOpen={showConfirmResetDB}
        title="Discard Unsynced Local Records"
        message="This permanently deletes local records pending D1 sync from this device and clears their pending sync queue. In-sync local records and D1 records will not be altered, deleted, or reloaded."
        confirmText={isClearingDB ? 'Discarding Unsynced Records...' : 'Discard Local Records'}
        variant="danger"
        onClose={() => setShowConfirmResetDB(false)}
        onConfirm={handleDiscardLocalRecords}
      />

      {/* Clear Audit Logs Confirmation Modal */}
      <ConfirmModal
        isOpen={showConfirmClearAudit}
        title="Clear System Audit Log History"
        message="Are you sure you want to permanently clear the audit log history? All recorded security actions, price adjustments, and system transaction history logs will be wiped."
        confirmText="Clear Audit Logs"
        variant="danger"
        onClose={() => setShowConfirmClearAudit(false)}
        onConfirm={handleConfirmClearAudit}
      />

      {/* Confirm Google Drive Backup Restore Modal */}
      <ConfirmModal
        isOpen={showConfirmRestoreDrive}
        title="Restore Records from Google Drive"
        message={driveRestorePreview
          ? `Recovery preview: "${driveRestorePreview.fileName}" from ${new Date(driveRestorePreview.createdTime).toLocaleString()} contains ${driveRestorePreview.totalRecords} records across ${Object.keys(driveRestorePreview.storeCounts).length} collections. Restoring will update both your Cloudflare D1 database and local business data immediately.`
          : 'The newest Drive backup will restore all business records to Cloudflare D1 and your local workspace.'}
        confirmText="Restore All Records"
        variant="warning"
        onClose={() => setShowConfirmRestoreDrive(false)}
        onConfirm={async () => {
          setShowConfirmRestoreDrive(false);
          await restoreDriveBackup();
        }}
      />

      {/* Desktop Installation Modal */}
      <DesktopInstallModal
        isOpen={showDesktopInstallModal}
        onClose={() => setShowDesktopInstallModal(false)}
      />

      {/* Unsynced Changes Summary & Inspector Modal */}
      <UnsyncedChangesModal
        isOpen={isUnsyncedChangesModalOpen}
        onClose={() => setIsUnsyncedChangesModalOpen(false)}
      />

      {/* Google Drive Interactive Authorization Modal */}
      <GoogleDriveAuthModal
        isOpen={isDriveAuthModalOpen}
        onClose={() => setIsDriveAuthModalOpen(false)}
        onAuthorized={(email) => {
          showToast({
            title: 'Google Drive Authorized',
            message: email ? `Connected to Google account ${email}.` : 'Google Drive access token granted.',
            type: 'success',
          });
        }}
      />
    </div>
  );
};
