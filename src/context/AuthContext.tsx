import React, { createContext, useContext, useState, useEffect, useRef } from 'react';
import { UserProfile, UserRole } from '../types';
import { useToast } from './ToastContext';
import { getAllItems, putItem, putManyItems, replaceStoreItems, deleteItem } from '../db/indexedDB';
import { saveDocument, removeDocument } from '../firebase/services';
import { signInWithPopup, GoogleAuthProvider } from 'firebase/auth';
import { auth, googleProvider } from '../firebase/config';
import { setGoogleDriveAccessToken } from '../services/googleDriveService';
import { subscribeTabSync } from '../firebase/syncManager';
import { StepUpModal } from '../components/modals/StepUpModal';

export const isSuperUser = (user: UserProfile | null | undefined): boolean => {
  if (!user) return false;
  // Server-set flag ONLY. The previous version also matched a hardcoded id,
  // username and two e-mail literals. Those matched the LOCAL phantom profile
  // this module used to inject into its own user list (see INITIAL_USERS), so an
  // unauthenticated browser rendered a full Super-Admin workspace while every
  // private API call still failed with 401. /api/auth/users on the server was
  // already corrected to derive this from is_super_admin with no id/username/
  // e-mail backdoor; this restores the client to the same rule, per
  // docs/mall-launch-safety.md.
  return Boolean(user.isSuperAdmin);
};

interface AuthContextType {
  currentUser: UserProfile | null;
  users: UserProfile[];
  loading: boolean;
  isSuperAdmin: boolean;
  /**
   * Effective privilege for this session: the `app_users.is_super_admin` column
   * AND, when the server is configured with an IdP group, that group. The UI
   * gates on this, never on the raw column.
   */
  canSuperAdmin: boolean;
  /**
   * Email proven by Cloudflare Access when SSO authenticated the person but no
   * active roster account matched, so the sign-in screen can explain why.
   */
  ssoEmail: string;
  /** Re-prove the account password. Privileged changes require it (docs/staff-access.md). */
  stepUp: (password: string) => Promise<boolean>;
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

/**
 * Session revalidation cadence for an OPEN staff workspace. Polling only while
 * the tab is visible keeps a backgrounded Dashboard from hitting `/api/auth/session`
 * every 30 seconds; focus/visibility changes still revalidate immediately.
 */
const SESSION_RECHECK_MS = 120000;

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
  passwordLastChanged: new Date('2026-01-01').toISOString(),
  isProtected: false,
  isSuperAdmin: false,
};

/**
 * Client-side starting list. This must NOT contain an account the server has
 * never issued: the staff client used to bundle both a Super-Admin and an
 * Administrator profile, so an empty browser showed a signed-in user and every
 * request to a private API answered 401.
 *
 * Only a plain, non-super, password-less placeholder is kept so local UI
 * selection still has a role to render before the first server sync. It grants
 * no privileges (super-user status is `isSuperAdmin === true`, server-set only)
 * and cannot authenticate. If no account is provisioned server-side, the staff
 * workspace now shows the sign-in screen instead of a phantom session.
 */
