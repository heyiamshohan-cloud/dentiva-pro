// Shared workspace-state normalization used by the Electron main-process migration,
// the browser fallback adapter and the automated tests. Keeping DEFAULT_STATE and
// migrateState here guarantees one authoritative shape for settings, counters and
// collections across every runtime (single source of truth, no competing defaults).

import { ARRAY_COLLECTIONS, CURRENT_SCHEMA_VERSION } from './core.js';
import { normalizeNotificationRules } from './notifications.js';

export const APP_VERSION = '1.4.0';

export const DEFAULT_SETTINGS = {
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
  receiptPrefix: 'RCP',
  defaultDuration: 30,
  taxEnabled: false,
  taxRate: 0,
  notificationRules: normalizeNotificationRules(null),
  autoLockMinutes: 30,
  sessionTimeoutMinutes: 30,
  notifications: true,
  applicationLock: false,
  pinHash: '',
  pinSalt: '',
  paymentMethods: ['Cash', 'Bank', 'Card', 'bKash', 'Nagad', 'Rocket', 'Upay'],
  expenseCategories: ['Clinic rent', 'Electricity', 'Internet', 'Water', 'Staff salary', 'Cleaning', 'Maintenance', 'Equipment', 'Supplies', 'Marketing', 'Transport', 'Other'],
  inventoryCategories: ['Medicine', 'Dental material', 'Consumable', 'Accessory', 'Equipment consumable', 'Other'],
  chairs: ['Chair 1', 'Chair 2'],
  rooms: ['Room 1'],
  backupEnabled: true,
  backupIntervalHours: 24,
  backupRetention: 10,
  backupDirectory: '',
  lowStockThreshold: 5,
  // Attachment ceiling is a configurable, resource-aware guard — not a product data limit.
  // It protects a single import from exceeding free disk space; raise it freely (§40).
  attachmentMaxMb: 256,
  accent: 'teal',
  density: 'comfortable',
  printPageSize: 'A4',
  paperProfile: 'A4',
  customPatientFields: [],
  medicationTemplates: [],
  documentTemplate: { showLogo: true, showClinicContact: true, footer: 'Thank you for choosing our practice.' }
};

export function defaultState(nowIso = new Date().toISOString()) {
  const state = {
    schemaVersion: CURRENT_SCHEMA_VERSION,
    appVersion: APP_VERSION,
    createdAt: nowIso,
    updatedAt: nowIso,
    setupComplete: false,
    settings: { ...DEFAULT_SETTINGS, documentTemplate: { ...DEFAULT_SETTINGS.documentTemplate } },
    counters: { patient: 1, appointment: 1, invoice: 1, visit: 1, prescription: 1, receipt: 1, serial: 1, staff: 1 },
    dashboard: ['schedule', 'queue', 'followups', 'signals'],
    navigation: { favorites: [], recent: [] },
    notificationRead: {},
    lastBackupAt: null
  };
  ARRAY_COLLECTIONS.forEach((key) => { state[key] = []; });
  state.notificationRules = [
    { id: 'rule_queue', kind: 'queue', enabled: true },
    { id: 'rule_clinical', kind: 'clinical', enabled: true },
    { id: 'rule_inventory', kind: 'inventory', enabled: true },
    { id: 'rule_warning', kind: 'warning', enabled: true },
    { id: 'rule_backup', kind: 'backup', enabled: true }
  ];
  state.rooms = [{ id: 'room_default', name: 'Room 1', active: true }];
  return state;
}

function normalizeCustomFields(fields) {
  return (Array.isArray(fields) ? fields : []).map((definition) => {
    const label = typeof definition === 'string' ? definition : String(definition?.label || definition?.key || 'Custom field');
    const key = typeof definition === 'object' && definition.key
      ? definition.key
      : label.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '') || `field_${Math.random().toString(36).slice(2, 8)}`;
    return { ...(typeof definition === 'object' ? definition : {}), key, label, type: definition?.type || 'text' };
  }).slice(0, 40);
}

function normalizeRooms(saved, settings) {
  const roomRecords = Array.isArray(saved?.rooms) && saved.rooms.length ? saved.rooms : [];
  const source = roomRecords.length ? roomRecords : (Array.isArray(settings?.rooms) && settings.rooms.length ? settings.rooms : ['Room 1']);
  return source.map((room, index) => {
    const name = typeof room === 'string' ? room : String(room?.name || room?.label || `Room ${index + 1}`);
    const id = typeof room === 'object' && room?.id
      ? room.id
      : `room_${name.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '') || index + 1}`;
    return { ...(typeof room === 'object' && room !== null ? room : {}), id, name, active: room?.active !== false };
  });
}

/**
 * Merge any persisted (or imported) workspace payload onto the defaults.
 * Handles v1–v4 legacy shapes, preserves future schemas read-only, and never
 * discards unknown fields (they ride along inside records/settings).
 */
