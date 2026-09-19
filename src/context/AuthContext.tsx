import React, { createContext, useContext, useState, useEffect } from 'react';
import { UserProfile, UserRole } from '../types';
import { useToast } from './ToastContext';
import { getAllItems, putItem, putManyItems, replaceStoreItems, deleteItem } from '../db/indexedDB';
import { saveDocument, removeDocument } from '../firebase/services';
import { signInWithPopup, GoogleAuthProvider } from 'firebase/auth';
import { auth, googleProvider } from '../firebase/config';
import { setGoogleDriveAccessToken } from '../services/googleDriveService';
import { subscribeTabSync } from '../firebase/syncManager';

export const isSuperUser = (user: UserProfile | null | undefined): boolean => {
  if (!user) return false;
  const dn = (user.displayName || '').toLowerCase();
  // Standard Admin ("Administrator") is explicitly NOT a Super-User
  if (
    user.id === 'usr-admin-1' ||
    user.username === 'admin' ||
    (user.displayName === 'Administrator' && !dn.includes('idofera') && !dn.includes('michael') && !dn.includes('aidy'))
  ) {
    return false;
  }
  return Boolean(
    user.isSuperAdmin ||
    user.id === 'usr-superadmin-idofera' ||
    user.username === 'idofera' ||
    user.username === 'michaelidongesit5' ||
    user.email === 'michaelidongesit5@gmail.com' ||
    user.email === 'idofera@idoferapackaging.com' ||
    dn.includes('idofera') ||
    dn.includes('michael') ||
    dn.includes('aidy')
  );
};

