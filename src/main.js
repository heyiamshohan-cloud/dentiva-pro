/* Dentiva Pro — offline-first practice workspace
 * The application deliberately starts with an empty, local data store. Every record visible in the UI is created by the clinic.
 */
import './styles.css';
import './styles-flagship.css';
import { ARRAY_COLLECTIONS, CURRENT_SCHEMA_VERSION, PERMISSIONS, applyRestorePlan, buildBackupManifest, buildRestorePlan, appointmentsOverlap, calculateInvoice, canAcceptPayment, canonicalJson, hasPermission, paymentStatusFor, permissionsForRole, sanitizeFilename, validateAttachmentFile, validateBackupPayload, validateMoney, validatePayment, validateRelationships } from './core.js';
import { DASHBOARD_PERIODS, analyticsSnapshot, buildTimelineEvents, deriveOperationalNotifications, normaliseTags, periodBounds, statementEntries, validatePatientInput, validateTreatmentPlanInput } from './domain.js';

const app = document.querySelector('#app');
const STORAGE_KEY = 'dentiva-pro.store.v2';
const APP_VERSION = '1.3.0';

const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Dhaka', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
const localDateKey = (value = new Date()) => { const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Dhaka', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(value).filter((part) => part.type !== 'literal').map((part) => [part.type, part.value])); return `${parts.year}-${parts.month}-${parts.day}`; };
const now = () => new Date().toISOString();
const uid = (prefix = 'id') => `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
const deepClone = (value) => JSON.parse(JSON.stringify(value));
async function sha256Hex(value) { const bytes = new TextEncoder().encode(value); const digest = await crypto.subtle.digest('SHA-256', bytes); return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join(''); }
const esc = (value) => String(value ?? '').replace(/[&<>'"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[c]));
const attr = esc;
const safeLogoSource = (value) => /^data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/=\s]+$/i.test(String(value || '')) ? String(value) : '';
const clamp = (n, min, max) => Math.min(max, Math.max(min, n));

const DEFAULT_STATE = {
  schemaVersion: CURRENT_SCHEMA_VERSION,
  appVersion: APP_VERSION,
  createdAt: now(),
  updatedAt: now(),
  setupComplete: false,
  settings: {
    clinicName: '',
    dentistName: '',
    professionalTitle: 'Dr.',
    phone: '',
    secondaryPhone: '',
    email: '',
    address: '',
    city: '',
    district: '',
    country: 'Bangladesh',
    chamberName: '',
    logo: '',
    language: 'English',
    currency: 'BDT',
    timezone: 'Asia/Dhaka',
    dateFormat: 'dd MMM yyyy',
    timeFormat: '12-hour',
    invoicePrefix: 'INV',
    patientPrefix: 'PT',
    appointmentPrefix: 'APT',
    serialPrefix: 'Q',
    defaultDuration: 30,
    taxEnabled: false,
    taxRate: 0,
    autoLockMinutes: 30,
    notifications: true,
    applicationLock: false,
    pinHash: '',
    pinSalt: '',
    paymentMethods: ['Cash', 'Bank', 'Card', 'bKash', 'Nagad', 'Rocket', 'Upay'],
    expenseCategories: ['Clinic rent', 'Electricity', 'Internet', 'Water', 'Staff salary', 'Cleaning', 'Maintenance', 'Equipment', 'Supplies', 'Marketing', 'Transport', 'Other'],
    inventoryCategories: ['Medicine', 'Dental material', 'Consumable', 'Accessory', 'Equipment consumable', 'Other'],
    backupEnabled: false,
    backupIntervalHours: 24,
    backupRetention: 5,
    lowStockThreshold: 5,
    accent: 'teal',
    density: 'comfortable',
    printPageSize: 'A4',
    paperProfile: 'A4',
    sessionTimeoutMinutes: 30,
    rooms: ['Room 1'],
    customPatientFields: [],
    medicationTemplates: [],
    documentTemplate: { showLogo: true, showClinicContact: true, footer: 'Thank you for choosing our practice.' }
  },
  counters: { patient: 1, appointment: 1, invoice: 1, visit: 1, prescription: 1, receipt: 1, serial: 1, staff: 1 },
  patients: [],
  appointments: [],
  visits: [],
  prescriptions: [],
  dentalRecords: [],
  treatments: [],
  invoices: [],
  payments: [],
  inventory: [],
  stockMovements: [],
  suppliers: [],
  staff: [],
  expenses: [],
  referrals: [],
  attachments: [],
  paymentAdjustments: [],
  audit: [],
  notifications: [],
  notificationRead: {},
  followUpTasks: [],
  treatmentPlans: [],
  users: [],
  medicationCatalog: [],
  notificationRules: [{ id: 'rule_queue', kind: 'queue', enabled: true }, { id: 'rule_clinical', kind: 'clinical', enabled: true }, { id: 'rule_inventory', kind: 'inventory', enabled: true }, { id: 'rule_warning', kind: 'warning', enabled: true }, { id: 'rule_backup', kind: 'backup', enabled: true }],
  rooms: [{ id: 'room_default', name: 'Room 1', active: true }],
  savedFilters: [],
  savedReports: [],
  dashboard: ['schedule', 'queue', 'followups', 'signals'],
  lastBackupAt: null
};

const arrayKeys = [...ARRAY_COLLECTIONS];

const initialCalendarDate = new Date();
let ui = {
  toast: null,
  locked: false,
  page: 'dashboard',
  range: 'today',
  analyticsRange: 'month',
  reportsRange: 'month',
  reportType: 'revenue',
  dentition: 'adult',
  calendarMonth: initialCalendarDate.getMonth(),
  calendarYear: initialCalendarDate.getFullYear(),
  search: '',
  patientPage: 1,
  patientBalanceFilter: 'all',
  patientStatusFilter: 'All statuses',
  sidebarCollapsed: false,
  mobileNav: false,
  unlockFailures: 0,
  unlockBlockedUntil: 0
};

function migrateState(saved) {
  const base = deepClone(DEFAULT_STATE);
  const source = saved && typeof saved === 'object' ? saved : {};
  const version = Number(source.schemaVersion || 1);
  if (version > CURRENT_SCHEMA_VERSION) {
    const preserved = {
      ...base,
      ...source,
      schemaVersion: version,
      appVersion: APP_VERSION,
      settings: { ...base.settings, ...(source.settings || {}) },
      counters: { ...base.counters, ...(source.counters || {}) },
      dashboard: Array.isArray(source.dashboard) ? source.dashboard : base.dashboard,
      unsupportedSchema: true,
      migrationError: `This workspace uses schema v${version}; Dentiva Pro ${APP_VERSION} supports up to schema v${CURRENT_SCHEMA_VERSION}.`
    };
    arrayKeys.forEach((key) => { preserved[key] = Array.isArray(source[key]) ? source[key] : (base[key] || []); });
    return preserved;
  }
  const merged = {
    ...base,
    ...source,
    schemaVersion: CURRENT_SCHEMA_VERSION,
    appVersion: APP_VERSION,
    settings: { ...base.settings, ...(source.settings || {}) },
    counters: { ...base.counters, ...(source.counters || {}) },
    dashboard: Array.isArray(source.dashboard) ? source.dashboard : base.dashboard
  };
  arrayKeys.forEach((key) => { merged[key] = Array.isArray(source[key]) ? source[key] : (base[key] || []); });
  if (version < 2) {
    merged.followUpTasks = Array.isArray(source.followUpTasks) ? source.followUpTasks : [];
    merged.savedFilters = [];
    merged.savedReports = [];
    merged.settings.paymentMethods = merged.settings.paymentMethods || base.settings.paymentMethods;
    merged.settings.expenseCategories = merged.settings.expenseCategories || base.settings.expenseCategories;
    merged.settings.inventoryCategories = merged.settings.inventoryCategories || base.settings.inventoryCategories;
  }
  merged.notifications = Array.isArray(merged.notifications) ? merged.notifications : [];
  merged.notificationRead = merged.notificationRead && typeof merged.notificationRead === 'object' ? merged.notificationRead : {};
  merged.audit = Array.isArray(merged.audit) ? merged.audit : [];
  merged.medicationCatalog = Array.isArray(merged.medicationCatalog) ? merged.medicationCatalog : [];
  merged.notificationRules = Array.isArray(merged.notificationRules) ? merged.notificationRules : [];
  const configuredRooms = Array.isArray(merged.settings?.rooms) && merged.settings.rooms.length ? merged.settings.rooms : ['Room 1'];
  const configuredFields = Array.isArray(merged.settings?.customPatientFields) ? merged.settings.customPatientFields : [];
  merged.settings = { ...base.settings, ...(merged.settings || {}), rooms: configuredRooms, customPatientFields: configuredFields.map((definition) => { const label = typeof definition === 'string' ? definition : String(definition?.label || definition?.key || 'Custom field'); const key = typeof definition === 'object' && definition.key ? definition.key : label.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '') || uid('field'); return { ...(typeof definition === 'object' ? definition : {}), key, label, type: definition?.type || 'text' }; }).slice(0, 20), medicationTemplates: Array.isArray(merged.settings?.medicationTemplates) ? merged.settings.medicationTemplates : [], documentTemplate: { ...base.settings.documentTemplate, ...(merged.settings?.documentTemplate || {}) } };
  const roomRecords = Array.isArray(saved?.rooms) ? merged.rooms : [];
  merged.rooms = (roomRecords.length ? roomRecords : merged.settings.rooms).map((room, index) => { const name = typeof room === 'string' ? room : String(room?.name || room?.label || `Room ${index + 1}`); const id = typeof room === 'object' && room.id ? room.id : `room_${name.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '') || index + 1}`; return { ...(typeof room === 'object' ? room : {}), id, name, active: room?.active !== false }; });
  merged.patients = merged.patients.map((patient) => ({ ...patient, archived: Boolean(patient.archived || patient.status === 'Archived') }));
  return merged;
}

const Store = {
  load() {
    try {
      const desktopPayload = globalThis.dentivaDesktop?.storeLoad?.();
      if (desktopPayload) return migrateState(desktopPayload);
      const raw = localStorage.getItem(STORAGE_KEY) || localStorage.getItem('dentiva-pro.store.v1');
      return migrateState(raw ? JSON.parse(raw) : null);
    } catch (error) {
      console.error('Dentiva Pro store recovery', error);
      return deepClone(DEFAULT_STATE);
    }
  },
  save(value) {
    try {
      if (value.unsupportedSchema) throw new Error(value.migrationError || 'This workspace uses a newer schema and cannot be overwritten.');
      value.updatedAt = now();
      value.schemaVersion = CURRENT_SCHEMA_VERSION;
      value.appVersion = APP_VERSION;
      const payload = deepClone(value);
      if (globalThis.dentivaDesktop?.storeSave) {
        const result = globalThis.dentivaDesktop.storeSave(payload);
        if (!result?.ok) throw new Error(result?.error || 'Desktop store rejected the payload.');
      } else {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
      }
      return true;
    } catch (error) {
      console.error('Dentiva Pro store save', error);
      if (ui?.toast !== undefined) notify(error.message.includes('size') ? error.message : 'The local store could not be saved. Export a backup and try again.', 'error');
      return false;
    }
  },
  reset() {
    if (globalThis.dentivaDesktop?.storeReset) globalThis.dentivaDesktop.storeReset();
    else { localStorage.removeItem(STORAGE_KEY); localStorage.removeItem('dentiva-pro.store.v1'); }
    state = deepClone(DEFAULT_STATE);
    ui = { ...ui, page: 'dashboard', modal: null, patientId: null, restoreCandidate: null, locked: false };
    render();
  }
};

let state = Store.load();
function ensureUserDirectory() {
  state.users = Array.isArray(state.users) ? state.users : [];
  if (!state.users.length && (state.setupComplete || state.settings.dentistName)) {
    state.users.push({
      id: 'user_admin',
      name: state.settings.dentistName || 'Practice administrator',
      staffId: '',
      role: 'Administrator',
      permissions: permissionsForRole('Administrator'),
      pinHash: state.settings.pinHash || '',
      pinSalt: state.settings.pinSalt || '',
      active: true,
      lockedUntil: 0,
      failedAttempts: 0,
      createdAt: now(),
      lastLogin: null
    });
    Store.save(state);
  }
}
ensureUserDirectory();
if (state.settings.applicationLock && (!state.settings.pinHash || !state.settings.pinSalt)) {
  state.settings.applicationLock = false;
  state.settings.pinHash = '';
  state.settings.pinSalt = '';
  Store.save(state);
}
ui = {
  page: 'dashboard',
  patientId: null,
  patientTab: 'overview',
  patientPage: 1,
  search: '',
  range: 'today',
  rangeFrom: '',
  rangeTo: '',
  modal: null,
  toast: null,
  locked: false,
  unlockFailures: 0,
  unlockBlockedUntil: 0,
  activityTimer: null,
  sidebarCollapsed: false,
  mobileNav: false,
  authenticatedUserId: state.users?.some((user) => user.active !== false && user.pinHash) ? null : state.users?.find((user) => user.active !== false)?.id || null,
  loginFailures: 0,
  loginBlockedUntil: 0,
  restoreCandidate: null,
  dentalPatientId: '',
  dentalTooth: null,
  dentalFilter: 'all',
  patientDateFrom: '',
  patientDateTo: '',
  patientToothStatus: '',
  patientBalanceFilter: 'all',
  reportsRange: 'month',
  analyticsRange: 'month',
  reportFrom: '',
  reportTo: '',
  reportType: 'revenue',
  calendarMonth: new Date().getMonth(),
  calendarYear: new Date().getFullYear(),
  appointmentView: 'month',
  appointmentDate: today()
};
if (state.settings.applicationLock && state.settings.pinHash && state.settings.pinSalt) ui.locked = true;

const ICONS = {
  grid: '<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>',
  users: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/>',
  calendar: '<rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18M8 14h.01M12 14h.01M16 14h.01M8 18h.01M12 18h.01"/>',
  clipboard: '<rect x="5" y="4" width="14" height="17" rx="2"/><path d="M9 4V2h6v2M8 9h8M8 13h5M8 17h3"/>',
  activity: '<path d="M3 12h4l3-8 4 16 3-8h4"/>',
  tooth: '<path d="M8.8 3.5C6.1 2 3 3.8 3 7.4c0 3.3 1.8 4.9 2.2 8.2.3 2.2.7 4.8 2.4 4.8 1.5 0 1.6-4.8 3-4.8s1.5 4.8 3 4.8c1.7 0 2.1-2.6 2.4-4.8.4-3.3 2.2-4.9 2.2-8.2 0-3.6-3.1-5.4-5.8-3.9-.7.4-1.5.4-2.2 0Z"/>',
  receipt: '<path d="M4 3h16v18l-3-2-3 2-3-2-3 2-4-2V3Z"/><path d="M8 8h8M8 12h8M8 16h4"/>',
  credit: '<rect x="2" y="5" width="20" height="14" rx="2"/><path d="M2 10h20M6 15h4"/>',
  box: '<path d="m21 8-9-5-9 5 9 5 9-5Z"/><path d="m3 8 9 5 9-5M3 8v9l9 5 9-5V8M12 13v9"/>',
  truck: '<path d="M3 6h11v11H3zM14 10h4l3 3v4h-7V10Z"/><circle cx="7" cy="19" r="2"/><circle cx="18" cy="19" r="2"/>',
  briefcase: '<rect x="3" y="7" width="18" height="13" rx="2"/><path d="M8 7V5a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M3 12h18M10 12v2h4v-2"/>',
  chart: '<path d="M4 19V5M4 19h17"/><path d="m7 15 3-4 3 2 5-7"/>',
  shield: '<path d="M12 22s8-3.7 8-10V5l-8-3-8 3v7c0 6.3 8 10 8 10Z"/><path d="m9 12 2 2 4-4"/>',
  settings: '<path d="M12 15.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Z"/><path d="m19.4 15 .1.1a2 2 0 1 1-2.8 2.8l-.1-.1a2 2 0 0 0-3.4 1.4v.3a2 2 0 1 1-4 0v-.2A2 2 0 0 0 5.8 18l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1A2 2 0 0 0 1.6 12a2 2 0 1 1 0-4h.2a2 2 0 0 0 1.4-3.4l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1A2 2 0 0 0 9.4.4h.2a2 2 0 1 1 4 0v.2A2 2 0 0 0 17 2l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1A2 2 0 0 0 21.2 8h.2a2 2 0 1 1 0 4h-.2a2 2 0 0 0-1.8 3Z"/>',
  backup: '<path d="M12 3v12M7 8l5-5 5 5M5 13v6h14v-6"/>',
  history: '<path d="M3 12a9 9 0 1 0 3-6.7M3 4v6h6M12 7v5l3 2"/>',
  help: '<circle cx="12" cy="12" r="9"/><path d="M9.5 9a2.5 2.5 0 1 1 4.1 1.9c-1.1.9-1.6 1.4-1.6 2.6M12 17h.01"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8h.01"/>',
  search: '<circle cx="10.8" cy="10.8" r="6.8"/><path d="m16 16 5 5"/>',
  bell: '<path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  arrow: '<path d="M5 12h14M13 6l6 6-6 6"/>',
  chevron: '<path d="m9 18 6-6-6-6"/>',
  down: '<path d="m6 9 6 6 6-6"/>',
  up: '<path d="m18 15-6-6-6 6"/>',
  close: '<path d="M6 6l12 12M18 6 6 18"/>',
  check: '<path d="m5 12 4 4L19 6"/>',
  filter: '<path d="M4 6h16M7 12h10M10 18h4"/>',
  more: '<circle cx="5" cy="12" r="1" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r="1" fill="currentColor" stroke="none"/><circle cx="19" cy="12" r="1" fill="currentColor" stroke="none"/>',
  edit: '<path d="m4 16-.8 4.8L8 20l11.5-11.5a2.1 2.1 0 0 0-3-3L5 17Z"/><path d="m14.5 7.5 3 3"/>',
  trash: '<path d="M4 7h16M10 11v6M14 11v6M6 7l1 14h10l1-14M9 7V4h6v3"/>',
  download: '<path d="M12 3v12M7 10l5 5 5-5M4 20h16"/>',
  upload: '<path d="M12 16V4M7 9l5-5 5 5M4 20h16"/>',
  printer: '<path d="M6 9V3h12v6M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><path d="M6 14h12v7H6z"/>',
  lock: '<rect x="5" y="10" width="14" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/>',
  unlock: '<rect x="5" y="10" width="14" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 7-2.7"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  map: '<path d="m3 6 6-3 6 3 6-3v17l-6 3-6-3-6 3V6Z"/><path d="M9 3v17M15 6v17"/>',
  phone: '<path d="M21 16.5v2.6a1.8 1.8 0 0 1-2 1.8 17.8 17.8 0 0 1-7.8-2.8 17.5 17.5 0 0 1-5.4-5.4A17.8 17.8 0 0 1 3 4.9a1.8 1.8 0 0 1 1.8-2h2.6a1.8 1.8 0 0 1 1.8 1.5c.1.9.4 1.8.7 2.6a1.8 1.8 0 0 1-.4 1.9L8.4 10a14.5 14.5 0 0 0 5.4 5.4l1.1-1.1a1.8 1.8 0 0 1 1.9-.4c.8.3 1.7.6 2.6.7a1.8 1.8 0 0 1 1.6 1.9Z"/>',
  mail: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3 7 9 6 9-6"/>',
  menu: '<path d="M4 6h16M4 12h16M4 18h16"/>',
  logout: '<path d="M10 17l5-5-5-5M15 12H3M21 19V5a2 2 0 0 0-2-2h-6"/>',
  sparkle: '<path d="m12 3 1.7 5.3L19 10l-5.3 1.7L12 17l-1.7-5.3L5 10l5.3-1.7L12 3ZM19 16l.7 2.3L22 19l-2.3.7L19 22l-.7-2.3L16 19l2.3-.7L19 16Z"/>',
  flag: '<path d="M5 21V4a1 1 0 0 1 1-1h10l3 3-3 3H6M5 15h11"/>',
  dollar: '<path d="M12 2v20M17 6.5C16.2 5.5 14.7 5 12.8 5 10.1 5 8 6.4 8 8.5S9.8 12 12.6 12c2.6 0 4.4 1.3 4.4 3.5S14.8 19 12 19c-2 0-3.6-.6-4.6-1.8"/>',
  file: '<path d="M6 2h8l4 4v16H6zM14 2v5h5M9 12h6M9 16h6"/>',
  refresh: '<path d="M20 11a8 8 0 0 0-14.7-4L3 10M3 5v5h5M4 13a8 8 0 0 0 14.7 4L21 14m0 5v-5h-5"/>',
  eye: '<path d="M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6S2 12 2 12Z"/><circle cx="12" cy="12" r="2.5"/>',
  layers: '<path d="m12 3 9 5-9 5-9-5 9-5Z"/><path d="m3 12 9 5 9-5M3 16l9 5 9-5"/>',
  book: '<path d="M4 4h6a2 2 0 0 1 2 2v14a2 2 0 0 0-2-2H4zM20 4h-6a2 2 0 0 0-2 2v14a2 2 0 0 1 2-2h6z"/>',
  database: '<ellipse cx="12" cy="5" rx="7" ry="3"/><path d="M5 5v7c0 1.7 3.1 3 7 3s7-1.3 7-3V5M5 12v7c0 1.7 3.1 3 7 3s7-1.3 7-3v-7"/>' ,
  user: '<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>',
  circle: '<circle cx="12" cy="12" r="9"/>',
  warning: '<path d="m12 3 10 18H2L12 3Z"/><path d="M12 9v4M12 17h.01"/>',
  leaf: '<path d="M20.5 3.5C12 3.2 5.6 6.1 4.4 11.3 3.2 16.5 7.5 20 12 20c5.3 0 8.7-4.1 8.5-16.5Z"/><path d="M4.5 19.5C8 15 12 12 18 9"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>'
};
function icon(name, size = 18, className = '') {
  return `<svg class="icon ${className}" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name] || ICONS.circle}</svg>`;
}

const BENGALI = {
  'Dashboard': 'ড্যাশবোর্ড', 'Patients': 'রোগী', 'Appointments': 'অ্যাপয়েন্টমেন্ট', "Today's Queue": 'আজকের সিরিয়াল',
  'Clinical Records': 'ক্লিনিক্যাল রেকর্ড', 'Prescriptions': 'প্রেসক্রিপশন', 'Dental Chart': 'ডেন্টাল চার্ট', 'Treatment Catalog': 'চিকিৎসা তালিকা', 'Accounting': 'হিসাবরক্ষণ',
  'Billing': 'বিলিং', 'Payments': 'পরিশোধ', 'Inventory': 'ইনভেন্টরি', 'Suppliers': 'সরবরাহকারী', 'Staff': 'স্টাফ',
  'Reports': 'রিপোর্ট', 'Analytics': 'বিশ্লেষণ', 'Diagnostics': 'ডায়াগনস্টিকস', 'Notifications': 'নোটিফিকেশন', 'Backup & Restore': 'ব্যাকআপ ও পুনরুদ্ধার', 'Settings': 'সেটিংস', 'Help': 'সহায়তা', 'About': 'পরিচিতি',
  'Workspace': 'ওয়ার্কস্পেস', 'Clinical': 'ক্লিনিক্যাল', 'Finance': 'আর্থিক', 'Operations': 'পরিচালনা', 'Insights': 'বিশ্লেষণ', 'System': 'সিস্টেম',
  'New patient': 'নতুন রোগী', 'New appointment': 'নতুন অ্যাপয়েন্টমেন্ট', 'New visit': 'নতুন ভিজিট', 'New invoice': 'নতুন ইনভয়েস', 'Saved medication': 'সংরক্ষিত ওষুধ', 'Choose a saved medicine...': 'সংরক্ষিত ওষুধ বেছে নিন...', 'Save current medicine to catalog': 'বর্তমান ওষুধ ক্যাটালগে সংরক্ষণ',
  'Record payment': 'পরিশোধ রেকর্ড', 'Add stock': 'স্টক যোগ করুন', 'Complete setup': 'সেটআপ সম্পূর্ণ করুন', 'Open appointments': 'অ্যাপয়েন্টমেন্ট খুলুন',
  'View queue': 'সিরিয়াল দেখুন', 'Clinical records': 'ক্লিনিক্যাল রেকর্ড', 'Create prescription': 'প্রেসক্রিপশন তৈরি করুন',
  'Export CSV': 'CSV এক্সপোর্ট', 'Print queue': 'সিরিয়াল প্রিন্ট', 'Print statement': 'স্টেটমেন্ট প্রিন্ট', 'Stock movement': 'স্টক মুভমেন্ট',
  'Export full backup': 'সম্পূর্ণ ব্যাকআপ এক্সপোর্ট', 'Import backup': 'ব্যাকআপ ইমপোর্ট', 'Save settings': 'সেটিংস সংরক্ষণ',
  'Cancel': 'বাতিল', 'Save changes': 'পরিবর্তন সংরক্ষণ', 'Save record': 'রেকর্ড সংরক্ষণ', 'Search anything': 'যেকোনো কিছু খুঁজুন',
  'Today': 'আজ', 'Last 7 days': 'গত ৭ দিন', 'Last 1 month': 'গত ১ মাস', 'Last 3 months': 'গত ৩ মাস', 'Last 6 months': 'গত ৬ মাস', 'Last 1 year': 'গত ১ বছর', 'Custom range': 'কাস্টম সময়সীমা',
  'Active': 'সক্রিয়', 'Inactive': 'নিষ্ক্রিয়', 'Scheduled': 'নির্ধারিত', 'Checked In': 'চেক-ইন', 'Waiting': 'অপেক্ষমাণ',
  'In Treatment': 'চিকিৎসাধীন', 'Completed': 'সম্পন্ন', 'Cancelled': 'বাতিল', 'No Show': 'অনুপস্থিত', 'Paid': 'পরিশোধিত',
  'Partially Paid': 'আংশিক পরিশোধ', 'Unpaid': 'অপরিশোধিত', 'Low stock': 'স্টক কম', 'In stock': 'স্টকে আছে', 'Expired': 'মেয়াদোত্তীর্ণ',
  'No records in this range': 'এই সময়সীমায় কোনো রেকর্ড নেই', 'No patients found': 'কোনো রোগী পাওয়া যায়নি', 'No notifications': 'কোনো নোটিফিকেশন নেই', 'Queue wait': 'সিরিয়ালে অপেক্ষা', 'Clinical follow-ups': 'ক্লিনিক্যাল ফলো-আপ', 'Stock and expiry': 'স্টক ও মেয়াদ', 'Outstanding balances': 'বকেয়া ব্যালান্স', 'Backup reminders': 'ব্যাকআপ অনুস্মারক', 'Notification categories': 'নোটিফিকেশনের বিভাগ', 'Document footer': 'ডকুমেন্ট ফুটার', 'Show clinic logo in documents': 'ডকুমেন্টে ক্লিনিকের লোগো দেখান', 'Show clinic contact in documents': 'ডকুমেন্টে ক্লিনিকের যোগাযোগ দেখান',
  'Professional Dental Practice': 'পেশাদার ডেন্টাল প্র্যাকটিস', 'Practice workspace': 'প্র্যাকটিস ওয়ার্কস্পেস', 'Setup required': 'সেটআপ প্রয়োজন',
  'General': 'সাধারণ', 'Clinic & doctor': 'ক্লিনিক ও ডাক্তার', 'Appointments': 'অ্যাপয়েন্টমেন্ট', 'Billing & payments': 'বিলিং ও পরিশোধ', 'Printing': 'প্রিন্টিং', 'Security': 'নিরাপত্তা', 'Notifications': 'নোটিফিকেশন',
  'Good morning': 'সুপ্রভাত', 'Good afternoon': 'শুভ অপরাহ্ণ', 'Good evening': 'শুভ সন্ধ্যা', 'A clear view of your practice, without the noise.': 'অপ্রয়োজনীয় জটিলতা ছাড়া আপনার প্র্যাকটিসের পরিষ্কার চিত্র।',
  'Today’s appointments': 'আজকের অ্যাপয়েন্টমেন্ট', 'Patients today': 'আজকের রোগী', 'Waiting queue': 'অপেক্ষমাণ সিরিয়াল', 'Collected today': 'আজকের আদায়', 'Your schedule is clear': 'আজকের সময়সূচি খালি', 'No patients added yet': 'এখনও কোনো রোগী যোগ করা হয়নি', 'No one is waiting': 'কেউ অপেক্ষায় নেই', 'No payments recorded': 'কোনো পরিশোধ রেকর্ড নেই',
  'Today’s schedule': 'আজকের সময়সূচি', 'Today’s queue': 'আজকের সিরিয়াল', 'Follow-ups due': 'প্রয়োজনীয় ফলো-আপ', 'Operational signals': 'পরিচালনাগত সংকেত', 'Move work forward': 'কাজ এগিয়ে নিন', 'Common actions, one click away.': 'প্রয়োজনীয় কাজ এক ক্লিক দূরে।',
  'Nothing booked today': 'আজ কোনো অ্যাপয়েন্টমেন্ট নেই', 'Create an appointment to build your schedule.': 'সময়সূচি তৈরি করতে একটি অ্যাপয়েন্টমেন্ট যোগ করুন।', 'Your queue is ready': 'আপনার সিরিয়াল প্রস্তুত', 'No follow-ups due': 'কোনো ফলো-আপ বাকি নেই', 'No outstanding balances': 'কোনো বকেয়া নেই', 'Inventory is in good shape': 'ইনভেন্টরি স্বাভাবিক আছে', 'Backup not configured': 'ব্যাকআপ সেট করা হয়নি',
  'Patient record': 'রোগীর রেকর্ড', 'New patient': 'নতুন রোগী', 'Register a patient': 'রোগী নিবন্ধন করুন', 'Edit patient details': 'রোগীর তথ্য সম্পাদনা', 'Full name': 'পূর্ণ নাম', 'Preferred name': 'পছন্দের নাম', 'Alternative phone': 'বিকল্প ফোন', 'Date of birth': 'জন্মতারিখ', 'Gender': 'লিঙ্গ', 'Blood group': 'রক্তের গ্রুপ', 'Occupation': 'পেশা', 'Allergies': 'অ্যালার্জি', 'Chronic conditions': 'দীর্ঘমেয়াদি রোগ', 'Current medications': 'চলমান ওষুধ', 'Previous dental history': 'পূর্ববর্তী ডেন্টাল ইতিহাস', 'Referral source': 'রেফারেলের উৎস', 'Patient status': 'রোগীর অবস্থা',
  'Patient details': 'রোগীর তথ্য', 'Clinical context': 'ক্লিনিক্যাল প্রেক্ষাপট', 'Recent activity': 'সাম্প্রতিক কার্যক্রম', 'Clinical visits': 'ক্লিনিক্যাল ভিজিট', 'No visits recorded': 'কোনো ভিজিট রেকর্ড নেই', 'Patient timeline': 'রোগীর টাইমলাইন', 'Timeline is empty': 'টাইমলাইন খালি', 'Attachments': 'সংযুক্তি', 'No attachments yet': 'এখনও কোনো সংযুক্তি নেই', 'Referral history': 'রেফারেল ইতিহাস', 'No referrals recorded': 'কোনো রেফারেল রেকর্ড নেই',
  'Calendar': 'ক্যালেন্ডার', 'Upcoming appointments': 'আসন্ন অ্যাপয়েন্টমেন্ট', 'No upcoming appointments': 'কোনো আসন্ন অ্যাপয়েন্টমেন্ট নেই', 'Plan the day, protect chair time and keep patients informed.': 'দিনের পরিকল্পনা করুন, চেয়ার সময় সুরক্ষিত রাখুন এবং রোগীকে অবহিত রাখুন।',
  'Clinical records': 'ক্লিনিক্যাল রেকর্ড', 'Record a visit': 'ভিজিট রেকর্ড করুন', 'Record a visit after recording a patient visit.': 'রোগীর ভিজিটের তথ্য সংরক্ষণ করুন।', 'Symptoms': 'উপসর্গ', 'Clinical findings': 'ক্লিনিক্যাল পর্যবেক্ষণ', 'Diagnosis': 'রোগ নির্ণয়', 'Treatment plan': 'চিকিৎসা পরিকল্পনা', 'Treatment performed': 'সম্পাদিত চিকিৎসা', 'Follow-up date': 'ফলো-আপের তারিখ', 'Doctor / additional notes': 'ডাক্তারের অতিরিক্ত নোট',
  'Treatment catalog': 'চিকিৎসা তালিকা', 'Add a treatment': 'চিকিৎসা যোগ করুন', 'Treatment catalog is empty': 'চিকিৎসা তালিকা খালি', 'Treatment name': 'চিকিৎসার নাম', 'Default price': 'ডিফল্ট মূল্য', 'Tooth required': 'দাঁত প্রয়োজন', 'Active': 'সক্রিয়', 'Inactive': 'নিষ্ক্রিয়',
  'Dental chart': 'ডেন্টাল চার্ট', 'Choose a patient to open the chart': 'চার্ট খুলতে একজন রোগী নির্বাচন করুন', 'Select a tooth': 'একটি দাঁত নির্বাচন করুন', 'Tooth record': 'দাঁতের রেকর্ড', 'Clinical note': 'ক্লিনিক্যাল নোট', 'Save tooth record': 'দাঁতের রেকর্ড সংরক্ষণ', 'Remove record': 'রেকর্ড মুছুন', 'Adult dentition': 'স্থায়ী দাঁত', 'Primary dentition': 'দুধ দাঁত',
  'Create a prescription': 'প্রেসক্রিপশন তৈরি করুন', 'New prescription': 'নতুন প্রেসক্রিপশন', 'Medicine': 'ওষুধ', 'Strength': 'শক্তি', 'Dosage': 'মাত্রা', 'Frequency': 'বারম্বারতা', 'Duration': 'সময়কাল', 'Route': 'প্রয়োগের পথ', 'Instructions': 'নির্দেশনা', 'Prescription notes': 'প্রেসক্রিপশন নোট',
  'Billing': 'বিলিং', 'Billing statement': 'বিলিং স্টেটমেন্ট', 'Total billed': 'মোট বিল', 'Collected': 'আদায়', 'Outstanding': 'বকেয়া', 'Paid rate': 'পরিশোধের হার', 'No invoices created': 'কোনো ইনভয়েস তৈরি হয়নি', 'Create an invoice': 'ইনভয়েস তৈরি করুন', 'New invoice': 'নতুন ইনভয়েস', 'Invoice date': 'ইনভয়েসের তারিখ', 'Item / treatment': 'আইটেম / চিকিৎসা', 'Quantity': 'পরিমাণ', 'Unit price': 'একক মূল্য', 'Discount': 'ছাড়', 'Tax rate (%)': 'কর হার (%)', 'Calculated total': 'হিসাব করা মোট',
  'Payments': 'পরিশোধ', 'No payments recorded': 'কোনো পরিশোধ রেকর্ড নেই', 'Record a payment': 'পরিশোধ রেকর্ড করুন', 'Payment date': 'পরিশোধের তারিখ', 'Method': 'পদ্ধতি', 'Reference / transaction ID': 'রেফারেন্স / লেনদেন আইডি', 'Cash': 'নগদ', 'Bank': 'ব্যাংক', 'Card': 'কার্ড', 'Other': 'অন্যান্য',
  'Inventory': 'ইনভেন্টরি', 'No inventory items': 'কোনো ইনভেন্টরি আইটেম নেই', 'Add stock item': 'স্টক আইটেম যোগ করুন', 'Item name': 'আইটেমের নাম', 'Item code': 'আইটেম কোড', 'Category': 'ক্যাটাগরি', 'Brand': 'ব্র্যান্ড', 'Unit': 'একক', 'Current stock': 'বর্তমান স্টক', 'Minimum / reorder level': 'ন্যূনতম / পুনঃঅর্ডার স্তর', 'Expiry date': 'মেয়াদ শেষের তারিখ', 'Batch / lot': 'ব্যাচ / লট',
  'Suppliers': 'সরবরাহকারী', 'No suppliers added': 'কোনো সরবরাহকারী যোগ করা হয়নি', 'Supplier name': 'সরবরাহকারীর নাম', 'Contact person': 'যোগাযোগের ব্যক্তি', 'Staff': 'স্টাফ', 'No staff members yet': 'এখনও কোনো স্টাফ নেই', 'Staff member': 'স্টাফ সদস্য', 'Role': 'ভূমিকা', 'Joining date': 'যোগদানের তারিখ', 'Salary': 'বেতন', 'Status': 'অবস্থা',
  'Accounting & finance': 'হিসাবরক্ষণ ও অর্থ', 'Accounting': 'হিসাবরক্ষণ', 'Add expense': 'খরচ যোগ করুন', 'Operating expenses': 'পরিচালন খরচ', 'Net operating result': 'নিট পরিচালন ফলাফল', 'Expense categories': 'খরচের ক্যাটাগরি', 'No expenses recorded': 'কোনো খরচ রেকর্ড নেই', 'Description': 'বিবরণ',
  'Reports': 'রিপোর্ট', 'Revenue & collections': 'আয় ও আদায়', 'Patient register': 'রোগী তালিকা', 'Visit activity': 'ভিজিট কার্যক্রম', 'Appointment activity': 'অ্যাপয়েন্টমেন্ট কার্যক্রম', 'Outstanding balances': 'বকেয়া হিসাব', 'Inventory status': 'ইনভেন্টরি অবস্থা', 'Expense report': 'খরচের রিপোর্ট', 'Date range': 'তারিখের পরিসীমা', 'Report notes': 'রিপোর্ট নোট', 'No records in this range': 'এই সময়সীমায় কোনো রেকর্ড নেই',
  'Backup & restore': 'ব্যাকআপ ও পুনরুদ্ধার', 'Create a backup': 'ব্যাকআপ তৈরি করুন', 'Restore or import': 'পুনরুদ্ধার বা ইমপোর্ট', 'Export full backup': 'সম্পূর্ণ ব্যাকআপ এক্সপোর্ট', 'Import backup': 'ব্যাকআপ ইমপোর্ট', 'Choose a backup file': 'ব্যাকআপ ফাইল নির্বাচন করুন', 'Import preview': 'ইমপোর্ট প্রিভিউ', 'records detected': 'রেকর্ড পাওয়া গেছে', 'possible conflicts': 'সম্ভাব্য দ্বন্দ্ব', 'validation errors': 'ভ্যালিডেশন ত্রুটি', 'Keep Existing': 'বিদ্যমানটি রাখুন', 'Skip': 'এড়িয়ে যান', 'Replace': 'প্রতিস্থাপন করুন', 'Create New Copy': 'নতুন কপি তৈরি করুন',
  'Settings': 'সেটিংস', 'Save settings': 'সেটিংস সংরক্ষণ', 'Clinic identity': 'ক্লিনিক পরিচয়', 'Localization': 'লোকালাইজেশন', 'Numbering & control': 'নম্বরিং ও নিয়ন্ত্রণ', 'Privacy & security': 'গোপনীয়তা ও নিরাপত্তা', 'Clinic / practice name': 'ক্লিনিক / প্র্যাকটিসের নাম', 'Chamber / branch': 'চেম্বার / শাখা', 'Dentist name': 'ডেন্টিস্টের নাম', 'Professional title': 'পেশাগত উপাধি', 'Default language': 'ডিফল্ট ভাষা', 'Timezone': 'টাইমজোন', 'Date format': 'তারিখের ফরম্যাট', 'Time format': 'সময়ের ফরম্যাট', 'Patient code prefix': 'রোগী কোডের প্রিফিক্স', 'Invoice prefix': 'ইনভয়েস প্রিফিক্স', 'Appointment prefix': 'অ্যাপয়েন্টমেন্ট প্রিফিক্স', 'Queue serial prefix': 'সিরিয়াল প্রিফিক্স', 'Application lock': 'অ্যাপ্লিকেশন লক', 'Set application PIN': 'অ্যাপ্লিকেশন পিন সেট করুন', 'Change PIN': 'পিন পরিবর্তন করুন', 'Disable': 'বন্ধ করুন', 'Lock workspace': 'ওয়ার্কস্পেস লক করুন', 'Workspace locked': 'ওয়ার্কস্পেস লক করা হয়েছে', 'WORKSPACE LOCKED': 'ওয়ার্কস্পেস লক করা হয়েছে', 'Enter your application PIN': 'আপনার অ্যাপ্লিকেশন পিন দিন', 'This local workspace is protected. Your records remain on this device.': 'এই স্থানীয় ওয়ার্কস্পেস সুরক্ষিত। আপনার রেকর্ড এই ডিভাইসেই থাকে।', 'Application PIN': 'অ্যাপ্লিকেশন পিন', 'Unlock workspace': 'ওয়ার্কস্পেস আনলক করুন', 'Forgotten PINs cannot be recovered by Dentiva Pro. Use a verified backup according to your clinic policy.': 'ভুলে যাওয়া পিন Dentiva Pro থেকে পুনরুদ্ধার করা যায় না। আপনার ক্লিনিকের নীতি অনুযায়ী যাচাইকৃত ব্যাকআপ ব্যবহার করুন।', 'New PIN': 'নতুন পিন', 'Confirm PIN': 'পিন নিশ্চিত করুন', 'Change application PIN': 'অ্যাপ্লিকেশন পিন পরিবর্তন করুন', 'Enable application lock': 'অ্যাপ্লিকেশন লক চালু করুন', 'Update PIN': 'পিন আপডেট করুন',
  'Help centre': 'সহায়তা কেন্দ্র', 'About Dentiva Pro': 'Dentiva Pro পরিচিতি', 'Professional dental practice management for Bangladesh.': 'বাংলাদেশের জন্য পেশাদার ডেন্টাল প্র্যাকটিস ম্যানেজমেন্ট।', 'Privacy': 'গোপনীয়তা', 'Local data promise': 'স্থানীয় ডেটার প্রতিশ্রুতি', 'Your practice data stays yours.': 'আপনার প্র্যাকটিসের ডেটা আপনারই থাকে।', 'Creator': 'নির্মাতা', 'Offline-first': 'অফলাইন-প্রথম', 'Light mode': 'লাইট মোড', 'Local privacy': 'স্থানীয় গোপনীয়তা',
  'Sign in to Dentiva Pro': 'Dentiva Pro-তে সাইন ইন করুন', 'LOCAL ACCOUNT SIGN-IN': 'স্থানীয় অ্যাকাউন্টে সাইন ইন', 'User': 'ব্যবহারকারী', 'PIN': 'পিন', 'Enter your local PIN': 'আপনার স্থানীয় পিন দিন', 'Sign in': 'সাইন ইন', 'Contact an Administrator if your account is disabled or your PIN is forgotten.': 'অ্যাকাউন্ট নিষ্ক্রিয় হলে বা পিন ভুলে গেলে অ্যাডমিনিস্ট্রেটরের সঙ্গে যোগাযোগ করুন।', 'User accounts': 'ব্যবহারকারী অ্যাকাউন্ট', 'Access control': 'অ্যাক্সেস নিয়ন্ত্রণ', 'Add user account': 'ব্যবহারকারী অ্যাকাউন্ট যোগ করুন', 'Create a secure user account': 'নিরাপদ ব্যবহারকারী অ্যাকাউন্ট তৈরি করুন', 'Edit account access': 'অ্যাকাউন্ট অ্যাক্সেস সম্পাদনা', 'Full name': 'পূর্ণ নাম', 'Role template': 'রোল টেমপ্লেট', 'Associated staff member': 'সংযুক্ত স্টাফ সদস্য', 'Account status': 'অ্যাকাউন্টের অবস্থা', 'New PIN (leave blank to keep current)': 'নতুন পিন (বর্তমান রাখতে খালি রাখুন)', 'Effective permissions': 'কার্যকর অনুমতি', 'Create account': 'অ্যাকাউন্ট তৈরি করুন', 'Save account': 'অ্যাকাউন্ট সংরক্ষণ', 'Treatment plan': 'চিকিৎসা পরিকল্পনা', 'Treatment plan is clinician-authored': 'চিকিৎসা পরিকল্পনা চিকিৎসকের তৈরি', 'New treatment plan': 'নতুন চিকিৎসা পরিকল্পনা', 'Edit treatment plan': 'চিকিৎসা পরিকল্পনা সম্পাদনা', 'Create a treatment plan': 'চিকিৎসা পরিকল্পনা তৈরি করুন', 'Plan title': 'পরিকল্পনার শিরোনাম', 'Clinical goal': 'ক্লিনিক্যাল লক্ষ্য', 'Plan status': 'পরিকল্পনার অবস্থা', 'Start date': 'শুরুর তারিখ', 'Review date': 'পর্যালোচনার তারিখ', 'Stages': 'ধাপসমূহ', 'Financial statement': 'আর্থিক বিবরণী', 'Print statement': 'বিবরণী প্রিন্ট', 'Total charges': 'মোট চার্জ', 'No financial activity': 'কোনো আর্থিক কার্যক্রম নেই', 'Running balance': 'চলমান ব্যালান্স', 'Stage name': 'ধাপের নাম',
  'Add patient': 'রোগী যোগ করুন', 'Add staff member': 'স্টাফ সদস্য যোগ করুন', 'Add supplier': 'সরবরাহকারী যোগ করুন', 'Add treatment': 'চিকিৎসা যোগ করুন', 'Adjust stock': 'স্টক সমন্বয় করুন', 'Attach file': 'ফাইল সংযুক্ত করুন', 'Book appointment': 'অ্যাপয়েন্টমেন্ট বুক করুন', 'Check in patient': 'রোগী চেক-ইন করুন', 'Download original': 'মূল ফাইল ডাউনলোড', 'Edit': 'সম্পাদনা', 'Edit supplier': 'সরবরাহকারী সম্পাদনা', 'Export PDF': 'PDF এক্সপোর্ট', 'Export patients CSV': 'রোগীর CSV এক্সপোর্ট', 'Export preserved data': 'সংরক্ষিত ডেটা এক্সপোর্ট', 'Export verified backup': 'যাচাইকৃত ব্যাকআপ এক্সপোর্ট', 'Filters': 'ফিল্টার', 'Saved views': 'সংরক্ষিত ভিউ', 'Save view': 'ভিউ সংরক্ষণ', 'Patient views': 'রোগী ভিউ', 'Save this patient view': 'এই রোগী ভিউ সংরক্ষণ করুন', 'Keep the current search and patient filters available for the next visit.': 'বর্তমান সার্চ ও রোগী ফিল্টার পরের ভিজিটের জন্য সংরক্ষণ করুন।', 'View name': 'ভিউয়ের নাম', 'No saved searches': 'কোনো সংরক্ষিত সার্চ নেই', 'Save a patient search to reuse it here.': 'এখানে পুনরায় ব্যবহার করতে একটি রোগী সার্চ সংরক্ষণ করুন।', 'Load': 'লোড', 'Done': 'সম্পন্ন', 'Reset layout': 'লেআউট রিসেট', 'Use the arrows to reorder enabled cards.': 'তীর চিহ্ন ব্যবহার করে সক্রিয় কার্ড সাজান।', 'Full timeline': 'সম্পূর্ণ টাইমলাইন', 'Import CSV': 'CSV ইমপোর্ট', 'Inventory is empty': 'ইনভেন্টরি খালি', 'Manage user accounts': 'ব্যবহারকারী অ্যাকাউন্ট পরিচালনা', 'New referral': 'নতুন রেফারেল', 'No activity yet': 'এখনও কোনো কার্যক্রম নেই', 'No appointments in today’s queue': 'আজকের সিরিয়ালে কোনো অ্যাপয়েন্টমেন্ট নেই', 'No audit events match': 'কোনো অডিট ইভেন্ট মেলেনি', 'No invoices yet': 'এখনও কোনো ইনভয়েস নেই', 'No matching records': 'কোনো মিলযুক্ত রেকর্ড নেই', 'No prescriptions yet': 'এখনও কোনো প্রেসক্রিপশন নেই', 'No treatment plans yet': 'এখনও কোনো চিকিৎসা পরিকল্পনা নেই', 'No user accounts yet': 'এখনও কোনো ব্যবহারকারী অ্যাকাউন্ট নেই', 'Open data management': 'ডেটা ব্যবস্থাপনা খুলুন', 'Open full chart': 'সম্পূর্ণ চার্ট খুলুন', 'Open payments': 'পেমেন্ট খুলুন', 'Restore backup': 'ব্যাকআপ পুনরুদ্ধার', 'Open quick search': 'দ্রুত সার্চ খুলুন', 'Open settings': 'সেটিংস খুলুন', 'Print': 'প্রিন্ট', 'Print chart': 'চার্ট প্রিন্ট', 'Print report': 'রিপোর্ট প্রিন্ট', 'Record visit': 'ভিজিট রেকর্ড', 'Refund': 'রিফান্ড', 'Remove logo': 'লোগো সরান', 'Reset this workspace': 'এই ওয়ার্কস্পেস রিসেট করুন', 'Save chart note': 'চার্ট নোট সংরক্ষণ', 'Today’s Queue': 'আজকের সিরিয়াল', 'Day': 'দিন', 'Week': 'সপ্তাহ', 'Month': 'মাস', 'Agenda': 'এজেন্ডা', 'Upcoming agenda': 'আসন্ন এজেন্ডা', 'Upload clinic logo': 'ক্লিনিক লোগো আপলোড', 'Validate and restore selection': 'নির্বাচন যাচাই ও পুনরুদ্ধার', 'View audit trail': 'অডিট ট্রেইল দেখুন'
};
Object.assign(BENGALI, {
  Analytics: 'বিশ্লেষণ', Notifications: 'নোটিফিকেশন', Diagnostics: 'ডায়াগনস্টিকস', 'Command centre': 'কমান্ড সেন্টার', 'Search your workspace': 'ওয়ার্কস্পেসে খুঁজুন', Commands: 'কমান্ড', Command: 'কমান্ড', 'Open analytics': 'বিশ্লেষণ খুলুন', 'Open reports': 'রিপোর্ট খুলুন', 'Run integrity check': 'ইন্টিগ্রিটি চেক চালান', 'Workspace health': 'ওয়ার্কস্পেসের স্বাস্থ্য', Healthy: 'স্বাস্থ্যকর', 'Needs attention': 'মনোযোগ প্রয়োজন', 'Database health': 'ডেটাবেসের স্বাস্থ্য', 'Access health': 'অ্যাক্সেসের স্বাস্থ্য', 'Integrity results': 'ইন্টিগ্রিটি ফলাফল', 'No current integrity issues': 'বর্তমানে কোনো ইন্টিগ্রিটি সমস্যা নেই', 'Revenue and visit trend': 'আয় ও ভিজিটের প্রবণতা', 'Payment mix': 'পরিশোধের ধরন', 'Clinical activity': 'ক্লিনিক্যাল কার্যক্রম', 'Commercial review': 'বাণিজ্যিক পর্যালোচনা', 'Patient alert': 'রোগীর সতর্কতা', 'Important alert': 'গুরুত্বপূর্ণ সতর্কতা', 'Preferred contact method': 'পছন্দের যোগাযোগ মাধ্যম', Tags: 'ট্যাগ', Procedures: 'প্রক্রিয়াসমূহ', 'Tooth number(s)': 'দাঁতের নম্বর', 'Estimated duration (minutes)': 'আনুমানিক সময় (মিনিট)', 'Estimated cost': 'আনুমানিক খরচ', Discount: 'ছাড়', 'Estimated total': 'আনুমানিক মোট', 'Additional medicines': 'অতিরিক্ত ওষুধ', 'Mark all read': 'সব পড়া হিসেবে চিহ্নিত করুন', Open: 'খুলুন', Dismiss: 'সরান', 'No payment data': 'কোনো পরিশোধের তথ্য নেই', 'No matching records': 'কোনো মিলযুক্ত রেকর্ড নেই', 'Review': 'পর্যালোচনা', 'Low stock': 'স্টক কম', 'Expiry review': 'মেয়াদ পর্যালোচনা', 'Queue attention': 'সিরিয়ালে মনোযোগ প্রয়োজন', 'Backup recommended': 'ব্যাকআপ নেওয়া উচিত'
});
function localized(value) { return state.settings.language === 'Bengali' ? (BENGALI[value] || value) : value; }
function translateDom() {
  if (state.settings.language !== 'Bengali' || !app) return;
  const entries = Object.entries(BENGALI).sort((a, b) => b[0].length - a[0].length);
  const translate = (value) => entries.reduce((result, [english, bengali]) => result.includes(english) ? result.split(english).join(bengali) : result, String(value || ''));
  const walker = document.createTreeWalker(app, 4);
  let node;
  while ((node = walker.nextNode())) {
    const raw = node.nodeValue || '';
    if (raw.trim()) node.nodeValue = translate(raw);
  }
  app.querySelectorAll('[placeholder], [title], [aria-label]').forEach((element) => {
    ['placeholder', 'title', 'aria-label'].forEach((attribute) => {
      const value = element.getAttribute(attribute);
      if (value) element.setAttribute(attribute, translate(value));
    });
  });
}

const NAV_GROUPS = [
  { label: 'Workspace', items: [['dashboard', 'Dashboard', 'grid'], ['patients', 'Patients', 'users'], ['appointments', 'Appointments', 'calendar'], ['queue', 'Today\'s Queue', 'clipboard']] },
  { label: 'Clinical', items: [['clinical', 'Clinical Records', 'activity'], ['prescriptions', 'Prescriptions', 'file'], ['dental', 'Dental Chart', 'tooth'], ['treatments', 'Treatment Catalog', 'layers']] },
  { label: 'Finance', items: [['billing', 'Billing', 'receipt'], ['payments', 'Payments', 'credit'], ['accounting', 'Accounting', 'dollar']] },
  { label: 'Operations', items: [['inventory', 'Inventory', 'box'], ['suppliers', 'Suppliers', 'truck'], ['staff', 'Staff', 'briefcase']] },
  { label: 'Insights', items: [['reports', 'Reports', 'chart'], ['analytics', 'Analytics', 'activity']] },
  { label: 'System', items: [['notifications', 'Notifications', 'bell'], ['backup', 'Backup & Restore', 'backup'], ['diagnostics', 'Diagnostics', 'database'], ['users', 'User Accounts', 'users'], ['settings', 'Settings', 'settings'], ['help', 'Help', 'help'], ['about', 'About', 'info']] }
];

function currency(value = 0) {
  const amount = Number(value) || 0;
  try {
    return new Intl.NumberFormat(state.settings.language === 'Bengali' ? 'bn-BD' : 'en-BD', { style: 'currency', currency: state.settings.currency || 'BDT', currencyDisplay: 'narrowSymbol', maximumFractionDigits: 2 }).format(amount);
  } catch {
    return `৳${amount.toFixed(2)}`;
  }
}
function number(value = 0) { return new Intl.NumberFormat(state.settings.language === 'Bengali' ? 'bn-BD' : 'en-BD').format(Number(value) || 0); }
function date(value, opts = {}) {
  if (!value) return '—';
  const parsed = new Date(`${value}T00:00:00`);
  if (Number.isNaN(parsed.getTime())) return '—';
  return new Intl.DateTimeFormat(state.settings.language === 'Bengali' ? 'bn-BD' : 'en-GB', { day: '2-digit', month: 'short', year: 'numeric', ...opts }).format(parsed);
}
function ageFromDate(value) { if (!value) return null; const birth = new Date(`${value}T00:00:00`); if (Number.isNaN(birth.getTime())) return null; const current = new Date(); let years = current.getFullYear() - birth.getFullYear(); const beforeBirthday = current.getMonth() < birth.getMonth() || (current.getMonth() === birth.getMonth() && current.getDate() < birth.getDate()); if (beforeBirthday) years -= 1; return years >= 0 && years < 130 ? years : null; }
function minutesSince(value) { if (!value) return 0; const parsed = new Date(value).getTime(); return Number.isFinite(parsed) ? Math.max(0, Math.floor((Date.now() - parsed) / 60000)) : 0; }
function time(value) {
  if (!value) return '—';
  const [h, m] = value.split(':').map(Number);
  const d = new Date(); d.setHours(h || 0, m || 0, 0, 0);
  return new Intl.DateTimeFormat(state.settings.language === 'Bengali' ? 'bn-BD' : 'en-BD', { hour: 'numeric', minute: '2-digit', hour12: state.settings.timeFormat !== '24-hour' }).format(d);
}
function relativeDate(value) {
  if (!value) return '—';
  const diff = Math.round((new Date(`${value}T00:00:00`) - new Date(`${today()}T00:00:00`)) / 86400000);
  if (diff === 0) return 'Today';
  if (diff === 1) return 'Tomorrow';
  if (diff === -1) return 'Yesterday';
  return date(value, { day: 'numeric', month: 'short' });
}
function initials(value = '') { return value.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]).join('').toUpperCase() || 'DP'; }
function patientName(id) { return state.patients.find((p) => p.id === id)?.fullName || 'Unassigned patient'; }
function staffName(id) { return state.staff.find((p) => p.id === id)?.name || state.settings.dentistName || 'Primary dentist'; }
function currentUser() { if (ui.authenticatedUserId) return state.users?.find((user) => user.id === ui.authenticatedUserId && user.active !== false) || null; if (state.users?.some((user) => user.active !== false && user.pinHash)) return null; return state.users?.find((user) => user.role === 'Administrator' && user.active !== false) || state.users?.find((user) => user.active !== false) || null; }
function requiresLogin() { return Boolean(state.users?.some((user) => user.active !== false && user.pinHash) && !ui.authenticatedUserId); }
function can(permission) { return !state.users?.length || hasPermission(currentUser(), permission); }
function requirePermission(permission, message = 'Your account is not allowed to perform this action.') { if (can(permission)) return true; notify(message, 'error'); return false; }
function permissionForPatientTab(tab) { return { visits: 'clinical.view', appointments: 'appointments.view', 'treatment-plan': 'clinical.view', dental: 'clinical.view', prescriptions: 'prescriptions.view', billing: 'billing.view', payments: 'payments.view', statement: 'billing.view', attachments: 'clinical.view', referrals: 'clinical.view', followups: 'clinical.view', notes: 'patients.view', audit: 'audit.view', timeline: 'patients.view' }[tab] || 'patients.view'; }
function nextCode(kind, settingKey) {
  const n = state.counters[kind] || 1;
  state.counters[kind] = n + 1;
  const prefix = state.settings[settingKey] || kind.slice(0, 3).toUpperCase();
  return `${prefix}-${String(n).padStart(4, '0')}`;
}
function active(list) { return list.filter((item) => !item.archived); }
function byId(list, id) { return list.find((item) => item.id === id); }
function sum(list, getter) { return list.reduce((total, item) => total + (Number(getter(item)) || 0), 0); }
function paymentRefundedAmount(payment) {
  const directRefund = numeric(payment.refundedAmount);
  const adjustmentRefund = sum(active(state.paymentAdjustments || []).filter((adjustment) => adjustment.paymentId === payment.id && adjustment.type === 'Refund'), (adjustment) => adjustment.amount);
  return Math.max(0, directRefund + adjustmentRefund);
}
function paymentAmount(payment) { return Math.max(0, numeric(payment.amount) - paymentRefundedAmount(payment)); }
function invoicePaymentStatus(invoice) {
  if (!invoice) return { paid: 0, due: 0, status: 'Unpaid' };
  const payments = active(state.payments).filter((payment) => payment.invoiceId === invoice.id).map((payment) => ({ ...payment, amount: paymentAmount(payment), refundedAmount: 0 }));
  return paymentStatusFor(invoice.total, payments);
}
function paymentMethods() { return [...new Set(['Cash', 'Bank', 'Card', ...(state.settings.paymentMethods || [])].map((method) => String(method).trim()).filter(Boolean))]; }
function expenseCategories() { return [...new Set([...(state.settings.expenseCategories || []), 'Other'])]; }
function inventoryCategories() { return [...new Set([...(state.settings.inventoryCategories || []), 'Other'])]; }
function monthLabel(month = ui.calendarMonth, year = ui.calendarYear) { return new Intl.DateTimeFormat('en-US', { month: 'long', year: 'numeric' }).format(new Date(year, month, 1)); }
function daysInMonth(month, year) { return new Date(year, month + 1, 0).getDate(); }
function startOffset(month, year) { return new Date(year, month, 1).getDay(); }
function pageTitle() {
  const item = NAV_GROUPS.flatMap((group) => group.items).find(([id]) => id === ui.page);
  return localized(item?.[1] || 'Dashboard');
}

function notify(message, type = 'success') {
  const toastId = uid('toast');
  ui.toast = { message, type, id: toastId };
  render();
  window.clearTimeout(notify.timer);
  notify.timer = window.setTimeout(() => { if (ui.toast?.id === toastId) { ui.toast = null; render(); } }, 3600);
}
function resetActivityTimer() {
  window.clearTimeout(ui.activityTimer);
  if (ui.locked || !state.settings.applicationLock || !state.settings.autoLockMinutes) return;
  const minutes = clamp(Number(state.settings.autoLockMinutes) || 30, 1, 240);
  ui.activityTimer = window.setTimeout(() => lockWorkspace('Automatic inactivity lock'), minutes * 60 * 1000);
}
function recordActivity() {
  if (!ui.locked) resetActivityTimer();
}
function lockWorkspace(reason = 'Workspace locked') {
  if (!state.settings.applicationLock || !state.settings.pinHash) return notify('Set an application PIN in Settings first.', 'error');
  ui.modal = null;
  ui.authenticatedUserId = null;
  ui.locked = true;
  ui.toast = null;
  audit(reason, 'Security', '', reason);
  Store.save(state);
  render();
}
function audit(action, entity, recordId = '', summary = '') {
  state.audit.unshift({ id: uid('audit'), at: now(), action, entity, recordId, summary, user: currentUser()?.name || state.settings.dentistName || 'Local administrator', userId: currentUser()?.id || '' });
  state.audit = state.audit.slice(0, 5000);
}
function commit(message, entity = 'System', recordId = '') {
  if (message) audit(message, entity, recordId, message);
  Store.save(state);
  render();
}
function downloadBlob(content, filename, type = 'application/json') {
  const blob = content instanceof Blob ? content : new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a'); link.href = url; link.download = filename; link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 500);
}
function jsonDownload(data, filename) { downloadBlob(JSON.stringify(data, null, 2), filename, 'application/json'); }
function csvEscape(value) { return `"${String(value ?? '').replace(/"/g, '""')}"`; }
function downloadCsv(rows, filename) {
  if (!rows.length) { notify('There are no records to export yet.', 'info'); return; }
  const headers = Object.keys(rows[0]);
  const csv = '\ufeff' + [headers.map(csvEscape).join(','), ...rows.map((row) => headers.map((h) => csvEscape(row[h])).join(','))].join('\n');
  downloadBlob(csv, filename, 'text/csv;charset=utf-8');
}
function printDocumentMarkup(title, content, pageSize = state.settings.printPageSize || 'A4') {
  const safePageSize = ['A4', 'Letter', 'Legal', 'A3', 'A5', 'Receipt'].includes(pageSize) ? pageSize : 'A4';
  const template = state.settings.documentTemplate || {};
  const logoSource = template.showLogo !== false ? safeLogoSource(state.settings.logo) : '';
  const logo = logoSource ? `<img src="${attr(logoSource)}" alt="" style="height:48px;max-width:160px;object-fit:contain;">` : `<div class="print-mark">DP</div>`;
  const clinicContact = template.showClinicContact === false ? '' : `<div class="muted">${esc(state.settings.dentistName || 'Professional Dental Practice')} · ${esc(state.settings.phone || '')}<br>${esc(state.settings.address || '')}</div>`;
  const footerText = String(template.footer || 'Generated by Dentiva Pro').trim() || 'Generated by Dentiva Pro';
  return `<!doctype html><html lang="${state.settings.language === 'Bengali' ? 'bn' : 'en'}"><head><meta charset="utf-8"><title>${esc(title)}</title><style>
    @page{size:${safePageSize === 'Receipt' ? '80mm auto' : safePageSize};margin:10mm}*{box-sizing:border-box}body{font:13px Arial,sans-serif;color:#202b31;margin:0;padding:32px;background:#fff}header{display:flex;align-items:flex-start;justify-content:space-between;border-bottom:2px solid #0c6b70;padding-bottom:18px;margin-bottom:24px}.brand{display:flex;gap:12px;align-items:center}.print-mark{width:46px;height:46px;border-radius:14px;background:#0c6b70;color:#fff;display:grid;place-items:center;font-weight:700}.clinic{font-size:18px;font-weight:700}.muted{color:#68747b;font-size:11px;line-height:1.6}h1{font-size:22px;margin:0 0 4px}h2{font-size:15px;margin:22px 0 10px}.print-table{width:100%;border-collapse:collapse}.print-table th,.print-table td{padding:8px 10px;border-bottom:1px solid #dfe5e5;text-align:left}.print-table th{background:#f1f5f5;font-size:11px;text-transform:uppercase;letter-spacing:.06em}.summary{display:flex;gap:24px;margin:12px 0 18px}.summary strong{display:block;font-size:18px}.right{text-align:right}.document-note{color:#68747b;font-size:11px;margin-top:20px}@media print{body{padding:0}button{display:none}}
  </style></head><body><header><div class="brand">${logo}<div><div class="clinic">${esc(state.settings.clinicName || 'Dentiva Pro')}</div>${clinicContact}</div></div><div class="right muted">${date(today())}<br>${esc(state.settings.email || '')}</div></header><h1>${esc(title)}</h1>${content}<footer class="muted" style="margin-top:32px;border-top:1px solid #dfe5e5;padding-top:12px">${esc(footerText)} · ${APP_VERSION}</footer></body></html>`;
}
function printHtml(title, content, pageSize = state.settings.printPageSize || 'A4') {
  const printWindow = window.open('', '_blank', 'noopener,noreferrer,width=900,height=700');
  if (!printWindow) { notify('Allow pop-ups to use print preview.', 'error'); return; }
  printWindow.document.write(printDocumentMarkup(title, content, pageSize));
  printWindow.document.close();
  printWindow.focus();
  window.setTimeout(() => printWindow.print(), 250);
}
async function exportPdf(title, content, pageSize = state.settings.printPageSize || 'A4') {
  const markup = printDocumentMarkup(title, content, pageSize);
  if (window.dentivaDesktop?.printHtmlPdf) {
    try {
      const base64 = await window.dentivaDesktop.printHtmlPdf(markup, { pageSize });
      const bytes = Uint8Array.from(atob(base64), (character) => character.charCodeAt(0));
      downloadBlob(new Blob([bytes], { type: 'application/pdf' }), `${sanitizeFilename(title, 'dentiva-document')}.pdf`, 'application/pdf');
      notify('PDF exported.');
      return;
    } catch (error) {
      console.error('PDF export failed', error);
      notify('PDF export failed. Use print preview and choose Save as PDF.', 'error');
      return;
    }
  }
  printHtml(title, content);
  notify('Print preview opened. Choose Save as PDF to create a PDF.');
}


function navItem(id, label, iconName) {
  const activeClass = ui.page === id ? 'active' : '';
  return `<button class="nav-item ${activeClass}" data-action="navigate" data-page="${id}" aria-current="${ui.page === id ? 'page' : 'false'}" title="${esc(localized(label))}">${icon(iconName, 18)}<span>${esc(localized(label))}</span></button>`;
}
function sidebar() {
  return `<aside class="sidebar ${ui.sidebarCollapsed ? 'collapsed' : ''} ${ui.mobileNav ? 'mobile-open' : ''}">
    <div class="brand-lockup"><div class="brand-symbol">${icon('tooth', 22)}</div><div class="brand-copy"><strong>DENTIVA<span> PRO</span></strong><small>Practice workspace</small></div><button class="icon-button sidebar-close" data-action="toggle-mobile-nav" aria-label="Close navigation">${icon('close', 17)}</button></div>
    <div class="clinic-switcher"><div class="clinic-avatar">${initials(state.settings.clinicName || 'DP')}</div><div class="clinic-meta"><strong>${esc(state.settings.clinicName || 'Your practice')}</strong><span>${state.setupComplete ? esc(state.settings.chamberName || 'Offline workspace') : 'Setup required'}</span></div><span class="online-dot" title="Local data store"></span></div>
    <nav class="primary-nav" aria-label="Primary navigation">${NAV_GROUPS.map((group) => `<div class="nav-group"><div class="nav-group-label">${esc(group.label)}</div>${group.items.map(([id, label, ico]) => navItem(id, label, ico)).join('')}</div>`).join('')}</nav>
    <div class="sidebar-footer"><div class="privacy-note">${icon('shield', 15)}<span>Private & local<br><small>No cloud required</small></span></div><button class="collapse-button" data-action="toggle-sidebar">${icon(ui.sidebarCollapsed ? 'arrow' : 'chevron', 16)}<span>${ui.sidebarCollapsed ? 'Expand menu' : 'Collapse menu'}</span></button></div>
  </aside>`;
}
function topbar() {
  const unread = notificationItems().filter((n) => !n.read).length;
  const user = currentUser();
  return `<header class="topbar"><div class="topbar-left"><button class="icon-button menu-button" data-action="toggle-mobile-nav" aria-label="Open navigation">${icon('menu', 20)}</button><div class="breadcrumb"><span>${esc(localized('Workspace'))}</span>${ui.page !== 'dashboard' ? `${icon('chevron', 13)}<strong>${esc(pageTitle())}</strong>` : ''}</div></div><div class="topbar-actions"><button class="global-search" data-action="open-search" aria-label="Search"><span>${icon('search', 17)}<span>${esc(localized('Search anything'))}</span></span><kbd>Ctrl K</kbd></button><button class="icon-button notification-button" data-action="open-notifications" aria-label="Notifications">${icon('bell', 19)}${unread ? `<b>${unread > 9 ? '9+' : unread}</b>` : ''}</button><div class="topbar-divider"></div><button class="user-menu" data-action="open-user-menu"><span class="avatar avatar-small">${initials(user?.name || state.settings.dentistName || 'Dr')}</span><span class="user-meta"><strong>${esc(user?.name || state.settings.dentistName || 'Practice admin')}</strong><small>${esc(user?.role || state.settings.professionalTitle || 'Administrator')}</small></span>${icon('down', 14)}</button></div></header>`;
}
function bytesToHex(bytes) { return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join(''); }
function hexToBytes(hex) { return Uint8Array.from((hex.match(/.{1,2}/g) || []).map((pair) => Number.parseInt(pair, 16))); }
async function hashPin(pin, saltHex = '') {
  if (!globalThis.crypto?.subtle || !globalThis.crypto?.getRandomValues) throw new Error('Secure local PIN hashing is unavailable in this environment.');
  const salt = saltHex || bytesToHex(globalThis.crypto.getRandomValues(new Uint8Array(16)));
  const key = await globalThis.crypto.subtle.importKey('raw', new TextEncoder().encode(pin), { name: 'PBKDF2' }, false, ['deriveBits']);
  const bits = await globalThis.crypto.subtle.deriveBits({ name: 'PBKDF2', salt: hexToBytes(salt), iterations: 120000, hash: 'SHA-256' }, key, 256);
  return { salt, hash: bytesToHex(new Uint8Array(bits)) };
}
function authScreen() {
  const users = (state.users || []).filter((user) => user.active !== false);
  return `<main class="lock-screen"><section class="lock-card auth-card"><div class="lock-brand"><span class="brand-symbol">${icon('tooth', 23)}</span><strong>DENTIVA<span> PRO</span></strong></div><div class="lock-icon">${icon('user', 28)}</div><span class="eyebrow">LOCAL ACCOUNT SIGN-IN</span><h1>Sign in to Dentiva Pro</h1><p>Choose your local practice account. Credentials never leave this device.</p><form data-form="user-login" class="lock-form">${selectField('User', 'userId', users.map((user) => [user.id, `${user.name} · ${user.role}`]), users[0]?.id || '')}${field('PIN', 'pin', '', 'password', 'required inputmode="numeric" autocomplete="current-password" placeholder="Enter your local PIN" autofocus')}<button class="btn btn-primary btn-wide" type="submit">${icon('unlock', 16)}<span>Sign in</span></button></form>${ui.toast?.type === 'error' ? `<p class="lock-error">${esc(ui.toast.message)}</p>` : ''}<small class="lock-help">Contact an Administrator if your account is disabled or your PIN is forgotten.</small></section></main>`;
}
function unsupportedSchemaScreen() {
  return `<main class="lock-screen"><section class="lock-card schema-warning"><div class="lock-brand"><span class="brand-symbol">${icon('tooth', 23)}</span><strong>DENTIVA<span> PRO</span></strong></div><div class="lock-icon warning">${icon('warning', 28)}</div><span class="eyebrow">UPGRADE REQUIRED</span><h1>Workspace needs a newer Dentiva Pro</h1><p>${esc(state.migrationError || 'This workspace was created by a newer version.')}</p><p class="lock-help">Your local data has been preserved and will not be overwritten. Export the preserved workspace, then open it with a compatible Dentiva Pro release.</p><div class="schema-actions">${button('Export preserved data', 'export-unsupported-store', 'download', 'secondary')}${button('Reset this workspace', 'reset-workspace', 'trash', 'link')}</div></section></main>`;
}

function lockScreen() {
  return `<main class="lock-screen"><section class="lock-card"><div class="lock-brand"><span class="brand-symbol">${icon('tooth', 23)}</span><strong>DENTIVA<span> PRO</span></strong></div><div class="lock-icon">${icon('lock', 28)}</div><span class="eyebrow">WORKSPACE LOCKED</span><h1>Enter your application PIN</h1><p>This local workspace is protected. Your records remain on this device.</p><form data-form="unlock" class="lock-form">${field('Application PIN', 'pin', '', 'password', 'required inputmode="numeric" autocomplete="current-password" placeholder="Enter 4–12 digits" autofocus')}<button class="btn btn-primary btn-wide" type="submit">${icon('unlock', 16)}<span>Unlock workspace</span></button></form>${ui.toast?.type === 'error' ? `<p class="lock-error">${esc(ui.toast.message)}</p>` : ''}<small class="lock-help">Forgotten PINs cannot be recovered by Dentiva Pro. Use a verified backup according to your clinic policy.</small></section></main>`;
}
function shell() {
  return `<div class="app-shell">${sidebar()}<div class="main-shell">${topbar()}<main class="main-content" id="main-content">${renderPage()}</main></div>${ui.modal ? modal() : ''}${ui.toast ? `<div class="toast toast-${ui.toast.type}">${icon(ui.toast.type === 'error' ? 'warning' : ui.toast.type === 'info' ? 'info' : 'check', 17)}<span>${esc(ui.toast.message)}</span><button class="toast-close" data-action="close-toast">${icon('close', 14)}</button></div>` : ''}</div>`;
}
function pageHeader(title, subtitle, action = '') {
  return `<div class="page-header"><div><div class="eyebrow">${esc(state.settings.clinicName || 'Dentiva Pro')}</div><h1>${esc(localized(title))}</h1><p>${esc(localized(subtitle))}</p></div>${action ? `<div class="page-actions">${action}</div>` : ''}</div>`;
}
function button(label, action, iconName = '', style = 'secondary', extra = '') {
  return `<button class="btn btn-${style}" data-action="${action}" ${extra}>${iconName ? icon(iconName, 16) : ''}<span>${esc(localized(label))}</span></button>`;
}
function badge(label, tone = 'neutral') { return `<span class="badge badge-${tone}"><i></i>${esc(localized(label))}</span>`; }
function emptyState(iconName, title, text, action = '') { return `<div class="empty-state">${icon(iconName, 27, 'empty-icon')}<h3>${esc(localized(title))}</h3><p>${esc(localized(text))}</p>${action}</div>`; }
function cardTitle(iconName, title, action = '') { return `<div class="card-title"><div class="card-title-text">${icon(iconName, 17)}<h2>${esc(localized(title))}</h2></div>${action}</div>`; }
function statusTone(status = '') {
  const normalized = status.toLowerCase().replace(/\s+/g, '-');
  if (['completed', 'paid', 'active', 'checked-in', 'in-treatment', 'healthy', 'in-stock'].includes(normalized)) return 'success';
  if (['waiting', 'partially-paid', 'partial', 'scheduled', 'caries', 'low-stock'].includes(normalized)) return 'warning';
  if (['cancelled', 'no-show', 'unpaid', 'out-of-stock', 'expired', 'archived'].includes(normalized)) return 'danger';
  return 'neutral';
}
function statusBadge(status) { return badge(status || 'Not set', statusTone(status)); }
const NOTIFICATION_RULES = [['queue', 'Queue wait'], ['clinical', 'Clinical follow-ups'], ['inventory', 'Stock and expiry'], ['warning', 'Outstanding balances'], ['backup', 'Backup reminders']];
function notificationRuleEnabled(kind) { const rule = (state.notificationRules || []).find((item) => item.kind === kind); return rule ? rule.enabled !== false : true; }
function notificationItems() {
  if (state.settings.notifications === false) return [];
  const derived = deriveOperationalNotifications(state, today()).map((item) => { const record = [...state.appointments, ...state.visits, ...state.inventory].find((candidate) => candidate.id === item.recordId); const message = item.type === 'queue' ? `${patientName(record?.patientId)} is waiting.` : item.type === 'clinical' ? `${patientName(record?.patientId)} · follow-up is due.` : item.message; return { ...item, message }; }).filter((item) => notificationRuleEnabled(item.type));
  active(state.invoices).map((invoice) => ({ ...invoice, ...invoicePaymentStatus(invoice) })).filter((invoice) => invoice.status !== 'Paid' && invoice.status !== 'Cancelled' && invoice.due > 0 && notificationRuleEnabled('warning')).slice(0, 6).forEach((invoice) => derived.push({ id: `due-${invoice.id}`, type: 'warning', title: 'Outstanding invoice', message: `${invoice.invoiceNumber || 'Invoice'} · ${patientName(invoice.patientId)} · ${currency(invoice.due)} due`, date: invoice.date, page: 'billing', recordId: invoice.id, read: false }));
  if (state.patients.length && notificationRuleEnabled('backup') && (!state.lastBackupAt || Date.now() - new Date(state.lastBackupAt).getTime() > 7 * 86400000)) derived.push({ id: 'backup-stale', type: 'backup', title: 'Backup recommended', message: 'Export a verified backup to protect this local workspace.', date: today(), page: 'backup', read: false });
  const saved = active(state.notifications).map((item) => ({ ...item, persisted: true }));
  const seen = new Set();
  return [...derived, ...saved].filter((item) => { if (seen.has(item.id)) return false; seen.add(item.id); return true; }).map((item) => ({ ...item, read: Boolean(item.read || state.notificationRead?.[item.id]) })).slice(0, 32);
}

function renderPage() {
  const pages = {
    dashboard: renderDashboard,
    patients: renderPatients,
    appointments: renderAppointments,
    queue: renderQueue,
    clinical: renderClinical,
    prescriptions: renderPrescriptions,
    dental: renderDental,
    treatments: renderTreatments,
    billing: renderBilling,
    payments: renderPayments,
    accounting: renderAccounting,
    inventory: renderInventory,
    suppliers: renderSuppliers,
    staff: renderStaff,
    reports: renderReports,
    analytics: renderAnalytics,
    notifications: renderNotifications,
    backup: renderBackup,
    diagnostics: renderDiagnostics,
    settings: renderSettings,
    users: renderUsers,
    help: renderHelp,
    about: renderAbout
  };
  const pagePermissions = { patients: 'patients.view', appointments: 'appointments.view', queue: 'appointments.queue', clinical: 'clinical.view', prescriptions: 'prescriptions.view', dental: 'clinical.view', treatments: 'clinical.view', billing: 'billing.view', payments: 'payments.view', accounting: 'accounting.view', inventory: 'inventory.view', suppliers: 'inventory.view', staff: 'staff.view', reports: 'reports.view', analytics: 'reports.analytics', notifications: 'notifications.manage', backup: 'backup.create', diagnostics: 'diagnostics.view', settings: 'settings.view', users: 'users.manage' };
  const permission = pagePermissions[ui.page];
  return permission && !can(permission) ? permissionDeniedPage(pageTitle()) : (pages[ui.page] || renderDashboard)();
}

function setupBanner() {
  if (state.setupComplete) return '';
  const configured = [state.settings.clinicName, state.settings.dentistName, state.settings.phone, state.settings.address].filter(Boolean).length;
  return `<section class="setup-banner"><div class="setup-icon">${icon('sparkle', 21)}</div><div class="setup-copy"><strong>Make this workspace yours</strong><p>Add your clinic identity once. Your records stay on this device and can be backed up at any time.</p><div class="setup-progress"><span style="width:${configured * 25}%"></span></div><small>${configured} of 4 essentials complete</small></div>${button('Complete setup', 'open-setup', 'arrow', 'primary')}</section>`;
}
function dashboardWidget(key, markup) { return (state.dashboard || ['schedule', 'queue', 'followups', 'signals']).includes(key) ? markup : ''; }
function dashboardWidgetModal() {
  const widgets = [['schedule', 'Today’s schedule', 'Your upcoming appointments and chair flow.'], ['queue', 'Today’s queue', 'Checked-in, waiting and completed patient counts.'], ['followups', 'Follow-ups due', 'Clinical follow-up dates that need attention.'], ['signals', 'Operational signals', 'Outstanding balances, low stock and backup health.']];
  const layout = state.dashboard || ['schedule', 'queue', 'followups', 'signals'];
  return `${modalHead('DASHBOARD', 'Customize your command centre', 'Keep the signals your team needs in view. Changes are saved locally per practice workspace.')}<div class="dashboard-widget-options">${widgets.map(([key, title, description]) => { const enabled = layout.includes(key); const position = layout.indexOf(key); return `<div class="dashboard-widget-option ${enabled ? 'selected' : ''}"><button class="widget-toggle" data-action="toggle-dashboard-widget" data-widget="${key}" aria-pressed="${enabled}"><span class="widget-check">${icon(enabled ? 'check' : 'plus', 15)}</span><span><strong>${title}</strong><small>${description}</small></span></button>${enabled ? `<span class="widget-order" aria-label="Dashboard card order"><button class="icon-button tiny" data-action="move-dashboard-widget" data-widget="${key}" data-direction="up" ${position === 0 ? 'disabled' : ''} aria-label="Move ${title} up">${icon('up', 14)}</button><button class="icon-button tiny" data-action="move-dashboard-widget" data-widget="${key}" data-direction="down" ${position === layout.length - 1 ? 'disabled' : ''} aria-label="Move ${title} down">${icon('down', 14)}</button></span>` : ''}</div>`; }).join('')}</div><p class="form-note">The metric strip and shortcut actions are always available. Keep at least one operational card enabled. Use the arrows to reorder enabled cards.</p><div class="modal-footer"><button class="btn btn-link" data-action="reset-dashboard-widgets">Reset layout</button><button class="btn btn-primary" data-action="close-modal">Done</button></div>`;
}
function renderDashboard() {
  const todayAppointments = active(state.appointments).filter((a) => a.date === today()).sort((a, b) => (a.time || '').localeCompare(b.time || ''));
  const waiting = todayAppointments.filter((a) => ['Checked In', 'Waiting', 'In Treatment'].includes(a.status));
  const dashboardBounds = periodBounds(ui.range || 'today', new Date(), ui.rangeFrom, ui.rangeTo);
  const inDashboardRange = (value) => !dashboardBounds.invalid && Boolean(value) && (!dashboardBounds.from || value >= dashboardBounds.from) && (!dashboardBounds.to || value <= dashboardBounds.to);
  const rangeAppointments = active(state.appointments).filter((appointment) => inDashboardRange(appointment.date));
  const rangePatients = active(state.patients).filter((patient) => inDashboardRange(patient.registrationDate || patient.createdAt?.slice(0, 10)));
  const rangePayments = active(state.payments).filter((payment) => inDashboardRange(payment.date));
  const rangeCollected = sum(rangePayments, paymentAmount);
  const dashboardRangeLabel = { today: 'Today’s', '7d': '7-day', month: 'Monthly', quarter: 'Quarterly', '6m': '6-month', year: 'Yearly', custom: 'Custom range' }[ui.range] || 'Today’s';
  const dashboardPeriodControl = `<div class="period-picker"><span>${icon('calendar', 15)}</span><select data-change="dashboard-range"><option value="today" ${ui.range === 'today' ? 'selected' : ''}>Today</option><option value="7d" ${ui.range === '7d' ? 'selected' : ''}>Last 7 days</option><option value="month" ${ui.range === 'month' ? 'selected' : ''}>Last 1 month</option><option value="quarter" ${ui.range === 'quarter' ? 'selected' : ''}>Last 3 months</option><option value="6m" ${ui.range === '6m' ? 'selected' : ''}>Last 6 months</option><option value="year" ${ui.range === 'year' ? 'selected' : ''}>Last 1 year</option><option value="custom" ${ui.range === 'custom' ? 'selected' : ''}>Custom range</option></select>${icon('down', 14)}</div>${ui.range === 'custom' ? `<div class="period-picker period-picker-dates"><input type="date" value="${attr(ui.rangeFrom)}" data-change="dashboard-range-from" aria-label="Dashboard range from"><span>to</span><input type="date" value="${attr(ui.rangeTo)}" data-change="dashboard-range-to" aria-label="Dashboard range to"></div>` : ''}`;
  const followups = active(state.visits).filter((v) => v.followUpDate && v.followUpDate <= today()).sort((a, b) => a.followUpDate.localeCompare(b.followUpDate)).slice(0, 4);
  const lowStock = active(state.inventory).filter((i) => Number(i.currentStock) <= Number(i.minimumStock || state.settings.lowStockThreshold));
  const overdue = active(state.invoices).map((invoice) => ({ ...invoice, ...invoicePaymentStatus(invoice) })).filter((invoice) => invoice.status !== 'Paid' && invoice.status !== 'Cancelled' && invoice.due > 0);
  return `<div class="page dashboard-page">${pageHeader(`Good ${new Date().getHours() < 12 ? 'morning' : new Date().getHours() < 17 ? 'afternoon' : 'evening'}${state.settings.dentistName ? `, ${esc(state.settings.dentistName.split(' ').slice(-1)[0])}` : ''}`, 'A clear view of your practice, without the noise.', `${dashboardPeriodControl}${button('Customize dashboard', 'open-dashboard-customizer', 'settings', 'secondary')}`)}${setupBanner()}<div class="metric-grid"><div class="metric-card metric-teal"><div class="metric-top"><span class="metric-label">${dashboardRangeLabel} appointments</span><span class="metric-icon">${icon('calendar', 18)}</span></div><strong>${number(rangeAppointments.length)}</strong><small>${rangeAppointments.length ? `${rangeAppointments.filter((a) => a.status === 'Completed').length} completed in range` : 'No appointments in range'}</small></div><div class="metric-card"><div class="metric-top"><span class="metric-label">${dashboardRangeLabel} patients</span><span class="metric-icon soft-blue">${icon('users', 18)}</span></div><strong>${number(rangePatients.length)}</strong><small>${rangePatients.length ? `${number(state.patients.length)} in your directory` : 'No patients added yet'}</small></div><div class="metric-card"><div class="metric-top"><span class="metric-label">Waiting queue</span><span class="metric-icon soft-amber">${icon('clock', 18)}</span></div><strong>${number(waiting.length)}</strong><small>${waiting.length ? 'Patients need attention' : 'No one is waiting'}</small></div><div class="metric-card"><div class="metric-top"><span class="metric-label">${dashboardRangeLabel} collected</span><span class="metric-icon soft-purple">${icon('dollar', 18)}</span></div><strong>${currency(rangeCollected)}</strong><small>${rangeCollected ? 'Across recorded payments' : 'No payments recorded'}</small></div></div><div class="dashboard-grid">${dashboardWidget('schedule', `<section class="card schedule-card">${cardTitle('calendar', 'Today’s schedule', button('Open appointments', 'navigate', 'arrow', 'link', 'data-page="appointments"'))}<div class="schedule-list">${todayAppointments.length ? todayAppointments.map((a) => appointmentRow(a)).join('') : emptyState('calendar', 'Nothing booked today', 'Create an appointment to build your schedule.', button('New appointment', 'open-appointment', 'plus', 'secondary'))}</div></section>`)}${dashboardWidget('queue', `<section class="card queue-card">${cardTitle('clipboard', 'Today’s queue', button('View queue', 'navigate', 'arrow', 'link', 'data-page="queue"'))}<div class="queue-summary"><div class="queue-ring"><strong>${waiting.length}</strong><span>waiting</span></div><div class="queue-copy"><strong>${todayAppointments.length ? `${todayAppointments.length} scheduled today` : 'Your queue is ready'}</strong><p>Check patients in as they arrive and keep care moving.</p></div></div><div class="mini-status-list"><div><span class="status-dot dot-teal"></span>Checked in <strong>${todayAppointments.filter((a) => a.status === 'Checked In').length}</strong></div><div><span class="status-dot dot-amber"></span>In treatment <strong>${todayAppointments.filter((a) => a.status === 'In Treatment').length}</strong></div><div><span class="status-dot dot-green"></span>Completed <strong>${todayAppointments.filter((a) => a.status === 'Completed').length}</strong></div></div></section>`)}${dashboardWidget('followups', `<section class="card followup-card">${cardTitle('flag', 'Follow-ups due', button('Clinical records', 'navigate', 'arrow', 'link', 'data-page="clinical"'))}<div class="followup-list">${followups.length ? followups.map((v) => `<div class="followup-row"><span class="avatar avatar-xs">${initials(patientName(v.patientId))}</span><div><strong>${esc(patientName(v.patientId))}</strong><small>${esc(v.diagnosis || v.reason || 'Follow-up')} · ${relativeDate(v.followUpDate)}</small></div><span class="followup-date">${date(v.followUpDate, { day: 'numeric', month: 'short' })}</span></div>`).join('') : emptyState('flag', 'No follow-ups due', 'Follow-up dates from clinical visits will appear here.')}</div></section>`)}${dashboardWidget('signals', `<section class="card signals-card">${cardTitle('activity', 'Operational signals')}<div class="signal-list"><div class="signal-item ${overdue.length ? 'signal-warning' : ''}"><span class="signal-icon">${icon('credit', 16)}</span><div><strong>${overdue.length ? `${overdue.length} outstanding invoice${overdue.length > 1 ? 's' : ''}` : 'No outstanding balances'}</strong><small>${overdue.length ? 'Review from Billing' : 'You’re all caught up'}</small></div>${overdue.length ? badge('Review', 'warning') : icon('check', 16)}</div><div class="signal-item ${lowStock.length ? 'signal-warning' : ''}"><span class="signal-icon">${icon('box', 16)}</span><div><strong>${lowStock.length ? `${lowStock.length} stock alert${lowStock.length > 1 ? 's' : ''}` : 'Inventory is in good shape'}</strong><small>${lowStock.length ? 'Low or out of stock' : 'No reorder needed'}</small></div>${lowStock.length ? badge('Action', 'warning') : icon('check', 16)}</div><div class="signal-item"><span class="signal-icon">${icon('backup', 16)}</span><div><strong>${state.lastBackupAt ? 'Latest backup verified' : 'Backup not configured'}</strong><small>${state.lastBackupAt ? date(state.lastBackupAt.slice(0, 10)) : 'Protect your practice data'}</small></div>${button(state.lastBackupAt ? 'View' : 'Set up', 'navigate', 'arrow', 'link', 'data-page="backup"')}</div></div></section>`)}</div><section class="quick-actions card"><div><div class="eyebrow">SHORTCUTS</div><h2>Move work forward</h2><p>Common actions, one click away.</p></div><div class="quick-action-grid">${[['New patient', 'open-patient', 'users'], ['Appointment', 'open-appointment', 'calendar'], ['New visit', 'open-visit', 'activity'], ['New invoice', 'open-invoice', 'receipt'], ['Record payment', 'open-payment', 'credit'], ['Add stock', 'open-stock', 'box']].map(([label, action, ico]) => `<button data-action="${action}" class="quick-action">${icon(ico, 18)}<span>${esc(label)}</span>${icon('arrow', 14)}</button>`).join('')}</div></section></div>`;
}
function appointmentRow(a) {
  const patient = byId(state.patients, a.patientId);
  return `<div class="schedule-row"><div class="schedule-time"><strong>${time(a.time)}</strong><small>${a.duration || 30} min</small></div><div class="schedule-line"></div><div class="schedule-person"><span class="avatar avatar-xs">${initials(patient?.fullName || 'PT')}</span><div><strong>${esc(patient?.fullName || 'Unassigned patient')}</strong><small>${esc(a.reason || 'Appointment')} · ${esc(a.chair || 'Chair 1')}</small></div></div><div class="row-end">${statusBadge(a.status || 'Scheduled')}<button class="icon-button tiny" data-action="edit-appointment" data-id="${a.id}" aria-label="Edit appointment">${icon('more', 17)}</button></div></div>`;
}

function searchInput(placeholder, value = ui.search, dataKey = 'global-search') { return `<label class="search-field">${icon('search', 17)}<input type="search" placeholder="${attr(placeholder)}" value="${attr(value)}" data-input="${dataKey}"><kbd>${dataKey === 'global-search' ? '⌘ K' : ''}</kbd></label>`; }
function toolbar(filters = '', actions = '') { return `<div class="toolbar"><div class="toolbar-left">${filters}</div><div class="toolbar-right">${actions}</div></div>`; }
function dataTable(headers, body, empty = '') { return `<div class="table-wrap"><table class="data-table"><thead><tr>${headers.map((h) => `<th>${esc(h)}</th>`).join('')}</tr></thead><tbody>${body || `<tr><td colspan="${headers.length}">${empty}</td></tr>`}</tbody></table></div>`; }
function tablePager(total, page, actionPrefix = 'table') {
  const pageSize = 50; const pages = Math.max(1, Math.ceil(total / pageSize));
  if (pages <= 1) return '';
  return `<nav class="table-pager" aria-label="Table pages"><button class="btn btn-link" data-action="${actionPrefix}-prev" ${page <= 1 ? 'disabled' : ''}>${icon('chevron', 14, 'rotate-180')} Previous</button><span>Page ${number(page)} of ${number(pages)} · ${number(total)} records</span><button class="btn btn-link" data-action="${actionPrefix}-next" ${page >= pages ? 'disabled' : ''}>Next ${icon('chevron', 14)}</button></nav>`;
}

function renderPatients() {
  if (ui.patientId) return renderPatientProfile();
  const query = ui.search.trim().toLowerCase();
  const patients = state.patients.filter((p) => {
    const isArchived = Boolean(p.archived || p.status === 'Archived');
    const statusMatch = ui.patientStatusFilter === 'Archived' ? isArchived : ui.patientStatusFilter === 'Active' || !ui.patientStatusFilter || ui.patientStatusFilter === 'All statuses' ? !isArchived : true;
    const queryMatch = !query || [p.patientCode, p.fullName, p.phone, p.email, p.address, p.medicalHistory, p.allergies].some((value) => String(value || '').toLowerCase().includes(query));
    const visitDates = active(state.visits).filter((visit) => visit.patientId === p.id).map((visit) => visit.date).filter(Boolean);
    const latestVisit = p.lastVisit || visitDates.sort().at(-1) || '';
    const fromMatch = !ui.patientDateFrom || latestVisit >= ui.patientDateFrom;
    const toMatch = !ui.patientDateTo || latestVisit <= ui.patientDateTo;
    const toothMatch = !ui.patientToothStatus || state.dentalRecords.some((record) => record.patientId === p.id && record.status === ui.patientToothStatus);
    const balance = sum(active(state.invoices).filter((invoice) => invoice.patientId === p.id), (invoice) => invoicePaymentStatus(invoice).due);
    const balanceMatch = ui.patientBalanceFilter === 'outstanding' ? balance > 0 : ui.patientBalanceFilter === 'clear' ? balance <= 0 : true;
    return statusMatch && queryMatch && fromMatch && toMatch && toothMatch && balanceMatch;
  }).sort((a, b) => (a.fullName || '').localeCompare(b.fullName || ''));
  const patientPageSize = 50; const patientPages = Math.max(1, Math.ceil(patients.length / patientPageSize)); ui.patientPage = clamp(ui.patientPage || 1, 1, patientPages);
  const rows = patients.slice((ui.patientPage - 1) * patientPageSize, ui.patientPage * patientPageSize).map((p) => `<tr class="clickable-row" data-action="open-patient-profile" data-id="${p.id}"><td><span class="code-label">${esc(p.patientCode || '—')}</span></td><td><div class="person-cell"><span class="avatar avatar-table">${initials(p.fullName)}</span><div><strong>${esc(p.fullName)}</strong><small>${p.preferredName ? `Prefers ${esc(p.preferredName)}` : p.gender ? esc(p.gender) : 'Patient'}</small></div></div></td><td><div class="contact-cell">${p.phone ? `<span>${icon('phone', 13)}${esc(p.phone)}</span>` : '<span class="muted">No phone</span>'}${p.email ? `<span>${icon('mail', 13)}${esc(p.email)}</span>` : ''}</div></td><td>${date(p.lastVisit)}</td><td>${p.nextVisit ? date(p.nextVisit) : '<span class="muted">Not scheduled</span>'}</td><td>${statusBadge(p.status || 'Active')}</td><td><button class="icon-button tiny" data-action="open-patient-profile" data-id="${p.id}" aria-label="Open patient profile">${icon('arrow', 15)}</button></td></tr>`).join('');
  return `<div class="page">${pageHeader('Patients', 'A complete, searchable record of the people in your care.', button('New patient', 'open-patient', 'plus', 'primary'))}<div class="stats-strip"><div><span class="stat-label">Total patients</span><strong>${number(patients.length)}</strong></div><div><span class="stat-label">New this month</span><strong>${number(active(state.patients).filter((p) => p.registrationDate?.slice(0, 7) === today().slice(0, 7)).length)}</strong></div><div><span class="stat-label">With upcoming visit</span><strong>${number(active(state.patients).filter((p) => p.nextVisit && p.nextVisit >= today()).length)}</strong></div><div><span class="stat-label">Needs attention</span><strong>${number(active(state.patients).filter((p) => !p.phone || !p.dateOfBirth).length)}</strong></div></div><section class="card table-card"><div class="card-toolbar">${searchInput('Search by name, code, phone or email')}<div class="table-actions">${button('Filters', 'toggle-patient-filters', 'filter', 'secondary')}${button('Saved views', 'open-saved-filters', 'search', 'secondary')}${button('Save view', 'save-patient-filter', 'check', 'secondary')}${button('Import CSV', 'import-patients', 'upload', 'secondary')}${button('Export CSV', 'export-patients', 'download', 'secondary')}<input class="visually-hidden" type="file" id="patient-csv-file" accept=".csv,text/csv" data-input="patient-csv-file"></div></div><div class="filter-drawer ${ui.patientFilters ? 'open' : ''}"><label>Patient status<select data-change="patient-status-filter"><option ${!ui.patientStatusFilter || ui.patientStatusFilter === 'All statuses' ? 'selected' : ''}>All statuses</option><option ${ui.patientStatusFilter === 'Active' ? 'selected' : ''}>Active</option><option ${ui.patientStatusFilter === 'Archived' ? 'selected' : ''}>Archived</option></select></label><label>Last visit from<input type="date" value="${attr(ui.patientDateFrom)}" data-change="patient-date-from"></label><label>Last visit to<input type="date" value="${attr(ui.patientDateTo)}" data-change="patient-date-to"></label><label>Tooth status<select data-change="patient-tooth-status"><option value="">Any tooth status</option>${['Caries', 'Filled', 'Missing', 'Extracted', 'Root Canal', 'Crown', 'Bridge', 'Implant', 'Fracture'].map((status) => `<option ${ui.patientToothStatus === status ? 'selected' : ''}>${status}</option>`).join('')}</select></label><label>Balance<select data-change="patient-balance"><option value="all" ${ui.patientBalanceFilter === 'all' ? 'selected' : ''}>Any balance</option><option value="outstanding" ${ui.patientBalanceFilter === 'outstanding' ? 'selected' : ''}>Outstanding</option><option value="clear" ${ui.patientBalanceFilter === 'clear' ? 'selected' : ''}>Clear</option></select></label><span>Combine filters with search to find a patient by clinical, visit, dental or financial context.</span></div>${patients.length ? `${dataTable(['Patient code', 'Patient', 'Contact', 'Last visit', 'Next visit', 'Status', ''], rows)}${tablePager(patients.length, ui.patientPage, 'patient-page')}` : emptyState('users', query ? 'No patients match that search' : 'Your patient directory is empty', query ? 'Try another name, code or phone number.' : 'Add your first patient to start a complete clinical record.', button('Add patient', 'open-patient', 'plus', 'primary'))}</section></div>`;
}
function renderPatientProfile() {
  const patient = byId(state.patients, ui.patientId);
  if (!patient) { ui.patientId = null; return renderPatients(); }
  const visits = active(state.visits).filter((v) => v.patientId === patient.id).sort((a, b) => (b.date || '').localeCompare(a.date || ''));
  const appointments = active(state.appointments).filter((a) => a.patientId === patient.id).sort((a, b) => `${b.date}${b.time}`.localeCompare(`${a.date}${a.time}`));
  const invoices = active(state.invoices).filter((i) => i.patientId === patient.id);
  const payments = active(state.payments).filter((p) => p.patientId === patient.id);
  const billed = sum(invoices, (i) => i.total);
  const paid = sum(payments, paymentAmount);
  const currentTab = ui.patientTab || 'overview';
  const tabs = [['overview', 'Overview'], ['visits', 'Visits'], ['appointments', 'Appointments'], ['treatment-plan', 'Treatment plan'], ['dental', 'Dental chart'], ['prescriptions', 'Prescriptions'], ['billing', 'Billing'], ['payments', 'Payments'], ['statement', 'Financial statement'], ['attachments', 'Attachments'], ['referrals', 'Referrals'], ['followups', 'Follow-ups'], ['notes', 'Notes'], ['audit', 'Audit'], ['timeline', 'Timeline']].filter(([id]) => can(permissionForPatientTab(id)));
  return `<div class="page patient-profile-page"><div class="profile-breadcrumb"><button class="back-link" data-action="close-patient-profile">${icon('arrow', 15)}<span>Back to patients</span></button><span>/</span><span>${esc(patient.patientCode || 'Patient')}</span></div><section class="profile-hero"><div class="profile-identity"><span class="avatar avatar-large">${initials(patient.fullName)}</span><div><div class="profile-code">${esc(patient.patientCode || '—')} · ${date(patient.registrationDate)} ${statusBadge(patient.status || 'Active')}</div><h1>${esc(patient.fullName)}</h1><div class="profile-meta">${patient.dateOfBirth ? `${ageFromDate(patient.dateOfBirth) ?? '—'} years · ${date(patient.dateOfBirth)} · ${patient.gender || 'Gender not recorded'}` : 'Date of birth not recorded'} ${patient.phone ? ` · ${icon('phone', 13)} ${esc(patient.phone)}` : ''}</div>${patient.importantAlerts ? `<div class="profile-alert-inline">${icon('warning', 13)} ${esc(patient.importantAlerts)}</div>` : ''}</div></div><div class="profile-actions">${button('New visit', 'open-visit', 'plus', 'primary', `data-patient-id="${patient.id}"`)}<button class="icon-button bordered" data-action="edit-patient" data-id="${patient.id}" aria-label="Edit patient">${icon('edit', 17)}</button><button class="icon-button bordered" data-action="print-patient" data-id="${patient.id}" aria-label="Print patient summary">${icon('printer', 17)}</button></div></section><div class="profile-stats"><div><span>Visits</span><strong>${number(visits.length)}</strong></div><div><span>Next appointment</span><strong>${appointments.find((appointment) => appointment.date >= today() && !['Cancelled', 'No Show'].includes(appointment.status)) ? date(appointments.find((appointment) => appointment.date >= today() && !['Cancelled', 'No Show'].includes(appointment.status)).date, { day: 'numeric', month: 'short' }) : '—'}</strong></div><div><span>Total billed</span><strong>${currency(billed)}</strong></div><div><span>Outstanding</span><strong class="${billed - paid > 0 ? 'text-warning' : ''}">${currency(Math.max(0, billed - paid))}</strong></div></div><nav class="profile-tabs" aria-label="Patient profile sections">${tabs.map(([id, label]) => `<button class="profile-tab ${currentTab === id ? 'active' : ''}" data-action="patient-tab" data-tab="${id}">${esc(label)}${id === 'visits' && visits.length ? `<span>${visits.length}</span>` : ''}</button>`).join('')}</nav><section class="profile-content">${renderPatientTab(patient, currentTab, { visits, appointments, invoices, payments, billed, paid })}</section></div>`;
}
function renderPatientTab(patient, tab, data) {
  if (!can(permissionForPatientTab(tab))) return `<section class="empty-page"><div class="empty-icon">${icon('shield', 26)}</div><h2>Section protected</h2><p>Your account does not have permission to view this patient section.</p></section>`;
  if (tab === 'visits') return `<div class="section-heading"><div><h2>Clinical visits</h2><p>Every encounter is traceable to this patient.</p></div>${button('Record visit', 'open-visit', 'plus', 'secondary')}</div>${data.visits.length ? `<div class="timeline-list">${data.visits.map((v) => `<article class="timeline-card"><div class="timeline-marker">${icon('activity', 17)}</div><div class="timeline-body"><div class="timeline-top"><div><strong>${esc(v.reason || v.chiefComplaint || 'Clinical visit')}</strong><small>${date(v.date)}${v.time ? ` · ${time(v.time)}` : ''}</small></div>${statusBadge(v.status || 'Completed')}</div>${v.diagnosis ? `<p><b>Diagnosis:</b> ${esc(v.diagnosis)}</p>` : ''}${v.treatmentPerformed ? `<p><b>Treatment:</b> ${esc(v.treatmentPerformed)}</p>` : ''}${v.followUpDate ? `<div class="followup-chip">${icon('flag', 13)} Follow-up ${date(v.followUpDate)}</div>` : ''}</div></article>`).join('')}</div>` : emptyState('activity', 'No visits recorded', 'When you record an encounter, its clinical history will live here.', button('Record visit', 'open-visit', 'plus', 'primary'))}`;
  if (tab === 'appointments') return `<div class="section-heading"><div><h2>Appointments</h2><p>Keep future visits and chair context connected to this patient.</p></div>${button('Book appointment', 'open-appointment', 'plus', 'secondary', `data-patient-id="${patient.id}"`)}</div>${data.appointments.length ? `<div class="record-list">${data.appointments.map((appointment) => `<div class="record-row"><span class="record-icon">${icon('calendar', 17)}</span><div><strong>${date(appointment.date)} · ${time(appointment.time)}</strong><small>${esc(appointment.reason || 'Appointment')} · ${esc(appointment.room || appointment.chair || 'Chair not assigned')}</small></div>${statusBadge(appointment.status || 'Scheduled')}<button class="icon-button tiny" data-action="edit-appointment" data-id="${appointment.id}" aria-label="Edit appointment">${icon('edit', 15)}</button></div>`).join('')}</div>` : emptyState('calendar', 'No appointments for this patient', 'Book the next visit without leaving the profile.', button('Book appointment', 'open-appointment', 'plus', 'primary', `data-patient-id="${patient.id}"`))}`;
  if (tab === 'treatment-plan') { const plans = active(state.treatmentPlans || []).filter((plan) => plan.patientId === patient.id).sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || '')); return `<div class="section-heading"><div><h2>Treatment plan</h2><p>Stage-based care planning stays connected to this patient and remains clinician-authored.</p></div>${button('New treatment plan', 'open-treatment-plan', 'plus', 'secondary', `data-patient-id="${patient.id}"`)}</div>${plans.length ? `<div class="plan-list">${plans.map((plan) => `<article class="card treatment-plan-card"><div class="plan-card-head"><div><span class="eyebrow">${esc(plan.status || 'Proposed')}</span><h3>${esc(plan.title)}</h3><p>${esc(plan.goal || 'No clinical goal recorded')}</p></div><div class="row-actions">${button('Edit', 'edit-treatment-plan', 'edit', 'link', `data-id="${plan.id}"`)}${button('Record visit', 'convert-treatment-plan', 'activity', 'link', `data-id="${plan.id}"`)}${statusBadge(plan.status || 'Proposed')}</div></div><div class="plan-meta"><span>Start ${date(plan.startDate)}</span><span>Review ${date(plan.reviewDate)}</span><span>Estimate ${currency(plan.estimatedTotal ?? sum(plan.stages || [], (stage) => stage.estimatedCost))}</span><span>${number((plan.stages || []).filter((stage) => stage.status === 'Completed').length)} of ${number((plan.stages || []).length)} stages complete</span></div><div class="plan-stages">${(plan.stages || []).map((stage, index) => `<div class="plan-stage"><span class="stage-number">${index + 1}</span><div><strong>${esc(stage.title)}</strong><small>${stage.plannedDate ? date(stage.plannedDate) : 'Date not set'} · ${currency(stage.estimatedCost || 0)}${stage.notes ? ` · ${esc(stage.notes)}` : ''}</small></div><button class="stage-status" data-action="cycle-plan-stage" data-id="${plan.id}" data-stage-index="${index}">${statusBadge(stage.status || 'Planned')}</button></div>`).join('')}</div></article>`).join('')}</div>` : emptyState('layers', 'No treatment plans yet', 'Create a staged plan when care needs more than one appointment.', button('New treatment plan', 'open-treatment-plan', 'plus', 'primary', `data-patient-id="${patient.id}"`))}`; }
  if (tab === 'dental') return `<div class="section-heading"><div><h2>Dental chart</h2><p>Tooth-level records for ${esc(patient.fullName)}.</p></div>${button('Open full chart', 'navigate', 'tooth', 'secondary', 'data-page="dental"')}</div>${renderMiniDentalChart(patient)}`;
  if (tab === 'prescriptions') { const prescriptions = active(state.prescriptions).filter((p) => p.patientId === patient.id); return `<div class="section-heading"><div><h2>Prescriptions</h2><p>Medication instructions recorded by the practice.</p></div>${button('New prescription', 'open-prescription', 'plus', 'secondary')}</div>${prescriptions.length ? `<div class="record-list">${prescriptions.map((p) => `<div class="record-row"><span class="record-icon purple">${icon('file', 17)}</span><div><strong>${esc(p.prescriptionCode || 'Prescription')} · ${date(p.date)}</strong><small>${esc(p.medications?.map((m) => m.medicine).join(', ') || p.medicine || 'Medication not specified')}</small></div>${button('Print', 'print-prescription', 'printer', 'link', `data-id="${p.id}"`)}</div>`).join('')}</div>` : emptyState('file', 'No prescriptions yet', 'Prescriptions created for this patient will appear here.')}`; }
  if (tab === 'billing') return `<div class="section-heading"><div><h2>Billing & payments</h2><p>Transparent financial history for ${esc(patient.fullName)}.</p></div>${button('New invoice', 'open-invoice', 'plus', 'secondary')}</div><div class="two-col-cards"><div class="summary-panel"><span>Total billed</span><strong>${currency(data.billed)}</strong><small>${data.invoices.length} invoice${data.invoices.length === 1 ? '' : 's'}</small></div><div class="summary-panel"><span>Total paid</span><strong>${currency(data.paid)}</strong><small>${data.payments.length} payment${data.payments.length === 1 ? '' : 's'}</small></div><div class="summary-panel warning"><span>Outstanding</span><strong>${currency(Math.max(0, data.billed - data.paid))}</strong><small>Calculated from valid payments</small></div></div>${data.invoices.length ? dataTable(['Invoice', 'Date', 'Total', 'Paid', 'Due', 'Status'], data.invoices.map((i) => { const paymentState = invoicePaymentStatus(i); return `<tr><td><span class="code-label">${esc(i.invoiceNumber)}</span></td><td>${date(i.date)}</td><td>${currency(i.total)}</td><td>${currency(paymentState.paid)}</td><td>${currency(paymentState.due)}</td><td>${statusBadge(paymentState.status)}</td></tr>`; }).join('')) : emptyState('receipt', 'No invoices yet', 'Invoices and receipts created for this patient will appear here.')}`;
  if (tab === 'payments') return `<div class="section-heading"><div><h2>Payments</h2><p>Every receipt and refund remains traceable to this patient.</p></div>${button('Record payment', 'open-payment', 'plus', 'secondary', `data-patient-id="${patient.id}"`)}</div>${data.payments.length ? `<div class="record-list">${data.payments.map((payment) => `<div class="record-row"><span class="record-icon green">${icon('credit', 17)}</span><div><strong>${esc(payment.receiptNumber || 'Receipt')} · ${currency(paymentAmount(payment))}</strong><small>${date(payment.date)} · ${esc(payment.method || 'Payment')}${payment.reference ? ` · ${esc(payment.reference)}` : ''}</small></div>${statusBadge(payment.status || 'Recorded')}${paymentAmount(payment) > 0 ? button('Refund', 'refund-payment', 'refresh', 'link', `data-id="${payment.id}"`) : ''}</div>`).join('')}</div>` : emptyState('credit', 'No payments recorded', 'Record the patient’s first collection from this profile.', button('Record payment', 'open-payment', 'plus', 'primary'))}`;
  if (tab === 'followups') { const followups = [...active(state.visits).filter((visit) => visit.patientId === patient.id && visit.followUpDate), ...active(state.followUpTasks || []).filter((task) => task.patientId === patient.id)].sort((a, b) => String(a.followUpDate || a.dueDate || '').localeCompare(String(b.followUpDate || b.dueDate || ''))); return `<div class="section-heading"><div><h2>Follow-ups</h2><p>Review clinical follow-up dates and task notes before they become overdue.</p></div>${button('Record visit', 'open-visit', 'plus', 'secondary', `data-patient-id="${patient.id}"`)}</div>${followups.length ? `<div class="record-list">${followups.map((item) => `<div class="record-row"><span class="record-icon amber">${icon('flag', 17)}</span><div><strong>${date(item.followUpDate || item.dueDate)}</strong><small>${esc(item.reason || item.title || item.note || 'Clinical follow-up')}</small></div>${statusBadge((item.followUpDate || item.dueDate) < today() ? 'Overdue' : 'Scheduled')}</div>`).join('')}</div>` : emptyState('flag', 'No follow-ups recorded', 'Follow-up dates from visits and tasks will appear here.')}`; }
  if (tab === 'notes') return `<div class="section-heading"><div><h2>Notes</h2><p>Keep communication preferences and patient-facing context in one private place.</p></div>${button('Edit patient', 'edit-patient', 'edit', 'secondary', `data-id="${patient.id}"`)}</div><section class="card note-panel"><div><span class="eyebrow">PATIENT NOTES</span><p>${esc(patient.notes || 'No patient notes recorded yet.')}</p></div>${patient.preferredContact ? `<span class="soft-label">Preferred contact: ${esc(patient.preferredContact)}</span>` : ''}</section>`;
  if (tab === 'audit') { const entries = active(state.audit || []).filter((entry) => entry.recordId === patient.id || entry.summary?.includes(patient.fullName)).slice(0, 80); return `<div class="section-heading"><div><h2>Patient audit</h2><p>Important changes referencing this patient, kept locally.</p></div></div>${entries.length ? `<div class="audit-list profile-audit-list">${entries.map((entry) => `<div class="audit-row"><span class="audit-row-icon">${icon('activity', 15)}</span><div><strong>${esc(entry.action)}</strong><small>${date(entry.at?.slice(0, 10))} · ${esc(entry.entity || 'Record')}</small><p>${esc(entry.summary || '')}</p></div></div>`).join('')}</div>` : emptyState('shield', 'No patient audit events', 'Important profile changes will appear here.')}`; }
  if (tab === 'statement') {
    const entries = statementEntries({ invoices: data.invoices, payments: data.payments, adjustments: state.paymentAdjustments || [] }, patient.id);
    const debit = sum(entries, (entry) => entry.debit);
    const credit = sum(entries, (entry) => entry.credit);
    return `<div class="section-heading"><div><h2>Financial statement</h2><p>Invoice charges, recorded payments and refunds reconciled to source records.</p></div>${button('Print statement', 'print-patient-statement', 'printer', 'secondary', `data-id="${patient.id}"`)}</div><div class="two-col-cards"><div class="summary-panel"><span>Total charges</span><strong>${currency(debit)}</strong><small>Invoices and refunds</small></div><div class="summary-panel"><span>Payments</span><strong>${currency(credit)}</strong><small>Valid recorded collections</small></div><div class="summary-panel warning"><span>Balance</span><strong>${currency(entries.at(-1)?.balance || 0)}</strong><small>Charges less payments</small></div></div>${entries.length ? dataTable(['Date', 'Type', 'Reference', 'Debit', 'Credit', 'Running balance', 'Note'], entries.map((entry) => `<tr><td>${date(entry.date)}</td><td>${esc(entry.type)}</td><td><span class="code-label">${esc(entry.reference)}</span></td><td>${entry.debit ? currency(entry.debit) : '—'}</td><td>${entry.credit ? currency(entry.credit) : '—'}</td><td><strong>${currency(entry.balance)}</strong></td><td>${esc(entry.note)}</td></tr>`).join('')) : emptyState('receipt', 'No financial activity', 'Invoices and payments for this patient will appear in the statement.')}`;
  }
  if (tab === 'referrals') { const referrals = active(state.referrals).filter((r) => r.patientId === patient.id).sort((a, b) => (b.date || '').localeCompare(a.date || '')); return `<div class="section-heading"><div><h2>Referral history</h2><p>Track referrals to another doctor, specialist or organisation.</p></div>${button('New referral', 'open-referral', 'plus', 'secondary')}</div>${referrals.length ? `<div class="record-list">${referrals.map((r) => `<article class="record-row"><span class="record-icon">${icon('flag', 17)}</span><div><strong>${esc(r.referralTo)} · ${date(r.date)}</strong><small>${esc(r.specialty || 'Specialty not recorded')} · ${esc(r.reason || 'Reason not recorded')}</small>${r.response ? `<small class="text-success">Response: ${esc(r.response)}</small>` : ''}</div><button class="icon-button tiny" data-action="edit-referral" data-id="${r.id}">${icon('edit', 16)}</button></article>`).join('')}</div>` : emptyState('flag', 'No referrals recorded', 'Keep referral destination, reason, response and follow-up notes connected to this patient.', button('New referral', 'open-referral', 'plus', 'primary'))}`; }
  if (tab === 'attachments') { const attachments = active(state.attachments).filter((a) => a.patientId === patient.id).sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || '')); return `<div class="section-heading"><div><h2>Attachments</h2><p>Keep X-rays, reports, prescriptions and clinical documents with the patient record.</p></div>${button('Attach file', 'attach-file', 'upload', 'secondary', `data-patient-id="${patient.id}"`)}<input class="visually-hidden" type="file" id="patient-attachment-file" accept="image/png,image/jpeg,image/webp,image/tiff,application/pdf,application/dicom,.dcm,text/plain" data-input="patient-attachment-file"></div>${attachments.length ? `<div class="attachment-grid">${attachments.map((a) => `<article class="attachment-card"><div class="attachment-icon">${icon(a.type?.startsWith('image/') ? 'eye' : 'file', 19)}</div><div class="attachment-info"><strong title="${attr(a.name)}">${esc(a.name)}</strong><small>${esc(a.category || 'Clinical document')} · ${formatBytes(a.size)} · ${date(a.createdAt?.slice(0, 10))}</small></div><div class="attachment-actions"><button class="icon-button tiny" data-action="open-attachment" data-id="${a.id}" aria-label="Open attachment">${icon('eye', 15)}</button><button class="icon-button tiny" data-action="download-attachment" data-id="${a.id}" aria-label="Download attachment">${icon('download', 15)}</button><button class="icon-button tiny" data-action="edit-attachment" data-id="${a.id}" aria-label="Edit attachment details">${icon('edit', 15)}</button><button class="icon-button tiny" data-action="delete-attachment" data-id="${a.id}" aria-label="Remove attachment">${icon('trash', 15)}</button></div></article>`).join('')}</div>` : emptyState('file', 'No attachments yet', 'Upload an X-ray, lab report, image or PDF. Files stay on this device and are included in the structured backup.', button('Attach file', 'attach-file', 'upload', 'primary', `data-patient-id="${patient.id}"`))}`; }
  if (tab === 'timeline') return `<div class="section-heading"><div><h2>Patient timeline</h2><p>Administrative and clinical activity in chronological order.</p></div></div>${renderTimeline(patient)}`;
  return `<div class="profile-overview-grid"><div class="card inset-card"><div class="section-heading compact"><h2>Patient details</h2>${button('Edit', 'edit-patient', 'edit', 'link', `data-id="${patient.id}"`)}</div><dl class="detail-list"><div><dt>Preferred name</dt><dd>${esc(patient.preferredName || 'Not recorded')}</dd></div><div><dt>Phone</dt><dd>${esc(patient.phone || 'Not recorded')}</dd></div><div><dt>Email</dt><dd>${esc(patient.email || 'Not recorded')}</dd></div><div><dt>Address</dt><dd>${esc(patient.address || 'Not recorded')}</dd></div><div><dt>Emergency contact</dt><dd>${esc(patient.emergencyContact || 'Not recorded')}${patient.emergencyPhone ? ` · ${esc(patient.emergencyPhone)}` : ''}</dd></div><div><dt>Preferred contact</dt><dd>${esc(patient.preferredContact || 'Phone')}</dd></div><div><dt>Tags</dt><dd>${normaliseTags(patient.tags).length ? normaliseTags(patient.tags).map((tag) => `<span class="soft-label">${esc(tag)}</span>`).join(' ') : 'No tags'}</dd></div></dl>${patient.importantAlerts ? `<div class="patient-alert"><span>${icon('warning', 15)}</span><div><strong>Important alert</strong><p>${esc(patient.importantAlerts)}</p></div></div>` : ''}</div><div class="card inset-card"><div class="section-heading compact"><h2>Clinical context</h2><span class="soft-label">Private</span></div><dl class="detail-list"><div><dt>Blood group</dt><dd>${esc(patient.bloodGroup || 'Not recorded')}</dd></div><div><dt>Allergies</dt><dd class="${patient.allergies ? 'text-warning' : ''}">${esc(patient.allergies || 'None recorded')}</dd></div><div><dt>Chronic conditions</dt><dd>${esc(patient.chronicConditions || 'None recorded')}</dd></div><div><dt>Current medications</dt><dd>${esc(patient.currentMedications || 'None recorded')}</dd></div>${Object.entries(patient.customFields || {}).filter(([, value]) => value).map(([key, value]) => `<div><dt>${esc((state.settings.customPatientFields || []).find((definition) => definition.key === key)?.label || key)}</dt><dd>${esc(value)}</dd></div>`).join('')}</dl></div><div class="card inset-card wide"><div class="section-heading compact"><h2>Recent activity</h2>${button('Full timeline', 'patient-tab', 'arrow', 'link', 'data-tab="timeline"')}</div>${data.visits.slice(0, 3).length ? data.visits.slice(0, 3).map((v) => `<div class="activity-row"><span class="activity-dot">${icon('activity', 14)}</span><div><strong>${esc(v.reason || 'Clinical visit')}</strong><small>${date(v.date)} · ${esc(v.treatmentPerformed || v.diagnosis || 'Notes recorded')}</small></div></div>`).join('') : emptyState('activity', 'No activity yet', 'Visits, appointments, payments and referrals will build this history.')}</div></div>`;
}
function renderMiniDentalChart(patient) {
  const records = state.dentalRecords.filter((r) => r.patientId === patient.id);
  const statuses = Object.fromEntries(records.map((r) => [r.tooth, r.status]));
  return `<div class="mini-dental-chart"><div class="teeth-row">${[18, 17, 16, 15, 14, 13, 12, 11, 21, 22, 23, 24, 25, 26, 27, 28].map((tooth) => toothButton(tooth, statuses[tooth])).join('')}</div><div class="arch-label">Upper arch · FDI numbering</div><div class="arch-label lower">Lower arch · FDI numbering</div><div class="teeth-row lower-teeth">${[48, 47, 46, 45, 44, 43, 42, 41, 31, 32, 33, 34, 35, 36, 37, 38].map((tooth) => toothButton(tooth, statuses[tooth])).join('')}</div><div class="chart-legend"><span><i class="legend-dot healthy"></i>Healthy / unrecorded</span><span><i class="legend-dot caries"></i>Caries</span><span><i class="legend-dot filled"></i>Restored</span><span><i class="legend-dot missing"></i>Missing</span></div></div>`;
}
function toothButton(tooth, status = '') { return `<button class="tooth ${status ? `tooth-${status.toLowerCase().replace(' ', '-')}` : ''}" data-action="select-tooth" data-tooth="${tooth}" title="Tooth ${tooth} — ${status || 'No record'}"><span>${tooth}</span>${icon('tooth', 22)}</button>`; }
function renderTimeline(patient) {
  const events = buildTimelineEvents(state, patient.id);
  return events.length ? `<div class="timeline-filter-bar"><span class="soft-label">${number(events.length)} events</span><span class="muted">Clinical, financial and administrative activity</span></div><div class="timeline-stream">${events.map((event) => `<div class="stream-item"><span class="stream-icon">${icon(event.icon, 16)}</span><div><strong>${esc(event.title)}</strong><p>${esc(event.text)}</p><small>${date(event.date)} · ${esc(event.type)}</small></div></div>`).join('')}</div>` : emptyState('clock', 'Timeline is empty', 'Patient activity will appear here as records are created.');
}

function appointmentViewDay(value) {
  const items = active(state.appointments).filter((appointment) => appointment.date === value).sort((a, b) => `${a.time || ''}${a.id}`.localeCompare(`${b.time || ''}${b.id}`));
  return `<div class="appointment-list-view">${items.length ? items.map((appointment) => appointmentRow(appointment)).join('') : emptyState('calendar', 'No appointments for this day', 'Book an appointment to keep the chair plan visible.', button('New appointment', 'open-appointment', 'plus', 'secondary'))}</div>`;
}
function appointmentViewWeek(value) {
  const selected = new Date(`${value}T00:00:00`);
  const start = new Date(selected);
  start.setDate(start.getDate() - start.getDay());
  return `<div class="appointment-week-view">${Array.from({ length: 7 }, (_, index) => { const day = new Date(start); day.setDate(start.getDate() + index); const iso = localDateKey(day); const items = active(state.appointments).filter((appointment) => appointment.date === iso).sort((a, b) => `${a.time || ''}${a.id}`.localeCompare(`${b.time || ''}${b.id}`)); return `<section class="appointment-week-day ${iso === today() ? 'is-today' : ''}"><div class="appointment-week-head"><strong>${new Intl.DateTimeFormat('en-US', { weekday: 'short' }).format(day)}</strong><span>${day.getDate()} ${new Intl.DateTimeFormat('en-US', { month: 'short' }).format(day)}</span></div>${items.length ? items.map((appointment) => `<button class="appointment-compact-row" data-action="edit-appointment" data-id="${appointment.id}"><strong>${time(appointment.time)}</strong><span>${esc(patientName(appointment.patientId))}</span>${statusBadge(appointment.status || 'Scheduled')}</button>`).join('') : '<small class="muted">No bookings</small>'}</section>`; }).join('')}</div>`;
}
function appointmentViewAgenda() {
  const items = active(state.appointments).filter((appointment) => appointment.date >= today()).sort((a, b) => `${a.date}${a.time || ''}`.localeCompare(`${b.date}${b.time || ''}`)).slice(0, 50);
  return `<div class="appointment-agenda-view">${items.length ? items.map((appointment) => `<button class="appointment-agenda-row" data-action="edit-appointment" data-id="${appointment.id}"><span class="date-tile"><strong>${new Date(`${appointment.date}T00:00:00`).getDate()}</strong><small>${new Intl.DateTimeFormat('en-US', { month: 'short' }).format(new Date(`${appointment.date}T00:00:00`))}</small></span><span class="appointment-agenda-copy"><strong>${esc(patientName(appointment.patientId))}</strong><small>${date(appointment.date)} · ${time(appointment.time)} · ${esc(appointment.reason || 'Appointment')}</small></span>${statusBadge(appointment.status || 'Scheduled')}</button>`).join('') : emptyState('calendar', 'No upcoming appointments', 'Your agenda will fill as appointments are booked.', button('Book appointment', 'open-appointment', 'plus', 'secondary'))}</div>`;
}
function renderAppointments() {
  const monthAppointments = active(state.appointments).filter((a) => { const d = new Date(`${a.date}T00:00:00`); return d.getMonth() === ui.calendarMonth && d.getFullYear() === ui.calendarYear; });
  const upcoming = active(state.appointments).filter((a) => a.date >= today()).sort((a, b) => `${a.date}${a.time}`.localeCompare(`${b.date}${b.time}`)).slice(0, 12);
  const view = ui.appointmentView || 'month';
  const selectedDate = ui.appointmentDate || today();
  const selectedDay = new Date(`${selectedDate}T00:00:00`);
  const weekStart = new Date(selectedDay);
  weekStart.setDate(weekStart.getDate() - weekStart.getDay());
  const viewTitle = view === 'month' ? monthLabel() : view === 'day' ? date(selectedDate, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }) : view === 'week' ? `${date(localDateKey(weekStart), { day: 'numeric', month: 'short' })} – ${date(localDateKey(new Date(weekStart.getFullYear(), weekStart.getMonth(), weekStart.getDate() + 6)), { day: 'numeric', month: 'short', year: 'numeric' })}` : 'Upcoming agenda';
  const scheduleMarkup = view === 'month' ? calendarGrid(monthAppointments) : view === 'day' ? appointmentViewDay(selectedDate) : view === 'week' ? appointmentViewWeek(selectedDate) : appointmentViewAgenda();
  return `<div class="page">${pageHeader('Appointments', 'Plan the day, protect chair time and keep patients informed.', button('New appointment', 'open-appointment', 'plus', 'primary'))}<div class="view-tabs appointment-view-tabs"><button class="${view === 'day' ? 'active' : ''}" data-action="set-appointment-view" data-view="day">Day</button><button class="${view === 'week' ? 'active' : ''}" data-action="set-appointment-view" data-view="week">Week</button><button class="${view === 'month' ? 'active' : ''}" data-action="set-appointment-view" data-view="month">Month</button><button class="${view === 'agenda' ? 'active' : ''}" data-action="set-appointment-view" data-view="agenda">Agenda</button><button data-action="navigate" data-page="queue">Today’s Queue</button></div><div class="calendar-layout"><section class="card calendar-card"><div class="calendar-toolbar">${view === 'agenda' ? '' : `<button class="icon-button bordered" data-action="calendar-prev" aria-label="Previous ${view}">${icon('chevron', 16, 'rotate-180')}</button>`}<h2>${viewTitle}</h2>${view === 'agenda' ? '' : `<button class="icon-button bordered" data-action="calendar-next" aria-label="Next ${view}">${icon('chevron', 16)}</button><button class="today-button" data-action="calendar-today">Today</button>`}</div>${scheduleMarkup}</section><section class="card upcoming-card">${cardTitle('clock', 'Upcoming appointments', button('View queue', 'navigate', 'arrow', 'link', 'data-page="queue"'))}<div class="upcoming-list">${upcoming.length ? upcoming.map((a) => `<div class="upcoming-row" data-action="edit-appointment" data-id="${a.id}"><div class="date-tile"><strong>${new Date(`${a.date}T00:00:00`).getDate()}</strong><small>${new Intl.DateTimeFormat('en-US', { month: 'short' }).format(new Date(`${a.date}T00:00:00`))}</small></div><div><strong>${esc(patientName(a.patientId))}</strong><small>${time(a.time)} · ${esc(a.reason || 'Appointment')}</small></div>${statusBadge(a.status || 'Scheduled')}</div>`).join('') : emptyState('calendar', 'No upcoming appointments', 'Book the next visit from here.', button('Book appointment', 'open-appointment', 'plus', 'secondary'))}</div></section></div><section class="card calendar-note"><div class="note-icon">${icon('shield', 19)}</div><div><strong>Scheduling guardrails are on</strong><p>Appointments keep their patient, duration, dentist and chair context. Double-booking is flagged for review before saving.</p></div><button class="text-button" data-action="navigate" data-page="settings">Configure${icon('arrow', 14)}</button></section></div>`;
}
function calendarGrid(appointments) {
  const total = daysInMonth(ui.calendarMonth, ui.calendarYear);
  const offset = startOffset(ui.calendarMonth, ui.calendarYear);
  const cells = [];
  for (let i = 0; i < offset; i += 1) cells.push('<div class="calendar-cell muted-cell"></div>');
  for (let day = 1; day <= total; day += 1) {
    const iso = `${ui.calendarYear}-${String(ui.calendarMonth + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    const items = appointments.filter((a) => a.date === iso).sort((a, b) => (a.time || '').localeCompare(b.time || ''));
    cells.push(`<div class="calendar-cell ${iso === today() ? 'is-today' : ''}"><div class="calendar-day"><span>${day}</span>${items.length ? `<b>${items.length}</b>` : ''}</div><div class="calendar-events">${items.slice(0, 3).map((a) => `<button data-action="edit-appointment" data-id="${a.id}" class="calendar-event ${statusTone(a.status)}"><span>${time(a.time)}</span> ${esc(patientName(a.patientId))}</button>`).join('')}${items.length > 3 ? `<small class="more-events">+${items.length - 3} more</small>` : ''}</div></div>`);
  }
  while (cells.length % 7) cells.push('<div class="calendar-cell muted-cell"></div>');
  return `<div class="calendar-weekdays">${['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((day) => `<span>${day}</span>`).join('')}</div><div class="calendar-grid">${cells.join('')}</div>`;
}

function renderQueue() {
  const queue = active(state.appointments).filter((a) => a.date === today()).sort((a, b) => (a.serial || '').localeCompare(b.serial || '') || (a.time || '').localeCompare(b.time || ''));
  const activeQueue = queue.filter((a) => !['Completed', 'Cancelled', 'No Show'].includes(a.status));
  return `<div class="page">${pageHeader('Today’s Queue', 'A calm, live view of arrivals and chair flow.', `${button('Print queue', 'print-queue', 'printer', 'secondary')}${button('Check in patient', 'open-appointment', 'plus', 'primary')}`)}<section class="queue-hero"><div class="queue-hero-copy"><span class="eyebrow">${date(today(), { weekday: 'long', day: 'numeric', month: 'long' })}</span><h2>${activeQueue.length ? `${activeQueue.length} patient${activeQueue.length === 1 ? '' : 's'} in motion` : 'Your queue is clear'}</h2><p>${activeQueue.length ? 'Use status changes to keep reception and the clinical team aligned.' : 'Appointments checked in today will appear in this workspace.'}</p></div><div class="queue-hero-ring"><strong>${queue.length}</strong><span>today</span></div></section><section class="card table-card queue-table-card">${queue.length ? dataTable(['Serial', 'Patient', 'Appointment', 'Reason', 'Dentist / chair', 'Wait', 'Status', ''], queue.map((a, index) => `<tr><td><span class="serial-number">${esc(a.serial || `${state.settings.serialPrefix}-${String(index + 1).padStart(3, '0')}`)}</span></td><td><div class="person-cell"><span class="avatar avatar-table">${initials(patientName(a.patientId))}</span><div><strong>${esc(patientName(a.patientId))}</strong><small>${esc(byId(state.patients, a.patientId)?.patientCode || 'Patient')}</small></div></div></td><td><strong>${time(a.time)}</strong><small class="cell-sub">${a.duration || 30} min</small></td><td>${esc(a.reason || '—')}</td><td>${esc(staffName(a.dentistId))}<small class="cell-sub">${esc(a.chair || 'Chair 1')}</small></td><td>${['Checked In', 'Waiting'].includes(a.status) && a.checkedInAt ? `<strong class="${minutesSince(a.checkedInAt) >= 20 ? 'text-warning' : ''}">${number(minutesSince(a.checkedInAt))} min</strong>` : '<span class="muted">—</span>'}</td><td><button class="status-select" data-action="cycle-queue-status" data-id="${a.id}">${statusBadge(a.status || 'Scheduled')}${icon('down', 13)}</button></td><td><button class="icon-button tiny" data-action="edit-appointment" data-id="${a.id}">${icon('more', 17)}</button></td></tr>`).join('')) : emptyState('clipboard', 'No appointments in today’s queue', 'Schedule a patient to start the day’s serial list.', button('New appointment', 'open-appointment', 'plus', 'primary'))}</section></div>`;
}

function renderClinical() {
  const visits = active(state.visits).sort((a, b) => `${b.date}${b.time}`.localeCompare(`${a.date}${a.time}`));
  const query = ui.search.trim().toLowerCase();
  const visible = visits.filter((v) => !query || patientName(v.patientId).toLowerCase().includes(query) || String(v.diagnosis || '').toLowerCase().includes(query) || String(v.reason || '').toLowerCase().includes(query));
  return `<div class="page">${pageHeader('Clinical records', 'Capture the professional record of every encounter.', button('Record visit', 'open-visit', 'plus', 'primary'))}<section class="clinical-intro"><div class="clinical-intro-icon">${icon('activity', 23)}</div><div><strong>Clinical input stays with the clinician</strong><p>Dentiva Pro records your notes, diagnoses, treatments and follow-ups. It does not independently diagnose or prescribe.</p></div><span class="soft-label">Record keeping</span></section><section class="card table-card"><div class="card-toolbar">${searchInput('Search visits by patient, reason or diagnosis')}<div class="table-actions">${button('Export CSV', 'export-visits', 'download', 'secondary')}</div></div>${visible.length ? dataTable(['Date', 'Patient', 'Reason', 'Diagnosis', 'Treatment performed', 'Follow-up', ''], visible.map((v) => `<tr class="clickable-row" data-action="open-patient-profile" data-id="${v.patientId}"><td>${date(v.date)}<small class="cell-sub">${v.time ? time(v.time) : ''}</small></td><td><div class="person-cell"><span class="avatar avatar-table">${initials(patientName(v.patientId))}</span><strong>${esc(patientName(v.patientId))}</strong></div></td><td>${esc(v.reason || v.chiefComplaint || '—')}</td><td>${esc(v.diagnosis || '—')}</td><td>${esc(v.treatmentPerformed || '—')}</td><td>${v.followUpDate ? date(v.followUpDate) : '<span class="muted">—</span>'}</td><td><button class="icon-button tiny" data-action="edit-visit" data-id="${v.id}">${icon('edit', 16)}</button></td></tr>`).join('')) : emptyState('activity', query ? 'No visits match that search' : 'No clinical visits recorded', query ? 'Try another patient name or diagnosis.' : 'Record the first encounter to build a traceable clinical history.', button('Record visit', 'open-visit', 'plus', 'primary'))}</section></div>`;
}
function renderPrescriptions() {
  const prescriptions = active(state.prescriptions).sort((a, b) => (b.date || '').localeCompare(a.date || ''));
  return `<div class="page">${pageHeader('Prescriptions', 'Create clear, printable medication instructions from recorded clinical input.', button('New prescription', 'open-prescription', 'plus', 'primary'))}<section class="clinical-intro"><div class="clinical-intro-icon purple-bg">${icon('file', 22)}</div><div><strong>Professional prescription record</strong><p>Each prescription keeps patient, prescriber, medicine, dosage and instructions together for a reliable paper trail.</p></div><span class="soft-label">Offline & printable</span></section><section class="card table-card">${prescriptions.length ? dataTable(['Prescription', 'Patient', 'Date', 'Medication', 'Instructions', ''], prescriptions.map((p) => `<tr><td><span class="code-label">${esc(p.prescriptionCode || 'RX')}</span></td><td><div class="person-cell"><span class="avatar avatar-table">${initials(patientName(p.patientId))}</span><strong>${esc(patientName(p.patientId))}</strong></div></td><td>${date(p.date)}</td><td><strong>${esc(p.medications?.map((m) => m.medicine).join(', ') || p.medicine || '—')}</strong><small class="cell-sub">${esc(p.medications?.[0]?.strength || p.strength || '')}</small></td><td>${esc(p.medications?.[0]?.instructions || p.instructions || '—')}</td><td><div class="row-actions">${button('Print', 'print-prescription', 'printer', 'link', `data-id="${p.id}"`)}<button class="icon-button tiny" data-action="edit-prescription" data-id="${p.id}">${icon('edit', 16)}</button></div></td></tr>`).join('')) : emptyState('file', 'No prescriptions yet', 'Create a prescription after recording a patient visit.', button('Create prescription', 'open-prescription', 'plus', 'primary'))}</section></div>`;
}

function renderDental() {
  const selectedPatient = byId(state.patients, ui.dentalPatientId);
  const records = selectedPatient ? state.dentalRecords.filter((r) => r.patientId === selectedPatient.id) : [];
  const statusCounts = ['Healthy', 'Caries', 'Filled', 'Missing', 'Root Canal', 'Crown', 'Bridge', 'Implant', 'Fracture', 'Extracted'].map((status) => [status, records.filter((r) => r.status === status).length]);
  const dentition = ui.dentition === 'primary' ? 'primary' : 'adult';
  const upperTeeth = dentition === 'primary' ? [55, 54, 53, 52, 51, 61, 62, 63, 64, 65] : [18, 17, 16, 15, 14, 13, 12, 11, 21, 22, 23, 24, 25, 26, 27, 28];
  const lowerTeeth = dentition === 'primary' ? [85, 84, 83, 82, 81, 71, 72, 73, 74, 75] : [48, 47, 46, 45, 44, 43, 42, 41, 31, 32, 33, 34, 35, 36, 37, 38];
  const statuses = Object.fromEntries(records.map((r) => [r.tooth, r.status]));
  return `<div class="page">${pageHeader('Dental chart', 'A structured tooth-level record for adult and primary dentition.', `${button('Print chart', 'print-dental-chart', 'printer', 'secondary')}${button('Save chart note', 'save-tooth', 'check', 'primary')}`)}<section class="card chart-selector"><div class="selector-label"><span class="eyebrow">PATIENT</span><strong>${selectedPatient ? esc(selectedPatient.fullName) : 'Select a patient to begin'}</strong></div><select data-change="dental-patient"><option value="">Choose patient...</option>${active(state.patients).sort((a, b) => a.fullName.localeCompare(b.fullName)).map((p) => `<option value="${p.id}" ${p.id === ui.dentalPatientId ? 'selected' : ''}>${esc(p.patientCode)} · ${esc(p.fullName)}</option>`).join('')}</select>${selectedPatient ? `<span class="chart-record-count">${records.length} tooth record${records.length === 1 ? '' : 's'}</span>` : ''}</section>${selectedPatient ? `<div class="dental-layout"><section class="card chart-card"><div class="chart-head"><div><h2>${dentition === 'primary' ? 'Primary dentition' : 'Adult dentition'}</h2><p>FDI notation · select a tooth to record its current status.</p></div><div class="dentition-toggle"><button class="${dentition === 'adult' ? 'active' : ''}" data-action="set-dentition" data-dentition="adult">Adult</button><button class="${dentition === 'primary' ? 'active' : ''}" data-action="set-dentition" data-dentition="primary">Primary</button></div></div><div class="dental-arch-label">UPPER ARCH</div><div class="teeth-row large-teeth ${dentition === 'primary' ? 'primary-teeth' : ''}">${upperTeeth.map((tooth) => toothButton(tooth, statuses[tooth])).join('')}</div><div class="arch-divider"><span>Midline</span></div><div class="teeth-row large-teeth lower-teeth ${dentition === 'primary' ? 'primary-teeth' : ''}">${lowerTeeth.map((tooth) => toothButton(tooth, statuses[tooth])).join('')}</div><div class="dental-arch-label lower-label">LOWER ARCH</div><div class="chart-legend"><span><i class="legend-dot healthy"></i>No recorded status</span><span><i class="legend-dot caries"></i>Caries</span><span><i class="legend-dot filled"></i>Filled</span><span><i class="legend-dot missing"></i>Missing</span><span><i class="legend-dot treatment"></i>Treatment recorded</span></div></section><aside class="card tooth-detail-card">${ui.dentalTooth ? renderToothDetail(selectedPatient, ui.dentalTooth, statuses[ui.dentalTooth]) : `<div class="tooth-placeholder">${icon('tooth', 32)}<h3>Select a tooth</h3><p>Choose a tooth from the chart to view or record its status and note.</p></div>`}</aside></div><section class="card chart-summary">${cardTitle('layers', 'Chart summary')}<div class="status-counts">${statusCounts.filter(([, count]) => count > 0).map(([label, count]) => `<div><strong>${count}</strong><span>${esc(label)}</span></div>`).join('') || '<p class="muted">No tooth statuses recorded yet. The chart starts clean by design.</p>'}</div></section>` : `<section class="card large-empty">${emptyState('tooth', 'Choose a patient to open the chart', 'Dental chart entries are always attached to a patient record. Add a patient first if the directory is empty.', state.patients.length ? '' : button('Add patient', 'open-patient', 'plus', 'primary'))}</section>`}</div>`;
}
function renderToothDetail(patient, tooth, status) {
  const record = state.dentalRecords.find((r) => r.patientId === patient.id && String(r.tooth) === String(tooth));
  return `<div class="tooth-detail-head"><span class="tooth-number">${tooth}</span><div><span class="eyebrow">TOOTH RECORD</span><h2>Tooth ${tooth}</h2></div><button class="icon-button" data-action="close-tooth" aria-label="Close tooth panel">${icon('close', 16)}</button></div><p class="muted">${esc(patient.fullName)} · Last updated ${record ? date(record.updatedAt?.slice(0, 10)) : 'not recorded'}</p><label class="field-label">Status<select data-change="tooth-status"><option value="">No recorded status</option>${['Healthy', 'Caries', 'Filled', 'Missing', 'Extracted', 'Root Canal', 'Crown', 'Bridge', 'Implant', 'Fracture', 'Other'].map((option) => `<option ${status === option ? 'selected' : ''}>${option}</option>`).join('')}</select></label><label class="field-label">Clinical note<textarea rows="5" data-input="tooth-note" placeholder="Record a concise note for this tooth...">${attr(record?.note || '')}</textarea></label><div class="tooth-detail-actions">${button('Save tooth record', 'save-tooth', 'check', 'primary')} ${record ? button('Remove record', 'remove-tooth', 'trash', 'link') : ''}</div>`;
}

function renderBilling() {
  const invoices = active(state.invoices).sort((a, b) => (b.date || '').localeCompare(a.date || ''));
  const total = sum(invoices, (i) => i.total);
  const collected = sum(active(state.payments), paymentAmount);
  const due = sum(invoices, (invoice) => invoicePaymentStatus(invoice).due);
  return `<div class="page">${pageHeader('Billing', 'Invoices, estimates and balances with a clear source of truth.', `${button('Print statement', 'print-billing', 'printer', 'secondary')}${button('New invoice', 'open-invoice', 'plus', 'primary')}`)}<div class="finance-summary"><div><span>Total billed</span><strong>${currency(total)}</strong><small>${invoices.length} invoice${invoices.length === 1 ? '' : 's'}</small></div><div><span>Collected</span><strong class="text-success">${currency(collected)}</strong><small>Valid recorded payments</small></div><div><span>Outstanding</span><strong class="text-warning">${currency(due)}</strong><small>Requires follow-up</small></div><div><span>Paid rate</span><strong>${total ? Math.round((collected / total) * 100) : 0}%</strong><small>Collected ÷ billed</small></div></div><section class="card table-card">${invoices.length ? dataTable(['Invoice', 'Patient', 'Date', 'Items', 'Total', 'Due', 'Status', ''], invoices.map((i) => { const paymentState = invoicePaymentStatus(i); return `<tr><td><span class="code-label">${esc(i.invoiceNumber)}</span></td><td><div class="person-cell"><span class="avatar avatar-table">${initials(patientName(i.patientId))}</span><strong>${esc(patientName(i.patientId))}</strong></div></td><td>${date(i.date)}</td><td>${number(i.items?.length || 0)} item${i.items?.length === 1 ? '' : 's'}</td><td><strong>${currency(i.total)}</strong></td><td class="${paymentState.due > 0 ? 'text-warning' : ''}">${currency(paymentState.due)}</td><td>${statusBadge(paymentState.status)}</td><td><div class="row-actions">${button('Print', 'print-invoice', 'printer', 'link', `data-id="${i.id}"`)}<button class="icon-button tiny" data-action="open-payment" data-invoice-id="${i.id}">${icon('credit', 16)}</button></div></td></tr>`; }).join('')) : emptyState('receipt', 'No invoices created', 'Create an invoice after a visit or treatment plan. Payments will be linked to it.', button('New invoice', 'open-invoice', 'plus', 'primary'))}</section><section class="card financial-note"><span>${icon('shield', 18)}</span><p><strong>Financial integrity</strong> Totals are calculated from invoice line items, discounts, configured taxes and valid payments. Historical payments should be reversed with a new adjustment rather than silently edited.</p></section></div>`;
}
function renderPayments() {
  const payments = active(state.payments).sort((a, b) => `${b.date}${b.createdAt}`.localeCompare(`${a.date}${a.createdAt}`));
  return `<div class="page">${pageHeader('Payments', 'A traceable register of every collection and receipt.', button('Record payment', 'open-payment', 'plus', 'primary'))}<section class="payment-method-strip">${paymentMethods().map((method) => `<div><span class="payment-method-icon">${icon(method === 'Cash' ? 'dollar' : method === 'Card' ? 'credit' : 'layers', 17)}</span><div><strong>${currency(sum(payments.filter((p) => p.method === method), paymentAmount))}</strong><small>${method}</small></div></div>`).join('')}</section><section class="card table-card">${payments.length ? dataTable(['Receipt', 'Date', 'Patient', 'Invoice', 'Method', 'Reference', 'Amount', 'Status', ''], payments.map((p) => `<tr><td><span class="code-label">${esc(p.receiptNumber || 'Receipt')}</span></td><td>${date(p.date)}</td><td><div class="person-cell"><span class="avatar avatar-table">${initials(patientName(p.patientId))}</span><strong>${esc(patientName(p.patientId))}</strong></div></td><td>${esc(byId(state.invoices, p.invoiceId)?.invoiceNumber || 'On account')}</td><td>${esc(p.method || '—')}</td><td>${esc(p.reference || p.transactionId || '—')}</td><td><strong>${currency(paymentAmount(p))}</strong>${paymentRefundedAmount(p) ? `<small class="cell-sub">Refunded ${currency(paymentRefundedAmount(p))}</small>` : ''}</td><td>${statusBadge(p.status || 'Recorded')}</td><td><div class="row-actions">${button('Print', 'print-payment', 'printer', 'link', `data-id="${p.id}"`)}${paymentAmount(p) > 0 ? button('Refund', 'refund-payment', 'refresh', 'link', `data-id="${p.id}"`) : ''}</div></td></tr>`).join('')) : emptyState('credit', 'No payments recorded', 'Record cash, bank, card or mobile financial service payments here.', button('Record payment', 'open-payment', 'plus', 'primary'))}</section></div>`;
}

function renderInventory() {
  const items = active(state.inventory).sort((a, b) => (a.name || '').localeCompare(b.name || ''));
  const low = items.filter((item) => Number(item.currentStock) <= Number(item.minimumStock || state.settings.lowStockThreshold));
  const expired = items.filter((item) => item.expiryDate && item.expiryDate < today());
  return `<div class="page">${pageHeader('Inventory', 'Keep materials, medicines and consumables accountable.', `${button('Add stock item', 'open-stock', 'plus', 'secondary')}${button('Adjust stock', 'open-stock-adjustment', 'refresh', 'primary')}${button('Export CSV', 'export-inventory', 'download', 'secondary')}`)}<div class="inventory-alerts"><div class="inventory-alert ${low.length ? 'has-alert' : ''}"><span>${icon('box', 18)}</span><div><strong>${low.length ? `${low.length} low-stock item${low.length > 1 ? 's' : ''}` : 'Stock levels look good'}</strong><small>${low.length ? 'Review reorder levels below.' : 'No reorder action is needed.'}</small></div></div><div class="inventory-alert ${expired.length ? 'has-alert danger-alert' : ''}"><span>${icon('clock', 18)}</span><div><strong>${expired.length ? `${expired.length} expired item${expired.length > 1 ? 's' : ''}` : 'No expired stock'}</strong><small>${expired.length ? 'Quarantine and record a movement.' : 'Expiry dates are within range.'}</small></div></div></div><section class="card table-card">${items.length ? dataTable(['Item', 'Category', 'Supplier', 'Current stock', 'Reorder at', 'Expiry', 'Batch / lot', 'Status', ''], items.map((item) => { const alert = Number(item.currentStock) <= Number(item.minimumStock || state.settings.lowStockThreshold); const expiredItem = item.expiryDate && item.expiryDate < today(); return `<tr><td><div class="item-cell"><span class="item-icon">${icon('box', 16)}</span><div><strong>${esc(item.name)}</strong><small>${esc(item.itemCode || '')} · ${esc(item.unit || 'unit')}</small></div></div></td><td>${esc(item.category || 'Uncategorised')}</td><td>${esc(byId(state.suppliers, item.supplierId)?.name || '—')}</td><td><strong class="${alert ? 'text-warning' : ''}">${number(item.currentStock)}</strong> ${esc(item.unit || '')}</td><td>${number(item.minimumStock || 0)}</td><td class="${expiredItem ? 'text-danger' : ''}">${item.expiryDate ? date(item.expiryDate) : '—'}</td><td>${esc(item.batch || '—')}</td><td>${statusBadge(expiredItem ? 'Expired' : alert ? 'Low stock' : 'In stock')}</td><td><div class="row-actions"><button class="icon-button tiny" data-action="edit-stock" data-id="${item.id}">${icon('edit', 16)}</button><button class="icon-button tiny" data-action="open-stock-adjustment" data-id="${item.id}">${icon('refresh', 16)}</button></div></td></tr>`; }).join('')) : emptyState('box', 'Inventory is empty', 'Add your first medicine, material or consumable to start tracking stock.', button('Add stock item', 'open-stock', 'plus', 'primary'))}</section></div>`;
}
function supplierStats(supplier) {
  const itemIds = new Set(active(state.inventory).filter((item) => item.supplierId === supplier.id).map((item) => item.id));
  const movements = active(state.stockMovements || []).filter((movement) => itemIds.has(movement.itemId) && movement.type === 'Purchase');
  return { items: itemIds.size, purchases: movements.length, value: sum(movements, (movement) => Math.abs(numeric(movement.quantity)) * numeric(movement.unitPrice)) };
}
function renderSuppliers() {
  const suppliers = active(state.suppliers).sort((a, b) => (a.name || '').localeCompare(b.name || ''));
  return `<div class="page">${pageHeader('Suppliers', 'Keep purchasing contacts and stock relationships in one place.', button('Add supplier', 'open-supplier', 'plus', 'primary'))}<section class="card supplier-grid">${suppliers.length ? suppliers.map((s) => `<article class="supplier-card"><div class="supplier-avatar">${initials(s.name)}</div><div class="supplier-card-head"><div><h3>${esc(s.name)}</h3><span>${esc(s.contactPerson || 'Contact not recorded')}</span></div><button class="icon-button tiny" data-action="edit-supplier" data-id="${s.id}">${icon('more', 17)}</button></div><div class="supplier-details">${s.phone ? `<span>${icon('phone', 13)}${esc(s.phone)}</span>` : ''}${s.email ? `<span>${icon('mail', 13)}${esc(s.email)}</span>` : ''}${s.address ? `<span>${icon('map', 13)}${esc(s.address)}</span>` : ''}</div><div class="supplier-footer"><span>${number(supplierStats(s).items)} items · ${number(supplierStats(s).purchases)} purchases${supplierStats(s).value ? ` · ${currency(supplierStats(s).value)}` : ''}</span>${button('Edit supplier', 'edit-supplier', 'edit', 'link', `data-id="${s.id}"`)}</div></article>`).join('') : `<div class="supplier-empty">${emptyState('truck', 'No suppliers added', 'Store purchasing contacts here so inventory remains traceable.', button('Add supplier', 'open-supplier', 'plus', 'primary'))}</div>`}</section></div>`;
}
function renderStaff() {
  const staff = active(state.staff).sort((a, b) => (a.name || '').localeCompare(b.name || ''));
  return `<div class="page">${pageHeader('Staff', 'A role-aware directory for dentists, assistants and the practice team.', button('Add staff member', 'open-staff', 'plus', 'primary'))}<section class="staff-toolbar card"><div><span class="eyebrow">ACCESS ARCHITECTURE</span><strong>Permissions stay configurable</strong><p>Keep clinical, reception and administrative responsibilities clear as your practice grows.</p></div><div class="role-pills"><span>Dentist</span><span>Receptionist</span><span>Manager</span><span>Assistant</span></div></section><section class="card table-card">${staff.length ? dataTable(['Staff ID', 'Team member', 'Role', 'Phone', 'Joining date', 'Status', ''], staff.map((person) => `<tr><td><span class="code-label">${esc(person.staffCode || '—')}</span></td><td><div class="person-cell"><span class="avatar avatar-table">${initials(person.name)}</span><div><strong>${esc(person.name)}</strong><small>${esc(person.email || 'Email not recorded')}</small></div></div></td><td>${badge(person.role || 'Other', 'neutral')}</td><td>${esc(person.phone || '—')}</td><td>${date(person.joiningDate)}</td><td>${statusBadge(person.status || 'Active')}</td><td><button class="icon-button tiny" data-action="edit-staff" data-id="${person.id}">${icon('edit', 16)}</button></td></tr>`).join('')) : emptyState('briefcase', 'No staff members yet', 'Add the people who help your practice run safely and consistently.', button('Add staff member', 'open-staff', 'plus', 'primary'))}</section></div>`;
}

function renderTreatments() {
  const treatments = active(state.treatments).sort((a, b) => (a.name || '').localeCompare(b.name || ''));
  return `<div class="page">${pageHeader('Treatment catalog', 'Keep procedure names, prices and chair time consistent across your practice.', button('Add treatment', 'open-treatment', 'plus', 'primary'))}<section class="clinical-intro"><div class="clinical-intro-icon purple-bg">${icon('layers', 22)}</div><div><strong>Your catalog, your clinical language</strong><p>Customize the treatments you offer. Prices remain editable on each invoice and are never silently applied to historical records.</p></div><span class="soft-label">Configurable</span></section><section class="card table-card">${treatments.length ? dataTable(['Code', 'Treatment', 'Category', 'Default price', 'Duration', 'Tooth required', 'Status', ''], treatments.map((t) => `<tr><td><span class="code-label">${esc(t.code || '—')}</span></td><td><strong>${esc(t.name)}</strong><small class="cell-sub">${esc(t.description || '')}</small></td><td>${esc(t.category || 'General')}</td><td>${currency(t.defaultPrice)}</td><td>${number(t.duration || 0)} min</td><td>${t.toothRequired ? 'Yes' : 'No'}</td><td>${statusBadge(t.active === false ? 'Inactive' : 'Active')}</td><td><button class="icon-button tiny" data-action="edit-treatment" data-id="${t.id}">${icon('edit', 16)}</button></td></tr>`).join('')) : emptyState('layers', 'Treatment catalog is empty', 'Add the procedures your practice provides. This list stays separate from patient-specific treatment history.', button('Add treatment', 'open-treatment', 'plus', 'primary'))}</section></div>`;
}
function renderAccounting() {
  const expenses = active(state.expenses).sort((a, b) => `${b.date}${b.createdAt}`.localeCompare(`${a.date}${a.createdAt}`));
  const collected = sum(active(state.payments), paymentAmount);
  const billed = sum(active(state.invoices), (i) => i.total);
  const costs = sum(expenses, (e) => e.amount);
  const categories = [...new Set(expenses.map((e) => e.category).filter(Boolean))];
  return `<div class="page">${pageHeader('Accounting & finance', 'A dedicated financial workspace—separate from the clinical dashboard.', `${button('Add expense', 'open-expense', 'plus', 'secondary')}${button('New invoice', 'open-invoice', 'plus', 'primary')}`)}<div class="finance-summary accounting-summary"><div><span>Collected</span><strong class="text-success">${currency(collected)}</strong><small>Valid patient payments</small></div><div><span>Invoiced</span><strong>${currency(billed)}</strong><small>Active invoice totals</small></div><div><span>Operating expenses</span><strong class="text-warning">${currency(costs)}</strong><small>${number(expenses.length)} expense entries</small></div><div><span>Net operating result</span><strong class="${collected - costs >= 0 ? 'text-success' : 'text-danger'}">${currency(collected - costs)}</strong><small>Collected minus expenses</small></div></div><section class="accounting-grid"><section class="card accounting-breakdown">${cardTitle('chart', 'Expense categories')} ${categories.length ? `<div class="category-bars">${categories.map((category) => { const amount = sum(expenses.filter((e) => e.category === category), (e) => e.amount); const width = costs ? Math.max(4, Math.round((amount / costs) * 100)) : 0; return `<div class="category-bar"><div><span>${esc(category)}</span><strong>${currency(amount)}</strong></div><div class="bar-track"><i style="width:${width}%"></i></div></div>`; }).join('')}</div>` : emptyState('chart', 'No expenses recorded', 'Add clinic operating costs to see a transparent breakdown.', button('Add expense', 'open-expense', 'plus', 'secondary'))}</section><section class="card accounting-shortcuts">${cardTitle('receipt', 'Finance shortcuts')}<div class="finance-links"><button data-action="navigate" data-page="billing">${icon('receipt', 17)}<span><strong>Billing & invoices</strong><small>View totals and outstanding</small></span>${icon('arrow', 14)}</button><button data-action="navigate" data-page="payments">${icon('credit', 17)}<span><strong>Payments</strong><small>Trace collections and receipts</small></span>${icon('arrow', 14)}</button><button data-action="navigate" data-page="reports">${icon('chart', 17)}<span><strong>Financial reports</strong><small>Revenue, expenses and net result</small></span>${icon('arrow', 14)}</button></div></section></section><section class="card table-card">${expenses.length ? dataTable(['Date', 'Description', 'Category', 'Method', 'Reference', 'Amount', ''], expenses.map((e) => `<tr><td>${date(e.date)}</td><td><strong>${esc(e.description)}</strong><small class="cell-sub">${esc(e.notes || '')}</small></td><td>${esc(e.category || 'Other')}</td><td>${esc(e.method || '—')}</td><td>${esc(e.reference || '—')}</td><td><strong>${currency(e.amount)}</strong></td><td><button class="icon-button tiny" data-action="print-expense" data-id="${e.id}">${icon('printer', 16)}</button></td></tr>`).join('')) : emptyState('dollar', 'No expenses recorded', 'Record rent, supplies, salaries and other operating costs here.', button('Add expense', 'open-expense', 'plus', 'primary'))}</section></div>`;
}

function renderReports() {
  const report = buildReport(ui.reportType, ui.reportsRange);
  const reportOptions = [['revenue', 'Revenue & collections'], ['patients', 'Patient register'], ['visits', 'Visit activity'], ['appointments', 'Appointments'], ['outstanding', 'Outstanding balances'], ['inventory', 'Inventory status'], ['expenses', 'Expenses']];
  return `<div class="page">${pageHeader('Reports', 'Accurate operational and financial views built from your records.', `${button('Print report', 'print-report', 'printer', 'secondary')}${button('Export PDF', 'export-report-pdf', 'file', 'secondary')}${button('Export CSV', 'export-report', 'download', 'primary')}`)}<section class="card report-controls"><label><span>Report</span><select data-change="report-type">${reportOptions.map(([id, label]) => `<option value="${id}" ${ui.reportType === id ? 'selected' : ''}>${label}</option>`).join('')}</select></label><label><span>Date range</span><select data-change="report-range"><option value="day" ${ui.reportsRange === 'day' ? 'selected' : ''}>Today</option><option value="7d" ${ui.reportsRange === '7d' ? 'selected' : ''}>Last 7 days</option><option value="month" ${ui.reportsRange === 'month' ? 'selected' : ''}>This month</option><option value="quarter" ${ui.reportsRange === 'quarter' ? 'selected' : ''}>Last 3 months</option><option value="6m" ${ui.reportsRange === '6m' ? 'selected' : ''}>Last 6 months</option><option value="year" ${ui.reportsRange === 'year' ? 'selected' : ''}>This year</option><option value="custom" ${ui.reportsRange === 'custom' ? 'selected' : ''}>Custom period</option><option value="all" ${ui.reportsRange === 'all' ? 'selected' : ''}>All records</option></select></label>${ui.reportsRange === 'custom' ? `<label><span>From</span><input type="date" value="${attr(ui.reportFrom)}" data-change="report-from"></label><label><span>To</span><input type="date" value="${attr(ui.reportTo)}" data-change="report-to"></label>` : ''}<div class="report-date-note">${icon('clock', 15)} ${report.from ? `${date(report.from)} — ${date(report.to)}` : 'All available records'}</div></section><section class="report-kpi-grid">${report.kpis.map((kpi) => `<div class="report-kpi"><span>${icon(kpi.icon, 17)}${esc(kpi.label)}</span><strong>${esc(kpi.value)}</strong><small>${esc(kpi.note)}</small></div>`).join('')}</section><section class="report-grid"><div class="card report-main">${cardTitle('chart', report.title, badge(report.from ? `${date(report.from, { month: 'short', day: 'numeric' })} – ${date(report.to, { month: 'short', day: 'numeric' })}` : 'All time', 'neutral'))}${report.body}</div><div class="card report-side">${cardTitle('activity', 'Report notes')}<ul class="report-notes"><li>Amounts use the same invoice and payment calculations as Billing.</li><li>Clinical reports are record-keeping tools, not medical advice.</li><li>Exported CSV files use UTF-8 encoding for Bengali compatibility.</li></ul>${button('Open data management', 'navigate', 'arrow', 'link', 'data-page="backup"')}</div></section></div>`;
}
function dateRange(range) {
  const to = range === 'custom' && ui.reportTo ? ui.reportTo : today();
  const end = new Date(`${to}T00:00:00`); let start = null;
  if (range === 'day') start = end;
  if (range === '7d') start = new Date(end.getTime() - 6 * 86400000);
  if (range === 'month') start = new Date(end.getFullYear(), end.getMonth(), 1);
  if (range === 'quarter') start = new Date(end.getFullYear(), end.getMonth() - 2, 1);
  if (range === '6m') start = new Date(end.getFullYear(), end.getMonth() - 5, 1);
  if (range === 'year') start = new Date(end.getFullYear(), 0, 1);
  if (range === 'custom' && ui.reportFrom) start = new Date(`${ui.reportFrom}T00:00:00`);
  const from = start ? start.toISOString().slice(0, 10) : null;
  return { from, to, invalid: range === 'custom' && (!from || to < from) };
}

function inRange(value, range) { if (!value || range.from === null) return true; return value >= range.from && value <= range.to; }
function buildReport(type, rangeKey) {
  const range = dateRange(rangeKey);
  const payments = active(state.payments).filter((p) => inRange(p.date, range));
  const invoices = active(state.invoices).filter((i) => inRange(i.date, range));
  const visits = active(state.visits).filter((v) => inRange(v.date, range));
  const appointments = active(state.appointments).filter((a) => inRange(a.date, range));
  const expenses = active(state.expenses).filter((e) => inRange(e.date, range));
  const base = { from: range.from, to: range.to, kpis: [], title: '', body: '' };
  if (type === 'patients') {
    const patients = active(state.patients).filter((p) => inRange(p.registrationDate, range));
    base.title = 'Patient register'; base.kpis = [{ label: 'Patients in range', value: number(patients.length), note: 'New registrations', icon: 'users' }, { label: 'Total directory', value: number(active(state.patients).length), note: 'All active patients', icon: 'book' }, { label: 'With phone', value: number(patients.filter((p) => p.phone).length), note: 'Contact completeness', icon: 'phone' }, { label: 'Upcoming visit', value: number(active(state.patients).filter((p) => p.nextVisit && p.nextVisit >= today()).length), note: 'Future appointments', icon: 'calendar' }]; base.body = reportTable(['Patient code', 'Patient', 'Registration', 'Phone', 'Status'], patients.map((p) => [p.patientCode, p.fullName, date(p.registrationDate), p.phone || '—', p.status || 'Active']));
  } else if (type === 'visits') {
    base.title = 'Visit activity'; base.kpis = [{ label: 'Visits', value: number(visits.length), note: 'Recorded encounters', icon: 'activity' }, { label: 'Patients seen', value: number(new Set(visits.map((v) => v.patientId)).size), note: 'Unique patients', icon: 'users' }, { label: 'With follow-up', value: number(visits.filter((v) => v.followUpDate).length), note: 'Continuity of care', icon: 'flag' }, { label: 'Treatments noted', value: number(visits.filter((v) => v.treatmentPerformed).length), note: 'Treatment documentation', icon: 'tooth' }]; base.body = reportTable(['Date', 'Patient', 'Reason', 'Diagnosis', 'Follow-up'], visits.map((v) => [date(v.date), patientName(v.patientId), v.reason || '—', v.diagnosis || '—', v.followUpDate ? date(v.followUpDate) : '—']));
  } else if (type === 'appointments') {
    base.title = 'Appointment activity'; base.kpis = [{ label: 'Appointments', value: number(appointments.length), note: 'In selected period', icon: 'calendar' }, { label: 'Completed', value: number(appointments.filter((a) => a.status === 'Completed').length), note: 'Completed visits', icon: 'check' }, { label: 'No-shows', value: number(appointments.filter((a) => a.status === 'No Show').length), note: 'Needs review', icon: 'warning' }, { label: 'Completion rate', value: `${appointments.length ? Math.round((appointments.filter((a) => a.status === 'Completed').length / appointments.length) * 100) : 0}%`, note: 'Completed ÷ scheduled', icon: 'chart' }]; base.body = reportTable(['Date', 'Time', 'Patient', 'Reason', 'Status'], appointments.map((a) => [date(a.date), time(a.time), patientName(a.patientId), a.reason || '—', a.status || 'Scheduled']));
  } else if (type === 'outstanding') {
    const dueInvoices = invoices.map((i) => ({ ...i, ...invoicePaymentStatus(i) })).filter((i) => Number(i.due) > 0); const due = sum(dueInvoices, (i) => i.due); base.title = 'Outstanding balances'; base.kpis = [{ label: 'Outstanding', value: currency(due), note: 'Open invoice balance', icon: 'credit' }, { label: 'Open invoices', value: number(dueInvoices.length), note: 'Require collection', icon: 'receipt' }, { label: 'Partially paid', value: number(dueInvoices.filter((i) => i.paid > 0).length), note: 'Partially collected', icon: 'activity' }, { label: 'Unpaid', value: number(dueInvoices.filter((i) => !i.paid).length), note: 'No payment recorded', icon: 'warning' }]; base.body = reportTable(['Invoice', 'Patient', 'Date', 'Total', 'Paid', 'Due'], dueInvoices.map((i) => [i.invoiceNumber, patientName(i.patientId), date(i.date), currency(i.total), currency(i.paid), currency(i.due)]));
  } else if (type === 'inventory') {
    const items = active(state.inventory); const low = items.filter((i) => Number(i.currentStock) <= Number(i.minimumStock || state.settings.lowStockThreshold)); base.title = 'Inventory status'; base.kpis = [{ label: 'Items tracked', value: number(items.length), note: 'Active stock items', icon: 'box' }, { label: 'Low stock', value: number(low.length), note: 'At or below reorder', icon: 'warning' }, { label: 'Expired', value: number(items.filter((i) => i.expiryDate && i.expiryDate < today()).length), note: 'Requires action', icon: 'clock' }, { label: 'Units on hand', value: number(sum(items, (i) => i.currentStock)), note: 'Across all units', icon: 'layers' }]; base.body = reportTable(['Item', 'Category', 'Current stock', 'Reorder at', 'Expiry', 'Status'], items.map((i) => [i.name, i.category || '—', `${i.currentStock} ${i.unit || ''}`, i.minimumStock || 0, i.expiryDate ? date(i.expiryDate) : '—', Number(i.currentStock) <= Number(i.minimumStock || state.settings.lowStockThreshold) ? 'Low stock' : 'In stock']));
  } else if (type === 'expenses') {
    const total = sum(expenses, (e) => e.amount); base.title = 'Expense report'; base.kpis = [{ label: 'Expenses', value: currency(total), note: 'Recorded operating costs', icon: 'dollar' }, { label: 'Transactions', value: number(expenses.length), note: 'Expense entries', icon: 'receipt' }, { label: 'Categories', value: number(new Set(expenses.map((e) => e.category)).size), note: 'Categories used', icon: 'layers' }, { label: 'Average', value: currency(expenses.length ? total / expenses.length : 0), note: 'Per transaction', icon: 'chart' }]; base.body = reportTable(['Date', 'Category', 'Description', 'Method', 'Amount'], expenses.map((e) => [date(e.date), e.category || 'Other', e.description || '—', e.method || '—', currency(e.amount)]));
  } else {
    const collected = sum(payments, paymentAmount); const billed = sum(invoices, (i) => i.total); const expenseTotal = sum(expenses, (e) => e.amount); base.title = 'Revenue & collections'; base.kpis = [{ label: 'Collected', value: currency(collected), note: 'Valid payments', icon: 'credit' }, { label: 'Billed', value: currency(billed), note: 'Invoice totals', icon: 'receipt' }, { label: 'Expenses', value: currency(expenseTotal), note: 'Operating expenses', icon: 'dollar' }, { label: 'Net operating', value: currency(collected - expenseTotal), note: 'Collected minus expenses', icon: 'chart' }]; base.body = reportTable(['Date', 'Patient', 'Invoice', 'Method', 'Amount'], payments.map((p) => [date(p.date), patientName(p.patientId), byId(state.invoices, p.invoiceId)?.invoiceNumber || 'On account', p.method || '—', currency(paymentAmount(p))]));
  }
  return base;
}
function reportTable(headers, rows) { return rows.length ? `<div class="report-table-wrap">${dataTable(headers, rows.map((row) => `<tr>${row.map((value) => `<td>${esc(value)}</td>`).join('')}</tr>`).join(''))}</div>` : emptyState('chart', 'No records in this range', 'Change the date range or create records to populate this report.'); }

function renderAnalytics() {
  const snapshot = analyticsSnapshot(state, ui.analyticsRange || 'month', new Date(), ui.analyticsFrom, ui.analyticsTo);
  const methods = snapshot.byMethod;
  const maxMethod = Math.max(1, ...methods.map((entry) => entry.value));
  const recentMonths = Array.from({ length: 6 }, (_, index) => {
    const point = new Date();
    point.setDate(1);
    point.setMonth(point.getMonth() - (5 - index));
    const key = point.toISOString().slice(0, 7);
    const revenue = active(state.payments).filter((record) => record.date?.startsWith(key)).reduce((total, record) => total + paymentAmount(record), 0);
    const visits = active(state.visits).filter((record) => record.date?.startsWith(key)).length;
    return { label: point.toLocaleDateString(state.settings.language === 'Bengali' ? 'bn-BD' : 'en-US', { month: 'short' }), revenue, visits };
  });
  const maxRevenue = Math.max(1, ...recentMonths.map((point) => point.revenue));
  return `<div class="page analytics-page">${pageHeader('Analytics', 'Meaningful practice signals based on the records you actually keep.', `<label class="period-picker"><span>${icon('calendar', 15)}</span><select data-change="analytics-range"><option value="today" ${ui.analyticsRange === 'today' ? 'selected' : ''}>Today</option><option value="7d" ${ui.analyticsRange === '7d' ? 'selected' : ''}>Last 7 days</option><option value="month" ${ui.analyticsRange === 'month' ? 'selected' : ''}>Last 1 month</option><option value="quarter" ${ui.analyticsRange === 'quarter' ? 'selected' : ''}>Last 3 months</option><option value="6m" ${ui.analyticsRange === '6m' ? 'selected' : ''}>Last 6 months</option><option value="year" ${ui.analyticsRange === 'year' ? 'selected' : ''}>This year</option><option value="all" ${ui.analyticsRange === 'all' ? 'selected' : ''}>All records</option></select>${icon('down', 14)}</label>`)}<div class="analytics-kpi-grid"><div class="analytics-kpi accent"><span>${icon('credit', 16)}Collected</span><strong>${currency(snapshot.revenue)}</strong><small>${number(snapshot.counts.appointments)} appointments in range</small></div><div class="analytics-kpi"><span>${icon('receipt', 16)}Billed</span><strong>${currency(snapshot.billed)}</strong><small>${number(snapshot.counts.patients)} new patient records</small></div><div class="analytics-kpi"><span>${icon('dollar', 16)}Operating result</span><strong class="${snapshot.net >= 0 ? 'text-success' : 'text-danger'}">${currency(snapshot.net)}</strong><small>${currency(snapshot.expenses)} recorded expenses</small></div><div class="analytics-kpi"><span>${icon('chart', 16)}Completion</span><strong>${snapshot.completionRate}%</strong><small>${snapshot.noShowRate}% no-show rate</small></div></div><div class="analytics-grid"><section class="card analytics-chart-card">${cardTitle('chart', 'Revenue and visit trend', badge(snapshot.bounds.from ? `${date(snapshot.bounds.from)} – ${date(snapshot.bounds.to)}` : 'All time', 'neutral'))}<div class="trend-chart" aria-label="Revenue and visit trend">${recentMonths.map((point) => `<div class="trend-column"><div class="trend-bars"><i class="trend-bar revenue" style="height:${Math.max(5, Math.round((point.revenue / maxRevenue) * 100))}%" title="${attr(currency(point.revenue))}"></i><i class="trend-bar visits" style="height:${Math.max(5, Math.min(100, point.visits * 12))}%" title="${attr(`${point.visits} visits`)}"></i></div><strong>${esc(point.label)}</strong><small>${number(point.visits)} visits</small></div>`).join('')}</div><div class="chart-legend"><span><i class="legend-dot filled"></i>Collected</span><span><i class="legend-dot healthy"></i>Visits</span></div></section><section class="card analytics-chart-card">${cardTitle('credit', 'Payment mix', badge(`${methods.length} methods`, 'neutral'))}${methods.length ? `<div class="analytics-bars">${methods.map((entry) => `<div class="analytics-bar-row"><div><span>${esc(entry.label)}</span><strong>${currency(entry.value)}</strong></div><div class="bar-track"><i style="width:${Math.max(4, Math.round((entry.value / maxMethod) * 100))}%"></i></div></div>`).join('')}</div>` : emptyState('credit', 'No payment data', 'Recorded payments will reveal collection patterns for your practice.')}</section></div><section class="card analytics-insight-grid"><div>${cardTitle('users', 'Clinical activity')}<div class="insight-list"><div><span>Patients registered</span><strong>${number(snapshot.counts.patients)}</strong></div><div><span>Visits recorded</span><strong>${number(snapshot.counts.visits)}</strong></div><div><span>Appointments completed</span><strong>${number(snapshot.counts.completed)}</strong></div></div></div><div>${cardTitle('shield', 'Commercial review')}<p class="muted">Analytics never invents targets or diagnoses. It summarizes saved records so a clinic can make operational decisions with a clear source of truth.</p>${button('Open reports', 'navigate', 'arrow', 'link', 'data-page="reports"')}</div></section></div>`;
}

function renderNotifications() {
  const items = notificationItems();
  return `<div class="page notifications-page">${pageHeader('Notifications', 'Actionable reminders for queue, follow-up, stock, balances and backup health.', button('Mark all read', 'mark-notifications-read', 'check', 'secondary'))}<section class="card notification-center">${items.length ? items.map((item) => `<article class="notification-row ${item.read ? 'read' : ''}"><span class="notification-type ${item.type || 'info'}">${icon(item.type === 'inventory' || item.type === 'warning' ? 'warning' : item.type === 'backup' ? 'backup' : item.type === 'clinical' || item.type === 'followup' ? 'flag' : 'bell', 16)}</span><div><strong>${esc(item.title)}</strong><p>${esc(item.message)}</p><small>${item.date ? date(item.date) : 'Now'}${item.page ? ` · ${esc(item.page)}` : ''}</small></div><div class="notification-actions">${item.page ? button('Open', 'notification-open', 'arrow', 'link', `data-id="${attr(item.id)}"`) : ''}${item.persisted ? `<button class="icon-button tiny" data-action="dismiss-notification" data-id="${attr(item.id)}" aria-label="Dismiss notification">${icon('close', 15)}</button>` : ''}</div></article>`).join('') : emptyState('bell', 'No notifications', 'The workspace will surface actionable reminders here as records need attention.')}</section></div>`;
}

function renderDiagnostics() {
  const relationshipErrors = validateRelationships(state);
  const attachmentIssues = active(state.attachments).filter((attachment) => !validateAttachmentFile(attachment).allowed);
  const storageInfo = globalThis.dentivaDesktop?.storeInfo?.() || { storage: 'Browser preview', bytes: new Blob([JSON.stringify(state)]).size, source: 'local preview' };
  const health = relationshipErrors.length || attachmentIssues.length ? 'Needs attention' : 'Healthy';
  return `<div class="page diagnostics-page">${pageHeader('Diagnostics', 'A transparent health view for the local database, attachments, backups and access model.', button('Run integrity check', 'integrity-check', 'refresh', 'primary'))}<section class="diagnostic-hero ${health === 'Healthy' ? 'healthy' : 'attention'}"><div class="diagnostic-status-mark">${icon(health === 'Healthy' ? 'check' : 'warning', 25)}</div><div><span class="eyebrow">WORKSPACE HEALTH</span><h2>${health}</h2><p>${health === 'Healthy' ? 'Relationship, attachment and schema checks found no current issues.' : `${relationshipErrors.length + attachmentIssues.length} issue(s) need review before a restore or export.`}</p></div><span class="soft-label">Schema v${state.schemaVersion} · ${APP_VERSION}</span></section><div class="diagnostic-grid"><section class="card diagnostic-card">${cardTitle('database', 'Database health')}<dl class="diagnostic-list"><div><dt>Storage</dt><dd>${esc(storageInfo.storage || 'Local')}</dd></div><div><dt>Database size</dt><dd>${formatBytes(storageInfo.bytes || 0)}</dd></div><div><dt>Source</dt><dd>${esc(storageInfo.source || 'Preview')}</dd></div><div><dt>Records</dt><dd>${number(totalRecords())}</dd></div><div><dt>Last backup</dt><dd>${state.lastBackupAt ? date(state.lastBackupAt.slice(0, 10)) : 'Not recorded'}</dd></div></dl></section><section class="card diagnostic-card">${cardTitle('shield', 'Access health')}<dl class="diagnostic-list"><div><dt>Active users</dt><dd>${number(active(state.users).length)}</dd></div><div><dt>Administrator</dt><dd>${active(state.users).some((user) => user.role === 'Administrator') ? 'Protected' : 'Missing'}</dd></div><div><dt>Application lock</dt><dd>${state.settings.applicationLock ? 'Enabled' : 'Not enabled'}</dd></div><div><dt>Audit events</dt><dd>${number(state.audit.length)}</dd></div></dl></section></div><section class="card diagnostic-issues">${cardTitle('warning', 'Integrity results')}${relationshipErrors.length || attachmentIssues.length ? `<ul>${[...relationshipErrors.slice(0, 12), ...attachmentIssues.slice(0, 12).map((item) => `Attachment ${item.name || item.id} has invalid metadata.`)].map((issue) => `<li>${esc(issue)}</li>`).join('')}</ul>` : emptyState('check', 'No current integrity issues', 'Run this check again after importing or restoring data.')}</section></div>`;
}

function renderBackup() {
  const storageBytes = new Blob([JSON.stringify(state)]).size;
  const last = state.lastBackupAt;
  const backupHistory = active(state.audit || []).filter((entry) => entry.entity === 'Backup' && ['Backup created', 'Backup restored'].includes(entry.action)).slice(0, 8);
  const candidate = ui.restoreCandidate;
  return `<div class="page">${pageHeader('Backup & restore', 'Protect the complete local record, including settings and relationships.', `${button('Export full backup', 'export-backup', 'download', 'primary')}${button('Import backup', 'trigger-import', 'upload', 'secondary')}`)}<div class="backup-hero"><div class="backup-hero-icon">${icon('shield', 27)}</div><div><span class="eyebrow">LOCAL-FIRST PROTECTION</span><h2>Your records belong to your practice</h2><p>Backups are structured JSON packages with schema version, record counts and audit metadata. Keep copies on a trusted device or encrypted drive.</p></div><div class="backup-status">${last ? `<span class="status-check">${icon('check', 15)}</span><strong>Verified</strong><small>${date(last.slice(0, 10))}</small>` : `<span class="status-check neutral">${icon('backup', 15)}</span><strong>Not yet backed up</strong><small>Start with an export</small>`}</div></div><div class="backup-grid"><section class="card backup-card">${cardTitle('download', 'Create a backup') }<p>Exports all clinical, financial, operational and configuration records in one portable package.</p><div class="backup-facts"><div><span>Records</span><strong>${number(totalRecords())}</strong></div><div><span>Storage</span><strong>${formatBytes(storageBytes)}</strong></div><div><span>Schema</span><strong>v${state.schemaVersion}</strong></div></div>${button('Export verified backup', 'export-backup', 'download', 'primary')} ${button('Export patients CSV', 'export-patients', 'file', 'link')}</section><section class="card backup-card">${cardTitle('upload', 'Restore or import') }<p>Validate a Dentiva Pro backup before committing. Existing records are never silently overwritten.</p><div class="restore-drop" data-action="trigger-import"><span>${icon('upload', 22)}</span><strong>Choose a backup file</strong><small>JSON backup · exported from Dentiva Pro</small></div><input id="backup-file" type="file" accept=".json,.dentiva" class="visually-hidden" data-input="backup-file">${candidate ? renderRestoreCandidate(candidate) : ''}</section></div><section class="card data-health">${cardTitle('activity', 'Data management') }<div class="health-list"><div><span>${icon('database', 17)}</span><div><strong>Database health</strong><small>Local store schema v${state.schemaVersion} · ${number(state.audit.length)} audit entries</small></div><span class="health-ok">Healthy</span></div><div><span>${icon('box', 17)}</span><div><strong>Attachment storage</strong><small>Managed file references: ${number(state.attachments.length)}</small></div><span class="health-ok">Ready</span></div><div><span>${icon('history', 17)}</span><div><strong>Backup history</strong><small>${backupHistory.length ? `${number(backupHistory.length)} recent local operation${backupHistory.length === 1 ? '' : 's'}` : 'No backup operations recorded yet'}</small></div><span class="health-ok">${backupHistory.length ? 'Tracked' : 'Ready'}</span></div><div><span>${icon('refresh', 17)}</span><div><strong>Last operation</strong><small>${state.audit[0] ? `${esc(state.audit[0].action)} · ${date(state.audit[0].at.slice(0, 10))}` : 'No operations recorded yet'}</small></div>${button('View audit trail', 'open-audit-log', 'arrow', 'link')}<button class="text-button" data-action="integrity-check">Run check${icon('arrow', 14)}</button></div></div></section></div>`;
}
function totalRecords() { return arrayKeys.reduce((total, key) => total + state[key].length, 0); }
function formatBytes(bytes) { if (!bytes) return '0 B'; const units = ['B', 'KB', 'MB', 'GB']; const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1); return `${(bytes / Math.pow(1024, index)).toFixed(index ? 1 : 0)} ${units[index]}`; }
function renderRestoreCandidate(candidate) {
  const patients = candidate.data?.patients || [];
  const selectedPatients = new Set(candidate.selectedPatientIds || []);
  const patientScope = Boolean(candidate.patientScope);
  const patientPicker = patients.length ? `<details class="restore-patient-picker" open><summary>Select patients for a patient-scoped restore (${patientScope ? selectedPatients.size : 'all'} selected)</summary><div class="restore-patient-actions"><button type="button" class="text-button" data-action="select-all-restore-patients">Select all</button><button type="button" class="text-button" data-action="clear-restore-patients">Clear selection</button></div><div class="restore-patient-list">${patients.slice(0, 200).map((patient) => `<label class="check-line"><input type="checkbox" value="${attr(patient.id)}" ${!patientScope || selectedPatients.has(patient.id) ? 'checked' : ''} data-change="restore-patient"><span>${esc(patient.patientCode || '')} · ${esc(patient.fullName || 'Unnamed patient')}</span></label>`).join('')}</div>${patients.length > 200 ? `<small class="field-hint">Showing the first 200 patients. Use module-only restore for a larger import.</small>` : ''}</details>` : '';
  return `<div class="restore-preview"><div class="restore-preview-head"><div><span class="eyebrow">IMPORT PREVIEW</span><strong>${esc(candidate.name)}</strong><small>${esc(candidate.product || 'Unknown product')} · schema ${esc(candidate.schemaVersion || '?')}</small></div><button class="icon-button" data-action="clear-restore">${icon('close', 15)}</button></div><div class="restore-summary"><div><strong>${number(candidate.total)}</strong><span>records detected</span></div><div><strong>${number(candidate.conflicts)}</strong><span>possible conflicts</span></div><div><strong>${number(candidate.errors?.length || 0)}</strong><span>validation errors</span></div></div>${candidate.warnings?.length ? `<div class="restore-warnings">${candidate.warnings.map((warning) => `<p>${icon('warning', 13)}${esc(warning)}</p>`).join('')}</div>` : ''}<div class="restore-options"><label>Conflict strategy<select data-change="restore-strategy"><option ${candidate.strategy === 'Keep Existing' ? 'selected' : ''}>Keep Existing</option><option ${candidate.strategy === 'Skip' ? 'selected' : ''}>Skip</option><option ${candidate.strategy === 'Replace' ? 'selected' : ''}>Replace</option><option ${candidate.strategy === 'Create New Copy' ? 'selected' : ''}>Create New Copy</option></select></label><label class="check-line"><input type="checkbox" ${candidate.restorePatients !== false ? 'checked' : ''} data-change="restore-patients"> Patients (${candidate.counts.patients || 0})</label><label class="check-line"><input type="checkbox" ${candidate.restoreClinical !== false ? 'checked' : ''} data-change="restore-clinical"> Clinical & appointments</label><label class="check-line"><input type="checkbox" ${candidate.restoreFinance !== false ? 'checked' : ''} data-change="restore-finance"> Billing & finance</label><label class="check-line"><input type="checkbox" ${candidate.restoreOperations !== false ? 'checked' : ''} data-change="restore-operations"> Inventory, suppliers & staff</label><label class="check-line"><input type="checkbox" ${candidate.restoreSettings !== false ? 'checked' : ''} data-change="restore-settings"> Settings & audit</label></div>${patientPicker}${candidate.errors?.length ? `<p class="inline-error">${candidate.errors.slice(0, 4).map((error) => esc(error)).join(' ')}</p>` : ''}${button('Validate and restore selection', 'restore-confirm', 'check', 'primary')}</div>`;
}

function renderSettings() {
  const s = state.settings;
  return `<div class="page settings-page">${pageHeader('Settings', 'Configure the practice once, then keep the workflow consistent.', button('Save settings', 'save-settings', 'check', 'primary'))}<div class="settings-layout"><nav class="settings-nav"><div class="active">${icon('grid', 16)}General</div><div>${icon('users', 16)}Clinic & doctor</div><div>${icon('calendar', 16)}Appointments</div><div>${icon('receipt', 16)}Billing & payments</div><div>${icon('box', 16)}Inventory</div><div>${icon('printer', 16)}Printing</div><div>${icon('shield', 16)}Security</div><div>${icon('bell', 16)}Notifications</div></nav><section class="settings-content"><section class="card settings-card"><div class="settings-section-head"><div><span class="eyebrow">CLINIC IDENTITY</span><h2>Make every document feel like your practice</h2><p>Your clinic name and contact details appear on printable documents.</p></div>${safeLogoSource(s.logo) ? `<img class="logo-preview" src="${attr(safeLogoSource(s.logo))}" alt="Clinic logo">` : `<div class="logo-placeholder">${icon('tooth', 20)}</div>`}</div><div class="logo-controls">${button('Upload clinic logo', 'choose-logo', 'upload', 'secondary')}<input id="clinic-logo-file" class="visually-hidden" type="file" accept="image/png,image/jpeg,image/webp" data-input="clinic-logo-file">${s.logo ? button('Remove logo', 'remove-logo', 'trash', 'link') : ''}</div><div class="form-grid two"><label class="field-label">Clinic / practice name<input name="clinicName" value="${attr(s.clinicName)}" data-settings></label><label class="field-label">Chamber / branch<input name="chamberName" value="${attr(s.chamberName)}" data-settings></label><label class="field-label">Dentist name<input name="dentistName" value="${attr(s.dentistName)}" data-settings></label><label class="field-label">Professional title<input name="professionalTitle" value="${attr(s.professionalTitle)}" data-settings></label><label class="field-label">Phone<input name="phone" value="${attr(s.phone)}" data-settings></label><label class="field-label">Email<input name="email" value="${attr(s.email)}" data-settings></label><label class="field-label full">Address<textarea name="address" rows="2" data-settings>${attr(s.address)}</textarea></label><label class="field-label">City<input name="city" value="${attr(s.city)}" data-settings></label><label class="field-label">District<input name="district" value="${attr(s.district)}" data-settings></label></div></section><section class="card settings-card"><div class="settings-section-head"><div><span class="eyebrow">LOCALIZATION</span><h2>Use the language your team understands</h2><p>Data remains language-neutral; only labels and formatting change.</p></div></div><div class="form-grid two"><label class="field-label">Default language<select name="language" data-settings><option ${s.language === 'English' ? 'selected' : ''}>English</option><option ${s.language === 'Bengali' ? 'selected' : ''}>Bengali</option></select></label><label class="field-label">Currency<select name="currency" data-settings><option ${s.currency === 'BDT' ? 'selected' : ''}>BDT</option><option ${s.currency === 'USD' ? 'selected' : ''}>USD</option></select></label><label class="field-label">Timezone<select name="timezone" data-settings><option ${s.timezone === 'Asia/Dhaka' ? 'selected' : ''}>Asia/Dhaka</option><option ${s.timezone === 'Asia/Kolkata' ? 'selected' : ''}>Asia/Kolkata</option><option ${s.timezone === 'UTC' ? 'selected' : ''}>UTC</option></select></label><label class="field-label">Date format<select name="dateFormat" data-settings><option ${s.dateFormat === 'dd MMM yyyy' ? 'selected' : ''}>dd MMM yyyy</option><option ${s.dateFormat === 'dd/MM/yyyy' ? 'selected' : ''}>dd/MM/yyyy</option><option ${s.dateFormat === 'yyyy-MM-dd' ? 'selected' : ''}>yyyy-MM-dd</option></select></label><label class="field-label">Time format<select name="timeFormat" data-settings><option ${s.timeFormat === '12-hour' ? 'selected' : ''}>12-hour</option><option ${s.timeFormat === '24-hour' ? 'selected' : ''}>24-hour</option></select></label><label class="field-label full">Payment methods<input name="paymentMethodsText" value="${attr((s.paymentMethods || []).join(', '))}" data-settings placeholder="Cash, Bank, Card, bKash, Nagad, Rocket, Upay"><small class="field-hint">Separate methods with commas. Cash, Bank and Card are always available.</small></label><label class="field-label full">Expense categories<input name="expenseCategoriesText" value="${attr((s.expenseCategories || []).join(', '))}" data-settings placeholder="Rent, Supplies, Maintenance"><small class="field-hint">Keep operating categories consistent for accounting and reports.</small></label><label class="field-label full">Inventory categories<input name="inventoryCategoriesText" value="${attr((s.inventoryCategories || []).join(', '))}" data-settings placeholder="Medicine, Dental material, Consumable"><small class="field-hint">Categories are local configuration; existing items keep their saved category.</small></label><label class="field-label full">Rooms / chairs<input name="roomsText" value="${attr((s.rooms || ['Room 1']).join(', '))}" data-settings placeholder="Room 1, Room 2"><small class="field-hint">Use room names for appointment conflict detection.</small></label><label class="field-label full">Custom patient fields<input name="customPatientFieldsText" value="${attr((s.customPatientFields || []).map((field) => field.label || field).join(', '))}" data-settings placeholder="Insurance number, Preferred language"><small class="field-hint">Comma-separated fields appear in the patient registration form.</small></label><label class="field-label">Print layout<select name="printPageSize" data-settings><option value="A4" ${s.printPageSize === 'A4' ? 'selected' : ''}>A4 document</option><option value="A5" ${s.printPageSize === 'A5' ? 'selected' : ''}>A5 document</option><option value="Letter" ${s.printPageSize === 'Letter' ? 'selected' : ''}>Letter document</option><option value="Receipt" ${s.printPageSize === 'Receipt' ? 'selected' : ''}>80 mm receipt</option></select></label><label class="field-label full">Document footer<input name="documentFooter" value="${attr(s.documentTemplate?.footer || '')}" data-settings-template="footer"><small class="field-hint">Shown on printable invoices, receipts, prescriptions, statements and reports.</small></label><label class="toggle-line"><input type="checkbox" ${s.documentTemplate?.showLogo !== false ? 'checked' : ''} data-settings-template="showLogo"><span class="toggle-ui"></span><span><strong>Show clinic logo in documents</strong><small>Use the logo configured above when a print layout supports it.</small></span></label><label class="toggle-line"><input type="checkbox" ${s.documentTemplate?.showClinicContact !== false ? 'checked' : ''} data-settings-template="showClinicContact"><span class="toggle-ui"></span><span><strong>Show clinic contact in documents</strong><small>Include dentist, phone and address in the document header.</small></span></label><label class="toggle-line"><input type="checkbox" ${s.taxEnabled ? 'checked' : ''} data-settings-checkbox="taxEnabled"><span class="toggle-ui"></span><span><strong>Apply default invoice tax</strong><small>Use the configured rate on new invoices; historical invoices remain unchanged.</small></span></label><label class="field-label">Default tax rate (%)<input type="number" min="0" max="100" step="0.01" name="taxRate" value="${attr(s.taxRate)}" data-settings></label></div></section><section class="card settings-card"><div class="settings-section-head"><div><span class="eyebrow">NUMBERING & CONTROL</span><h2>Keep records identifiable</h2><p>Prefixes apply to future records and do not rewrite history.</p></div></div><div class="form-grid three"><label class="field-label">Patient code prefix<input name="patientPrefix" value="${attr(s.patientPrefix)}" data-settings></label><label class="field-label">Invoice prefix<input name="invoicePrefix" value="${attr(s.invoicePrefix)}" data-settings></label><label class="field-label">Appointment prefix<input name="appointmentPrefix" value="${attr(s.appointmentPrefix)}" data-settings></label><label class="field-label">Queue serial prefix<input name="serialPrefix" value="${attr(s.serialPrefix)}" data-settings></label><label class="field-label">Default duration (min)<input type="number" min="5" name="defaultDuration" value="${attr(s.defaultDuration)}" data-settings></label><label class="field-label">Low-stock threshold<input type="number" min="0" name="lowStockThreshold" value="${attr(s.lowStockThreshold)}" data-settings></label></div></section><section class="card settings-card"><div class="settings-section-head"><div><span class="eyebrow">PRIVACY & SECURITY</span><h2>Keep the workspace private</h2><p>Local data never leaves this device through Dentiva Pro.</p></div><span class="security-pill">${icon('lock', 14)} Protected</span></div><div class="security-options"><label class="toggle-line"><input type="checkbox" ${s.notifications ? 'checked' : ''} data-settings-checkbox="notifications"><span class="toggle-ui"></span><span><strong>In-app notifications</strong><small>Show meaningful appointment, follow-up and stock signals.</small></span></label><div class="notification-rule-grid"><span class="field-hint">Notification categories</span>${NOTIFICATION_RULES.map(([kind, label]) => `<label class="toggle-line compact"><input type="checkbox" data-settings-rule="${kind}" ${notificationRuleEnabled(kind) ? 'checked' : ''}><span class="toggle-ui"></span><span><strong>${label}</strong></span></label>`).join('')}</div><div class="security-control"><div><strong>Session timeout</strong><small>Lock the workspace after inactivity.</small></div><label class="field-label compact-field"><input type="number" min="1" max="240" name="autoLockMinutes" value="${attr(s.autoLockMinutes || 30)}" data-settings><small class="field-hint">minutes</small></label></div><div class="security-control"><div><strong>Application lock</strong><small>${s.applicationLock ? 'A local PIN is required when this workspace is locked.' : 'Protect this workspace with a local administrator PIN.'}</small></div><div class="security-control-actions">${s.applicationLock ? '<span class="soft-label">Enabled</span>' : ''}${button(s.applicationLock ? 'Change PIN' : 'Set application PIN', 'open-security', 'lock', 'secondary')}${s.applicationLock ? button('Disable', 'disable-lock', 'close', 'link') : ''}</div></div></div></section></section></div></div>`;
}
function renderUsers() {
  if (!can('users.manage')) return permissionDeniedPage('User accounts');
  const users = state.users || [];
  const activeCount = users.filter((user) => user.active !== false).length;
  return `<div class="page-content"><div class="page-heading"><div><span class="eyebrow">ACCESS CONTROL</span><h1>User accounts</h1><p>Secure local accounts, staff associations and effective permissions.</p></div><div class="heading-actions">${button('Add user account', 'open-user-account', 'plus', 'primary')}</div></div><section class="stats-grid stats-grid-4"><div class="stat-card"><span class="stat-label">Total accounts</span><strong>${number(users.length)}</strong><small>Local identities</small></div><div class="stat-card"><span class="stat-label">Active accounts</span><strong>${number(activeCount)}</strong><small>Allowed to sign in</small></div><div class="stat-card"><span class="stat-label">Signed in before</span><strong>${number(users.filter((user) => user.lastLogin).length)}</strong><small>Known sessions</small></div><div class="stat-card"><span class="stat-label">Current role</span><strong>${esc(currentUser()?.role || '—')}</strong><small>${esc(currentUser()?.name || '')}</small></div></section><section class="card table-card"><div class="card-head"><div><span class="eyebrow">ACCOUNT DIRECTORY</span><h2>Who can access this workspace</h2></div><span class="count-pill">${number(users.length)} accounts</span></div><div class="table-scroll"><table><thead><tr><th>Name</th><th>Role</th><th>Staff association</th><th>Status</th><th>Last login</th><th></th></tr></thead><tbody>${users.length ? users.map((user) => `<tr><td><div class="person-cell"><span class="avatar avatar-small">${initials(user.name)}</span><div><strong>${esc(user.name)}</strong><small>${user.pinHash ? 'PIN protected' : 'PIN not configured'}</small></div></div></td><td>${esc(user.role || 'Custom Role')}</td><td>${esc(user.staffId ? staffName(user.staffId) : 'Not linked')}</td><td>${statusBadge(user.active === false ? 'Inactive' : 'Active')}</td><td>${user.lastLogin ? `${date(user.lastLogin.slice(0, 10))} ${esc(user.lastLogin.slice(11, 16) || '')}` : 'Never'}</td><td class="table-actions">${button('Edit', 'open-user-account', 'edit', 'link', `data-id="${user.id}"`)}${user.id !== currentUser()?.id ? button(user.active === false ? 'Activate' : 'Deactivate', 'toggle-user-active', user.active === false ? 'check' : 'lock', 'link', `data-id="${user.id}"`) : ''}</td></tr>`).join('') : `<tr><td colspan="6">${emptyState('users', 'No user accounts yet', 'Create an account for each person who uses this workspace.')}</td></tr>`}</tbody></table></div></section><section class="info-grid"><div class="info-card">${icon('shield', 18)}<div><strong>Underlying authorization</strong><p>Buttons are not the security boundary. Every protected operation checks the signed-in account before changing clinical, financial, staff or backup data.</p></div></div><div class="info-card">${icon('lock', 18)}<div><strong>Local credential protection</strong><p>PINs use salted PBKDF2 hashes. Failed attempts temporarily lock the account, and inactive accounts cannot sign in.</p></div></div></section></div>`;
}
function permissionDeniedPage(title) {
  return `<div class="page-content"><section class="empty-page"><div class="empty-icon">${icon('shield', 30)}</div><span class="eyebrow">ACCESS RESTRICTED</span><h1>${esc(title)} is protected</h1><p>Your account does not have permission to open this workspace area. Ask an Administrator to update your role.</p></section></div>`;
}
function renderHelp() {
  return `<div class="page">${pageHeader('Help centre', 'Clear answers for the work you do every day.', button('Open quick search', 'open-search', 'search', 'secondary'))}<section class="help-hero"><div><span class="eyebrow">DENTIVA PRO GUIDANCE</span><h2>Care for the record.<br>Keep the practice moving.</h2><p>Short, practical guidance for setting up your local workspace and building a dependable routine.</p></div><div class="help-hero-mark">${icon('tooth', 70)}</div></section><div class="help-grid"><article class="card help-card"><span class="help-card-icon">${icon('sparkle', 19)}</span><h3>Start with setup</h3><p>Add your clinic identity, prefixes and working preferences before creating documents.</p><button class="text-button" data-action="open-setup">Open setup${icon('arrow', 14)}</button></article><article class="card help-card"><span class="help-card-icon">${icon('backup', 19)}</span><h3>Protect your data</h3><p>Export verified backups regularly. Keep one copy away from the workstation.</p><button class="text-button" data-action="navigate" data-page="backup">Backup guide${icon('arrow', 14)}</button></article><article class="card help-card"><span class="help-card-icon">${icon('book', 19)}</span><h3>Use patient workspaces</h3><p>Start from a patient profile to keep encounters, dental records and balances connected.</p><button class="text-button" data-action="navigate" data-page="patients">Open patients${icon('arrow', 14)}</button></article><article class="card help-card"><span class="help-card-icon">${icon('shield', 19)}</span><h3>Clinical safety</h3><p>Dentiva Pro records professional input. Clinical judgement always remains with the dentist.</p><button class="text-button" data-action="navigate" data-page="settings">Privacy settings${icon('arrow', 14)}</button></article></div><section class="card faq-card"><div><span class="eyebrow">FREQUENTLY ASKED</span><h2>Keep the essentials close</h2></div><div class="faq-list"><details open><summary>Where is my data stored?</summary><p>In this browser or desktop profile on the local device. Dentiva Pro does not require a cloud account or send patient data to an external service.</p></details><details><summary>How do I print a document?</summary><p>Use the Print action on an invoice, payment, prescription, report or patient summary. The system opens a clean print preview where you can choose a Windows printer or Save as PDF.</p></details><details><summary>Can I use Bengali labels?</summary><p>Yes. Choose Bengali under Settings. Records remain structured and are not altered when the interface language changes.</p></details></div></section></div>`;
}
function renderAbout() {
  return `<div class="page about-page">${pageHeader('About Dentiva Pro', 'Professional dental practice management for Bangladesh.', button('Open settings', 'navigate', 'settings', 'secondary', 'data-page="settings"'))}<section class="about-hero"><div class="about-brand"><div class="about-symbol">${icon('tooth', 38)}</div><div><span class="eyebrow">DENTIVA PRO</span><h2>Calm software for serious care.</h2><p>Offline-first practice management designed for the daily rhythm of a modern dental clinic.</p></div></div><div class="version-block"><span>Version</span><strong>${APP_VERSION}</strong><small>Build 2026.09.22 · Windows x64 ready</small></div></section><div class="about-grid"><section class="card"><div class="card-heading-with-icon">${icon('layers', 18)}<h2>Built for the whole practice</h2></div><p>Patients, appointments, clinical records, dental charts, prescriptions, billing, inventory, finance, reports and verified backup workflows share one local source of truth.</p><div class="about-pills"><span>Offline-first</span><span>Light mode</span><span>Local privacy</span><span>English + Bengali</span></div></section><section class="card creator-card"><div class="creator-avatar">SK</div><div><span class="eyebrow">CREATOR</span><h2>Md. Shohan Khan</h2><p>${icon('mail', 14)} helloiamshohan@gmail.com</p><p>${icon('phone', 14)} WhatsApp · 01516591935</p></div></section></div><section class="card legal-card"><div><span class="eyebrow">LOCAL DATA PROMISE</span><h2>Your practice data stays yours.</h2><p>No paid APIs. No mandatory account. No hidden patient-data telemetry. Keep your backups under your own control.</p></div><div class="legal-mark">${icon('shield', 34)}</div></section></div>`;
}

function modal() {
  const { type, data = {} } = ui.modal;
  const modalMap = { setup: modalSetup, patient: modalPatient, appointment: modalAppointment, visit: modalVisit, prescription: modalPrescription, invoice: modalInvoice, payment: modalPayment, refund: modalRefund, stock: modalStock, stockAdjustment: modalStockAdjustment, supplier: modalSupplier, attachment: modalAttachment, attachmentPreview: modalAttachmentPreview, staff: modalStaff, expense: modalExpense, treatment: modalTreatment, referral: modalReferral, treatmentPlan: modalTreatmentPlan, security: modalSecurity, notifications: modalNotifications, auditLog: modalAuditLog, csvImport: modalCsvImport, search: modalSearch, user: modalUser, userAccount: modalUserAccount, dashboard: dashboardWidgetModal, saveFilter: modalSaveFilter, savedFilters: modalSavedFilters };
  const content = modalMap[type] ? modalMap[type](data) : '';
  return `<div class="modal-backdrop" data-action="close-modal"><section class="modal-window ${type === 'search' ? 'search-modal' : ''} ${type === 'setup' ? 'setup-modal' : ''}" role="dialog" aria-modal="true" aria-label="${esc(data.title || type)}" data-modal-window><div class="modal-content">${content}</div></section></div>`;
}
function modalHead(eyebrow, title, subtitle = '') { return `<div class="modal-head"><div><span class="eyebrow">${esc(eyebrow)}</span><h2>${esc(localized(title))}</h2>${subtitle ? `<p>${esc(localized(subtitle))}</p>` : ''}</div><button class="icon-button" data-action="close-modal" aria-label="Close dialog">${icon('close', 18)}</button></div>`; }
function modalFooter(cancel = 'Cancel', save = 'Save record', saveAction = 'submit-modal') { return `<div class="modal-footer"><button class="btn btn-link" data-action="close-modal">${esc(cancel)}</button><button class="btn btn-primary" type="submit" data-submit-action="${saveAction}">${icon('check', 16)}<span>${esc(save)}</span></button></div>`; }
function field(label, name, value = '', type = 'text', extra = '') { return `<label class="field-label">${esc(localized(label))}${type === 'textarea' ? `<textarea name="${attr(name)}" ${extra}>${attr(value)}</textarea>` : `<input type="${type}" name="${attr(name)}" value="${attr(value)}" ${extra}>`}</label>`; }
function selectField(label, name, options, value = '', extra = '') { return `<label class="field-label">${esc(localized(label))}<select name="${attr(name)}" ${extra}>${options.map(([val, label]) => `<option value="${attr(val)}" ${String(val) === String(value) ? 'selected' : ''}>${esc(localized(label))}</option>`).join('')}</select></label>`; }
function patientOptions(value = '') { return active(state.patients).sort((a, b) => a.fullName.localeCompare(b.fullName)).map((p) => [p.id, `${p.patientCode || ''} · ${p.fullName}`]); }
function dentistOptions(value = '') { return [['', state.settings.dentistName || 'Primary dentist'], ...active(state.staff).filter((s) => ['Dentist', 'Manager'].includes(s.role)).map((s) => [s.id, s.name])]; }

function modalSaveFilter() {
  return `<form data-form="saved-filter">${modalHead('SAVED SEARCH', 'Save this patient view', 'Keep the current search and patient filters available for the next visit.')}<div class="saved-filter-preview"><strong>${esc(ui.search || 'All patients')}</strong><small>${ui.patientStatusFilter || 'All statuses'}${ui.patientBalanceFilter && ui.patientBalanceFilter !== 'all' ? ` · ${ui.patientBalanceFilter}` : ''}${ui.patientToothStatus ? ` · ${ui.patientToothStatus}` : ''}</small></div>${field('View name', 'name', '', 'text', 'required maxlength="80" placeholder="e.g. Outstanding recalls"')}${modalFooter('Cancel', 'Save view')}</form>`;
}
function modalSavedFilters() {
  const filters = (state.savedFilters || []).filter((filter) => filter.entity === 'patients');
  return `${modalHead('SAVED SEARCHES', 'Patient views', filters.length ? 'Load a saved search or remove an old view.' : 'Save a patient search to reuse it here.')}<div class="saved-filter-list">${filters.length ? filters.map((filter) => `<div class="saved-filter-row"><div><strong>${esc(filter.name)}</strong><small>${esc(filter.query || 'All patients')} · ${esc(filter.status || 'All statuses')}</small></div><div class="row-actions">${button('Load', 'load-saved-filter', 'arrow', 'link', `data-id="${filter.id}"`)}<button class="icon-button tiny" data-action="delete-saved-filter" data-id="${filter.id}" aria-label="Delete saved search">${icon('trash', 15)}</button></div></div>`).join('') : emptyState('search', 'No saved searches', 'Use Save view after applying a patient search or filter.')}</div><div class="modal-footer"><button class="btn btn-primary" data-action="close-modal">Done</button></div>`;
}
function modalSetup(data = {}) {
  const s = state.settings; const step = data.step || 1;
  const steps = [['01', 'Practice'], ['02', 'Preferences'], ['03', 'Ready']];
  if (step === 3) return `${modalHead('SETUP COMPLETE', 'Your workspace is ready', 'Your practice identity is saved locally. You can refine every preference later in Settings.')}<div class="setup-complete"><div class="setup-complete-mark">${icon('check', 30)}</div><h3>Welcome to Dentiva Pro</h3><p>${esc(s.clinicName || 'Your practice')} is ready for its first record. Start with a patient, appointment or treatment.</p><div class="setup-next-steps"><div>${icon('users', 17)}<span>Register patients safely</span></div><div>${icon('calendar', 17)}<span>Build today’s schedule</span></div><div>${icon('backup', 17)}<span>Back up at any time</span></div></div></div><div class="modal-footer"><button class="btn btn-primary" data-action="finish-setup">Enter workspace ${icon('arrow', 16)}</button></div>`;
  return `<form data-form="setup">${modalHead('FIRST-RUN SETUP', 'Set up your practice', 'A few essentials now. Everything remains editable from Settings.')}<div class="setup-steps">${steps.map(([num, label], i) => `<div class="setup-step ${i + 1 === step ? 'active' : i + 1 < step ? 'done' : ''}"><span>${i + 1 < step ? icon('check', 13) : num}</span><small>${label}</small></div>`).join('')}</div>${step === 1 ? `<div class="form-grid two">${field('Clinic / practice name', 'clinicName', s.clinicName, 'text', 'required placeholder="e.g. Lakeview Dental Care"')}${field('Dentist name', 'dentistName', s.dentistName, 'text', 'required placeholder="e.g. Dr. Ayesha Rahman"')}${field('Professional title', 'professionalTitle', s.professionalTitle)}${field('Chamber / branch', 'chamberName', s.chamberName)}${field('Phone', 'phone', s.phone, 'tel', 'required placeholder="01XXXXXXXXX"')}${field('Secondary phone', 'secondaryPhone', s.secondaryPhone, 'tel')}${field('Email', 'email', s.email, 'email')}${field('Address', 'address', s.address, 'textarea', 'rows="2"')}${field('City', 'city', s.city)}${field('District', 'district', s.district)}<div class="form-full setup-default-note">${icon('map', 16)} Bangladesh defaults are already applied for country, currency and timezone.</div></div>` : `<div class="form-grid two">${selectField('Country', 'country', [['Bangladesh', 'Bangladesh']], s.country)}${selectField('Currency', 'currency', [['BDT', 'BDT / ৳'], ['USD', 'USD / $']], s.currency)}${selectField('Timezone', 'timezone', [['Asia/Dhaka', 'Asia/Dhaka (UTC+6)'], ['Asia/Kolkata', 'Asia/Kolkata (UTC+5:30)'], ['UTC', 'UTC']], s.timezone)}${selectField('Default language', 'language', [['English', 'English'], ['Bengali', 'বাংলা (Bengali)']], s.language)}${field('Invoice prefix', 'invoicePrefix', s.invoicePrefix, 'text', 'required')}${field('Patient code prefix', 'patientPrefix', s.patientPrefix, 'text', 'required')}${field('Appointment prefix', 'appointmentPrefix', s.appointmentPrefix, 'text', 'required')}${field('Queue serial prefix', 'serialPrefix', s.serialPrefix, 'text', 'required')}${field('Administrator PIN', 'adminPin', '', 'password', 'required minlength="4" maxlength="12" inputmode="numeric" pattern="[0-9]{4,12}" autocomplete="new-password" placeholder="4–12 digits"')}${field('Confirm administrator PIN', 'adminPinConfirm', '', 'password', 'required minlength="4" maxlength="12" inputmode="numeric" pattern="[0-9]{4,12}" autocomplete="new-password" placeholder="Repeat the PIN"')}<div class="form-full setup-default-note">${icon('shield', 16)} Dentiva Pro is offline-first. No cloud account or paid service is required. The Administrator PIN is salted and hashed locally.</div></div>`}${modalFooter(step === 1 ? 'Skip for now' : 'Back', step === 1 ? 'Continue' : 'Save & continue', 'setup-next')}</form>`;
}
function modalPatient(data = {}) {
  const p = data.patient || {}; const editing = Boolean(p.id);
  const customFields = (state.settings.customPatientFields || []).map((definition) => field(definition.label, `custom_${definition.key}`, p.customFields?.[definition.key] || '', definition.type === 'date' ? 'date' : 'text', `placeholder="${attr(definition.placeholder || '')}"`)).join('');
  return `<form data-form="patient"><input type="hidden" name="id" value="${attr(p.id || '')}">${modalHead(editing ? 'PATIENT RECORD' : 'NEW PATIENT', editing ? 'Edit patient details' : 'Register a patient', 'Keep identity, contact, alerts and clinical context together.')}<div class="form-grid two">${field('Full name', 'fullName', p.fullName, 'text', 'required placeholder="Patient full name"')}${field('Preferred name', 'preferredName', p.preferredName)}${field('Phone', 'phone', p.phone, 'tel', 'required placeholder="01XXXXXXXXX"')}${field('Alternative phone', 'alternativePhone', p.alternativePhone, 'tel')}${field('Email', 'email', p.email, 'email')}${selectField('Preferred contact method', 'preferredContact', [['Phone', 'Phone'], ['WhatsApp', 'WhatsApp'], ['SMS', 'SMS'], ['Email', 'Email'], ['No preference', 'No preference']], p.preferredContact || 'Phone')}${field('Date of birth', 'dateOfBirth', p.dateOfBirth, 'date')}${selectField('Gender', 'gender', [['', 'Not recorded'], ['Female', 'Female'], ['Male', 'Male'], ['Other', 'Other'], ['Prefer not to say', 'Prefer not to say']], p.gender)}${selectField('Blood group', 'bloodGroup', [['', 'Not recorded'], ['A+', 'A+'], ['A-', 'A−'], ['B+', 'B+'], ['B-', 'B−'], ['AB+', 'AB+'], ['AB-', 'AB−'], ['O+', 'O+'], ['O-', 'O−']], p.bloodGroup)}${field('Address', 'address', p.address, 'textarea', 'rows="2"')}${field('Emergency contact', 'emergencyContact', p.emergencyContact)}${field('Emergency phone', 'emergencyPhone', p.emergencyPhone, 'tel')}${field('Occupation', 'occupation', p.occupation)}${field('Allergies', 'allergies', p.allergies, 'textarea', 'rows="2" placeholder="Record known allergies or write None recorded"')}${field('Chronic conditions', 'chronicConditions', p.chronicConditions, 'textarea', 'rows="2"')}${field('Current medications', 'currentMedications', p.currentMedications, 'textarea', 'rows="2"')}${field('Previous dental history', 'previousDentalHistory', p.previousDentalHistory, 'textarea', 'rows="2"')}${field('Referral source', 'referralSource', p.referralSource)}${field('Tags', 'tagsText', normaliseTags(p.tags).join(', '), 'text', 'placeholder="e.g. Recall, High priority, Insurance"')}${field('Important alerts', 'importantAlerts', p.importantAlerts, 'textarea', 'rows="2" placeholder="Clinical or communication alerts"')}${field('Notes', 'notes', p.notes, 'textarea', 'rows="2"')}${selectField('Patient status', 'status', [['Active', 'Active'], ['Inactive', 'Inactive'], ['Archived', 'Archived']], p.status || 'Active')}${customFields ? `<div class="form-full custom-fields-block"><div class="eyebrow">CUSTOM PATIENT FIELDS</div>${customFields}</div>` : ''}</div><p class="form-note">${icon('shield', 14)} Patient code is generated automatically and stays unique. Custom fields are stored locally with this record.</p>${modalFooter('Cancel', editing ? 'Save changes' : 'Create patient')}</form>`;
}

function modalAttachmentPreview(data = {}) {
  const a = data.attachment || byId(state.attachments, data.id);
  if (!a) return `${modalHead('ATTACHMENT', 'Preview unavailable', 'This file no longer exists in the local record.')}<div class="modal-footer"><button class="btn btn-primary" data-action="close-modal">Close</button></div>`;
  const isImage = a.type?.startsWith('image/');
  const preview = isImage ? `<img class="attachment-preview-image" src="${attr(a.data)}" alt="${attr(a.name)}">` : `<div class="attachment-no-preview">${icon('file', 30)}<strong>Safe inline preview is not available for ${esc(a.type || 'this file type')}.</strong><p>Download the original file to open it with a trusted local application. PDF active content is never embedded in the workspace.</p></div>`;
  return `<div class="attachment-preview-modal">${modalHead('ATTACHMENT PREVIEW', a.name, `${a.category || 'Clinical document'} · ${formatBytes(a.size)}`)}<div class="attachment-preview-stage">${preview}</div><div class="modal-footer">${button('Download original', 'download-attachment', 'download', 'secondary', `data-id="${a.id}"`)}<button class="btn btn-primary" data-action="close-modal">Done</button></div></div>`;
}
function modalAttachment(data = {}) {
  const a = data.attachment || data;
  const editing = Boolean(a.id);
  const visits = active(state.visits).filter((visit) => visit.patientId === (a.patientId || ui.patientId)).sort((x, y) => (y.date || '').localeCompare(x.date || ''));
  return `<form data-form="attachment"><input type="hidden" name="id" value="${attr(a.id || '')}"><input type="hidden" name="patientId" value="${attr(a.patientId || ui.patientId || '')}"><input type="hidden" name="type" value="${attr(a.type || '')}"><input type="hidden" name="size" value="${attr(a.size || 0)}">${modalHead('PATIENT ATTACHMENT', editing ? 'Edit attachment details' : 'Save attachment', 'Keep clinical files labelled, searchable and connected to the right encounter.')}<div class="attachment-upload-preview"><span class="attachment-icon">${icon(a.type?.startsWith('image/') ? 'eye' : 'file', 22)}</span><div><strong>${esc(a.name || 'Attachment')}</strong><small>${esc(a.type || 'Unknown file')} · ${formatBytes(a.size || 0)}</small></div></div><div class="form-grid two">${field('Display name', 'name', a.name || '', 'text', 'required maxlength="180"')}${selectField('Category', 'category', [['Image / X-ray', 'Image / X-ray'], ['PDF report', 'PDF report'], ['Prescription', 'Prescription'], ['Clinical document', 'Clinical document'], ['Other', 'Other']], a.category || (a.type === 'application/pdf' ? 'PDF report' : a.type?.startsWith('image/') ? 'Image / X-ray' : 'Clinical document'))}${selectField('Linked visit', 'visitId', [['', 'Not linked to a specific visit'], ...visits.map((visit) => [visit.id, `${date(visit.date)} · ${visit.reason || 'Clinical visit'}`])], a.visitId || '')}${field('Notes', 'notes', a.notes || '', 'textarea', 'rows="3" placeholder="Optional context for this file"')}</div>${modalFooter('Cancel', editing ? 'Save attachment' : 'Add attachment')}</form>`;
}
function modalAppointment(data = {}) {
  const a = data.appointment || {}; const patients = patientOptions(a.patientId); const editing = Boolean(a.id); const dateValue = a.date || today();
  return `<form data-form="appointment"><input type="hidden" name="id" value="${attr(a.id || '')}">${modalHead(editing ? 'APPOINTMENT' : 'NEW APPOINTMENT', editing ? 'Edit appointment' : 'Book an appointment', 'Protect time, chair and patient context.')}<div class="form-grid two">${selectField('Patient', 'patientId', [['', patients.length ? 'Choose patient...' : 'Add a patient first'], ...patients], a.patientId, 'required')}${field('Date', 'date', dateValue, 'date', 'required')}${field('Time', 'time', a.time || '09:00', 'time', 'required')}${field('Duration (minutes)', 'duration', a.duration || state.settings.defaultDuration, 'number', 'min="5" step="5" required')}${selectField('Dentist', 'dentistId', dentistOptions(), a.dentistId)}${field('Chair', 'chair', a.chair || 'Chair 1')}${selectField('Room', 'room', [['', 'No room assigned'], ...(state.settings.rooms || ['Room 1']).map((room) => [room, room])], a.room || '')}${field('Reason for visit', 'reason', a.reason, 'text', 'required placeholder="Consultation, cleaning, follow-up..."')}${selectField('Status', 'status', [['Scheduled', 'Scheduled'], ['Checked In', 'Checked In'], ['Waiting', 'Waiting'], ['In Treatment', 'In Treatment'], ['Completed', 'Completed'], ['Cancelled', 'Cancelled'], ['No Show', 'No Show']], a.status || 'Scheduled')}${field('Notes', 'notes', a.notes, 'textarea', 'rows="3"')}${field('Reminder note', 'reminder', a.reminder, 'text')}</div>${patients.length ? '' : `<div class="inline-warning">${icon('warning', 15)} Add a patient before booking an appointment. <button type="button" class="text-button" data-action="open-patient">Open patient form${icon('arrow', 13)}</button></div>`}${modalFooter('Cancel', editing ? 'Save appointment' : 'Book appointment')}</form>`;
}
function modalVisit(data = {}) {
  const v = data.visit || {}; const patients = patientOptions(v.patientId); const editing = Boolean(v.id); const patientId = v.patientId || data.patientId || '';
  return `<form data-form="visit"><input type="hidden" name="id" value="${attr(v.id || '')}">${modalHead(editing ? 'CLINICAL ENCOUNTER' : 'NEW VISIT', editing ? 'Edit clinical visit' : 'Record a visit', 'Record professional input without automating clinical judgement.')}<div class="form-grid two">${selectField('Patient', 'patientId', [['', 'Choose patient...'], ...patients], patientId, 'required')}${field('Date', 'date', v.date || today(), 'date', 'required')}${field('Time', 'time', v.time || '', 'time')}${field('Chief complaint / reason', 'reason', v.reason || v.chiefComplaint, 'text', 'required')}${field('Symptoms', 'symptoms', v.symptoms, 'textarea', 'rows="3"')}${field('Clinical findings', 'clinicalFindings', v.clinicalFindings, 'textarea', 'rows="3"')}${field('Diagnosis', 'diagnosis', v.diagnosis, 'textarea', 'rows="2"')}${field('Treatment plan', 'treatmentPlan', v.treatmentPlan, 'textarea', 'rows="2"')}${field('Treatment performed', 'treatmentPerformed', v.treatmentPerformed, 'textarea', 'rows="2"')}${field('Tooth number(s)', 'teeth', v.teeth, 'text', 'placeholder="e.g. 16, 26"')}${field('Anesthesia information', 'anesthesia', v.anesthesia, 'text')}${field('Follow-up date', 'followUpDate', v.followUpDate, 'date')}${field('Doctor / additional notes', 'notes', v.notes, 'textarea', 'rows="3"')}</div><div class="form-note">${icon('tooth', 14)} Multiple teeth and treatments can be recorded as comma-separated clinical notes. Use the Dental Chart for tooth-level status history.</div>${modalFooter('Cancel', editing ? 'Save visit' : 'Record visit')}</form>`;
}
function modalPrescription(data = {}) {
  const p = data.prescription || {}; const editing = Boolean(p.id); const first = p.medications?.[0] || p;
  const medicationLines = (p.medications || []).length ? p.medications.map((medication) => [medication.medicine, medication.strength || '', medication.dosage || '', medication.frequency || '', medication.duration || '', medication.route || 'Oral', medication.instructions || ''].join(' | ')).join('\n') : '';
  return `<form data-form="prescription"><input type="hidden" name="id" value="${attr(p.id || '')}">${modalHead(editing ? 'PRESCRIPTION' : 'NEW PRESCRIPTION', editing ? 'Edit prescription' : 'Create a prescription', 'Clear instructions, multiple medicines and a print-ready record.')}<div class="form-grid two"><label class="field-label">Saved medication<select data-change="prescription-template"><option value="">Choose a saved medicine...</option>${(state.medicationCatalog || []).filter((item) => item.active !== false).map((item) => `<option value="${attr(item.id)}">${esc(item.name)}${item.strength ? ` · ${esc(item.strength)}` : ''}</option>`).join('')}</select></label>${selectField('Patient', 'patientId', [['', 'Choose patient...'], ...patientOptions(p.patientId)], p.patientId, 'required')}${field('Date', 'date', p.date || today(), 'date', 'required')}${field('Doctor', 'doctor', p.doctor || state.settings.dentistName, 'text', 'required')}${field('Medicine', 'medicine', first.medicine, 'text', 'required placeholder="Medicine name"')}${field('Strength', 'strength', first.strength, 'text', 'placeholder="e.g. 500 mg"')}${field('Dosage', 'dosage', first.dosage, 'text', 'placeholder="e.g. 1 tablet"')}${field('Frequency', 'frequency', first.frequency, 'text', 'placeholder="e.g. Twice daily"')}${field('Duration', 'duration', first.duration, 'text', 'placeholder="e.g. 5 days"')}${field('Route', 'route', first.route || 'Oral')}${field('Instructions', 'instructions', first.instructions, 'textarea', 'rows="3" placeholder="How and when to take this medicine"')}</div><div class="medication-tools form-full"><button type="button" class="text-button" data-action="save-medication-template">${icon('plus', 14)} Save current medicine to catalog</button><small class="field-hint">Saved locally for repeat prescriptions; it never makes a clinical recommendation.</small></div><label class="field-label form-full">Additional medicines <textarea name="medicationsText" rows="4" placeholder="One medicine per line: medicine | strength | dosage | frequency | duration | route | instructions">${attr(medicationLines)}</textarea><small class="field-hint">The first medicine above is included automatically. Add more lines for a complete prescription.</small></label>${field('Prescription notes', 'notes', p.notes, 'textarea', 'rows="3"')}<div class="form-note">${icon('shield', 14)} The medicine and instructions reflect the prescriber’s input. Dentiva Pro does not generate medical recommendations.</div>${modalFooter('Cancel', editing ? 'Save prescription' : 'Create prescription')}</form>`;
}

function modalInvoice(data = {}) {
  const i = data.invoice || {}; const editing = Boolean(i.id); const item = i.items?.[0] || {};
  return `<form data-form="invoice"><input type="hidden" name="id" value="${attr(i.id || '')}">${modalHead(editing ? 'INVOICE' : 'NEW INVOICE', editing ? 'Edit invoice' : 'Create an invoice', 'Line items, discounts and taxes remain transparent.')}<div class="form-grid two">${selectField('Patient', 'patientId', [['', 'Choose patient...'], ...patientOptions(i.patientId)], i.patientId, 'required')}${field('Invoice date', 'date', i.date || today(), 'date', 'required')}${field('Item / treatment', 'itemName', item.name || '', 'text', 'required placeholder="Treatment or service"')}${field('Quantity', 'quantity', item.quantity || 1, 'number', 'min="1" step="1" required')}${field('Unit price', 'unitPrice', item.unitPrice || '', 'number', 'min="0" step="0.01" required')}${field('Discount', 'discount', i.discount || 0, 'number', 'min="0" step="0.01"')}${field('Tax rate (%)', 'taxRate', i.taxRate ?? (state.settings.taxEnabled ? state.settings.taxRate : 0), 'number', 'min="0" step="0.01"')}<div class="field-label"><span>Payment status</span><div class="calculated-status">${statusBadge(i.id ? invoicePaymentStatus(i).status : 'Unpaid')}<small>Calculated from recorded payments and refunds.</small></div></div>${field('Notes', 'notes', i.notes, 'textarea', 'rows="2"')}</div><div class="invoice-preview-line"><span>Calculated total</span><strong id="invoice-modal-total">${currency(i.total || 0)}</strong><small>subtotal − discount + configured tax</small></div>${modalFooter('Cancel', editing ? 'Save invoice' : 'Create invoice')}</form>`;
}
function modalPayment(data = {}) {
  const p = data.payment || {}; const invoice = data.invoiceId ? byId(state.invoices, data.invoiceId) : byId(state.invoices, p.invoiceId); const patientId = data.patientId || p.patientId || invoice?.patientId || ''; const choices = active(state.invoices).filter((i) => invoicePaymentStatus(i).due > 0);
  return `<form data-form="payment"><input type="hidden" name="id" value="${attr(p.id || '')}">${modalHead('PAYMENT', 'Record a payment', 'Every collection receives its own receipt and audit entry.')}<div class="form-grid two">${selectField('Invoice', 'invoiceId', [['', choices.length ? 'On account / choose invoice' : 'No open invoices'], ...choices.map((i) => [i.id, `${i.invoiceNumber} · ${patientName(i.patientId)} · due ${currency(invoicePaymentStatus(i).due)}`])], invoice?.id || p.invoiceId, '')}${selectField('Patient', 'patientId', [['', 'Choose patient...'], ...patientOptions(patientId)], patientId, 'required')}${field('Amount', 'amount', p.amount || (invoice ? invoicePaymentStatus(invoice).due : '') || '', 'number', 'min="0.01" step="0.01" required')}${field('Payment date', 'date', p.date || today(), 'date', 'required')}${selectField('Method', 'method', paymentMethods().map((method) => [method, method]), p.method || 'Cash')}${field('Reference / transaction ID', 'reference', p.reference || p.transactionId)}${field('Bank / MFS provider', 'provider', p.provider)}${field('Notes', 'notes', p.notes, 'textarea', 'rows="2"')}</div><div class="form-note">${icon('shield', 14)} A payment cannot exceed the selected invoice balance. Use a separate adjustment for refunds or reversals.</div>${modalFooter('Cancel', 'Record payment')}</form>`;
}
function modalRefund(data = {}) {
  const payment = data.payment || byId(state.payments, data.paymentId);
  const remaining = payment ? paymentAmount(payment) : 0;
  return `<form data-form="refund"><input type="hidden" name="paymentId" value="${attr(payment?.id || '')}">${modalHead('PAYMENT ADJUSTMENT', 'Refund or reverse payment', 'Financial adjustments are append-only and remain visible in the audit trail.')}<div class="adjustment-summary"><strong>${currency(remaining)}</strong><span>remaining refundable amount · ${esc(payment?.receiptNumber || 'Unknown receipt')}</span></div><div class="form-grid two">${field('Refund amount', 'amount', remaining, 'number', 'min="0.01" max="'+remaining+'" step="0.01" required')}${field('Refund date', 'date', today(), 'date', 'required')}${field('Reason', 'reason', '', 'textarea', 'rows="3" required placeholder="Document the reason for this adjustment"')}</div>${modalFooter('Cancel', 'Record refund')}</form>`;
}
function modalStockAdjustment(data = {}) {
  const selected = data.item || byId(state.inventory, data.itemId);
  return `<form data-form="stock-adjustment"><input type="hidden" name="id" value="${attr(selected?.id || '')}">${modalHead('INVENTORY MOVEMENT', 'Record stock movement', 'Purchases, usage, expiry and corrections remain visible in the movement ledger.')}<div class="form-grid two">${selectField('Item', 'itemId', [['', state.inventory.length ? 'Choose stock item...' : 'Add a stock item first'], ...active(state.inventory).map((item) => [item.id, `${item.name} · ${item.currentStock} ${item.unit || ''}`])], selected?.id || '', 'required')}${selectField('Movement type', 'movementType', [['Purchase', 'Purchase / received'], ['Usage', 'Usage / issued'], ['Stock-out', 'Stock-out'], ['Expired', 'Expired / quarantined'], ['Damaged', 'Damaged / lost'], ['Adjustment', 'Inventory correction']], data.movementType || 'Usage')}${field('Quantity', 'quantity', data.quantity || '', 'number', 'min="0.01" step="0.01" required')}${selectField('Correction direction', 'direction', [['increase', 'Increase'], ['decrease', 'Decrease']], data.direction || 'decrease')}${field('Date', 'date', today(), 'date', 'required')}${field('Batch / lot', 'batch', selected?.batch || '')}${field('Reason / note', 'reason', '', 'textarea', 'rows="3" required placeholder="Why did this movement occur?"')}</div>${modalFooter('Cancel', 'Record movement')}</form>`;
}
function modalStock(data = {}) {
  const i = data.item || {}; const editing = Boolean(i.id);
  return `<form data-form="stock"><input type="hidden" name="id" value="${attr(i.id || '')}">${modalHead(editing ? 'INVENTORY ITEM' : 'NEW STOCK ITEM', editing ? 'Edit stock details' : 'Add stock item', 'Stock changes are recorded as traceable movements.')}<div class="form-grid two">${field('Item name', 'name', i.name, 'text', 'required placeholder="e.g. Composite resin"')}${field('Item code', 'itemCode', i.itemCode, 'text', 'placeholder="Optional internal code"')}${selectField('Category', 'category', inventoryCategories().map((category) => [category, category]), i.category || 'Consumable')}${field('Brand', 'brand', i.brand)}${field('Unit', 'unit', i.unit || 'box', 'text', 'required')}${selectField('Supplier', 'supplierId', [['', 'No supplier linked'], ...active(state.suppliers).map((s) => [s.id, s.name])], i.supplierId)}${field('Purchase date', 'purchaseDate', i.purchaseDate || today(), 'date')}${field('Purchase price', 'purchasePrice', i.purchasePrice || '', 'number', 'min="0" step="0.01"')}${field('Quantity to add', 'quantity', editing ? 0 : '', 'number', 'min="0" step="0.01"')}${field('Current stock', 'currentStock', i.currentStock || 0, 'number', editing ? 'readonly' : 'min="0" step="0.01"')}${field('Minimum / reorder level', 'minimumStock', i.minimumStock ?? state.settings.lowStockThreshold, 'number', 'min="0" step="0.01"')}${field('Expiry date', 'expiryDate', i.expiryDate, 'date')}${field('Batch / lot', 'batch', i.batch)}${field('Location', 'location', i.location)}${field('Notes', 'notes', i.notes, 'textarea', 'rows="2"')}</div><div class="form-note">${icon('activity', 14)} Existing stock is never silently overwritten. Adding a quantity creates a Purchase movement.</div>${modalFooter('Cancel', editing ? 'Save item' : 'Add stock')}</form>`;
}
function modalSupplier(data = {}) { const s = data.supplier || {}; const editing = Boolean(s.id); return `<form data-form="supplier"><input type="hidden" name="id" value="${attr(s.id || '')}">${modalHead(editing ? 'SUPPLIER' : 'NEW SUPPLIER', editing ? 'Edit supplier' : 'Add a supplier', 'Keep purchasing contacts connected to inventory.')}<div class="form-grid two">${field('Supplier name', 'name', s.name, 'text', 'required')}${field('Contact person', 'contactPerson', s.contactPerson)}${field('Phone', 'phone', s.phone, 'tel')}${field('Email', 'email', s.email, 'email')}${field('Address', 'address', s.address, 'textarea', 'rows="2"')}${field('Tax / registration info', 'taxInfo', s.taxInfo)}${field('Notes', 'notes', s.notes, 'textarea', 'rows="3"')}</div>${modalFooter('Cancel', editing ? 'Save supplier' : 'Add supplier')}</form>`; }
function modalStaff(data = {}) { const s = data.staff || {}; const editing = Boolean(s.id); return `<form data-form="staff"><input type="hidden" name="id" value="${attr(s.id || '')}">${modalHead(editing ? 'STAFF MEMBER' : 'NEW STAFF MEMBER', editing ? 'Edit staff member' : 'Add staff member', 'Roles keep access architecture clear as the practice grows.')}<div class="form-grid two">${field('Full name', 'name', s.name, 'text', 'required')}${selectField('Role', 'role', [['Dentist', 'Dentist'], ['Dental Assistant', 'Dental Assistant'], ['Receptionist', 'Receptionist'], ['Manager', 'Manager'], ['Cleaner', 'Cleaner'], ['Other', 'Other']], s.role || 'Receptionist')}${field('Phone', 'phone', s.phone, 'tel')}${field('Email', 'email', s.email, 'email')}${field('Address', 'address', s.address, 'textarea', 'rows="2"')}${field('Joining date', 'joiningDate', s.joiningDate || today(), 'date')}${field('Salary', 'salary', s.salary, 'number', 'min="0" step="0.01"')}${selectField('Salary type', 'salaryType', [['Monthly', 'Monthly'], ['Hourly', 'Hourly'], ['Other', 'Other']], s.salaryType || 'Monthly')}${field('Working hours', 'workingHours', s.workingHours, 'text', 'placeholder="e.g. Sat–Thu, 10:00–18:00"')}${selectField('Status', 'status', [['Active', 'Active'], ['Inactive', 'Inactive']], s.status || 'Active')}${field('Notes', 'notes', s.notes, 'textarea', 'rows="2"')}</div>${modalFooter('Cancel', editing ? 'Save staff member' : 'Add staff member')}</form>`; }
function modalExpense(data = {}) { const e = data.expense || {}; return `<form data-form="expense">${modalHead('EXPENSE', 'Record an expense', 'Keep operating costs separate from patient billing.')}<div class="form-grid two">${field('Description', 'description', e.description, 'text', 'required placeholder="e.g. Monthly clinic rent"')}${field('Amount', 'amount', e.amount, 'number', 'min="0.01" step="0.01" required')}${field('Date', 'date', e.date || today(), 'date', 'required')}${selectField('Category', 'category', expenseCategories().map((category) => [category, category]), e.category || 'Other')}${selectField('Method', 'method', [['Cash', 'Cash'], ['Bank', 'Bank'], ['Card', 'Card'], ['Other', 'Other']], e.method || 'Cash')}${field('Reference', 'reference', e.reference)}${field('Notes', 'notes', e.notes, 'textarea', 'rows="3"')}</div>${modalFooter('Cancel', 'Record expense')}</form>`; }
function modalTreatmentPlan(data = {}) {
  const plan = data.plan || {};
  const stagesText = (plan.stages || []).map((stage) => [stage.title, stage.plannedDate || '', stage.estimatedCost || '', stage.status || 'Planned', stage.notes || ''].join(' | ')).join('\n');
  const estimatedTotal = numeric(plan.estimatedCost || 0) - numeric(plan.discount || 0);
  return `<form data-form="treatment-plan"><input type="hidden" name="id" value="${attr(plan.id || '')}">${modalHead(plan.id ? 'TREATMENT PLAN' : 'NEW TREATMENT PLAN', plan.id ? 'Edit treatment plan' : 'Create a treatment plan', 'Plan clinical stages, transparent estimates and responsible care without automating clinical decisions.')}<div class="form-grid two">${selectField('Patient', 'patientId', [['', 'Choose patient...'], ...patientOptions(plan.patientId)], plan.patientId || ui.patientId || '', 'required')}${field('Plan title', 'title', plan.title || '', 'text', 'required placeholder="e.g. Full-mouth rehabilitation"')}${selectField('Responsible dentist', 'dentistId', dentistOptions(), plan.dentistId || '')}${selectField('Plan status', 'status', [['Draft', 'Draft'], ['Proposed', 'Proposed'], ['Accepted', 'Accepted'], ['In Progress', 'In Progress'], ['Partially Completed', 'Partially Completed'], ['Completed', 'Completed'], ['Cancelled', 'Cancelled']], plan.status || 'Draft')}${field('Diagnosis / clinical goal', 'goal', plan.goal || '', 'textarea', 'rows="3" placeholder="Professional diagnosis or clinical goal"')}${field('Procedures', 'procedures', plan.procedures || '', 'textarea', 'rows="3" placeholder="List planned procedures"')}${field('Tooth number(s)', 'teeth', plan.teeth || '', 'text', 'placeholder="e.g. 16, 26"')}${field('Estimated duration (minutes)', 'estimatedDuration', plan.estimatedDuration || '', 'number', 'min="0" step="5"')}${field('Estimated cost', 'estimatedCost', plan.estimatedCost || '', 'number', 'min="0" step="0.01"')}${field('Discount', 'discount', plan.discount || 0, 'number', 'min="0" step="0.01"')}${field('Start date', 'startDate', plan.startDate || today(), 'date')}${field('Review date', 'reviewDate', plan.reviewDate || '', 'date')}${field('Notes', 'notes', plan.notes || '', 'textarea', 'rows="3"')}</div><div class="invoice-preview-line"><span>Estimated total</span><strong>${currency(Math.max(0, estimatedTotal))}</strong><small>Estimate only — no financial transaction is created until explicitly confirmed.</small></div><label class="field-label form-full">Stages <textarea name="stagesText" rows="6" placeholder="One stage per line: Stage name | planned date | estimated cost | status | notes">${attr(stagesText)}</textarea><small class="field-hint">Use one stage per line. Statuses: Planned, In progress, Completed or Deferred.</small></label>${modalFooter('Cancel', plan.id ? 'Save plan' : 'Create plan')}</form>`;
}

function modalTreatment(data = {}) { const t = data.treatment || {}; const editing = Boolean(t.id); return `<form data-form="treatment"><input type="hidden" name="id" value="${attr(t.id || '')}">${modalHead(editing ? 'TREATMENT CATALOG' : 'NEW TREATMENT', editing ? 'Edit treatment' : 'Add a treatment', 'Catalog defaults help the team stay consistent; each invoice remains reviewable.')}<div class="form-grid two">${field('Treatment name', 'name', t.name, 'text', 'required placeholder="e.g. Composite restoration"')}${field('Code', 'code', t.code, 'text', 'placeholder="e.g. REST-C"')}${field('Category', 'category', t.category || 'General')}${field('Default price', 'defaultPrice', t.defaultPrice || '', 'number', 'min="0" step="0.01"')}${field('Duration (minutes)', 'duration', t.duration || 30, 'number', 'min="5" step="5"')}${selectField('Tooth required', 'toothRequired', [['false', 'No'], ['true', 'Yes']], String(t.toothRequired || false))}${field('Description', 'description', t.description, 'textarea', 'rows="3"')}${selectField('Status', 'active', [['true', 'Active'], ['false', 'Inactive']], String(t.active !== false))}</div>${modalFooter('Cancel', editing ? 'Save treatment' : 'Add treatment')}</form>`; }
function modalReferral(data = {}) { const r = data.referral || {}; const editing = Boolean(r.id); return `<form data-form="referral"><input type="hidden" name="id" value="${attr(r.id || '')}">${modalHead(editing ? 'REFERRAL' : 'NEW REFERRAL', editing ? 'Edit referral' : 'Record a referral', 'Keep the reason, destination and response connected to the patient record.')}<div class="form-grid two">${selectField('Patient', 'patientId', [['', 'Choose patient...'], ...patientOptions(r.patientId || ui.patientId)], r.patientId || ui.patientId, 'required')}${field('Referral date', 'date', r.date || today(), 'date', 'required')}${field('Referred to', 'referralTo', r.referralTo, 'text', 'required placeholder="Doctor, specialist or organisation"')}${field('Specialty', 'specialty', r.specialty)}${field('Reason', 'reason', r.reason, 'textarea', 'rows="3" required')}${field('Clinical notes', 'clinicalNotes', r.clinicalNotes, 'textarea', 'rows="3"')}${field('Response / report', 'response', r.response, 'textarea', 'rows="3"')}${field('Follow-up notes', 'followUpNotes', r.followUpNotes, 'textarea', 'rows="2"')}</div>${modalFooter('Cancel', editing ? 'Save referral' : 'Save referral')}</form>`; }
function modalAuditLog() {
  const query = String(ui.auditQuery || '').toLowerCase();
  const entries = state.audit.filter((entry) => !query || [entry.action, entry.entity, entry.summary, entry.user].some((value) => String(value || '').toLowerCase().includes(query))).slice(0, 100);
  return `<div class="audit-modal">${modalHead('AUDIT TRAIL', 'Activity history', 'Append-only local events make important changes reviewable.')}<label class="search-field modal-search-field">${icon('search', 17)}<input type="search" value="${attr(ui.auditQuery || '')}" placeholder="Filter actions, entities or notes" data-input="audit-search"></label><div class="audit-list">${entries.length ? entries.map((entry) => `<div class="audit-row"><span class="audit-row-icon">${icon(entry.entity === 'Security' ? 'shield' : entry.entity === 'Payment' ? 'credit' : entry.entity === 'Backup' ? 'backup' : 'activity', 15)}</span><div><strong>${esc(entry.action)}</strong><small>${esc(entry.entity || 'System')} ${entry.recordId ? `· ${esc(entry.recordId)}` : ''} · ${date(entry.at?.slice(0, 10))} ${entry.at?.slice(11, 16) || ''}</small><p>${esc(entry.summary || '')}</p></div></div>`).join('') : emptyState('activity', 'No audit events match', 'Changes will appear here after the practice starts working.')}</div><div class="modal-footer"><button class="btn btn-primary" data-action="close-modal">Done</button></div></div>`;
}
function modalNotifications() { const notes = notificationItems().slice(0, 12); return `${modalHead('NOTIFICATIONS', 'Notification centre', notes.length ? 'Meaningful signals from your workspace.' : 'Your workspace is quiet.')}<div class="notification-list">${notes.length ? notes.map((n) => `<button class="notification-row ${n.read ? '' : 'unread'}" data-action="notification-open" data-id="${attr(n.id)}"><span class="notification-icon">${icon(n.type === 'warning' ? 'warning' : n.type === 'backup' ? 'backup' : 'bell', 16)}</span><span><strong>${esc(n.title)}</strong><p>${esc(n.message)}</p><small>${date(n.date || today())} · Open ${esc(n.page || 'workspace')}</small></span>${icon('arrow', 14)}</button>`).join('') : emptyState('bell', 'No notifications', 'Appointment, follow-up, stock and backup signals will appear here.')}</div><div class="modal-footer"><button class="btn btn-link" data-action="mark-notifications-read">Mark all as read</button><button class="btn btn-primary" data-action="close-modal">Done</button></div>`; }
function modalSecurity() { const hasPin = Boolean(state.settings.pinHash); return `<form data-form="security">${modalHead('PRIVACY & SECURITY', hasPin ? 'Change application PIN' : 'Set application PIN', hasPin ? 'Choose a new local PIN for this workspace.' : 'The PIN is hashed locally and never stored as readable text.')}<div class="security-modal-icon">${icon('lock', 26)}</div><div class="form-grid">${field('New PIN', 'pin', '', 'password', 'required minlength=4 maxlength=12 inputmode="numeric" pattern="[0-9]{4,12}" autocomplete="new-password" placeholder="4–12 digits"')}${field('Confirm PIN', 'confirmPin', '', 'password', 'required minlength=4 maxlength=12 inputmode="numeric" pattern="[0-9]{4,12}" autocomplete="new-password" placeholder="Enter the PIN again"')}</div><p class="form-note">${icon('shield', 14)} This PIN only protects access to this local workspace. Keep a verified backup separately; it cannot recover a forgotten PIN.</p>${modalFooter('Cancel', hasPin ? 'Update PIN' : 'Enable application lock')}</form>`; }
function modalCsvImport() {
  const importState = ui.csvImport;
  if (!importState) return `${modalHead('CSV IMPORT', 'Import patients', 'Choose a file to preview before anything is written.')}<div class="modal-footer"><button class="btn btn-primary" data-action="close-modal">Close</button></div>`;
  const fields = [['fullName', 'Full name'], ['phone', 'Phone'], ['email', 'Email'], ['dateOfBirth', 'Date of birth'], ['gender', 'Gender'], ['address', 'Address'], ['allergies', 'Allergies'], ['notes', 'Notes']];
  const mappedRows = importState.rows.map((row) => Object.fromEntries(fields.map(([field]) => [field, row[importState.mapping[field]] || ''])));
  const invalid = mappedRows.filter((row) => !String(row.fullName || '').trim() || !String(row.phone || '').trim());
  const duplicates = mappedRows.filter((row) => active(state.patients).some((patient) => patient.fullName?.trim().toLowerCase() === row.fullName.trim().toLowerCase() && patient.phone?.replace(/\D/g, '') === row.phone.replace(/\D/g, '')));
  return `<div class="csv-import-modal">${modalHead('CSV IMPORT', importState.fileName, 'Map columns, review validation and choose a duplicate policy before importing.')}<div class="csv-import-summary"><div><strong>${number(importState.rows.length)}</strong><span>rows detected</span></div><div><strong>${number(importState.rows.length - invalid.length)}</strong><span>valid rows</span></div><div><strong>${number(duplicates.length)}</strong><span>possible duplicates</span></div></div><div class="form-grid two">${fields.map(([field, label]) => `<label class="field-label">${esc(label)}<select data-change="csv-map" data-field="${field}"><option value="">Not mapped</option>${importState.headers.map((header) => `<option value="${attr(header)}" ${importState.mapping[field] === header ? 'selected' : ''}>${esc(header)}</option>`).join('')}</select></label>`).join('')}</div>${invalid.length ? `<div class="inline-warning">${icon('warning', 15)} ${number(invalid.length)} row(s) are missing a full name or phone and will not be imported.</div>` : ''}${duplicates.length ? `<div class="inline-warning">${icon('warning', 15)} ${number(duplicates.length)} possible duplicate(s) found by name and phone. Choose Skip or Create New Copy.</div>` : ''}<div class="csv-preview table-wrap"><table class="data-table"><thead><tr>${fields.slice(0, 5).map(([, label]) => `<th>${esc(label)}</th>`).join('')}</tr></thead><tbody>${mappedRows.slice(0, 10).map((row) => `<tr><td>${esc(row.fullName || '—')}</td><td>${esc(row.phone || '—')}</td><td>${esc(row.email || '—')}</td><td>${esc(row.dateOfBirth || '—')}</td><td>${esc(row.gender || '—')}</td></tr>`).join('')}</tbody></table>${mappedRows.length > 10 ? `<small class="field-hint">Showing the first 10 rows of ${number(mappedRows.length)}.</small>` : ''}</div><div class="csv-import-actions"><label class="field-label">Duplicate policy<select data-change="csv-strategy"><option value="Skip" ${importState.strategy === 'Skip' ? 'selected' : ''}>Skip possible duplicates</option><option value="Create New Copy" ${importState.strategy === 'Create New Copy' ? 'selected' : ''}>Create new copy</option></select></label>${button('Cancel', 'close-modal', 'close', 'link')}${button(`Import ${number(Math.max(0, mappedRows.length - invalid.length))} valid patient(s)`, 'csv-import-confirm', 'upload', 'primary')}</div></div>`;
}
function parseCsv(text) {
  const rows = []; let row = []; let cell = ''; let quoted = false;
  for (let i = 0; i < text.length; i += 1) { const char = text[i]; const next = text[i + 1]; if (char === '"' && quoted && next === '"') { cell += '"'; i += 1; } else if (char === '"') quoted = !quoted; else if (char === ',' && !quoted) { row.push(cell.trim()); cell = ''; } else if ((char === '\n' || char === '\r') && !quoted) { if (char === '\r' && next === '\n') i += 1; row.push(cell.trim()); if (row.some((value) => value)) rows.push(row); row = []; cell = ''; } else cell += char; }
  if (cell || row.length) { row.push(cell.trim()); if (row.some((value) => value)) rows.push(row); }
  const headers = (rows.shift() || []).map((header, index) => header || `Column ${index + 1}`);
  return { headers, rows: rows.filter((values) => values.some(Boolean)).slice(0, 25_000).map((values) => Object.fromEntries(headers.map((header, index) => [header, values[index] || '']))) };
}
const COMMANDS = [
  ['new-patient', 'New patient', 'Register a patient', 'open-patient', 'users'],
  ['new-appointment', 'New appointment', 'Book time with a patient', 'open-appointment', 'calendar'],
  ['check-in', 'Check in patient', 'Open today’s queue', 'navigate:queue', 'clipboard'],
  ['new-visit', 'New clinical visit', 'Capture a clinical encounter', 'open-visit', 'activity'],
  ['new-treatment', 'New treatment', 'Add a catalog procedure', 'open-treatment', 'layers'],
  ['prescription', 'New prescription', 'Create printable instructions', 'open-prescription', 'file'],
  ['new-invoice', 'New invoice', 'Create a transparent invoice', 'open-invoice', 'receipt'],
  ['record-payment', 'Record payment', 'Add a patient collection', 'open-payment', 'credit'],
  ['add-expense', 'Add expense', 'Record an operating cost', 'open-expense', 'dollar'],
  ['add-inventory', 'Add inventory', 'Add or adjust stock', 'open-stock', 'box'],
  ['open-payments', 'Open payments', 'Review receipts and collections', 'navigate:payments', 'credit'],
  ['open-reports', 'Open reports', 'Review operational reports', 'navigate:reports', 'chart']
  ['open-analytics', 'Open analytics', 'Review meaningful trends', 'navigate:analytics', 'activity'],
  ['open-settings', 'Open settings', 'Configure this practice', 'navigate:settings', 'settings'],
  ['run-backup', 'Export verified backup', 'Create a portable local backup', 'export-backup', 'backup'],
  ['restore-backup', 'Restore backup', 'Validate and restore a local package', 'trigger-import', 'upload']
];
function modalSearch() {
  const q = ui.search.trim().toLowerCase();
  const commandResults = COMMANDS.filter(([, label, hint]) => !q || `${label} ${hint}`.toLowerCase().includes(q));
  const recordResults = q ? globalSearch(q) : [];
  const commandsMarkup = commandResults.slice(0, q ? 6 : COMMANDS.length).map(([id, label, hint, command, ico]) => `<button class="search-result command-result" data-action="run-command" data-command="${attr(command)}"><span class="search-result-icon">${icon(ico, 16)}</span><span><strong>${esc(label)}</strong><small>${esc(hint)}</small></span><span class="result-type">Command</span>${icon('arrow', 14)}</button>`).join('');
  const recordsMarkup = recordResults.map((r) => `<button class="search-result" data-action="search-result" data-kind="${r.kind}" data-id="${r.id}"><span class="search-result-icon">${icon(r.icon, 16)}</span><span><strong>${esc(r.title)}</strong><small>${esc(r.subtitle)}</small></span><span class="result-type">${esc(r.type)}</span>${icon('arrow', 14)}</button>`).join('');
  const resultMarkup = commandsMarkup || recordsMarkup ? `${commandsMarkup}${recordsMarkup}` : emptyState('search', 'No matching records', 'Try a command, patient name, phone, invoice number or item code.');
  return `${modalHead('COMMAND CENTRE', 'Search your workspace', 'Commands and records are local to this practice. Use the keyboard to stay in flow.')}<label class="search-field modal-search-field">${icon('search', 19)}<input autofocus type="search" value="${attr(ui.search)}" placeholder="Try “new patient” or search a record..." data-input="modal-search"><kbd>Esc</kbd></label><div class="search-hint">${icon('sparkle', 14)} ${q ? 'Commands appear before records.' : 'Start with a command or search any patient, invoice, appointment or stock item.'} Use <kbd>Ctrl</kbd> <kbd>K</kbd> any time.</div><div class="search-results">${resultMarkup}</div>`;
}

function modalUser() {
  const user = currentUser();
  const accounts = (state.users || []).filter((candidate) => candidate.active !== false);
  return `${modalHead('LOCAL ACCOUNT', user?.name || state.settings.dentistName || 'Practice administrator', 'Manage local sign-in, sessions and practice access.')}<div class="user-panel"><span class="avatar avatar-large">${initials(user?.name || state.settings.dentistName || 'Dr')}</span><div><h3>${esc(user?.name || state.settings.dentistName || 'Practice administrator')}</h3><p>${esc(state.settings.clinicName || 'Your practice')} · ${esc(user?.role || 'Administrator')}</p><span class="security-pill">${icon('shield', 14)} ${user?.pinHash ? 'Authenticated local account' : 'Local administrator'}</span></div></div><div class="account-list">${accounts.map((candidate) => `<div class="account-row"><span class="avatar avatar-small">${initials(candidate.name)}</span><div><strong>${esc(candidate.name)}</strong><small>${esc(candidate.role)}${candidate.lastLogin ? ` · Last sign-in ${date(candidate.lastLogin.slice(0, 10))}` : ' · Never signed in'}</small></div><span class="account-status ${candidate.active === false ? 'inactive' : ''}">${candidate.active === false ? 'Inactive' : 'Active'}</span></div>`).join('')}</div><div class="user-actions">${can('users.manage') ? button('Manage user accounts', 'navigate', 'users', 'secondary', 'data-page="users"') : ''}${button('Settings', 'navigate', 'settings', 'secondary', 'data-page="settings"')}${button('About Dentiva Pro', 'navigate', 'info', 'link', 'data-page="about"')}${state.settings.applicationLock ? button('Lock workspace', 'lock-workspace', 'lock', 'secondary') : button('Set application PIN', 'open-security', 'lock', 'secondary')}</div><div class="modal-footer"><button class="btn btn-primary" data-action="close-modal">Close</button></div>`;
}
function modalUserAccount(data = {}) {
  const user = data.user || {};
  const editing = Boolean(user.id);
  const roleOptions = ['Administrator', 'Dentist', 'Manager', 'Receptionist', 'Dental Assistant', 'Custom Role'].map((role) => [role, role]);
  const permissions = Object.entries(PERMISSIONS);
  const selected = new Set(user.permissions || permissionsForRole(user.role || 'Receptionist', user.role === 'Custom Role' ? [] : undefined));
  return `<form data-form="user-account"><input type="hidden" name="id" value="${attr(user.id || '')}">${modalHead(editing ? 'LOCAL USER ACCOUNT' : 'NEW LOCAL USER', editing ? 'Edit account access' : 'Create a secure user account', 'PINs are protected with PBKDF2 hashing. Staff association and account status remain auditable.')}<div class="form-grid two">${field('Full name', 'name', user.name, 'text', 'required')}${selectField('Role template', 'role', roleOptions, user.role || 'Receptionist', 'required')}${selectField('Associated staff member', 'staffId', [['', 'No staff link'], ...active(state.staff).map((person) => [person.id, `${person.name} · ${person.role || 'Staff'}`])], user.staffId || '')}${selectField('Account status', 'active', [['true', 'Active'], ['false', 'Inactive']], String(user.active !== false))}${field(editing ? 'New PIN (leave blank to keep current)' : 'PIN', 'pin', '', 'password', `${editing ? '' : 'required '}minlength="4" maxlength="12" inputmode="numeric" pattern="[0-9]{4,12}" autocomplete="new-password" placeholder="4–12 digits"`)}${field('Confirm PIN', 'confirmPin', '', 'password', `${data.requirePin ? 'required ' : ''}minlength="4" maxlength="12" inputmode="numeric" pattern="[0-9]{4,12}" autocomplete="new-password" placeholder="Repeat PIN"`)}</div><fieldset class="permission-fieldset"><legend>Effective permissions</legend><p class="form-note">Role templates are a starting point. Custom Role can be narrowed or expanded explicitly.</p><div class="permission-grid">${permissions.map(([key, permission]) => `<label class="permission-option"><input type="checkbox" name="permissions" value="${attr(permission)}" ${selected.has(permission) ? 'checked' : ''}><span>${esc(permission.replaceAll('.', ' · '))}</span></label>`).join('')}</div></fieldset>${modalFooter('Cancel', editing ? 'Save account' : 'Create account')}</form>`;
}

function globalSearch(q) {
  const results = [];
  if (can('patients.view')) active(state.patients).filter((p) => [p.fullName, p.patientCode, p.phone, p.email, p.address].some((v) => String(v || '').toLowerCase().includes(q))).slice(0, 8).forEach((p) => results.push({ kind: 'patient', id: p.id, title: p.fullName, subtitle: `${p.patientCode || 'Patient'} · ${p.phone || 'No phone'}`, type: 'Patient', icon: 'users' }));
  if (can('appointments.view')) active(state.appointments).filter((a) => [patientName(a.patientId), a.reason, a.date, a.status].some((v) => String(v || '').toLowerCase().includes(q))).slice(0, 6).forEach((a) => results.push({ kind: 'appointment', id: a.id, title: patientName(a.patientId), subtitle: `${date(a.date)} · ${time(a.time)} · ${a.reason || 'Appointment'}`, type: 'Appointment', icon: 'calendar' }));
  if (can('billing.view')) active(state.invoices).filter((i) => [i.invoiceNumber, patientName(i.patientId), i.date].some((v) => String(v || '').toLowerCase().includes(q))).slice(0, 6).forEach((i) => results.push({ kind: 'invoice', id: i.id, title: i.invoiceNumber, subtitle: `${patientName(i.patientId)} · ${currency(i.total)}`, type: 'Invoice', icon: 'receipt' }));
  if (can('inventory.view')) active(state.inventory).filter((i) => [i.name, i.itemCode, i.category, i.batch].some((v) => String(v || '').toLowerCase().includes(q))).slice(0, 6).forEach((i) => results.push({ kind: 'inventory', id: i.id, title: i.name, subtitle: `${i.itemCode || 'Stock item'} · ${i.currentStock} ${i.unit || ''}`, type: 'Inventory', icon: 'box' }));
  if (can('inventory.view')) active(state.suppliers).filter((s) => [s.name, s.contactPerson, s.phone, s.email].some((v) => String(v || '').toLowerCase().includes(q))).slice(0, 4).forEach((s) => results.push({ kind: 'supplier', id: s.id, title: s.name, subtitle: `${s.contactPerson || 'Supplier'} · ${s.phone || 'No phone'}`, type: 'Supplier', icon: 'truck' }));
  if (can('staff.view')) active(state.staff).filter((person) => [person.name, person.role, person.phone, person.email].some((v) => String(v || '').toLowerCase().includes(q))).slice(0, 4).forEach((person) => results.push({ kind: 'staff', id: person.id, title: person.name, subtitle: `${person.role || 'Staff'} · ${person.phone || 'No phone'}`, type: 'Staff', icon: 'briefcase' }));
  if (can('clinical.view')) active(state.visits).filter((v) => [patientName(v.patientId), v.reason, v.diagnosis, v.treatmentPerformed].some((value) => String(value || '').toLowerCase().includes(q))).slice(0, 5).forEach((v) => results.push({ kind: 'visit', id: v.id, title: patientName(v.patientId), subtitle: `${date(v.date)} · ${v.reason || 'Clinical visit'}`, type: 'Visit', icon: 'activity' }));
  return results.slice(0, 16);
}

function openModal(type, data = {}) { ui.modal = { type, data }; render(); window.setTimeout(() => document.querySelector('[data-modal-window] input, [data-modal-window] select')?.focus(), 40); }
function closeModal() { if (ui.modal?.type === 'csvImport' && ui.csvImport) ui.csvImport = null; ui.modal = null; render(); }
function openPatientProfile(id) { ui.patientId = id; ui.patientTab = 'overview'; ui.page = 'patients'; render(); }
function formData(event) { return Object.fromEntries(new FormData(event.target).entries()); }
function numeric(value) { const n = Number(value); return Number.isFinite(n) ? n : 0; }
function makePatient(data, editing = false) {
  const existing = editing ? byId(state.patients, data.id) : null;
  const status = data.status || existing?.status || 'Active';
  const record = { ...(existing || {}), ...data, id: existing?.id || uid('patient'), patientCode: existing?.patientCode || nextCode('patient', 'patientPrefix'), registrationDate: existing?.registrationDate || today(), status, archived: status === 'Archived', updatedAt: now() };
  return record;
}
function invoiceTotals(data) { return calculateInvoice(data); }

async function handleSubmit(event) {
  const form = event.target.closest('form[data-form]'); if (!form) return;
  event.preventDefault(); const type = form.dataset.form; const data = formData(event);
  const formPermissions = { patient: data.id ? 'patients.edit' : 'patients.create', appointment: data.id ? 'appointments.edit' : 'appointments.create', visit: data.id ? 'clinical.edit' : 'clinical.create', prescription: data.id ? 'prescriptions.edit' : 'prescriptions.create', invoice: data.id ? 'billing.edit' : 'billing.create', payment: 'payments.create', refund: 'payments.refund', stock: data.id ? 'inventory.adjust' : 'inventory.purchase', supplier: data.id ? 'inventory.adjust' : 'inventory.purchase', 'stock-adjustment': data.movementType === 'Usage' ? 'inventory.consume' : data.movementType === 'Adjustment' ? 'inventory.correct' : 'inventory.purchase', staff: data.id ? 'staff.edit' : 'staff.create', expense: data.id ? 'accounting.edit' : 'accounting.create', treatment: data.id ? 'clinical.edit' : 'clinical.create', 'treatment-plan': data.id ? 'clinical.edit' : 'clinical.create', referral: data.id ? 'clinical.edit' : 'clinical.create', attachment: 'clinical.edit', security: 'settings.edit' };
  if (formPermissions[type] && !requirePermission(formPermissions[type])) return;
  try {
    if (type === 'saved-filter') {
      if (!String(data.name || '').trim()) return notify('Enter a name for this saved view.', 'error');
      const filter = { id: uid('filter'), entity: 'patients', name: String(data.name).trim(), query: ui.search, status: ui.patientStatusFilter || 'All statuses', dateFrom: ui.patientDateFrom || '', dateTo: ui.patientDateTo || '', toothStatus: ui.patientToothStatus || '', balance: ui.patientBalanceFilter || 'all', createdAt: now(), updatedAt: now() };
      state.savedFilters = [filter, ...(state.savedFilters || []).filter((item) => item.name.toLowerCase() !== filter.name.toLowerCase())].slice(0, 50);
      audit('Saved patient view created', 'Saved search', filter.id, filter.name);
      Store.save(state); closeModal(); notify('Patient view saved.'); return;
    }
    if (type === 'user-account') {
      if (!requirePermission('users.manage')) return;
      const editing = Boolean(data.id);
      const user = editing ? byId(state.users, data.id) : null;
      if (editing && !user) return notify('That user account no longer exists.', 'error');
      if (!String(data.name || '').trim()) return notify('Enter the account holder name.', 'error');
      if (!editing && !/^\d{4,12}$/.test(data.pin || '')) return notify('New accounts require a 4–12 digit PIN.', 'error');
      if (data.pin && data.pin !== data.confirmPin) return notify('PIN confirmation does not match.', 'error');
      if (data.pin && !/^\d{4,12}$/.test(data.pin)) return notify('PINs must be 4–12 digits.', 'error');
      const role = data.role || 'Receptionist';
      const selectedPermissions = [...form.querySelectorAll('input[name="permissions"]:checked')].map((input) => input.value);
      const permissions = permissionsForRole(role, selectedPermissions);
      const next = user || { id: uid('user'), createdAt: now(), failedAttempts: 0, lockedUntil: 0, lastLogin: null };
      Object.assign(next, { name: String(data.name).trim(), role, staffId: data.staffId || '', active: data.active !== 'false', permissions });
      if (data.pin) { const hashed = await hashPin(data.pin); next.pinSalt = hashed.salt; next.pinHash = hashed.hash; }
      if (next.active === false && next.id === currentUser()?.id) return notify('You cannot deactivate the signed-in account.', 'error');
      const projectedUsers = editing ? state.users.map((candidate) => candidate.id === next.id ? next : candidate) : [...state.users, next];
      const remainingAdmins = projectedUsers.filter((candidate) => candidate.active !== false && candidate.role === 'Administrator').length;
      if (remainingAdmins < 1) return notify('Keep at least one active Administrator account.', 'error');
      if (editing) Object.assign(user, next); else state.users.push(next);
      audit(editing ? 'User account updated' : 'User account created', 'User', next.id, `${next.name} · ${next.role}`);
      Store.save(state); closeModal(); notify(editing ? 'User account updated.' : 'User account created.');
      return;
    }
    if (type === 'user-login') {
      const user = state.users.find((candidate) => candidate.id === data.userId && candidate.active !== false);
      if (!user) return notify('That local account is unavailable.', 'error');
      if (Date.now() < Number(user.lockedUntil || 0)) return notify('This account is temporarily locked. Try again shortly.', 'error');
      if (!/^\d{4,12}$/.test(data.pin || '')) return notify('Enter your 4–12 digit local PIN.', 'error');
      const candidateHash = await hashPin(data.pin, user.pinSalt || '');
      if (!user.pinHash || candidateHash.hash !== user.pinHash) {
        user.failedAttempts = Number(user.failedAttempts || 0) + 1;
        if (user.failedAttempts >= 5) { user.lockedUntil = Date.now() + 30_000; user.failedAttempts = 0; }
        Store.save(state);
        return notify(user.lockedUntil ? 'Too many failed attempts. Try again in 30 seconds.' : 'That PIN is not correct.', 'error');
      }
      user.failedAttempts = 0;
      user.lockedUntil = 0;
      user.lastLogin = now();
      ui.authenticatedUserId = user.id;
      ui.locked = false;
      ui.toast = null;
      Store.save(state);
      render();
      notify(`Welcome, ${user.name}.`);
      return;
    }
    if (type === 'setup') return await saveSetupStep(data);
    if (type === 'unlock') {
      if (!state.settings.pinHash) { ui.locked = false; render(); return; }
      if (Date.now() < ui.unlockBlockedUntil) return notify('Too many failed attempts. Try again shortly.', 'error');
      if (!/^\d{4,12}$/.test(data.pin || '')) return notify('Enter the 4–12 digit application PIN.', 'error');
      const candidateHash = await hashPin(data.pin, state.settings.pinSalt);
      if (candidateHash.hash !== state.settings.pinHash) {
        ui.unlockFailures += 1;
        if (ui.unlockFailures >= 5) { ui.unlockBlockedUntil = Date.now() + 30_000; ui.unlockFailures = 0; }
        return notify(ui.unlockBlockedUntil ? 'Too many failed attempts. Try again in 30 seconds.' : 'That PIN is not correct. Try again.', 'error');
      }
      ui.unlockFailures = 0;
      ui.unlockBlockedUntil = 0;
      ui.locked = false;
      ui.toast = null;
      render();
      resetActivityTimer();
      notify('Workspace unlocked.');
      return;
    }
    if (type === 'security') {
      if (!/^\d{4,12}$/.test(data.pin || '')) return notify('PIN must contain 4–12 digits.', 'error');
      if (data.pin !== data.confirmPin) return notify('The PIN confirmation does not match.', 'error');
      const derivedPin = await hashPin(data.pin);
      state.settings.pinHash = derivedPin.hash;
      state.settings.pinSalt = derivedPin.salt;
      state.settings.applicationLock = true;
      const securityUser = currentUser() || state.users.find((candidate) => candidate.role === 'Administrator');
      if (securityUser) { securityUser.pinHash = derivedPin.hash; securityUser.pinSalt = derivedPin.salt; securityUser.active = true; }
      audit('Application lock enabled', 'Security', '', 'Local administrator PIN configured');
      Store.save(state);
      closeModal();
      notify('Application lock enabled.');
      return;
    }
    if (type === 'attachment') {
      const existing = data.id ? byId(state.attachments, data.id) : null;
      const source = ui.modal?.data || {};
      const fileData = data.data || source.data || existing?.data;
      const validation = validateAttachmentFile({ type: data.type || source.type || existing?.type, size: data.size || source.size || existing?.size, name: data.name });
      if (!validation.allowed || !data.patientId || !fileData) return notify('This attachment is invalid or missing its patient record.', 'error');
      const record = { ...(existing || {}), id: existing?.id || uid('attachment'), patientId: data.patientId, visitId: data.visitId || '', name: sanitizeFilename(data.name), type: data.type || source.type || existing?.type, size: numeric(data.size || source.size || existing?.size), data: fileData, category: data.category || 'Clinical document', notes: data.notes || '', createdAt: existing?.createdAt || now(), updatedAt: now() };
      if (existing) Object.assign(existing, record); else state.attachments.push(record);
      audit(existing ? 'Attachment details edited' : 'Attachment added', 'Attachment', record.id, `${record.name} · ${record.category}`);
      Store.save(state);
      ui.pendingAttachment = null;
      closeModal();
      notify(existing ? 'Attachment details saved.' : 'Attachment added to the patient record.');
      return;
    }
    if (type === 'patient') {
      const validation = validatePatientInput(data);
      if (!validation.valid) return notify(validation.errors[0], 'error');
      const duplicate = active(state.patients).find((p) => p.id !== data.id && p.phone && data.phone && p.phone.replace(/\D/g, '') === data.phone.replace(/\D/g, '') && p.fullName.toLowerCase() === data.fullName.toLowerCase());
      if (duplicate && !window.confirm(`A patient with the same name and phone already exists (${duplicate.patientCode}). Save anyway?`)) return;
      const customFields = Object.fromEntries((state.settings.customPatientFields || []).map((definition) => [definition.key, data[`custom_${definition.key}`] || '']));
      const editing = Boolean(data.id); const record = makePatient({ ...data, tags: normaliseTags(data.tagsText), customFields }, editing); if (editing) Object.assign(byId(state.patients, data.id), record); else state.patients.push(record); audit(editing ? 'Patient edited' : 'Patient created', 'Patient', record.id, `${record.patientCode} · ${record.fullName}`); Store.save(state); closeModal(); notify(editing ? 'Patient updated.' : `Patient ${record.patientCode} created.`); return;
    }
    if (type === 'appointment') {
      if (!data.patientId || !data.date || !data.time || !data.reason.trim()) return notify('Patient, date, time and reason are required.', 'error');
      const candidate = { ...data, duration: numeric(data.duration) || state.settings.defaultDuration };
      const conflict = active(state.appointments).find((a) => appointmentsOverlap(candidate, a, state.settings.defaultDuration));
      if (conflict) {
        const resources = [candidate.dentistId && conflict.dentistId === candidate.dentistId ? 'dentist' : '', candidate.chair && conflict.chair === candidate.chair ? 'chair' : '', candidate.room && conflict.room === candidate.room ? 'room' : ''].filter(Boolean).join(', ');
        if (!window.confirm(`This appointment overlaps ${conflict.patientId ? patientName(conflict.patientId) : 'another appointment'} on the same ${resources || 'resource'}. Save as a double-booking?`)) return;
      }
      const editing = Boolean(data.id); const existing = editing ? byId(state.appointments, data.id) : null; const record = { ...(existing || {}), ...data, id: existing?.id || uid('appointment'), appointmentCode: existing?.appointmentCode || nextCode('appointment', 'appointmentPrefix'), serial: existing?.serial || nextCode('serial', 'serialPrefix'), duration: candidate.duration, createdAt: existing?.createdAt || now(), updatedAt: now() }; if (editing) Object.assign(existing, record); else state.appointments.push(record); const patient = byId(state.patients, data.patientId); if (patient && data.date >= today()) patient.nextVisit = data.date; audit(editing ? 'Appointment edited' : 'Appointment created', 'Appointment', record.id, `${patient?.fullName || ''} · ${data.date} ${data.time}`); Store.save(state); closeModal(); notify(editing ? 'Appointment updated.' : 'Appointment booked.'); return;
    }
    if (type === 'visit') {
      if (!data.patientId || !data.date || !data.reason.trim()) return notify('Patient, date and reason are required.', 'error');
      const editing = Boolean(data.id); const existing = editing ? byId(state.visits, data.id) : null; const record = { ...(existing || {}), ...data, id: existing?.id || uid('visit'), visitCode: existing?.visitCode || nextCode('visit', 'appointmentPrefix'), createdAt: existing?.createdAt || now(), updatedAt: now(), status: 'Completed' }; if (editing) Object.assign(existing, record); else state.visits.push(record); const patient = byId(state.patients, data.patientId); if (patient) patient.lastVisit = data.date; audit(editing ? 'Visit edited' : 'Visit created', 'Visit', record.id, `${patient?.fullName || ''} · ${data.reason}`); Store.save(state); closeModal(); if (patient) { ui.patientId = patient.id; ui.page = 'patients'; } notify(editing ? 'Clinical visit updated.' : 'Clinical visit recorded.'); return;
    }
    if (type === 'prescription') {
      if (!data.patientId || !data.medicine.trim() || !data.doctor.trim()) return notify('Patient, doctor and medicine are required.', 'error');
      const additional = String(data.medicationsText || '').split(/\r?\n/).map((line) => line.trim()).filter(Boolean).map((line) => { const [medicine = '', strength = '', dosage = '', frequency = '', duration = '', route = 'Oral', instructions = ''] = line.split('|').map((part) => part.trim()); return { medicine, strength, dosage, frequency, duration, route, instructions }; }).filter((medication) => medication.medicine);
      const medication = { medicine: data.medicine.trim(), strength: data.strength, dosage: data.dosage, frequency: data.frequency, duration: data.duration, route: data.route, instructions: data.instructions };
      const medications = [medication, ...additional.filter((item) => item.medicine.toLowerCase() !== medication.medicine.toLowerCase())];
      const editing = Boolean(data.id); const existing = editing ? byId(state.prescriptions, data.id) : null; const record = { ...(existing || {}), id: existing?.id || uid('rx'), prescriptionCode: existing?.prescriptionCode || nextCode('prescription', 'appointmentPrefix'), patientId: data.patientId, date: data.date || today(), doctor: data.doctor, medications, notes: data.notes, createdAt: existing?.createdAt || now(), updatedAt: now() }; if (editing) Object.assign(existing, record); else state.prescriptions.push(record); audit(editing ? 'Prescription edited' : 'Prescription created', 'Prescription', record.id, `${patientName(data.patientId)} · ${medications.length} medicine(s)`); Store.save(state); closeModal(); notify(editing ? 'Prescription updated.' : 'Prescription created.'); return;
    }
    if (type === 'invoice') {
      if (!data.patientId || !data.itemName.trim() || !validateMoney(data.unitPrice) || !validateMoney(data.discount || 0)) return notify('Patient, line item and valid two-decimal money amounts are required.', 'error');
      const totals = invoiceTotals(data);
      const editing = Boolean(data.id);
      const existing = editing ? byId(state.invoices, data.id) : null;
      const record = { ...(existing || {}), id: existing?.id || uid('invoice'), invoiceNumber: existing?.invoiceNumber || nextCode('invoice', 'invoicePrefix'), patientId: data.patientId, date: data.date || today(), items: [{ name: data.itemName.trim(), quantity: numeric(data.quantity) || 1, unitPrice: totals.subtotal / (numeric(data.quantity) || 1), total: totals.subtotal }], subtotal: totals.subtotal, discount: totals.discount, taxRate: totals.taxRate, tax: totals.tax, total: totals.total, notes: data.notes, createdAt: existing?.createdAt || now(), updatedAt: now() };
      const existingPayments = editing ? active(state.payments).filter((payment) => payment.invoiceId === record.id).map((payment) => ({ ...payment, amount: paymentAmount(payment), refundedAmount: 0 })) : [];
      const paymentStatus = paymentStatusFor(record.total, existingPayments);
      Object.assign(record, paymentStatus);
      if ((data.status === 'Cancelled' || existing?.status === 'Cancelled') && paymentStatus.paid === 0) record.status = 'Cancelled';
      if (editing) Object.assign(existing, record); else state.invoices.push(record);
      audit(editing ? 'Invoice edited' : 'Invoice created', 'Invoice', record.id, `${record.invoiceNumber} · ${currency(record.total)}`);
      Store.save(state); closeModal(); notify(editing ? 'Invoice updated.' : `Invoice ${record.invoiceNumber} created.`); return;
    }
    if (type === 'payment') {
      const amount = numeric(data.amount);
      if (!data.patientId || !data.date) return notify('Patient and payment date are required.', 'error');
      const invoice = data.invoiceId ? byId(state.invoices, data.invoiceId) : null;
      const validation = validatePayment({ amount, due: invoice ? invoicePaymentStatus(invoice).due : amount, invoiceStatus: invoice?.status || 'Unpaid' });
      if (!validation.valid) return notify(validation.errors[0], 'error');
      const record = { id: uid('payment'), receiptNumber: nextCode('receipt', 'invoicePrefix'), invoiceId: data.invoiceId || '', patientId: data.patientId, amount: validation.amount, refundedAmount: 0, status: 'Recorded', date: data.date, method: data.method, reference: data.reference, transactionId: data.reference, provider: data.provider, notes: data.notes, createdAt: now(), updatedAt: now() };
      state.payments.push(record);
      if (invoice) { Object.assign(invoice, invoicePaymentStatus(invoice)); invoice.updatedAt = now(); }
      audit('Payment recorded', 'Payment', record.id, `${record.receiptNumber} · ${currency(record.amount)}`);
      Store.save(state); closeModal(); notify(`Payment of ${currency(record.amount)} recorded.`); return;
    }
    if (type === 'refund') {
      const payment = byId(state.payments, data.paymentId);
      const amount = numeric(data.amount);
      const remaining = payment ? paymentAmount(payment) : 0;
      if (!payment || !validateMoney(data.amount, { allowZero: false }) || amount > remaining) return notify('Refund must be greater than zero, use at most two decimals and cannot exceed the remaining payment.', 'error');
      const adjustment = { id: uid('adjustment'), type: 'Refund', paymentId: payment.id, invoiceId: payment.invoiceId || '', patientId: payment.patientId, amount, date: data.date || today(), reason: data.reason.trim(), createdAt: now() };
      state.paymentAdjustments.push(adjustment);
      payment.status = paymentAmount(payment) <= 0 ? 'Refunded' : 'Partially Refunded';
      const invoice = payment.invoiceId ? byId(state.invoices, payment.invoiceId) : null;
      if (invoice) { Object.assign(invoice, invoicePaymentStatus(invoice)); invoice.updatedAt = now(); }
      audit('Payment refunded', 'Payment adjustment', adjustment.id, `${currency(amount)} · ${adjustment.reason}`);
      Store.save(state); closeModal(); notify(`Refund of ${currency(amount)} recorded.`); return;
    }
    if (type === 'stock-adjustment') {
      const item = byId(state.inventory, data.itemId);
      const quantity = numeric(data.quantity);
      if (!item || quantity <= 0 || !data.reason.trim()) return notify('Choose an item, positive quantity and a reason.', 'error');
      const delta = data.movementType === 'Purchase' || (data.movementType === 'Adjustment' && data.direction === 'increase') ? quantity : -quantity;
      const before = numeric(item.currentStock);
      const after = before + delta;
      if (after < 0) return notify('This movement would make stock negative.', 'error');
      item.currentStock = after;
      item.updatedAt = now();
      if (data.batch) item.batch = data.batch;
      const movement = { id: uid('movement'), itemId: item.id, supplierId: item.supplierId || '', unitPrice: numeric(item.purchasePrice), type: data.movementType || 'Adjustment', quantity: delta, before, after, date: data.date || today(), reason: data.reason.trim(), createdAt: now() };
      state.stockMovements.unshift(movement);
      audit('Stock movement recorded', 'Inventory movement', movement.id, `${item.name} · ${movement.type} · ${delta}`);
      Store.save(state); closeModal(); notify('Stock movement recorded.'); return;
    }
    if (type === 'stock') {
      if (!data.name.trim() || numeric(data.currentStock) < 0) return notify('Item name and a valid stock quantity are required.', 'error'); const editing = Boolean(data.id); const existing = editing ? byId(state.inventory, data.id) : null; const previous = Number(existing?.currentStock || 0); const added = numeric(data.quantity); const record = { ...(existing || {}), ...data, id: existing?.id || uid('stock'), currentStock: editing ? Number(existing.currentStock || 0) : numeric(data.currentStock) + added, minimumStock: numeric(data.minimumStock), createdAt: existing?.createdAt || now(), updatedAt: now() }; if (editing) Object.assign(existing, record); else state.inventory.push(record); if (!editing && added > 0) state.stockMovements.unshift({ id: uid('movement'), itemId: record.id, supplierId: record.supplierId || '', unitPrice: numeric(record.purchasePrice), type: 'Purchase', quantity: added, before: previous, after: record.currentStock, date: record.purchaseDate || today(), createdAt: now(), notes: 'Initial stock entry' }); audit(editing ? 'Inventory item edited' : 'Inventory adjusted', 'Inventory', record.id, `${record.name} · ${record.currentStock} ${record.unit || ''}`); Store.save(state); closeModal(); notify(editing ? 'Stock details updated.' : 'Stock item added.'); return;
    }
    if (type === 'supplier') { if (!data.name.trim()) return notify('Supplier name is required.', 'error'); const editing = Boolean(data.id); const existing = editing ? byId(state.suppliers, data.id) : null; const record = { ...(existing || {}), ...data, id: existing?.id || uid('supplier'), createdAt: existing?.createdAt || now(), updatedAt: now() }; if (editing) Object.assign(existing, record); else state.suppliers.push(record); audit(editing ? 'Supplier edited' : 'Supplier created', 'Supplier', record.id, record.name); Store.save(state); closeModal(); notify(editing ? 'Supplier updated.' : 'Supplier added.'); return; }
    if (type === 'staff') { if (!data.name.trim()) return notify('Staff name is required.', 'error'); const editing = Boolean(data.id); const existing = editing ? byId(state.staff, data.id) : null; const record = { ...(existing || {}), ...data, id: existing?.id || uid('staff'), staffCode: existing?.staffCode || nextCode('staff', 'patientPrefix'), createdAt: existing?.createdAt || now(), updatedAt: now() }; if (editing) Object.assign(existing, record); else state.staff.push(record); audit(editing ? 'Staff edited' : 'Staff created', 'Staff', record.id, record.name); Store.save(state); closeModal(); notify(editing ? 'Staff member updated.' : 'Staff member added.'); return; }
    if (type === 'referral') { if (!data.patientId || !data.referralTo.trim() || !data.reason.trim()) return notify('Patient, destination and reason are required.', 'error'); const editing = Boolean(data.id); const existing = editing ? byId(state.referrals, data.id) : null; const record = { ...(existing || {}), ...data, id: existing?.id || uid('referral'), createdAt: existing?.createdAt || now(), updatedAt: now() }; if (editing) Object.assign(existing, record); else state.referrals.push(record); audit(editing ? 'Referral edited' : 'Referral created', 'Referral', record.id, `${patientName(record.patientId)} · ${record.referralTo}`); Store.save(state); closeModal(); notify(editing ? 'Referral updated.' : 'Referral recorded.'); return; }
    if (type === 'treatment-plan') {
      const planValidation = validateTreatmentPlanInput(data);
      if (!planValidation.valid) return notify(planValidation.errors[0], 'error');
      const editing = Boolean(data.id);
      const existing = editing ? byId(state.treatmentPlans, data.id) : null;
      const oldStages = existing?.stages || [];
      const stages = String(data.stagesText || '').split(/\r?\n/).map((line, index) => line.trim()).filter(Boolean).map((line, index) => { const [title, plannedDate = '', estimatedCost = '', status = 'Planned', notes = ''] = line.split('|').map((part) => part.trim()); const previous = oldStages[index] || {}; return { id: previous.id || uid('stage'), title: title || `Stage ${index + 1}`, plannedDate, estimatedCost: numeric(estimatedCost), status: ['Planned', 'In progress', 'Completed', 'Deferred'].includes(status) ? status : 'Planned', notes }; });
      const record = { ...(existing || {}), id: existing?.id || uid('plan'), patientId: data.patientId, title: String(data.title).trim(), goal: data.goal || '', procedures: data.procedures || '', teeth: data.teeth || '', status: data.status || 'Draft', estimatedDuration: numeric(data.estimatedDuration), estimatedCost: numeric(data.estimatedCost), discount: numeric(data.discount), estimatedTotal: Math.max(0, numeric(data.estimatedCost) - numeric(data.discount)), startDate: data.startDate || '', reviewDate: data.reviewDate || '', dentistId: data.dentistId || '', notes: data.notes || '', stages, createdAt: existing?.createdAt || now(), updatedAt: now() };
      if (editing) Object.assign(existing, record); else state.treatmentPlans.push(record);
      audit(editing ? 'Treatment plan edited' : 'Treatment plan created', 'Treatment plan', record.id, `${patientName(record.patientId)} · ${record.title}`);
      Store.save(state); closeModal(); ui.patientId = record.patientId; ui.page = 'patients'; ui.patientTab = 'treatment-plan'; notify(editing ? 'Treatment plan updated.' : 'Treatment plan created.'); return;
    }
    if (type === 'treatment') { if (!data.name.trim()) return notify('Treatment name is required.', 'error'); const editing = Boolean(data.id); const existing = editing ? byId(state.treatments, data.id) : null; const record = { ...(existing || {}), ...data, id: existing?.id || uid('treatment'), defaultPrice: numeric(data.defaultPrice), duration: numeric(data.duration) || 30, toothRequired: data.toothRequired === 'true', active: data.active !== 'false', createdAt: existing?.createdAt || now(), updatedAt: now() }; if (editing) Object.assign(existing, record); else state.treatments.push(record); audit(editing ? 'Treatment catalog edited' : 'Treatment catalog item created', 'Treatment', record.id, record.name); Store.save(state); closeModal(); notify(editing ? 'Treatment updated.' : 'Treatment added.'); return; }
    if (type === 'expense') { const amount = numeric(data.amount); if (!data.description.trim() || !validateMoney(data.amount, { allowZero: false })) return notify('Description and a positive amount with at most two decimals are required.', 'error'); const record = { id: uid('expense'), ...data, amount, createdAt: now() }; state.expenses.push(record); audit('Expense recorded', 'Expense', record.id, `${record.description} · ${currency(amount)}`); Store.save(state); closeModal(); notify('Expense recorded.'); return; }
  } catch (error) { console.error(error); notify('The record could not be saved. Your data is unchanged.', 'error'); }
}
async function saveSetupStep(data) {
  const step = ui.modal.data.step || 1;
  if (step === 1) { Object.assign(state.settings, data); openModal('setup', { step: 2 }); return; }
  if (!/^\d{4,12}$/.test(data.adminPin || '') || data.adminPin !== data.adminPinConfirm) return notify('Choose a matching 4–12 digit Administrator PIN.', 'error');
  const { adminPin, adminPinConfirm, ...settingsData } = data;
  Object.assign(state.settings, settingsData);
  const derivedPin = await hashPin(adminPin);
  state.settings.pinHash = derivedPin.hash;
  state.settings.pinSalt = derivedPin.salt;
  state.settings.applicationLock = true;
  const administrator = state.users.find((user) => user.role === 'Administrator') || { id: 'user_admin', createdAt: now(), failedAttempts: 0, lockedUntil: 0, lastLogin: null };
  Object.assign(administrator, { name: state.settings.dentistName || 'Practice administrator', staffId: '', role: 'Administrator', permissions: permissionsForRole('Administrator'), pinHash: derivedPin.hash, pinSalt: derivedPin.salt, active: true });
  if (!state.users.some((user) => user.id === administrator.id)) state.users.push(administrator);
  state.setupComplete = true;
  audit('Setup completed', 'Settings', '', 'Practice identity and administrator account configured');
  Store.save(state);
  openModal('setup', { step: 3 });
}
function saveSettings() {
  if (!requirePermission('settings.edit')) return;
  document.querySelectorAll('[data-settings]').forEach((el) => {
    if (['paymentMethodsText', 'roomsText', 'customPatientFieldsText', 'expenseCategoriesText', 'inventoryCategoriesText'].includes(el.name)) return;
    state.settings[el.name] = el.type === 'number' ? numeric(el.value) : el.value;
  });
  const methodsInput = document.querySelector('[name="paymentMethodsText"]');
  if (methodsInput) state.settings.paymentMethods = [...new Set(methodsInput.value.split(',').map((method) => method.trim()).filter(Boolean))];
  const expenseCategoriesInput = document.querySelector('[name="expenseCategoriesText"]');
  if (expenseCategoriesInput) state.settings.expenseCategories = [...new Set(expenseCategoriesInput.value.split(',').map((category) => category.trim()).filter(Boolean))].slice(0, 100);
  const inventoryCategoriesInput = document.querySelector('[name="inventoryCategoriesText"]');
  if (inventoryCategoriesInput) state.settings.inventoryCategories = [...new Set(inventoryCategoriesInput.value.split(',').map((category) => category.trim()).filter(Boolean))].slice(0, 100);
  const roomsInput = document.querySelector('[name="roomsText"]');
  if (roomsInput) { state.settings.rooms = [...new Set(roomsInput.value.split(',').map((room) => room.trim()).filter(Boolean))]; state.rooms = state.settings.rooms.map((name, index) => ({ id: `room_${name.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '') || index + 1}`, name, active: true })); }
  const customFieldsInput = document.querySelector('[name="customPatientFieldsText"]');
  if (customFieldsInput) state.settings.customPatientFields = [...new Set(customFieldsInput.value.split(',').map((label) => label.trim()).filter(Boolean))].slice(0, 20).map((label) => ({ key: label.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '') || uid('field'), label, type: 'text' }));
  document.querySelectorAll('[data-settings-template]').forEach((el) => { state.settings.documentTemplate = { ...(state.settings.documentTemplate || {}), [el.dataset.settingsTemplate]: el.type === 'checkbox' ? el.checked : el.value }; });
  document.querySelectorAll('[data-settings-checkbox]').forEach((el) => { state.settings[el.dataset.settingsCheckbox] = el.checked; });
  state.notificationRules = NOTIFICATION_RULES.map(([kind]) => ({ id: `rule_${kind}`, kind, enabled: document.querySelector(`[data-settings-rule="${kind}"]`)?.checked !== false }));
  state.settings.autoLockMinutes = clamp(numeric(state.settings.autoLockMinutes) || 30, 1, 240);
  state.settings.taxRate = clamp(numeric(state.settings.taxRate), 0, 100);
  audit('Settings changed', 'Settings', '', 'General practice settings updated'); Store.save(state); notify('Settings saved.');
}

function runCommand(command) {
  if (command.startsWith('navigate:')) {
    const page = command.split(':')[1];
    const permissions = { queue: 'appointments.queue', reports: 'reports.view', analytics: 'reports.analytics', settings: 'settings.view', payments: 'payments.view' };
    if (permissions[page] && !requirePermission(permissions[page])) return;
    ui.page = page; ui.patientId = null; ui.modal = null; ui.search = ''; render(); return;
  }
  const actions = { 'open-patient': () => openModal('patient'), 'open-appointment': () => openModal('appointment'), 'open-visit': () => openModal('visit'), 'open-treatment': () => openModal('treatment'), 'open-prescription': () => openModal('prescription', { patientId: ui.patientId || '' }), 'open-invoice': () => openModal('invoice', { patientId: ui.patientId || '' }), 'open-payment': () => openModal('payment'), 'open-expense': () => openModal('expense'), 'open-stock': () => openModal('stock'), 'export-backup': () => exportBackup(), 'trigger-import': () => { if (requirePermission('backup.restore')) document.querySelector('#backup-file')?.click(); } };
  if (actions[command]) actions[command]();
}

function handleClick(event) {
  const target = event.target.closest('[data-action]'); if (!target) return; const action = target.dataset.action;
  const actionPermissions = { 'export-backup': 'backup.create', 'trigger-import': 'backup.restore', 'restore-confirm': 'backup.restore', 'integrity-check': 'diagnostics.view', 'export-patients': 'patients.view', 'import-patients': 'patients.create', 'export-visits': 'clinical.view', 'export-inventory': 'inventory.view', 'export-report': 'reports.export', 'export-report-pdf': 'reports.export', 'print-invoice': 'billing.view', 'print-payment': 'payments.view', 'print-prescription': 'prescriptions.print', 'print-patient': 'patients.view', 'print-patient-statement': 'billing.view', 'print-dental-chart': 'clinical.view', 'print-report': 'reports.view', 'print-billing': 'billing.view', 'print-queue': 'appointments.view', 'print-expense': 'accounting.view', 'open-audit-log': 'audit.view' };
  if (actionPermissions[action] && !requirePermission(actionPermissions[action])) return;
  if (action === 'export-unsupported-store') { jsonDownload(deepClone(state), `dentiva-pro-preserved-schema-${state.schemaVersion}.json`); return; }
  if (action === 'reset-workspace') { if (window.confirm('Reset this workspace? Export the preserved data first because this cannot be undone.')) Store.reset(); return; }
  if (action === 'navigate') { const page = target.dataset.page || 'dashboard'; const pagePermissions = { patients: 'patients.view', appointments: 'appointments.view', queue: 'appointments.queue', clinical: 'clinical.view', prescriptions: 'prescriptions.view', dental: 'clinical.view', treatments: 'clinical.view', billing: 'billing.view', payments: 'payments.view', accounting: 'accounting.view', inventory: 'inventory.view', suppliers: 'inventory.view', staff: 'staff.view', reports: 'reports.view', analytics: 'reports.analytics', notifications: 'notifications.manage', backup: 'backup.create', diagnostics: 'diagnostics.view', settings: 'settings.view', users: 'users.manage' }; if (pagePermissions[page] && !requirePermission(pagePermissions[page])) return; ui.page = page; ui.patientId = null; ui.modal = null; ui.mobileNav = false; ui.search = ''; render(); return; }
  if (action === 'open-user-account') { if (!requirePermission('users.manage')) return; openModal('userAccount', { user: byId(state.users, target.dataset.id) || {} }); return; }
  if (action === 'toggle-user-active') { if (!requirePermission('users.manage')) return; const user = byId(state.users, target.dataset.id); if (!user || user.id === currentUser()?.id) return notify('You cannot deactivate the signed-in account.', 'error'); user.active = user.active === false; audit(user.active ? 'User account activated' : 'User account deactivated', 'User', user.id, `${user.name} · ${user.role}`); Store.save(state); render(); notify(user.active ? 'User account activated.' : 'User account deactivated.'); return; }
  if (action === 'toggle-sidebar') { ui.sidebarCollapsed = !ui.sidebarCollapsed; render(); return; }
  if (action === 'toggle-mobile-nav') { ui.mobileNav = !ui.mobileNav; render(); return; }
  if (action === 'open-search') { openModal('search'); return; }
  if (action === 'save-patient-filter') { openModal('saveFilter'); return; }
  if (action === 'open-saved-filters') { openModal('savedFilters'); return; }
  if (action === 'load-saved-filter') { const filter = byId(state.savedFilters || [], target.dataset.id); if (!filter) return; ui.search = filter.query || ''; ui.patientStatusFilter = filter.status || 'All statuses'; ui.patientDateFrom = filter.dateFrom || ''; ui.patientDateTo = filter.dateTo || ''; ui.patientToothStatus = filter.toothStatus || ''; ui.patientBalanceFilter = filter.balance || 'all'; ui.patientPage = 1; closeModal(); render(); return; }
  if (action === 'delete-saved-filter') { const filter = byId(state.savedFilters || [], target.dataset.id); if (!filter || !window.confirm(`Delete saved view “${filter.name}”?`)) return; state.savedFilters = state.savedFilters.filter((item) => item.id !== filter.id); audit('Saved patient view deleted', 'Saved search', filter.id, filter.name); Store.save(state); render(); return; }
  if (action === 'open-dashboard-customizer') { openModal('dashboard'); return; }
  if (action === 'toggle-dashboard-widget') { const key = target.dataset.widget; const current = new Set(state.dashboard || ['schedule', 'queue', 'followups', 'signals']); if (current.has(key) && current.size === 1) return notify('Keep at least one dashboard card enabled.', 'error'); if (current.has(key)) current.delete(key); else current.add(key); state.dashboard = [...current]; audit('Dashboard layout changed', 'Dashboard', '', `${key} ${current.has(key) ? 'enabled' : 'hidden'}`); Store.save(state); render(); return; }
  if (action === 'move-dashboard-widget') { const key = target.dataset.widget; const direction = target.dataset.direction; const layout = [...(state.dashboard || ['schedule', 'queue', 'followups', 'signals'])]; const index = layout.indexOf(key); const nextIndex = direction === 'up' ? index - 1 : index + 1; if (index < 0 || nextIndex < 0 || nextIndex >= layout.length) return; [layout[index], layout[nextIndex]] = [layout[nextIndex], layout[index]]; state.dashboard = layout; audit('Dashboard layout reordered', 'Dashboard', '', `${key} moved ${direction}`); Store.save(state); render(); return; }
  if (action === 'reset-dashboard-widgets') { state.dashboard = ['schedule', 'queue', 'followups', 'signals']; audit('Dashboard layout reset', 'Dashboard', '', 'Default operational cards restored'); Store.save(state); render(); return; }
  if (action === 'run-command') { const command = target.dataset.command || ''; closeModal(); runCommand(command); return; }
  if (action === 'open-notifications') { openModal('notifications'); return; }
  if (action === 'notification-open') { const note = notificationItems().find((item) => item.id === target.dataset.id); if (!note) return; const notificationPermissions = { patients: 'patients.view', billing: 'billing.view', queue: 'appointments.queue', inventory: 'inventory.view', clinical: 'clinical.view', backup: 'backup.create' }; if (note.page && notificationPermissions[note.page] && !requirePermission(notificationPermissions[note.page])) return; state.notificationRead = { ...(state.notificationRead || {}), [note.id]: true }; audit('Notification opened', 'Notification', note.id, note.title); Store.save(state); closeModal(); if (note.page === 'patients' && note.recordId) openPatientProfile(note.recordId); else if (note.page === 'billing' && note.recordId) { const invoice = byId(state.invoices, note.recordId); invoice ? openModal('invoice', { invoice }) : (ui.page = 'billing', render()); } else if (note.page === 'queue' && note.recordId) { const appointment = byId(state.appointments, note.recordId); appointment ? openModal('appointment', { appointment }) : (ui.page = 'queue', render()); } else if (note.page === 'inventory' && note.recordId) { const item = byId(state.inventory, note.recordId); item ? openModal('stock', { item }) : (ui.page = 'inventory', render()); } else if (note.page === 'clinical' && note.recordId) { const visit = byId(state.visits, note.recordId); if (visit) openPatientProfile(visit.patientId); else { ui.page = 'clinical'; render(); } } else { const page = ['queue', 'inventory', 'clinical', 'billing', 'backup'].includes(note.page) ? note.page : 'notifications'; ui.page = page; render(); } return; }
  if (action === 'open-audit-log') { openModal('auditLog'); return; }
  if (action === 'open-user-menu') { openModal('user'); return; }
  if (action === 'open-security') { if (!requirePermission('settings.edit')) return; openModal('security'); return; }
  if (action === 'lock-workspace') { lockWorkspace('Workspace locked by administrator'); return; }
  if (action === 'disable-lock') {
    if (!requirePermission('settings.edit')) return;
    if (!window.confirm('Disable the application lock for this workspace?')) return;
    state.settings.applicationLock = false;
    state.settings.pinHash = '';
    state.settings.pinSalt = '';
    audit('Application lock disabled', 'Security', '', 'Local administrator PIN removed');
    Store.save(state);
    closeModal();
    notify('Application lock disabled.');
    return;
  }
  if (action === 'close-modal' && (event.target === target || target === event.target.closest('[data-action="close-modal"]'))) { closeModal(); return; }
  if (action === 'close-toast') { ui.toast = null; render(); return; }
  if (action === 'open-setup') { openModal('setup', { step: 1 }); return; }
  if (action === 'choose-logo') { document.querySelector('#clinic-logo-file')?.click(); return; }
  if (action === 'remove-logo') { state.settings.logo = ''; audit('Clinic logo removed', 'Settings', '', 'Clinic logo removed'); Store.save(state); render(); notify('Clinic logo removed.'); return; }
  if (action === 'finish-setup') { closeModal(); notify('Workspace ready.'); return; }
  if (action === 'open-patient') { openModal('patient', {}); return; }
  if (action === 'open-appointment') { openModal('appointment', { patientId: target.dataset.patientId || '' }); return; }
  if (action === 'open-visit') { openModal('visit', { patientId: target.dataset.patientId || ui.patientId || '' }); return; }
  if (action === 'open-prescription') { openModal('prescription', { patientId: ui.patientId || '' }); return; }
  if (action === 'save-medication-template') { if (!requirePermission('prescriptions.create')) return; const form = target.closest('form'); const values = Object.fromEntries(new FormData(form).entries()); if (!String(values.medicine || '').trim()) return notify('Enter a medicine before saving it to the catalog.', 'error'); const template = { id: uid('medication'), name: String(values.medicine).trim(), strength: values.strength || '', dosage: values.dosage || '', frequency: values.frequency || '', duration: values.duration || '', route: values.route || 'Oral', instructions: values.instructions || '', active: true, updatedAt: now() }; state.medicationCatalog = [template, ...(state.medicationCatalog || []).filter((item) => item.name.toLowerCase() !== template.name.toLowerCase())].slice(0, 500); audit('Medication catalog updated', 'Medication', template.id, template.name); Store.save(state); notify('Medicine saved to the local catalog.'); return; }
  if (action === 'open-invoice') { openModal('invoice', { patientId: ui.patientId || '' }); return; }
  if (action === 'open-payment') { openModal('payment', { invoiceId: target.dataset.invoiceId || '', patientId: target.dataset.patientId || '' }); return; }
  if (action === 'refund-payment') { const payment = byId(state.payments, target.dataset.id); if (payment) openModal('refund', { payment }); return; }
  if (action === 'open-stock') { openModal('stock', {}); return; }
  if (action === 'open-stock-adjustment') { openModal('stockAdjustment', { itemId: target.dataset.id || '' }); return; }
  if (action === 'open-supplier') { openModal('supplier', {}); return; }
  if (action === 'open-staff') { openModal('staff', {}); return; }
  if (action === 'open-expense') { openModal('expense', {}); return; }
  if (action === 'open-treatment') { openModal('treatment', {}); return; }
  if (action === 'open-treatment-plan') { openModal('treatmentPlan', { patientId: target.dataset.patientId || ui.patientId || '' }); return; }
  if (action === 'edit-treatment-plan') { openModal('treatmentPlan', { plan: byId(state.treatmentPlans, target.dataset.id) }); return; }
  if (action === 'cycle-plan-stage') { if (!requirePermission('clinical.edit')) return; const plan = byId(state.treatmentPlans, target.dataset.id); const stage = plan?.stages?.[Number(target.dataset.stageIndex)]; if (!stage) return; const statuses = ['Planned', 'In progress', 'Completed', 'Deferred']; stage.status = statuses[(statuses.indexOf(stage.status || 'Planned') + 1) % statuses.length]; plan.updatedAt = now(); audit('Treatment plan stage updated', 'Treatment plan', plan.id, `${plan.title} · ${stage.title} · ${stage.status}`); Store.save(state); render(); return; }
  if (action === 'convert-treatment-plan') { if (!requirePermission('clinical.edit')) return; const plan = byId(state.treatmentPlans, target.dataset.id); if (!plan || !window.confirm('Record a clinical visit from this treatment plan? This creates a visit record only; no invoice or payment is created.')) return; const visit = { id: uid('visit'), visitCode: nextCode('visit', 'appointmentPrefix'), patientId: plan.patientId, date: today(), reason: `Treatment plan: ${plan.title}`, diagnosis: plan.goal || plan.diagnosis || '', treatmentPerformed: (plan.stages || []).filter((stage) => stage.status !== 'Deferred').map((stage) => stage.title).join(', '), notes: plan.notes || 'Created from a clinician-authored treatment plan.', createdAt: now(), updatedAt: now(), status: 'Completed' }; state.visits.push(visit); plan.status = plan.status === 'Draft' ? 'In Progress' : plan.status || 'In Progress'; plan.updatedAt = now(); const patient = byId(state.patients, plan.patientId); if (patient) patient.lastVisit = today(); audit('Treatment plan converted to visit', 'Treatment plan', plan.id, `${plan.title} · ${visit.visitCode}`); Store.save(state); notify('Clinical visit recorded from the treatment plan.'); render(); return; }
  if (action === 'edit-treatment') { openModal('treatment', { treatment: byId(state.treatments, target.dataset.id) }); return; }
  if (action === 'open-referral') { openModal('referral', { patientId: target.dataset.patientId || ui.patientId || '' }); return; }
  if (action === 'edit-referral') { openModal('referral', { referral: byId(state.referrals, target.dataset.id) }); return; }
  if (action === 'open-patient-profile') { openPatientProfile(target.dataset.id); return; }
  if (action === 'close-patient-profile') { ui.patientId = null; render(); return; }
  if (action === 'patient-tab') { const tab = target.dataset.tab || 'overview'; if (!requirePermission(permissionForPatientTab(tab))) return; ui.patientTab = tab; render(); return; }
  if (action === 'edit-patient') { openModal('patient', { patient: byId(state.patients, target.dataset.id) }); return; }
  if (action === 'edit-appointment') { openModal('appointment', { appointment: byId(state.appointments, target.dataset.id) }); return; }
  if (action === 'edit-visit') { openModal('visit', { visit: byId(state.visits, target.dataset.id) }); return; }
  if (action === 'edit-prescription') { openModal('prescription', { prescription: byId(state.prescriptions, target.dataset.id) }); return; }
  if (action === 'edit-stock') { openModal('stock', { item: byId(state.inventory, target.dataset.id) }); return; }
  if (action === 'edit-supplier') { openModal('supplier', { supplier: byId(state.suppliers, target.dataset.id) }); return; }
  if (action === 'edit-staff') { openModal('staff', { staff: byId(state.staff, target.dataset.id) }); return; }
  if (action === 'patient-page-prev') { ui.patientPage = Math.max(1, (ui.patientPage || 1) - 1); render(); return; }
  if (action === 'patient-page-next') { ui.patientPage = (ui.patientPage || 1) + 1; render(); return; }
  if (action === 'toggle-patient-filters') { ui.patientFilters = !ui.patientFilters; render(); return; }
  if (action === 'cycle-queue-status') { cycleQueueStatus(target.dataset.id); return; }
  if (action === 'select-tooth') { ui.dentalTooth = Number(target.dataset.tooth); render(); return; }
  if (action === 'set-dentition') { ui.dentition = target.dataset.dentition || 'adult'; ui.dentalTooth = null; render(); return; }
  if (action === 'close-tooth') { ui.dentalTooth = null; render(); return; }
  if (action === 'save-tooth') { saveTooth(); return; }
  if (action === 'remove-tooth') { removeTooth(); return; }
  if (action === 'set-appointment-view') { ui.appointmentView = target.dataset.view || 'month'; render(); return; }
  if (action === 'calendar-prev' || action === 'calendar-next') { const direction = action === 'calendar-prev' ? -1 : 1; const view = ui.appointmentView || 'month'; if (view === 'month') { ui.calendarMonth += direction; if (ui.calendarMonth < 0) { ui.calendarMonth = 11; ui.calendarYear -= 1; } if (ui.calendarMonth > 11) { ui.calendarMonth = 0; ui.calendarYear += 1; } } else { const current = new Date(`${ui.appointmentDate || today()}T00:00:00Z`); current.setUTCDate(current.getUTCDate() + direction * (view === 'week' ? 7 : 1)); ui.appointmentDate = localDateKey(current); ui.calendarMonth = current.getUTCMonth(); ui.calendarYear = current.getUTCFullYear(); } render(); return; }
  if (action === 'calendar-today') { const current = new Date(`${today()}T00:00:00Z`); ui.calendarMonth = current.getUTCMonth(); ui.calendarYear = current.getUTCFullYear(); ui.appointmentDate = today(); render(); return; }
  if (action === 'export-backup') { exportBackup(); return; }
  if (action === 'trigger-import') { document.querySelector('#backup-file')?.click(); return; }
  if (action === 'clear-restore') { ui.restoreCandidate = null; render(); return; }
  if (action === 'select-all-restore-patients') { if (ui.restoreCandidate?.data?.patients) { ui.restoreCandidate.patientScope = true; ui.restoreCandidate.selectedPatientIds = ui.restoreCandidate.data.patients.map((patient) => patient.id); } render(); return; }
  if (action === 'clear-restore-patients') { if (ui.restoreCandidate) { ui.restoreCandidate.patientScope = true; ui.restoreCandidate.selectedPatientIds = []; } render(); return; }
  if (action === 'restore-confirm') { restoreCandidate(); return; }
  if (action === 'integrity-check') { integrityCheck(); return; }
  if (action === 'import-patients') { document.querySelector('#patient-csv-file')?.click(); return; }
  if (action === 'csv-import-confirm') { importPatientsFromCsv(); return; }
  if (action === 'export-patients') { exportPatients(); return; }
  if (action === 'export-visits') { downloadCsv(active(state.visits).map((v) => ({ Visit: v.visitCode, Date: v.date, Patient: patientName(v.patientId), Reason: v.reason || '', Diagnosis: v.diagnosis || '', Treatment: v.treatmentPerformed || '', FollowUp: v.followUpDate || '' })), 'dentiva-visits.csv'); return; }
  if (action === 'export-inventory') { downloadCsv(active(state.inventory).map((i) => ({ ItemCode: i.itemCode || '', Item: i.name, Category: i.category || '', Supplier: byId(state.suppliers, i.supplierId)?.name || '', CurrentStock: i.currentStock, Unit: i.unit || '', MinimumStock: i.minimumStock || 0, ExpiryDate: i.expiryDate || '' })), 'dentiva-inventory.csv'); return; }
  if (action === 'export-report') { exportReport(); return; }
  if (action === 'save-settings') { saveSettings(); return; }
  if (action === 'mark-notifications-read') { state.notifications.forEach((n) => { n.read = true; }); state.notificationRead = Object.fromEntries(notificationItems().map((item) => [item.id, true])); audit('Notifications marked read', 'Notifications', '', 'Notification centre cleared'); Store.save(state); if (ui.modal) closeModal(); else render(); return; }
  if (action === 'dismiss-notification') { if (!requirePermission('notifications.manage')) return; state.notifications = state.notifications.filter((notification) => notification.id !== target.dataset.id); audit('Notification dismissed', 'Notification', target.dataset.id, 'Notification removed from the centre'); Store.save(state); render(); return; }
  if (action === 'search-result') { const kind = target.dataset.kind; const id = target.dataset.id; closeModal(); if (kind === 'patient') openPatientProfile(id); else if (kind === 'appointment') { ui.page = 'appointments'; openModal('appointment', { appointment: byId(state.appointments, id) }); } else if (kind === 'invoice') { ui.page = 'billing'; render(); } else if (kind === 'inventory') { ui.page = 'inventory'; render(); } else if (kind === 'supplier') { ui.page = 'suppliers'; render(); } else if (kind === 'staff') { ui.page = 'staff'; render(); } else if (kind === 'visit') { const visit = byId(state.visits, id); if (visit) openPatientProfile(visit.patientId); } return; }
  if (action === 'attach-file') { document.querySelector('#patient-attachment-file')?.click(); return; }
  if (action === 'open-attachment') { const attachment = byId(state.attachments, target.dataset.id); if (attachment) { audit('Attachment previewed', 'Attachment', attachment.id, attachment.name); Store.save(state); openModal('attachmentPreview', { attachment }); } return; }
  if (action === 'edit-attachment') { const attachment = byId(state.attachments, target.dataset.id); if (attachment) openModal('attachment', { attachment }); return; }
  if (action === 'download-attachment') { downloadAttachment(target.dataset.id); return; }
  if (action === 'delete-attachment') { deleteAttachment(target.dataset.id); return; }
  if (action === 'print-expense') { printExpense(target.dataset.id); return; }
  if (action === 'print-queue') { printQueue(); return; }
  if (action === 'print-billing') { printBilling(); return; }
  if (action === 'print-invoice') { printInvoice(target.dataset.id); return; }
  if (action === 'print-payment') { printPayment(target.dataset.id); return; }
  if (action === 'print-prescription') { printPrescription(target.dataset.id); return; }
  if (action === 'print-patient') { printPatient(target.dataset.id); return; }
  if (action === 'print-patient-statement') { printPatientStatement(target.dataset.id); return; }
  if (action === 'print-dental-chart') { printDental(); return; }
  if (action === 'print-report') { printReport(false); return; }
  if (action === 'export-report-pdf') { printReport(true); return; }
}
function handleInput(event) {
  const input = event.target;
  if (input.dataset.input === 'audit-search') { ui.auditQuery = input.value; render(); window.setTimeout(() => document.querySelector('[data-input="audit-search"]')?.focus(), 0); return; }
  if (input.dataset.input === 'global-search' || input.dataset.input === 'modal-search') {
    ui.search = input.value;
    if (ui.page === 'patients') ui.patientPage = 1;
    if (ui.modal?.type === 'search' || ui.page === 'patients' || ui.page === 'clinical') {
      const selector = `[data-input="${input.dataset.input}"]`;
      render();
      window.setTimeout(() => { const next = document.querySelector(selector); if (next) { next.focus(); next.setSelectionRange(ui.search.length, ui.search.length); } }, 0);
    }
  }
  if (input.dataset.input === 'tooth-note' && ui.dentalTooth) ui.toothNote = input.value;
}
function handleChange(event) {
  const el = event.target;
  if (el.dataset.change === 'dashboard-range') { ui.range = el.value; if (el.value === 'custom' && !ui.rangeFrom) ui.rangeFrom = today(); if (el.value === 'custom' && !ui.rangeTo) ui.rangeTo = today(); render(); }
  if (el.dataset.change === 'dashboard-range-from') { ui.rangeFrom = el.value; render(); }
  if (el.dataset.change === 'dashboard-range-to') { ui.rangeTo = el.value; render(); }
  if (el.dataset.change === 'analytics-range') { ui.analyticsRange = el.value; render(); }
  if (el.dataset.change === 'patient-status-filter') { ui.patientStatusFilter = el.value; render(); }
  if (el.dataset.change === 'patient-date-from') { ui.patientDateFrom = el.value; render(); }
  if (el.dataset.change === 'patient-date-to') { ui.patientDateTo = el.value; render(); }
  if (el.dataset.change === 'patient-tooth-status') { ui.patientToothStatus = el.value; render(); }
  if (el.dataset.change === 'patient-balance') { ui.patientBalanceFilter = el.value; render(); }
  if (el.dataset.change === 'dental-patient') { ui.dentalPatientId = el.value; ui.dentalTooth = null; render(); }
  if (el.dataset.change === 'tooth-status') { ui.toothStatus = el.value; }
  if (el.dataset.change === 'prescription-template') { const medication = byId(state.medicationCatalog || [], el.value); if (medication) { const form = el.closest('form'); ['medicine', 'strength', 'dosage', 'frequency', 'duration', 'route', 'instructions'].forEach((name) => { const input = form?.elements?.namedItem(name); if (input) input.value = medication[name] || ''; }); } }
  if (el.dataset.change === 'report-type') { ui.reportType = el.value; render(); }
  if (el.dataset.change === 'report-range') { ui.reportsRange = el.value; render(); }
  if (el.dataset.change === 'report-from') { ui.reportFrom = el.value; render(); }
  if (el.dataset.change === 'report-to') { ui.reportTo = el.value; render(); }
  if (el.dataset.change === 'csv-map' && ui.csvImport) { ui.csvImport.mapping[el.dataset.field] = el.value; render(); return; }
  if (el.dataset.change === 'csv-strategy' && ui.csvImport) { ui.csvImport.strategy = el.value; render(); return; }
  if (el.dataset.change === 'restore-strategy') { if (ui.restoreCandidate) ui.restoreCandidate.strategy = el.value; }
  if (el.dataset.change === 'restore-patients' || el.dataset.change === 'restore-clinical' || el.dataset.change === 'restore-finance' || el.dataset.change === 'restore-operations' || el.dataset.change === 'restore-settings') { if (ui.restoreCandidate) ui.restoreCandidate[el.dataset.change] = el.checked; }
  if (el.dataset.change === 'restore-patient' && ui.restoreCandidate) {
    const selected = new Set(ui.restoreCandidate.selectedPatientIds || []);
    ui.restoreCandidate.patientScope = true;
    if (el.checked) selected.add(el.value); else selected.delete(el.value);
    ui.restoreCandidate.selectedPatientIds = [...selected];
  }
  if (el.id === 'invoice-modal-total') return;
}
function handleKeydown(event) {
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') { event.preventDefault(); openModal('search'); }
  if (event.key === 'Escape' && ui.modal) closeModal();
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'n') { event.preventDefault(); openModal('patient'); }
}
function cycleQueueStatus(id) { if (!requirePermission('appointments.queue')) return; const a = byId(state.appointments, id); if (!a) return; const statuses = ['Scheduled', 'Checked In', 'Waiting', 'In Treatment', 'Completed']; const next = statuses[(statuses.indexOf(a.status || 'Scheduled') + 1) % statuses.length]; a.status = next; if (next === 'Checked In' && !a.checkedInAt) a.checkedInAt = now(); if (next === 'Waiting' && !a.checkedInAt) a.checkedInAt = now(); if (next === 'In Treatment') a.startedAt = now(); if (next === 'Completed') a.completedAt = now(); audit('Appointment status changed', 'Appointment', a.id, `${patientName(a.patientId)} · ${next}`); Store.save(state); notify(`Queue updated: ${next}.`); }
function saveTooth() { if (!requirePermission('clinical.edit')) return; const patient = byId(state.patients, ui.dentalPatientId); if (!patient || !ui.dentalTooth) return notify('Choose a patient and tooth first.', 'error'); const status = ui.toothStatus ?? state.dentalRecords.find((r) => r.patientId === patient.id && Number(r.tooth) === Number(ui.dentalTooth))?.status ?? ''; const note = ui.toothNote ?? state.dentalRecords.find((r) => r.patientId === patient.id && Number(r.tooth) === Number(ui.dentalTooth))?.note ?? ''; const existing = state.dentalRecords.find((r) => r.patientId === patient.id && Number(r.tooth) === Number(ui.dentalTooth)); if (!status && !note) { if (existing) state.dentalRecords = state.dentalRecords.filter((r) => r.id !== existing.id); } else if (existing) Object.assign(existing, { status, note, updatedAt: now() }); else state.dentalRecords.push({ id: uid('tooth'), patientId: patient.id, tooth: ui.dentalTooth, status, note, updatedAt: now(), createdAt: now() }); audit('Dental chart updated', 'Dental record', patient.id, `Tooth ${ui.dentalTooth}`); ui.toothStatus = undefined; ui.toothNote = undefined; Store.save(state); notify(`Tooth ${ui.dentalTooth} record saved.`); }
function removeTooth() { if (!requirePermission('clinical.edit')) return; const patient = byId(state.patients, ui.dentalPatientId); const record = state.dentalRecords.find((r) => r.patientId === patient?.id && Number(r.tooth) === Number(ui.dentalTooth)); if (!record) return; state.dentalRecords = state.dentalRecords.filter((r) => r.id !== record.id); audit('Dental chart record removed', 'Dental record', record.id, `Tooth ${ui.dentalTooth}`); ui.dentalTooth = null; Store.save(state); notify('Tooth record removed.'); }

async function exportBackup() {
  if (!requirePermission('backup.create')) return;
  state.lastBackupAt = now();
  audit('Backup created', 'Backup', '', `${totalRecords()} records exported`);
  Store.save(state);
  const data = deepClone(state);
  const manifest = buildBackupManifest(data, APP_VERSION, [...arrayKeys, 'settings', 'counters', 'dashboard', 'notificationRead']);
  manifest.exportedAt = now();
  manifest.payloadHash = await sha256Hex(canonicalJson(data));
  manifest.integrity = 'SHA-256 over canonical backup data';
  const backup = { manifest, data };
  jsonDownload(backup, `dentiva-pro-backup-${today()}.dentiva.json`);
  notify('Backup exported with a SHA-256 integrity hash.');
}

async function restoreCandidate() {
  if (!requirePermission('backup.restore')) return;
  const c = ui.restoreCandidate;
  if (!c?.data) return;
  const source = deepClone(c.data);
  const strategy = c.strategy || 'Keep Existing';
  const modules = [];
  if (c.restorePatients !== false) modules.push('patients');
  if (c.restoreClinical !== false) modules.push('clinical');
  if (c.restoreFinance !== false) modules.push('finance');
  if (c.restoreOperations !== false) modules.push('operations');
  if (c.restoreSettings !== false) modules.push('settings');
  const validation = validateBackupPayload(source, arrayKeys);
  if (validation.errors.length) return notify(`Restore blocked: ${validation.errors[0]}`, 'error');
  if (c.patientScope && !(c.selectedPatientIds || []).length) return notify('Select at least one patient or turn off patient-scoped restore.', 'error');
  const patientIds = c.patientScope ? c.selectedPatientIds : [];
  const plan = buildRestorePlan(state, source, { modules, strategy, patientIds });
  if (plan.errors.length) return notify(`Restore blocked: ${plan.errors[0]}`, 'error');
  const before = deepClone(state);
  try {
    const applied = applyRestorePlan(state, plan);
    const candidateState = migrateState({ ...applied.state, schemaVersion: CURRENT_SCHEMA_VERSION, appVersion: APP_VERSION, updatedAt: now() });
    const relationshipErrors = validateRelationships(candidateState, arrayKeys);
    if (relationshipErrors.length) throw new Error(`relationship validation failed: ${relationshipErrors[0]}`);
    Object.keys(state).forEach((key) => { delete state[key]; });
    Object.assign(state, candidateState);
    audit('Backup restored', 'Backup', '', `${applied.added} records restored, ${applied.skipped} skipped, ${applied.replaced} replaced`);
    if (!Store.save(state)) throw new Error('local persistence rejected the restored state');
    ui.restoreCandidate = null;
    notify(`Restore complete: ${applied.added} added, ${applied.skipped} skipped, ${applied.replaced} replaced.`);
  } catch (error) {
    Object.keys(state).forEach((key) => { delete state[key]; });
    Object.assign(state, before);
    render();
    notify(`Restore rolled back: ${error.message}`, 'error');
  }
}

function integrityCheck() { if (!can('diagnostics.view') && !can('backup.validate')) return notify('Your account is not allowed to run diagnostics.', 'error'); const errors = [...validateRelationships(state)]; active(state.attachments).forEach((attachment) => { if (!validateAttachmentFile(attachment).allowed) errors.push(`Attachment ${attachment.name || attachment.id} metadata`); }); active(state.invoices).forEach((invoice) => { const expected = invoicePaymentStatus(invoice); if (Math.abs(expected.paid - Number(invoice.paid || 0)) > 0.01 || Math.abs(expected.due - Number(invoice.due || 0)) > 0.01) errors.push(`Invoice ${invoice.invoiceNumber} payment totals`); }); audit('Integrity check completed', 'Database', '', `${totalRecords()} records checked · ${errors.length} issue(s)`); Store.save(state); if (errors.length) notify(`${errors.length} integrity issue${errors.length > 1 ? 's' : ''} found. Review Diagnostics.`, 'error'); else notify(`${totalRecords()} records checked. Database is healthy.`); }

function openAttachment(id) {
  const attachment = byId(state.attachments, id);
  if (!attachment?.data) return notify('This attachment has no readable file data.', 'error');
  const opened = window.open(attachment.data, '_blank', 'noopener,noreferrer');
  if (!opened) notify('Allow pop-ups to preview this attachment.', 'error');
  audit('Attachment previewed', 'Attachment', id, attachment.name);
  Store.save(state);
}
function downloadAttachment(id) { if (!requirePermission('clinical.view')) return; const attachment = byId(state.attachments, id); if (!attachment) return; const link = document.createElement('a'); link.href = attachment.data; link.download = attachment.name; link.click(); audit('Attachment exported', 'Attachment', id, attachment.name); Store.save(state); }
function deleteAttachment(id) { if (!requirePermission('clinical.edit')) return; const attachment = byId(state.attachments, id); if (!attachment) return; if (!window.confirm(`Remove ${attachment.name} from this patient record? This cannot be undone unless it exists in a backup.`)) return; state.attachments = state.attachments.filter((a) => a.id !== id); audit('Attachment deleted', 'Attachment', id, attachment.name); Store.save(state); notify('Attachment removed.'); }
function importPatientsFromCsv() {
  if (!requirePermission('patients.create')) return;
  const importState = ui.csvImport;
  if (!importState) return;
  const fields = ['fullName', 'phone', 'email', 'dateOfBirth', 'gender', 'address', 'allergies', 'notes'];
  const rows = importState.rows.map((row) => Object.fromEntries(fields.map((field) => [field, row[importState.mapping[field]] || '']))).filter((row) => String(row.fullName || '').trim() && String(row.phone || '').trim());
  const before = deepClone(state);
  try {
    let added = 0; let skipped = 0;
    rows.forEach((row) => {
      const duplicate = active(state.patients).find((patient) => patient.fullName?.trim().toLowerCase() === row.fullName.trim().toLowerCase() && patient.phone?.replace(/\D/g, '') === row.phone.replace(/\D/g, ''));
      if (duplicate && importState.strategy !== 'Create New Copy') { skipped += 1; return; }
      const record = makePatient({ ...row, fullName: row.fullName.trim(), phone: row.phone.trim(), status: 'Active' }, false);
      state.patients.push(record); added += 1;
    });
    audit('Patient CSV imported', 'Patient import', '', `${added} added, ${skipped} duplicate rows skipped`);
    if (!Store.save(state)) throw new Error('local persistence rejected the import');
    ui.csvImport = null; closeModal(); notify(`Patient import complete: ${added} added, ${skipped} duplicate${skipped === 1 ? '' : 's'} skipped.`);
  } catch (error) {
    Object.keys(state).forEach((key) => { delete state[key]; }); Object.assign(state, before); render(); notify(`Patient CSV import rolled back: ${error.message}`, 'error');
  }
}
function printExpense(id) { const expense = byId(state.expenses, id); if (!expense) return; printHtml('Expense record', `<div class="summary"><div><span class="muted">Date</span><strong>${date(expense.date)}</strong></div><div><span class="muted">Category</span><strong>${esc(expense.category || 'Other')}</strong></div><div><span class="muted">Amount</span><strong>${currency(expense.amount)}</strong></div></div><table class="print-table"><tbody><tr><th>Description</th><td>${esc(expense.description)}</td></tr><tr><th>Payment method</th><td>${esc(expense.method || '—')}</td></tr><tr><th>Reference</th><td>${esc(expense.reference || '—')}</td></tr><tr><th>Notes</th><td>${esc(expense.notes || '—')}</td></tr></tbody></table>`); }

function printQueue() { const queue = active(state.appointments).filter((a) => a.date === today()).sort((a, b) => (a.time || '').localeCompare(b.time || '')); printHtml('Today’s Queue', `<div class="summary"><div><span class="muted">Date</span><strong>${date(today())}</strong></div><div><span class="muted">Appointments</span><strong>${queue.length}</strong></div></div>${queue.length ? `<table class="print-table"><thead><tr><th>Serial</th><th>Time</th><th>Patient</th><th>Reason</th><th>Chair</th><th>Status</th></tr></thead><tbody>${queue.map((a, i) => `<tr><td>${esc(a.serial || `${state.settings.serialPrefix}-${String(i + 1).padStart(3, '0')}`)}</td><td>${time(a.time)}</td><td>${esc(patientName(a.patientId))}</td><td>${esc(a.reason || '—')}</td><td>${esc(a.chair || 'Chair 1')}</td><td>${esc(a.status || 'Scheduled')}</td></tr>`).join('')}</tbody></table>` : '<p>No appointments scheduled today.</p>'}`); }
function printBilling() { const invoices = active(state.invoices); printHtml('Billing statement', `<div class="summary"><div><span class="muted">Total billed</span><strong>${currency(sum(invoices, (i) => i.total))}</strong></div><div><span class="muted">Collected</span><strong>${currency(sum(active(state.payments), paymentAmount))}</strong></div><div><span class="muted">Outstanding</span><strong>${currency(sum(invoices, (i) => invoicePaymentStatus(i).due))}</strong></div></div>${invoices.length ? `<table class="print-table"><thead><tr><th>Invoice</th><th>Patient</th><th>Date</th><th>Total</th><th>Paid</th><th>Due</th></tr></thead><tbody>${invoices.map((i) => { const paymentState = invoicePaymentStatus(i); return `<tr><td>${esc(i.invoiceNumber)}</td><td>${esc(patientName(i.patientId))}</td><td>${date(i.date)}</td><td>${currency(i.total)}</td><td>${currency(paymentState.paid)}</td><td>${currency(paymentState.due)}</td></tr>`; }).join('')}</tbody></table>` : '<p>No invoices created.</p>'}`); }
function printInvoice(id) { const i = byId(state.invoices, id); if (!i) return; printHtml(`Invoice ${i.invoiceNumber}`, `<div class="summary"><div><span class="muted">Patient</span><strong>${esc(patientName(i.patientId))}</strong></div><div><span class="muted">Invoice date</span><strong>${date(i.date)}</strong></div><div><span class="muted">Status</span><strong>${esc(i.status)}</strong></div></div><table class="print-table"><thead><tr><th>Item</th><th>Qty</th><th>Unit price</th><th>Total</th></tr></thead><tbody>${(i.items || []).map((item) => `<tr><td>${esc(item.name)}</td><td>${item.quantity}</td><td>${currency(item.unitPrice)}</td><td>${currency(item.total)}</td></tr>`).join('')}</tbody></table><div class="summary right" style="justify-content:flex-end"><div><span class="muted">Subtotal</span><strong>${currency(i.subtotal)}</strong></div><div><span class="muted">Discount</span><strong>${currency(i.discount)}</strong></div><div><span class="muted">Total due</span><strong>${currency(i.total)}</strong></div></div>`); }
function printPayment(id) { const p = byId(state.payments, id); if (!p) return; printHtml(`Money receipt ${p.receiptNumber}`, `<div class="summary"><div><span class="muted">Receipt</span><strong>${esc(p.receiptNumber)}</strong></div><div><span class="muted">Patient</span><strong>${esc(patientName(p.patientId))}</strong></div><div><span class="muted">Date</span><strong>${date(p.date)}</strong></div></div><h2>Received</h2><p style="font-size:24px;font-weight:700">${currency(paymentAmount(p))}</p>${paymentRefundedAmount(p) ? `<p>Refunded / reversed: ${currency(paymentRefundedAmount(p))}</p>` : ''}<p>Payment method: <b>${esc(p.method || '—')}</b><br>Reference: ${esc(p.reference || '—')}<br>Status: ${esc(p.status || 'Recorded')}</p>`, 'Receipt'); }
function printPrescription(id) { const p = byId(state.prescriptions, id); if (!p) return; printHtml(`Prescription ${p.prescriptionCode}`, `<div class="summary"><div><span class="muted">Patient</span><strong>${esc(patientName(p.patientId))}</strong></div><div><span class="muted">Date</span><strong>${date(p.date)}</strong></div><div><span class="muted">Prescriber</span><strong>${esc(p.doctor)}</strong></div></div><table class="print-table"><thead><tr><th>Medicine</th><th>Dosage</th><th>Frequency</th><th>Duration</th><th>Instructions</th></tr></thead><tbody>${(p.medications || []).map((m) => `<tr><td>${esc(m.medicine)}<br>${esc(m.strength || '')}</td><td>${esc(m.dosage || '—')}</td><td>${esc(m.frequency || '—')}</td><td>${esc(m.duration || '—')}</td><td>${esc(m.instructions || '—')}</td></tr>`).join('')}</tbody></table><p style="margin-top:40px">${esc(p.notes || '')}</p>`); }
function printPatient(id) { const p = byId(state.patients, id); if (!p) return; const visits = active(state.visits).filter((v) => v.patientId === id); printHtml(`Patient summary — ${p.fullName}`, `<div class="summary"><div><span class="muted">Patient code</span><strong>${esc(p.patientCode)}</strong></div><div><span class="muted">Phone</span><strong>${esc(p.phone || '—')}</strong></div><div><span class="muted">Registration</span><strong>${date(p.registrationDate)}</strong></div></div><h2>Patient details</h2><table class="print-table"><tbody><tr><th>Date of birth</th><td>${date(p.dateOfBirth)}</td><th>Gender</th><td>${esc(p.gender || '—')}</td></tr><tr><th>Allergies</th><td>${esc(p.allergies || 'None recorded')}</td><th>Blood group</th><td>${esc(p.bloodGroup || '—')}</td></tr><tr><th>Address</th><td colspan="3">${esc(p.address || '—')}</td></tr></tbody></table><h2>Visit history</h2>${visits.length ? `<table class="print-table"><thead><tr><th>Date</th><th>Reason</th><th>Diagnosis</th><th>Treatment</th></tr></thead><tbody>${visits.map((v) => `<tr><td>${date(v.date)}</td><td>${esc(v.reason || '—')}</td><td>${esc(v.diagnosis || '—')}</td><td>${esc(v.treatmentPerformed || '—')}</td></tr>`).join('')}</tbody></table>` : '<p>No visits recorded.</p>'}`); }
function printPatientStatement(id) {
  const p = byId(state.patients, id);
  if (!p) return;
  const entries = statementEntries({ invoices: active(state.invoices), payments: active(state.payments), adjustments: active(state.paymentAdjustments || []) }, id);
  const balance = entries.at(-1)?.balance || 0;
  printHtml(`Financial statement — ${p.fullName}`, `<div class="summary"><div><span class="muted">Patient</span><strong>${esc(p.fullName)}</strong></div><div><span class="muted">Patient code</span><strong>${esc(p.patientCode || '—')}</strong></div><div><span class="muted">Balance</span><strong>${currency(balance)}</strong></div></div>${entries.length ? `<table class="print-table"><thead><tr><th>Date</th><th>Type</th><th>Reference</th><th>Debit</th><th>Credit</th><th>Balance</th><th>Note</th></tr></thead><tbody>${entries.map((entry) => `<tr><td>${date(entry.date)}</td><td>${esc(entry.type)}</td><td>${esc(entry.reference)}</td><td>${entry.debit ? currency(entry.debit) : '—'}</td><td>${entry.credit ? currency(entry.credit) : '—'}</td><td>${currency(entry.balance)}</td><td>${esc(entry.note)}</td></tr>`).join('')}</tbody></table>` : '<p>No financial activity recorded.</p>'}`);
}
function printDental() { const p = byId(state.patients, ui.dentalPatientId); if (!p) return notify('Choose a patient before printing the chart.', 'error'); const records = state.dentalRecords.filter((r) => r.patientId === p.id); printHtml(`Dental chart — ${p.fullName}`, `<p>FDI adult dentition record.</p><table class="print-table"><thead><tr><th>Tooth</th><th>Status</th><th>Note</th><th>Updated</th></tr></thead><tbody>${records.length ? records.map((r) => `<tr><td>${r.tooth}</td><td>${esc(r.status || '—')}</td><td>${esc(r.note || '—')}</td><td>${date(r.updatedAt?.slice(0, 10))}</td></tr>`).join('') : '<tr><td colspan="4">No tooth records.</td></tr>'}</tbody></table>`); }
function printReport(asPdf = false) { const r = buildReport(ui.reportType, ui.reportsRange); const content = `<div class="summary">${r.kpis.map((k) => `<div><span class="muted">${esc(k.label)}</span><strong>${esc(k.value)}</strong></div>`).join('')}</div>${r.body.replaceAll('data-table', 'print-table')}`; if (asPdf) exportPdf(r.title, content); else printHtml(r.title, content); }

function render() { app.innerHTML = state.unsupportedSchema ? unsupportedSchemaScreen() : (requiresLogin() ? authScreen() : (ui.locked ? lockScreen() : shell())); translateDom(); document.title = `${requiresLogin() ? 'Sign in' : ui.locked ? 'Workspace locked' : pageTitle()} · Dentiva Pro`; if (!ui.locked && !requiresLogin()) resetActivityTimer(); }

document.addEventListener('click', (event) => { recordActivity(); handleClick(event); });
document.addEventListener('pointerdown', recordActivity, { passive: true });
document.addEventListener('keydown', recordActivity, { passive: true });
document.addEventListener('submit', handleSubmit);
document.addEventListener('input', handleInput);
document.addEventListener('change', handleChange);
document.addEventListener('keydown', handleKeydown);
window.addEventListener('error', (event) => { console.error(event.error || event.message); });

// File import listener is delegated because the input is re-created with the Backup page.
document.addEventListener('change', (event) => {
  if (event.target.dataset.input === 'clinic-logo-file') {
    const file = event.target.files?.[0];
    if (!file) return;
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type) || file.size > 1024 * 1024) return notify('Clinic logos must be PNG, JPEG or WebP files up to 1 MB.', 'error');
    const reader = new FileReader();
    reader.onload = () => { state.settings.logo = String(reader.result); audit('Clinic logo updated', 'Settings', '', file.name); Store.save(state); render(); notify('Clinic logo updated.'); };
    reader.readAsDataURL(file);
    return;
  }
  if (event.target.dataset.input === 'patient-csv-file') {
    if (!requirePermission('patients.create')) return;
    const file = event.target.files?.[0]; if (!file) return;
    if (file.size > 10 * 1024 * 1024) return notify('CSV imports are limited to 10 MB.', 'error');
    const reader = new FileReader(); reader.onload = () => { const parsed = parseCsv(String(reader.result || '')); if (!parsed.headers.length || !parsed.rows.length) return notify('The CSV needs a header row and at least one data row.', 'error'); const normalized = Object.fromEntries(parsed.headers.map((header) => [header.toLowerCase().replace(/[^a-z0-9]+/g, ''), header])); const pick = (names) => names.map((name) => normalized[name]).find(Boolean) || ''; ui.csvImport = { fileName: file.name, headers: parsed.headers, rows: parsed.rows, strategy: 'Skip', mapping: { fullName: pick(['fullname', 'name', 'patientname']), phone: pick(['phone', 'mobile', 'phonenumber']), email: pick(['email', 'emailaddress']), dateOfBirth: pick(['dateofbirth', 'dob', 'birthdate']), gender: pick(['gender', 'sex']), address: pick(['address', 'location']), allergies: pick(['allergies', 'allergy']), notes: pick(['notes', 'note']) } }; openModal('csvImport'); }; reader.readAsText(file); return;
  }
  if (event.target.dataset.input === 'patient-attachment-file') {
    const file = event.target.files?.[0]; if (!file) return;
    const attachmentValidation = validateAttachmentFile(file);
    if (!attachmentValidation.allowedTypes.includes(file.type)) { notify('This file type is not allowed for clinical attachments.', 'error'); return; }
    if (file.size > attachmentValidation.maxBytes) { notify('Attachments are limited to 6 MB to protect local storage.', 'error'); return; }
    const reader = new FileReader(); reader.onload = () => { const patient = byId(state.patients, ui.patientId); if (!patient) return; const safe = validateAttachmentFile({ type: file.type, size: file.size, name: file.name }); ui.pendingAttachment = { patientId: patient.id, name: safe.safeName, type: file.type, size: file.size, data: reader.result, category: file.type === 'application/pdf' ? 'PDF report' : file.type.startsWith('image/') ? 'Image / X-ray' : 'Clinical document' }; openModal('attachment', ui.pendingAttachment); };
    reader.readAsDataURL(file); return;
  }
  if (event.target.dataset.input !== 'backup-file') return;
  const file = event.target.files?.[0]; if (!file) return;
  const reader = new FileReader(); reader.onload = async () => {
    try {
      const parsed = JSON.parse(reader.result);
      const validation = validateBackupPayload(parsed, arrayKeys);
      const source = validation.data;
      const counts = Object.fromEntries(arrayKeys.map((key) => [key, Array.isArray(source[key]) ? source[key].length : 0]));
      const conflicts = arrayKeys.reduce((total, key) => total + (Array.isArray(source[key]) ? source[key].filter((record) => record.id && state[key].some((existing) => existing.id === record.id)).length : 0), 0);
      const warnings = [...validation.warnings];
      const errors = [...validation.errors];
      if (parsed.manifest?.payloadHash) {
        const actualHash = await sha256Hex(canonicalJson(source));
        if (actualHash !== parsed.manifest.payloadHash) errors.push('SHA-256 integrity check failed: the backup data does not match its manifest.');
      } else warnings.push('This backup has no payload hash; structural and relationship checks were still performed.');
      ui.restoreCandidate = { name: file.name, product: parsed.manifest?.product || 'Dentiva Pro / legacy export', schemaVersion: parsed.manifest?.schemaVersion || source.schemaVersion || '?', total: Object.values(counts).reduce((a, b) => a + b, 0), counts, conflicts, errors, warnings, data: source, strategy: 'Keep Existing', restorePatients: true, restoreClinical: true, restoreFinance: true, restoreOperations: true, restoreSettings: true, selectedPatientIds: [], patientScope: false };
      render();
      if (errors.length) notify(`Backup validation found ${errors.length} issue${errors.length === 1 ? '' : 's'}; restore will remain blocked.`, 'error'); else notify('Backup validated. Review the import preview before restoring.');
    } catch (error) { notify('This file could not be read as a Dentiva Pro backup.', 'error'); }
  }; reader.readAsText(file);
});

if ('serviceWorker' in navigator && location.protocol.startsWith('http')) navigator.serviceWorker.register('/sw.js').catch(() => {});
render();
try {
  if (!state.setupComplete && !sessionStorage.getItem('dentiva-pro.setup-prompted')) {
    sessionStorage.setItem('dentiva-pro.setup-prompted', '1');
    openModal('setup', { step: 1 });
  }
} catch { /* session storage can be unavailable in restricted previews */ }
