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
  /**
   * True when a verified Access identity matched no ACTIVE roster account
   * (docs/staff-access.md). StaffApp renders the "confirmed but not
   * provisioned" notice for this state instead of the LoginView.
   */
  ssoUnregistered: boolean;
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
  /**
   * Lock the workspace without signing out (docs/staff-access.md). Keeps the app
   * session so unlocking is immediate, revokes the step-up proof so an
   * unattended terminal cannot perform privileged actions, and returns to the
   * staff entrance. `idle: true` marks the automatic idle lock, which explains
   * itself in the toast instead of looking like an operator action.
   */
  lock: (options?: { idle?: boolean }) => Promise<void>;
  hasPermission: (requiredRoles: UserRole[]) => boolean;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

/**
 * Session revalidation cadence for an OPEN staff workspace. Polling only while
 * the tab is visible keeps a backgrounded Dashboard from hitting `/api/auth/session`
 * every 30 seconds; focus/visibility changes still revalidate immediately.
 */
const SESSION_RECHECK_MS = 120000;

/**
 * Idle auto-lock. Mirrors `CF_SESSION_IDLE_SECONDS` on the server (30 minutes,
 * `src/server/staffSession.ts`): the server is the authority and stops
 * authorizing private APIs at this boundary regardless, so this timer exists to
 * make the lock EXPLICIT and VISIBLE rather than letting the next API call fail
 * mysteriously.
 *
 * The warning fires first so nobody loses an in-progress form without notice;
 * any real activity (pointer, key, focus, scroll) resets both timers.
 */