export const INITIAL_USERS: UserProfile[] = [
  {...STANDARD_ADMIN_USER, id: 'usr-placeholder-admin', isProtected: false},
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
    if (u.id === 'usr-admin-1' || u.username === 'admin') {
      return {
        ...u,
        isSuperAdmin: false,
        isProtected: false,
      };
    }
    // The usr-admin-1 normalization that used to live here was dead code: the
    // force-super branch above matched usr-admin-1 first (nothing excluded it),
    // so the standard admin profile was promoted to Super-Admin plus
    // isProtected. Derived flags are now trusted as received; privilege comes
    // from the server's is_super_admin column and nowhere else.
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

  // This function must never INVENT a user. It used to re-add the bundled
  // super-admin and administrator here whenever a stored list did not contain
  // them, which is what made the phantom account self-healing: deleting it from
  // localStorage only brought it back on the next load with a freshly minted
  // "last login" and `isProtected: true`. Super-user grants are server-set
  // identity only, so the client cannot be the source of that privilege.
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

  // Effective privilege: server-says-so (DB flag + IdP group), never the raw
  // column. True only while the server keeps confirming it.
  const [canSuperAdmin, setCanSuperAdmin] = useState(false);
  // Set when Cloudflare Access authenticated a person with no matching account,
  // so the sign-in screen can explain why SSO did not open the workspace.
  // Survives the full-page redirect to '/' that carries the explanation.
  const [ssoEmail, setSsoEmail] = useState(() => {
    try { return sessionStorage.getItem('idofera_sso_email') || ''; } catch { return ''; }
  });
  const persistSsoEmail = (email: string | null) => {
    try {
      if (email) sessionStorage.setItem('idofera_sso_email', email);
      else sessionStorage.removeItem('idofera_sso_email');
    } catch { /* storage may be unavailable; the state below still applies */ }
    setSsoEmail(email || '');
  };
  // The privileged request pauses here while the operator types their password.
  // The resolver lives in a REF: React may double-invoke state updaters in
  // StrictMode, and resolving a promise from inside an updater would resolve it
  // twice (the exact bug that used to double-send profile PUTs).
  const stepUpResolver = useRef<((password: string | null) => void) | null>(null);
  const [stepUpOpen, setStepUpOpen] = useState(false);
  const [stepUpBusy, setStepUpBusy] = useState(false);
  const [stepUpError, setStepUpError] = useState('');

  /** Ask the operator for their account password. Resolves null when cancelled. */
  const askForPassword = () =>
    new Promise<string | null>((resolve) => {
      stepUpResolver.current = resolve;
      setStepUpError('');
      setStepUpOpen(true);
    });

  const finishStepUp = (password: string | null) => {
    const resolve = stepUpResolver.current;
    stepUpResolver.current = null;
    setStepUpOpen(false);
    setStepUpError('');
    resolve?.(password);
  };

  /**
   * Mint the short-lived step-up proof the server requires for privileged
   * changes (docs/staff-access.md). Resolves true only once the server has
   * hashed and stored it for this account.
   */
  const stepUp = async (password: string): Promise<boolean> => {
    try {
      const response = await fetch('/api/auth/step-up', {
        method: 'POST',
        credentials: 'include',
        headers: {'content-type': 'application/json'},
        body: JSON.stringify({password}),
      });
      const data = await response.json() as {ok?: boolean; canSuperAdmin?: boolean; error?: string};
      if (!response.ok || !data.ok) {
        setStepUpError(data.error || 'That password could not be confirmed.');
        return false;
      }
      if (typeof data.canSuperAdmin === 'boolean') setCanSuperAdmin(data.canSuperAdmin);
      return true;
    } catch {
      setStepUpError('Could not confirm your password. Check your connection and try again.');
      return false;
    }
  };

  /**
   * Runs a request that the server may treat as privileged.
   *  - `STEP_UP_REQUIRED` (403): open the password prompt; once the proof is
   *    minted, retry the ORIGINAL request transparently.
   *  - `SUPER_ADMIN_GROUP_REQUIRED` (403): only the identity provider can fix
   *    this, so it is reported as a toast instead of being retried.
   */
  const privilegedRequest = async (url: string, init: RequestInit): Promise<Response> => {
    const send = () => fetch(url, {
      ...init,
      credentials: 'include',
      headers: {'content-type': 'application/json', ...(init.headers || {})},
    });
    const first = await send();
    if (first.status !== 403) return first;
    const body = await first.clone().json().catch(() => ({})) as {code?: string; error?: string};
    if (body.code === 'SUPER_ADMIN_GROUP_REQUIRED') {
      showToast({
        title: 'Identity Provider Check Required',
        message: body.error || 'Your identity provider has not confirmed the super-administrator group.',
        type: 'error',
      });
      return first;
    }
    if (body.code !== 'STEP_UP_REQUIRED') return first;
    const password = await askForPassword();
    if (!password) return first;
    return await send();
  };

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
      .then(async (response) => {
        // An expired Cloudflare Access cookie sends the request off to the IdP;
        // the redirected cross-origin answer cannot be read as JSON. One
        // full-page navigation to /labs lets Access re-authenticate, bounded by
        // sessionStorage so a dead API cannot trap the tab in a reload loop.
        if (response.redirected && !response.url.startsWith(window.location.origin)) {
          const last = Number(sessionStorage.getItem('idofera_access_reload_at') || 0);
          if (active && Date.now() - last > 60000) {
            sessionStorage.setItem('idofera_access_reload_at', String(Date.now()));
            window.location.replace('/labs');
          }
          return null;
        }
        return response.ok ? response.json() : {user: null};
      })
      .then(async (payload) => {
        if (!active || !payload) return;
        const {user, entranceAllowed, accessEmail, registered, canSuperAdmin: canAct} = payload as {
          user: UserProfile | null;
          entranceAllowed?: boolean;
          accessEmail?: string;
          registered?: boolean;
          canSuperAdmin?: boolean;
        };
        if (typeof canAct === 'boolean') setCanSuperAdmin(canAct);
        if (registered === false && accessEmail) {
          // Access proved the person, but no ACTIVE roster account matches.
          // SSO never creates one (docs/staff-access.md): explain on the
          // sign-in screen instead of opening a workspace.
          persistSsoEmail(accessEmail);
          window.location.replace('/');
          return;
        }
        if (!user && !entranceAllowed) {
          window.location.replace('/');
          return;
        }
        persistSsoEmail(null);
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
    // A backgrounded tab must not keep reading the session table on a timer;
    // focus and visibility changes still revalidate as soon as the user returns.
    const poll = () => { if (!document.hidden) void check(); };
    const onVisibilityChange = () => { if (!document.hidden) void check(); };
    const timer = window.setInterval(poll, SESSION_RECHECK_MS);
    window.addEventListener('focus', check);
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => {
      active = false;
      window.clearInterval(timer);
      window.removeEventListener('focus', check);
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
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

        // Cached profiles are not proof of a valid server session. The real
        // roster (and the real super-admin flag) arrives from /api/auth/session
        // and /api/auth/users; nothing here may grant privilege.
        void activeUsers;
      } catch (err) {
        console.warn('Users load warning:', err);
      }
    }
    loadUsers();
    return () => {
      isMounted = false;
    };
  }, []);

  const currentUserRef = useRef(currentUser);
  useEffect(() => { currentUserRef.current = currentUser; }, [currentUser]);

  useEffect(() => {
    const handleUserSync = (userList: UserProfile[]) => {
      if (userList && userList.length > 0) {
        const sanitized = sanitizeUsersList(userList);
        if (sanitized.length > 0) {
          setUsers(sanitized);
          const liveUser = currentUserRef.current;
          if (liveUser) {
            const match = sanitized.find((u) => u.id === liveUser.id);
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
    // Empty deps on purpose: the handlers read currentUserRef, so a login or
    // switch-user no longer tears down and re-adds the window listener and the
    // BroadcastChannel subscription (which briefly dropped events).
  }, []);

  // Sync users to localStorage and IndexedDB
  useEffect(() => {
    try {
      // Passwords stay in memory for the one request that needs them; they are
      // never written to localStorage/IndexedDB, where any script could read
      // them. The server keeps the only credential copy (hashed).
      const persistable = users.map(({ password, ...profile }) => profile);
      localStorage.setItem('idofera_users', JSON.stringify(persistable));
      replaceStoreItems('users', persistable).catch((e) => console.warn('IndexedDB users sync warning:', e));
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
    // Creating the account is privileged: the prompt/retry keeps this local
    // creation in sync with what the server actually accepts.
    privilegedRequest('/api/auth/users', {method: 'PUT', body: JSON.stringify({user: newUser, password: newUser.password})})
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
    // Side effects (the server PUT and the IndexedDB save) run OUTSIDE the
    // updater: StrictMode double-invoked the updater, which sent two PUTs and
    // two saves for every profile edit.
    const target = users.find((u) => u.id === id);
    if (!target) return;
    targetName = target.displayName;
    const updated = { ...target, ...updates };
    privilegedRequest('/api/auth/users', {method: 'PUT', body: JSON.stringify({user: updated, password: updates.password})})
      .catch((error) => console.warn('Server user update warning:', error));
    saveDocument('users', updated);
    setUsers((prev) => prev.map((u) => (u.id === id ? updated : u)));
    if (currentUser?.id === id) {
      setCurrentUser(updated);
    }
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
    // Deleting an account is privileged: the server demands a fresh password
    // confirmation (403 STEP_UP_REQUIRED), which privilegedRequest prompts for.
    privilegedRequest(`/api/auth/users/${encodeURIComponent(id)}`, {method: 'DELETE'})
      .then((response) => { if (!response.ok) console.warn('Server user deletion rejected:', response.status); })
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

    // Resetting ANOTHER account's password is the most sensitive staff action;
    // the server re-checks privilege and the fresh step-up on this call.
    const response = await privilegedRequest('/api/auth/password', {method: 'POST', body: JSON.stringify({targetUserId, newPassword})});
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
      const data = await response.json() as {user?: UserProfile; sessionToken?: string; token?: string; error?: string; canSuperAdmin?: boolean};
      if (!response.ok || !data.user) throw new Error(data.error || 'Authentication failed.');
      if (data.sessionToken || data.token) {
        localStorage.setItem('idofera_session_token', data.sessionToken || data.token || '');
      }
      if (typeof data.canSuperAdmin === 'boolean') setCanSuperAdmin(data.canSuperAdmin);
      persistSsoEmail(null);
      setCurrentUser(data.user);
      if (isSuperUser(data.user)) {
        // Provision only the profiles this device created and that therefore
        // carry a password. The old form re-PUT EVERY cached profile on each
        // super-admin login, which re-sent the bundled demo password for the
        // former bundled super-admin id and silently reset the real super-admin
        // password back to that known value.
        const pendingProvision = sanitizeUsersList(users).filter((user) => user.password);
        if (pendingProvision.length) {
          // The password that just signed us in is a valid step-up proof too;
          // mint it now so provisioning never opens a second prompt.
          await stepUp(p);
          await Promise.all(pendingProvision.map((user) => privilegedRequest('/api/auth/users', {method: 'PUT', body: JSON.stringify({user, password: user.password})})));
        }
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
      const data = await response.json() as {user?: UserProfile; sessionToken?: string; token?: string; error?: string; canSuperAdmin?: boolean};
      if (!response.ok || !data.user) throw new Error(data.error || 'Google authentication failed.');
      if (typeof data.canSuperAdmin === 'boolean') setCanSuperAdmin(data.canSuperAdmin);
      persistSsoEmail(null);
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
    // Best effort: if the server cannot confirm the sign-out, this device is
    // still signed out locally (the old code threw and left the session token
    // and the signed-in UI in place, with no way to retry cleanly).
    let serverConfirmed = true;
    try {
      const response = await fetch('/api/auth/logout', {method: 'POST', credentials: 'include', headers});
      serverConfirmed = response.ok;
    } catch {
      serverConfirmed = false;
    }
    localStorage.removeItem('idofera_current_user_id');
    localStorage.removeItem('idofera_session_token');
    sessionStorage.removeItem('idofera_session_token');
    setCurrentUser(null);
    setCanSuperAdmin(false);
    persistSsoEmail(null);
    showToast({
      title: 'Signed Out',
      message: serverConfirmed
        ? 'You have been safely signed out of your local workspace.'
        : 'Signed out on this device. The server could not confirm sign-out; it will be revoked when the session expires.',
      type: serverConfirmed ? 'info' : 'warning',
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
        canSuperAdmin,
        ssoEmail,
        stepUp,
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
      {/* Privileged staff actions pause here for a fresh password proof. */}
      <StepUpModal
        isOpen={stepUpOpen}
        busy={stepUpBusy}
        error={stepUpError}
        onConfirm={(password) => {
          // Mint the proof BEFORE resolving: the caller retries only after the
          // server has accepted the password, and a wrong password keeps this
          // prompt OPEN with the server's message instead of failing silently.
          setStepUpBusy(true);
          stepUp(password)
            .then((confirmed) => { if (confirmed) finishStepUp(password); })
            .finally(() => setStepUpBusy(false));
        }}
        onCancel={() => finishStepUp(null)}
      />
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used within an AuthProvider');
  return context;
};
