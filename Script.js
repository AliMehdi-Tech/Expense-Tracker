'use strict';

import { supabase, supabaseConfigError } from './supabaseClient.js';
import Swal from 'sweetalert2';

const STORAGE_KEY = 'expenseTrackerData';
const STORAGE_SCHEMA_VERSION = 1;
const MIGRATION_STATE_PREFIX = 'expenseTrackerMigration:';
const TITLE_MAX_LENGTH = 60;
const NOTES_MAX_LENGTH = 200;
const TOAST_DURATION = 4200;
const MAX_REASONABLE_AMOUNT = 100000000;
const SESSION_INIT_TIMEOUT_MS = 8000;
const CLOUD_LOAD_TIMEOUT_MS = 8000;
const CLOUD_MUTATION_TIMEOUT_MS = 10000;

const CATEGORY_OPTIONS = ['Food', 'Transport', 'Shopping', 'Bills', 'Entertainment', 'Health', 'Education', 'Travel', 'Other'];
const PAYMENT_METHOD_OPTIONS = ['Cash', 'Debit Card', 'Credit Card', 'Bank Transfer', 'Digital Wallet'];

const CATEGORY_COLOR_VARS = {
  Food: '--color-cat-food',
  Transport: '--color-cat-transport',
  Shopping: '--color-cat-shopping',
  Bills: '--color-cat-bills',
  Entertainment: '--color-cat-entertainment',
  Health: '--color-cat-health',
  Education: '--color-cat-education',
  Travel: '--color-cat-travel',
  Other: '--color-cat-other'
};

const EDIT_ICON_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="M14.5 5.5l4 4L8 20H4v-4z"/><path d="M13 7l4 4"/></svg>';
const DELETE_ICON_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="M5 7h14"/><path d="M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/><path d="M7 7l1 12a2 2 0 0 0 2 2h4a2 2 0 0 0 2-2l1-12"/></svg>';
const CALENDAR_ICON_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3.5" y="5" width="17" height="15" rx="2"/><path d="M3.5 9.5h17"/><path d="M8 3v3M16 3v3"/></svg>';
const CARD_ICON_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2.5" y="5.5" width="19" height="13" rx="2"/><path d="M2.5 10h19"/></svg>';
const CHECK_ICON_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 13l4 4L19 7"/></svg>';
const ALERT_ICON_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 8v5"/><path d="M12 16h.01"/></svg>';

const TOAST_ICONS = {
  success: CHECK_ICON_SVG,
  error: ALERT_ICON_SVG,
  warning: ALERT_ICON_SVG
};

const state = {
  expenses: [],
  user: null,
  expenseUserId: null,
  expenseLoadingUserId: null,
  editingId: null,
  pendingAction: null,
  mutationBusy: false,
  migrationBusy: false,
  cloudLoadError: null,
  filters: {
    search: '',
    category: 'all',
    paymentMethod: 'all',
    month: '',
    minAmount: '',
    maxAmount: ''
  },
  sortBy: 'newest'
};

const ROUTES = {
  login: '#login',
  dashboard: '#dashboard',
  expenses: '#expenses',
  overview: '#overview'
};

const dom = {};
let sessionRequestPromise = null;
let sessionGeneration = 0;
let authInitialized = false;

function getRoute() {
  return Object.values(ROUTES).includes(window.location.hash) ? window.location.hash : ROUTES.login;
}

function getAuthRoute() {
  return getRoute() === ROUTES.login ? ROUTES.login : ROUTES.dashboard;
}

function replaceRoute(route) {
  const nextUrl = `${window.location.pathname}${window.location.search}${route}`;
  window.history.replaceState({ route }, '', nextUrl);
}

function isCurrentSession(generation, userId = null) {
  return generation === sessionGeneration && (!userId || state.user?.id === userId);
}

function getSessionErrorMessage(error) {
  const message = String(error?.message || '').toLowerCase();
  if (message.includes('timed out') || message.includes('network') || message.includes('fetch')) {
    return 'We could not reach the authentication service. Check your connection and try again.';
  }
  if (message.includes('jwt') || message.includes('auth') || error?.status === 401 || error?.statusCode === 401) {
    return 'Your session could not be restored. Please sign in again.';
  }
  return 'We could not restore your session. Please try again.';
}

function showSessionRecovery(message) {
  setAuthStatus(message, 'error');
  dom.authRecoveryActions.hidden = false;
}

function clearSessionRecovery() {
  dom.authRecoveryActions.hidden = true;
}

function invalidateSessionState() {
  sessionGeneration += 1;
  return sessionGeneration;
}

function getSessionWithTimeout() {
  if (sessionRequestPromise) return sessionRequestPromise;
  sessionRequestPromise = new Promise((resolve, reject) => {
    let settled = false;
    const timeoutId = window.setTimeout(() => {
      if (settled) return;
      settled = true;
      reject(new Error('Supabase session initialization timed out.'));
    }, SESSION_INIT_TIMEOUT_MS);
    supabase.auth.getSession()
      .then(({ data, error }) => {
        if (settled) return;
        settled = true;
        window.clearTimeout(timeoutId);
        if (error) reject(error);
        else resolve(data?.session || null);
      })
      .catch((error) => {
        if (settled) return;
        settled = true;
        window.clearTimeout(timeoutId);
        reject(error);
      });
  }).finally(() => {
    sessionRequestPromise = null;
  });
  return sessionRequestPromise;
}

function clearSensitiveClientState(clearStoredData = true) {
  const migrationStateKey = getMigrationStateKey();
  state.user = null;
  state.expenses = [];
  state.expenseUserId = null;
  state.expenseLoadingUserId = null;
  state.editingId = null;
  state.cloudLoadError = null;
  dom.loginPassword.value = '';
  dom.registerPassword.value = '';
  dom.registerPasswordConfirm.value = '';
  if (clearStoredData) {
    try {
      window.localStorage.removeItem(STORAGE_KEY);
      window.localStorage.removeItem(migrationStateKey);
    } catch (error) {
      console.warn('Could not clear local expense state.', error);
    }
  }
}

function setLoading(isLoading, message = 'Working...') {
  dom.appLoading.hidden = !isLoading;
  dom.loadingMessage.textContent = message;
}

function setAuthStatus(message, type = '') {
  dom.authStatus.textContent = message;
  dom.authStatus.className = `auth-status${type ? ` is-${type}` : ''}`;
  if (!type) clearSessionRecovery();
}

function normalizeAuthError(error) {
  const message = String(error?.message || '').toLowerCase();
  if (message.includes('invalid login credentials')) return 'The email or password is incorrect.';
  if (message.includes('email not confirmed')) return 'Please verify your email address before logging in.';
  if (message.includes('already registered') || message.includes('user already')) return 'An account with this email already exists.';
  if (message.includes('rate limit')) return 'Too many attempts right now. Please wait a moment and try again.';
  if (message.includes('password')) return 'Use a password with at least 8 characters, including a letter and a number.';
  if (message.includes('network') || message.includes('fetch')) return 'The service is unavailable. Check your connection and try again.';
  return 'We could not complete that request. Please try again.';
}

function getAuthErrorMessage(error) {
  console.error('[Supabase Auth] Request failed.', {
    status: error?.status || error?.statusCode || null,
    code: error?.code || null,
    name: error?.name || null
  });
  return normalizeAuthError(error);
}

function showAuthAlert(options) {
  return Swal.fire({
    ...options,
    customClass: {
      popup: 'saas-alert',
      confirmButton: 'saas-alert-confirm',
      cancelButton: 'saas-alert-cancel'
    },
    buttonsStyling: false,
    focusConfirm: true
  });
}

function isValidEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function validateAuthCredentials({ email, password, confirmation = '', enforcePasswordPolicy = false }) {
  const errors = {};
  if (!email) errors.email = 'Enter your email address.';
  else if (!isValidEmail(email)) errors.email = 'Enter a valid email address.';
  if (!password) errors.password = 'Enter your password.';
  else if (enforcePasswordPolicy && (password.length < 8 || !/[A-Za-z]/.test(password) || !/[0-9]/.test(password))) errors.password = 'Use at least 8 characters, including a letter and a number.';
  if (confirmation !== '' && password !== confirmation) errors.confirmation = 'Passwords do not match.';
  return errors;
}

function clearAuthErrors() {
  ['loginEmailError', 'loginPasswordError', 'registerEmailError', 'registerPasswordError', 'registerPasswordConfirmError'].forEach((id) => {
    const element = document.getElementById(id);
    element.textContent = '';
  });
}

function showAuthErrors(errors, mode) {
  clearAuthErrors();
  if (errors.email) document.getElementById(`${mode}EmailError`).textContent = errors.email;
  if (errors.password) document.getElementById(`${mode}PasswordError`).textContent = errors.password;
  if (errors.confirmation) document.getElementById('registerPasswordConfirmError').textContent = errors.confirmation;
}

function clearLoginCredentials() {
  dom.loginEmail.value = '';
  dom.loginPassword.value = '';
}

function setAuthMode(mode, { focus = false } = {}) {
  const register = mode === 'register';
  dom.loginPanel.hidden = register;
  dom.registerPanel.hidden = !register;
  dom.loginSwitch.hidden = register;
  dom.registerSwitch.hidden = !register;
  dom.authHeading.textContent = register ? 'Create Account' : 'Login';
  setAuthStatus('');
  clearAuthErrors();
  if (!register) clearLoginCredentials();
  if (focus) (register ? dom.registerEmail : dom.loginEmail).focus();
}

function setCloudStatus(available) {
  if (!dom.cloudStatus) return;
  dom.cloudStatus.classList.toggle('is-unavailable', !available);
  dom.cloudStatus.querySelector('i')?.setAttribute('aria-hidden', 'true');
  dom.cloudStatus.lastChild.textContent = available ? ' Secure cloud workspace' : ' Cloud sync unavailable';
}

