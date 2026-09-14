import React, { useState, useEffect, useRef } from 'react';
import {
  X,
  UserPlus,
  Shield,
  Mail,
  UserCheck,
  User,
  Image as ImageIcon,
  ShieldAlert,
  Upload,
  Link as LinkIcon,
  Trash2,
  Camera,
  KeyRound,
  Eye,
  EyeOff,
} from 'lucide-react';
import { useAuth, isSuperUser } from '../../context/AuthContext';
import { useApp } from '../../context/AppContext';
import { UserProfile, UserRole } from '../../types';

interface UserModalProps {
  isOpen: boolean;
  onClose: () => void;
  userToEdit?: UserProfile | null;
}

const PRESET_AVATARS = [
  { label: 'Executive Male', url: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=300&auto=format&fit=crop' },
  { label: 'Operations Specialist', url: 'https://images.unsplash.com/photo-1517841905240-472988babdf9?w=300&auto=format&fit=crop' },
  { label: 'Finance Officer', url: 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=300&auto=format&fit=crop' },
  { label: 'Sales Associate', url: 'https://images.unsplash.com/photo-1494790108377-be9c29b29330?w=300&auto=format&fit=crop' },
  { label: 'Store Manager', url: 'https://images.unsplash.com/photo-1500648767791-00dcc994a43e?w=300&auto=format&fit=crop' },
  { label: 'Inventory Tech', url: 'https://images.unsplash.com/photo-1573496359142-b8d87734a5a2?w=300&auto=format&fit=crop' },
];

export const UserModal: React.FC<UserModalProps> = ({ isOpen, onClose, userToEdit }) => {
  const { addUser, updateUser, deleteUser, currentUser } = useAuth();
  const { logAudit } = useApp();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [formData, setFormData] = useState({
    displayName: '',
    username: '',
    email: '',
    role: 'Sales Staff' as UserRole,
    status: 'Active' as 'Active' | 'Inactive',
    avatarUrl: '',
    password: '',
  });

  const [showPassword, setShowPassword] = useState(false);
  const [imageTab, setImageTab] = useState<'upload' | 'preset' | 'url'>('upload');
  const [error, setError] = useState<string | null>(null);
  const [dragActive, setDragActive] = useState(false);
  const [showConfirmDelete, setShowConfirmDelete] = useState(false);

  useEffect(() => {
    if (userToEdit) {
      setFormData({
        displayName: userToEdit.displayName,
        username: userToEdit.username || '',
        email: userToEdit.email,
        role: userToEdit.role,
        status: userToEdit.status,
        avatarUrl: userToEdit.avatarUrl || '',
        password: userToEdit.password || '',
      });
    } else {
      setFormData({
        displayName: '',
        username: '',
        email: '',
        role: 'Sales Staff',
        status: 'Active',
        avatarUrl: '',
        password: '',
      });
    }
    setError(null);
    setShowConfirmDelete(false);
    setShowPassword(false);
  }, [userToEdit, isOpen]);

  const isCurrentSuper = isSuperUser(currentUser);
  const isEditingSuper = userToEdit ? isSuperUser(userToEdit) : false;
  const isEditingSuperBlocked = isEditingSuper && !isCurrentSuper;
  const isCreationBlocked = !userToEdit && !isCurrentSuper;

  const handleDelete = () => {
    if (!userToEdit) return;
    if (!isCurrentSuper) {
      setError('Only the Super-User session can delete user accounts.');
      setShowConfirmDelete(false);
      return;
    }
    if (isSuperUser(userToEdit)) {
      setError('This Super-User account is protected and cannot be deleted.');
      setShowConfirmDelete(false);
      return;
    }
    setError(null);

    try {
      deleteUser(userToEdit.id);
      logAudit(
        'DELETE_USER',
        'User',
        userToEdit.id,
        currentUser?.displayName || 'Admin',
        `Deleted user account ${userToEdit.displayName} (${userToEdit.email}).`
      );
      onClose();
    } catch (err: any) {
      setError(err.message || 'Failed to delete user.');
      setShowConfirmDelete(false);
    }
  };

  if (!isOpen) return null;

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) processFile(file);
  };

  const processFile = (file: File) => {
    setError(null);
    if (!file.type.startsWith('image/')) {
      setError('Please select a valid image file (PNG, JPG, WEBP).');
      return;
    }

    if (file.size > 5 * 1024 * 1024) {
      setError('File size exceeds 5MB. Please upload a smaller image.');
      return;
    }

    const reader = new FileReader();
    reader.onload = (event) => {
      const dataUrl = event.target?.result as string;
      setFormData((prev) => ({ ...prev, avatarUrl: dataUrl }));
    };
    reader.onerror = () => {
      setError('Failed to read image file.');
    };
    reader.readAsDataURL(file);
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);

    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      processFile(e.dataTransfer.files[0]);
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!formData.displayName.trim()) {
      setError('Display name is required');
      return;
    }

    if (!formData.email.trim()) {
      setError('Email address is required');
      return;
    }

    try {
      const now = new Date().toISOString();
      if (userToEdit) {
        const updates: Partial<UserProfile> = {
          displayName: formData.displayName.trim(),
          username: formData.username.trim() || undefined,
          email: formData.email.trim(),
          role: formData.role,
          status: formData.status,
          avatarUrl: formData.avatarUrl.trim() || undefined,
        };
        if (formData.password.trim()) {
          updates.password = formData.password.trim();
          updates.passwordLastChanged = now;
        }
        updateUser(userToEdit.id, updates);

        logAudit(
          'UPDATE_USER',
          'User',
          userToEdit.id,
          currentUser?.displayName || 'Admin',
          `Updated user ${formData.displayName} details & role to ${formData.role}.`
        );
      } else {
        const created = addUser({
          displayName: formData.displayName.trim(),
          username: formData.username.trim() || undefined,
          email: formData.email.trim(),
          role: formData.role,
          status: formData.status,
          avatarUrl: formData.avatarUrl.trim() || undefined,
          password: formData.password.trim() || 'password123',
          passwordLastChanged: now,
        });

        logAudit(
          'CREATE_USER',
          'User',
          created.id,
          currentUser?.displayName || 'Admin',
          `Added new staff member ${formData.displayName} (${formData.role}).`
        );
      }

      onClose();
    } catch (err: any) {
      setError(err.message || 'An error occurred while saving user.');
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4 overflow-y-auto animate-in fade-in duration-150">
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl shadow-2xl max-w-lg w-full overflow-hidden flex flex-col max-h-[90vh] my-auto">
        {/* Header */}
        <div className="flex items-center justify-between p-5 border-b border-slate-100 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-800/30">
          <div className="flex items-center gap-2.5">
            <div className="p-2 bg-blue-100 dark:bg-blue-950/60 text-blue-600 dark:text-blue-400 rounded-xl">
              {userToEdit ? <Shield className="w-5 h-5" /> : <UserPlus className="w-5 h-5" />}
            </div>
            <div>
              <h2 className="text-lg font-extrabold text-slate-900 dark:text-white">
                {userToEdit ? 'Edit User Profile & Photo' : 'Add New Staff Member'}
              </h2>
              <p className="text-xs text-slate-500">
                {userToEdit ? 'Modify permission level, status, or avatar' : 'Assign access credentials and staff avatar'}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-xl text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Error alert & Privilege banners */}
        {error && (
          <div className="mx-6 mt-4 p-3 bg-rose-50 dark:bg-rose-950/50 border border-rose-200 dark:border-rose-900/60 rounded-xl flex items-center gap-2 text-rose-700 dark:text-rose-300 text-xs font-semibold">
            <ShieldAlert className="w-4 h-4 shrink-0 text-rose-500" />
            <span>{error}</span>
          </div>
        )}

        {isEditingSuperBlocked && (
          <div className="mx-6 mt-4 p-3 bg-amber-50 dark:bg-amber-950/50 border border-amber-200 dark:border-amber-900/60 rounded-xl flex items-center gap-2 text-amber-800 dark:text-amber-200 text-xs font-semibold">
            <ShieldAlert className="w-4 h-4 shrink-0 text-amber-500" />
            <span>Regular Administrators cannot edit or modify the Super-User account details.</span>
          </div>
        )}

        {isCreationBlocked && (
          <div className="mx-6 mt-4 p-3 bg-amber-50 dark:bg-amber-950/50 border border-amber-200 dark:border-amber-900/60 rounded-xl flex items-center gap-2 text-amber-800 dark:text-amber-200 text-xs font-semibold">
            <ShieldAlert className="w-4 h-4 shrink-0 text-amber-500" />
            <span>Only a session logged in as the Super-User can create new user accounts.</span>
          </div>
        )}

        {/* Form Body */}
        <form onSubmit={handleSubmit} className="p-6 space-y-5 text-xs overflow-y-auto">
          {/* Avatar Upload / Preview Section */}
          <div className="p-4 bg-slate-50 dark:bg-slate-800/40 rounded-2xl border border-slate-200/80 dark:border-slate-800 space-y-3">
            <div className="flex items-center justify-between">
              <label className="font-extrabold text-slate-900 dark:text-white flex items-center gap-2">
                <Camera className="w-4 h-4 text-blue-600" />
                <span>User Profile Picture</span>
              </label>

              {formData.avatarUrl && (
                <button
                  type="button"
                  onClick={() => setFormData({ ...formData, avatarUrl: '' })}
                  className="flex items-center gap-1 text-[11px] font-bold text-rose-500 hover:text-rose-600 hover:underline"
                >
                  <Trash2 className="w-3.5 h-3.5" /> Remove Photo
                </button>
              )}
            </div>

            <div className="flex flex-col sm:flex-row items-center gap-4">
              {/* Avatar Preview */}
              <div className="relative group shrink-0">
                {formData.avatarUrl ? (
                  <img
                    src={formData.avatarUrl}
                    alt="Preview"
                    referrerPolicy="no-referrer"
                    className="w-20 h-20 rounded-2xl object-cover ring-4 ring-blue-500/20 shadow-md"
                  />
                ) : (
                  <div className="w-20 h-20 rounded-2xl bg-gradient-to-br from-blue-500 to-indigo-600 text-white font-extrabold text-2xl flex items-center justify-center shadow-md">
                    {formData.displayName ? formData.displayName.charAt(0).toUpperCase() : 'U'}
                  </div>
                )}

                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="absolute inset-0 bg-slate-900/40 opacity-0 group-hover:opacity-100 transition-opacity rounded-2xl flex items-center justify-center text-white text-[10px] font-bold gap-1 backdrop-blur-xs"
                >
                  <Upload className="w-4 h-4" /> Change
                </button>
              </div>

              {/* Avatar Input Options */}
              <div className="flex-1 w-full space-y-2">
                {/* Method Tabs */}
                <div className="flex items-center gap-1 p-1 bg-slate-200/70 dark:bg-slate-800 rounded-xl text-[11px] font-bold">
                  <button
                    type="button"
                    onClick={() => setImageTab('upload')}
                    className={`flex-1 py-1.5 px-2 rounded-lg transition-all text-center ${
                      imageTab === 'upload'
                        ? 'bg-white dark:bg-slate-700 text-blue-600 dark:text-blue-400 shadow-xs'
                        : 'text-slate-600 dark:text-slate-400'
                    }`}
                  >
                    Upload File
                  </button>
                  <button
                    type="button"
                    onClick={() => setImageTab('preset')}
                    className={`flex-1 py-1.5 px-2 rounded-lg transition-all text-center ${
                      imageTab === 'preset'
                        ? 'bg-white dark:bg-slate-700 text-blue-600 dark:text-blue-400 shadow-xs'
                        : 'text-slate-600 dark:text-slate-400'
                    }`}
                  >
                    Presets
                  </button>
                  <button
                    type="button"
                    onClick={() => setImageTab('url')}
                    className={`flex-1 py-1.5 px-2 rounded-lg transition-all text-center ${
                      imageTab === 'url'
                        ? 'bg-white dark:bg-slate-700 text-blue-600 dark:text-blue-400 shadow-xs'
                        : 'text-slate-600 dark:text-slate-400'
                    }`}
                  >
                    Image URL
                  </button>
                </div>

                {/* Upload Area */}
                {imageTab === 'upload' && (
                  <div>
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept="image/*"
                      onChange={handleFileChange}
                      className="hidden"
                    />
                    <div
                      onDragOver={handleDragOver}
                      onDragLeave={handleDragLeave}
                      onDrop={handleDrop}
                      onClick={() => fileInputRef.current?.click()}
                      className={`p-3 border-2 border-dashed rounded-xl text-center cursor-pointer transition-all ${
                        dragActive
                          ? 'border-blue-500 bg-blue-50 dark:bg-blue-950/40'
                          : 'border-slate-300 dark:border-slate-700 hover:border-blue-400 bg-white dark:bg-slate-900'
                      }`}
                    >
                      <Upload className="w-5 h-5 mx-auto text-blue-500 mb-1" />
                      <p className="font-bold text-slate-800 dark:text-slate-200">
                        Click or Drag & Drop Photo Here
                      </p>
                      <p className="text-[10px] text-slate-400">PNG, JPG or WEBP up to 5MB</p>
                    </div>
                  </div>
                )}

                {/* Preset Avatars Grid */}
                {imageTab === 'preset' && (
                  <div className="grid grid-cols-6 gap-1.5 pt-1">
                    {PRESET_AVATARS.map((preset, idx) => (
                      <button
                        key={idx}
                        type="button"
                        onClick={() => setFormData({ ...formData, avatarUrl: preset.url })}
                        className={`relative rounded-xl overflow-hidden aspect-square border-2 transition-all ${
                          formData.avatarUrl === preset.url
                            ? 'border-blue-600 ring-2 ring-blue-500/30 scale-105'
                            : 'border-transparent opacity-80 hover:opacity-100'
                        }`}
                        title={preset.label}
                      >
                        <img src={preset.url} alt={preset.label} referrerPolicy="no-referrer" className="w-full h-full object-cover" />
                      </button>
                    ))}
                  </div>
                )}

                {/* Direct Image URL */}
                {imageTab === 'url' && (
                  <div className="relative pt-1">
                    <LinkIcon className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                    <input
                      type="url"
                      placeholder="https://example.com/avatar.jpg"
                      value={formData.avatarUrl}
                      onChange={(e) => setFormData({ ...formData, avatarUrl: e.target.value })}
                      className="w-full pl-8 pr-3 py-2 bg-white dark:bg-slate-900 rounded-xl text-slate-900 dark:text-white border border-slate-200 dark:border-slate-700 text-xs focus:border-blue-500"
                    />
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* User Fields */}
          <div>
            <label className="block font-bold text-slate-700 dark:text-slate-300 mb-1">
              Full Name *
            </label>
            <input
              type="text"
              required
              placeholder="e.g. Samuel Okafor"
              value={formData.displayName}
              onChange={(e) => setFormData({ ...formData, displayName: e.target.value })}
              className="w-full p-2.5 bg-slate-100 dark:bg-slate-800 rounded-xl text-slate-900 dark:text-white font-medium border border-transparent focus:border-blue-500"
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block font-bold text-slate-700 dark:text-slate-300 mb-1">
                Username (Optional)
              </label>
              <div className="relative">
                <User className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                <input
                  type="text"
                  placeholder="e.g. samuel"
                  value={formData.username}
                  onChange={(e) => setFormData({ ...formData, username: e.target.value })}
                  className="w-full pl-9 pr-3 py-2.5 bg-slate-100 dark:bg-slate-800 rounded-xl text-slate-900 dark:text-white font-medium border border-transparent focus:border-blue-500"
                />
              </div>
            </div>

            <div>
              <label className="block font-bold text-slate-700 dark:text-slate-300 mb-1">
                Email Address *
              </label>
              <div className="relative">
                <Mail className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                <input
                  type="email"
                  required
                  placeholder="samuel@idoferapackaging.com"
                  value={formData.email}
                  onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                  className="w-full pl-9 pr-3 py-2.5 bg-slate-100 dark:bg-slate-800 rounded-xl text-slate-900 dark:text-white font-medium border border-transparent focus:border-blue-500"
                />
              </div>
            </div>
          </div>

          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="font-bold text-slate-700 dark:text-slate-300">
                {userToEdit ? 'Log-in Password (Leave blank to keep current)' : 'Initial Log-in Password'}
              </label>
              {!userToEdit && (
                <span className="text-[10px] text-slate-400">Defaults to "password123" if empty</span>
              )}
            </div>
            <div className="relative">
              <KeyRound className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                type={showPassword ? 'text' : 'password'}
                placeholder={userToEdit ? 'Enter new password to reset' : 'Enter initial account password'}
                value={formData.password}
                onChange={(e) => setFormData({ ...formData, password: e.target.value })}
                className="w-full pl-9 pr-10 py-2.5 bg-slate-100 dark:bg-slate-800 rounded-xl text-slate-900 dark:text-white font-mono font-medium border border-transparent focus:border-blue-500"
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-200"
              >
                {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block font-bold text-slate-700 dark:text-slate-300 mb-1">
                Access Role *
              </label>
              <select
                value={formData.role}
                disabled={currentUser?.role !== 'Administrator'}
                onChange={(e) => setFormData({ ...formData, role: e.target.value as UserRole })}
                className="w-full p-2.5 bg-slate-100 dark:bg-slate-800 rounded-xl text-slate-900 dark:text-white font-bold border border-transparent focus:border-blue-500 disabled:opacity-60 disabled:cursor-not-allowed"
              >
                <option value="Administrator">Administrator</option>
                <option value="Store Manager">Store Manager</option>
                <option value="Sales Staff">Sales Staff</option>
                <option value="Accountant">Accountant</option>
              </select>
            </div>

            <div>
              <label className="block font-bold text-slate-700 dark:text-slate-300 mb-1">
                Account Status *
              </label>
              <select
                value={formData.status}
                disabled={currentUser?.role !== 'Administrator'}
                onChange={(e) => setFormData({ ...formData, status: e.target.value as 'Active' | 'Inactive' })}
                className="w-full p-2.5 bg-slate-100 dark:bg-slate-800 rounded-xl text-slate-900 dark:text-white font-bold border border-transparent focus:border-blue-500 disabled:opacity-60 disabled:cursor-not-allowed"
              >
                <option value="Active">Active</option>
                <option value="Inactive">Inactive</option>
              </select>
            </div>
          </div>

          {/* Role Description Helper */}
          <div className="p-3 bg-blue-50/60 dark:bg-blue-950/30 rounded-xl border border-blue-100 dark:border-blue-900/40 text-[11px] text-slate-600 dark:text-slate-300 space-y-1">
            <span className="font-bold text-blue-700 dark:text-blue-400 block">
              Role Scope Details:
            </span>
            {formData.role === 'Administrator' && (
              <p>Full administrative access across POS, Pricing, Inventory, Reports, Users, and Settings.</p>
            )}
            {formData.role === 'Sales Staff' && (
              <p>Restricted to POS Register, Products Catalog, Inventory View, Customers, and AI Assistant.</p>
            )}
            {formData.role === 'Accountant' && (
              <p>Access to Expenses, Purchases, Financial Reports, Multiple Pricing, Suppliers, and Inventory.</p>
            )}
          </div>

          {/* Footer Actions */}
          <div className="pt-4 border-t border-slate-100 dark:border-slate-800 space-y-3">
            {showConfirmDelete ? (
              <div className="p-3 bg-rose-50 dark:bg-rose-950/60 border border-rose-200 dark:border-rose-900 rounded-2xl flex items-center justify-between gap-3 animate-in fade-in duration-150">
                <div className="text-xs text-rose-800 dark:text-rose-200 font-bold">
                  Delete staff user <span className="underline">{userToEdit?.displayName}</span>?
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setShowConfirmDelete(false)}
                    className="px-2.5 py-1 text-xs font-bold text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-800 rounded-lg"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={handleDelete}
                    className="px-3 py-1 text-xs font-black bg-rose-600 hover:bg-rose-700 text-white rounded-lg shadow-xs"
                  >
                    Confirm Delete
                  </button>
                </div>
              </div>
            ) : (
              <div className="flex items-center justify-between gap-3">
                {userToEdit && isCurrentSuper && !isEditingSuper ? (
                  <button
                    type="button"
                    onClick={() => setShowConfirmDelete(true)}
                    className="flex items-center gap-1.5 px-3 py-2 text-rose-600 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/50 rounded-xl font-bold transition-colors text-xs"
                  >
                    <Trash2 className="w-4 h-4" />
                    <span>Delete User</span>
                  </button>
                ) : (
                  <div />
                )}

                <div className="flex items-center gap-3">
                  <button
                    type="button"
                    onClick={onClose}
                    className="px-4 py-2.5 font-bold text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-xl transition-colors"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={isEditingSuperBlocked || isCreationBlocked}
                    className="px-6 py-2.5 font-extrabold bg-blue-600 hover:bg-blue-700 disabled:bg-slate-300 dark:disabled:bg-slate-800 disabled:text-slate-500 disabled:cursor-not-allowed text-white rounded-xl shadow-md transition-all"
                  >
                    {userToEdit ? 'Save Changes' : 'Create Staff Member'}
                  </button>
                </div>
              </div>
            )}
          </div>
        </form>
      </div>
    </div>
  );
};