interface AuthContextType {
  currentUser: UserProfile | null;
  users: UserProfile[];
  loading: boolean;
  isSuperAdmin: boolean;
  switchUser: (userId: string) => void;
  switchDemoRole: (role: UserRole) => void;
  addUser: (userData: Omit<UserProfile, 'id' | 'createdAt'>) => UserProfile;
  updateUser: (id: string, updates: Partial<UserProfile>) => void;
  deleteUser: (id: string) => void;
  changePassword: (newPassword: string, oldPassword?: string) => Promise<void>;
  adminResetPassword: (targetUserId: string, newPassword: string) => Promise<void>;
  loginWithEmail: (e: string, p: string) => Promise<void>;
  registerWithEmail: (e: string, p: string, name: string, role: UserRole) => Promise<void>;
  loginWithGoogle: () => Promise<void>;
  logout: () => Promise<void>;
  hasPermission: (requiredRoles: UserRole[]) => boolean;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const SUPER_ADMIN_USER: UserProfile = {
  id: 'usr-superadmin-idofera',
  email: 'michaelidongesit5@gmail.com',
  username: 'idofera',
  displayName: 'Aidy Mike',
  role: 'Administrator',
  avatarUrl: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=150&auto=format&fit=crop',
  status: 'Active',
  createdAt: new Date('2026-01-01').toISOString(),
  lastLogin: new Date().toISOString(),
  password: 'aidy2800',
  passwordLastChanged: new Date('2026-01-01').toISOString(),
  isProtected: true,
  isSuperAdmin: true,
};

export const STANDARD_ADMIN_USER: UserProfile = {
  id: 'usr-admin-1',
  email: 'admin@idoferapackaging.com',
  username: 'admin',
  displayName: 'Administrator',
  role: 'Administrator',
  avatarUrl: 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=150&auto=format&fit=crop',
  status: 'Active',
  createdAt: new Date('2026-01-01').toISOString(),
  lastLogin: new Date().toISOString(),
  password: 'admin123',
  passwordLastChanged: new Date('2026-01-01').toISOString(),
  isProtected: false,
  isSuperAdmin: false,
};

export const INITIAL_USERS: UserProfile[] = [
  SUPER_ADMIN_USER,
  STANDARD_ADMIN_USER,
];

export const DEMO_USERS: Record<UserRole, UserProfile> = {
  Administrator: STANDARD_ADMIN_USER,
  'Store Manager': STANDARD_ADMIN_USER,
  'Sales Staff': STANDARD_ADMIN_USER,
  Accountant: STANDARD_ADMIN_USER,
};

const DUMMY_USER_IDS = new Set(['usr-sales-1', 'usr-accountant-1']);

const sanitizeUsersList = (rawUsers: UserProfile[]): UserProfile[] => {
  const cleaned = rawUsers.filter((u) => u && !DUMMY_USER_IDS.has(u.id));
  const sanitized = cleaned.map((u) => {
    const dn = (u.displayName || '').toLowerCase();
    if (u.id === 'usr-admin-1' || u.username === 'admin' || (u.displayName === 'Administrator' && !dn.includes('idofera') && !dn.includes('michael') && !dn.includes('aidy'))) {
      return {
        ...u,
        isSuperAdmin: false,
        isProtected: false,
      };
    }
    if (
      u.id === 'usr-superadmin-idofera' ||
      u.username === 'idofera' ||
      u.username === 'michaelidongesit5' ||
      u.email === 'michaelidongesit5@gmail.com' ||
      u.email === 'idofera@idoferapackaging.com' ||
      dn.includes('idofera') ||
      dn.includes('michael') ||
      dn.includes('aidy')
    ) {
      return {
        ...SUPER_ADMIN_USER,
        ...u,
        id: 'usr-superadmin-idofera',
        email: 'michaelidongesit5@gmail.com',
        username: 'idofera',
        displayName: 'Aidy Mike',
        isSuperAdmin: true,
        isProtected: true,
      };
    }
    return u;
  });

  const uniqueUsers = new Map<string, UserProfile>();
  for (const user of sanitized) {
    const existing = uniqueUsers.get(user.id);
    if (!existing) {
      uniqueUsers.set(user.id, user);
      continue;
    }

    const existingChangedAt = Date.parse(existing.passwordLastChanged || existing.lastLogin || existing.createdAt || '') || 0;
    const candidateChangedAt = Date.parse(user.passwordLastChanged || user.lastLogin || user.createdAt || '') || 0;
    uniqueUsers.set(user.id, candidateChangedAt > existingChangedAt ? user : existing);
  }

  if (!uniqueUsers.has('usr-superadmin-idofera')) {
    uniqueUsers.set(SUPER_ADMIN_USER.id, SUPER_ADMIN_USER);
  }
  if (!uniqueUsers.has('usr-admin-1')) {
    uniqueUsers.set(STANDARD_ADMIN_USER.id, STANDARD_ADMIN_USER);
  }
  return [...uniqueUsers.values()];
};

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [users, setUsers] = useState<UserProfile[]>(() => {
    try {
      const saved = localStorage.getItem('idofera_users');
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed) && parsed.length > 0) {
          const sanitized = sanitizeUsersList(parsed);
          if (sanitized.length > 0) return sanitized;
        }
      }
    } catch (e) {
      console.error('Failed to load users from storage:', e);
    }
    return INITIAL_USERS;
  });

  const [currentUser, setCurrentUser] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const { showToast } = useToast();

  const refreshServerUsers = async () => {
    const token = localStorage.getItem('idofera_session_token') || sessionStorage.getItem('idofera_session_token');
    const headers: Record<string, string> = {};
    if (token) {
      headers['authorization'] = `Bearer ${token}`;
      headers['x-session-token'] = token;
    }
    const response = await fetch('/api/auth/users', {credentials: 'include', headers});
    if (!response.ok) return;
    const data = await response.json() as {users?: UserProfile[]};
    if (data.users?.length) setUsers(sanitizeUsersList(data.users));
  };

  useEffect(() => {
    let active = true;
    const token = localStorage.getItem('idofera_session_token') || sessionStorage.getItem('idofera_session_token');
    const headers: Record<string, string> = {};
    if (token) {
      headers['authorization'] = `Bearer ${token}`;
      headers['x-session-token'] = token;
    }
    fetch('/api/auth/session', {credentials: 'include', headers, cache: 'no-store'})
      .then(async (response) => response.ok ? response.json() : {user: null})
      .then(async ({user, entranceAllowed}) => {
        if (!active) return;
        if (!user && !entranceAllowed) {
          window.location.replace('/');
          return;
        }
        setCurrentUser(user || null);
        if (user) await refreshServerUsers();
      })
      .catch(() => active && setCurrentUser(null))
      .finally(() => active && setLoading(false));
    return () => { active = false; };
  }, []);

  // Revalidate open workspaces/login screens after expiry or another-tab logout.
  useEffect(() => {
    let active = true;
    const check = async () => {
      try {
        const token = localStorage.getItem('idofera_session_token') || sessionStorage.getItem('idofera_session_token');
        const headers: Record<string, string> = token ? { authorization: `Bearer ${token}` } : {};
        const response = await fetch('/api/auth/session', { credentials: 'include', cache: 'no-store', headers });
        if (!response.ok) return;
        const { user, entranceAllowed } = await response.json();
        if (active && !user && !entranceAllowed) window.location.replace('/');
      } catch { /* A transient network error is not a confirmed expired session. */ }
    };
    const timer = window.setInterval(check, 30000);
    window.addEventListener('focus', check);
    return () => { active = false; window.clearInterval(timer); window.removeEventListener('focus', check); };
  }, []);

  // Load users from IndexedDB and Central Cloud Firestore on boot
  useEffect(() => {
    let isMounted = true;
    async function loadUsers() {
      try {
        const dbUsers = await getAllItems<UserProfile>('users');
        if (!isMounted) return;

        let activeUsers = INITIAL_USERS;
        if (dbUsers && dbUsers.length > 0) {
          const sanitized = sanitizeUsersList(dbUsers);
          if (sanitized.length > 0) {
            activeUsers = sanitized;
            setUsers(sanitized);
          }
        } else {
          await putManyItems('users', INITIAL_USERS);
        }

        // Cached profiles are not proof of a valid server session.
      } catch (err) {
        console.warn('Users load warning:', err);
      }
    }
    loadUsers();
    return () => {
      isMounted = false;
    };
  }, []);

  useEffect(() => {
    const handleUserSync = (userList: UserProfile[]) => {
      if (userList && userList.length > 0) {
        const sanitized = sanitizeUsersList(userList);
        if (sanitized.length > 0) {
          setUsers(sanitized);
          if (currentUser) {
            const match = sanitized.find((u) => u.id === currentUser.id);
            if (match) {
              setCurrentUser(match);
            }
          }
        }
      }
    };

    const handleDbRestored = (e: any) => {
      if (e.detail && Array.isArray(e.detail.users) && e.detail.users.length > 0) {
        handleUserSync(e.detail.users);
      }
    };

    window.addEventListener('idofera_db_restored', handleDbRestored);

    const unsubTab = subscribeTabSync(async ({ storeName }) => {
      if (storeName === 'users') {
        try {
          const idbUsers = await getAllItems<UserProfile>('users');
          handleUserSync(idbUsers);
        } catch (e) {
          console.warn('Tab sync users error:', e);
        }
      }
    });

    return () => {
      window.removeEventListener('idofera_db_restored', handleDbRestored);
      unsubTab();
    };
  }, [currentUser]);

  // Sync users to localStorage and IndexedDB
  useEffect(() => {
    try {
      localStorage.setItem('idofera_users', JSON.stringify(users));
      replaceStoreItems('users', users).catch((e) => console.warn('IndexedDB users sync warning:', e));
    } catch (e) {
      console.error('Failed to save users:', e);
    }
  }, [users]);

  // Sync current user id
  useEffect(() => {
    if (currentUser) {
      try {
        localStorage.setItem('idofera_current_user_id', currentUser.id);
        putItem('users', currentUser).catch((e) => console.warn('IndexedDB current user sync warning:', e));
      } catch (e) {
        console.error('Failed to save current user id:', e);
      }
    } else {
      try {
        localStorage.removeItem('idofera_current_user_id');
      } catch (e) {
        console.error('Failed to clear current user id:', e);
      }
    }
  }, [currentUser]);

  const isSuperAdmin = isSuperUser(currentUser);

  const switchUser = (userId: string) => {
    if (!isSuperUser(currentUser)) {
      showToast({
        title: 'Switch Denied',
        message: 'Only a session logged in as the Super-User can auto switch between user accounts.',
        type: 'error',
      });
      throw new Error('Only the Super-User account can switch user accounts.');
    }
    const user = users.find((u) => u.id === userId);
    if (user) {
      const updatedUser = { ...user, lastLogin: new Date().toISOString() };
      setCurrentUser(updatedUser);
      setUsers((prev) => prev.map((u) => (u.id === userId ? updatedUser : u)));
    }
  };

  const switchDemoRole = (role: UserRole) => {
    if (!isSuperUser(currentUser)) {
      showToast({
        title: 'Switch Denied',
        message: 'Only a session logged in as the Super-User can switch user roles.',
        type: 'error',
      });
      throw new Error('Only the Super-User account can switch demo roles.');
    }
    const foundUser = users.find((u) => u.role === role && u.status === 'Active');
    if (foundUser) {
      switchUser(foundUser.id);
    } else if (currentUser) {
      updateUser(currentUser.id, { role });
    }
  };

  const addUser = (userData: Omit<UserProfile, 'id' | 'createdAt'>): UserProfile => {
    if (!isSuperUser(currentUser)) {
      showToast({
        title: 'Access Denied',
        message: 'Only a session logged in as the Super-User can create new user accounts.',
        type: 'error',
      });
      throw new Error('Only the Super-User account can create new user accounts.');
    }
    const derivedUsername = userData.username || (userData.email ? userData.email.split('@')[0] : (userData.displayName || 'user').toLowerCase().replace(/\s+/g, ''));
    const newUser: UserProfile = {
      ...userData,
      username: derivedUsername,
      id: 'usr-' + Date.now(),
      createdAt: new Date().toISOString(),
      lastLogin: new Date().toISOString(),
    };
    setUsers((prev) => [newUser, ...prev]);
    fetch('/api/auth/users', {method: 'PUT', credentials: 'include', headers: {'content-type': 'application/json'}, body: JSON.stringify({user: newUser, password: newUser.password})})
      .then((response) => { if (!response.ok) throw new Error('Server rejected the new user.'); })
      .catch((error) => showToast({title: 'Server Account Error', message: error.message, type: 'error'}));
    saveDocument('users', newUser);
    showToast({
      title: 'New User Created',
      message: `User account for "${userData.displayName}" (${userData.role}) created successfully.`,
      type: 'success',
    });
    return newUser;
  };

  const updateUser = (id: string, updates: Partial<UserProfile>) => {
    let targetName = 'User';
    const targetUser = users.find((u) => u.id === id);

    // Regular admin cannot edit the super-user account
    if (targetUser && isSuperUser(targetUser) && !isSuperUser(currentUser)) {
      showToast({
        title: 'Update Blocked',
        message: 'Regular Administrators cannot modify the Super-User account.',
        type: 'error',
      });
      throw new Error('Regular Administrators cannot modify the Super-User account.');
    }

    if (targetUser && isSuperUser(targetUser)) {
      if (updates.status === 'Inactive') {
        showToast({ title: 'Update Blocked', message: 'This Super-User account is protected and cannot be deactivated.', type: 'error' });
        throw new Error('This Super-User account is protected and cannot be deactivated.');
      }
      if (updates.role && updates.role !== 'Administrator') {
        showToast({ title: 'Update Blocked', message: 'The Administrator role of this Super-User account cannot be altered.', type: 'error' });
        throw new Error('The Administrator role of this Super-User account cannot be altered.');
      }
    }
    setUsers((prev) =>
      prev.map((u) => {
        if (u.id === id) {
          targetName = u.displayName;
          const updated = { ...u, ...updates };
          fetch('/api/auth/users', {method: 'PUT', credentials: 'include', headers: {'content-type': 'application/json'}, body: JSON.stringify({user: updated, password: updates.password})})
            .catch((error) => console.warn('Server user update warning:', error));
          saveDocument('users', updated);
          if (currentUser?.id === id) {
            setCurrentUser(updated);
          }
          return updated;
        }
        return u;
      })
    );
    showToast({
      title: 'User Profile Updated',
      message: `Account details for "${targetName}" updated.`,
      type: 'info',
    });
  };

  const deleteUser = (id: string) => {
    if (!isSuperUser(currentUser)) {
      showToast({
        title: 'Delete Denied',
        message: 'Only a session logged in as the Super-User can delete user accounts.',
        type: 'error',
      });
      throw new Error('Only the Super-User account can delete user accounts.');
    }
    const targetUser = users.find((u) => u.id === id);
    if (targetUser && isSuperUser(targetUser)) {
      showToast({ title: 'Delete Failed', message: 'This Super-User account is protected and cannot be deleted.', type: 'error' });
      throw new Error('Protected Super-User account cannot be deleted.');
    }
    if (currentUser?.id === id) {
      showToast({ title: 'Delete Failed', message: 'Cannot delete the active logged in user account.', type: 'error' });
      throw new Error('Cannot delete the currently active logged in user.');
    }
    const adminCount = users.filter((u) => u.role === 'Administrator').length;
    if (targetUser?.role === 'Administrator' && adminCount <= 1) {
      showToast({ title: 'Delete Failed', message: 'Cannot delete the only remaining Administrator.', type: 'error' });
      throw new Error('Cannot delete the only remaining Administrator.');
    }
    setUsers((prev) => prev.filter((u) => u.id !== id));
    fetch(`/api/auth/users/${encodeURIComponent(id)}`, {method: 'DELETE', credentials: 'include'})
      .catch((error) => console.warn('Server user deletion warning:', error));
    removeDocument('users', id);
    showToast({
      title: 'User Account Deleted',
      message: targetUser ? `User "${targetUser.displayName}" removed.` : 'User account removed.',
      type: 'error',
    });
  };

  const changePassword = async (newPassword: string, oldPassword?: string) => {
    if (!currentUser) {
      throw new Error('No user is currently logged in.');
    }
    if (!newPassword || newPassword.length < 8) {
      throw new Error('Password must be at least 8 characters long.');
    }

    const response = await fetch('/api/auth/password', {method: 'POST', credentials: 'include', headers: {'content-type': 'application/json'}, body: JSON.stringify({oldPassword, newPassword})});
    const result = await response.json() as {error?: string; passwordLastChanged?: string};
    if (!response.ok) throw new Error(result.error || 'Password update failed.');
    const now = result.passwordLastChanged || new Date().toISOString();
    setCurrentUser((user) => user ? {...user, passwordLastChanged: now} : user);
    setUsers((items) => items.map((user) => user.id === currentUser.id ? {...user, passwordLastChanged: now} : user));

    showToast({
      title: 'Password Updated',
      message: 'Your login password has been set/updated successfully.',
      type: 'success',
    });
  };

  const adminResetPassword = async (targetUserId: string, newPassword: string) => {
    if (!currentUser || currentUser.role !== 'Administrator') {
      showToast({ title: 'Permission Denied', message: 'Only Administrators can reset other users passwords.', type: 'error' });
      throw new Error('Only Administrators can reset user passwords.');
    }
    if (!newPassword || newPassword.length < 8) {
      showToast({ title: 'Invalid Password', message: 'Password must be at least 8 characters long.', type: 'error' });
      throw new Error('Password must be at least 8 characters long.');
    }

    const targetUser = users.find((u) => u.id === targetUserId);
    if (!targetUser) {
      showToast({ title: 'User Not Found', message: 'Target user account not found.', type: 'error' });
      throw new Error('Target user account not found.');
    }

    if (isSuperUser(targetUser) && !isSuperUser(currentUser)) {
      showToast({
        title: 'Permission Denied',
        message: 'Regular Administrators cannot reset the Super-User password.',
        type: 'error',
      });
      throw new Error('Regular Administrators cannot reset the Super-User password.');
    }

    const response = await fetch('/api/auth/password', {method: 'POST', credentials: 'include', headers: {'content-type': 'application/json'}, body: JSON.stringify({targetUserId, newPassword})});
    const result = await response.json() as {error?: string; passwordLastChanged?: string};
    if (!response.ok) throw new Error(result.error || 'Password reset failed.');
    const now = result.passwordLastChanged || new Date().toISOString();
    setUsers((items) => items.map((user) => user.id === targetUserId ? {...user, passwordLastChanged: now} : user));

    showToast({
      title: 'Password Reset Successful',
      message: `Log-in password for "${targetUser.displayName}" (${targetUser.email}) has been reset.`,
      type: 'success',
    });
  };

  const loginWithEmail = async (identifier: string, p: string) => {
    setLoading(true);
    try {
      const response = await fetch('/api/auth/login', {method: 'POST', credentials: 'include', headers: {'content-type': 'application/json'}, body: JSON.stringify({identifier, password: p})});
      const data = await response.json() as {user?: UserProfile; sessionToken?: string; token?: string; error?: string};
      if (!response.ok || !data.user) throw new Error(data.error || 'Authentication failed.');
      if (data.sessionToken || data.token) {
        localStorage.setItem('idofera_session_token', data.sessionToken || data.token || '');
      }
      setCurrentUser(data.user);
      if (isSuperUser(data.user)) {
        const localUsers = sanitizeUsersList(users);
        await Promise.all(localUsers.map((user) => fetch('/api/auth/users', {method: 'PUT', credentials: 'include', headers: {'content-type': 'application/json'}, body: JSON.stringify({user, password: user.password})})));
      }
      await refreshServerUsers();
      showToast({ title: 'Signed In', message: `Welcome back, ${data.user.displayName}!`, type: 'success' });
    } finally {
      setLoading(false);
    }
  };

  const registerWithEmail = async (e: string, p: string, name: string, role: UserRole) => {
    setLoading(true);
    try {
      const newUser = addUser({
        email: e,
        displayName: name,
        role,
        status: 'Active',
        password: p,
        passwordLastChanged: new Date().toISOString(),
      });
      setCurrentUser(newUser);
      showToast({ title: 'Registration Successful', message: `Welcome ${name}! Authorized as ${role}.`, type: 'success' });
    } finally {
      setLoading(false);
    }
  };

  const loginWithGoogle = async () => {
    setLoading(true);
    try {
      const result = await signInWithPopup(auth, googleProvider);
      const googleUser = result.user;
      const credential = GoogleAuthProvider.credentialFromResult(result);
      if (credential?.accessToken) {
        setGoogleDriveAccessToken(credential.accessToken);
      }
      const gEmail = googleUser.email ? googleUser.email.trim().toLowerCase() : '';

      if (!gEmail) {
        showToast({
          title: 'Google Sign In Error',
          message: 'Could not retrieve a valid email address from your Google Account.',
          type: 'error',
        });
        return;
      }

      if (!credential?.accessToken) throw new Error('Google did not provide a verifiable access token.');
      const response = await fetch('/api/auth/google', {method: 'POST', credentials: 'include', headers: {'content-type': 'application/json'}, body: JSON.stringify({accessToken: credential.accessToken})});
      const data = await response.json() as {user?: UserProfile; sessionToken?: string; token?: string; error?: string};
      if (!response.ok || !data.user) throw new Error(data.error || 'Google authentication failed.');
      if (data.sessionToken || data.token) {
        localStorage.setItem('idofera_session_token', data.sessionToken || data.token || '');
      }
      setCurrentUser(data.user);
      await refreshServerUsers();
      showToast({title: 'Google Authentication Successful', message: `Welcome back, ${data.user.displayName}!`, type: 'success'});
    } catch (err: any) {
      console.warn('Google Auth Popup process notice:', err);
      if (err?.code === 'auth/popup-closed-by-user') {
        showToast({
          title: 'Sign In Cancelled',
          message: 'Google Sign-In popup was closed before completing authentication.',
          type: 'info',
        });
      } else if (err?.code === 'auth/popup-blocked') {
        showToast({
          title: 'Popup Blocked',
          message: 'Google Sign-In popup was blocked by your browser. Please allow popups for this app.',
          type: 'warning',
        });
      } else if (err?.code === 'auth/unauthorized-domain') {
        showToast({
          title: 'Domain Not Authorized',
          message: 'This domain is not authorized for Firebase Google Auth in Firebase Console.',
          type: 'error',
        });
      } else if (err?.message?.includes('Google account not registered')) {
        // Already handled above
      } else {
        showToast({
          title: 'Google Auth Error',
          message: err?.message || 'Failed to authenticate with Google.',
          type: 'error',
        });
      }
    } finally {
      setLoading(false);
    }
  };

  const logout = async () => {
    const token = localStorage.getItem('idofera_session_token') || sessionStorage.getItem('idofera_session_token');
    const headers: Record<string, string> = {};
    if (token) {
      headers['authorization'] = `Bearer ${token}`;
      headers['x-session-token'] = token;
    }
    const response = await fetch('/api/auth/logout', {method: 'POST', credentials: 'include', headers});
    if (!response.ok) throw new Error('Sign out failed. Please try again.');
    localStorage.removeItem('idofera_current_user_id');
    localStorage.removeItem('idofera_session_token');
    sessionStorage.removeItem('idofera_session_token');
    setCurrentUser(null);
    showToast({
      title: 'Signed Out',
      message: 'You have been safely signed out of your local workspace.',
      type: 'info',
    });
    window.location.replace('/');
  };

  const hasPermission = (requiredRoles: UserRole[]) => {
    if (!currentUser) return false;
    if (currentUser.role === 'Administrator') return true;
    return requiredRoles.includes(currentUser.role);
  };

  return (
    <AuthContext.Provider
      value={{
        currentUser,
        users,
        loading,
        isSuperAdmin,
        switchUser,
        switchDemoRole,
        addUser,
        updateUser,
        deleteUser,
        changePassword,
        adminResetPassword,
        loginWithEmail,
        registerWithEmail,
        loginWithGoogle,
        logout,
        hasPermission,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used within an AuthProvider');
  return context;
};