function setAuthenticatedView(user) {
  setCloudStatus(Boolean(supabase));
  const preserveBootState = document.body.classList.contains('route-checking');
  state.user = user;
  state.cloudLoadError = null;
  clearSessionRecovery();
  if (!preserveBootState) document.body.classList.remove('route-checking');
  document.body.classList.remove('auth-active');
  dom.authShell.hidden = true;
  dom.mainContent.hidden = false;
  dom.authActions.hidden = false;
  dom.userEmail.textContent = user.email || 'Signed in';
  dom.userEmail.title = user.email || '';
  dom.appLoading.hidden = true;
}

function setUnauthenticatedView() {
  setCloudStatus(Boolean(supabase));
  const preserveBootState = document.body.classList.contains('route-checking');
  state.user = null;
  clearLoginCredentials();
  if (!preserveBootState) document.body.classList.remove('route-checking');
  document.body.classList.add('auth-active');
  state.expenses = [];
  state.expenseUserId = null;
  state.expenseLoadingUserId = null;
  state.editingId = null;
  state.cloudLoadError = null;
  dom.expenseList.innerHTML = '';
  dom.authActions.hidden = true;
  dom.mainContent.hidden = true;
  dom.authShell.hidden = false;
  dom.userEmail.textContent = '';
  dom.migrationPanel.hidden = true;
  resetForm();
  setAuthMode('login');
  dom.appLoading.hidden = true;
}

async function applyAuthSession(session, generation = sessionGeneration) {
  if (!isCurrentSession(generation)) return false;
  if (!session?.user) {
    setUnauthenticatedView();
    return true;
  }
  if (state.expenseLoadingUserId === session.user.id) return true;
  if (state.expenseUserId === session.user.id) {
    setAuthenticatedView(session.user);
    refreshMigrationPrompt();
    return true;
  }
  state.expenses = [];
  state.expenseUserId = null;
  state.expenseLoadingUserId = session.user.id;
  setAuthenticatedView(session.user);
  resetForm();
  renderAll();
  try {
    await loadExpensesFromCloud(session.user.id, generation);
  } finally {
    if (state.expenseLoadingUserId === session.user.id) state.expenseLoadingUserId = null;
  }
  if (!isCurrentSession(generation, session.user.id)) return false;
  refreshMigrationPrompt();
  return true;
}

async function handleLogin(event) {
  event.preventDefault();
  const email = dom.loginEmail.value.trim().toLowerCase();
  const password = dom.loginPassword.value;
  const errors = validateAuthCredentials({ email, password });
  showAuthErrors(errors, 'login');
  if (Object.keys(errors).length) return;
  setAuthBusy(true, 'login');
  setAuthStatus('Signing you in...');
  try {
    const { data, error } = await withCloudTimeout(() => supabase.auth.signInWithPassword({ email, password }), 'Sign-in timed out.');
    if (error) throw error;
    dom.loginPassword.value = '';
    replaceRoute(ROUTES.dashboard);
    await applyAuthSession(data.session, sessionGeneration);
    void showAuthAlert({ icon: 'success', title: 'Welcome back', text: 'Your expense workspace is ready.', timer: 1800, showConfirmButton: false });
  } catch (error) {
    const message = getAuthErrorMessage(error);
    setAuthStatus(message, 'error');
    void showAuthAlert({ icon: 'error', title: 'Sign-in failed', text: message, confirmButtonText: 'Try again' });
  } finally {
    setAuthBusy(false, 'login');
  }
}

async function handleRegistration(event) {
  event.preventDefault();
  const email = dom.registerEmail.value.trim().toLowerCase();
  const password = dom.registerPassword.value;
  const confirmation = dom.registerPasswordConfirm.value;
  const errors = validateAuthCredentials({ email, password, confirmation, enforcePasswordPolicy: true });
  showAuthErrors(errors, 'register');
  if (Object.keys(errors).length) return;
  setAuthBusy(true, 'register');
  setAuthStatus('Creating your account...');
  try {
    const { data, error } = await withCloudTimeout(() => supabase.auth.signUp({
      email,
      password,
      options: {
        emailRedirectTo: window.location.origin
      }
    }), 'Account creation timed out.');
    if (error) throw error;
    dom.registerPassword.value = '';
    dom.registerPasswordConfirm.value = '';
    if (data.session) {
      replaceRoute(ROUTES.dashboard);
      await applyAuthSession(data.session, sessionGeneration);
      void showAuthAlert({ icon: 'success', title: 'Account created', text: 'Your expense workspace is ready.', timer: 1800, showConfirmButton: false });
    } else {
      replaceRoute(ROUTES.login);
      setAuthMode('login');
      setAuthStatus('Account created successfully. Check your email to verify your account.', 'success');
      void showAuthAlert({ icon: 'success', title: 'Account created', text: 'Check your email to verify your account, then sign in.', confirmButtonText: 'Continue to login' });
    }
  } catch (error) {
    const message = getAuthErrorMessage(error);
    setAuthStatus(message, 'error');
    void showAuthAlert({ icon: 'error', title: 'Account creation failed', text: message, confirmButtonText: 'Try again' });
  } finally {
    setAuthBusy(false, 'register');
  }
}

function setAuthBusy(isBusy, mode) {
  const submit = mode === 'login' ? dom.loginSubmit : dom.registerSubmit;
  submit.disabled = isBusy;
  submit.textContent = isBusy ? (mode === 'login' ? 'Signing in...' : 'Creating Account...') : (mode === 'login' ? 'Log in' : 'Create Account');
}

async function handleLogout() {
  const confirmation = await showAuthAlert({
    icon: 'question',
    title: 'Sign out of Expense Tracker?',
    text: 'Your cloud data will remain safely stored in your account.',
    showCancelButton: true,
    confirmButtonText: 'Sign out',
    cancelButtonText: 'Cancel'
  });
  if (!confirmation.isConfirmed) return;
  dom.logoutBtn.disabled = true;
  dom.logoutBtn.textContent = 'Logging out...';
  setLoading(true, 'Signing you out...');
  try {
    const { error } = await withCloudTimeout(() => supabase.auth.signOut(), 'Sign-out timed out.');
    if (error) throw error;
    clearSensitiveClientState();
    setUnauthenticatedView();
    replaceRoute(ROUTES.login);
    void showAuthAlert({ icon: 'success', title: 'Signed out', text: 'Your private workspace is protected.', timer: 1800, showConfirmButton: false });
  } catch (error) {
    const message = getAuthErrorMessage(error);
    showToast(message, 'error');
    void showAuthAlert({ icon: 'error', title: 'Sign out failed', text: message, confirmButtonText: 'Close' });
  } finally {
    dom.logoutBtn.disabled = false;
    dom.logoutBtn.textContent = 'Log out';
    setLoading(false);
  }
}

async function initializeAuthentication() {
  if (!supabase) {
    setUnauthenticatedView();
    setAuthStatus(supabaseConfigError, 'error');
    dom.loginSubmit.disabled = true;
    dom.registerSubmit.disabled = true;
    document.body.classList.remove('route-checking');
    document.documentElement.classList.remove('booting');
    document.getElementById('bootScreen')?.remove();
    return;
  }
  if (!authInitialized) {
    authInitialized = true;
    supabase.auth.onAuthStateChange((event, session) => {
      if (event === 'INITIAL_SESSION' || event === 'SIGNED_IN') return;
      const nextGeneration = invalidateSessionState();
      if (session) {
        if (getAuthRoute() === ROUTES.login) replaceRoute(ROUTES.dashboard);
        void applyAuthSession(session, nextGeneration);
      } else {
        clearSensitiveClientState(false);
        replaceRoute(ROUTES.login);
        void applyAuthSession(null, nextGeneration);
      }
    });
  }
  const generation = invalidateSessionState();
  setLoading(true, 'Restoring your session...');
  try {
    const session = await getSessionWithTimeout();
    if (!isCurrentSession(generation)) return;
    if (session) {
      if (getAuthRoute() === ROUTES.login) replaceRoute(ROUTES.dashboard);
      await applyAuthSession(session, generation);
    } else {
      replaceRoute(ROUTES.login);
      await applyAuthSession(null, generation);
    }
  } catch (error) {
    console.error('[Supabase Auth] Session initialization failed.', { name: error?.name || 'Error' });
    if (!isCurrentSession(generation)) return;
    setUnauthenticatedView();
    replaceRoute(ROUTES.login);
    showSessionRecovery(getSessionErrorMessage(error));
  } finally {
    if (isCurrentSession(generation)) {
      setLoading(false);
      document.body.classList.remove('route-checking');
      document.documentElement.classList.remove('booting');
      document.getElementById('bootScreen')?.remove();
    }
  }
}

async function enforceAuthRoute() {
  if (!supabase) return;
  const generation = invalidateSessionState();
  document.body.classList.add('route-checking');
  setLoading(true, 'Verifying your session...');
  try {
    const session = await getSessionWithTimeout();
    if (!isCurrentSession(generation)) return;
    if (session && getAuthRoute() === ROUTES.login) {
      replaceRoute(ROUTES.dashboard);
      await applyAuthSession(session, generation);
    } else if (!session && getAuthRoute() !== ROUTES.login) {
      replaceRoute(ROUTES.login);
      await applyAuthSession(null, generation);
    }
  } catch (error) {
    console.error('[Supabase Auth] Route session check failed.', { name: error?.name || 'Error' });
    if (!isCurrentSession(generation)) return;
    setUnauthenticatedView();
    replaceRoute(ROUTES.login);
    showSessionRecovery(getSessionErrorMessage(error));
  } finally {
    if (isCurrentSession(generation)) {
      document.body.classList.remove('route-checking');
      setLoading(false);
    }
  }
}

