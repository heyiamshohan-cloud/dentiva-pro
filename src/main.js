/* Dentiva Pro — offline-first practice workspace
 * The application deliberately starts with an empty, local data store. Every record visible in the UI is created by the clinic.
 */
import './styles.css';
import { buildBackupManifest, calculateInvoice, canAcceptPayment, validateAttachmentFile } from './core.js';

const app = document.querySelector('#app');
const STORAGE_KEY = 'dentiva-pro.store.v1';
const APP_VERSION = '1.0.0';

const today = () => new Date().toISOString().slice(0, 10);
const now = () => new Date().toISOString();
const uid = (prefix = 'id') => `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
const deepClone = (value) => JSON.parse(JSON.stringify(value));
const esc = (value) => String(value ?? '').replace(/[&<>'"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[c]));
const attr = esc;
const clamp = (n, min, max) => Math.min(max, Math.max(min, n));

const DEFAULT_STATE = {
  schemaVersion: 1,
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
    lowStockThreshold: 5,
    accent: 'teal',
    density: 'comfortable'
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
  audit: [],
  notifications: [],
  dashboard: ['schedule', 'queue', 'followups', 'signals'],
  lastBackupAt: null
};

const arrayKeys = ['patients', 'appointments', 'visits', 'prescriptions', 'dentalRecords', 'treatments', 'invoices', 'payments', 'inventory', 'stockMovements', 'suppliers', 'staff', 'expenses', 'referrals', 'attachments', 'audit', 'notifications'];

const Store = {
  load() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return deepClone(DEFAULT_STATE);
      const saved = JSON.parse(raw);
      const base = deepClone(DEFAULT_STATE);
      const merged = {
        ...base,
        ...saved,
        settings: { ...base.settings, ...(saved.settings || {}) },
        counters: { ...base.counters, ...(saved.counters || {}) },
        dashboard: Array.isArray(saved.dashboard) ? saved.dashboard : base.dashboard
      };
      arrayKeys.forEach((key) => { merged[key] = Array.isArray(saved[key]) ? saved[key] : []; });
      return merged;
    } catch (error) {
      console.error('Dentiva Pro store recovery', error);
      return deepClone(DEFAULT_STATE);
    }
  },
  save(value) {
    try {
      value.updatedAt = now();
      localStorage.setItem(STORAGE_KEY, JSON.stringify(value));
    } catch (error) {
      console.error('Dentiva Pro store save', error);
      notify('Local storage is full. Export a backup and remove large attachments.', 'error');
    }
  },
  reset() {
    localStorage.removeItem(STORAGE_KEY);
    state = deepClone(DEFAULT_STATE);
    ui = { ...ui, page: 'dashboard', modal: null, patientId: null, restoreCandidate: null, locked: false };
    render();
  }
};

let state = Store.load();
if (state.settings.applicationLock && (!state.settings.pinHash || !state.settings.pinSalt)) {
  state.settings.applicationLock = false;
  state.settings.pinHash = '';
  state.settings.pinSalt = '';
  Store.save(state);
}
let ui = {
  page: 'dashboard',
  patientId: null,
  patientTab: 'overview',
  search: '',
  range: 'today',
  modal: null,
  toast: null,
  locked: false,
  sidebarCollapsed: false,
  mobileNav: false,
  restoreCandidate: null,
  dentalPatientId: '',
  dentalTooth: null,
  dentalFilter: 'all',
  reportsRange: 'month',
  reportType: 'revenue',
  calendarMonth: new Date().getMonth(),
  calendarYear: new Date().getFullYear()
};

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
  'Reports': 'রিপোর্ট', 'Backup & Restore': 'ব্যাকআপ ও পুনরুদ্ধার', 'Settings': 'সেটিংস', 'Help': 'সহায়তা', 'About': 'পরিচিতি',
  'Workspace': 'ওয়ার্কস্পেস', 'Clinical': 'ক্লিনিক্যাল', 'Finance': 'আর্থিক', 'Operations': 'পরিচালনা', 'Insights': 'বিশ্লেষণ', 'System': 'সিস্টেম',
  'New patient': 'নতুন রোগী', 'New appointment': 'নতুন অ্যাপয়েন্টমেন্ট', 'New visit': 'নতুন ভিজিট', 'New invoice': 'নতুন ইনভয়েস',
  'Record payment': 'পরিশোধ রেকর্ড', 'Add stock': 'স্টক যোগ করুন', 'Complete setup': 'সেটআপ সম্পূর্ণ করুন', 'Open appointments': 'অ্যাপয়েন্টমেন্ট খুলুন',
  'View queue': 'সিরিয়াল দেখুন', 'Clinical records': 'ক্লিনিক্যাল রেকর্ড', 'Create prescription': 'প্রেসক্রিপশন তৈরি করুন',
  'Export CSV': 'CSV এক্সপোর্ট', 'Print queue': 'সিরিয়াল প্রিন্ট', 'Print statement': 'স্টেটমেন্ট প্রিন্ট', 'Stock movement': 'স্টক মুভমেন্ট',
  'Export full backup': 'সম্পূর্ণ ব্যাকআপ এক্সপোর্ট', 'Import backup': 'ব্যাকআপ ইমপোর্ট', 'Save settings': 'সেটিংস সংরক্ষণ',
  'Cancel': 'বাতিল', 'Save changes': 'পরিবর্তন সংরক্ষণ', 'Save record': 'রেকর্ড সংরক্ষণ', 'Search anything': 'যেকোনো কিছু খুঁজুন',
  'Today': 'আজ', 'Last 7 days': 'গত ৭ দিন', 'Last 1 month': 'গত ১ মাস', 'Last 3 months': 'গত ৩ মাস', 'Last 1 year': 'গত ১ বছর',
  'Active': 'সক্রিয়', 'Inactive': 'নিষ্ক্রিয়', 'Scheduled': 'নির্ধারিত', 'Checked In': 'চেক-ইন', 'Waiting': 'অপেক্ষমাণ',
  'In Treatment': 'চিকিৎসাধীন', 'Completed': 'সম্পন্ন', 'Cancelled': 'বাতিল', 'No Show': 'অনুপস্থিত', 'Paid': 'পরিশোধিত',
  'Partially Paid': 'আংশিক পরিশোধ', 'Unpaid': 'অপরিশোধিত', 'Low stock': 'স্টক কম', 'In stock': 'স্টকে আছে', 'Expired': 'মেয়াদোত্তীর্ণ',
  'No records in this range': 'এই সময়সীমায় কোনো রেকর্ড নেই', 'No patients found': 'কোনো রোগী পাওয়া যায়নি', 'No notifications': 'কোনো নোটিফিকেশন নেই',
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
  'Backup & restore': 'ব্যাকআপ ও পুনরুদ্ধার', 'Backup & restore': 'ব্যাকআপ ও পুনরুদ্ধার', 'Create a backup': 'ব্যাকআপ তৈরি করুন', 'Restore or import': 'পুনরুদ্ধার বা ইমপোর্ট', 'Export full backup': 'সম্পূর্ণ ব্যাকআপ এক্সপোর্ট', 'Import backup': 'ব্যাকআপ ইমপোর্ট', 'Choose a backup file': 'ব্যাকআপ ফাইল নির্বাচন করুন', 'Import preview': 'ইমপোর্ট প্রিভিউ', 'records detected': 'রেকর্ড পাওয়া গেছে', 'possible conflicts': 'সম্ভাব্য দ্বন্দ্ব', 'validation errors': 'ভ্যালিডেশন ত্রুটি', 'Keep Existing': 'বিদ্যমানটি রাখুন', 'Skip': 'এড়িয়ে যান', 'Replace': 'প্রতিস্থাপন করুন', 'Create New Copy': 'নতুন কপি তৈরি করুন',
  'Settings': 'সেটিংস', 'Save settings': 'সেটিংস সংরক্ষণ', 'Clinic identity': 'ক্লিনিক পরিচয়', 'Localization': 'লোকালাইজেশন', 'Numbering & control': 'নম্বরিং ও নিয়ন্ত্রণ', 'Privacy & security': 'গোপনীয়তা ও নিরাপত্তা', 'Clinic / practice name': 'ক্লিনিক / প্র্যাকটিসের নাম', 'Chamber / branch': 'চেম্বার / শাখা', 'Dentist name': 'ডেন্টিস্টের নাম', 'Professional title': 'পেশাগত উপাধি', 'Default language': 'ডিফল্ট ভাষা', 'Timezone': 'টাইমজোন', 'Date format': 'তারিখের ফরম্যাট', 'Time format': 'সময়ের ফরম্যাট', 'Patient code prefix': 'রোগী কোডের প্রিফিক্স', 'Invoice prefix': 'ইনভয়েস প্রিফিক্স', 'Appointment prefix': 'অ্যাপয়েন্টমেন্ট প্রিফিক্স', 'Queue serial prefix': 'সিরিয়াল প্রিফিক্স', 'Application lock': 'অ্যাপ্লিকেশন লক', 'Set application PIN': 'অ্যাপ্লিকেশন পিন সেট করুন', 'Change PIN': 'পিন পরিবর্তন করুন', 'Disable': 'বন্ধ করুন', 'Lock workspace': 'ওয়ার্কস্পেস লক করুন', 'Workspace locked': 'ওয়ার্কস্পেস লক করা হয়েছে', 'WORKSPACE LOCKED': 'ওয়ার্কস্পেস লক করা হয়েছে', 'Enter your application PIN': 'আপনার অ্যাপ্লিকেশন পিন দিন', 'This local workspace is protected. Your records remain on this device.': 'এই স্থানীয় ওয়ার্কস্পেস সুরক্ষিত। আপনার রেকর্ড এই ডিভাইসেই থাকে।', 'Application PIN': 'অ্যাপ্লিকেশন পিন', 'Unlock workspace': 'ওয়ার্কস্পেস আনলক করুন', 'Forgotten PINs cannot be recovered by Dentiva Pro. Use a verified backup according to your clinic policy.': 'ভুলে যাওয়া পিন Dentiva Pro থেকে পুনরুদ্ধার করা যায় না। আপনার ক্লিনিকের নীতি অনুযায়ী যাচাইকৃত ব্যাকআপ ব্যবহার করুন।', 'New PIN': 'নতুন পিন', 'Confirm PIN': 'পিন নিশ্চিত করুন', 'Change application PIN': 'অ্যাপ্লিকেশন পিন পরিবর্তন করুন', 'Enable application lock': 'অ্যাপ্লিকেশন লক চালু করুন', 'Update PIN': 'পিন আপডেট করুন',
  'Help centre': 'সহায়তা কেন্দ্র', 'About Dentiva Pro': 'Dentiva Pro পরিচিতি', 'Professional dental practice management for Bangladesh.': 'বাংলাদেশের জন্য পেশাদার ডেন্টাল প্র্যাকটিস ম্যানেজমেন্ট।', 'Privacy': 'গোপনীয়তা', 'Local data promise': 'স্থানীয় ডেটার প্রতিশ্রুতি', 'Your practice data stays yours.': 'আপনার প্র্যাকটিসের ডেটা আপনারই থাকে।', 'Creator': 'নির্মাতা', 'Offline-first': 'অফলাইন-প্রথম', 'Light mode': 'লাইট মোড', 'Local privacy': 'স্থানীয় গোপনীয়তা'
};
function localized(value) { return state.settings.language === 'Bengali' ? (BENGALI[value] || value) : value; }
function translateDom() {
  if (state.settings.language !== 'Bengali' || !app) return;
  const walker = document.createTreeWalker(app, 4);
  let node;
  while ((node = walker.nextNode())) {
    const raw = node.nodeValue || '';
    const trimmed = raw.trim();
    if (!trimmed || !BENGALI[trimmed]) continue;
    const leading = raw.slice(0, raw.indexOf(trimmed));
    const trailing = raw.slice(raw.indexOf(trimmed) + trimmed.length);
    node.nodeValue = `${leading}${BENGALI[trimmed]}${trailing}`;
  }
  app.querySelectorAll('[placeholder], [title], [aria-label]').forEach((element) => {
    ['placeholder', 'title', 'aria-label'].forEach((attribute) => {
      const value = element.getAttribute(attribute);
      if (value && BENGALI[value]) element.setAttribute(attribute, BENGALI[value]);
    });
  });
}

const NAV_GROUPS = [
  { label: 'Workspace', items: [['dashboard', 'Dashboard', 'grid'], ['patients', 'Patients', 'users'], ['appointments', 'Appointments', 'calendar'], ['queue', 'Today\'s Queue', 'clipboard']] },
  { label: 'Clinical', items: [['clinical', 'Clinical Records', 'activity'], ['prescriptions', 'Prescriptions', 'file'], ['dental', 'Dental Chart', 'tooth'], ['treatments', 'Treatment Catalog', 'layers']] },
  { label: 'Finance', items: [['billing', 'Billing', 'receipt'], ['payments', 'Payments', 'credit'], ['accounting', 'Accounting', 'dollar']] },
  { label: 'Operations', items: [['inventory', 'Inventory', 'box'], ['suppliers', 'Suppliers', 'truck'], ['staff', 'Staff', 'briefcase']] },
  { label: 'Insights', items: [['reports', 'Reports', 'chart']] },
  { label: 'System', items: [['backup', 'Backup & Restore', 'backup'], ['settings', 'Settings', 'settings'], ['help', 'Help', 'help'], ['about', 'About', 'info']] }
];

function currency(value = 0) {
  const amount = Number(value) || 0;
  try {
    return new Intl.NumberFormat('en-BD', { style: 'currency', currency: state.settings.currency || 'BDT', currencyDisplay: 'narrowSymbol', maximumFractionDigits: 2 }).format(amount);
  } catch {
    return `৳${amount.toFixed(2)}`;
  }
}
function number(value = 0) { return new Intl.NumberFormat('en-BD').format(Number(value) || 0); }
function date(value, opts = {}) {
  if (!value) return '—';
  const parsed = new Date(`${value}T00:00:00`);
  if (Number.isNaN(parsed.getTime())) return '—';
  return new Intl.DateTimeFormat(state.settings.language === 'Bengali' ? 'bn-BD' : 'en-GB', { day: '2-digit', month: 'short', year: 'numeric', ...opts }).format(parsed);
}
function time(value) {
  if (!value) return '—';
  const [h, m] = value.split(':').map(Number);
  const d = new Date(); d.setHours(h || 0, m || 0, 0, 0);
  return new Intl.DateTimeFormat('en-BD', { hour: 'numeric', minute: '2-digit', hour12: state.settings.timeFormat !== '24-hour' }).format(d);
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
function nextCode(kind, settingKey) {
  const n = state.counters[kind] || 1;
  state.counters[kind] = n + 1;
  const prefix = state.settings[settingKey] || kind.slice(0, 3).toUpperCase();
  return `${prefix}-${String(n).padStart(4, '0')}`;
}
function active(list) { return list.filter((item) => !item.archived); }
function byId(list, id) { return list.find((item) => item.id === id); }
function sum(list, getter) { return list.reduce((total, item) => total + (Number(getter(item)) || 0), 0); }
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
function audit(action, entity, recordId = '', summary = '') {
  state.audit.unshift({ id: uid('audit'), at: now(), action, entity, recordId, summary, user: state.settings.dentistName || 'Local administrator' });
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
function printHtml(title, content) {
  const printWindow = window.open('', '_blank', 'noopener,noreferrer,width=900,height=700');
  if (!printWindow) { notify('Allow pop-ups to use print preview.', 'error'); return; }
  const logo = state.settings.logo ? `<img src="${state.settings.logo}" alt="" style="height:48px;max-width:160px;object-fit:contain;">` : `<div class="print-mark">DP</div>`;
  printWindow.document.write(`<!doctype html><html><head><title>${esc(title)}</title><style>
    *{box-sizing:border-box}body{font:13px Arial,sans-serif;color:#202b31;margin:0;padding:32px;background:#fff}header{display:flex;align-items:flex-start;justify-content:space-between;border-bottom:2px solid #0c6b70;padding-bottom:18px;margin-bottom:24px}.brand{display:flex;gap:12px;align-items:center}.print-mark{width:46px;height:46px;border-radius:14px;background:#0c6b70;color:#fff;display:grid;place-items:center;font-weight:700}.clinic{font-size:18px;font-weight:700}.muted{color:#68747b;font-size:11px;line-height:1.6}h1{font-size:22px;margin:0 0 4px}h2{font-size:15px;margin:22px 0 10px}.print-table{width:100%;border-collapse:collapse}.print-table th,.print-table td{padding:8px 10px;border-bottom:1px solid #dfe5e5;text-align:left}.print-table th{background:#f1f5f5;font-size:11px;text-transform:uppercase;letter-spacing:.06em}.summary{display:flex;gap:24px;margin:12px 0 18px}.summary strong{display:block;font-size:18px}.right{text-align:right}@media print{body{padding:0}button{display:none}}
  </style></head><body><header><div class="brand">${logo}<div><div class="clinic">${esc(state.settings.clinicName || 'Dentiva Pro')}</div><div class="muted">${esc(state.settings.dentistName || 'Professional Dental Practice')} · ${esc(state.settings.phone || '')}<br>${esc(state.settings.address || '')}</div></div></div><div class="right muted">${date(today())}<br>${esc(state.settings.email || '')}</div></header><h1>${esc(title)}</h1>${content}<footer class="muted" style="margin-top:32px;border-top:1px solid #dfe5e5;padding-top:12px">Generated by Dentiva Pro · ${APP_VERSION}</footer><script>window.onload=()=>setTimeout(()=>window.print(),250);</script></body></html>`);
  printWindow.document.close();
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
  const unread = state.notifications.filter((n) => !n.read).length;
  return `<header class="topbar"><div class="topbar-left"><button class="icon-button menu-button" data-action="toggle-mobile-nav" aria-label="Open navigation">${icon('menu', 20)}</button><div class="breadcrumb"><span>Workspace</span>${ui.page !== 'dashboard' ? `${icon('chevron', 13)}<strong>${esc(pageTitle())}</strong>` : ''}</div></div><div class="topbar-actions"><button class="global-search" data-action="open-search" aria-label="Search"><span>${icon('search', 17)}<span>Search anything</span></span><kbd>Ctrl K</kbd></button><button class="icon-button notification-button" data-action="open-notifications" aria-label="Notifications">${icon('bell', 19)}${unread ? `<b>${unread > 9 ? '9+' : unread}</b>` : ''}</button><div class="topbar-divider"></div><button class="user-menu" data-action="open-user-menu"><span class="avatar avatar-small">${initials(state.settings.dentistName || 'Dr')}</span><span class="user-meta"><strong>${esc(state.settings.dentistName || 'Practice admin')}</strong><small>${esc(state.settings.professionalTitle || 'Administrator')}</small></span>${icon('down', 14)}</button></div></header>`;
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
    backup: renderBackup,
    settings: renderSettings,
    help: renderHelp,
    about: renderAbout
  };
  return (pages[ui.page] || renderDashboard)();
}

function setupBanner() {
  if (state.setupComplete) return '';
  const configured = [state.settings.clinicName, state.settings.dentistName, state.settings.phone, state.settings.address].filter(Boolean).length;
  return `<section class="setup-banner"><div class="setup-icon">${icon('sparkle', 21)}</div><div class="setup-copy"><strong>Make this workspace yours</strong><p>Add your clinic identity once. Your records stay on this device and can be backed up at any time.</p><div class="setup-progress"><span style="width:${configured * 25}%"></span></div><small>${configured} of 4 essentials complete</small></div>${button('Complete setup', 'open-setup', 'arrow', 'primary')}</section>`;
}
function renderDashboard() {
  const todayAppointments = active(state.appointments).filter((a) => a.date === today()).sort((a, b) => (a.time || '').localeCompare(b.time || ''));
  const waiting = todayAppointments.filter((a) => ['Checked In', 'Waiting', 'In Treatment'].includes(a.status));
  const todayPatients = new Set(todayAppointments.map((a) => a.patientId)).size;
  const collectedToday = sum(active(state.payments).filter((p) => p.date === today()), (p) => p.amount);
  const followups = active(state.visits).filter((v) => v.followUpDate && v.followUpDate <= today()).sort((a, b) => a.followUpDate.localeCompare(b.followUpDate)).slice(0, 4);
  const lowStock = active(state.inventory).filter((i) => Number(i.currentStock) <= Number(i.minimumStock || state.settings.lowStockThreshold));
  const overdue = active(state.invoices).filter((invoice) => invoice.status !== 'Paid' && invoice.status !== 'Cancelled' && invoice.due > 0);
  return `<div class="page dashboard-page">${pageHeader(`Good ${new Date().getHours() < 12 ? 'morning' : new Date().getHours() < 17 ? 'afternoon' : 'evening'}${state.settings.dentistName ? `, ${esc(state.settings.dentistName.split(' ').slice(-1)[0])}` : ''}`, 'A clear view of your practice, without the noise.', `<div class="period-picker"><span>${icon('calendar', 15)}</span><select data-change="dashboard-range"><option value="today" ${ui.range === 'today' ? 'selected' : ''}>Today</option><option value="7d" ${ui.range === '7d' ? 'selected' : ''}>Last 7 days</option><option value="month" ${ui.range === 'month' ? 'selected' : ''}>Last 1 month</option><option value="quarter" ${ui.range === 'quarter' ? 'selected' : ''}>Last 3 months</option><option value="year" ${ui.range === 'year' ? 'selected' : ''}>Last 1 year</option></select>${icon('down', 14)}</div>`)}${setupBanner()}<div class="metric-grid"><div class="metric-card metric-teal"><div class="metric-top"><span class="metric-label">Today’s appointments</span><span class="metric-icon">${icon('calendar', 18)}</span></div><strong>${number(todayAppointments.length)}</strong><small>${todayAppointments.length ? `${todayAppointments.filter((a) => a.status === 'Completed').length} completed` : 'Your schedule is clear'}</small></div><div class="metric-card"><div class="metric-top"><span class="metric-label">Patients today</span><span class="metric-icon soft-blue">${icon('users', 18)}</span></div><strong>${number(todayPatients)}</strong><small>${state.patients.length ? `${number(state.patients.length)} in your directory` : 'No patients added yet'}</small></div><div class="metric-card"><div class="metric-top"><span class="metric-label">Waiting queue</span><span class="metric-icon soft-amber">${icon('clock', 18)}</span></div><strong>${number(waiting.length)}</strong><small>${waiting.length ? 'Patients need attention' : 'No one is waiting'}</small></div><div class="metric-card"><div class="metric-top"><span class="metric-label">Collected today</span><span class="metric-icon soft-purple">${icon('dollar', 18)}</span></div><strong>${currency(collectedToday)}</strong><small>${collectedToday ? 'Across recorded payments' : 'No payments recorded'}</small></div></div><div class="dashboard-grid"><section class="card schedule-card">${cardTitle('calendar', 'Today’s schedule', button('Open appointments', 'navigate', 'arrow', 'link', 'data-page="appointments"'))}<div class="schedule-list">${todayAppointments.length ? todayAppointments.map((a) => appointmentRow(a)).join('') : emptyState('calendar', 'Nothing booked today', 'Create an appointment to build your schedule.', button('New appointment', 'open-appointment', 'plus', 'secondary'))}</div></section><section class="card queue-card">${cardTitle('clipboard', 'Today’s queue', button('View queue', 'navigate', 'arrow', 'link', 'data-page="queue"'))}<div class="queue-summary"><div class="queue-ring"><strong>${waiting.length}</strong><span>waiting</span></div><div class="queue-copy"><strong>${todayAppointments.length ? `${todayAppointments.length} scheduled today` : 'Your queue is ready'}</strong><p>Check patients in as they arrive and keep care moving.</p></div></div><div class="mini-status-list"><div><span class="status-dot dot-teal"></span>Checked in <strong>${todayAppointments.filter((a) => a.status === 'Checked In').length}</strong></div><div><span class="status-dot dot-amber"></span>In treatment <strong>${todayAppointments.filter((a) => a.status === 'In Treatment').length}</strong></div><div><span class="status-dot dot-green"></span>Completed <strong>${todayAppointments.filter((a) => a.status === 'Completed').length}</strong></div></div></section><section class="card followup-card">${cardTitle('flag', 'Follow-ups due', button('Clinical records', 'navigate', 'arrow', 'link', 'data-page="clinical"'))}<div class="followup-list">${followups.length ? followups.map((v) => `<div class="followup-row"><span class="avatar avatar-xs">${initials(patientName(v.patientId))}</span><div><strong>${esc(patientName(v.patientId))}</strong><small>${esc(v.diagnosis || v.reason || 'Follow-up')} · ${relativeDate(v.followUpDate)}</small></div><span class="followup-date">${date(v.followUpDate, { day: 'numeric', month: 'short' })}</span></div>`).join('') : emptyState('flag', 'No follow-ups due', 'Follow-up dates from clinical visits will appear here.')}</div></section><section class="card signals-card">${cardTitle('activity', 'Operational signals')}<div class="signal-list"><div class="signal-item ${overdue.length ? 'signal-warning' : ''}"><span class="signal-icon">${icon('credit', 16)}</span><div><strong>${overdue.length ? `${overdue.length} outstanding invoice${overdue.length > 1 ? 's' : ''}` : 'No outstanding balances'}</strong><small>${overdue.length ? 'Review from Billing' : 'You’re all caught up'}</small></div>${overdue.length ? badge('Review', 'warning') : icon('check', 16)}</div><div class="signal-item ${lowStock.length ? 'signal-warning' : ''}"><span class="signal-icon">${icon('box', 16)}</span><div><strong>${lowStock.length ? `${lowStock.length} stock alert${lowStock.length > 1 ? 's' : ''}` : 'Inventory is in good shape'}</strong><small>${lowStock.length ? 'Low or out of stock' : 'No reorder needed'}</small></div>${lowStock.length ? badge('Action', 'warning') : icon('check', 16)}</div><div class="signal-item"><span class="signal-icon">${icon('backup', 16)}</span><div><strong>${state.lastBackupAt ? 'Latest backup verified' : 'Backup not configured'}</strong><small>${state.lastBackupAt ? date(state.lastBackupAt.slice(0, 10)) : 'Protect your practice data'}</small></div>${button(state.lastBackupAt ? 'View' : 'Set up', 'navigate', 'arrow', 'link', 'data-page="backup"')}</div></div></section></div><section class="quick-actions card"><div><div class="eyebrow">SHORTCUTS</div><h2>Move work forward</h2><p>Common actions, one click away.</p></div><div class="quick-action-grid">${[['New patient', 'open-patient', 'users'], ['Appointment', 'open-appointment', 'calendar'], ['New visit', 'open-visit', 'activity'], ['New invoice', 'open-invoice', 'receipt'], ['Record payment', 'open-payment', 'credit'], ['Add stock', 'open-stock', 'box']].map(([label, action, ico]) => `<button data-action="${action}" class="quick-action">${icon(ico, 18)}<span>${esc(label)}</span>${icon('arrow', 14)}</button>`).join('')}</div></section></div>`;
}
function appointmentRow(a) {
  const patient = byId(state.patients, a.patientId);
  return `<div class="schedule-row"><div class="schedule-time"><strong>${time(a.time)}</strong><small>${a.duration || 30} min</small></div><div class="schedule-line"></div><div class="schedule-person"><span class="avatar avatar-xs">${initials(patient?.fullName || 'PT')}</span><div><strong>${esc(patient?.fullName || 'Unassigned patient')}</strong><small>${esc(a.reason || 'Appointment')} · ${esc(a.chair || 'Chair 1')}</small></div></div><div class="row-end">${statusBadge(a.status || 'Scheduled')}<button class="icon-button tiny" data-action="edit-appointment" data-id="${a.id}" aria-label="Edit appointment">${icon('more', 17)}</button></div></div>`;
}

function searchInput(placeholder, value = ui.search, dataKey = 'global-search') { return `<label class="search-field">${icon('search', 17)}<input type="search" placeholder="${attr(placeholder)}" value="${attr(value)}" data-input="${dataKey}"><kbd>${dataKey === 'global-search' ? '⌘ K' : ''}</kbd></label>`; }
function toolbar(filters = '', actions = '') { return `<div class="toolbar"><div class="toolbar-left">${filters}</div><div class="toolbar-right">${actions}</div></div>`; }
function dataTable(headers, body, empty = '') { return `<div class="table-wrap"><table class="data-table"><thead><tr>${headers.map((h) => `<th>${esc(h)}</th>`).join('')}</tr></thead><tbody>${body || `<tr><td colspan="${headers.length}">${empty}</td></tr>`}</tbody></table></div>`; }

function renderPatients() {
  if (ui.patientId) return renderPatientProfile();
  const query = ui.search.trim().toLowerCase();
  const patients = active(state.patients).filter((p) => (ui.patientStatusFilter === 'Archived' ? p.archived : ui.patientStatusFilter === 'Active' || !ui.patientStatusFilter || ui.patientStatusFilter === 'All statuses' ? !p.archived : true) && (!query || [p.patientCode, p.fullName, p.phone, p.email, p.address, p.medicalHistory].some((value) => String(value || '').toLowerCase().includes(query)))).sort((a, b) => (a.fullName || '').localeCompare(b.fullName || ''));
  const rows = patients.map((p) => `<tr class="clickable-row" data-action="open-patient-profile" data-id="${p.id}"><td><span class="code-label">${esc(p.patientCode || '—')}</span></td><td><div class="person-cell"><span class="avatar avatar-table">${initials(p.fullName)}</span><div><strong>${esc(p.fullName)}</strong><small>${p.preferredName ? `Prefers ${esc(p.preferredName)}` : p.gender ? esc(p.gender) : 'Patient'}</small></div></div></td><td><div class="contact-cell">${p.phone ? `<span>${icon('phone', 13)}${esc(p.phone)}</span>` : '<span class="muted">No phone</span>'}${p.email ? `<span>${icon('mail', 13)}${esc(p.email)}</span>` : ''}</div></td><td>${date(p.lastVisit)}</td><td>${p.nextVisit ? date(p.nextVisit) : '<span class="muted">Not scheduled</span>'}</td><td>${statusBadge(p.status || 'Active')}</td><td><button class="icon-button tiny" data-action="open-patient-profile" data-id="${p.id}" aria-label="Open patient profile">${icon('arrow', 15)}</button></td></tr>`).join('');
  return `<div class="page">${pageHeader('Patients', 'A complete, searchable record of the people in your care.', button('New patient', 'open-patient', 'plus', 'primary'))}<div class="stats-strip"><div><span class="stat-label">Total patients</span><strong>${number(patients.length)}</strong></div><div><span class="stat-label">New this month</span><strong>${number(active(state.patients).filter((p) => p.registrationDate?.slice(0, 7) === today().slice(0, 7)).length)}</strong></div><div><span class="stat-label">With upcoming visit</span><strong>${number(active(state.patients).filter((p) => p.nextVisit && p.nextVisit >= today()).length)}</strong></div><div><span class="stat-label">Needs attention</span><strong>${number(active(state.patients).filter((p) => !p.phone || !p.dateOfBirth).length)}</strong></div></div><section class="card table-card"><div class="card-toolbar">${searchInput('Search by name, code, phone or email')}<div class="table-actions">${button('Filters', 'toggle-patient-filters', 'filter', 'secondary')}${button('Export CSV', 'export-patients', 'download', 'secondary')}</div></div><div class="filter-drawer ${ui.patientFilters ? 'open' : ''}"><label>Patient status<select data-change="patient-status-filter"><option ${!ui.patientStatusFilter || ui.patientStatusFilter === 'All statuses' ? 'selected' : ''}>All statuses</option><option ${ui.patientStatusFilter === 'Active' ? 'selected' : ''}>Active</option><option ${ui.patientStatusFilter === 'Archived' ? 'selected' : ''}>Archived</option></select></label><span>Search is instant and includes clinical notes, phone and address.</span></div>${patients.length ? dataTable(['Patient code', 'Patient', 'Contact', 'Last visit', 'Next visit', 'Status', ''], rows) : emptyState('users', query ? 'No patients match that search' : 'Your patient directory is empty', query ? 'Try another name, code or phone number.' : 'Add your first patient to start a complete clinical record.', button('Add patient', 'open-patient', 'plus', 'primary'))}</section></div>`;
}
function renderPatientProfile() {
  const patient = byId(state.patients, ui.patientId);
  if (!patient) { ui.patientId = null; return renderPatients(); }
  const visits = active(state.visits).filter((v) => v.patientId === patient.id).sort((a, b) => (b.date || '').localeCompare(a.date || ''));
  const appointments = active(state.appointments).filter((a) => a.patientId === patient.id).sort((a, b) => `${b.date}${b.time}`.localeCompare(`${a.date}${a.time}`));
  const invoices = active(state.invoices).filter((i) => i.patientId === patient.id);
  const payments = active(state.payments).filter((p) => p.patientId === patient.id);
  const billed = sum(invoices, (i) => i.total);
  const paid = sum(payments, (p) => p.amount);
  const currentTab = ui.patientTab || 'overview';
  const tabs = [['overview', 'Overview'], ['visits', 'Visits'], ['dental', 'Dental chart'], ['prescriptions', 'Prescriptions'], ['billing', 'Billing'], ['attachments', 'Attachments'], ['referrals', 'Referrals'], ['timeline', 'Timeline']];
  return `<div class="page patient-profile-page"><div class="profile-breadcrumb"><button class="back-link" data-action="close-patient-profile">${icon('arrow', 15)}<span>Back to patients</span></button><span>/</span><span>${esc(patient.patientCode || 'Patient')}</span></div><section class="profile-hero"><div class="profile-identity"><span class="avatar avatar-large">${initials(patient.fullName)}</span><div><div class="profile-code">${esc(patient.patientCode || '—')} · ${date(patient.registrationDate)}</div><h1>${esc(patient.fullName)}</h1><div class="profile-meta">${patient.dateOfBirth ? `${date(patient.dateOfBirth)} · ${patient.gender || 'Gender not recorded'}` : 'Date of birth not recorded'} ${patient.phone ? ` · ${icon('phone', 13)} ${esc(patient.phone)}` : ''}</div></div></div><div class="profile-actions">${button('New visit', 'open-visit', 'plus', 'primary', `data-patient-id="${patient.id}"`)}<button class="icon-button bordered" data-action="edit-patient" data-id="${patient.id}" aria-label="Edit patient">${icon('edit', 17)}</button><button class="icon-button bordered" data-action="print-patient" data-id="${patient.id}" aria-label="Print patient summary">${icon('printer', 17)}</button></div></section><div class="profile-stats"><div><span>Visits</span><strong>${number(visits.length)}</strong></div><div><span>First visit</span><strong>${visits.length ? date(visits[visits.length - 1].date, { day: 'numeric', month: 'short', year: 'numeric' }) : '—'}</strong></div><div><span>Total billed</span><strong>${currency(billed)}</strong></div><div><span>Outstanding</span><strong class="${billed - paid > 0 ? 'text-warning' : ''}">${currency(Math.max(0, billed - paid))}</strong></div></div><nav class="profile-tabs" aria-label="Patient profile sections">${tabs.map(([id, label]) => `<button class="profile-tab ${currentTab === id ? 'active' : ''}" data-action="patient-tab" data-tab="${id}">${esc(label)}${id === 'visits' && visits.length ? `<span>${visits.length}</span>` : ''}</button>`).join('')}</nav><section class="profile-content">${renderPatientTab(patient, currentTab, { visits, appointments, invoices, payments, billed, paid })}</section></div>`;
}
function renderPatientTab(patient, tab, data) {
  if (tab === 'visits') return `<div class="section-heading"><div><h2>Clinical visits</h2><p>Every encounter is traceable to this patient.</p></div>${button('Record visit', 'open-visit', 'plus', 'secondary')}</div>${data.visits.length ? `<div class="timeline-list">${data.visits.map((v) => `<article class="timeline-card"><div class="timeline-marker">${icon('activity', 17)}</div><div class="timeline-body"><div class="timeline-top"><div><strong>${esc(v.reason || v.chiefComplaint || 'Clinical visit')}</strong><small>${date(v.date)}${v.time ? ` · ${time(v.time)}` : ''}</small></div>${statusBadge(v.status || 'Completed')}</div>${v.diagnosis ? `<p><b>Diagnosis:</b> ${esc(v.diagnosis)}</p>` : ''}${v.treatmentPerformed ? `<p><b>Treatment:</b> ${esc(v.treatmentPerformed)}</p>` : ''}${v.followUpDate ? `<div class="followup-chip">${icon('flag', 13)} Follow-up ${date(v.followUpDate)}</div>` : ''}</div></article>`).join('')}</div>` : emptyState('activity', 'No visits recorded', 'When you record an encounter, its clinical history will live here.', button('Record visit', 'open-visit', 'plus', 'primary'))}`;
  if (tab === 'dental') return `<div class="section-heading"><div><h2>Dental chart</h2><p>Tooth-level records for ${esc(patient.fullName)}.</p></div>${button('Open full chart', 'navigate', 'tooth', 'secondary', 'data-page="dental"')}</div>${renderMiniDentalChart(patient)}`;
  if (tab === 'prescriptions') { const prescriptions = active(state.prescriptions).filter((p) => p.patientId === patient.id); return `<div class="section-heading"><div><h2>Prescriptions</h2><p>Medication instructions recorded by the practice.</p></div>${button('New prescription', 'open-prescription', 'plus', 'secondary')}</div>${prescriptions.length ? `<div class="record-list">${prescriptions.map((p) => `<div class="record-row"><span class="record-icon purple">${icon('file', 17)}</span><div><strong>${esc(p.prescriptionCode || 'Prescription')} · ${date(p.date)}</strong><small>${esc(p.medications?.map((m) => m.medicine).join(', ') || p.medicine || 'Medication not specified')}</small></div>${button('Print', 'print-prescription', 'printer', 'link', `data-id="${p.id}"`)}</div>`).join('')}</div>` : emptyState('file', 'No prescriptions yet', 'Prescriptions created for this patient will appear here.')}`; }
  if (tab === 'billing') return `<div class="section-heading"><div><h2>Billing & payments</h2><p>Transparent financial history for ${esc(patient.fullName)}.</p></div>${button('New invoice', 'open-invoice', 'plus', 'secondary')}</div><div class="two-col-cards"><div class="summary-panel"><span>Total billed</span><strong>${currency(data.billed)}</strong><small>${data.invoices.length} invoice${data.invoices.length === 1 ? '' : 's'}</small></div><div class="summary-panel"><span>Total paid</span><strong>${currency(data.paid)}</strong><small>${data.payments.length} payment${data.payments.length === 1 ? '' : 's'}</small></div><div class="summary-panel warning"><span>Outstanding</span><strong>${currency(Math.max(0, data.billed - data.paid))}</strong><small>Calculated from valid payments</small></div></div>${data.invoices.length ? dataTable(['Invoice', 'Date', 'Total', 'Paid', 'Due', 'Status'], data.invoices.map((i) => `<tr><td><span class="code-label">${esc(i.invoiceNumber)}</span></td><td>${date(i.date)}</td><td>${currency(i.total)}</td><td>${currency(i.paid || 0)}</td><td>${currency(i.due || 0)}</td><td>${statusBadge(i.status)}</td></tr>`).join('')) : emptyState('receipt', 'No invoices yet', 'Invoices and receipts created for this patient will appear here.')}`;
  if (tab === 'referrals') { const referrals = active(state.referrals).filter((r) => r.patientId === patient.id).sort((a, b) => (b.date || '').localeCompare(a.date || '')); return `<div class="section-heading"><div><h2>Referral history</h2><p>Track referrals to another doctor, specialist or organisation.</p></div>${button('New referral', 'open-referral', 'plus', 'secondary')}</div>${referrals.length ? `<div class="record-list">${referrals.map((r) => `<article class="record-row"><span class="record-icon">${icon('flag', 17)}</span><div><strong>${esc(r.referralTo)} · ${date(r.date)}</strong><small>${esc(r.specialty || 'Specialty not recorded')} · ${esc(r.reason || 'Reason not recorded')}</small>${r.response ? `<small class="text-success">Response: ${esc(r.response)}</small>` : ''}</div><button class="icon-button tiny" data-action="edit-referral" data-id="${r.id}">${icon('edit', 16)}</button></article>`).join('')}</div>` : emptyState('flag', 'No referrals recorded', 'Keep referral destination, reason, response and follow-up notes connected to this patient.', button('New referral', 'open-referral', 'plus', 'primary'))}`; }
  if (tab === 'attachments') { const attachments = active(state.attachments).filter((a) => a.patientId === patient.id).sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || '')); return `<div class="section-heading"><div><h2>Attachments</h2><p>Keep X-rays, reports, prescriptions and clinical documents with the patient record.</p></div>${button('Attach file', 'attach-file', 'upload', 'secondary', `data-patient-id="${patient.id}"`)}<input class="visually-hidden" type="file" id="patient-attachment-file" accept="image/png,image/jpeg,image/webp,application/pdf,text/plain" data-input="patient-attachment-file"></div>${attachments.length ? `<div class="attachment-grid">${attachments.map((a) => `<article class="attachment-card"><div class="attachment-icon">${icon(a.type?.startsWith('image/') ? 'eye' : 'file', 19)}</div><div class="attachment-info"><strong title="${attr(a.name)}">${esc(a.name)}</strong><small>${esc(a.category || 'Clinical document')} · ${formatBytes(a.size)} · ${date(a.createdAt?.slice(0, 10))}</small></div><div class="attachment-actions"><button class="icon-button tiny" data-action="download-attachment" data-id="${a.id}" aria-label="Download attachment">${icon('download', 15)}</button><button class="icon-button tiny" data-action="delete-attachment" data-id="${a.id}" aria-label="Remove attachment">${icon('trash', 15)}</button></div></article>`).join('')}</div>` : emptyState('file', 'No attachments yet', 'Upload an X-ray, lab report, image or PDF. Files stay on this device and are included in the structured backup.', button('Attach file', 'attach-file', 'upload', 'primary', `data-patient-id="${patient.id}"`))}`; }
  if (tab === 'timeline') return `<div class="section-heading"><div><h2>Patient timeline</h2><p>Administrative and clinical activity in chronological order.</p></div></div>${renderTimeline(patient)}`;
  return `<div class="profile-overview-grid"><div class="card inset-card"><div class="section-heading compact"><h2>Patient details</h2>${button('Edit', 'edit-patient', 'edit', 'link', `data-id="${patient.id}"`)}</div><dl class="detail-list"><div><dt>Preferred name</dt><dd>${esc(patient.preferredName || 'Not recorded')}</dd></div><div><dt>Phone</dt><dd>${esc(patient.phone || 'Not recorded')}</dd></div><div><dt>Email</dt><dd>${esc(patient.email || 'Not recorded')}</dd></div><div><dt>Address</dt><dd>${esc(patient.address || 'Not recorded')}</dd></div><div><dt>Emergency contact</dt><dd>${esc(patient.emergencyContact || 'Not recorded')}${patient.emergencyPhone ? ` · ${esc(patient.emergencyPhone)}` : ''}</dd></div></dl></div><div class="card inset-card"><div class="section-heading compact"><h2>Clinical context</h2><span class="soft-label">Private</span></div><dl class="detail-list"><div><dt>Blood group</dt><dd>${esc(patient.bloodGroup || 'Not recorded')}</dd></div><div><dt>Allergies</dt><dd class="${patient.allergies ? 'text-warning' : ''}">${esc(patient.allergies || 'None recorded')}</dd></div><div><dt>Chronic conditions</dt><dd>${esc(patient.chronicConditions || 'None recorded')}</dd></div><div><dt>Current medications</dt><dd>${esc(patient.currentMedications || 'None recorded')}</dd></div></dl></div><div class="card inset-card wide"><div class="section-heading compact"><h2>Recent activity</h2>${button('Full timeline', 'patient-tab', 'arrow', 'link', 'data-tab="timeline"')}</div>${data.visits.slice(0, 3).length ? data.visits.slice(0, 3).map((v) => `<div class="activity-row"><span class="activity-dot">${icon('activity', 14)}</span><div><strong>${esc(v.reason || 'Clinical visit')}</strong><small>${date(v.date)} · ${esc(v.treatmentPerformed || v.diagnosis || 'Notes recorded')}</small></div></div>`).join('') : emptyState('activity', 'No activity yet', 'Visits, appointments, payments and referrals will build this history.')}</div></div>`;
}
function renderMiniDentalChart(patient) {
  const records = state.dentalRecords.filter((r) => r.patientId === patient.id);
  const statuses = Object.fromEntries(records.map((r) => [r.tooth, r.status]));
  return `<div class="mini-dental-chart"><div class="teeth-row">${[18, 17, 16, 15, 14, 13, 12, 11, 21, 22, 23, 24, 25, 26, 27, 28].map((tooth) => toothButton(tooth, statuses[tooth])).join('')}</div><div class="arch-label">Upper arch · FDI numbering</div><div class="arch-label lower">Lower arch · FDI numbering</div><div class="teeth-row lower-teeth">${[48, 47, 46, 45, 44, 43, 42, 41, 31, 32, 33, 34, 35, 36, 37, 38].map((tooth) => toothButton(tooth, statuses[tooth])).join('')}</div><div class="chart-legend"><span><i class="legend-dot healthy"></i>Healthy / unrecorded</span><span><i class="legend-dot caries"></i>Caries</span><span><i class="legend-dot filled"></i>Restored</span><span><i class="legend-dot missing"></i>Missing</span></div></div>`;
}
function toothButton(tooth, status = '') { return `<button class="tooth ${status ? `tooth-${status.toLowerCase().replace(' ', '-')}` : ''}" data-action="select-tooth" data-tooth="${tooth}" title="Tooth ${tooth} — ${status || 'No record'}"><span>${tooth}</span>${icon('tooth', 22)}</button>`; }
function renderTimeline(patient) {
  const events = [
    ...active(state.visits).filter((v) => v.patientId === patient.id).map((v) => ({ date: v.date, icon: 'activity', title: v.reason || 'Clinical visit', text: v.diagnosis || v.treatmentPerformed || 'Clinical note recorded' })),
    ...active(state.appointments).filter((a) => a.patientId === patient.id).map((a) => ({ date: a.date, icon: 'calendar', title: `${a.status || 'Scheduled'} appointment`, text: a.reason || 'Appointment' })),
    ...active(state.payments).filter((p) => p.patientId === patient.id).map((p) => ({ date: p.date, icon: 'credit', title: 'Payment recorded', text: `${currency(p.amount)} · ${p.method || 'Payment method not set'}` }))
  ].filter((event) => event.date).sort((a, b) => b.date.localeCompare(a.date));
  return events.length ? `<div class="timeline-stream">${events.map((event) => `<div class="stream-item"><span class="stream-icon">${icon(event.icon, 16)}</span><div><strong>${esc(event.title)}</strong><p>${esc(event.text)}</p><small>${date(event.date)}</small></div></div>`).join('')}</div>` : emptyState('clock', 'Timeline is empty', 'Patient activity will appear here as records are created.');
}

function renderAppointments() {
  const monthAppointments = active(state.appointments).filter((a) => { const d = new Date(`${a.date}T00:00:00`); return d.getMonth() === ui.calendarMonth && d.getFullYear() === ui.calendarYear; });
  const upcoming = active(state.appointments).filter((a) => a.date >= today()).sort((a, b) => `${a.date}${a.time}`.localeCompare(`${b.date}${b.time}`)).slice(0, 12);
  const calendar = calendarGrid(monthAppointments);
  return `<div class="page">${pageHeader('Appointments', 'Plan the day, protect chair time and keep patients informed.', button('New appointment', 'open-appointment', 'plus', 'primary'))}<div class="view-tabs"><button class="active">Calendar</button><button data-action="navigate" data-page="queue">Today’s list</button></div><div class="calendar-layout"><section class="card calendar-card"><div class="calendar-toolbar"><button class="icon-button bordered" data-action="calendar-prev" aria-label="Previous month">${icon('chevron', 16, 'rotate-180')}</button><h2>${monthLabel()}</h2><button class="icon-button bordered" data-action="calendar-next" aria-label="Next month">${icon('chevron', 16)}</button><button class="today-button" data-action="calendar-today">Today</button></div>${calendar}</section><section class="card upcoming-card">${cardTitle('clock', 'Upcoming appointments', button('View queue', 'navigate', 'arrow', 'link', 'data-page="queue"'))}<div class="upcoming-list">${upcoming.length ? upcoming.map((a) => `<div class="upcoming-row" data-action="edit-appointment" data-id="${a.id}"><div class="date-tile"><strong>${new Date(`${a.date}T00:00:00`).getDate()}</strong><small>${new Intl.DateTimeFormat('en-US', { month: 'short' }).format(new Date(`${a.date}T00:00:00`))}</small></div><div><strong>${esc(patientName(a.patientId))}</strong><small>${time(a.time)} · ${esc(a.reason || 'Appointment')}</small></div>${statusBadge(a.status || 'Scheduled')}</div>`).join('') : emptyState('calendar', 'No upcoming appointments', 'Book the next visit from here.', button('Book appointment', 'open-appointment', 'plus', 'secondary'))}</div></section></div><section class="card calendar-note"><div class="note-icon">${icon('shield', 19)}</div><div><strong>Scheduling guardrails are on</strong><p>Appointments keep their patient, duration, dentist and chair context. Double-booking is flagged for review before saving.</p></div><button class="text-button" data-action="navigate" data-page="settings">Configure${icon('arrow', 14)}</button></section></div>`;
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
  return `<div class="page">${pageHeader('Today’s Queue', 'A calm, live view of arrivals and chair flow.', `${button('Print queue', 'print-queue', 'printer', 'secondary')}${button('Check in patient', 'open-appointment', 'plus', 'primary')}`)}<section class="queue-hero"><div class="queue-hero-copy"><span class="eyebrow">${date(today(), { weekday: 'long', day: 'numeric', month: 'long' })}</span><h2>${activeQueue.length ? `${activeQueue.length} patient${activeQueue.length === 1 ? '' : 's'} in motion` : 'Your queue is clear'}</h2><p>${activeQueue.length ? 'Use status changes to keep reception and the clinical team aligned.' : 'Appointments checked in today will appear in this workspace.'}</p></div><div class="queue-hero-ring"><strong>${queue.length}</strong><span>today</span></div></section><section class="card table-card queue-table-card">${queue.length ? dataTable(['Serial', 'Patient', 'Appointment', 'Reason', 'Dentist / chair', 'Status', ''], queue.map((a, index) => `<tr><td><span class="serial-number">${esc(a.serial || `${state.settings.serialPrefix}-${String(index + 1).padStart(3, '0')}`)}</span></td><td><div class="person-cell"><span class="avatar avatar-table">${initials(patientName(a.patientId))}</span><div><strong>${esc(patientName(a.patientId))}</strong><small>${esc(byId(state.patients, a.patientId)?.patientCode || 'Patient')}</small></div></div></td><td><strong>${time(a.time)}</strong><small class="cell-sub">${a.duration || 30} min</small></td><td>${esc(a.reason || '—')}</td><td>${esc(staffName(a.dentistId))}<small class="cell-sub">${esc(a.chair || 'Chair 1')}</small></td><td><button class="status-select" data-action="cycle-queue-status" data-id="${a.id}">${statusBadge(a.status || 'Scheduled')}${icon('down', 13)}</button></td><td><button class="icon-button tiny" data-action="edit-appointment" data-id="${a.id}">${icon('more', 17)}</button></td></tr>`).join('')) : emptyState('clipboard', 'No appointments in today’s queue', 'Schedule a patient to start the day’s serial list.', button('New appointment', 'open-appointment', 'plus', 'primary'))}</section></div>`;
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
  const collected = sum(active(state.payments), (p) => p.amount);
  const due = Math.max(0, total - collected);
  return `<div class="page">${pageHeader('Billing', 'Invoices, estimates and balances with a clear source of truth.', `${button('Print statement', 'print-billing', 'printer', 'secondary')}${button('New invoice', 'open-invoice', 'plus', 'primary')}`)}<div class="finance-summary"><div><span>Total billed</span><strong>${currency(total)}</strong><small>${invoices.length} invoice${invoices.length === 1 ? '' : 's'}</small></div><div><span>Collected</span><strong class="text-success">${currency(collected)}</strong><small>Valid recorded payments</small></div><div><span>Outstanding</span><strong class="text-warning">${currency(due)}</strong><small>Requires follow-up</small></div><div><span>Paid rate</span><strong>${total ? Math.round((collected / total) * 100) : 0}%</strong><small>Collected ÷ billed</small></div></div><section class="card table-card">${invoices.length ? dataTable(['Invoice', 'Patient', 'Date', 'Items', 'Total', 'Due', 'Status', ''], invoices.map((i) => `<tr><td><span class="code-label">${esc(i.invoiceNumber)}</span></td><td><div class="person-cell"><span class="avatar avatar-table">${initials(patientName(i.patientId))}</span><strong>${esc(patientName(i.patientId))}</strong></div></td><td>${date(i.date)}</td><td>${number(i.items?.length || 0)} item${i.items?.length === 1 ? '' : 's'}</td><td><strong>${currency(i.total)}</strong></td><td class="${i.due > 0 ? 'text-warning' : ''}">${currency(i.due)}</td><td>${statusBadge(i.status)}</td><td><div class="row-actions">${button('Print', 'print-invoice', 'printer', 'link', `data-id="${i.id}"`)}<button class="icon-button tiny" data-action="open-payment" data-invoice-id="${i.id}">${icon('credit', 16)}</button></div></td></tr>`).join('')) : emptyState('receipt', 'No invoices created', 'Create an invoice after a visit or treatment plan. Payments will be linked to it.', button('New invoice', 'open-invoice', 'plus', 'primary'))}</section><section class="card financial-note"><span>${icon('shield', 18)}</span><p><strong>Financial integrity</strong> Totals are calculated from invoice line items, discounts, configured taxes and valid payments. Historical payments should be reversed with a new adjustment rather than silently edited.</p></section></div>`;
}
function renderPayments() {
  const payments = active(state.payments).sort((a, b) => `${b.date}${b.createdAt}`.localeCompare(`${a.date}${a.createdAt}`));
  return `<div class="page">${pageHeader('Payments', 'A traceable register of every collection and receipt.', button('Record payment', 'open-payment', 'plus', 'primary'))}<section class="payment-method-strip">${['Cash', 'Bank', 'Card', 'bKash', 'Nagad', 'Rocket', 'Other'].map((method) => `<div><span class="payment-method-icon">${icon(method === 'Cash' ? 'dollar' : method === 'Card' ? 'credit' : 'layers', 17)}</span><div><strong>${currency(sum(payments.filter((p) => p.method === method), (p) => p.amount))}</strong><small>${method}</small></div></div>`).join('')}</section><section class="card table-card">${payments.length ? dataTable(['Receipt', 'Date', 'Patient', 'Invoice', 'Method', 'Reference', 'Amount', ''], payments.map((p) => `<tr><td><span class="code-label">${esc(p.receiptNumber || 'Receipt')}</span></td><td>${date(p.date)}</td><td><div class="person-cell"><span class="avatar avatar-table">${initials(patientName(p.patientId))}</span><strong>${esc(patientName(p.patientId))}</strong></div></td><td>${esc(byId(state.invoices, p.invoiceId)?.invoiceNumber || 'On account')}</td><td>${esc(p.method || '—')}</td><td>${esc(p.reference || p.transactionId || '—')}</td><td><strong>${currency(p.amount)}</strong></td><td>${button('Print', 'print-payment', 'printer', 'link', `data-id="${p.id}"`)}</td></tr>`).join('')) : emptyState('credit', 'No payments recorded', 'Record cash, bank, card or mobile financial service payments here.', button('Record payment', 'open-payment', 'plus', 'primary'))}</section></div>`;
}

function renderInventory() {
  const items = active(state.inventory).sort((a, b) => (a.name || '').localeCompare(b.name || ''));
  const low = items.filter((item) => Number(item.currentStock) <= Number(item.minimumStock || state.settings.lowStockThreshold));
  const expired = items.filter((item) => item.expiryDate && item.expiryDate < today());
  return `<div class="page">${pageHeader('Inventory', 'Keep materials, medicines and consumables accountable.', `${button('Stock movement', 'open-stock', 'plus', 'primary')}${button('Export CSV', 'export-inventory', 'download', 'secondary')}`)}<div class="inventory-alerts"><div class="inventory-alert ${low.length ? 'has-alert' : ''}"><span>${icon('box', 18)}</span><div><strong>${low.length ? `${low.length} low-stock item${low.length > 1 ? 's' : ''}` : 'Stock levels look good'}</strong><small>${low.length ? 'Review reorder levels below.' : 'No reorder action is needed.'}</small></div></div><div class="inventory-alert ${expired.length ? 'has-alert danger-alert' : ''}"><span>${icon('clock', 18)}</span><div><strong>${expired.length ? `${expired.length} expired item${expired.length > 1 ? 's' : ''}` : 'No expired stock'}</strong><small>${expired.length ? 'Quarantine and record a movement.' : 'Expiry dates are within range.'}</small></div></div></div><section class="card table-card">${items.length ? dataTable(['Item', 'Category', 'Supplier', 'Current stock', 'Reorder at', 'Expiry', 'Batch / lot', 'Status', ''], items.map((item) => { const alert = Number(item.currentStock) <= Number(item.minimumStock || state.settings.lowStockThreshold); const expiredItem = item.expiryDate && item.expiryDate < today(); return `<tr><td><div class="item-cell"><span class="item-icon">${icon('box', 16)}</span><div><strong>${esc(item.name)}</strong><small>${esc(item.itemCode || '')} · ${esc(item.unit || 'unit')}</small></div></div></td><td>${esc(item.category || 'Uncategorised')}</td><td>${esc(byId(state.suppliers, item.supplierId)?.name || '—')}</td><td><strong class="${alert ? 'text-warning' : ''}">${number(item.currentStock)}</strong> ${esc(item.unit || '')}</td><td>${number(item.minimumStock || 0)}</td><td class="${expiredItem ? 'text-danger' : ''}">${item.expiryDate ? date(item.expiryDate) : '—'}</td><td>${esc(item.batch || '—')}</td><td>${statusBadge(expiredItem ? 'Expired' : alert ? 'Low stock' : 'In stock')}</td><td><button class="icon-button tiny" data-action="edit-stock" data-id="${item.id}">${icon('edit', 16)}</button></td></tr>`; }).join('')) : emptyState('box', 'Inventory is empty', 'Add your first medicine, material or consumable to start tracking stock.', button('Add stock item', 'open-stock', 'plus', 'primary'))}</section></div>`;
}
function renderSuppliers() {
  const suppliers = active(state.suppliers).sort((a, b) => (a.name || '').localeCompare(b.name || ''));
  return `<div class="page">${pageHeader('Suppliers', 'Keep purchasing contacts and stock relationships in one place.', button('Add supplier', 'open-supplier', 'plus', 'primary'))}<section class="card supplier-grid">${suppliers.length ? suppliers.map((s) => `<article class="supplier-card"><div class="supplier-avatar">${initials(s.name)}</div><div class="supplier-card-head"><div><h3>${esc(s.name)}</h3><span>${esc(s.contactPerson || 'Contact not recorded')}</span></div><button class="icon-button tiny" data-action="edit-supplier" data-id="${s.id}">${icon('more', 17)}</button></div><div class="supplier-details">${s.phone ? `<span>${icon('phone', 13)}${esc(s.phone)}</span>` : ''}${s.email ? `<span>${icon('mail', 13)}${esc(s.email)}</span>` : ''}${s.address ? `<span>${icon('map', 13)}${esc(s.address)}</span>` : ''}</div><div class="supplier-footer"><span>${number(state.inventory.filter((i) => i.supplierId === s.id).length)} stock items</span>${button('Edit supplier', 'edit-supplier', 'edit', 'link', `data-id="${s.id}"`)}</div></article>`).join('') : `<div class="supplier-empty">${emptyState('truck', 'No suppliers added', 'Store purchasing contacts here so inventory remains traceable.', button('Add supplier', 'open-supplier', 'plus', 'primary'))}</div>`}</section></div>`;
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
  const collected = sum(active(state.payments), (p) => p.amount);
  const billed = sum(active(state.invoices), (i) => i.total);
  const costs = sum(expenses, (e) => e.amount);
  const categories = [...new Set(expenses.map((e) => e.category).filter(Boolean))];
  return `<div class="page">${pageHeader('Accounting & finance', 'A dedicated financial workspace—separate from the clinical dashboard.', `${button('Add expense', 'open-expense', 'plus', 'secondary')}${button('New invoice', 'open-invoice', 'plus', 'primary')}`)}<div class="finance-summary accounting-summary"><div><span>Collected</span><strong class="text-success">${currency(collected)}</strong><small>Valid patient payments</small></div><div><span>Invoiced</span><strong>${currency(billed)}</strong><small>Active invoice totals</small></div><div><span>Operating expenses</span><strong class="text-warning">${currency(costs)}</strong><small>${number(expenses.length)} expense entries</small></div><div><span>Net operating result</span><strong class="${collected - costs >= 0 ? 'text-success' : 'text-danger'}">${currency(collected - costs)}</strong><small>Collected minus expenses</small></div></div><section class="accounting-grid"><section class="card accounting-breakdown">${cardTitle('chart', 'Expense categories')} ${categories.length ? `<div class="category-bars">${categories.map((category) => { const amount = sum(expenses.filter((e) => e.category === category), (e) => e.amount); const width = costs ? Math.max(4, Math.round((amount / costs) * 100)) : 0; return `<div class="category-bar"><div><span>${esc(category)}</span><strong>${currency(amount)}</strong></div><div class="bar-track"><i style="width:${width}%"></i></div></div>`; }).join('')}</div>` : emptyState('chart', 'No expenses recorded', 'Add clinic operating costs to see a transparent breakdown.', button('Add expense', 'open-expense', 'plus', 'secondary'))}</section><section class="card accounting-shortcuts">${cardTitle('receipt', 'Finance shortcuts')}<div class="finance-links"><button data-action="navigate" data-page="billing">${icon('receipt', 17)}<span><strong>Billing & invoices</strong><small>View totals and outstanding</small></span>${icon('arrow', 14)}</button><button data-action="navigate" data-page="payments">${icon('credit', 17)}<span><strong>Payments</strong><small>Trace collections and receipts</small></span>${icon('arrow', 14)}</button><button data-action="navigate" data-page="reports">${icon('chart', 17)}<span><strong>Financial reports</strong><small>Revenue, expenses and net result</small></span>${icon('arrow', 14)}</button></div></section></section><section class="card table-card">${expenses.length ? dataTable(['Date', 'Description', 'Category', 'Method', 'Reference', 'Amount', ''], expenses.map((e) => `<tr><td>${date(e.date)}</td><td><strong>${esc(e.description)}</strong><small class="cell-sub">${esc(e.notes || '')}</small></td><td>${esc(e.category || 'Other')}</td><td>${esc(e.method || '—')}</td><td>${esc(e.reference || '—')}</td><td><strong>${currency(e.amount)}</strong></td><td><button class="icon-button tiny" data-action="print-expense" data-id="${e.id}">${icon('printer', 16)}</button></td></tr>`).join('')) : emptyState('dollar', 'No expenses recorded', 'Record rent, supplies, salaries and other operating costs here.', button('Add expense', 'open-expense', 'plus', 'primary'))}</section></div>`;
}

function renderReports() {
  const report = buildReport(ui.reportType, ui.reportsRange);
  const reportOptions = [['revenue', 'Revenue & collections'], ['patients', 'Patient register'], ['visits', 'Visit activity'], ['appointments', 'Appointments'], ['outstanding', 'Outstanding balances'], ['inventory', 'Inventory status'], ['expenses', 'Expenses']];
  return `<div class="page">${pageHeader('Reports', 'Accurate operational and financial views built from your records.', `${button('Print report', 'print-report', 'printer', 'secondary')}${button('Export CSV', 'export-report', 'download', 'primary')}`)}<section class="card report-controls"><label><span>Report</span><select data-change="report-type">${reportOptions.map(([id, label]) => `<option value="${id}" ${ui.reportType === id ? 'selected' : ''}>${label}</option>`).join('')}</select></label><label><span>Date range</span><select data-change="report-range"><option value="7d" ${ui.reportsRange === '7d' ? 'selected' : ''}>Last 7 days</option><option value="month" ${ui.reportsRange === 'month' ? 'selected' : ''}>This month</option><option value="quarter" ${ui.reportsRange === 'quarter' ? 'selected' : ''}>This quarter</option><option value="year" ${ui.reportsRange === 'year' ? 'selected' : ''}>This year</option><option value="all" ${ui.reportsRange === 'all' ? 'selected' : ''}>All records</option></select></label><div class="report-date-note">${icon('clock', 15)} ${report.from ? `${date(report.from)} — ${date(report.to)}` : 'All available records'}</div></section><section class="report-kpi-grid">${report.kpis.map((kpi) => `<div class="report-kpi"><span>${icon(kpi.icon, 17)}${esc(kpi.label)}</span><strong>${esc(kpi.value)}</strong><small>${esc(kpi.note)}</small></div>`).join('')}</section><section class="report-grid"><div class="card report-main">${cardTitle('chart', report.title, badge(report.from ? `${date(report.from, { month: 'short', day: 'numeric' })} – ${date(report.to, { month: 'short', day: 'numeric' })}` : 'All time', 'neutral'))}${report.body}</div><div class="card report-side">${cardTitle('activity', 'Report notes')}<ul class="report-notes"><li>Amounts use the same invoice and payment calculations as Billing.</li><li>Clinical reports are record-keeping tools, not medical advice.</li><li>Exported CSV files use UTF-8 encoding for Bengali compatibility.</li></ul>${button('Open data management', 'navigate', 'arrow', 'link', 'data-page="backup"')}</div></section></div>`;
}
function dateRange(range) {
  const to = today(); const end = new Date(`${to}T00:00:00`); let start = null;
  if (range === '7d') start = new Date(end.getTime() - 6 * 86400000);
  if (range === 'month') start = new Date(end.getFullYear(), end.getMonth(), 1);
  if (range === 'quarter') start = new Date(end.getFullYear(), end.getMonth() - 2, 1);
  if (range === 'year') start = new Date(end.getFullYear(), 0, 1);
  return { from: start ? start.toISOString().slice(0, 10) : null, to };
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
    const dueInvoices = invoices.filter((i) => Number(i.due) > 0); const due = sum(dueInvoices, (i) => i.due); base.title = 'Outstanding balances'; base.kpis = [{ label: 'Outstanding', value: currency(due), note: 'Open invoice balance', icon: 'credit' }, { label: 'Open invoices', value: number(dueInvoices.length), note: 'Require collection', icon: 'receipt' }, { label: 'Partially paid', value: number(dueInvoices.filter((i) => i.paid > 0).length), note: 'Partially collected', icon: 'activity' }, { label: 'Unpaid', value: number(dueInvoices.filter((i) => !i.paid).length), note: 'No payment recorded', icon: 'warning' }]; base.body = reportTable(['Invoice', 'Patient', 'Date', 'Total', 'Paid', 'Due'], dueInvoices.map((i) => [i.invoiceNumber, patientName(i.patientId), date(i.date), currency(i.total), currency(i.paid), currency(i.due)]));
  } else if (type === 'inventory') {
    const items = active(state.inventory); const low = items.filter((i) => Number(i.currentStock) <= Number(i.minimumStock || state.settings.lowStockThreshold)); base.title = 'Inventory status'; base.kpis = [{ label: 'Items tracked', value: number(items.length), note: 'Active stock items', icon: 'box' }, { label: 'Low stock', value: number(low.length), note: 'At or below reorder', icon: 'warning' }, { label: 'Expired', value: number(items.filter((i) => i.expiryDate && i.expiryDate < today()).length), note: 'Requires action', icon: 'clock' }, { label: 'Units on hand', value: number(sum(items, (i) => i.currentStock)), note: 'Across all units', icon: 'layers' }]; base.body = reportTable(['Item', 'Category', 'Current stock', 'Reorder at', 'Expiry', 'Status'], items.map((i) => [i.name, i.category || '—', `${i.currentStock} ${i.unit || ''}`, i.minimumStock || 0, i.expiryDate ? date(i.expiryDate) : '—', Number(i.currentStock) <= Number(i.minimumStock || state.settings.lowStockThreshold) ? 'Low stock' : 'In stock']));
  } else if (type === 'expenses') {
    const total = sum(expenses, (e) => e.amount); base.title = 'Expense report'; base.kpis = [{ label: 'Expenses', value: currency(total), note: 'Recorded operating costs', icon: 'dollar' }, { label: 'Transactions', value: number(expenses.length), note: 'Expense entries', icon: 'receipt' }, { label: 'Categories', value: number(new Set(expenses.map((e) => e.category)).size), note: 'Categories used', icon: 'layers' }, { label: 'Average', value: currency(expenses.length ? total / expenses.length : 0), note: 'Per transaction', icon: 'chart' }]; base.body = reportTable(['Date', 'Category', 'Description', 'Method', 'Amount'], expenses.map((e) => [date(e.date), e.category || 'Other', e.description || '—', e.method || '—', currency(e.amount)]));
  } else {
    const collected = sum(payments, (p) => p.amount); const billed = sum(invoices, (i) => i.total); const expenseTotal = sum(expenses, (e) => e.amount); base.title = 'Revenue & collections'; base.kpis = [{ label: 'Collected', value: currency(collected), note: 'Valid payments', icon: 'credit' }, { label: 'Billed', value: currency(billed), note: 'Invoice totals', icon: 'receipt' }, { label: 'Expenses', value: currency(expenseTotal), note: 'Operating expenses', icon: 'dollar' }, { label: 'Net operating', value: currency(collected - expenseTotal), note: 'Collected minus expenses', icon: 'chart' }]; base.body = reportTable(['Date', 'Patient', 'Invoice', 'Method', 'Amount'], payments.map((p) => [date(p.date), patientName(p.patientId), byId(state.invoices, p.invoiceId)?.invoiceNumber || 'On account', p.method || '—', currency(p.amount)]));
  }
  return base;
}
function reportTable(headers, rows) { return rows.length ? `<div class="report-table-wrap">${dataTable(headers, rows.map((row) => `<tr>${row.map((value) => `<td>${esc(value)}</td>`).join('')}</tr>`).join(''))}</div>` : emptyState('chart', 'No records in this range', 'Change the date range or create records to populate this report.'); }

function renderBackup() {
  const storageBytes = new Blob([JSON.stringify(state)]).size;
  const last = state.lastBackupAt;
  const candidate = ui.restoreCandidate;
  return `<div class="page">${pageHeader('Backup & restore', 'Protect the complete local record, including settings and relationships.', `${button('Export full backup', 'export-backup', 'download', 'primary')}${button('Import backup', 'trigger-import', 'upload', 'secondary')}`)}<div class="backup-hero"><div class="backup-hero-icon">${icon('shield', 27)}</div><div><span class="eyebrow">LOCAL-FIRST PROTECTION</span><h2>Your records belong to your practice</h2><p>Backups are structured JSON packages with schema version, record counts and audit metadata. Keep copies on a trusted device or encrypted drive.</p></div><div class="backup-status">${last ? `<span class="status-check">${icon('check', 15)}</span><strong>Verified</strong><small>${date(last.slice(0, 10))}</small>` : `<span class="status-check neutral">${icon('backup', 15)}</span><strong>Not yet backed up</strong><small>Start with an export</small>`}</div></div><div class="backup-grid"><section class="card backup-card">${cardTitle('download', 'Create a backup') }<p>Exports all clinical, financial, operational and configuration records in one portable package.</p><div class="backup-facts"><div><span>Records</span><strong>${number(totalRecords())}</strong></div><div><span>Storage</span><strong>${formatBytes(storageBytes)}</strong></div><div><span>Schema</span><strong>v${state.schemaVersion}</strong></div></div>${button('Export verified backup', 'export-backup', 'download', 'primary')} ${button('Export patients CSV', 'export-patients', 'file', 'link')}</section><section class="card backup-card">${cardTitle('upload', 'Restore or import') }<p>Validate a Dentiva Pro backup before committing. Existing records are never silently overwritten.</p><div class="restore-drop" data-action="trigger-import"><span>${icon('upload', 22)}</span><strong>Choose a backup file</strong><small>JSON backup · exported from Dentiva Pro</small></div><input id="backup-file" type="file" accept=".json,.dentiva,.csv" class="visually-hidden" data-input="backup-file">${candidate ? renderRestoreCandidate(candidate) : ''}</section></div><section class="card data-health">${cardTitle('activity', 'Data management') }<div class="health-list"><div><span>${icon('database', 17)}</span><div><strong>Database health</strong><small>Local store schema v${state.schemaVersion} · ${number(state.audit.length)} audit entries</small></div><span class="health-ok">Healthy</span></div><div><span>${icon('box', 17)}</span><div><strong>Attachment storage</strong><small>Managed file references: ${number(state.attachments.length)}</small></div><span class="health-ok">Ready</span></div><div><span>${icon('refresh', 17)}</span><div><strong>Last operation</strong><small>${state.audit[0] ? `${esc(state.audit[0].action)} · ${date(state.audit[0].at.slice(0, 10))}` : 'No operations recorded yet'}</small></div><button class="text-button" data-action="integrity-check">Run check${icon('arrow', 14)}</button></div></div></section></div>`;
}
function totalRecords() { return arrayKeys.reduce((total, key) => total + state[key].length, 0); }
function formatBytes(bytes) { if (!bytes) return '0 B'; const units = ['B', 'KB', 'MB', 'GB']; const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1); return `${(bytes / Math.pow(1024, index)).toFixed(index ? 1 : 0)} ${units[index]}`; }
function renderRestoreCandidate(candidate) { return `<div class="restore-preview"><div class="restore-preview-head"><div><span class="eyebrow">IMPORT PREVIEW</span><strong>${esc(candidate.name)}</strong><small>${esc(candidate.product || 'Unknown product')} · schema ${esc(candidate.schemaVersion || '?')}</small></div><button class="icon-button" data-action="clear-restore">${icon('close', 15)}</button></div><div class="restore-summary"><div><strong>${number(candidate.total)}</strong><span>records detected</span></div><div><strong>${number(candidate.conflicts)}</strong><span>possible conflicts</span></div><div><strong>${number(candidate.errors)}</strong><span>validation errors</span></div></div><div class="restore-options"><label>Conflict strategy<select data-change="restore-strategy"><option>Keep Existing</option><option>Skip</option><option>Replace</option><option>Create New Copy</option></select></label><label class="check-line"><input type="checkbox" checked data-change="restore-patients"> Patients (${candidate.counts.patients || 0})</label><label class="check-line"><input type="checkbox" checked data-change="restore-clinical"> Clinical & appointments</label><label class="check-line"><input type="checkbox" checked data-change="restore-finance"> Billing & finance</label><label class="check-line"><input type="checkbox" checked data-change="restore-operations"> Inventory, suppliers & staff</label><label class="check-line"><input type="checkbox" checked data-change="restore-settings"> Settings & audit</label></div>${candidate.errors ? `<p class="inline-error">Some records need review before import.</p>` : ''}${button('Validate and restore selection', 'restore-confirm', 'check', 'primary')}</div>`; }

function renderSettings() {
  const s = state.settings;
  return `<div class="page settings-page">${pageHeader('Settings', 'Configure the practice once, then keep the workflow consistent.', button('Save settings', 'save-settings', 'check', 'primary'))}<div class="settings-layout"><nav class="settings-nav"><div class="active">${icon('grid', 16)}General</div><div>${icon('users', 16)}Clinic & doctor</div><div>${icon('calendar', 16)}Appointments</div><div>${icon('receipt', 16)}Billing & payments</div><div>${icon('box', 16)}Inventory</div><div>${icon('printer', 16)}Printing</div><div>${icon('shield', 16)}Security</div><div>${icon('bell', 16)}Notifications</div></nav><section class="settings-content"><section class="card settings-card"><div class="settings-section-head"><div><span class="eyebrow">CLINIC IDENTITY</span><h2>Make every document feel like your practice</h2><p>Your clinic name and contact details appear on printable documents.</p></div>${s.logo ? `<img class="logo-preview" src="${attr(s.logo)}" alt="Clinic logo">` : `<div class="logo-placeholder">${icon('tooth', 20)}</div>`}</div><div class="form-grid two"><label class="field-label">Clinic / practice name<input name="clinicName" value="${attr(s.clinicName)}" data-settings></label><label class="field-label">Chamber / branch<input name="chamberName" value="${attr(s.chamberName)}" data-settings></label><label class="field-label">Dentist name<input name="dentistName" value="${attr(s.dentistName)}" data-settings></label><label class="field-label">Professional title<input name="professionalTitle" value="${attr(s.professionalTitle)}" data-settings></label><label class="field-label">Phone<input name="phone" value="${attr(s.phone)}" data-settings></label><label class="field-label">Email<input name="email" value="${attr(s.email)}" data-settings></label><label class="field-label full">Address<textarea name="address" rows="2" data-settings>${attr(s.address)}</textarea></label><label class="field-label">City<input name="city" value="${attr(s.city)}" data-settings></label><label class="field-label">District<input name="district" value="${attr(s.district)}" data-settings></label></div></section><section class="card settings-card"><div class="settings-section-head"><div><span class="eyebrow">LOCALIZATION</span><h2>Use the language your team understands</h2><p>Data remains language-neutral; only labels and formatting change.</p></div></div><div class="form-grid two"><label class="field-label">Default language<select name="language" data-settings><option ${s.language === 'English' ? 'selected' : ''}>English</option><option ${s.language === 'Bengali' ? 'selected' : ''}>Bengali</option></select></label><label class="field-label">Currency<select name="currency" data-settings><option ${s.currency === 'BDT' ? 'selected' : ''}>BDT</option><option ${s.currency === 'USD' ? 'selected' : ''}>USD</option></select></label><label class="field-label">Timezone<select name="timezone" data-settings><option>Asia/Dhaka</option><option>Asia/Kolkata</option><option>UTC</option></select></label><label class="field-label">Date format<select name="dateFormat" data-settings><option>dd MMM yyyy</option><option>dd/MM/yyyy</option><option>yyyy-MM-dd</option></select></label><label class="field-label">Time format<select name="timeFormat" data-settings><option ${s.timeFormat === '12-hour' ? 'selected' : ''}>12-hour</option><option ${s.timeFormat === '24-hour' ? 'selected' : ''}>24-hour</option></select></label></div></section><section class="card settings-card"><div class="settings-section-head"><div><span class="eyebrow">NUMBERING & CONTROL</span><h2>Keep records identifiable</h2><p>Prefixes apply to future records and do not rewrite history.</p></div></div><div class="form-grid three"><label class="field-label">Patient code prefix<input name="patientPrefix" value="${attr(s.patientPrefix)}" data-settings></label><label class="field-label">Invoice prefix<input name="invoicePrefix" value="${attr(s.invoicePrefix)}" data-settings></label><label class="field-label">Appointment prefix<input name="appointmentPrefix" value="${attr(s.appointmentPrefix)}" data-settings></label><label class="field-label">Queue serial prefix<input name="serialPrefix" value="${attr(s.serialPrefix)}" data-settings></label><label class="field-label">Default duration (min)<input type="number" min="5" name="defaultDuration" value="${attr(s.defaultDuration)}" data-settings></label><label class="field-label">Low-stock threshold<input type="number" min="0" name="lowStockThreshold" value="${attr(s.lowStockThreshold)}" data-settings></label></div></section><section class="card settings-card"><div class="settings-section-head"><div><span class="eyebrow">PRIVACY & SECURITY</span><h2>Keep the workspace private</h2><p>Local data never leaves this device through Dentiva Pro.</p></div><span class="security-pill">${icon('lock', 14)} Protected</span></div><div class="security-options"><label class="toggle-line"><input type="checkbox" ${s.notifications ? 'checked' : ''} data-settings-checkbox="notifications"><span class="toggle-ui"></span><span><strong>In-app notifications</strong><small>Show meaningful appointment, follow-up and stock signals.</small></span></label><div class="security-control"><div><strong>Application lock</strong><small>${s.applicationLock ? 'A local PIN is required when this workspace is locked.' : 'Protect this workspace with a local administrator PIN.'}</small></div><div class="security-control-actions">${s.applicationLock ? '<span class="soft-label">Enabled</span>' : ''}${button(s.applicationLock ? 'Change PIN' : 'Set application PIN', 'open-security', 'lock', 'secondary')}${s.applicationLock ? button('Disable', 'disable-lock', 'close', 'link') : ''}</div></div></div></section></section></div></div>`;
}
function renderHelp() {
  return `<div class="page">${pageHeader('Help centre', 'Clear answers for the work you do every day.', button('Open quick search', 'open-search', 'search', 'secondary'))}<section class="help-hero"><div><span class="eyebrow">DENTIVA PRO GUIDANCE</span><h2>Care for the record.<br>Keep the practice moving.</h2><p>Short, practical guidance for setting up your local workspace and building a dependable routine.</p></div><div class="help-hero-mark">${icon('tooth', 70)}</div></section><div class="help-grid"><article class="card help-card"><span class="help-card-icon">${icon('sparkle', 19)}</span><h3>Start with setup</h3><p>Add your clinic identity, prefixes and working preferences before creating documents.</p><button class="text-button" data-action="open-setup">Open setup${icon('arrow', 14)}</button></article><article class="card help-card"><span class="help-card-icon">${icon('backup', 19)}</span><h3>Protect your data</h3><p>Export verified backups regularly. Keep one copy away from the workstation.</p><button class="text-button" data-action="navigate" data-page="backup">Backup guide${icon('arrow', 14)}</button></article><article class="card help-card"><span class="help-card-icon">${icon('book', 19)}</span><h3>Use patient workspaces</h3><p>Start from a patient profile to keep encounters, dental records and balances connected.</p><button class="text-button" data-action="navigate" data-page="patients">Open patients${icon('arrow', 14)}</button></article><article class="card help-card"><span class="help-card-icon">${icon('shield', 19)}</span><h3>Clinical safety</h3><p>Dentiva Pro records professional input. Clinical judgement always remains with the dentist.</p><button class="text-button" data-action="navigate" data-page="settings">Privacy settings${icon('arrow', 14)}</button></article></div><section class="card faq-card"><div><span class="eyebrow">FREQUENTLY ASKED</span><h2>Keep the essentials close</h2></div><div class="faq-list"><details open><summary>Where is my data stored?</summary><p>In this browser or desktop profile on the local device. Dentiva Pro does not require a cloud account or send patient data to an external service.</p></details><details><summary>How do I print a document?</summary><p>Use the Print action on an invoice, payment, prescription, report or patient summary. The system opens a clean print preview where you can choose a Windows printer or Save as PDF.</p></details><details><summary>Can I use Bengali labels?</summary><p>Yes. Choose Bengali under Settings. Records remain structured and are not altered when the interface language changes.</p></details></div></section></div>`;
}
function renderAbout() {
  return `<div class="page about-page">${pageHeader('About Dentiva Pro', 'Professional dental practice management for Bangladesh.', button('Open settings', 'navigate', 'settings', 'secondary', 'data-page="settings"'))}<section class="about-hero"><div class="about-brand"><div class="about-symbol">${icon('tooth', 38)}</div><div><span class="eyebrow">DENTIVA PRO</span><h2>Calm software for serious care.</h2><p>Offline-first practice management designed for the daily rhythm of a modern dental clinic.</p></div></div><div class="version-block"><span>Version</span><strong>${APP_VERSION}</strong><small>Build 2026.09.22 · Windows x64 ready</small></div></section><div class="about-grid"><section class="card"><div class="card-heading-with-icon">${icon('layers', 18)}<h2>Built for the whole practice</h2></div><p>Patients, appointments, clinical records, dental charts, prescriptions, billing, inventory, finance, reports and verified backup workflows share one local source of truth.</p><div class="about-pills"><span>Offline-first</span><span>Light mode</span><span>Local privacy</span><span>English + Bengali</span></div></section><section class="card creator-card"><div class="creator-avatar">SK</div><div><span class="eyebrow">CREATOR</span><h2>Md. Shohan Khan</h2><p>${icon('mail', 14)} helloiamshohan@gmail.com</p><p>${icon('phone', 14)} WhatsApp · 01516591935</p></div></section></div><section class="card legal-card"><div><span class="eyebrow">LOCAL DATA PROMISE</span><h2>Your practice data stays yours.</h2><p>No paid APIs. No mandatory account. No hidden patient-data telemetry. Keep your backups under your own control.</p></div><div class="legal-mark">${icon('shield', 34)}</div></section></div>`;
}

function modal() {
  const { type, data = {} } = ui.modal;
  const modalMap = { setup: modalSetup, patient: modalPatient, appointment: modalAppointment, visit: modalVisit, prescription: modalPrescription, invoice: modalInvoice, payment: modalPayment, stock: modalStock, supplier: modalSupplier, staff: modalStaff, expense: modalExpense, treatment: modalTreatment, referral: modalReferral, security: modalSecurity, notifications: modalNotifications, search: modalSearch, user: modalUser };
  const content = modalMap[type] ? modalMap[type](data) : '';
  return `<div class="modal-backdrop" data-action="close-modal"><section class="modal-window ${type === 'search' ? 'search-modal' : ''} ${type === 'setup' ? 'setup-modal' : ''}" role="dialog" aria-modal="true" aria-label="${esc(data.title || type)}" data-modal-window><div class="modal-content">${content}</div></section></div>`;
}
function modalHead(eyebrow, title, subtitle = '') { return `<div class="modal-head"><div><span class="eyebrow">${esc(eyebrow)}</span><h2>${esc(localized(title))}</h2>${subtitle ? `<p>${esc(localized(subtitle))}</p>` : ''}</div><button class="icon-button" data-action="close-modal" aria-label="Close dialog">${icon('close', 18)}</button></div>`; }
function modalFooter(cancel = 'Cancel', save = 'Save record', saveAction = 'submit-modal') { return `<div class="modal-footer"><button class="btn btn-link" data-action="close-modal">${esc(cancel)}</button><button class="btn btn-primary" type="submit" data-submit-action="${saveAction}">${icon('check', 16)}<span>${esc(save)}</span></button></div>`; }
function field(label, name, value = '', type = 'text', extra = '') { return `<label class="field-label">${esc(localized(label))}${type === 'textarea' ? `<textarea name="${attr(name)}" ${extra}>${attr(value)}</textarea>` : `<input type="${type}" name="${attr(name)}" value="${attr(value)}" ${extra}>`}</label>`; }
function selectField(label, name, options, value = '', extra = '') { return `<label class="field-label">${esc(localized(label))}<select name="${attr(name)}" ${extra}>${options.map(([val, label]) => `<option value="${attr(val)}" ${String(val) === String(value) ? 'selected' : ''}>${esc(localized(label))}</option>`).join('')}</select></label>`; }
function patientOptions(value = '') { return active(state.patients).sort((a, b) => a.fullName.localeCompare(b.fullName)).map((p) => [p.id, `${p.patientCode || ''} · ${p.fullName}`]); }
function dentistOptions(value = '') { return [['', state.settings.dentistName || 'Primary dentist'], ...active(state.staff).filter((s) => ['Dentist', 'Manager'].includes(s.role)).map((s) => [s.id, s.name])]; }

function modalSetup(data = {}) {
  const s = state.settings; const step = data.step || 1;
  const steps = [['01', 'Practice'], ['02', 'Preferences'], ['03', 'Ready']];
  if (step === 3) return `${modalHead('SETUP COMPLETE', 'Your workspace is ready', 'Your practice identity is saved locally. You can refine every preference later in Settings.')}<div class="setup-complete"><div class="setup-complete-mark">${icon('check', 30)}</div><h3>Welcome to Dentiva Pro</h3><p>${esc(s.clinicName || 'Your practice')} is ready for its first record. Start with a patient, appointment or treatment.</p><div class="setup-next-steps"><div>${icon('users', 17)}<span>Register patients safely</span></div><div>${icon('calendar', 17)}<span>Build today’s schedule</span></div><div>${icon('backup', 17)}<span>Back up at any time</span></div></div></div><div class="modal-footer"><button class="btn btn-primary" data-action="finish-setup">Enter workspace ${icon('arrow', 16)}</button></div>`;
  return `<form data-form="setup">${modalHead('FIRST-RUN SETUP', 'Set up your practice', 'A few essentials now. Everything remains editable from Settings.')}<div class="setup-steps">${steps.map(([num, label], i) => `<div class="setup-step ${i + 1 === step ? 'active' : i + 1 < step ? 'done' : ''}"><span>${i + 1 < step ? icon('check', 13) : num}</span><small>${label}</small></div>`).join('')}</div>${step === 1 ? `<div class="form-grid two">${field('Clinic / practice name', 'clinicName', s.clinicName, 'text', 'required placeholder="e.g. Lakeview Dental Care"')}${field('Dentist name', 'dentistName', s.dentistName, 'text', 'required placeholder="e.g. Dr. Ayesha Rahman"')}${field('Professional title', 'professionalTitle', s.professionalTitle)}${field('Chamber / branch', 'chamberName', s.chamberName)}${field('Phone', 'phone', s.phone, 'tel', 'required placeholder="01XXXXXXXXX"')}${field('Secondary phone', 'secondaryPhone', s.secondaryPhone, 'tel')}${field('Email', 'email', s.email, 'email')}${field('Address', 'address', s.address, 'textarea', 'rows="2"')}${field('City', 'city', s.city)}${field('District', 'district', s.district)}<div class="form-full setup-default-note">${icon('map', 16)} Bangladesh defaults are already applied for country, currency and timezone.</div></div>` : `<div class="form-grid two">${selectField('Country', 'country', [['Bangladesh', 'Bangladesh']], s.country)}${selectField('Currency', 'currency', [['BDT', 'BDT / ৳'], ['USD', 'USD / $']], s.currency)}${selectField('Timezone', 'timezone', [['Asia/Dhaka', 'Asia/Dhaka (UTC+6)'], ['Asia/Kolkata', 'Asia/Kolkata (UTC+5:30)'], ['UTC', 'UTC']], s.timezone)}${selectField('Default language', 'language', [['English', 'English'], ['Bengali', 'বাংলা (Bengali)']], s.language)}${field('Invoice prefix', 'invoicePrefix', s.invoicePrefix, 'text', 'required')}${field('Patient code prefix', 'patientPrefix', s.patientPrefix, 'text', 'required')}${field('Appointment prefix', 'appointmentPrefix', s.appointmentPrefix, 'text', 'required')}${field('Queue serial prefix', 'serialPrefix', s.serialPrefix, 'text', 'required')}<div class="form-full setup-default-note">${icon('shield', 16)} Dentiva Pro is offline-first. No cloud account or paid service is required.</div></div>`}${modalFooter(step === 1 ? 'Skip for now' : 'Back', step === 1 ? 'Continue' : 'Save & continue', 'setup-next')}</form>`;
}
function modalPatient(data = {}) {
  const p = data.patient || {}; const editing = Boolean(p.id);
  return `<form data-form="patient"><input type="hidden" name="id" value="${attr(p.id || '')}">${modalHead(editing ? 'PATIENT RECORD' : 'NEW PATIENT', editing ? 'Edit patient details' : 'Register a patient', 'Keep identity, contact and clinical context together.')}<div class="form-grid two">${field('Full name', 'fullName', p.fullName, 'text', 'required placeholder="Patient full name"')}${field('Preferred name', 'preferredName', p.preferredName)}${field('Phone', 'phone', p.phone, 'tel', 'required placeholder="01XXXXXXXXX"')}${field('Alternative phone', 'alternativePhone', p.alternativePhone, 'tel')}${field('Email', 'email', p.email, 'email')}${field('Date of birth', 'dateOfBirth', p.dateOfBirth, 'date')}${selectField('Gender', 'gender', [['', 'Not recorded'], ['Female', 'Female'], ['Male', 'Male'], ['Other', 'Other'], ['Prefer not to say', 'Prefer not to say']], p.gender)}${selectField('Blood group', 'bloodGroup', [['', 'Not recorded'], ['A+', 'A+'], ['A-', 'A−'], ['B+', 'B+'], ['B-', 'B−'], ['AB+', 'AB+'], ['AB-', 'AB−'], ['O+', 'O+'], ['O-', 'O−']], p.bloodGroup)}${field('Address', 'address', p.address, 'textarea', 'rows="2"')}${field('Emergency contact', 'emergencyContact', p.emergencyContact)}${field('Emergency phone', 'emergencyPhone', p.emergencyPhone, 'tel')}${field('Occupation', 'occupation', p.occupation)}${field('Allergies', 'allergies', p.allergies, 'textarea', 'rows="2" placeholder="Record known allergies or write None recorded"')}${field('Chronic conditions', 'chronicConditions', p.chronicConditions, 'textarea', 'rows="2"')}${field('Current medications', 'currentMedications', p.currentMedications, 'textarea', 'rows="2"')}${field('Previous dental history', 'previousDentalHistory', p.previousDentalHistory, 'textarea', 'rows="2"')}${field('Referral source', 'referralSource', p.referralSource)}${field('Notes', 'notes', p.notes, 'textarea', 'rows="2"')}${selectField('Patient status', 'status', [['Active', 'Active'], ['Inactive', 'Inactive']], p.status || 'Active')}</div><p class="form-note">${icon('shield', 14)} Patient code is generated automatically and stays unique.</p>${modalFooter('Cancel', editing ? 'Save changes' : 'Create patient')}</form>`;
}
function modalAppointment(data = {}) {
  const a = data.appointment || {}; const patients = patientOptions(a.patientId); const editing = Boolean(a.id); const dateValue = a.date || today();
  return `<form data-form="appointment"><input type="hidden" name="id" value="${attr(a.id || '')}">${modalHead(editing ? 'APPOINTMENT' : 'NEW APPOINTMENT', editing ? 'Edit appointment' : 'Book an appointment', 'Protect time, chair and patient context.')}<div class="form-grid two">${selectField('Patient', 'patientId', [['', patients.length ? 'Choose patient...' : 'Add a patient first'], ...patients], a.patientId, 'required')}${field('Date', 'date', dateValue, 'date', 'required')}${field('Time', 'time', a.time || '09:00', 'time', 'required')}${field('Duration (minutes)', 'duration', a.duration || state.settings.defaultDuration, 'number', 'min="5" step="5" required')}${selectField('Dentist', 'dentistId', dentistOptions(), a.dentistId)}${field('Chair / room', 'chair', a.chair || 'Chair 1')}${field('Reason for visit', 'reason', a.reason, 'text', 'required placeholder="Consultation, cleaning, follow-up..."')}${selectField('Status', 'status', [['Scheduled', 'Scheduled'], ['Checked In', 'Checked In'], ['Waiting', 'Waiting'], ['In Treatment', 'In Treatment'], ['Completed', 'Completed'], ['Cancelled', 'Cancelled'], ['No Show', 'No Show']], a.status || 'Scheduled')}${field('Notes', 'notes', a.notes, 'textarea', 'rows="3"')}${field('Reminder note', 'reminder', a.reminder, 'text')}</div>${patients.length ? '' : `<div class="inline-warning">${icon('warning', 15)} Add a patient before booking an appointment. <button type="button" class="text-button" data-action="open-patient">Open patient form${icon('arrow', 13)}</button></div>`}${modalFooter('Cancel', editing ? 'Save appointment' : 'Book appointment')}</form>`;
}
function modalVisit(data = {}) {
  const v = data.visit || {}; const patients = patientOptions(v.patientId); const editing = Boolean(v.id); const patientId = v.patientId || data.patientId || '';
  return `<form data-form="visit"><input type="hidden" name="id" value="${attr(v.id || '')}">${modalHead(editing ? 'CLINICAL ENCOUNTER' : 'NEW VISIT', editing ? 'Edit clinical visit' : 'Record a visit', 'Record professional input without automating clinical judgement.')}<div class="form-grid two">${selectField('Patient', 'patientId', [['', 'Choose patient...'], ...patients], patientId, 'required')}${field('Date', 'date', v.date || today(), 'date', 'required')}${field('Time', 'time', v.time || '', 'time')}${field('Chief complaint / reason', 'reason', v.reason || v.chiefComplaint, 'text', 'required')}${field('Symptoms', 'symptoms', v.symptoms, 'textarea', 'rows="3"')}${field('Clinical findings', 'clinicalFindings', v.clinicalFindings, 'textarea', 'rows="3"')}${field('Diagnosis', 'diagnosis', v.diagnosis, 'textarea', 'rows="2"')}${field('Treatment plan', 'treatmentPlan', v.treatmentPlan, 'textarea', 'rows="2"')}${field('Treatment performed', 'treatmentPerformed', v.treatmentPerformed, 'textarea', 'rows="2"')}${field('Tooth number(s)', 'teeth', v.teeth, 'text', 'placeholder="e.g. 16, 26"')}${field('Anesthesia information', 'anesthesia', v.anesthesia, 'text')}${field('Follow-up date', 'followUpDate', v.followUpDate, 'date')}${field('Doctor / additional notes', 'notes', v.notes, 'textarea', 'rows="3"')}</div><div class="form-note">${icon('tooth', 14)} Multiple teeth and treatments can be recorded as comma-separated clinical notes. Use the Dental Chart for tooth-level status history.</div>${modalFooter('Cancel', editing ? 'Save visit' : 'Record visit')}</form>`;
}
function modalPrescription(data = {}) {
  const p = data.prescription || {}; const editing = Boolean(p.id); const first = p.medications?.[0] || p;
  return `<form data-form="prescription"><input type="hidden" name="id" value="${attr(p.id || '')}">${modalHead(editing ? 'PRESCRIPTION' : 'NEW PRESCRIPTION', editing ? 'Edit prescription' : 'Create a prescription', 'Clear instructions, ready to print.')}<div class="form-grid two">${selectField('Patient', 'patientId', [['', 'Choose patient...'], ...patientOptions(p.patientId)], p.patientId, 'required')}${field('Date', 'date', p.date || today(), 'date', 'required')}${field('Doctor', 'doctor', p.doctor || state.settings.dentistName, 'text', 'required')}${field('Medicine', 'medicine', first.medicine, 'text', 'required placeholder="Medicine name"')}${field('Strength', 'strength', first.strength, 'text', 'placeholder="e.g. 500 mg"')}${field('Dosage', 'dosage', first.dosage, 'text', 'placeholder="e.g. 1 tablet"')}${field('Frequency', 'frequency', first.frequency, 'text', 'placeholder="e.g. Twice daily"')}${field('Duration', 'duration', first.duration, 'text', 'placeholder="e.g. 5 days"')}${field('Route', 'route', first.route || 'Oral')}${field('Instructions', 'instructions', first.instructions, 'textarea', 'rows="3" placeholder="How and when to take this medicine"')}${field('Prescription notes', 'notes', p.notes, 'textarea', 'rows="3"')}</div><div class="form-note">${icon('shield', 14)} The medicine and instructions reflect the prescriber’s input. Dentiva Pro does not generate medical recommendations.</div>${modalFooter('Cancel', editing ? 'Save prescription' : 'Create prescription')}</form>`;
}
function modalInvoice(data = {}) {
  const i = data.invoice || {}; const editing = Boolean(i.id); const item = i.items?.[0] || {};
  return `<form data-form="invoice"><input type="hidden" name="id" value="${attr(i.id || '')}">${modalHead(editing ? 'INVOICE' : 'NEW INVOICE', editing ? 'Edit invoice' : 'Create an invoice', 'Line items, discounts and taxes remain transparent.')}<div class="form-grid two">${selectField('Patient', 'patientId', [['', 'Choose patient...'], ...patientOptions(i.patientId)], i.patientId, 'required')}${field('Invoice date', 'date', i.date || today(), 'date', 'required')}${field('Item / treatment', 'itemName', item.name || '', 'text', 'required placeholder="Treatment or service"')}${field('Quantity', 'quantity', item.quantity || 1, 'number', 'min="1" step="1" required')}${field('Unit price', 'unitPrice', item.unitPrice || '', 'number', 'min="0" step="0.01" required')}${field('Discount', 'discount', i.discount || 0, 'number', 'min="0" step="0.01"')}${field('Tax rate (%)', 'taxRate', i.taxRate ?? (state.settings.taxEnabled ? state.settings.taxRate : 0), 'number', 'min="0" step="0.01"')}${selectField('Payment status', 'status', [['Unpaid', 'Unpaid'], ['Partially Paid', 'Partially Paid'], ['Paid', 'Paid'], ['Cancelled', 'Cancelled']], i.status || 'Unpaid')}${field('Notes', 'notes', i.notes, 'textarea', 'rows="2"')}</div><div class="invoice-preview-line"><span>Calculated total</span><strong id="invoice-modal-total">${currency(i.total || 0)}</strong><small>subtotal − discount + configured tax</small></div>${modalFooter('Cancel', editing ? 'Save invoice' : 'Create invoice')}</form>`;
}
function modalPayment(data = {}) {
  const p = data.payment || {}; const invoice = data.invoiceId ? byId(state.invoices, data.invoiceId) : byId(state.invoices, p.invoiceId); const choices = active(state.invoices).filter((i) => i.due > 0);
  return `<form data-form="payment"><input type="hidden" name="id" value="${attr(p.id || '')}">${modalHead('PAYMENT', 'Record a payment', 'Every collection receives its own receipt and audit entry.')}<div class="form-grid two">${selectField('Invoice', 'invoiceId', [['', choices.length ? 'On account / choose invoice' : 'No open invoices'], ...choices.map((i) => [i.id, `${i.invoiceNumber} · ${patientName(i.patientId)} · due ${currency(i.due)}`])], invoice?.id || p.invoiceId, '')}${selectField('Patient', 'patientId', [['', 'Choose patient...'], ...patientOptions(p.patientId || invoice?.patientId)], p.patientId || invoice?.patientId, 'required')}${field('Amount', 'amount', p.amount || invoice?.due || '', 'number', 'min="0.01" step="0.01" required')}${field('Payment date', 'date', p.date || today(), 'date', 'required')}${selectField('Method', 'method', [['Cash', 'Cash'], ['Bank', 'Bank'], ['Card', 'Card'], ['bKash', 'bKash'], ['Nagad', 'Nagad'], ['Rocket', 'Rocket'], ['Upay', 'Upay'], ['Other', 'Other']], p.method || 'Cash')}${field('Reference / transaction ID', 'reference', p.reference || p.transactionId)}${field('Bank / MFS provider', 'provider', p.provider)}${field('Notes', 'notes', p.notes, 'textarea', 'rows="2"')}</div><div class="form-note">${icon('shield', 14)} A payment cannot exceed the selected invoice balance. Use a separate adjustment for refunds or reversals.</div>${modalFooter('Cancel', 'Record payment')}</form>`;
}
function modalStock(data = {}) {
  const i = data.item || {}; const editing = Boolean(i.id);
  return `<form data-form="stock"><input type="hidden" name="id" value="${attr(i.id || '')}">${modalHead(editing ? 'INVENTORY ITEM' : 'NEW STOCK ITEM', editing ? 'Edit stock details' : 'Add stock item', 'Stock changes are recorded as traceable movements.')}<div class="form-grid two">${field('Item name', 'name', i.name, 'text', 'required placeholder="e.g. Composite resin"')}${field('Item code', 'itemCode', i.itemCode, 'text', 'placeholder="Optional internal code"')}${selectField('Category', 'category', [['Medicine', 'Medicine'], ['Dental material', 'Dental material'], ['Consumable', 'Consumable'], ['Equipment consumable', 'Equipment consumable'], ['Other', 'Other']], i.category || 'Consumable')}${field('Brand', 'brand', i.brand)}${field('Unit', 'unit', i.unit || 'box', 'text', 'required')}${selectField('Supplier', 'supplierId', [['', 'No supplier linked'], ...active(state.suppliers).map((s) => [s.id, s.name])], i.supplierId)}${field('Purchase date', 'purchaseDate', i.purchaseDate || today(), 'date')}${field('Purchase price', 'purchasePrice', i.purchasePrice || '', 'number', 'min="0" step="0.01"')}${field('Quantity to add', 'quantity', editing ? 0 : '', 'number', 'min="0" step="0.01"')}${field('Current stock', 'currentStock', i.currentStock || 0, 'number', 'min="0" step="0.01"')}${field('Minimum / reorder level', 'minimumStock', i.minimumStock ?? state.settings.lowStockThreshold, 'number', 'min="0" step="0.01"')}${field('Expiry date', 'expiryDate', i.expiryDate, 'date')}${field('Batch / lot', 'batch', i.batch)}${field('Location', 'location', i.location)}${field('Notes', 'notes', i.notes, 'textarea', 'rows="2"')}</div><div class="form-note">${icon('activity', 14)} Existing stock is never silently overwritten. Adding a quantity creates a Purchase movement.</div>${modalFooter('Cancel', editing ? 'Save item' : 'Add stock')}</form>`;
}
function modalSupplier(data = {}) { const s = data.supplier || {}; const editing = Boolean(s.id); return `<form data-form="supplier"><input type="hidden" name="id" value="${attr(s.id || '')}">${modalHead(editing ? 'SUPPLIER' : 'NEW SUPPLIER', editing ? 'Edit supplier' : 'Add a supplier', 'Keep purchasing contacts connected to inventory.')}<div class="form-grid two">${field('Supplier name', 'name', s.name, 'text', 'required')}${field('Contact person', 'contactPerson', s.contactPerson)}${field('Phone', 'phone', s.phone, 'tel')}${field('Email', 'email', s.email, 'email')}${field('Address', 'address', s.address, 'textarea', 'rows="2"')}${field('Tax / registration info', 'taxInfo', s.taxInfo)}${field('Notes', 'notes', s.notes, 'textarea', 'rows="3"')}</div>${modalFooter('Cancel', editing ? 'Save supplier' : 'Add supplier')}</form>`; }
function modalStaff(data = {}) { const s = data.staff || {}; const editing = Boolean(s.id); return `<form data-form="staff"><input type="hidden" name="id" value="${attr(s.id || '')}">${modalHead(editing ? 'STAFF MEMBER' : 'NEW STAFF MEMBER', editing ? 'Edit staff member' : 'Add staff member', 'Roles keep access architecture clear as the practice grows.')}<div class="form-grid two">${field('Full name', 'name', s.name, 'text', 'required')}${selectField('Role', 'role', [['Dentist', 'Dentist'], ['Dental Assistant', 'Dental Assistant'], ['Receptionist', 'Receptionist'], ['Manager', 'Manager'], ['Cleaner', 'Cleaner'], ['Other', 'Other']], s.role || 'Receptionist')}${field('Phone', 'phone', s.phone, 'tel')}${field('Email', 'email', s.email, 'email')}${field('Address', 'address', s.address, 'textarea', 'rows="2"')}${field('Joining date', 'joiningDate', s.joiningDate || today(), 'date')}${field('Salary', 'salary', s.salary, 'number', 'min="0" step="0.01"')}${selectField('Salary type', 'salaryType', [['Monthly', 'Monthly'], ['Hourly', 'Hourly'], ['Other', 'Other']], s.salaryType || 'Monthly')}${field('Working hours', 'workingHours', s.workingHours, 'text', 'placeholder="e.g. Sat–Thu, 10:00–18:00"')}${selectField('Status', 'status', [['Active', 'Active'], ['Inactive', 'Inactive']], s.status || 'Active')}${field('Notes', 'notes', s.notes, 'textarea', 'rows="2"')}</div>${modalFooter('Cancel', editing ? 'Save staff member' : 'Add staff member')}</form>`; }
function modalExpense(data = {}) { const e = data.expense || {}; return `<form data-form="expense">${modalHead('EXPENSE', 'Record an expense', 'Keep operating costs separate from patient billing.')}<div class="form-grid two">${field('Description', 'description', e.description, 'text', 'required placeholder="e.g. Monthly clinic rent"')}${field('Amount', 'amount', e.amount, 'number', 'min="0.01" step="0.01" required')}${field('Date', 'date', e.date || today(), 'date', 'required')}${selectField('Category', 'category', [['Clinic rent', 'Clinic rent'], ['Electricity', 'Electricity'], ['Internet', 'Internet'], ['Water', 'Water'], ['Staff salary', 'Staff salary'], ['Cleaning', 'Cleaning'], ['Maintenance', 'Maintenance'], ['Equipment', 'Equipment'], ['Supplies', 'Supplies'], ['Marketing', 'Marketing'], ['Transport', 'Transport'], ['Other', 'Other']], e.category || 'Other')}${selectField('Method', 'method', [['Cash', 'Cash'], ['Bank', 'Bank'], ['Card', 'Card'], ['Other', 'Other']], e.method || 'Cash')}${field('Reference', 'reference', e.reference)}${field('Notes', 'notes', e.notes, 'textarea', 'rows="3"')}</div>${modalFooter('Cancel', 'Record expense')}</form>`; }
function modalTreatment(data = {}) { const t = data.treatment || {}; const editing = Boolean(t.id); return `<form data-form="treatment"><input type="hidden" name="id" value="${attr(t.id || '')}">${modalHead(editing ? 'TREATMENT CATALOG' : 'NEW TREATMENT', editing ? 'Edit treatment' : 'Add a treatment', 'Catalog defaults help the team stay consistent; each invoice remains reviewable.')}<div class="form-grid two">${field('Treatment name', 'name', t.name, 'text', 'required placeholder="e.g. Composite restoration"')}${field('Code', 'code', t.code, 'text', 'placeholder="e.g. REST-C"')}${field('Category', 'category', t.category || 'General')}${field('Default price', 'defaultPrice', t.defaultPrice || '', 'number', 'min="0" step="0.01"')}${field('Duration (minutes)', 'duration', t.duration || 30, 'number', 'min="5" step="5"')}${selectField('Tooth required', 'toothRequired', [['false', 'No'], ['true', 'Yes']], String(t.toothRequired || false))}${field('Description', 'description', t.description, 'textarea', 'rows="3"')}${selectField('Status', 'active', [['true', 'Active'], ['false', 'Inactive']], String(t.active !== false))}</div>${modalFooter('Cancel', editing ? 'Save treatment' : 'Add treatment')}</form>`; }
function modalReferral(data = {}) { const r = data.referral || {}; const editing = Boolean(r.id); return `<form data-form="referral"><input type="hidden" name="id" value="${attr(r.id || '')}">${modalHead(editing ? 'REFERRAL' : 'NEW REFERRAL', editing ? 'Edit referral' : 'Record a referral', 'Keep the reason, destination and response connected to the patient record.')}<div class="form-grid two">${selectField('Patient', 'patientId', [['', 'Choose patient...'], ...patientOptions(r.patientId || ui.patientId)], r.patientId || ui.patientId, 'required')}${field('Referral date', 'date', r.date || today(), 'date', 'required')}${field('Referred to', 'referralTo', r.referralTo, 'text', 'required placeholder="Doctor, specialist or organisation"')}${field('Specialty', 'specialty', r.specialty)}${field('Reason', 'reason', r.reason, 'textarea', 'rows="3" required')}${field('Clinical notes', 'clinicalNotes', r.clinicalNotes, 'textarea', 'rows="3"')}${field('Response / report', 'response', r.response, 'textarea', 'rows="3"')}${field('Follow-up notes', 'followUpNotes', r.followUpNotes, 'textarea', 'rows="2"')}</div>${modalFooter('Cancel', editing ? 'Save referral' : 'Save referral')}</form>`; }
function modalNotifications() { const notes = state.notifications.slice(0, 12); return `${modalHead('NOTIFICATIONS', 'Notification centre', notes.length ? 'Meaningful signals from your workspace.' : 'Your workspace is quiet.')}<div class="notification-list">${notes.length ? notes.map((n) => `<div class="notification-row ${n.read ? '' : 'unread'}"><span class="notification-icon">${icon(n.type === 'warning' ? 'warning' : n.type === 'backup' ? 'backup' : 'bell', 16)}</span><div><strong>${esc(n.title)}</strong><p>${esc(n.message)}</p><small>${date(n.date || today())}</small></div></div>`).join('') : emptyState('bell', 'No notifications', 'Appointment, follow-up, stock and backup signals will appear here.')}</div><div class="modal-footer"><button class="btn btn-link" data-action="mark-notifications-read">Mark all as read</button><button class="btn btn-primary" data-action="close-modal">Done</button></div>`; }
function modalSecurity() { const hasPin = Boolean(state.settings.pinHash); return `<form data-form="security">${modalHead('PRIVACY & SECURITY', hasPin ? 'Change application PIN' : 'Set application PIN', hasPin ? 'Choose a new local PIN for this workspace.' : 'The PIN is hashed locally and never stored as readable text.')}<div class="security-modal-icon">${icon('lock', 26)}</div><div class="form-grid">${field('New PIN', 'pin', '', 'password', 'required minlength=4 maxlength=12 inputmode="numeric" pattern="[0-9]{4,12}" autocomplete="new-password" placeholder="4–12 digits"')}${field('Confirm PIN', 'confirmPin', '', 'password', 'required minlength=4 maxlength=12 inputmode="numeric" pattern="[0-9]{4,12}" autocomplete="new-password" placeholder="Enter the PIN again"')}</div><p class="form-note">${icon('shield', 14)} This PIN only protects access to this local workspace. Keep a verified backup separately; it cannot recover a forgotten PIN.</p>${modalFooter('Cancel', hasPin ? 'Update PIN' : 'Enable application lock')}</form>`; }
function modalSearch() {
  const q = ui.search.trim().toLowerCase();
  const results = q ? globalSearch(q) : [];
  const resultMarkup = q
    ? (results.length
      ? results.map((r) => `<button class="search-result" data-action="search-result" data-kind="${r.kind}" data-id="${r.id}"><span class="search-result-icon">${icon(r.icon, 16)}</span><span><strong>${esc(r.title)}</strong><small>${esc(r.subtitle)}</small></span><span class="result-type">${esc(r.type)}</span>${icon('arrow', 14)}</button>`).join('')
      : emptyState('search', 'No matching records', 'Try a patient name, phone, invoice number or item code.'))
    : `<div class="search-suggestions"><span>Patients</span><span>Appointments</span><span>Invoices</span><span>Inventory</span></div>`;
  return `${modalHead('COMMAND CENTRE', 'Search your workspace', 'Find patients, invoices, appointments, records and stock without leaving your keyboard.')}<label class="search-field modal-search-field">${icon('search', 19)}<input autofocus type="search" value="${attr(ui.search)}" placeholder="Try a patient name, phone or invoice..." data-input="modal-search"><kbd>Esc</kbd></label><div class="search-hint">${icon('sparkle', 14)} Search is local and includes partial matches. Use <kbd>Ctrl</kbd> <kbd>K</kbd> any time.</div><div class="search-results">${resultMarkup}</div>`;
}
function modalUser() { return `${modalHead('LOCAL ACCOUNT', state.settings.dentistName || 'Practice administrator', 'This workspace is running locally on this device.')}<div class="user-panel"><span class="avatar avatar-large">${initials(state.settings.dentistName || 'Dr')}</span><div><h3>${esc(state.settings.dentistName || 'Practice administrator')}</h3><p>${esc(state.settings.clinicName || 'Your practice')}</p><span class="security-pill">${icon('shield', 14)} Local administrator</span></div></div><div class="user-actions">${button('Settings', 'navigate', 'settings', 'secondary', 'data-page="settings"')}${button('About Dentiva Pro', 'navigate', 'info', 'link', 'data-page="about"')}${state.settings.applicationLock ? button('Lock workspace', 'lock-workspace', 'lock', 'secondary') : button('Set application PIN', 'open-security', 'lock', 'secondary')}</div><div class="modal-footer"><button class="btn btn-primary" data-action="close-modal">Close</button></div>`; }

function globalSearch(q) {
  const results = [];
  active(state.patients).filter((p) => [p.fullName, p.patientCode, p.phone, p.email, p.address].some((v) => String(v || '').toLowerCase().includes(q))).slice(0, 8).forEach((p) => results.push({ kind: 'patient', id: p.id, title: p.fullName, subtitle: `${p.patientCode || 'Patient'} · ${p.phone || 'No phone'}`, type: 'Patient', icon: 'users' }));
  active(state.appointments).filter((a) => [patientName(a.patientId), a.reason, a.date, a.status].some((v) => String(v || '').toLowerCase().includes(q))).slice(0, 6).forEach((a) => results.push({ kind: 'appointment', id: a.id, title: patientName(a.patientId), subtitle: `${date(a.date)} · ${time(a.time)} · ${a.reason || 'Appointment'}`, type: 'Appointment', icon: 'calendar' }));
  active(state.invoices).filter((i) => [i.invoiceNumber, patientName(i.patientId), i.date].some((v) => String(v || '').toLowerCase().includes(q))).slice(0, 6).forEach((i) => results.push({ kind: 'invoice', id: i.id, title: i.invoiceNumber, subtitle: `${patientName(i.patientId)} · ${currency(i.total)}`, type: 'Invoice', icon: 'receipt' }));
  active(state.inventory).filter((i) => [i.name, i.itemCode, i.category, i.batch].some((v) => String(v || '').toLowerCase().includes(q))).slice(0, 6).forEach((i) => results.push({ kind: 'inventory', id: i.id, title: i.name, subtitle: `${i.itemCode || 'Stock item'} · ${i.currentStock} ${i.unit || ''}`, type: 'Inventory', icon: 'box' }));
  active(state.suppliers).filter((s) => [s.name, s.contactPerson, s.phone, s.email].some((v) => String(v || '').toLowerCase().includes(q))).slice(0, 4).forEach((s) => results.push({ kind: 'supplier', id: s.id, title: s.name, subtitle: `${s.contactPerson || 'Supplier'} · ${s.phone || 'No phone'}`, type: 'Supplier', icon: 'truck' }));
  active(state.staff).filter((person) => [person.name, person.role, person.phone, person.email].some((v) => String(v || '').toLowerCase().includes(q))).slice(0, 4).forEach((person) => results.push({ kind: 'staff', id: person.id, title: person.name, subtitle: `${person.role || 'Staff'} · ${person.phone || 'No phone'}`, type: 'Staff', icon: 'briefcase' }));
  active(state.visits).filter((v) => [patientName(v.patientId), v.reason, v.diagnosis, v.treatmentPerformed].some((value) => String(value || '').toLowerCase().includes(q))).slice(0, 5).forEach((v) => results.push({ kind: 'visit', id: v.id, title: patientName(v.patientId), subtitle: `${date(v.date)} · ${v.reason || 'Clinical visit'}`, type: 'Visit', icon: 'activity' }));
  return results.slice(0, 16);
}

function openModal(type, data = {}) { ui.modal = { type, data }; render(); window.setTimeout(() => document.querySelector('[data-modal-window] input, [data-modal-window] select')?.focus(), 40); }
function closeModal() { ui.modal = null; render(); }
function openPatientProfile(id) { ui.patientId = id; ui.patientTab = 'overview'; ui.page = 'patients'; render(); }
function formData(event) { return Object.fromEntries(new FormData(event.target).entries()); }
function numeric(value) { const n = Number(value); return Number.isFinite(n) ? n : 0; }
function makePatient(data, editing = false) {
  const existing = editing ? byId(state.patients, data.id) : null;
  const record = { ...(existing || {}), ...data, id: existing?.id || uid('patient'), patientCode: existing?.patientCode || nextCode('patient', 'patientPrefix'), registrationDate: existing?.registrationDate || today(), status: data.status || existing?.status || 'Active', updatedAt: now() };
  return record;
}
function invoiceTotals(data) { return calculateInvoice(data); }

async function handleSubmit(event) {
  const form = event.target.closest('form[data-form]'); if (!form) return;
  event.preventDefault(); const type = form.dataset.form; const data = formData(event);
  try {
    if (type === 'setup') return saveSetupStep(data);
    if (type === 'unlock') {
      if (!state.settings.pinHash) { ui.locked = false; render(); return; }
      if (!/^\d{4,12}$/.test(data.pin || '')) return notify('Enter the 4–12 digit application PIN.', 'error');
      const candidateHash = await hashPin(data.pin, state.settings.pinSalt);
      if (candidateHash.hash !== state.settings.pinHash) return notify('That PIN is not correct. Try again.', 'error');
      ui.locked = false;
      ui.toast = null;
      render();
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
      audit('Application lock enabled', 'Security', '', 'Local administrator PIN configured');
      Store.save(state);
      closeModal();
      notify('Application lock enabled.');
      return;
    }
    if (type === 'patient') {
      if (!data.fullName.trim() || !data.phone.trim()) return notify('Full name and phone are required.', 'error');
      const duplicate = active(state.patients).find((p) => p.id !== data.id && p.phone && data.phone && p.phone.replace(/\D/g, '') === data.phone.replace(/\D/g, '') && p.fullName.toLowerCase() === data.fullName.toLowerCase());
      if (duplicate && !window.confirm(`A patient with the same name and phone already exists (${duplicate.patientCode}). Save anyway?`)) return;
      const editing = Boolean(data.id); const record = makePatient(data, editing); if (editing) Object.assign(byId(state.patients, data.id), record); else state.patients.push(record); audit(editing ? 'Patient edited' : 'Patient created', 'Patient', record.id, `${record.patientCode} · ${record.fullName}`); Store.save(state); closeModal(); notify(editing ? 'Patient updated.' : `Patient ${record.patientCode} created.`); return;
    }
    if (type === 'appointment') {
      if (!data.patientId || !data.date || !data.time || !data.reason.trim()) return notify('Patient, date, time and reason are required.', 'error');
      const conflict = active(state.appointments).find((a) => a.id !== data.id && a.date === data.date && a.time === data.time && (a.chair || 'Chair 1') === (data.chair || 'Chair 1') && !['Cancelled', 'No Show'].includes(a.status));
      if (conflict && !window.confirm(`Chair ${data.chair || '1'} already has an appointment at this time. Save as a double-booking?`)) return;
      const editing = Boolean(data.id); const existing = editing ? byId(state.appointments, data.id) : null; const record = { ...(existing || {}), ...data, id: existing?.id || uid('appointment'), appointmentCode: existing?.appointmentCode || nextCode('appointment', 'appointmentPrefix'), serial: existing?.serial || nextCode('serial', 'serialPrefix'), duration: numeric(data.duration) || state.settings.defaultDuration, createdAt: existing?.createdAt || now(), updatedAt: now() }; if (editing) Object.assign(existing, record); else state.appointments.push(record); const patient = byId(state.patients, data.patientId); if (patient && data.date >= today()) patient.nextVisit = data.date; audit(editing ? 'Appointment edited' : 'Appointment created', 'Appointment', record.id, `${patient?.fullName || ''} · ${data.date} ${data.time}`); Store.save(state); closeModal(); notify(editing ? 'Appointment updated.' : 'Appointment booked.'); return;
    }
    if (type === 'visit') {
      if (!data.patientId || !data.date || !data.reason.trim()) return notify('Patient, date and reason are required.', 'error');
      const editing = Boolean(data.id); const existing = editing ? byId(state.visits, data.id) : null; const record = { ...(existing || {}), ...data, id: existing?.id || uid('visit'), visitCode: existing?.visitCode || nextCode('visit', 'appointmentPrefix'), createdAt: existing?.createdAt || now(), updatedAt: now(), status: 'Completed' }; if (editing) Object.assign(existing, record); else state.visits.push(record); const patient = byId(state.patients, data.patientId); if (patient) patient.lastVisit = data.date; audit(editing ? 'Visit edited' : 'Visit created', 'Visit', record.id, `${patient?.fullName || ''} · ${data.reason}`); Store.save(state); closeModal(); if (patient) { ui.patientId = patient.id; ui.page = 'patients'; } notify(editing ? 'Clinical visit updated.' : 'Clinical visit recorded.'); return;
    }
    if (type === 'prescription') {
      if (!data.patientId || !data.medicine.trim() || !data.doctor.trim()) return notify('Patient, doctor and medicine are required.', 'error');
      const editing = Boolean(data.id); const existing = editing ? byId(state.prescriptions, data.id) : null; const medication = { medicine: data.medicine, strength: data.strength, dosage: data.dosage, frequency: data.frequency, duration: data.duration, route: data.route, instructions: data.instructions }; const record = { ...(existing || {}), id: existing?.id || uid('rx'), prescriptionCode: existing?.prescriptionCode || nextCode('prescription', 'appointmentPrefix'), patientId: data.patientId, date: data.date || today(), doctor: data.doctor, medications: [medication], notes: data.notes, createdAt: existing?.createdAt || now(), updatedAt: now() }; if (editing) Object.assign(existing, record); else state.prescriptions.push(record); audit(editing ? 'Prescription edited' : 'Prescription created', 'Prescription', record.id, `${patientName(data.patientId)} · ${data.medicine}`); Store.save(state); closeModal(); notify(editing ? 'Prescription updated.' : 'Prescription created.'); return;
    }
    if (type === 'invoice') {
      if (!data.patientId || !data.itemName.trim() || numeric(data.unitPrice) < 0) return notify('Patient, line item and a valid unit price are required.', 'error');
      const totals = invoiceTotals(data); const editing = Boolean(data.id); const existing = editing ? byId(state.invoices, data.id) : null; const paid = existing?.paid || 0; const due = Math.max(0, totals.total - paid); const status = data.status === 'Cancelled' ? 'Cancelled' : due <= 0 ? 'Paid' : paid > 0 ? 'Partially Paid' : 'Unpaid'; const record = { ...(existing || {}), id: existing?.id || uid('invoice'), invoiceNumber: existing?.invoiceNumber || nextCode('invoice', 'invoicePrefix'), patientId: data.patientId, date: data.date || today(), items: [{ name: data.itemName, quantity: numeric(data.quantity) || 1, unitPrice: numeric(data.unitPrice), total: numeric(data.quantity || 1) * numeric(data.unitPrice) }], subtotal: totals.subtotal, discount: totals.discount, taxRate: totals.taxRate, tax: totals.tax, total: totals.total, paid, due, status, notes: data.notes, createdAt: existing?.createdAt || now(), updatedAt: now() }; if (editing) Object.assign(existing, record); else state.invoices.push(record); audit(editing ? 'Invoice edited' : 'Invoice created', 'Invoice', record.id, `${record.invoiceNumber} · ${currency(record.total)}`); Store.save(state); closeModal(); notify(editing ? 'Invoice updated.' : `Invoice ${record.invoiceNumber} created.`); return;
    }
    if (type === 'payment') {
      const amount = numeric(data.amount); if (!data.patientId || amount <= 0 || !data.date) return notify('Patient, date and a positive amount are required.', 'error'); const invoice = data.invoiceId ? byId(state.invoices, data.invoiceId) : null; if (invoice && !canAcceptPayment(amount, invoice.due)) return notify('Payment cannot be greater than the invoice due.', 'error'); const record = { id: uid('payment'), receiptNumber: nextCode('receipt', 'invoicePrefix'), invoiceId: data.invoiceId || '', patientId: data.patientId, amount, date: data.date, method: data.method, reference: data.reference, transactionId: data.reference, provider: data.provider, notes: data.notes, createdAt: now() }; state.payments.push(record); if (invoice) { invoice.paid = Number(invoice.paid || 0) + amount; invoice.due = Math.max(0, Number(invoice.total) - invoice.paid); invoice.status = invoice.due <= 0.005 ? 'Paid' : 'Partially Paid'; invoice.updatedAt = now(); } audit('Payment recorded', 'Payment', record.id, `${record.receiptNumber} · ${currency(amount)}`); Store.save(state); closeModal(); notify(`Payment of ${currency(amount)} recorded.`); return;
    }
    if (type === 'stock') {
      if (!data.name.trim() || numeric(data.currentStock) < 0) return notify('Item name and a valid stock quantity are required.', 'error'); const editing = Boolean(data.id); const existing = editing ? byId(state.inventory, data.id) : null; const previous = Number(existing?.currentStock || 0); const added = numeric(data.quantity); const record = { ...(existing || {}), ...data, id: existing?.id || uid('stock'), currentStock: editing ? numeric(data.currentStock) : numeric(data.currentStock) + added, minimumStock: numeric(data.minimumStock), createdAt: existing?.createdAt || now(), updatedAt: now() }; if (editing) Object.assign(existing, record); else state.inventory.push(record); if (!editing && added > 0) state.stockMovements.unshift({ id: uid('movement'), itemId: record.id, type: 'Purchase', quantity: added, before: previous, after: record.currentStock, date: today(), createdAt: now(), notes: 'Initial stock entry' }); audit(editing ? 'Inventory item edited' : 'Inventory adjusted', 'Inventory', record.id, `${record.name} · ${record.currentStock} ${record.unit || ''}`); Store.save(state); closeModal(); notify(editing ? 'Stock details updated.' : 'Stock item added.'); return;
    }
    if (type === 'supplier') { if (!data.name.trim()) return notify('Supplier name is required.', 'error'); const editing = Boolean(data.id); const existing = editing ? byId(state.suppliers, data.id) : null; const record = { ...(existing || {}), ...data, id: existing?.id || uid('supplier'), createdAt: existing?.createdAt || now(), updatedAt: now() }; if (editing) Object.assign(existing, record); else state.suppliers.push(record); audit(editing ? 'Supplier edited' : 'Supplier created', 'Supplier', record.id, record.name); Store.save(state); closeModal(); notify(editing ? 'Supplier updated.' : 'Supplier added.'); return; }
    if (type === 'staff') { if (!data.name.trim()) return notify('Staff name is required.', 'error'); const editing = Boolean(data.id); const existing = editing ? byId(state.staff, data.id) : null; const record = { ...(existing || {}), ...data, id: existing?.id || uid('staff'), staffCode: existing?.staffCode || nextCode('staff', 'patientPrefix'), createdAt: existing?.createdAt || now(), updatedAt: now() }; if (editing) Object.assign(existing, record); else state.staff.push(record); audit(editing ? 'Staff edited' : 'Staff created', 'Staff', record.id, record.name); Store.save(state); closeModal(); notify(editing ? 'Staff member updated.' : 'Staff member added.'); return; }
    if (type === 'referral') { if (!data.patientId || !data.referralTo.trim() || !data.reason.trim()) return notify('Patient, destination and reason are required.', 'error'); const editing = Boolean(data.id); const existing = editing ? byId(state.referrals, data.id) : null; const record = { ...(existing || {}), ...data, id: existing?.id || uid('referral'), createdAt: existing?.createdAt || now(), updatedAt: now() }; if (editing) Object.assign(existing, record); else state.referrals.push(record); audit(editing ? 'Referral edited' : 'Referral created', 'Referral', record.id, `${patientName(record.patientId)} · ${record.referralTo}`); Store.save(state); closeModal(); notify(editing ? 'Referral updated.' : 'Referral recorded.'); return; }
    if (type === 'treatment') { if (!data.name.trim()) return notify('Treatment name is required.', 'error'); const editing = Boolean(data.id); const existing = editing ? byId(state.treatments, data.id) : null; const record = { ...(existing || {}), ...data, id: existing?.id || uid('treatment'), defaultPrice: numeric(data.defaultPrice), duration: numeric(data.duration) || 30, toothRequired: data.toothRequired === 'true', active: data.active !== 'false', createdAt: existing?.createdAt || now(), updatedAt: now() }; if (editing) Object.assign(existing, record); else state.treatments.push(record); audit(editing ? 'Treatment catalog edited' : 'Treatment catalog item created', 'Treatment', record.id, record.name); Store.save(state); closeModal(); notify(editing ? 'Treatment updated.' : 'Treatment added.'); return; }
    if (type === 'expense') { const amount = numeric(data.amount); if (!data.description.trim() || amount <= 0) return notify('Description and a positive amount are required.', 'error'); const record = { id: uid('expense'), ...data, amount, createdAt: now() }; state.expenses.push(record); audit('Expense recorded', 'Expense', record.id, `${record.description} · ${currency(amount)}`); Store.save(state); closeModal(); notify('Expense recorded.'); return; }
  } catch (error) { console.error(error); notify('The record could not be saved. Your data is unchanged.', 'error'); }
}
function saveSetupStep(data) {
  Object.assign(state.settings, data); if (ui.modal.data.step === 1) { openModal('setup', { step: 2 }); return; }
  state.setupComplete = true; audit('Setup completed', 'Settings', '', 'Practice identity and defaults configured'); Store.save(state); openModal('setup', { step: 3 });
}
function saveSettings() {
  document.querySelectorAll('[data-settings]').forEach((el) => { state.settings[el.name] = el.type === 'number' ? numeric(el.value) : el.value; });
  document.querySelectorAll('[data-settings-checkbox]').forEach((el) => { state.settings[el.dataset.settingsCheckbox] = el.checked; });
  state.settings.taxEnabled = false; audit('Settings changed', 'Settings', '', 'General practice settings updated'); Store.save(state); notify('Settings saved.');
}

function handleClick(event) {
  const target = event.target.closest('[data-action]'); if (!target) return; const action = target.dataset.action;
  if (action === 'navigate') { ui.page = target.dataset.page || 'dashboard'; ui.patientId = null; ui.modal = null; ui.mobileNav = false; ui.search = ''; render(); return; }
  if (action === 'toggle-sidebar') { ui.sidebarCollapsed = !ui.sidebarCollapsed; render(); return; }
  if (action === 'toggle-mobile-nav') { ui.mobileNav = !ui.mobileNav; render(); return; }
  if (action === 'open-search') { openModal('search'); return; }
  if (action === 'open-notifications') { openModal('notifications'); return; }
  if (action === 'open-user-menu') { openModal('user'); return; }
  if (action === 'open-security') { openModal('security'); return; }
  if (action === 'lock-workspace') {
    if (!state.settings.applicationLock || !state.settings.pinHash) return notify('Set an application PIN in Settings first.', 'error');
    ui.modal = null;
    ui.locked = true;
    ui.toast = null;
    render();
    return;
  }
  if (action === 'disable-lock') {
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
  if (action === 'finish-setup') { closeModal(); notify('Workspace ready.'); return; }
  if (action === 'open-patient') { openModal('patient', {}); return; }
  if (action === 'open-appointment') { openModal('appointment', { patientId: target.dataset.patientId || '' }); return; }
  if (action === 'open-visit') { openModal('visit', { patientId: target.dataset.patientId || ui.patientId || '' }); return; }
  if (action === 'open-prescription') { openModal('prescription', { patientId: ui.patientId || '' }); return; }
  if (action === 'open-invoice') { openModal('invoice', { patientId: ui.patientId || '' }); return; }
  if (action === 'open-payment') { openModal('payment', { invoiceId: target.dataset.invoiceId || '' }); return; }
  if (action === 'open-stock') { openModal('stock', {}); return; }
  if (action === 'open-supplier') { openModal('supplier', {}); return; }
  if (action === 'open-staff') { openModal('staff', {}); return; }
  if (action === 'open-expense') { openModal('expense', {}); return; }
  if (action === 'open-treatment') { openModal('treatment', {}); return; }
  if (action === 'edit-treatment') { openModal('treatment', { treatment: byId(state.treatments, target.dataset.id) }); return; }
  if (action === 'open-referral') { openModal('referral', { patientId: target.dataset.patientId || ui.patientId || '' }); return; }
  if (action === 'edit-referral') { openModal('referral', { referral: byId(state.referrals, target.dataset.id) }); return; }
  if (action === 'open-patient-profile') { openPatientProfile(target.dataset.id); return; }
  if (action === 'close-patient-profile') { ui.patientId = null; render(); return; }
  if (action === 'patient-tab') { ui.patientTab = target.dataset.tab || 'overview'; render(); return; }
  if (action === 'edit-patient') { openModal('patient', { patient: byId(state.patients, target.dataset.id) }); return; }
  if (action === 'edit-appointment') { openModal('appointment', { appointment: byId(state.appointments, target.dataset.id) }); return; }
  if (action === 'edit-visit') { openModal('visit', { visit: byId(state.visits, target.dataset.id) }); return; }
  if (action === 'edit-prescription') { openModal('prescription', { prescription: byId(state.prescriptions, target.dataset.id) }); return; }
  if (action === 'edit-stock') { openModal('stock', { item: byId(state.inventory, target.dataset.id) }); return; }
  if (action === 'edit-supplier') { openModal('supplier', { supplier: byId(state.suppliers, target.dataset.id) }); return; }
  if (action === 'edit-staff') { openModal('staff', { staff: byId(state.staff, target.dataset.id) }); return; }
  if (action === 'toggle-patient-filters') { ui.patientFilters = !ui.patientFilters; render(); return; }
  if (action === 'cycle-queue-status') { cycleQueueStatus(target.dataset.id); return; }
  if (action === 'select-tooth') { ui.dentalTooth = Number(target.dataset.tooth); render(); return; }
  if (action === 'set-dentition') { ui.dentition = target.dataset.dentition || 'adult'; ui.dentalTooth = null; render(); return; }
  if (action === 'close-tooth') { ui.dentalTooth = null; render(); return; }
  if (action === 'save-tooth') { saveTooth(); return; }
  if (action === 'remove-tooth') { removeTooth(); return; }
  if (action === 'calendar-prev') { ui.calendarMonth -= 1; if (ui.calendarMonth < 0) { ui.calendarMonth = 11; ui.calendarYear -= 1; } render(); return; }
  if (action === 'calendar-next') { ui.calendarMonth += 1; if (ui.calendarMonth > 11) { ui.calendarMonth = 0; ui.calendarYear += 1; } render(); return; }
  if (action === 'calendar-today') { const d = new Date(); ui.calendarMonth = d.getMonth(); ui.calendarYear = d.getFullYear(); render(); return; }
  if (action === 'export-backup') { exportBackup(); return; }
  if (action === 'trigger-import') { document.querySelector('#backup-file')?.click(); return; }
  if (action === 'clear-restore') { ui.restoreCandidate = null; render(); return; }
  if (action === 'restore-confirm') { restoreCandidate(); return; }
  if (action === 'integrity-check') { integrityCheck(); return; }
  if (action === 'export-patients') { exportPatients(); return; }
  if (action === 'export-visits') { downloadCsv(active(state.visits).map((v) => ({ Visit: v.visitCode, Date: v.date, Patient: patientName(v.patientId), Reason: v.reason || '', Diagnosis: v.diagnosis || '', Treatment: v.treatmentPerformed || '', FollowUp: v.followUpDate || '' })), 'dentiva-visits.csv'); return; }
  if (action === 'export-inventory') { downloadCsv(active(state.inventory).map((i) => ({ ItemCode: i.itemCode || '', Item: i.name, Category: i.category || '', Supplier: byId(state.suppliers, i.supplierId)?.name || '', CurrentStock: i.currentStock, Unit: i.unit || '', MinimumStock: i.minimumStock || 0, ExpiryDate: i.expiryDate || '' })), 'dentiva-inventory.csv'); return; }
  if (action === 'export-report') { exportReport(); return; }
  if (action === 'save-settings') { saveSettings(); return; }
  if (action === 'mark-notifications-read') { state.notifications.forEach((n) => { n.read = true; }); Store.save(state); closeModal(); return; }
  if (action === 'search-result') { const kind = target.dataset.kind; const id = target.dataset.id; closeModal(); if (kind === 'patient') openPatientProfile(id); else if (kind === 'appointment') { ui.page = 'appointments'; openModal('appointment', { appointment: byId(state.appointments, id) }); } else if (kind === 'invoice') { ui.page = 'billing'; render(); } else if (kind === 'inventory') { ui.page = 'inventory'; render(); } else if (kind === 'supplier') { ui.page = 'suppliers'; render(); } else if (kind === 'staff') { ui.page = 'staff'; render(); } else if (kind === 'visit') { const visit = byId(state.visits, id); if (visit) openPatientProfile(visit.patientId); } return; }
  if (action === 'attach-file') { document.querySelector('#patient-attachment-file')?.click(); return; }
  if (action === 'download-attachment') { downloadAttachment(target.dataset.id); return; }
  if (action === 'delete-attachment') { deleteAttachment(target.dataset.id); return; }
  if (action === 'print-expense') { printExpense(target.dataset.id); return; }
  if (action === 'print-queue') { printQueue(); return; }
  if (action === 'print-billing') { printBilling(); return; }
  if (action === 'print-invoice') { printInvoice(target.dataset.id); return; }
  if (action === 'print-payment') { printPayment(target.dataset.id); return; }
  if (action === 'print-prescription') { printPrescription(target.dataset.id); return; }
  if (action === 'print-patient') { printPatient(target.dataset.id); return; }
  if (action === 'print-dental-chart') { printDental(); return; }
  if (action === 'print-report') { printReport(); return; }
}
function handleInput(event) {
  const input = event.target;
  if (input.dataset.input === 'global-search' || input.dataset.input === 'modal-search') {
    ui.search = input.value;
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
  if (el.dataset.change === 'dashboard-range') { ui.range = el.value; render(); }
  if (el.dataset.change === 'patient-status-filter') { ui.patientStatusFilter = el.value; render(); }
  if (el.dataset.change === 'dental-patient') { ui.dentalPatientId = el.value; ui.dentalTooth = null; render(); }
  if (el.dataset.change === 'tooth-status') { ui.toothStatus = el.value; }
  if (el.dataset.change === 'report-type') { ui.reportType = el.value; render(); }
  if (el.dataset.change === 'report-range') { ui.reportsRange = el.value; render(); }
  if (el.dataset.change === 'restore-strategy') { if (ui.restoreCandidate) ui.restoreCandidate.strategy = el.value; }
  if (el.dataset.change === 'restore-patients' || el.dataset.change === 'restore-clinical' || el.dataset.change === 'restore-finance' || el.dataset.change === 'restore-operations' || el.dataset.change === 'restore-settings') { if (ui.restoreCandidate) ui.restoreCandidate[el.dataset.change] = el.checked; }
  if (el.id === 'invoice-modal-total') return;
}
function handleKeydown(event) {
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') { event.preventDefault(); openModal('search'); }
  if (event.key === 'Escape' && ui.modal) closeModal();
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'n') { event.preventDefault(); openModal('patient'); }
}
function cycleQueueStatus(id) { const a = byId(state.appointments, id); if (!a) return; const statuses = ['Scheduled', 'Checked In', 'Waiting', 'In Treatment', 'Completed']; const next = statuses[(statuses.indexOf(a.status || 'Scheduled') + 1) % statuses.length]; a.status = next; audit('Appointment status changed', 'Appointment', a.id, `${patientName(a.patientId)} · ${next}`); Store.save(state); notify(`Queue updated: ${next}.`); }
function saveTooth() { const patient = byId(state.patients, ui.dentalPatientId); if (!patient || !ui.dentalTooth) return notify('Choose a patient and tooth first.', 'error'); const status = ui.toothStatus ?? state.dentalRecords.find((r) => r.patientId === patient.id && Number(r.tooth) === Number(ui.dentalTooth))?.status ?? ''; const note = ui.toothNote ?? state.dentalRecords.find((r) => r.patientId === patient.id && Number(r.tooth) === Number(ui.dentalTooth))?.note ?? ''; const existing = state.dentalRecords.find((r) => r.patientId === patient.id && Number(r.tooth) === Number(ui.dentalTooth)); if (!status && !note) { if (existing) state.dentalRecords = state.dentalRecords.filter((r) => r.id !== existing.id); } else if (existing) Object.assign(existing, { status, note, updatedAt: now() }); else state.dentalRecords.push({ id: uid('tooth'), patientId: patient.id, tooth: ui.dentalTooth, status, note, updatedAt: now(), createdAt: now() }); audit('Dental chart updated', 'Dental record', patient.id, `Tooth ${ui.dentalTooth}`); ui.toothStatus = undefined; ui.toothNote = undefined; Store.save(state); notify(`Tooth ${ui.dentalTooth} record saved.`); }
function removeTooth() { const patient = byId(state.patients, ui.dentalPatientId); const record = state.dentalRecords.find((r) => r.patientId === patient?.id && Number(r.tooth) === Number(ui.dentalTooth)); if (!record) return; state.dentalRecords = state.dentalRecords.filter((r) => r.id !== record.id); audit('Dental chart record removed', 'Dental record', record.id, `Tooth ${ui.dentalTooth}`); ui.dentalTooth = null; Store.save(state); notify('Tooth record removed.'); }

function exportBackup() { const backup = { manifest: buildBackupManifest(state, APP_VERSION, arrayKeys), data: deepClone(state) }; state.lastBackupAt = now(); audit('Backup created', 'Backup', '', `${totalRecords()} records exported`); Store.save(state); jsonDownload(backup, `dentiva-pro-backup-${today()}.dentiva.json`); notify('Backup exported and verified.'); }
function exportPatients() { downloadCsv(active(state.patients).map((p) => ({ PatientCode: p.patientCode || '', FullName: p.fullName, PreferredName: p.preferredName || '', Phone: p.phone || '', Email: p.email || '', DateOfBirth: p.dateOfBirth || '', Gender: p.gender || '', BloodGroup: p.bloodGroup || '', Address: p.address || '', Allergies: p.allergies || '', RegistrationDate: p.registrationDate || '', LastVisit: p.lastVisit || '', NextVisit: p.nextVisit || '', Status: p.status || '' })), 'dentiva-patients.csv'); audit('Export executed', 'Patient', '', 'Patient CSV exported'); Store.save(state); }
function exportReport() { const report = buildReport(ui.reportType, ui.reportsRange); const rows = report.reportRows || []; if (rows.length) downloadCsv(rows, `dentiva-${ui.reportType}-${today()}.csv`); else { const q = active(state[ui.reportType === 'patients' ? 'patients' : 'appointments'] || []).map((item) => item); downloadCsv(q.map((item) => item), `dentiva-${ui.reportType}-${today()}.csv`); } audit('Export executed', 'Report', '', ui.reportType); Store.save(state); }
function restoreCandidate() { const c = ui.restoreCandidate; if (!c?.data) return; const source = c.data; const strategy = c.strategy || 'Keep Existing'; const modules = []; if (c.restorePatients !== false) modules.push('patients'); if (c.restoreClinical !== false) modules.push('appointments', 'visits', 'prescriptions', 'dentalRecords'); if (c.restoreFinance !== false) modules.push('invoices', 'payments', 'expenses'); if (c.restoreOperations !== false) modules.push('inventory', 'stockMovements', 'suppliers', 'staff', 'referrals', 'attachments'); if (c.restoreSettings !== false) modules.push('settings', 'counters', 'dashboard'); let added = 0; let skipped = 0; modules.forEach((key) => { if (key === 'settings' || key === 'counters' || key === 'dashboard') { if (source[key] && strategy !== 'Keep Existing') state[key] = deepClone(source[key]); return; } if (!Array.isArray(source[key])) return; source[key].forEach((record) => { const exists = state[key].find((local) => local.id && local.id === record.id); if (exists) { if (strategy === 'Replace') Object.assign(exists, record); else if (strategy === 'Create New Copy') { state[key].push({ ...record, id: uid(key.slice(0, -1)), importedAt: now() }); added += 1; } else skipped += 1; } else { state[key].push(deepClone(record)); added += 1; } }); }); audit('Backup restored', 'Backup', '', `${added} records restored, ${skipped} skipped`); Store.save(state); ui.restoreCandidate = null; notify(`Restore complete: ${added} added, ${skipped} skipped.`); }
function integrityCheck() { const errors = []; active(state.invoices).forEach((i) => { const expected = Math.max(0, Number(i.total) - Number(i.paid || 0)); if (Math.abs(expected - Number(i.due || 0)) > 0.01) errors.push(`Invoice ${i.invoiceNumber}`); }); active(state.appointments).forEach((a) => { if (!byId(state.patients, a.patientId)) errors.push(`Appointment ${a.appointmentCode || a.id}`); }); if (errors.length) notify(`${errors.length} integrity issue${errors.length > 1 ? 's' : ''} found. Review the audit log.`, 'error'); else { audit('Integrity check completed', 'Database', '', `${totalRecords()} records checked`); Store.save(state); notify(`${totalRecords()} records checked. Database is healthy.`); } }

function downloadAttachment(id) { const attachment = byId(state.attachments, id); if (!attachment) return; const link = document.createElement('a'); link.href = attachment.data; link.download = attachment.name; link.click(); audit('Attachment exported', 'Attachment', id, attachment.name); Store.save(state); }
function deleteAttachment(id) { const attachment = byId(state.attachments, id); if (!attachment) return; if (!window.confirm(`Remove ${attachment.name} from this patient record? This cannot be undone unless it exists in a backup.`)) return; state.attachments = state.attachments.filter((a) => a.id !== id); audit('Attachment deleted', 'Attachment', id, attachment.name); Store.save(state); notify('Attachment removed.'); }
function printExpense(id) { const expense = byId(state.expenses, id); if (!expense) return; printHtml('Expense record', `<div class="summary"><div><span class="muted">Date</span><strong>${date(expense.date)}</strong></div><div><span class="muted">Category</span><strong>${esc(expense.category || 'Other')}</strong></div><div><span class="muted">Amount</span><strong>${currency(expense.amount)}</strong></div></div><table class="print-table"><tbody><tr><th>Description</th><td>${esc(expense.description)}</td></tr><tr><th>Payment method</th><td>${esc(expense.method || '—')}</td></tr><tr><th>Reference</th><td>${esc(expense.reference || '—')}</td></tr><tr><th>Notes</th><td>${esc(expense.notes || '—')}</td></tr></tbody></table>`); }

function printQueue() { const queue = active(state.appointments).filter((a) => a.date === today()).sort((a, b) => (a.time || '').localeCompare(b.time || '')); printHtml('Today’s Queue', `<div class="summary"><div><span class="muted">Date</span><strong>${date(today())}</strong></div><div><span class="muted">Appointments</span><strong>${queue.length}</strong></div></div>${queue.length ? `<table class="print-table"><thead><tr><th>Serial</th><th>Time</th><th>Patient</th><th>Reason</th><th>Chair</th><th>Status</th></tr></thead><tbody>${queue.map((a, i) => `<tr><td>${esc(a.serial || `${state.settings.serialPrefix}-${String(i + 1).padStart(3, '0')}`)}</td><td>${time(a.time)}</td><td>${esc(patientName(a.patientId))}</td><td>${esc(a.reason || '—')}</td><td>${esc(a.chair || 'Chair 1')}</td><td>${esc(a.status || 'Scheduled')}</td></tr>`).join('')}</tbody></table>` : '<p>No appointments scheduled today.</p>'}`); }
function printBilling() { const invoices = active(state.invoices); printHtml('Billing statement', `<div class="summary"><div><span class="muted">Total billed</span><strong>${currency(sum(invoices, (i) => i.total))}</strong></div><div><span class="muted">Collected</span><strong>${currency(sum(state.payments, (p) => p.amount))}</strong></div><div><span class="muted">Outstanding</span><strong>${currency(sum(invoices, (i) => i.due))}</strong></div></div>${invoices.length ? `<table class="print-table"><thead><tr><th>Invoice</th><th>Patient</th><th>Date</th><th>Total</th><th>Paid</th><th>Due</th></tr></thead><tbody>${invoices.map((i) => `<tr><td>${esc(i.invoiceNumber)}</td><td>${esc(patientName(i.patientId))}</td><td>${date(i.date)}</td><td>${currency(i.total)}</td><td>${currency(i.paid)}</td><td>${currency(i.due)}</td></tr>`).join('')}</tbody></table>` : '<p>No invoices created.</p>'}`); }
function printInvoice(id) { const i = byId(state.invoices, id); if (!i) return; printHtml(`Invoice ${i.invoiceNumber}`, `<div class="summary"><div><span class="muted">Patient</span><strong>${esc(patientName(i.patientId))}</strong></div><div><span class="muted">Invoice date</span><strong>${date(i.date)}</strong></div><div><span class="muted">Status</span><strong>${esc(i.status)}</strong></div></div><table class="print-table"><thead><tr><th>Item</th><th>Qty</th><th>Unit price</th><th>Total</th></tr></thead><tbody>${(i.items || []).map((item) => `<tr><td>${esc(item.name)}</td><td>${item.quantity}</td><td>${currency(item.unitPrice)}</td><td>${currency(item.total)}</td></tr>`).join('')}</tbody></table><div class="summary right" style="justify-content:flex-end"><div><span class="muted">Subtotal</span><strong>${currency(i.subtotal)}</strong></div><div><span class="muted">Discount</span><strong>${currency(i.discount)}</strong></div><div><span class="muted">Total due</span><strong>${currency(i.total)}</strong></div></div>`); }
function printPayment(id) { const p = byId(state.payments, id); if (!p) return; printHtml(`Money receipt ${p.receiptNumber}`, `<div class="summary"><div><span class="muted">Receipt</span><strong>${esc(p.receiptNumber)}</strong></div><div><span class="muted">Patient</span><strong>${esc(patientName(p.patientId))}</strong></div><div><span class="muted">Date</span><strong>${date(p.date)}</strong></div></div><h2>Received</h2><p style="font-size:24px;font-weight:700">${currency(p.amount)}</p><p>Payment method: <b>${esc(p.method || '—')}</b><br>Reference: ${esc(p.reference || '—')}</p>`); }
function printPrescription(id) { const p = byId(state.prescriptions, id); if (!p) return; printHtml(`Prescription ${p.prescriptionCode}`, `<div class="summary"><div><span class="muted">Patient</span><strong>${esc(patientName(p.patientId))}</strong></div><div><span class="muted">Date</span><strong>${date(p.date)}</strong></div><div><span class="muted">Prescriber</span><strong>${esc(p.doctor)}</strong></div></div><table class="print-table"><thead><tr><th>Medicine</th><th>Dosage</th><th>Frequency</th><th>Duration</th><th>Instructions</th></tr></thead><tbody>${(p.medications || []).map((m) => `<tr><td>${esc(m.medicine)}<br>${esc(m.strength || '')}</td><td>${esc(m.dosage || '—')}</td><td>${esc(m.frequency || '—')}</td><td>${esc(m.duration || '—')}</td><td>${esc(m.instructions || '—')}</td></tr>`).join('')}</tbody></table><p style="margin-top:40px">${esc(p.notes || '')}</p>`); }
function printPatient(id) { const p = byId(state.patients, id); if (!p) return; const visits = active(state.visits).filter((v) => v.patientId === id); printHtml(`Patient summary — ${p.fullName}`, `<div class="summary"><div><span class="muted">Patient code</span><strong>${esc(p.patientCode)}</strong></div><div><span class="muted">Phone</span><strong>${esc(p.phone || '—')}</strong></div><div><span class="muted">Registration</span><strong>${date(p.registrationDate)}</strong></div></div><h2>Patient details</h2><table class="print-table"><tbody><tr><th>Date of birth</th><td>${date(p.dateOfBirth)}</td><th>Gender</th><td>${esc(p.gender || '—')}</td></tr><tr><th>Allergies</th><td>${esc(p.allergies || 'None recorded')}</td><th>Blood group</th><td>${esc(p.bloodGroup || '—')}</td></tr><tr><th>Address</th><td colspan="3">${esc(p.address || '—')}</td></tr></tbody></table><h2>Visit history</h2>${visits.length ? `<table class="print-table"><thead><tr><th>Date</th><th>Reason</th><th>Diagnosis</th><th>Treatment</th></tr></thead><tbody>${visits.map((v) => `<tr><td>${date(v.date)}</td><td>${esc(v.reason || '—')}</td><td>${esc(v.diagnosis || '—')}</td><td>${esc(v.treatmentPerformed || '—')}</td></tr>`).join('')}</tbody></table>` : '<p>No visits recorded.</p>'}`); }
function printDental() { const p = byId(state.patients, ui.dentalPatientId); if (!p) return notify('Choose a patient before printing the chart.', 'error'); const records = state.dentalRecords.filter((r) => r.patientId === p.id); printHtml(`Dental chart — ${p.fullName}`, `<p>FDI adult dentition record.</p><table class="print-table"><thead><tr><th>Tooth</th><th>Status</th><th>Note</th><th>Updated</th></tr></thead><tbody>${records.length ? records.map((r) => `<tr><td>${r.tooth}</td><td>${esc(r.status || '—')}</td><td>${esc(r.note || '—')}</td><td>${date(r.updatedAt?.slice(0, 10))}</td></tr>`).join('') : '<tr><td colspan="4">No tooth records.</td></tr>'}</tbody></table>`); }
function printReport() { const r = buildReport(ui.reportType, ui.reportsRange); printHtml(r.title, `<div class="summary">${r.kpis.map((k) => `<div><span class="muted">${esc(k.label)}</span><strong>${esc(k.value)}</strong></div>`).join('')}</div>${r.body.replaceAll('data-table', 'print-table')}`); }

function render() { app.innerHTML = ui.locked ? lockScreen() : shell(); translateDom(); document.title = `${ui.locked ? 'Workspace locked' : pageTitle()} · Dentiva Pro`; }

document.addEventListener('click', handleClick);
document.addEventListener('submit', handleSubmit);
document.addEventListener('input', handleInput);
document.addEventListener('change', handleChange);
document.addEventListener('keydown', handleKeydown);
window.addEventListener('error', (event) => { console.error(event.error || event.message); });

// File import listener is delegated because the input is re-created with the Backup page.
document.addEventListener('change', (event) => {
  if (event.target.dataset.input === 'patient-attachment-file') {
    const file = event.target.files?.[0]; if (!file) return;
    const attachmentValidation = validateAttachmentFile(file);
    if (!attachmentValidation.allowedTypes.includes(file.type)) { notify('This file type is not allowed for clinical attachments.', 'error'); return; }
    if (file.size > attachmentValidation.maxBytes) { notify('Attachments are limited to 6 MB to protect local storage.', 'error'); return; }
    const reader = new FileReader(); reader.onload = () => { const patient = byId(state.patients, ui.patientId); if (!patient) return; state.attachments.push({ id: uid('attachment'), patientId: patient.id, name: file.name.replace(/[^a-zA-Z0-9._ -]/g, '_'), type: file.type, size: file.size, data: reader.result, category: file.type.startsWith('image/') ? 'Image / X-ray' : file.type === 'application/pdf' ? 'PDF report' : 'Clinical document', createdAt: now(), updatedAt: now() }); audit('Attachment added', 'Attachment', patient.id, file.name); Store.save(state); notify('Attachment added to the patient record.'); };
    reader.readAsDataURL(file); return;
  }
  if (event.target.dataset.input !== 'backup-file') return;
  const file = event.target.files?.[0]; if (!file) return;
  const reader = new FileReader(); reader.onload = () => {
    try {
      const parsed = JSON.parse(reader.result); const source = parsed.data || parsed; const counts = Object.fromEntries(arrayKeys.map((key) => [key, Array.isArray(source[key]) ? source[key].length : 0])); const conflicts = arrayKeys.reduce((total, key) => total + (Array.isArray(source[key]) ? source[key].filter((record) => record.id && state[key].some((existing) => existing.id === record.id)).length : 0), 0); const errors = !source.schemaVersion && !parsed.manifest ? 1 : 0; ui.restoreCandidate = { name: file.name, product: parsed.manifest?.product || 'Dentiva Pro / legacy export', schemaVersion: parsed.manifest?.schemaVersion || source.schemaVersion || '?', total: Object.values(counts).reduce((a, b) => a + b, 0), counts, conflicts, errors, data: source, strategy: 'Keep Existing', restorePatients: true, restoreClinical: true, restoreFinance: true, restoreOperations: true, restoreSettings: true }; render(); notify('Backup validated. Review the import preview before restoring.');
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