export const IDLE_LOCK_MS = 30 * 60 * 1000;
export const IDLE_WARNING_MS = 60 * 1000;

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
  // so the staff surface can explain why SSO did not open the workspace.
  const [ssoEmail, setSsoEmail] = useState(() => {
    try { return sessionStorage.getItem('idofera_sso_email') || ''; } catch { return ''; }
  });
  // Mirrors whether the notice (rather than the sign-in form) owns the screen.
  // Initialized from the same storage so a reload during the unregistered state
  // renders consistently instead of flashing the LoginView.
  const [ssoUnregistered, setSsoUnregistered] = useState(() => {
    try { return Boolean(sessionStorage.getItem('idofera_sso_email')); } catch { return false; }
  });
  const persistSsoEmail = (email: string | null) => {
    try {
      if (email) sessionStorage.setItem('idofera_sso_email', email);
      else sessionStorage.removeItem('idofera_sso_email');
    } catch { /* storage may be unavailable; the state below still applies */ }
    setSsoEmail(email || '');
    setSsoUnregistered(Boolean(email));
  };

  // ---------------------------------------------------------------------------
  // Lock / sign-out primitives.
  //
  // Declared here, above every effect that calls them, on purpose. Effects only
  // run after the render body finishes, so a helper defined further down would
  // still be initialized in time — but the ordering below is what makes the
  // dependency obvious and keeps these safe to call from a timer as well.
  // ---------------------------------------------------------------------------

  /**
   * Where the browser must go to end the CLOUDFLARE ACCESS session. The team
   * domain lives only on the server; `null` means the gate is off (local
   * development), where there is no Access session to end.
   */
  const accessLogoutUrl = async (): Promise<string | null> => {
    try {
      const response = await fetch('/api/auth/access-logout-url', { credentials: 'include', cache: 'no-store' });
      if (!response.ok) return null;
      const data = await response.json() as { url?: string | null };
      return data.url || null;
    } catch {
      return null;
    }
  };

  /**
   * Clear this device's copy of the session. Deliberately shared by lock, sign-out
   * and idle expiry: each must leave nothing behind that would let the next person
   * at the terminal render a signed-in shell before the server has been asked.
   */
  const clearLocalSession = () => {
    localStorage.removeItem('idofera_current_user_id');
    localStorage.removeItem('idofera_session_token');
    sessionStorage.removeItem('idofera_session_token');
    sessionStorage.removeItem('idofera_access_reload_at');
    setCurrentUser(null);
    setCanSuperAdmin(false);
    persistSsoEmail(null);
  };

  /**
   * Lock: step away from the terminal. NOT a sign-out (docs/staff-access.md).
   *
   * It ends the CLOUDFLARE ACCESS session, and that is the whole point. Access
   * is the only thing standing between the public Mall and this workspace, and
   * `authSession` re-mints an app session from any valid Access identity — so a
   * lock that left Access alone would clear the screen, navigate, and be
   * instantly logged back in, which is a no-op that looks broken.
   *
   * The app session is deliberately KEPT, so when the same operator returns and
   * completes their OTP they are straight back in the workspace with no password
   * step; only the sign-out destroys that session. The step-up proof is revoked
   * either way, so a terminal left unattended cannot change users, roles or
   * passwords without a fresh password.
   */
  const lock = async (options?: { idle?: boolean }) => {
    const idle = Boolean(options?.idle);
    const token = localStorage.getItem('idofera_session_token') || sessionStorage.getItem('idofera_session_token');
    const headers: Record<string, string> = {};
    if (token) {
      headers['authorization'] = `Bearer ${token}`;
      headers['x-session-token'] = token;
    }
    // Read the Access logout URL FIRST. Ending Access is what makes this a lock
    // rather than a screen wipe, and it must happen even if the step-up call
    // below fails — so it is resolved before the navigation is committed.
    const accessUrl = await accessLogoutUrl();
    try {
      await fetch('/api/auth/lock', { method: 'POST', credentials: 'include', headers });
    } catch { /* Best effort: the local state and the Access logout below still apply. */ }
    clearLocalSession();
    // Straight to the Mall. Lock and sign-out both return to the storefront now;
    // the difference is that sign-out also destroys the app session, so coming
    // back after a lock needs only the OTP, while a sign-out starts clean.
    window.location.replace(accessUrl || '/');
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
          // SSO never provisions one (docs/staff-access.md): persist the email
          // and stay on the staff route — StaffApp renders the "confirmed but
          // not provisioned" notice instead of the sign-in form.
          persistSsoEmail(accessEmail);
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
        const { user, entranceAllowed, accessEmail } = await response.json();
        // An Access-confirmed person without a roster account stays on the
        // staff route (the AccessNotice owns that screen, not the storefront).
        // A session the server has stopped accepting (idle expiry) is a real
        // lock, so route it through `lock()` — which also ends the Access
        // session. Barely navigating to /labs would NOT work: `authSession`
        // re-mints from the still-valid Access identity and puts the operator
        // straight back into the workspace.
        if (active && !user && !entranceAllowed && !accessEmail) {
          await lock();
        }
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

  /**
   * Idle auto-lock with a one-minute warning (docs/staff-access.md).
   *
   * Only runs while a workspace is actually open. The server enforces the same
   * 30-minute window independently, so this is the *visible* half: it warns, then
   * locks, instead of letting the operator discover the expiry from a failed save.
   */
  useEffect(() => {
    if (!currentUser) return;
    let warnTimer: number | undefined;
    let lockTimer: number | undefined;
    // The warning is a single toast; the lock itself is what changes the screen.
    const arm = () => {
      window.clearTimeout(warnTimer);
      window.clearTimeout(lockTimer);
      warnTimer = window.setTimeout(() => {
        showToast({
          title: 'Still There?',
          message: 'The workspace will lock in one minute. Move the mouse or press any key to stay signed in.',
          type: 'warning',
        });
      }, Math.max(IDLE_LOCK_MS - IDLE_WARNING_MS, 0));
      lockTimer = window.setTimeout(() => { void lock({ idle: true }); }, IDLE_LOCK_MS);
    };
    // `capture` so a scroll inside a nested panel still counts as activity, and
    // so the reset happens before any handler can stop propagation.
    const onActivity = () => arm();
    const events = ['pointerdown', 'pointermove', 'keydown', 'wheel', 'touchstart', 'focus'] as const;
    for (const event of events) window.addEventListener(event, onActivity, { capture: true, passive: true });
    arm();
    return () => {
      window.clearTimeout(warnTimer);
      window.clearTimeout(lockTimer);
      for (const event of events) window.removeEventListener(event, onActivity, { capture: true });
    };
    // `lock` is stable for the lifetime of a signed-in session; re-arming only on
    // the user identity keeps activity from tearing down the timers on every render.
  }, [currentUser?.id, showToast]);

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
    // Both must be read BEFORE the session is revoked: /api/auth/access-logout-url
    // is an authenticated-free endpoint, but reading it first keeps the ordering
    // obvious and lets a failure here still fall back to the Mall.
    const accessUrl = await accessLogoutUrl();
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
    clearLocalSession();
    showToast({
      title: 'Signed Out',
      message: serverConfirmed
        ? 'You have been safely signed out of your local workspace.'
        : 'Signed out on this device. The server could not confirm sign-out; it will be revoked when the session expires.',
      type: serverConfirmed ? 'info' : 'warning',
    });
    // Sign-out is incomplete while Access still holds its own session: a 3-second
    // cart hold would walk straight back in with no OTP. Ending the Access
    // session requires a full-page navigation to the team domain, which also
    // returns the operator to the Mall entrance. Without a gate (local
    // development) there is nothing to end, so go to the Mall directly.
    window.location.replace(accessUrl || '/');
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
        ssoUnregistered,
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
        lock,
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