function generateId() {
  if (window.crypto && typeof window.crypto.randomUUID === 'function') {
    return window.crypto.randomUUID();
  }
  return `exp_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

function getTodayDateString() {
  const now = new Date();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${now.getFullYear()}-${month}-${day}`;
}

function parseLocalDate(dateString) {
  if (typeof dateString !== 'string') return null;
  const parts = dateString.split('-').map(Number);
  if (parts.length !== 3 || parts.some((part) => Number.isNaN(part))) return null;
  const [year, month, day] = parts;
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day) || month < 1 || month > 12 || day < 1 || day > 31) return null;
  const date = new Date(year, month - 1, day);
  if (Number.isNaN(date.getTime())) return null;
  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) return null;
  return date;
}

function formatDateDisplay(dateString) {
  const date = parseLocalDate(dateString);
  if (!date) return dateString;
  return date.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
}

function formatCurrency(amount) {
  const value = Number(amount) || 0;
  const formatted = value.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
  return `PKR ${formatted}`;
}

function debounce(fn, delay) {
  let timeoutId;
  return function debounced(...args) {
    clearTimeout(timeoutId);
    timeoutId = setTimeout(() => fn.apply(this, args), delay);
  };
}

function isValidStoredExpense(item) {
  return Boolean(
    item &&
    typeof item === 'object' &&
    typeof item.id === 'string' &&
    typeof item.title === 'string' &&
    item.title.trim().length > 0 &&
    typeof item.amount === 'number' &&
    Number.isFinite(item.amount) &&
    item.amount > 0 &&
    typeof item.category === 'string' &&
    typeof item.date === 'string' &&
    typeof item.paymentMethod === 'string'
  );
}

function normalizeStoredExpense(item) {
  return {
    id: item.id,
    title: item.title.trim().slice(0, TITLE_MAX_LENGTH),
    amount: item.amount,
    category: item.category,
    date: parseLocalDate(item.date) ? item.date : getTodayDateString(),
    paymentMethod: item.paymentMethod,
    notes: typeof item.notes === 'string' ? item.notes.slice(0, NOTES_MAX_LENGTH) : '',
    createdAt: typeof item.createdAt === 'string' ? item.createdAt : new Date().toISOString()
  };
}

function normalizeCloudExpense(item) {
  return {
    id: String(item.id),
    title: String(item.title).trim().slice(0, TITLE_MAX_LENGTH),
    amount: Number(item.amount),
    category: item.category,
    date: parseLocalDate(String(item.date)) ? String(item.date) : getTodayDateString(),
    paymentMethod: PAYMENT_METHOD_OPTIONS.includes(item.payment_method) ? item.payment_method : 'Cash',
    notes: typeof item.notes === 'string' ? item.notes.slice(0, NOTES_MAX_LENGTH) : '',
    createdAt: typeof item.created_at === 'string' ? item.created_at : new Date().toISOString()
  };
}

function databaseErrorMessage(error, action = 'save') {
  const message = String(error?.message || '').toLowerCase();
  if (message.includes('jwt') || message.includes('auth') || error?.code === '401') return 'Your session has expired. Please log in again.';
  if (message.includes('network') || message.includes('fetch')) return 'The service is unavailable. Check your connection and try again.';
  if (message.includes('row-level security') || error?.code === '42501') return 'You do not have permission to perform that action.';
  const messages = {
    load: 'We could not load your expenses. Your cloud data was not changed. Please try again.',
    save: 'We could not save your expense. Please try again.',
    update: 'We could not update that expense. Please try again.',
    delete: 'We could not delete that expense. Please try again.',
    clear: 'We could not clear your expenses. Please try again.',
  };
  return messages[action] || messages.save;
}

function isSessionExpiredError(error) {
  const message = String(error?.message || '').toLowerCase();
  return message.includes('jwt') || message.includes('session') || message.includes('auth') || error?.code === '401' || error?.status === 401 || error?.statusCode === 401;
}

function handleSessionExpired() {
  invalidateSessionState();
  clearSensitiveClientState(false);
  setUnauthenticatedView();
  replaceRoute(ROUTES.login);
  showSessionRecovery('Your session expired. Please sign in again.');
  setLoading(false);
}

function handleCloudError(error) {
  if (isSessionExpiredError(error)) {
    handleSessionExpired();
    return;
  }
  showToast(databaseErrorMessage(error), 'error');
}

function withCloudTimeout(request, timeoutMessage = 'The request timed out.') {
  return new Promise((resolve, reject) => {
    let settled = false;
    const timeoutId = window.setTimeout(() => {
      if (settled) return;
      settled = true;
      const error = new Error(timeoutMessage);
      error.code = 'CLIENT_TIMEOUT';
      reject(error);
    }, CLOUD_MUTATION_TIMEOUT_MS);
    Promise.resolve()
      .then(request)
      .then((result) => {
        if (settled) return;
        settled = true;
        window.clearTimeout(timeoutId);
        resolve(result);
      })
      .catch((error) => {
        if (settled) return;
        settled = true;
        window.clearTimeout(timeoutId);
        reject(error);
      });
  });
}

async function reconcileCloudStateAfterTimeout() {
  if (!state.user || !supabase) return false;
  const generation = sessionGeneration;
  return loadExpensesFromCloud(state.user.id, generation);
}

async function loadExpensesFromCloud(userId, generation = sessionGeneration) {
  if (!supabase || !isCurrentSession(generation, userId)) return false;
  setLoading(true, 'Loading your expenses...');
  try {
    const query = supabase
      .from('expenses')
      .select('id, user_id, title, amount, category, payment_method, date, notes, created_at, updated_at')
      .eq('user_id', userId)
      .order('date', { ascending: false })
      .order('created_at', { ascending: false });

    const timeout = new Promise((resolve) => {
      window.setTimeout(() => resolve({
        data: null,
        error: Object.assign(new Error('Expense loading timed out.'), { code: 'CLIENT_TIMEOUT' })
      }), CLOUD_LOAD_TIMEOUT_MS);
    });

    const { data, error } = await Promise.race([query, timeout]);

    if (error) {
      if (!isCurrentSession(generation, userId)) return false;
      state.cloudLoadError = error;
      renderAll();
      if (error.code === 'CLIENT_TIMEOUT') {
        showToast('Loading your expenses took too long. Your cloud data was not changed. Please try again.', 'warning');
      } else {
        showToast(databaseErrorMessage(error, 'load'), 'error');
      }
      return false;
    }

    if (!isCurrentSession(generation, userId)) return false;

    state.expenses = Array.isArray(data)
      ? data.filter((item) => item.user_id === userId).map(normalizeCloudExpense).filter((expense) => Number.isFinite(expense.amount))
      : [];
    state.expenseUserId = userId;
    state.cloudLoadError = null;
    renderAll();
    return true;
  } catch (error) {
    console.error('[Supabase Data] Expense loading failed.', {
      name: error?.name || 'Error',
      message: error?.message || 'Unknown data loading error'
    });
    if (!isCurrentSession(generation, userId)) return false;
    state.cloudLoadError = error;
    renderAll();
    showToast(databaseErrorMessage(error, 'load'), 'error');
    return false;
  } finally {
    setLoading(false);
  }
}

async function addExpense(payload) {
  if (!supabase || !state.user) return null;
  try {
    const { data, error } = await withCloudTimeout(() => supabase.from('expenses').insert({
      user_id: state.user.id,
      title: payload.title,
      amount: payload.amount,
      category: payload.category,
      date: payload.date,
      payment_method: payload.paymentMethod,
      notes: payload.notes
    }).select('id, user_id, title, amount, category, payment_method, date, notes, created_at, updated_at').single(), 'Saving the expense timed out.');
    if (error) throw error;
    const expense = normalizeCloudExpense(data);
    state.expenses.unshift(expense);
    return expense;
  } catch (error) {
    if (error?.code === 'CLIENT_TIMEOUT') {
      await reconcileCloudStateAfterTimeout();
      showToast('The save request took too long. Your cloud data was refreshed to confirm the result.', 'warning');
    } else {
      handleCloudError(error);
    }
    return null;
  }
}

async function updateExpenseById(id, payload) {
  if (!supabase || !state.user) return null;
  try {
    const { data, error } = await withCloudTimeout(() => supabase.from('expenses').update({
      title: payload.title,
      amount: payload.amount,
      category: payload.category,
      date: payload.date,
      payment_method: payload.paymentMethod,
      notes: payload.notes
    }).eq('id', id).eq('user_id', state.user.id)
      .select('id, user_id, title, amount, category, payment_method, date, notes, created_at, updated_at').single(), 'Updating the expense timed out.');
    if (error) throw error;
    const expense = normalizeCloudExpense(data);
    const index = state.expenses.findIndex((item) => item.id === id);
    if (index !== -1) state.expenses[index] = expense;
    return expense;
  } catch (error) {
    if (error?.code === 'CLIENT_TIMEOUT') {
      await reconcileCloudStateAfterTimeout();
      showToast('The update request took too long. Your cloud data was refreshed to confirm the result.', 'warning');
    } else {
      handleCloudError(error);
    }
    return null;
  }
}

async function deleteExpenseById(id) {
  if (!supabase || !state.user) return false;
  try {
    const { data, error } = await withCloudTimeout(() => supabase.from('expenses').delete().eq('id', id).eq('user_id', state.user.id).select('id'), 'Deleting the expense timed out.');
    if (error) throw error;
    if (!Array.isArray(data) || data.length !== 1) {
      await reconcileCloudStateAfterTimeout();
      showToast('The expense could not be confirmed as deleted. Your cloud data was refreshed.', 'warning');
      return false;
    }
    state.expenses = state.expenses.filter((expense) => expense.id !== id);
    return true;
  } catch (error) {
    if (error?.code === 'CLIENT_TIMEOUT') {
      await reconcileCloudStateAfterTimeout();
      showToast('The delete request took too long. Your cloud data was refreshed to confirm the result.', 'warning');
    } else {
      handleCloudError(error);
    }
    return false;
  }
}