export function migrateState(saved, appVersion = APP_VERSION) {
  const base = defaultState();
  const source = saved && typeof saved === 'object' && !Array.isArray(saved) ? saved : {};
  const version = Number(source.schemaVersion || (Object.keys(source).length ? 1 : 0));

  if (version > CURRENT_SCHEMA_VERSION) {
    // Newer workspace: preserve everything, block writes (renderer shows preserved mode).
    const preserved = {
      ...base,
      ...source,
      schemaVersion: version,
      appVersion,
      settings: { ...base.settings, ...(source.settings || {}) },
      counters: { ...base.counters, ...(source.counters || {}) },
      dashboard: Array.isArray(source.dashboard) && source.dashboard.length ? source.dashboard : base.dashboard,
      navigation: { ...base.navigation, ...(source.navigation || {}) },
      unsupportedSchema: true,
      migrationError: `This workspace uses schema v${version}; Dentiva Pro ${appVersion} supports up to schema v${CURRENT_SCHEMA_VERSION}.`
    };
    ARRAY_COLLECTIONS.forEach((key) => { preserved[key] = Array.isArray(source[key]) ? source[key] : []; });
    return preserved;
  }

  const merged = {
    ...base,
    ...source,
    schemaVersion: CURRENT_SCHEMA_VERSION,
    appVersion,
    setupComplete: Boolean(source.setupComplete),
    settings: { ...base.settings, ...(source.settings || {}) },
    counters: { ...base.counters, ...(source.counters || {}) },
    dashboard: Array.isArray(source.dashboard) && source.dashboard.length ? source.dashboard.filter((key) => typeof key === 'string') : base.dashboard,
    navigation: { favorites: Array.isArray(source.navigation?.favorites) ? source.navigation.favorites.slice(0, 12) : [], recent: Array.isArray(source.navigation?.recent) ? source.navigation.recent.slice(0, 12) : [] },
    notificationRead: source.notificationRead && typeof source.notificationRead === 'object' ? source.notificationRead : {},
    lastBackupAt: source.lastBackupAt || null,
    createdAt: source.createdAt || base.createdAt,
    updatedAt: new Date().toISOString()
  };
  ARRAY_COLLECTIONS.forEach((key) => { merged[key] = Array.isArray(source[key]) ? source[key] : []; });

  // Legacy (schema < 2) workspaces gained these collections later; keep whatever exists.
  merged.notifications = Array.isArray(merged.notifications) ? merged.notifications : [];
  merged.audit = Array.isArray(merged.audit) ? merged.audit : [];
  merged.medicationCatalog = Array.isArray(merged.medicationCatalog) ? merged.medicationCatalog : [];
  merged.notificationRules = Array.isArray(merged.notificationRules) && merged.notificationRules.length
    ? merged.notificationRules
    : base.notificationRules;
  merged.followUpTasks = Array.isArray(merged.followUpTasks) ? merged.followUpTasks : [];
  merged.savedFilters = Array.isArray(merged.savedFilters) ? merged.savedFilters : [];
  merged.savedReports = Array.isArray(merged.savedReports) ? merged.savedReports : [];
  merged.treatmentPlans = Array.isArray(merged.treatmentPlans) ? merged.treatmentPlans : [];
  merged.users = Array.isArray(merged.users) ? merged.users : [];
  merged.rooms = normalizeRooms(source, merged.settings);

  merged.settings = {
    ...base.settings,
    ...(merged.settings || {}),
    rooms: Array.isArray(merged.settings?.rooms) && merged.settings.rooms.length ? merged.settings.rooms : base.settings.rooms,
    chairs: Array.isArray(merged.settings?.chairs) && merged.settings.chairs.length ? merged.settings.chairs : base.settings.chairs,
    paymentMethods: Array.isArray(merged.settings?.paymentMethods) && merged.settings.paymentMethods.length ? merged.settings.paymentMethods : base.settings.paymentMethods,
    expenseCategories: Array.isArray(merged.settings?.expenseCategories) && merged.settings.expenseCategories.length ? merged.settings.expenseCategories : base.settings.expenseCategories,
    inventoryCategories: Array.isArray(merged.settings?.inventoryCategories) && merged.settings.inventoryCategories.length ? merged.settings.inventoryCategories : base.settings.inventoryCategories,
    customPatientFields: normalizeCustomFields(merged.settings?.customPatientFields),
    medicationTemplates: Array.isArray(merged.settings?.medicationTemplates) ? merged.settings.medicationTemplates : [],
    documentTemplate: { ...base.settings.documentTemplate, ...(merged.settings?.documentTemplate || {}) },
    attachmentMaxMb: Number(merged.settings?.attachmentMaxMb) > 0 ? Number(merged.settings.attachmentMaxMb) : base.settings.attachmentMaxMb,
    sessionTimeoutMinutes: Number(merged.settings?.sessionTimeoutMinutes) >= 0 ? Number(merged.settings.sessionTimeoutMinutes) : base.settings.sessionTimeoutMinutes
  };
  // Legacy v1.3 workspaces stored notification rules as collection rows; the
  // canonical store is settings.notificationRules (object by kind).
  merged.settings.notificationRules = normalizeNotificationRules(
    (merged.settings && merged.settings.notificationRules && typeof merged.settings.notificationRules === 'object' && !Array.isArray(merged.settings.notificationRules))
      ? merged.settings.notificationRules
      : (Array.isArray(source.notificationRules) ? source.notificationRules : merged.notificationRules)
  );

  // v1.3.x patients stored archive state inconsistently; normalize once.
  merged.patients = merged.patients.map((patient) => (patient && typeof patient === 'object'
    ? { ...patient, archived: Boolean(patient.archived || patient.status === 'Archived') }
    : patient));

  // A legacy application lock without hash material is not a lock; disarm it explicitly.
  if (merged.settings.applicationLock && (!merged.settings.pinHash || !merged.settings.pinSalt)) {
    merged.settings.applicationLock = false;
    merged.settings.pinHash = '';
    merged.settings.pinSalt = '';
  }
  return merged;
}

/** Metadata (non-collection) keys persisted in the workspace `meta` table. */
export const META_KEYS = ['schemaVersion', 'appVersion', 'createdAt', 'updatedAt', 'setupComplete', 'settings', 'counters', 'dashboard', 'navigation', 'notificationRead', 'lastBackupAt', 'unsupportedSchema', 'migrationError'];