async function clearAllExpenses() {
  if (!supabase || !state.user) return false;
  try {
    const { data, error } = await withCloudTimeout(() => supabase.from('expenses').delete().eq('user_id', state.user.id).select('id'), 'Clearing expenses timed out.');
    if (error) throw error;
    if (!Array.isArray(data)) {
      await reconcileCloudStateAfterTimeout();
      showToast('The clear request could not be confirmed. Your cloud data was refreshed.', 'warning');
      return false;
    }
    state.expenses = [];
    return true;
  } catch (error) {
    if (error?.code === 'CLIENT_TIMEOUT') {
      await reconcileCloudStateAfterTimeout();
      showToast('The clear request took too long. Your cloud data was refreshed to confirm the result.', 'warning');
    } else {
      handleCloudError(error);
    }
    return false;
  }
}

function getMigrationStateKey() {
  return state.user ? `${MIGRATION_STATE_PREFIX}${state.user.id}` : '';
}

function getMigrationState() {
  const key = getMigrationStateKey();
  if (!key) return { completed: [] };
  try {
    const parsed = JSON.parse(window.localStorage.getItem(key) || '{}');
    return { completed: Array.isArray(parsed.completed) ? parsed.completed : [] };
  } catch (error) {
    return { completed: [] };
  }
}

function saveMigrationState(stateToSave) {
  const key = getMigrationStateKey();
  if (!key) return;
  try {
    window.localStorage.setItem(key, JSON.stringify({ version: 1, completed: stateToSave.completed }));
  } catch (error) {
    showToast('Migration progress could not be saved. Your local data remains available.', 'warning');
  }
}

function getLegacyMigrationRecords() {
  let raw;
  try {
    raw = window.localStorage.getItem(STORAGE_KEY);
  } catch (error) {
    return [];
  }
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    const records = Array.isArray(parsed)
      ? parsed
      : parsed.version === STORAGE_SCHEMA_VERSION && Array.isArray(parsed.expenses)
        ? parsed.expenses
        : [];
    return records.filter(isMigrationValidExpense).map(normalizeStoredExpense);
  } catch (error) {
    return [];
  }
}

function isMigrationValidExpense(expense) {
  return isValidStoredExpense(expense) &&
    expense.title.trim().length >= 2 &&
    expense.title.trim().length <= TITLE_MAX_LENGTH &&
    expense.amount <= MAX_REASONABLE_AMOUNT &&
    Boolean(parseLocalDate(expense.date)) &&
    expense.date <= getTodayDateString() &&
    typeof expense.notes === 'string' && expense.notes.length <= NOTES_MAX_LENGTH;
}

function getLegacyInvalidRecordCount() {
  let raw;
  try {
    raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return 0;
    const parsed = JSON.parse(raw);
    const records = Array.isArray(parsed)
      ? parsed
      : parsed.version === STORAGE_SCHEMA_VERSION && Array.isArray(parsed.expenses)
        ? parsed.expenses
        : [];
    return records.filter((expense) => !isMigrationValidExpense(expense)).length;
  } catch (error) {
    return 0;
  }
}

function getMigrationFingerprint(expense) {
  return JSON.stringify([
    expense.id,
    expense.title,
    expense.amount,
    expense.category,
    expense.date,
    expense.paymentMethod,
    expense.notes,
    expense.createdAt
  ]);
}

function getMigrationExpenseId(expense) {
  const source = `${state.user?.id || 'anonymous'}|${getMigrationFingerprint(expense)}`;
  const seeds = [2166136261, 3432918353, 1013904223, 277803737];
  const hashes = seeds.map((seed, seedIndex) => {
    let hash = seed;
    for (let index = seedIndex; index < source.length; index += 4) {
      hash ^= source.charCodeAt(index);
      hash = Math.imul(hash, 16777619);
    }
    return hash >>> 0;
  });
  const hex = hashes.map((hash) => hash.toString(16).padStart(8, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-${(8 + (parseInt(hex.slice(16, 18), 16) % 4).toString(16))}${hex.slice(18, 21)}-${hex.slice(21, 33)}`;
}

function refreshMigrationPrompt() {
  const records = getLegacyMigrationRecords();
  const invalidCount = getLegacyInvalidRecordCount();
  const migrationState = getMigrationState();
  const remaining = records.filter((expense) => !migrationState.completed.includes(getMigrationFingerprint(expense)));
  dom.migrationPanel.hidden = remaining.length === 0 && invalidCount === 0;
  dom.migrationMessage.textContent = remaining.length
    ? `${remaining.length} saved expense${remaining.length === 1 ? '' : 's'} from this browser can be added to your cloud account. Nothing will be removed until migration succeeds.`
    : `${invalidCount} saved record${invalidCount === 1 ? '' : 's'} could not be migrated and remain in this browser for recovery.`;
  dom.migrateExpensesBtn.disabled = remaining.length === 0;
}

async function migrateLocalExpenses() {
  if (!supabase || !state.user || state.migrationBusy) return;
  state.migrationBusy = true;
  const userId = state.user.id;
  const records = getLegacyMigrationRecords();
  const invalidCount = getLegacyInvalidRecordCount();
  const migrationState = getMigrationState();
  const remaining = records.filter((expense) => !migrationState.completed.includes(getMigrationFingerprint(expense)));
  if (!remaining.length) {
    refreshMigrationPrompt();
    state.migrationBusy = false;
    return;
  }
  dom.migrateExpensesBtn.disabled = true;
  setLoading(true, 'Migrating your local expenses...');
  let migrated = 0;
  let failed = 0;
  try {
    for (const expense of remaining) {
      if (!isCurrentSession(sessionGeneration, userId)) break;
      const migrationId = getMigrationExpenseId(expense);
      try {
        const { data, error } = await withCloudTimeout(() => supabase.from('expenses').insert({
          id: migrationId,
          user_id: userId,
          title: expense.title,
          amount: expense.amount,
          category: expense.category,
          date: expense.date,
          payment_method: expense.paymentMethod,
          notes: expense.notes
        }).select('id, user_id, title, amount, category, payment_method, date, notes, created_at, updated_at').single(), 'Local migration timed out.');
        if (error) throw error;
        migrationState.completed.push(getMigrationFingerprint(expense));
        saveMigrationState(migrationState);
        state.expenses.unshift(normalizeCloudExpense(data));
        migrated += 1;
      } catch (error) {
        if (isSessionExpiredError(error)) {
          handleSessionExpired();
          failed += 1;
          break;
        }
        const { data: existing } = await withCloudTimeout(() => supabase.from('expenses').select('id, user_id, title, amount, category, payment_method, date, notes, created_at, updated_at').eq('id', migrationId).eq('user_id', userId).maybeSingle(), 'Migration verification timed out.').catch(() => ({ data: null }));
        if (!existing) {
          failed += 1;
          continue;
        }
        migrationState.completed.push(getMigrationFingerprint(expense));
        saveMigrationState(migrationState);
        if (!state.expenses.some((item) => item.id === migrationId)) state.expenses.unshift(normalizeCloudExpense(existing));
        migrated += 1;
      }
    }
  } finally {
    setLoading(false);
    state.migrationBusy = false;
  }
  renderAll();
  const stillPending = records.filter((expense) => !migrationState.completed.includes(getMigrationFingerprint(expense)));
  if (!failed && !stillPending.length && invalidCount === 0) {
    try {
      window.localStorage.removeItem(STORAGE_KEY);
      window.localStorage.removeItem(`${MIGRATION_STATE_PREFIX}${userId}`);
    } catch (error) {
      showToast('Migration succeeded, but the old browser copy could not be cleared.', 'warning');
    }
    dom.migrationPanel.hidden = true;
    showToast(`Migrated ${migrated} local expense${migrated === 1 ? '' : 's'} to your account.`, 'success');
    return;
  }
  dom.migrationPanel.hidden = false;
  dom.migrationMessage.textContent = `${migrated} expense${migrated === 1 ? '' : 's'} migrated. ${stillPending.length} valid record${stillPending.length === 1 ? '' : 's'} remain available for another attempt, and ${invalidCount} invalid record${invalidCount === 1 ? '' : 's'} remain recoverable.`;
  dom.migrateExpensesBtn.disabled = false;
  if (failed) showToast(`Migration incomplete: ${migrated} succeeded, ${failed} failed.`, 'warning');
}

function validateTitle(value) {
  const trimmed = value.trim();
  if (!trimmed) return 'Enter a title for this expense.';
  if (trimmed.length < 2) return 'Title must be at least 2 characters.';
  if (trimmed.length > TITLE_MAX_LENGTH) return `Title must be under ${TITLE_MAX_LENGTH} characters.`;
  return '';
}

function validateAmount(value) {
  const trimmed = value.trim();
  if (!trimmed) return 'Enter an amount.';
  const numeric = parseFloat(trimmed);
  if (Number.isNaN(numeric) || !Number.isFinite(numeric)) return 'Enter a valid numeric amount.';
  if (numeric <= 0) return 'Amount must be greater than zero.';
  if (numeric > MAX_REASONABLE_AMOUNT) return 'That amount looks too large. Check the value.';
  return '';
}

function validateCategory(value) {
  if (!value) return 'Select a category.';
  return '';
}

function validateDate(value) {
  if (!value) return 'Select a date.';
  const selected = parseLocalDate(value);
  if (!selected) return 'Enter a valid date.';
  const today = new Date();
  today.setHours(23, 59, 59, 999);
  if (selected.getTime() > today.getTime()) return "Date can't be in the future.";
  return '';
}

function validateAmountFilter(value, label) {
  if (value === '') return '';
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric < 0) return `${label} must be a valid non-negative amount.`;
  return '';
}

function getAmountFilterErrors() {
  const errors = [];
  const minError = validateAmountFilter(dom.minAmountInput.value, 'Minimum amount');
  const maxError = validateAmountFilter(dom.maxAmountInput.value, 'Maximum amount');
  if (minError) errors.push(minError);
  if (maxError) errors.push(maxError);
  if (!minError && !maxError && dom.minAmountInput.value !== '' && dom.maxAmountInput.value !== '' && Number(dom.minAmountInput.value) > Number(dom.maxAmountInput.value)) {
    errors.push('Minimum amount cannot be greater than maximum amount.');
  }
  return errors;
}

function validatePaymentMethod(value) {
  if (!value) return 'Select a payment method.';
  return '';
}

function validateNotes(value) {
  if (value.length > NOTES_MAX_LENGTH) return `Keep notes under ${NOTES_MAX_LENGTH} characters.`;
  return '';
}

const FIELD_VALIDATORS = {
  title: validateTitle,
  amount: validateAmount,
  category: validateCategory,
  date: validateDate,
  paymentMethod: validatePaymentMethod,
  notes: validateNotes
};

const FIELD_ORDER = ['title', 'amount', 'category', 'date', 'paymentMethod', 'notes'];

function getFieldInput(field) {
  return {
    title: dom.titleInput,
    amount: dom.amountInput,
    category: dom.categoryInput,
    date: dom.dateInput,
    paymentMethod: dom.paymentMethodInput,
    notes: dom.notesInput
  }[field];
}

function getFormValues() {
  return {
    title: dom.titleInput.value,
    amount: dom.amountInput.value,
    category: dom.categoryInput.value,
    date: dom.dateInput.value,
    paymentMethod: dom.paymentMethodInput.value,
    notes: dom.notesInput.value
  };
}

function validateFormValues(values) {
  const errors = {};
  FIELD_ORDER.forEach((field) => {
    const message = FIELD_VALIDATORS[field](values[field]);
    if (message) errors[field] = message;
  });
  return errors;
}

function setFieldError(field, message) {
  const input = getFieldInput(field);
  const errorEl = document.getElementById(`${field}Error`);
  if (input) {
    input.classList.add('is-invalid');
    input.setAttribute('aria-invalid', 'true');
  }
  if (errorEl) errorEl.textContent = message;
}

function clearFieldError(field) {
  const input = getFieldInput(field);
  const errorEl = document.getElementById(`${field}Error`);
  if (input) {
    input.classList.remove('is-invalid');
    input.removeAttribute('aria-invalid');
  }
  if (errorEl) errorEl.textContent = '';
}

function clearAllFieldErrors() {
  FIELD_ORDER.forEach(clearFieldError);
}

function displayFormErrors(errors) {
  FIELD_ORDER.forEach((field) => {
    if (errors[field]) {
      setFieldError(field, errors[field]);
    } else {
      clearFieldError(field);
    }
  });
}

function focusFirstInvalidField(errors) {
  const firstInvalid = FIELD_ORDER.find((field) => errors[field]);
  if (firstInvalid) getFieldInput(firstInvalid).focus();
}

function getScrollBehavior() {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth';
}

function getFilteredExpenses() {
  const { search, category, paymentMethod, month, minAmount, maxAmount } = state.filters;
  const query = search.trim().toLowerCase();
  return state.expenses.filter((expense) => {
    if (query) {
      const haystack = `${expense.title} ${expense.category} ${expense.paymentMethod} ${expense.notes}`.toLowerCase();
      if (!haystack.includes(query)) return false;
    }
    if (category !== 'all' && expense.category !== category) return false;
    if (paymentMethod !== 'all' && expense.paymentMethod !== paymentMethod) return false;
    if (month && expense.date.slice(0, 7) !== month) return false;
    if (minAmount !== '' && expense.amount < parseFloat(minAmount)) return false;
    if (maxAmount !== '' && expense.amount > parseFloat(maxAmount)) return false;
    return true;
  });
}

function getSortedExpenses(expenses) {
  const sorted = [...expenses];
  switch (state.sortBy) {
    case 'oldest':
      sorted.sort((a, b) => {
        const diff = parseLocalDate(a.date) - parseLocalDate(b.date);
        return diff !== 0 ? diff : new Date(a.createdAt) - new Date(b.createdAt);
      });
      break;
    case 'highest':
      sorted.sort((a, b) => b.amount - a.amount);
      break;
    case 'lowest':
      sorted.sort((a, b) => a.amount - b.amount);
      break;
    case 'alphabetical':
      sorted.sort((a, b) => a.title.localeCompare(b.title));
      break;
    case 'newest':
    default:
      sorted.sort((a, b) => {
        const diff = parseLocalDate(b.date) - parseLocalDate(a.date);
        return diff !== 0 ? diff : new Date(b.createdAt) - new Date(a.createdAt);
      });
  }
  return sorted;
}

function computeStatistics(expenses) {
  const total = expenses.reduce((sum, expense) => sum + expense.amount, 0);
  const now = new Date();
  const thisMonthTotal = expenses.reduce((sum, expense) => {
    const date = parseLocalDate(expense.date);
    if (date && date.getFullYear() === now.getFullYear() && date.getMonth() === now.getMonth()) {
      return sum + expense.amount;
    }
    return sum;
  }, 0);
  const average = expenses.length ? total / expenses.length : 0;
  const highest = expenses.reduce((max, expense) => Math.max(max, expense.amount), 0);
  return { total, thisMonthTotal, average, highest };
}

function renderStatistics(stats) {
  dom.statTotal.textContent = formatCurrency(stats.total);
  dom.statMonth.textContent = formatCurrency(stats.thisMonthTotal);
  dom.statAverage.textContent = formatCurrency(stats.average);
  dom.statHighest.textContent = formatCurrency(stats.highest);
}

function renderResultsMeta(visibleCount, totalCount) {
  if (totalCount === 0) {
    dom.resultsMeta.textContent = '';
    return;
  }
  dom.resultsMeta.textContent = visibleCount === totalCount
    ? `${totalCount} expense${totalCount === 1 ? '' : 's'}`
    : `Showing ${visibleCount} of ${totalCount} expenses`;
}

function createMetaItem(iconSvg, text) {
  const span = document.createElement('span');
  span.className = 'meta-item';
  const iconWrap = document.createElement('span');
  iconWrap.setAttribute('aria-hidden', 'true');
  iconWrap.innerHTML = iconSvg;
  const textEl = document.createElement('span');
  textEl.textContent = text;
  span.append(iconWrap, textEl);
  return span;
}

function createExpenseCard(expense) {
  const card = document.createElement('article');
  card.className = 'expense-card';
  card.dataset.id = expense.id;

  const main = document.createElement('div');
  main.className = 'expense-card-main';

  const badge = document.createElement('span');
  badge.className = 'category-badge';
  badge.style.setProperty('--badge-color', `var(${CATEGORY_COLOR_VARS[expense.category] || CATEGORY_COLOR_VARS.Other})`);
  badge.textContent = expense.category.charAt(0);
  badge.setAttribute('aria-hidden', 'true');

  const primary = document.createElement('div');
  primary.className = 'expense-primary';

  const topRow = document.createElement('div');
  topRow.className = 'expense-top-row';

  const titleEl = document.createElement('p');
  titleEl.className = 'expense-title';
  titleEl.textContent = expense.title;

  const amountEl = document.createElement('p');
  amountEl.className = 'expense-amount';
  amountEl.textContent = formatCurrency(expense.amount);

  topRow.append(titleEl, amountEl);

  const meta = document.createElement('div');
  meta.className = 'expense-meta';

  const categoryChip = document.createElement('span');
  categoryChip.className = 'meta-chip';
  categoryChip.style.setProperty('--chip-color', `var(${CATEGORY_COLOR_VARS[expense.category] || CATEGORY_COLOR_VARS.Other})`);
  categoryChip.textContent = expense.category;

  meta.append(categoryChip, createMetaItem(CARD_ICON_SVG, expense.paymentMethod), createMetaItem(CALENDAR_ICON_SVG, formatDateDisplay(expense.date)));

  primary.append(topRow, meta);

  if (expense.notes) {
    const notesEl = document.createElement('p');
    notesEl.className = 'expense-notes';
    notesEl.textContent = expense.notes;
    primary.appendChild(notesEl);
  }

  main.append(badge, primary);

  const side = document.createElement('div');
  side.className = 'expense-card-side';

  const actions = document.createElement('div');
  actions.className = 'expense-actions';

  const editBtn = document.createElement('button');
  editBtn.type = 'button';
  editBtn.className = 'icon-btn';
  editBtn.dataset.action = 'edit';
  editBtn.setAttribute('aria-label', `Edit ${expense.title}`);
  editBtn.innerHTML = `${EDIT_ICON_SVG}<span>Edit</span>`;

  const deleteBtn = document.createElement('button');
  deleteBtn.type = 'button';
  deleteBtn.className = 'icon-btn icon-btn-danger';
  deleteBtn.dataset.action = 'delete';
  deleteBtn.setAttribute('aria-label', `Delete ${expense.title}`);
  deleteBtn.innerHTML = `${DELETE_ICON_SVG}<span>Delete</span>`;

  actions.append(editBtn, deleteBtn);
  side.appendChild(actions);

  card.append(main, side);
  return card;
}

function updateEmptyState(hasAnyExpenses) {
  if (state.cloudLoadError) {
    dom.emptyStateTitle.textContent = 'Could not load expenses';
    dom.emptyStateMessage.textContent = 'Your cloud data was not changed. Check your connection and try loading again.';
    dom.emptyStateActionBtn.textContent = 'Try Again';
    dom.emptyStateActionBtn.dataset.mode = 'retry-load';
    return;
  }
  if (hasAnyExpenses) {
    dom.emptyStateTitle.textContent = 'No expenses match your filters';
    dom.emptyStateMessage.textContent = 'Try a different search term or reset your filters.';
    dom.emptyStateActionBtn.textContent = 'Reset Filters';
    dom.emptyStateActionBtn.dataset.mode = 'reset-filters';
  } else {
    dom.emptyStateTitle.textContent = 'No expenses yet';
    dom.emptyStateMessage.textContent = 'Add your first expense to see it here.';
    dom.emptyStateActionBtn.textContent = 'Add an Expense';
    dom.emptyStateActionBtn.dataset.mode = 'focus-form';
  }
}

function renderExpenseList(expenses) {
  dom.expenseList.innerHTML = '';
  const hasVisibleExpenses = expenses.length > 0;
  dom.expenseList.hidden = !hasVisibleExpenses;
  dom.emptyState.hidden = hasVisibleExpenses;

  if (!hasVisibleExpenses) {
    updateEmptyState(state.expenses.length > 0);
    return;
  }

  const fragment = document.createDocumentFragment();
  expenses.forEach((expense) => fragment.appendChild(createExpenseCard(expense)));
  dom.expenseList.appendChild(fragment);
}

function renderAll() {
  const filtered = getFilteredExpenses();
  const sorted = getSortedExpenses(filtered);
  renderExpenseList(sorted);
  renderStatistics(computeStatistics(state.expenses));
  renderResultsMeta(sorted.length, state.expenses.length);
  updateExportButtonState();
  renderAmountFilterErrors();
}

function renderAmountFilterErrors() {
  const errors = getAmountFilterErrors();
  const hasErrors = errors.length > 0;
  dom.minAmountInput.setAttribute('aria-invalid', String(hasErrors));
  dom.maxAmountInput.setAttribute('aria-invalid', String(hasErrors));
  dom.amountFilterError.textContent = errors[0] || '';
  dom.amountFilterError.hidden = !hasErrors;
}

function updateNotesCounter() {
  dom.notesCounter.textContent = `${dom.notesInput.value.length}/${NOTES_MAX_LENGTH}`;
}

function setFormMode(mode) {
  const isEdit = mode === 'edit';
  dom.formHeading.textContent = isEdit ? 'Edit Expense' : 'Add Expense';
  dom.submitBtn.textContent = isEdit ? 'Update Expense' : 'Add Expense';
  dom.secondaryFormBtn.textContent = isEdit ? 'Cancel Edit' : 'Reset';
  dom.formSection.classList.toggle('is-editing', isEdit);
}

function resetForm() {
  dom.form.reset();
  dom.dateInput.value = getTodayDateString();
  updateNotesCounter();
  clearAllFieldErrors();
}

function fillFormWithExpense(expense) {
  dom.titleInput.value = expense.title;
  dom.amountInput.value = String(expense.amount);
  dom.categoryInput.value = expense.category;
  dom.dateInput.value = expense.date;
  dom.paymentMethodInput.value = expense.paymentMethod;
  dom.notesInput.value = expense.notes;
  updateNotesCounter();
  clearAllFieldErrors();
}

function enterEditMode(id) {
  const expense = state.expenses.find((item) => item.id === id);
  if (!expense) return;
  state.editingId = id;
  fillFormWithExpense(expense);
  setFormMode('edit');
  dom.formSection.scrollIntoView({ behavior: getScrollBehavior(), block: 'start' });
  dom.titleInput.focus();
}

function exitEditMode() {
  state.editingId = null;
  resetForm();
  setFormMode('create');
}

function showToast(message, type = 'success') {
  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  toast.setAttribute('role', 'status');

  const icon = document.createElement('span');
  icon.className = 'toast-icon';
  icon.innerHTML = TOAST_ICONS[type] || TOAST_ICONS.success;

  const messageEl = document.createElement('span');
  messageEl.className = 'toast-message';
  messageEl.textContent = message;

  const closeBtn = document.createElement('button');
  closeBtn.type = 'button';
  closeBtn.className = 'toast-close';
  closeBtn.setAttribute('aria-label', 'Dismiss notification');
  closeBtn.innerHTML = '&times;';

  toast.append(icon, messageEl, closeBtn);
  dom.toastContainer.appendChild(toast);

  const removeToast = () => {
    toast.classList.add('toast-hide');
    setTimeout(() => toast.remove(), 220);
  };

  const timerId = setTimeout(removeToast, TOAST_DURATION);
  closeBtn.addEventListener('click', () => {
    clearTimeout(timerId);
    removeToast();
  });
}

let modalTriggerElement = null;

function setBackgroundInert(isInert) {
  [dom.mainContent, dom.pageFooter].forEach((el) => {
    if (!el) return;
    if (isInert) {
      el.setAttribute('inert', '');
    } else {
      el.removeAttribute('inert');
    }
  });
}

function openModal({ title, message, confirmLabel, onConfirm }) {
  modalTriggerElement = document.activeElement;
  dom.modalTitle.textContent = title;
  dom.modalMessage.textContent = message;
  dom.modalConfirmBtn.textContent = confirmLabel;
  state.pendingAction = onConfirm;
  dom.modalOverlay.hidden = false;
  document.body.classList.add('modal-open');
  setBackgroundInert(true);
  dom.modalCancelBtn.focus();
}

function closeModal() {
  dom.modalOverlay.hidden = true;
  state.pendingAction = null;
  document.body.classList.remove('modal-open');
  setBackgroundInert(false);
  if (modalTriggerElement && typeof modalTriggerElement.focus === 'function') {
    modalTriggerElement.focus();
  }
}

function handleModalConfirm() {
  const action = state.pendingAction;
  closeModal();
  if (action) action();
}

function trapModalFocus(event) {
  const focusable = [dom.modalCancelBtn, dom.modalConfirmBtn];
  const first = focusable[0];
  const last = focusable[focusable.length - 1];
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
  }
}

function requestDeleteExpense(id) {
  const expense = state.expenses.find((item) => item.id === id);
  if (!expense) return;
  openModal({
    title: 'Delete expense?',
    message: `This removes "${expense.title}" permanently. This can't be undone.`,
    confirmLabel: 'Delete',
    onConfirm: async () => {
      const wasEditing = state.editingId === id;
      dom.modalConfirmBtn.disabled = true;
      dom.modalConfirmBtn.textContent = 'Deleting...';
      setLoading(true, 'Deleting expense...');
      const deleted = await deleteExpenseById(id);
      setLoading(false);
      dom.modalConfirmBtn.disabled = false;
      dom.modalConfirmBtn.textContent = 'Delete';
      if (!deleted) {
        renderAll();
        return;
      }
      if (wasEditing) exitEditMode();
      renderAll();
      showToast('Expense deleted.', 'success');
    }
  });
}

function requestClearAll() {
  if (!state.expenses.length) return;
  const count = state.expenses.length;
  openModal({
    title: 'Clear all expenses?',
    message: `This removes all ${count} expense${count === 1 ? '' : 's'} permanently. This can't be undone.`,
    confirmLabel: 'Clear All',
    onConfirm: async () => {
      dom.modalConfirmBtn.disabled = true;
      dom.modalConfirmBtn.textContent = 'Clearing...';
      setLoading(true, 'Clearing your expenses...');
      const cleared = await clearAllExpenses();
      setLoading(false);
      dom.modalConfirmBtn.disabled = false;
      dom.modalConfirmBtn.textContent = 'Clear All';
      if (!cleared) {
        renderAll();
        return;
      }
      exitEditMode();
      resetFilters();
      showToast('All expenses cleared.', 'success');
    }
  });
}

function loadScript(src) {
  return new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = src;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error(`Failed to load ${src}`));
    document.head.appendChild(script);
  });
}

let pdfLibrariesPromise = null;
function ensurePdfLibraries() {
  if (window.jspdf && window.jspdf.jsPDF) return Promise.resolve();
  if (!pdfLibrariesPromise) {
    pdfLibrariesPromise = loadScript('https://cdnjs.cloudflare.com/ajax/libs/jspdf/4.2.1/jspdf.umd.min.js')
      .then(() => loadScript('https://cdnjs.cloudflare.com/ajax/libs/jspdf-autotable/5.0.8/jspdf.plugin.autotable.min.js'))
      .catch((error) => {
        pdfLibrariesPromise = null;
        throw error;
      });
  }
  return pdfLibrariesPromise;
}

function formatMonthLabel(monthValue) {
  const [year, month] = monthValue.split('-').map(Number);
  const date = new Date(year, month - 1, 1);
  return date.toLocaleDateString('en-US', { year: 'numeric', month: 'long' });
}

function describeActiveFilters() {
  const { search, category, paymentMethod, month, minAmount, maxAmount } = state.filters;
  const parts = [];
  if (search.trim()) parts.push(`Search: "${search.trim()}"`);
  if (category !== 'all') parts.push(`Category: ${category}`);
  if (paymentMethod !== 'all') parts.push(`Payment Method: ${paymentMethod}`);
  if (month) parts.push(`Month: ${formatMonthLabel(month)}`);
  if (minAmount !== '') parts.push(`Min: ${formatCurrency(parseFloat(minAmount))}`);
  if (maxAmount !== '') parts.push(`Max: ${formatCurrency(parseFloat(maxAmount))}`);
  return parts.length ? parts.join('   |   ') : 'All expenses (no filters applied)';
}

function buildReportContext() {
  const dataset = getSortedExpenses(getFilteredExpenses());
  return { dataset, stats: computeStatistics(dataset), filterDescription: describeActiveFilters() };
}

function computeCategorySummary(dataset) {
  const totals = {};
  dataset.forEach((expense) => {
    if (!totals[expense.category]) totals[expense.category] = { total: 0, count: 0 };
    totals[expense.category].total += expense.amount;
    totals[expense.category].count += 1;
  });
  return Object.keys(totals)
    .map((category) => ({ category, total: totals[category].total, count: totals[category].count }))
    .sort((a, b) => b.total - a.total);
}

function getReportingPeriod(dataset) {
  const dates = dataset.map((expense) => parseLocalDate(expense.date)).filter(Boolean);
  if (!dates.length) return '';
  const earliest = new Date(Math.min(...dates));
  const latest = new Date(Math.max(...dates));
  const format = (date) => date.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
  return earliest.getTime() === latest.getTime() ? format(earliest) : `${format(earliest)} \u2013 ${format(latest)}`;
}

function updateExportButtonState() {
  dom.exportPdfBtn.disabled = state.expenses.length === 0;
}

function setExportButtonLoading(isLoading) {
  const button = dom.exportPdfBtn;
  const label = button.querySelector('span');
  if (isLoading) {
    button.dataset.defaultLabel = label.textContent;
    label.textContent = 'Preparing...';
    button.disabled = true;
  } else {
    if (button.dataset.defaultLabel) {
      label.textContent = button.dataset.defaultLabel;
      delete button.dataset.defaultLabel;
    }
    updateExportButtonState();
  }
}

async function generatePDFReport() {
  if (!state.expenses.length) {
    showToast('Add at least one expense before exporting.', 'warning');
    return;
  }
  const { dataset, stats, filterDescription } = buildReportContext();
  if (!dataset.length) {
    showToast('No expenses match the current filters to export.', 'warning');
    return;
  }

  if (!(window.jspdf && window.jspdf.jsPDF)) {
    setExportButtonLoading(true);
    try {
      await ensurePdfLibraries();
    } catch (error) {
      setExportButtonLoading(false);
      showToast('PDF export is unavailable right now. Check your connection and try again.', 'error');
      return;
    }
    setExportButtonLoading(false);
  }
  if (!(window.jspdf && window.jspdf.jsPDF)) {
    showToast('PDF export is unavailable right now. Check your connection and try again.', 'error');
    return;
  }

  const categorySummary = computeCategorySummary(dataset);
  const reportingPeriod = getReportingPeriod(dataset);

  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ orientation: 'portrait', unit: 'pt', format: 'a4' });
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const margin = 40;
  const contentWidth = pageWidth - margin * 2;

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(20);
  doc.setTextColor(20, 26, 32);
  doc.text('Expense Tracker', margin, 50);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(11);
  doc.setTextColor(90, 100, 110);
  doc.text('Expense Report', margin, 68);

  doc.setFontSize(9);
  doc.setTextColor(120, 130, 140);
  const generatedLabel = `Generated ${new Date().toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' })}`;
  doc.text(generatedLabel, pageWidth - margin, 50, { align: 'right' });
  if (reportingPeriod) {
    doc.text(`Period: ${reportingPeriod}`, pageWidth - margin, 64, { align: 'right' });
  }

  doc.setDrawColor(14, 124, 107);
  doc.setLineWidth(1.5);
  doc.line(margin, 78, pageWidth - margin, 78);

  const summaryY = 102;
  const summaryItems = [
    ['Total Expenses', formatCurrency(stats.total)],
    ['Number of Expenses', String(dataset.length)],
    ['Average Expense', formatCurrency(stats.average)],
    ['Highest Expense', formatCurrency(stats.highest)]
  ];
  const colWidth = contentWidth / summaryItems.length;
  summaryItems.forEach(([label, value], index) => {
    const x = margin + colWidth * index;
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    doc.setTextColor(110, 120, 130);
    doc.text(label, x, summaryY);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(13);
    doc.setTextColor(20, 26, 32);
    doc.text(value, x, summaryY + 18);
  });

  doc.setFont('helvetica', 'italic');
  doc.setFontSize(8.5);
  doc.setTextColor(130, 140, 150);
  const filterLines = doc.splitTextToSize(`Filters: ${filterDescription}`, contentWidth);
  doc.text(filterLines, margin, summaryY + 38);

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11);
  doc.setTextColor(20, 26, 32);
  const categorySummaryY = summaryY + 62 + Math.max(0, filterLines.length - 1) * 11;
  doc.text('Category Summary', margin, categorySummaryY);

  doc.autoTable({
    startY: categorySummaryY + 10,
    margin: { left: margin, right: margin, bottom: 50 },
    head: [['Category', 'Transactions', 'Total']],
    body: categorySummary.map((row) => [row.category, String(row.count), formatCurrency(row.total)]),
    styles: { font: 'helvetica', fontSize: 8.5, cellPadding: 5, textColor: [45, 52, 58], lineColor: [225, 229, 228], lineWidth: 0.5 },
    headStyles: { fillColor: [14, 124, 107], textColor: [255, 255, 255], fontStyle: 'bold', fontSize: 8.5 },
    columnStyles: {
      0: { cellWidth: contentWidth * 0.5 },
      1: { cellWidth: contentWidth * 0.2, halign: 'center' },
      2: { cellWidth: contentWidth * 0.3, halign: 'right' }
    }
  });

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11);
  doc.setTextColor(20, 26, 32);
  doc.text('Transactions', margin, doc.lastAutoTable.finalY + 26);

  doc.autoTable({
    startY: doc.lastAutoTable.finalY + 36,
    margin: { left: margin, right: margin, bottom: 50 },
    head: [['Title', 'Category', 'Payment Method', 'Date', 'Amount', 'Notes']],
    body: dataset.map((expense) => [
      expense.title,
      expense.category,
      expense.paymentMethod,
      formatDateDisplay(expense.date),
      formatCurrency(expense.amount),
      expense.notes || String.fromCharCode(8212)
    ]),
    styles: { font: 'helvetica', fontSize: 9, cellPadding: 6, textColor: [45, 52, 58], lineColor: [225, 229, 228], lineWidth: 0.5, overflow: 'linebreak' },
    headStyles: { fillColor: [20, 26, 32], textColor: [255, 255, 255], fontStyle: 'bold', fontSize: 9 },
    alternateRowStyles: { fillColor: [246, 247, 246] },
    columnStyles: {
      0: { cellWidth: 105 },
      1: { cellWidth: 68 },
      2: { cellWidth: 78 },
      3: { cellWidth: 62 },
      4: { cellWidth: 65, halign: 'right' },
      5: { cellWidth: 'auto' }
    }
  });

  const totalPages = doc.internal.getNumberOfPages();
  for (let i = 1; i <= totalPages; i += 1) {
    doc.setPage(i);
    doc.setDrawColor(225, 229, 228);
    doc.setLineWidth(0.5);
    doc.line(margin, pageHeight - 36, pageWidth - margin, pageHeight - 36);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.setTextColor(140, 150, 160);
    doc.text('Expense Tracker', margin, pageHeight - 22);
    doc.text(`Page ${i} of ${totalPages}`, pageWidth - margin, pageHeight - 22, { align: 'right' });
  }

  doc.save(`expense-report-${getTodayDateString()}.pdf`);
  showToast('PDF exported.', 'success');
}

function resetFilters() {
  state.filters = { search: '', category: 'all', paymentMethod: 'all', month: '', minAmount: '', maxAmount: '' };
  state.sortBy = 'newest';
  dom.searchInput.value = '';
  dom.categoryFilter.value = 'all';
  dom.paymentFilter.value = 'all';
  dom.monthFilter.value = '';
  dom.minAmountInput.value = '';
  dom.maxAmountInput.value = '';
  dom.sortSelect.value = 'newest';
  renderAll();
}

function handleAmountInput(event) {
  let value = event.target.value.replace(/[^0-9.]/g, '');
  const firstDotIndex = value.indexOf('.');
  if (firstDotIndex !== -1) {
    value = value.slice(0, firstDotIndex + 1) + value.slice(firstDotIndex + 1).replace(/\./g, '');
  }
  const [wholePart, decimalPart] = value.split('.');
  if (decimalPart !== undefined && decimalPart.length > 2) {
    value = `${wholePart}.${decimalPart.slice(0, 2)}`;
  }
  event.target.value = value;
  clearFieldError('amount');
}

async function handleFormSubmit(event) {
  event.preventDefault();
  const values = getFormValues();
  const errors = validateFormValues(values);
  displayFormErrors(errors);
  if (Object.keys(errors).length > 0) {
    focusFirstInvalidField(errors);
    return;
  }
  if (state.mutationBusy) return;
  state.mutationBusy = true;
  const payload = {
    title: values.title.trim(),
    amount: parseFloat(values.amount),
    category: values.category,
    date: values.date,
    paymentMethod: values.paymentMethod,
    notes: values.notes.trim()
  };
  try {
    if (state.editingId) {
      dom.submitBtn.disabled = true;
      dom.submitBtn.textContent = 'Updating...';
      const updated = await updateExpenseById(state.editingId, payload);
      if (!updated) {
        renderAll();
        return;
      }
      showToast('Expense updated.', 'success');
      exitEditMode();
    } else {
      dom.submitBtn.disabled = true;
      dom.submitBtn.textContent = 'Saving...';
      const added = await addExpense(payload);
      if (!added) {
        renderAll();
        return;
      }
      showToast('Expense added.', 'success');
      resetForm();
    }
    renderAll();
  } catch (error) {
    handleCloudError(error);
  } finally {
    state.mutationBusy = false;
    dom.submitBtn.disabled = false;
    dom.submitBtn.textContent = state.editingId ? 'Update Expense' : 'Add Expense';
  }
}

function handleSecondaryFormClick() {
  if (state.editingId) {
    exitEditMode();
  } else {
    resetForm();
  }
}

function handleFilterControlsChange() {
  state.filters.category = dom.categoryFilter.value;
  state.filters.paymentMethod = dom.paymentFilter.value;
  state.filters.month = dom.monthFilter.value;
  renderAll();
}

function handleExpenseListClick(event) {
  const button = event.target.closest('button[data-action]');
  if (!button) return;
  const card = button.closest('.expense-card');
  const id = card ? card.dataset.id : null;
  if (!id) return;
  if (button.dataset.action === 'edit') enterEditMode(id);
  if (button.dataset.action === 'delete') requestDeleteExpense(id);
}

function handleEmptyStateAction() {
  const mode = dom.emptyStateActionBtn.dataset.mode;
  if (mode === 'reset-filters') {
    resetFilters();
    return;
  }
  if (mode === 'retry-load') {
    if (state.user) void loadExpensesFromCloud(state.user.id, sessionGeneration);
    return;
  }
  dom.formSection.scrollIntoView({ behavior: getScrollBehavior(), block: 'start' });
  dom.titleInput.focus();
}

function handleGlobalKeydown(event) {
  if (dom.modalOverlay.hidden) return;
  if (event.key === 'Escape') {
    closeModal();
  } else if (event.key === 'Tab') {
    trapModalFocus(event);
  }
}

function handlePasswordToggle(event) {
  const button = event.currentTarget;
  const input = document.getElementById(button.dataset.passwordTarget);
  const label = button.querySelector('span');
  const isVisible = input.type === 'text';
  input.type = isVisible ? 'password' : 'text';
  label.textContent = isVisible ? 'Show' : 'Hide';
  button.setAttribute('aria-label', isVisible ? 'Show password' : 'Hide password');
}

function cacheDom() {
  dom.pageFooter = document.querySelector('.app-footer');
  dom.cloudStatus = document.getElementById('cloudStatus');
  dom.mainContent = document.getElementById('mainContent');
  dom.authShell = document.getElementById('authShell');
  dom.authHeading = document.getElementById('authHeading');
  dom.authStatus = document.getElementById('authStatus');
  dom.authRecoveryActions = document.getElementById('authRecoveryActions');
  dom.sessionRetryBtn = document.getElementById('sessionRetryBtn');
  dom.sessionLoginBtn = document.getElementById('sessionLoginBtn');
  dom.loginPanel = document.getElementById('loginPanel');
  dom.registerPanel = document.getElementById('registerPanel');
  dom.loginSwitch = document.getElementById('loginSwitch');
  dom.registerSwitch = document.getElementById('registerSwitch');
  dom.loginEmail = document.getElementById('loginEmail');
  dom.loginPassword = document.getElementById('loginPassword');
  dom.registerEmail = document.getElementById('registerEmail');
  dom.registerPassword = document.getElementById('registerPassword');
  dom.registerPasswordConfirm = document.getElementById('registerPasswordConfirm');
  dom.loginSubmit = document.getElementById('loginSubmit');
  dom.registerSubmit = document.getElementById('registerSubmit');
  dom.authActions = document.getElementById('authActions');
  dom.userEmail = document.getElementById('userEmail');
  dom.logoutBtn = document.getElementById('logoutBtn');
  dom.appLoading = document.getElementById('appLoading');
  dom.loadingMessage = document.getElementById('loadingMessage');
  dom.form = document.getElementById('expenseForm');
  dom.formSection = document.getElementById('expenses');
  dom.formHeading = document.getElementById('formHeading');
  dom.titleInput = document.getElementById('titleInput');
  dom.amountInput = document.getElementById('amountInput');
  dom.categoryInput = document.getElementById('categoryInput');
  dom.dateInput = document.getElementById('dateInput');
  dom.paymentMethodInput = document.getElementById('paymentMethodInput');
  dom.notesInput = document.getElementById('notesInput');
  dom.notesCounter = document.getElementById('notesCounter');
  dom.submitBtn = document.getElementById('submitBtn');
  dom.secondaryFormBtn = document.getElementById('secondaryFormBtn');

  dom.searchInput = document.getElementById('searchInput');
  dom.categoryFilter = document.getElementById('categoryFilter');
  dom.paymentFilter = document.getElementById('paymentFilter');
  dom.monthFilter = document.getElementById('monthFilter');
  dom.minAmountInput = document.getElementById('minAmountInput');
  dom.maxAmountInput = document.getElementById('maxAmountInput');
  dom.amountFilterError = document.getElementById('amountFilterError');
  dom.sortSelect = document.getElementById('sortSelect');
  dom.resetFiltersBtn = document.getElementById('resetFiltersBtn');

  dom.expenseList = document.getElementById('expenseList');
  dom.emptyState = document.getElementById('emptyState');
  dom.emptyStateTitle = document.getElementById('emptyStateTitle');
  dom.emptyStateMessage = document.getElementById('emptyStateMessage');
  dom.emptyStateActionBtn = document.getElementById('emptyStateActionBtn');
  dom.resultsMeta = document.getElementById('resultsMeta');
  dom.migrationPanel = document.getElementById('migrationPanel');
  dom.migrationMessage = document.getElementById('migrationMessage');
  dom.migrateExpensesBtn = document.getElementById('migrateExpensesBtn');

  dom.statTotal = document.getElementById('statTotal');
  dom.statMonth = document.getElementById('statMonth');
  dom.statAverage = document.getElementById('statAverage');
  dom.statHighest = document.getElementById('statHighest');

  dom.exportPdfBtn = document.getElementById('exportPdfBtn');
  dom.clearAllBtn = document.getElementById('clearAllBtn');

  dom.toastContainer = document.getElementById('toastContainer');

  dom.modalOverlay = document.getElementById('confirmModal');
  dom.modalTitle = document.getElementById('modalTitle');
  dom.modalMessage = document.getElementById('modalMessage');
  dom.modalCancelBtn = document.getElementById('modalCancelBtn');
  dom.modalConfirmBtn = document.getElementById('modalConfirmBtn');
}

function attachEventListeners() {
  document.querySelectorAll('.auth-switch-btn').forEach((button) => {
    button.addEventListener('click', () => setAuthMode(button.dataset.authMode, { focus: true }));
  });
  dom.loginPanel.addEventListener('submit', handleLogin);
  dom.registerPanel.addEventListener('submit', handleRegistration);
  dom.logoutBtn.addEventListener('click', handleLogout);
  dom.sessionRetryBtn.addEventListener('click', () => { void initializeAuthentication(); });
  dom.sessionLoginBtn.addEventListener('click', () => {
    invalidateSessionState();
    clearSensitiveClientState(false);
    setUnauthenticatedView();
    replaceRoute(ROUTES.login);
  });
  document.querySelectorAll('.password-toggle').forEach((button) => {
    button.addEventListener('click', handlePasswordToggle);
  });

  dom.form.addEventListener('submit', handleFormSubmit);
  dom.secondaryFormBtn.addEventListener('click', handleSecondaryFormClick);
  dom.amountInput.addEventListener('input', handleAmountInput);
  dom.notesInput.addEventListener('input', () => {
    updateNotesCounter();
    clearFieldError('notes');
  });
  dom.titleInput.addEventListener('input', () => clearFieldError('title'));
  dom.dateInput.addEventListener('input', () => clearFieldError('date'));
  dom.categoryInput.addEventListener('change', () => clearFieldError('category'));
  dom.paymentMethodInput.addEventListener('change', () => clearFieldError('paymentMethod'));

  const debouncedSearch = debounce(() => {
    state.filters.search = dom.searchInput.value;
    renderAll();
  }, 150);
  const debouncedAmountFilter = debounce(() => {
    const errors = getAmountFilterErrors();
    if (!errors.length) {
      state.filters.minAmount = dom.minAmountInput.value;
      state.filters.maxAmount = dom.maxAmountInput.value;
    }
    renderAll();
  }, 200);

  dom.searchInput.addEventListener('input', debouncedSearch);
  dom.categoryFilter.addEventListener('change', handleFilterControlsChange);
  dom.paymentFilter.addEventListener('change', handleFilterControlsChange);
  dom.monthFilter.addEventListener('change', handleFilterControlsChange);
  dom.minAmountInput.addEventListener('input', debouncedAmountFilter);
  dom.maxAmountInput.addEventListener('input', debouncedAmountFilter);
  dom.sortSelect.addEventListener('change', () => {
    state.sortBy = dom.sortSelect.value;
    renderAll();
  });
  dom.resetFiltersBtn.addEventListener('click', resetFilters);

  dom.expenseList.addEventListener('click', handleExpenseListClick);
  dom.emptyStateActionBtn.addEventListener('click', handleEmptyStateAction);

  dom.exportPdfBtn.addEventListener('click', generatePDFReport);
  dom.clearAllBtn.addEventListener('click', requestClearAll);
  dom.migrateExpensesBtn.addEventListener('click', migrateLocalExpenses);

  dom.modalCancelBtn.addEventListener('click', closeModal);
  dom.modalConfirmBtn.addEventListener('click', handleModalConfirm);
  dom.modalOverlay.addEventListener('click', (event) => {
    if (event.target === dom.modalOverlay) closeModal();
  });
  document.addEventListener('keydown', handleGlobalKeydown);
  window.addEventListener('hashchange', () => { void enforceAuthRoute(); });
}

function init() {
  document.body.classList.add('route-checking');
  cacheDom();
  dom.dateInput.max = getTodayDateString();
  attachEventListeners();
  setUnauthenticatedView();
  void initializeAuthentication();
}

document.addEventListener('DOMContentLoaded', init);
