// Dentiva Pro v1.4.0 — renderer (async, paginated, light Design System 2.0).
//
// The renderer is a pure presentation client. All data crosses the validated
// boundary in src/api.js (desktop: IPC → main process; browser dev: LocalRepo
// in-page). Nothing here owns storage, hashing or authorization — it renders
// what the service layer returns and hides what the session may not see
// (the backend still enforces every rule).
//
// Offline-first by design: no network, no cloud, no telemetry. This machine
// is the only copy; backups are explicit.

import './styles.css';
import { createApi } from './api.js';
import { hasPermission, validateAttachmentFile, buildRestorePlan, calculateInvoice, moneyToCents, centsToMoney } from './core.js';
import { periodBounds } from './domain.js';
import { APP_VERSION } from './migrate-state.js';

const api = createApi();
const app = document.querySelector('#app');

const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Dhaka', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
const now = () => new Date().toISOString();
const esc = (value) => String(value ?? '').replace(/[&<>'"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[c]));
const attr = esc;
const safeLogoSource = (value) => /^data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/=\s]+$/i.test(String(value || '')) ? String(value) : '';
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
}

const BENGALI_DICT = {

  'Dashboard': 'ড্যাশবোর্ড', 'Patients': 'রোগী', 'Appointments': 'অ্যাপয়েন্টমেন্ট', "Today's Queue": 'আজকের সিরিয়াল',
  'Clinical Records': 'ক্লিনিক্যাল রেকর্ড', 'Prescriptions': 'প্রেসক্রিপশন', 'Dental Chart': 'ডেন্টাল চার্ট', 'Treatment Catalog': 'চিকিৎসা তালিকা', 'Accounting': 'হিসাবরক্ষণ',
  'Billing': 'বিলিং', 'Payments': 'পরিশোধ', 'Inventory': 'ইনভেন্টরি', 'Suppliers': 'সরবরাহকারী', 'Staff': 'স্টাফ',
  'Reports': 'রিপোর্ট', 'Analytics': 'বিশ্লেষণ', 'Diagnostics': 'ডায়াগনস্টিকস', 'Notifications': 'নোটিফিকেশন', 'Backup & Restore': 'ব্যাকআপ ও পুনরুদ্ধার', 'Settings': 'সেটিংস', 'Help': 'সহায়তা', 'About': 'পরিচিতি',
  'Workspace': 'ওয়ার্কস্পেস', 'Clinical': 'ক্লিনিক্যাল', 'Finance': 'আর্থিক', 'Operations': 'পরিচালনা', 'Insights': 'বিশ্লেষণ', 'System': 'সিস্টেম',
  'New patient': 'নতুন রোগী', 'New appointment': 'নতুন অ্যাপয়েন্টমেন্ট', 'New visit': 'নতুন ভিজিট', 'New invoice': 'নতুন ইনভয়েস', 'Saved medication': 'সংরক্ষিত ওষুধ', 'Choose a saved medicine...': 'সংরক্ষিত ওষুধ বেছে নিন...', 'Save current medicine to catalog': 'বর্তমান ওষুধ ক্যাটালগে সংরক্ষণ',
  'Record payment': 'পরিশোধ রেকর্ড', 'Add stock': 'স্টক যোগ করুন', 'Complete setup': 'সেটআপ সম্পূর্ণ করুন', 'Open appointments': 'অ্যাপয়েন্টমেন্ট খুলুন',
  'View queue': 'সিরিয়াল দেখুন', 'Clinical records': 'ক্লিনিক্যাল রেকর্ড', 'Create prescription': 'প্রেসক্রিপশন তৈরি করুন',
  'Export CSV': 'CSV এক্সপোর্ট', 'Activity log': 'কার্যকলাপ লগ', 'Signal categories': 'সিগন্যাল বিভাগ', 'Every protected action, attributed to the account that performed it': 'প্রতিটি সুরক্ষিত কাজ, যে অ্যাকাউন্ট করেছে তার সহিত', 'Print queue': 'সিরিয়াল প্রিন্ট', 'Print statement': 'স্টেটমেন্ট প্রিন্ট', 'Stock movement': 'স্টক মুভমেন্ট',
  'Export full backup': 'সম্পূর্ণ ব্যাকআপ এক্সপোর্ট', 'Import backup': 'ব্যাকআপ ইমপোর্ট', 'Save settings': 'সেটিংস সংরক্ষণ',
  'Cancel': 'বাতিল', 'Save changes': 'পরিবর্তন সংরক্ষণ', 'Save record': 'রেকর্ড সংরক্ষণ', 'Search anything': 'যেকোনো কিছু খুঁজুন',
  'Today': 'আজ', 'Last 7 days': 'গত ৭ দিন', 'Last 1 month': 'গত ১ মাস', 'Last 3 months': 'গত ৩ মাস', 'Last 6 months': 'গত ৬ মাস', 'Last 1 year': 'গত ১ বছর', 'Custom range': 'কাস্টম সময়সীমা',
  'Active': 'সক্রিয়', 'Inactive': 'নিষ্ক্রিয়', 'Scheduled': 'নির্ধারিত', 'Checked In': 'চেক-ইন', 'Waiting': 'অপেক্ষমাণ',
  'In Treatment': 'চিকিৎসাধীন', 'Completed': 'সম্পন্ন', 'Cancelled': 'বাতিল', 'No Show': 'অনুপস্থিত', 'Paid': 'পরিশোধিত',
  'Partially Paid': 'আংশিক পরিশোধ', 'Unpaid': 'অপরিশোধিত', 'Low stock': 'স্টক কম', 'In stock': 'স্টকে আছে', 'Expired': 'মেয়াদোত্তীর্ণ',
  'No records in this range': 'এই সময়সীমায় কোনো রেকর্ড নেই', 'No patients found': 'কোনো রোগী পাওয়া যায়নি', 'No notifications': 'কোনো নোটিফিকেশন নেই', 'Queue wait': 'সিরিয়ালে অপেক্ষা', 'Clinical follow-ups': 'ক্লিনিক্যাল ফলো-আপ', 'Stock and expiry': 'স্টক ও মেয়াদ', 'Outstanding balances': 'বকেয়া ব্যালান্স', 'Backup reminders': 'ব্যাকআপ অনুস্মারক', 'Notification categories': 'নোটিফিকেশনের বিভাগ', 'Document footer': 'ডকুমেন্ট ফুটার', 'Show clinic logo in documents': 'ডকুমেন্টে ক্লিনিকের লোগো দেখান', 'Show clinic contact in documents': 'ডকুমেন্টে ক্লিনিকের যোগাযোগ দেখান', 'Print preview': 'প্রিন্ট প্রিভিউ', 'Send to printer': 'প্রিন্টারে পাঠান', 'Save as PDF': 'পিডিএফ হিসেবে সংরক্ষণ করুন', 'Paper size': 'কাগজের মাপ', '80 mm receipt': '৮০ মিমি রসিদ', 'Print cancelled': 'প্রিন্ট বাতিল হয়েছে', 'Document sent to the printer.': 'ডকুমেন্ট প্রিন্টারে পাঠানো হয়েছে।', 'Nothing prints silently.': 'নীরবে কিছুই প্রিন্ট হয় না।', 'Preview the document, choose the paper size, then print or save as PDF.': 'ডকুমেন্টটি দেখুন, কাগজের মাপ বেছে নিন, তারপর প্রিন্ট বা পিডিএফ সংরক্ষণ করুন।', 'Appointment slip': 'অ্যাপয়েন্টমেন্ট স্লিপ', 'Treatment estimate': 'চিকিৎসার আনুমানিক খরচ', 'Print slip': 'স্লিপ প্রিন্ট', 'Print estimate': 'অনুমান প্রিন্ট',
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
,

  Analytics: 'বিশ্লেষণ', Notifications: 'নোটিফিকেশন', Diagnostics: 'ডায়াগনস্টিকস', 'Command centre': 'কমান্ড সেন্টার', 'Search your workspace': 'ওয়ার্কস্পেসে খুঁজুন', Commands: 'কমান্ড', Command: 'কমান্ড', 'Open analytics': 'বিশ্লেষণ খুলুন', 'Open reports': 'রিপোর্ট খুলুন', 'Run integrity check': 'ইন্টিগ্রিটি চেক চালান', 'Workspace health': 'ওয়ার্কস্পেসের স্বাস্থ্য', Healthy: 'স্বাস্থ্যকর', 'Needs attention': 'মনোযোগ প্রয়োজন', 'Database health': 'ডেটাবেসের স্বাস্থ্য', 'Access health': 'অ্যাক্সেসের স্বাস্থ্য', 'Integrity results': 'ইন্টিগ্রিটি ফলাফল', 'No current integrity issues': 'বর্তমানে কোনো ইন্টিগ্রিটি সমস্যা নেই', 'Revenue and visit trend': 'আয় ও ভিজিটের প্রবণতা', 'Payment mix': 'পরিশোধের ধরন', 'Clinical activity': 'ক্লিনিক্যাল কার্যক্রম', 'Commercial review': 'বাণিজ্যিক পর্যালোচনা', 'Patient alert': 'রোগীর সতর্কতা', 'Important alert': 'গুরুত্বপূর্ণ সতর্কতা', 'Preferred contact method': 'পছন্দের যোগাযোগ মাধ্যম', Tags: 'ট্যাগ', Procedures: 'প্রক্রিয়াসমূহ', 'Tooth number(s)': 'দাঁতের নম্বর', 'Estimated duration (minutes)': 'আনুমানিক সময় (মিনিট)', 'Estimated cost': 'আনুমানিক খরচ', Discount: 'ছাড়', 'Estimated total': 'আনুমানিক মোট', 'Additional medicines': 'অতিরিক্ত ওষুধ', 'Mark all read': 'সব পড়া হিসেবে চিহ্নিত করুন', Open: 'খুলুন', Dismiss: 'সরান', 'No payment data': 'কোনো পরিশোধের তথ্য নেই', 'No matching records': 'কোনো মিলযুক্ত রেকর্ড নেই', 'Review': 'পর্যালোচনা', 'Low stock': 'স্টক কম', 'Expiry review': 'মেয়াদ পর্যালোচনা', 'Queue attention': 'সিরিয়ালে মনোযোগ প্রয়োজন', 'Backup recommended': 'ব্যাকআপ নেওয়া উচিত', 'Edit patient': 'রোগী সম্পাদনা', 'Death Review': 'মৃত্যু পর্যালোচনা', 'Follow-up': 'ফলো-আপ', 'Name': 'নাম', 'Quantity': 'পরিমাণ', 'Category': 'বিভাগ', 'Unit': 'একক', 'Status': 'অবস্থা', 'Stock movement': 'স্টক মুভমেন্ট', 'Custom patient fields': 'কাস্টম রোগী ফিল্ড', 'Movement ledger': 'মুভমেন্ট খাতা', 'Invoice': 'ইনভয়েস', 'Receipt': 'রসিদ', 'Prescription': 'প্রেসক্রিপশন', 'Treatment plan': 'চিকিৎসা পরিকল্পনা', 'Waitlist': 'ওয়েটলিস্ট', 'Queue': 'সিরিয়াল', 'Ledger': 'খাতা', 'Record type': 'রেকর্ডের ধরন', 'Recorded snapshot': 'রেকর্ডকৃত স্ন্যাপশট', 'Export audit log': 'অডিট লগ এক্সপোর্ট', 'Audit trail': 'অডিট ট্রেইল', 'Snapshot keys': 'স্ন্যাপশট কী', 'Text': 'টেক্সট', 'Number': 'সংখ্যা', 'Backup interval (hours)': 'ব্যাকআপ ব্যবধান (ঘণ্টা)', 'Every 12 hours': 'প্রতি ১২ ঘণ্টা', 'Daily': 'প্রতিদিন', 'Weekly': 'সাপ্তাহিক', 'Session timeout (minutes)': 'সেশন মেয়াদ (মিনিট)', 'Auto lock (minutes)': 'অটো লক (মিনিট)', 'Clinic logo': 'ক্লিনিকের লোগো', 'Show logo on documents': 'নথিতে লোগো দেখান', 'Notification preferences': 'নোটিফিকেশন পছন্দসমূহ', 'Categories': 'বিভাগসমূহ', 'Portal theme': 'পোর্টাল থিম', 'Patient': 'রোগী', 'Phone': 'ফোন', 'Email': 'ইমেইল', 'Address': 'ঠিকানা', 'City': 'শহর', 'District': 'জেলা', 'Country': 'দেশ', 'Date': 'তারিখ', 'Time': 'সময়', 'Amount': 'পরিমাণ', 'Notes': 'নোট', 'Reason': 'কারণ', 'Reference': 'রেফারেন্স', 'Supplier': 'সরবরাহকারী', 'Chair': 'চেয়ার', 'Room': 'কক্ষ', 'Dentist': 'দন্ত চিকিৎসক', 'Doctor': 'ডাক্তার', 'Specialty': 'বিশেষত্ব', 'Specialization': 'বিশেষজ্ঞতা', 'Title': 'শিরোনাম', 'Code': 'কোড', 'View': 'দেখুন', 'Close': 'বন্ধ করুন', 'Delete': 'মুছুন', 'Remove': 'সরান', 'Restore': 'পুনরুদ্ধার', 'Retry': 'পুনরায় চেষ্টা', 'Complete': 'সম্পন্ন করুন', 'Void': 'বাতিল', 'Details': 'বিস্তারিত', 'Patient': 'রোগী',
  'Findings': 'লক্ষণ ও ফলাফল', 'Chief complaint': 'প্রধান অভিযোগ', 'Medical history': 'চিকিৎসাগত ইতিহাস', 'Communication notes': 'যোগাযোগের নোট', 'Emergency contact name': 'জরুরি যোগাযোগের নাম', 'Emergency contact phone': 'জরুরি যোগাযোগের ফোন', 'Important alerts': 'গুরুত্বপূর্ণ সতর্কতা', 'Marital status': 'বৈবাহিক অবস্থা', 'Secondary phone': 'বিকল্প ফোন', 'Tags (comma separated)': 'ট্যাগ (কমা দিয়ে আলাদা)', 'Procedures': 'প্রক্রিয়াসমূহ', 'Procedures (comma separated)': 'প্রক্রিয়াসমূহ (কমা দিয়ে আলাদা)', 'Planned treatment': 'পরিকল্পিত চিকিৎসা', 'Convert to visit': 'ভিজিটে রূপান্তর', 'Schedule follow-up': 'ফলো-আপ নির্ধারণ করুন', 'Due date': 'প্রদেয় তারিখ', 'Referral date': 'রেফারেলের তারিখ', 'Referred to': 'যাকে রেফার করা হয়েছে', 'Response / report': 'প্রতিক্রিয়া / রিপোর্ট', 'Referral date': 'রেফারেলের তারিখ',
  'Movement type': 'মুভমেন্টের ধরন', 'Reason / note': 'কারণ / নোট', 'Correction direction': 'সংশোধনের দিক', 'Purchase price': 'ক্রয় মূল্য', 'Sale price': 'বিক্রয় মূল্য', 'Minimum stock': 'ন্যূনতম স্টক', 'Opening stock': 'প্রারম্ভিক স্টক', 'Duplicate patient to merge': 'একত্র করার জন্য সদৃশ রোগী', 'Merge duplicate…': 'সদৃশ একত্র করুন…', 'Back to patients': 'রোগীদের কাছে ফিরুন', 'Edit patient details': 'রোগীর তথ্য সম্পাদনা', 'Currency': 'মুদ্রা', 'Receipt prefix': 'রসিদ উপসর্গ', 'Visit prefix': 'ভিজিট উপসর্গ', 'Default appointment duration (minutes)': 'ডিফল্ট অ্যাপয়েন্টমেন্ট সময়কাল (মিনিট)', 'Low stock threshold': 'নিম্ন স্টকের সীমা', 'Print page size': 'প্রিন্ট পৃষ্ঠার আকার', 'Automatic backup frequency': 'স্বয়ংক্রিয় ব্যাকআপ সময়সূচি', 'Backups to keep (retention)': 'কতটি ব্যাকআপ রাখবেন', 'Enable tax on invoices': 'ইনভয়েসে ট্যাক্স প্রযোজ্য', 'Apply tax': 'ট্যাক্স প্রয়োগ করুন', 'Tax rate (%)': 'ট্যাক্সের হার (%)', 'Invoice (optional)': 'ইনভয়েস (ঐচ্ছিক)', 'Attachment name': 'সংযুক্তির নাম', 'Administrator PIN': 'প্রশাসকের পিন',
  'Print summary': 'সারসংক্ষেপ প্রিন্ট', 'Print receipt': 'রসিদ প্রিন্ট', 'Print visit': 'ভিজিট প্রিন্ট', 'Print billing': 'বিলিং প্রিন্ট', 'Create secure backup': 'নিরাপদ ব্যাকআপ তৈরি করুন', 'Restore now': 'এখনই পুনরুদ্ধার করুন', 'Cancel restore': 'পুনরুদ্ধার বাতিল', 'Choose backup folder…': 'ব্যাকআপ ফোল্ডার বেছে নিন…', 'Import JSON backup…': 'JSON ব্যাকআপ ইমপোর্ট করুন…', 'Customize dashboard': 'ড্যাশবোর্ড কাস্টমাইজ করুন', 'Record expense': 'খরচ লিপিবদ্ধ করুন', 'Move stock': 'স্টক সরান', 'Clear record': 'রেকর্ড মুছুন', 'Location': 'অবস্থান', 'Document footer': 'নথির ফুটার', 'User Accounts': 'ব্যবহারকারী অ্যাকাউন্ট',
  'No visits yet': 'কোন ভিজিট নেই এখনো', 'No visit data': 'কোন ভিজিট তথ্য নেই', 'No payments yet': 'কোন পেমেন্ট নেই এখনো', 'No expenses yet': 'কোন খরচ নেই এখনো', 'No suppliers yet': 'কোন সরবরাহকারী নেই এখনো', 'No staff yet': 'কোন স্টাফ নেই এখনো', 'No treatments yet': 'কোন চিকিৎসা নেই এখনো', 'No follow-ups scheduled': 'কোন ফলো-আপ নির্ধারিত নেই', 'No referrals yet': 'কোন রেফারেল নেই এখনো', 'No backups yet': 'কোন ব্যাকআপ নেই এখনো', 'No audit entries match': 'কোন অডিট এন্ট্রি মিলেনি', 'No notifications right now': 'এই মুহূর্তে কোন নোটিফিকেশন নেই', 'No appointments this week': 'এ সপ্তাহে কোন অ্যাপয়েন্টমেন্ট নেই', 'Upcoming agenda is empty': 'আসন্ন কর্মসূচি খালি', 'Nothing booked': 'কিছুই বুক করা নেই', 'Nothing here yet': 'এখানে এখনো কিছু নেই', 'Nothing outstanding': 'কোন বকেয়া নেই', 'No alerts recorded': 'কোন সতর্কতা রেকর্ড করা নেই', 'Open from a patient': 'একজন রোগী থেকে খুলুন', 'Clinical safety reminders': 'ক্লিনিক্যাল সুরক্ষা স্মৃতির', 'Low stock list': 'নিম্ন স্টকের তালিকা',
};

function localized(value) { return appState.settings.language === 'Bengali' ? (BENGALI_DICT[value] || value) : value; }
function translateDom() {
  if (appState.settings.language !== 'Bengali' || !app) return;
  const entries = Object.entries(BENGALI_DICT).sort((a, b) => b[0].length - a[0].length);
  const translate = (value) => entries.reduce((result, [english, bengali]) => result.includes(english) ? result.split(english).join(bengali) : result, String(value || ''));
  const walker = document.createTreeWalker(app, 4);
  let node;
  while ((node = walker.nextNode())) {
    const rawText = node.nodeValue || '';
    if (rawText.trim()) node.nodeValue = translate(rawText);
  }
  app.querySelectorAll('[placeholder], [title], [aria-label]').forEach((element) => {
    ['placeholder', 'title', 'aria-label'].forEach((attribute) => {
      const value = element.getAttribute(attribute);
      if (value) element.setAttribute(attribute, translate(value));
    });
  });
}

const NAV_GROUPS = [
  { label: 'Workspace', items: [['dashboard', 'Dashboard', 'grid'], ['patients', 'Patients', 'users'], ['appointments', 'Appointments', 'calendar'], ['queue', "Today's Queue", 'clipboard']] },
  { label: 'Clinical', items: [['clinical', 'Clinical Records', 'activity'], ['prescriptions', 'Prescriptions', 'file'], ['dental', 'Dental Chart', 'tooth'], ['treatments', 'Treatment Catalog', 'layers']] },
  { label: 'Finance', items: [['billing', 'Billing', 'receipt'], ['payments', 'Payments', 'credit'], ['accounting', 'Accounting', 'dollar']] },
  { label: 'Operations', items: [['inventory', 'Inventory', 'box'], ['suppliers', 'Suppliers', 'truck'], ['staff', 'Staff', 'briefcase']] },
  { label: 'Insights', items: [['reports', 'Reports', 'chart'], ['analytics', 'Analytics', 'activity']] },
  { label: 'System', items: [['notifications', 'Notifications', 'bell'], ['audit', 'Activity log', 'activity'], ['backup', 'Backup & Restore', 'backup'], ['diagnostics', 'Diagnostics', 'database'], ['users', 'User Accounts', 'users'], ['settings', 'Settings', 'settings'], ['help', 'Help', 'help'], ['about', 'About', 'info']] }
];

function icon(name, size = 18, className = '') {
  const path = ICONS[name] || ICONS.info;
  return `<svg class="icon ${className}" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${path}</svg>`;
}

/* ------------------------------------------------------------------ */
/* App state: session + settings + lookup directory. The renderer      */
/* never holds a full collection — lists are fetched per view.         */
/* ------------------------------------------------------------------ */
const appState = {
  ready: false,
  boot: null,
  session: null,
  firstRun: false,
  setupComplete: false,
  settings: {},
  unsupportedSchema: false,
  migrationError: '',
  storage: null,
  counts: {},
  directory: { patients: [], staff: [], treatments: [] },
  notifications: [],
  sessionTimeoutMinutes: 30,
  lastActivity: Date.now()
};

function can(permission) {
  if (!appState.session) return true; // first-run setup session holds everything
  return (appState.session.permissions || []).includes(permission) || hasPermission({ active: true, role: appState.session.role, permissions: appState.session.permissions }, permission);
}
function requirePermission(permission, message = 'Your account is not allowed to perform this action.') {
  if (can(permission)) return true;
  notify(message, 'error');
  return false;
}

const q = (name, params = {}) => api.runQuery(name, params);
async function op(name, payload = {}) {
  const result = await api.runOp(name, payload);
  if (!result || result.ok === false) {
    notify(result?.error || 'The action could not be completed.', 'error');
    return null;
  }
  if (!String(name).startsWith('notification')) scheduleNotificationScan();
  return result;
}

/* ------------------------------------------------------------------ */
/* Formatting                                                          */
/* ------------------------------------------------------------------ */
function currency(value = 0) {
  const settings = appState.settings;
  const symbol = { BDT: '৳', USD: '$', EUR: '€', INR: '₹' }[settings.currency] || `${settings.currency || 'BDT'} `;
  const amount = new Intl.NumberFormat(appState.settings.language === 'Bengali' ? 'bn-BD' : 'en-BD', { maximumFractionDigits: 2 }).format(Number(value) || 0);
  return `${symbol}${amount}`;
}
function number(value = 0) { return new Intl.NumberFormat(appState.settings.language === 'Bengali' ? 'bn-BD' : 'en-BD').format(Number(value) || 0); }
function date(value, opts = {}) {
  if (!value) return '—';
  const locale = appState.settings.language === 'Bengali' ? 'bn-BD' : 'en-GB';
  try { return new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short', year: 'numeric', ...opts }).format(new Date(`${String(value).slice(0, 10)}T00:00:00`)); } catch { return String(value); }
}
function dateFull(value) {
  if (!value) return '—';
  const locale = appState.settings.language === 'Bengali' ? 'bn-BD' : 'en-GB';
  try { return new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'long', year: 'numeric' }).format(new Date(`${String(value).slice(0, 10)}T00:00:00`)); } catch { return String(value); }
}
function time(value) {
  if (!value) return '—';
  const [h, m] = String(value).split(':').map(Number);
  if (appState.settings.timeFormat === '24') return `${String(h).padStart(2, '0')}:${String(m || 0).padStart(2, '0')}`;
  const period = h >= 12 ? 'PM' : 'AM';
  const hour12 = h % 12 === 0 ? 12 : h % 12;
  return `${hour12}:${String(m || 0).padStart(2, '0')} ${period}`;
}
function relativeDate(value) {
  if (!value) return '—';
  const diff = Math.round((new Date(`${value}T00:00:00`).getTime() - new Date(`${today()}T00:00:00`).getTime()) / 86400000);
  if (diff === 0) return 'Today';
  if (diff === 1) return 'Tomorrow';
  if (diff === -1) return 'Yesterday';
  if (diff > 0 && diff < 30) return `In ${diff} days`;
  if (diff < 0 && diff > -30) return `${Math.abs(diff)} days ago`;
  return date(value);
}
function ageFromDate(value) {
  if (!value) return null;
  const birth = new Date(`${value}T00:00:00`);
  if (Number.isNaN(birth.getTime())) return null;
  const current = new Date();
  let years = current.getFullYear() - birth.getFullYear();
  const beforeBirthday = current.getMonth() < birth.getMonth() || (current.getMonth() === birth.getMonth() && current.getDate() < birth.getDate());
  if (beforeBirthday) years -= 1;
  return years >= 0 && years < 130 ? years : null;
}
function initials(value = '') { return String(value).split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]).join('').toUpperCase() || 'DP'; }
function patientName(id) { return appState.directory.patients.find((p) => p.id === id)?.fullName || 'Unassigned patient'; }
function staffName(id) { return appState.directory.staff.find((p) => p.id === id)?.name || appState.settings.dentistName || 'Primary dentist'; }
function formatBytes(bytes) { if (!bytes) return '0 B'; const units = ['B', 'KB', 'MB', 'GB', 'TB']; const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1); return `${(bytes / Math.pow(1024, index)).toFixed(index ? 1 : 0)} ${units[index]}`; }
function numeric(value) { const n = Number(value); return Number.isFinite(n) ? n : 0; }

/* Money display from cents (authoritative) with decimal fallback. */
function moneyCents(record, camel = 'amountCents', decimal = 'amount') {
  if (record?.[camel] !== undefined && record?.[camel] !== null) return Math.max(0, Number(record[camel]));
  return Math.max(0, moneyToCents(record?.[decimal] ?? 0));
}
function money(record, camel = 'amountCents', decimal = 'amount') { return currency(centsToMoney(moneyCents(record, camel, decimal))); }

function statusTone(status = '') {
  const normalized = String(status).toLowerCase().replace(/\s+/g, '-');
  if (['completed', 'paid', 'active', 'checked-in', 'in-treatment', 'healthy', 'in-stock', 'recorded', 'ok'].includes(normalized)) return 'success';
  if (['waiting', 'partially-paid', 'partial', 'scheduled', 'caries', 'low-stock', 'partially-refunded', 'in-progress', 'contacted'].includes(normalized)) return 'warning';
  if (['cancelled', 'no-show', 'unpaid', 'out-of-stock', 'expired', 'archived', 'refunded', 'inactive', 'dismissed'].includes(normalized)) return 'danger';
  return 'neutral';
}
function statusBadge(status) { return badge(status || 'Not set', statusTone(status)); }
function badge(label, tone = 'neutral') { return `<span class="badge badge-${tone}"><i></i>${esc(localized(label))}</span>`; }

/* ------------------------------------------------------------------ */
/* UI state                                                            */
/* ------------------------------------------------------------------ */
const initialCalendarDate = new Date();
let ui = {
  toast: null,
  locked: false,
  page: 'dashboard',
  range: 'today',
  rangeFrom: '',
  rangeTo: '',
  analyticsRange: 'month',
  reportsRange: 'month',
  reportType: 'revenue',
  dentition: 'adult',
  calendarDate: today(),
  apptView: 'day',
  search: '',
  patientPage: 1,
  patientQuery: '',
  patientBalanceFilter: 'all',
  patientStatusFilter: 'all',
  patientTab: 'overview',
  patientId: null,
  patientDetail: null,
  modal: null,
  csvImport: null,
  unlockFailures: 0,
  unlockBlockedUntil: 0,
  restoreCandidate: null
};

/* Per-list pagination/filter state (server-side). */
const listState = {
  patients: { page: 1, pageSize: 25, query: '', filters: {} },
  appointments: { page: 1, pageSize: 30, query: '', filters: {} },
  visits: { page: 1, pageSize: 25, query: '', filters: {} },
  prescriptions: { page: 1, pageSize: 25, query: '', filters: {} },
  invoices: { page: 1, pageSize: 25, query: '', filters: {} },
  payments: { page: 1, pageSize: 25, query: '', filters: {} },
  inventory: { page: 1, pageSize: 25, query: '', filters: {} },
  stockMovements: { page: 1, pageSize: 25, query: '', filters: {} },
  suppliers: { page: 1, pageSize: 25, query: '', filters: {} },
  staff: { page: 1, pageSize: 25, query: '', filters: {} },
  treatments: { page: 1, pageSize: 25, query: '', filters: {} },
  expenses: { page: 1, pageSize: 25, query: '', filters: {} },
  users: { page: 1, pageSize: 25, query: '', filters: {} },
  audit: { page: 1, pageSize: 25, query: '', filters: {} },
  savedFilters: { page: 1, pageSize: 50, query: '', filters: {} }
};

function listQuery(collection, overrides = {}) {
  const state = listState[collection] || { page: 1, pageSize: 25, query: '', filters: {} };
  return q('list', { collection, page: state.page, pageSize: state.pageSize, query: state.query || '', sort: state.sort || '', filters: { ...state.filters, ...overrides } });
}

/* ------------------------------------------------------------------ */
/* Notifications (service-derived + persisted)                         */
/* ------------------------------------------------------------------ */
const NOTIFICATION_RULE_LABELS = [['appointments', 'Appointment reminders'], ['followups', 'Clinical follow-ups'], ['payments', 'Pending payments'], ['stock', 'Stock and expiry'], ['expiry', 'Expiry alerts'], ['queue', 'Queue wait'], ['backup', 'Backup reminders']];
function notificationRules() { return appState.notificationRules || {}; }
function notificationRuleEnabled(kind) { return notificationRules()[kind] !== false; }
let notificationScanTimer = null;
let notificationInterval = null;
function scheduleNotificationScan(delay = 2500) {
  if (!appState.session || ui.locked) return;
  if (appState.settings.notifications === false) return;
  clearTimeout(notificationScanTimer);
  notificationScanTimer = setTimeout(() => { refreshNotifications({ scan: true }).catch(() => {}); }, delay);
}
function startNotificationInterval() {
  if (notificationInterval) return;
  notificationInterval = setInterval(() => { refreshNotifications({ scan: true }).catch(() => {}); }, 120000);
}
async function refreshNotifications({ scan = false } = {}) {
  try {
    if (scan) await api.runOp('notifications.scan', {});
    const result = await q('notifications', {});
    if (!result) return;
    appState.notificationRules = result.rules || {};
    appState.notificationItems = (result.items || []).filter((item) => !item.dismissed).slice(0, 64);
    const badge = document.querySelector('.dot-badge');
    const unread = unreadCount();
    if (badge && !unread) badge.remove();
  } catch { /* signal feed failure must never break the app */ }
}
async function loadNotifications() {
  return refreshNotifications({ scan: true });
}
function notificationItems() { return appState.notificationItems || []; }
function unreadCount() { return notificationItems().filter((item) => !item.read).length; }

/* ------------------------------------------------------------------ */
/* Session lifecycle                                                   */
/* ------------------------------------------------------------------ */
function requiresLogin() {
  return Boolean(appState.boot && !appState.firstRun && !appState.session);
}
function recordActivity() {
  appState.lastActivity = Date.now();
}
async function lockWorkspace(reason = 'Workspace locked') {
  ui.locked = true;
  ui.modal = null;
  notify(reason, 'info');
  render();
}
async function unlockWorkspace(pin) {
  const result = await api.login(appState.boot?.lockedUserId || ui.unlockUserId, pin);
  if (result.ok) { ui.locked = false; ui.session = result.session; appState.session = result.session; render(); return true; }
  notify(result.error || 'That PIN is not correct.', 'error');
  return false;
}
async function refreshSession() {
  try {
    const result = await api.session();
    if (!result.session && appState.session && !ui.locked && !appState.firstRun) {
      appState.session = null;
      lockWorkspace('Workspace locked');
    } else if (result.session) {
      appState.session = result.session;
      appState.lastActivity = Date.now();
    }
  } catch { /* keep current session on transient errors */ }
}
setInterval(refreshSession, 60_000);

/* ------------------------------------------------------------------ */
/* Toast                                                               */
/* ------------------------------------------------------------------ */
let toastTimer = null;
function notify(message, type = 'success') {
  ui.toast = { message, type, id: Date.now() };
  if (typeof document !== 'undefined') {
    const el = document.querySelector('.toast');
    if (el) {
      el.className = `toast toast-${type}`;
      el.querySelector('span')?.replaceChildren(message);
    } else { render(); }
  }
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { ui.toast = null; if (!document.querySelector('#app .toast')) render(); }, 4200);
}

/* ------------------------------------------------------------------ */
/* Shell                                                               */
/* ------------------------------------------------------------------ */
function pageTitle() {
  const groups = NAV_GROUPS;
  for (const group of groups) {
    const item = group.items.find(([id]) => id === ui.page);
    if (item) return item[1];
  }
  return 'Dashboard';
}
function sidebar() {
  const active = (id) => ui.page === id ? ' active' : '';
  return `<aside class="sidebar${ui.mobileNav ? ' open' : ''}" aria-label="Primary navigation">
    <div class="sidebar-brand">${icon('tooth', 22)}<div><strong>DENTIVA<span>PRO</span></strong><small>${esc(appState.settings.clinicName || 'Offline-first practice OS')}</small></div></div>
    <nav class="sidebar-nav">
      ${NAV_GROUPS.map((group) => `<div class="nav-group"><span class="nav-group-label">${esc(group.label)}</span>${group.items.map(([id, label, iconName]) => `<button class="nav-item${active(id)}" data-action="navigate" data-page="${id}">${icon(iconName, 17)}<span>${esc(localized(label))}</span>${id === 'notifications' && unreadCount() ? `<em class="nav-count">${unreadCount()}</em>` : ''}</button>`).join('')}</div>`).join('')}
    </nav>
    <div class="sidebar-foot">${appState.session ? `<div class="session-chip" title="${esc(appState.session.role)}">${icon('shield', 15)}<div><strong>${esc(appState.session.userName)}</strong><small>${esc(appState.session.role)}</small></div></div><button class="link-button" data-action="logout">${esc('Sign out')}</button>` : `<div class="session-chip">${icon('shield', 15)}<div><strong>Setup</strong><small>First run</small></div></div>`}</div>
  </aside>`;
}
function topbar() {
  const globalSearch = `<label class="search-field"><span>${icon('search', 16)}</span><input type="search" placeholder="Search your workspace" value="${attr(ui.search)}" data-input="global-search" aria-label="Search your workspace"><kbd>⌘ K</kbd></label>`;
  return `<header class="topbar">
    <button class="icon-button mobile-only" data-action="toggle-mobile-nav" aria-label="Open menu">${icon('menu', 20)}</button>
    ${globalSearch}
    <div class="topbar-right">
      <span class="topbar-date">${icon('calendar', 15)}${dateFull(today())}</span>
      ${appState.session ? `<button class="icon-button" data-action="open-notifications" aria-label="Notifications">${icon('bell', 18)}${unreadCount() ? `<em class="dot-badge">${unreadCount()}</em>` : ''}</button><button class="icon-button" data-action="lock-workspace" aria-label="Lock workspace" title="Lock workspace">${icon('lock', 17)}</button>` : ''}
    </div>
  </header>`;
}
function shell() {
  return `<div class="app-shell">
    ${sidebar()}
    <div class="main-shell">${topbar()}<main class="main-content" id="main-content"></main></div>
    ${ui.modal ? modal() : ''}
    ${ui.toast ? `<div class="toast toast-${ui.toast.type}" role="status">${icon(ui.toast.type === 'error' ? 'warning' : ui.toast.type === 'info' ? 'info' : 'check', 17)}<span>${esc(ui.toast.message)}</span><button class="toast-close" data-action="close-toast" aria-label="Dismiss">${icon('close', 14)}</button></div>` : ''}
  </div>`;
}

function pageHeader(title, subtitle, action = '') {
  return `<div class="page-header"><div><div class="eyebrow">${esc(appState.settings.clinicName || 'Dentiva Pro')}</div><h1>${esc(localized(title))}</h1><p>${esc(localized(subtitle))}</p></div>${action ? `<div class="page-actions">${action}</div>` : ''}</div>`;
}
function button(label, action, iconName = '', style = 'secondary', extra = '') {
  return `<button class="btn btn-${style}" data-action="${action}" ${extra}>${iconName ? icon(iconName, 16) : ''}<span>${esc(localized(label))}</span></button>`;
}
function emptyState(iconName, title, text, action = '') { return `<div class="empty-state"><span class="empty-icon-wrap">${icon(iconName, 27, 'empty-icon')}</span><h3>${esc(localized(title))}</h3><p>${esc(localized(text))}</p>${action}</div>`; }
function cardTitle(iconName, title, action = '') { return `<div class="card-title"><div class="card-title-text">${icon(iconName, 17)}<h2>${esc(localized(title))}</h2></div>${action}</div>`; }
function toolbar(filters = '', actions = '') { return `<div class="toolbar"><div class="toolbar-left">${filters}</div><div class="toolbar-right">${actions}</div></div>`; }
function dataTable(headers, body, empty = '') { return `<div class="table-wrap"><table class="data-table"><thead><tr>${headers.map((h) => `<th>${esc(h)}</th>`).join('')}</tr></thead><tbody>${body || `<tr><td colspan="${headers.length}">${empty}</td></tr>`}</tbody></table></div>`; }
function tablePager(total, page, collection) {
  const pageSize = listState[collection]?.pageSize || 25;
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const prev = page > 1 ? `<button class="btn btn-link" data-action="list-page" data-collection="${collection}" data-page="${page - 1}">← Newer</button>` : '<span class="pager-muted">← Newer</span>';
  const next = page < pages ? `<button class="btn btn-link" data-action="list-page" data-collection="${collection}" data-page="${page + 1}">Older →</button>` : '<span class="pager-muted">Older →</span>';
  return `<div class="table-pager">${prev}<span class="pager-info">${number((page - 1) * pageSize + 1)}–${number(Math.min(page * pageSize, total))} of ${number(total)}</span>${next}</div>`;
}

/* ------------------------------------------------------------------ */
/* Auth / lock / unsupported-schema screens                            */
/* ------------------------------------------------------------------ */
function authScreen() {
  const users = (appState.boot?.userDirectory || []).filter((user) => user.active !== false);
  return `<main class="lock-screen"><section class="lock-card"><div class="lock-brand"><span class="brand-symbol">${icon('tooth', 23)}</span><strong>DENTIVA<span> PRO</span></strong></div>
    <div class="lock-icon">${icon('lock', 26)}</div>
    <span class="eyebrow">LOCAL ACCOUNT SIGN-IN</span>
    <h1>Sign in to Dentiva Pro</h1>
    <p>Enter your local PIN. Accounts are stored on this device and protected with PBKDF2 key derivation.</p>
    <form data-form="user-login" class="auth-form">
      <label class="field-label">User${users.length > 1 ? `<select name="userId" required>${users.map((user) => `<option value="${attr(user.id)}" ${user.id === ui.unlockUserId ? 'selected' : ''}>${esc(user.name)} · ${esc(user.role)}</option>`).join('')}</select>` : `<input type="hidden" name="userId" value="${attr(ui.unlockUserId || users[0]?.id || '')}"><span class="field-static">${esc(users[0]?.name || '')} · ${esc(users[0]?.role || '')}</span>`}</label>
      <label class="field-label">PIN<input type="password" name="pin" inputmode="numeric" autocomplete="current-password" minlength="4" maxlength="12" pattern="[0-9]{4,12}" placeholder="Enter your local PIN" required autofocus></label>
      <button class="btn btn-primary btn-block" type="submit">${icon('lock', 16)}<span>Sign in</span></button>
    </form>
    <p class="form-note">Contact an Administrator if your account is disabled or your PIN is forgotten. Last sign-ins and lockout state stay auditable on this device.</p>
  </section></main>`;
}
function lockScreen() {
  return `<main class="lock-screen"><section class="lock-card"><div class="lock-brand"><span class="brand-symbol">${icon('tooth', 23)}</span><strong>DENTIVA<span> PRO</span></strong></div>
    <div class="lock-icon">${icon('lock', 26)}</div>
    <span class="eyebrow">WORKSPACE LOCKED</span>
    <h1>Workspace locked</h1>
    <p>This local workspace is protected. Your records remain on this device.</p>
    <form data-form="unlock" class="auth-form">
      <label class="field-label">Application PIN<input type="password" name="pin" inputmode="numeric" autocomplete="current-password" minlength="4" maxlength="12" pattern="[0-9]{4,12}" placeholder="Enter your application PIN" required autofocus></label>
      <button class="btn btn-primary btn-block" type="submit">${icon('lock', 16)}<span>Unlock workspace</span></button>
    </form>
    <p class="form-note">Forgotten PINs cannot be recovered by Dentiva Pro. Use a verified backup according to your clinic policy.</p>
  </section></main>`;
}
function unsupportedSchemaScreen() {
  return `<main class="lock-screen"><section class="lock-card schema-warning"><div class="lock-brand"><span class="brand-symbol">${icon('tooth', 23)}</span><strong>DENTIVA<span> PRO</span></strong></div>
    <div class="lock-icon warning">${icon('warning', 28)}</div>
    <span class="eyebrow">UPGRADE REQUIRED</span>
    <h1>Workspace needs a newer Dentiva Pro</h1>
    <p>${esc(appState.migrationError || 'This workspace was created by a newer version.')}</p>
    <p class="form-note">Your local data has been preserved and cannot be overwritten by this build. Export the preserved workspace, then open it with a compatible Dentiva Pro release.</p>
    <div class="schema-actions">${button('Export preserved data', 'export-unsupported-store', 'download', 'secondary')}${button('Reset this workspace', 'reset-unsupported-workspace', 'trash', 'link')}</div>
  </section></main>`;
}

/* ------------------------------------------------------------------ */
/* Pages                                                               */
/* ------------------------------------------------------------------ */
const PAGE_PERMISSIONS = { patients: 'patients.view', appointments: 'appointments.view', queue: 'appointments.queue', clinical: 'clinical.view', prescriptions: 'prescriptions.view', dental: 'clinical.view', treatments: 'clinical.view', billing: 'billing.view', payments: 'payments.view', accounting: 'accounting.view', inventory: 'inventory.view', suppliers: 'inventory.view', staff: 'staff.view', reports: 'reports.view', analytics: 'reports.analytics', notifications: null, audit: 'audit.view', backup: 'backup.create', diagnostics: 'diagnostics.view', settings: 'settings.view', users: 'users.manage' };

function permissionDeniedPage(title) {
  return `<div class="page"><div class="empty-state" style="padding:64px 0"><span class="empty-icon-wrap">${icon('shield', 27, 'empty-icon')}</span><h3>${esc(localized(title))}</h3><p>Your current account does not have permission to open this area. Ask an Administrator to adjust access.</p></div></div>`;
}

async function renderPage() {
  const pages = {
    dashboard: renderDashboard, patients: renderPatients, appointments: renderAppointments, queue: renderQueue,
    clinical: renderClinical, prescriptions: renderPrescriptions, dental: renderDental, treatments: renderTreatments,
    billing: renderBilling, payments: renderPayments, accounting: renderAccounting, inventory: renderInventory,
    suppliers: renderSuppliers, staff: renderStaff, reports: renderReports, analytics: renderAnalytics,
    notifications: renderNotifications, audit: renderAuditLogPage, backup: renderBackup, diagnostics: renderDiagnostics,
    settings: renderSettings, users: renderUsers, help: renderHelp, about: renderAbout
  };
  const permission = PAGE_PERMISSIONS[ui.page];
  if (permission && !can(permission)) return permissionDeniedPage(pageTitle());
  const render = pages[ui.page] || renderDashboard;
  try {
    return await render();
  } catch (error) {
    console.error('Page render failed', error);
    return `<div class="page">${pageHeader(pageTitle(), 'Something went wrong while loading this view.')}<div class="empty-state"><span class="empty-icon-wrap">${icon('warning', 27, 'empty-icon')}</span><h3>View could not be loaded</h3><p>${esc(error?.message || 'Unexpected error.')} Try again — your data is safe in the local store.</p>${button('Retry', 'retry-page', 'refresh', 'primary')}</div></div>`;
  }
}

function periodPicker(key, current, extraClasses = '') {
  const options = [['today', 'Today'], ['7d', 'Last 7 days'], ['month', 'Last 1 month'], ['quarter', 'Last 3 months'], ['6m', 'Last 6 months'], ['year', 'Last 1 year'], ['custom', 'Custom range'], ['all', 'All time']];
  return `<div class="period-picker ${extraClasses}"><span>${icon('calendar', 15)}</span><select data-change="${key}">${options.map(([value, label]) => `<option value="${value}" ${current === value ? 'selected' : ''}>${esc(label)}</option>`).join('')}</select>${icon('down', 14)}</div>${current === 'custom' ? `<div class="period-picker period-picker-dates"><input type="date" value="${attr(ui.rangeFrom)}" data-change="${key}-from" aria-label="Range from"><span>to</span><input type="date" value="${attr(ui.rangeTo)}" data-change="${key}-to" aria-label="Range to"></div>` : ''}`;
}
function rangeFor(key, current, customFrom, customTo) {
  const bounds = periodBounds(current || 'month', new Date(), customFrom, customTo);
  return { bounds, label: { today: 'Today’s', '7d': '7-day', month: 'Monthly', quarter: 'Quarterly', '6m': '6-month', year: 'Yearly', custom: 'Custom', all: 'All-time' }[current] || 'Monthly' };
}

/* ------------------------------ dashboard ------------------------------ */
async function renderDashboard() {
  const rangeKey = ui.range === 'custom' ? 'custom' : (ui.range === 'today' || ui.range === '7d' ? 'day' : ui.range);
  const [dash, apptReport, revReport] = await Promise.all([
    q('dashboard', { range: 'month' }),
    q('report', { type: 'appointments', rangeKey, from: ui.rangeFrom || undefined, to: ui.rangeTo || undefined }).catch(() => null),
    can('reports.view') ? q('report', { type: 'revenue', rangeKey, from: ui.rangeFrom || undefined, to: ui.rangeTo || undefined }).catch(() => null) : null
  ]);
  const appointmentsToday = dash.appointmentsToday || [];
  const waiting = appointmentsToday.filter((a) => ['Checked In', 'Waiting', 'In Treatment'].includes(a.status));
  const aggregates = dash.aggregates?.totals || {};
  const apptStats = apptReport?.kpis || {};
  const collectedCents = revReport?.kpis?.collectedCents || 0;
  const rangeLabel = { today: 'Today’s', '7d': '7-day', month: 'Monthly', quarter: 'Quarterly', '6m': '6-month', year: 'Yearly', custom: 'Custom range', all: 'All-time' }[ui.range] || 'Today’s';
  const layout = dash.dashboardLayout?.widgets?.length ? dash.dashboardLayout.widgets : ['schedule', 'queue', 'followups', 'signals'];
  const widget = (key, markup) => layout.includes(key) ? markup : '';
  const setupBanner = appState.setupComplete ? '' : `<section class="setup-banner"><div class="setup-icon">${icon('sparkle', 21)}</div><div class="setup-copy"><strong>Make this workspace yours</strong><p>Add your clinic identity once. Your records stay on this device and can be backed up at any time.</p></div>${button('Complete setup', 'open-setup', 'arrow', 'primary')}</section>`;
  return `<div class="page dashboard-page">
    ${pageHeader(`Good ${new Date().getHours() < 12 ? 'morning' : new Date().getHours() < 17 ? 'afternoon' : 'evening'}${appState.settings.dentistName ? `, ${esc(appState.settings.dentistName.split(' ').slice(-1)[0])}` : ''}`, 'A clear view of your practice, without the noise.', `${periodPicker('dashboard-range', ui.range)}${button('Customize dashboard', 'open-dashboard-customizer', 'settings', 'secondary')}`)}
    ${setupBanner}
    <div class="metric-grid">
      <div class="metric-card metric-teal"><div class="metric-top"><span class="metric-label">${rangeLabel} appointments</span><span class="metric-icon">${icon('calendar', 18)}</span></div><strong>${number(apptStats.appointments ?? appointmentsToday.length)}</strong><small>${Number(apptStats.completed ?? 0)} completed in range</small></div>
      <div class="metric-card"><div class="metric-top"><span class="metric-label">${rangeLabel} patients</span><span class="metric-icon soft-blue">${icon('users', 18)}</span></div><strong>${number(dash.counts?.patients ?? 0)}</strong><small>${number(appState.counts?.patients ?? 0)} in your directory</small></div>
      <div class="metric-card"><div class="metric-top"><span class="metric-label">Waiting queue</span><span class="metric-icon soft-amber">${icon('clock', 18)}</span></div><strong>${number(waiting.length)}</strong><small>${waiting.length ? 'Patients need attention' : 'No one is waiting'}</small></div>
      <div class="metric-card"><div class="metric-top"><span class="metric-label">${rangeLabel} collected</span><span class="metric-icon soft-purple">${icon('dollar', 18)}</span></div><strong>${currency(centsToMoney(collectedCents))}</strong><small>Across recorded payments</small></div>
    </div>
    <div class="dashboard-grid">
      ${widget('schedule', `<section class="card schedule-card">${cardTitle('calendar', 'Today’s schedule', button('Open appointments', 'navigate', 'arrow', 'link', 'data-page="appointments"'))}<div class="schedule-list">${appointmentsToday.length ? appointmentsToday.map(appointmentRow).join('') : emptyState('calendar', 'Nothing booked today', 'Create an appointment to build your schedule.', button('New appointment', 'open-appointment', 'plus', 'secondary'))}</div></section>`)}
      ${widget('queue', `<section class="card queue-card">${cardTitle('clipboard', 'Today’s queue', button('View queue', 'navigate', 'arrow', 'link', 'data-page="queue"'))}<div class="queue-summary"><div class="queue-ring"><strong>${waiting.length}</strong><span>waiting</span></div><div class="queue-copy"><strong>${appointmentsToday.length ? `${appointmentsToday.length} scheduled today` : 'Your queue is ready'}</strong><p>Check patients in as they arrive and keep care moving.</p></div></div><div class="mini-status-list"><div><span class="status-dot dot-teal"></span>Checked in <strong>${appointmentsToday.filter((a) => a.status === 'Checked In').length}</strong></div><div><span class="status-dot dot-amber"></span>In treatment <strong>${appointmentsToday.filter((a) => a.status === 'In Treatment').length}</strong></div><div><span class="status-dot dot-green"></span>Completed <strong>${appointmentsToday.filter((a) => a.status === 'Completed').length}</strong></div></div></section>`)}
      ${widget('followups', `<section class="card followup-card">${cardTitle('flag', 'Follow-ups due', button('Clinical records', 'navigate', 'arrow', 'link', 'data-page="clinical"'))}<div class="followup-list">${(dash.dueTasks || []).slice(0, 4).map((task) => `<div class="followup-row"><span class="avatar avatar-xs">${initials(patientName(task.patientId))}</span><div><strong>${esc(patientName(task.patientId))}</strong><small>${esc(task.title || 'Follow-up')} · ${relativeDate(task.dueDate)}</small></div><span class="followup-date">${date(task.dueDate, { day: 'numeric', month: 'short' })}</span></div>`).join('') || emptyState('flag', 'No follow-ups due', 'Follow-up dates from clinical visits will appear here.')}</div></section>`)}
      ${widget('signals', `<section class="card signals-card">${cardTitle('activity', 'Operational signals')}<div class="signal-list">
        <div class="signal-item ${aggregates.invoicesOutstandingCents > 0 ? 'signal-warning' : ''}"><span class="signal-icon">${icon('credit', 16)}</span><div><strong>${aggregates.invoicesOutstandingCents > 0 ? `Outstanding ${currency(centsToMoney(aggregates.invoicesOutstandingCents))}` : 'No outstanding balances'}</strong><small>${aggregates.invoicesOutstandingCents > 0 ? 'Review from Billing' : 'You’re all caught up'}</small></div>${aggregates.invoicesOutstandingCents > 0 ? badge('Review', 'warning') : icon('check', 16)}</div>
        <div class="signal-item ${aggregates.lowStockItems > 0 ? 'signal-warning' : ''}"><span class="signal-icon">${icon('box', 16)}</span><div><strong>${aggregates.lowStockItems > 0 ? `${aggregates.lowStockItems} stock alert${aggregates.lowStockItems > 1 ? 's' : ''}` : 'Inventory is in good shape'}</strong><small>${aggregates.lowStockItems > 0 ? 'Low or out of stock' : 'No reorder needed'}</small></div>${aggregates.lowStockItems > 0 ? badge('Action', 'warning') : icon('check', 16)}</div>
        <div class="signal-item"><span class="signal-icon">${icon('backup', 16)}</span><div><strong>${appState.storage?.lastBackupAt ? 'Backup verified' : 'Backup not configured'}</strong><small>${appState.storage?.lastBackupAt ? date(appState.storage.lastBackupAt.slice(0, 10)) : 'Protect your practice data'}</small></div>${button(appState.storage?.lastBackupAt ? 'View' : 'Set up', 'navigate', 'arrow', 'link', 'data-page="backup"')}</div>
      </div></section>`)}
    </div>
    <section class="quick-actions card"><div><div class="eyebrow">SHORTCUTS</div><h2>Move work forward</h2><p>Common actions, one click away.</p></div>
      <div class="quick-action-grid">${[['New patient', 'open-patient', 'users'], ['Appointment', 'open-appointment', 'calendar'], ['New visit', 'open-visit', 'activity'], ['New invoice', 'open-invoice', 'receipt'], ['Record payment', 'open-payment', 'credit'], ['Add stock', 'open-stock', 'box']].map(([label, action, ico]) => `<button data-action="${action}" class="quick-action">${icon(ico, 18)}<span>${esc(label)}</span>${icon('arrow', 14)}</button>`).join('')}</div>
    </section>
  </div>`;
}
function appointmentRow(a) {
  return `<div class="appointment-row ${a.status === 'Cancelled' ? 'is-cancelled' : ''}" data-action="open-appointment-detail" data-id="${attr(a.id)}"><span class="appt-time">${time(a.time)}</span><span class="avatar avatar-xs">${initials(patientName(a.patientId))}</span><div class="appt-body"><strong>${esc(patientName(a.patientId))}</strong><small>${esc(a.reason || '—')}${a.chair ? ` · ${esc(a.chair)}` : ''}</small></div>${statusBadge(a.status)}</div>`;
}

/* ------------------------------- patients ------------------------------ */
async function renderPatients() {
  const [result, savedViews] = await Promise.all([
    listQuery('patients', { status: ui.patientStatusFilter, balance: ui.patientBalanceFilter }),
    listQuery('savedFilters', { entity: 'patients' })
  ]);
  const rows = result.rows || [];
  const body = rows.map((p) => `<tr class="clickable-row" data-action="open-patient-profile" data-id="${attr(p.id)}">
    <td><div class="person-cell"><span class="avatar avatar-small">${initials(p.fullName)}</span><div><strong>${esc(p.fullName)}</strong><small>${esc(p.patientCode || '—')}${p.phone ? ` · ${esc(p.phone)}` : ''}</small></div></div></td>
    <td>${p.phone ? esc(p.phone) : '<span class="muted">—</span>'}</td>
    <td>${p.lastVisit ? relativeDate(p.lastVisit) : '<span class="muted">Never</span>'}</td>
    <td><strong class="${(p.balanceCents || 0) > 0 ? 'text-warning' : ''}">${currency(centsToMoney(p.balanceCents || 0))}</strong></td>
    <td>${statusBadge(p.archived ? 'Archived' : 'Active')}</td>
    <td class="row-actions">${button('View', 'open-patient-profile', 'arrow', 'link', `data-id="${attr(p.id)}"`)}</td>
  </tr>`).join('');
  const views = (savedViews.rows || []);
  const savedViewsMenu = views.length ? `<div class="saved-views-strip"><span class="eyebrow">Saved views</span>${views.map((view) => `<button class="chip-button ${listState.patients.query === view.query ? 'selected' : ''}" data-action="apply-saved-filter" data-id="${attr(view.id)}" data-collection="patients">${icon('filter', 13)}${esc(view.name)}</button>`).join('')}<button class="chip-button" data-action="save-filter" data-collection="patients">${icon('plus', 13)}<span>Save view</span></button></div>` : '';
  return `<div class="page">
    ${pageHeader('Patients', 'Your complete patient directory, searchable and filterable.', `${button('Export patients CSV', 'export-patients-csv', 'download', 'secondary')}${button('Import CSV', 'open-csv-import', 'upload', 'secondary')}${button('Add patient', 'open-patient', 'plus', 'primary')}`)}
    ${savedViewsMenu}
    ${toolbar(`
      <label class="search-field"><span>${icon('search', 16)}</span><input type="search" placeholder="Search name, code or phone" value="${attr(listState.patients.query)}" data-input="list-query" data-collection="patients" aria-label="Search patients"><kbd>⌘ K</kbd></label>
      <select data-change="patient-status-filter" aria-label="Patient status"><option value="all" ${ui.patientStatusFilter === 'all' ? 'selected' : ''}>All statuses</option><option value="active" ${ui.patientStatusFilter === 'active' ? 'selected' : ''}>Active</option><option value="archived" ${ui.patientStatusFilter === 'archived' ? 'selected' : ''}>Archived</option></select>
      <select data-change="patient-balance-filter" aria-label="Balance filter"><option value="all" ${ui.patientBalanceFilter === 'all' ? 'selected' : ''}>Any balance</option><option value="outstanding" ${ui.patientBalanceFilter === 'outstanding' ? 'selected' : ''}>Outstanding</option><option value="clear" ${ui.patientBalanceFilter === 'clear' ? 'selected' : ''}>Settled</option></select>`, '')}
    ${dataTable(['Patient', 'Phone', 'Last visit', 'Balance', 'Status', ''], body, emptyState('users', 'No matching records', listState.patients.query ? 'Try a different search or clear the filters.' : 'Add your first patient to begin.', button('Add patient', 'open-patient', 'plus', 'secondary')))}
    ${tablePager(result.total || 0, listState.patients.page, 'patients')}
  </div>`;
}

/* --------------------------- patient profile --------------------------- */
const PATIENT_TABS = [
  ['overview', 'Overview', 'info'], ['timeline', 'Patient timeline', 'activity'], ['visits', 'Clinical records', 'clipboard'],
  ['dental', 'Dental chart', 'tooth'], ['prescriptions', 'Prescriptions', 'file'], ['treatment-plan', 'Treatment plan', 'layers'],
  ['billing', 'Billing', 'receipt'], ['payments', 'Payments', 'credit'], ['statement', 'Financial statement', 'chart'],
  ['attachments', 'Attachments', 'paperclip'], ['referrals', 'Referrals', 'send'], ['followups', 'Follow-ups', 'flag'],
  ['notes', 'Notes', 'edit'], ['audit', 'Audit trail', 'shield']
];
const PATIENT_TAB_PERMISSIONS = { visits: 'clinical.view', appointments: 'appointments.view', 'treatment-plan': 'clinical.view', dental: 'clinical.view', prescriptions: 'prescriptions.view', billing: 'billing.view', payments: 'payments.view', statement: 'billing.view', attachments: 'clinical.view', referrals: 'clinical.view', followups: 'clinical.view', notes: 'patients.view', audit: 'audit.view', timeline: 'patients.view', overview: 'patients.view' };

async function renderPatientProfile() {
  if (!ui.patientId) return renderPatients();
  const patient = await q('patientAggregate', { patientId: ui.patientId });
  ui.patientDetail = patient;
  const p = patient.patient;
  if (!p) return `<div class="page"><div class="empty-state"><h3>Patient not found</h3><p>This record may have been removed.</p>${button('Back to patients', 'navigate', 'arrow', 'secondary', 'data-page="patients"')}</div></div>`;
  const counts = patient.counts || {};
  const balance = patient.balanceCents || 0;
  const tab = ui.patientTab || 'overview';
  const tabs = PATIENT_TABS.filter(([id]) => !PATIENT_TAB_PERMISSIONS[id] || can(PATIENT_TAB_PERMISSIONS[id]));
  return `<div class="page patient-page">
    <div class="patient-head-card">
      <div class="patient-head-main"><span class="avatar avatar-lg">${initials(p.fullName)}</span>
        <div><h1>${esc(p.fullName)}</h1><p class="patient-sub">${esc(p.patientCode || '—')}${p.phone ? ` · ${esc(p.phone)}` : ''}${p.email ? ` · ${esc(p.email)}` : ''}</p>
        <div class="patient-meta">${p.gender ? badge(p.gender, 'neutral') : ''}${p.bloodGroup ? badge(`Blood ${p.bloodGroup}`, 'neutral') : ''}${p.dateOfBirth ? badge(`Age ${ageFromDate(p.dateOfBirth)}`, 'neutral') : ''}${p.archived ? badge('Archived', 'danger') : badge('Active', 'success')}</div></div>
      </div>
      <div class="patient-head-stats">
        <div class="mini-stat"><small>Balance</small><strong class="${balance > 0 ? 'text-warning' : ''}">${currency(centsToMoney(balance))}</strong></div>
        <div class="mini-stat"><small>Visits</small><strong>${number(counts.visits || 0)}</strong></div>
        <div class="mini-stat"><small>Appointments</small><strong>${number(counts.appointments || 0)}</strong></div>
        <div class="mini-stat"><small>Invoices</small><strong>${number(counts.invoices || 0)}</strong></div>
      </div>
      <div class="patient-head-actions">${button('Edit patient', 'open-patient', 'edit', 'secondary', `data-id="${attr(p.id)}"`)}${button('Print summary', 'print-patient', 'printer', 'secondary', `data-id="${attr(p.id)}"`)}${button('Merge duplicate…', 'open-patient-merge', 'link', 'link', `data-id="${attr(p.id)}"`)}</div>
    </div>
    <div class="tab-strip" role="tablist">${tabs.map(([id, label, iconName]) => `<button class="tab-button ${tab === id ? 'active' : ''}" data-action="patient-tab" data-tab="${id}" role="tab" aria-selected="${tab === id}">${icon(iconName, 15)}<span>${esc(localized(label))}</span></button>`).join('')}</div>
    ${await renderPatientTab(p, tab, patient)}
  </div>`;
}

async function renderPatientTab(p, tab, patient) {
  const id = p.id;
  switch (tab) {
    case 'overview': {
      const alerts = [p.allergies, p.medicalHistory, p.importantAlerts].filter(Boolean);
      return `<div class="patient-grid">
        <section class="card"><div class="card-title"><div class="card-title-text">${icon('user', 17)}<h2>Details</h2></div></div>
          <dl class="detail-list">
            <div><dt>Date of birth</dt><dd>${p.dateOfBirth ? `${dateFull(p.dateOfBirth)}${ageFromDate(p.dateOfBirth) ? ` (${ageFromDate(p.dateOfBirth)} yrs)` : ''}` : '—'}</dd></div>
            <div><dt>Gender</dt><dd>${esc(p.gender || '—')}</dd></div>
            <div><dt>Blood group</dt><dd>${esc(p.bloodGroup || '—')}</dd></div>
            <div><dt>Phone</dt><dd>${esc(p.phone || '—')}</dd></div>
            <div><dt>Email</dt><dd>${esc(p.email || '—')}</dd></div>
            <div><dt>Address</dt><dd>${esc([p.address, p.city, p.district].filter(Boolean).join(', ') || '—')}</dd></div>
            <div><dt>Occupation</dt><dd>${esc(p.occupation || '—')}</dd></div>
            <div><dt>Marital status</dt><dd>${esc(p.maritalStatus || '—')}</dd></div>
            <div><dt>Emergency contact</dt><dd>${p.emergencyName ? `${esc(p.emergencyName)}${p.emergencyRelation ? ` (${esc(p.emergencyRelation)})` : ''} · ${esc(p.emergencyPhone || '—')}` : '—'}</dd></div>
            <div><dt>Preferred contact</dt><dd>${esc(p.preferredContact || 'Phone')}</dd></div>
            <div><dt>Registered</dt><dd>${dateFull(p.registrationDate)}</dd></div>
            ${p.tags?.length ? `<div><dt>Tags</dt><dd>${p.tags.map((t) => badge(t, 'neutral')).join(' ')}</dd></div>` : ''}
            ${(appState.settings.customPatientFields || []).filter((definition) => (p.customFields || {})[definition.key]).map((definition) => `<div><dt>${esc(definition.label || definition.key)}</dt><dd>${esc((p.customFields || {})[definition.key])}</dd></div>`).join('')}
          </dl>
        </section>
        <section class="card"><div class="card-title"><div class="card-title-text">${icon('warning', 17)}<h2>Clinical alerts</h2></div></div>
          ${alerts.length ? alerts.map((text, i) => `<div class="alert-row ${i === 0 ? 'alert-danger' : i === 1 ? 'alert-warning' : 'alert-info'}"><span>${i === 0 ? icon('warning', 16) : i === 1 ? icon('activity', 16) : icon('info', 16)}</span><div><strong>${['Allergies', 'Medical history', 'Important alert'][i]}</strong><p>${esc(text)}</p></div></div>`).join('') : emptyState('check', 'No alerts recorded', 'Allergies and history entered on the patient record appear here.')}
        </section>
        <section class="card card-wide"><div class="card-title"><div class="card-title-text">${icon('activity', 17)}<h2>Communication & notes</h2></div></div>
          <div class="notes-blocks"><div><strong>Communication notes</strong><p>${esc(p.communicationNotes || '—')}</p></div><div><strong>Notes</strong><p>${esc(p.notes || '—')}</p></div></div>
        </section>
      </div>`;
    }
    case 'timeline': {
      const list = await q('list', { collection: 'patients', page: 1, pageSize: 1, query: '' }).catch(() => null);
      void list;
      const timeline = patient.timeline;
      const rows = (timeline.rows || []).map((row) => `<div class="timeline-row ${row.type}"><span class="timeline-icon">${icon({ visit: 'clipboard', invoice: 'receipt', payment: 'credit', appointment: 'calendar', prescription: 'file', referral: 'send', attachment: 'paperclip', followup: 'flag' }[row.type] || 'dot', 15)}</span><div><strong>${esc(row.title)}</strong><small>${date(row.date)} · ${esc(row.subtitle || '')}</small></div>${row.status ? statusBadge(row.status) : ''}</div>`).join('');
      return `<section class="card"><div class="card-title"><div class="card-title-text">${icon('activity', 17)}<h2>Full timeline</h2></div></div>${rows || emptyState('activity', 'No activity yet', 'Records created for this patient will appear here.')}</section>`;
    }
    case 'visits': return renderPatientVisits(id, patient);
    case 'dental': return renderPatientDental(p, patient);
    case 'prescriptions': {
      const result = await q('list', { collection: 'prescriptions', page: 1, pageSize: 50, filters: { patientId: id } });
      return `<section class="card"><div class="card-title"><div class="card-title-text">${icon('file', 17)}<h2>Prescriptions</h2></div>${button('New prescription', 'open-prescription', 'plus', 'secondary', `data-id="${attr(id)}"`)}</div>
        ${(result.rows || []).map((rx) => `<div class="record-row"><div><strong>${esc(rx.prescriptionCode || '—')} · ${esc(rx.doctor || '—')}</strong><small>${date(rx.date)} · ${(rx.medications || []).map((m) => m.medicine).filter(Boolean).join(', ') || '—'}</small></div><div class="row-actions">${button('Print', 'print-prescription', 'printer', 'link', `data-id="${attr(rx.id)}"`)}${button('View', 'open-prescription', 'eye', 'link', `data-id="${attr(rx.id)}"`)}</div></div>`).join('') || emptyState('file', 'No prescriptions yet', 'Prescriptions written for this patient appear here.', button('New prescription', 'open-prescription', 'plus', 'secondary', `data-id="${attr(id)}"`))}
      </section>`;
    }
    case 'treatment-plan': return renderPatientPlans(id, patient);
    case 'billing': return renderPatientBilling(id, patient);
    case 'payments': return renderPatientPayments(id, patient);
    case 'statement': return renderPatientStatement(id, patient);
    case 'attachments': return renderPatientAttachments(id, patient);
    case 'referrals': return renderPatientReferrals(id, patient);
    case 'followups': return renderPatientFollowups(id, patient);
    case 'notes': {
      return `<section class="card"><div class="card-title"><div class="card-title-text">${icon('edit', 17)}<h2>Notes</h2></div>${button('Edit patient', 'open-patient', 'edit', 'secondary', `data-id="${attr(id)}"`)}</div>
        <div class="notes-blocks"><div><strong>Communication notes</strong><p>${esc(p.communicationNotes || '—')}</p></div><div><strong>Notes</strong><p>${esc(p.notes || '—')}</p></div></div>
      </section>`;
    }
    case 'audit': {
      const result = await q('auditList', { page: 1, pageSize: 50, entity: '', userId: '' });
      const rows = (result.rows || []).filter((entry) => !entry.entityId || entry.entityId === id || String(entry.summary || '').includes(p.fullName)).map((entry) => `<div class="record-row"><div><strong>${esc(entry.action)}</strong><small>${dateFull(entry.createdAt?.slice(0, 10))} ${time(entry.createdAt?.slice(11, 16))} · ${esc(entry.userName || '—')} · ${esc(entry.summary || '')}</small></div></div>`).join('');
      return `<section class="card"><div class="card-title"><div class="card-title-text">${icon('shield', 17)}<h2>Audit trail</h2></div></div>${rows || emptyState('shield', 'No audit events match', 'Audit entries touching this patient appear here.')}</section>`;
    }
    default: return emptyState('info', 'Nothing here yet', 'This section will populate as records are created.');
  }
}

async function renderPatientVisits(id, patient) {
  const result = await q('list', { collection: 'visits', page: 1, pageSize: 100, filters: { patientId: id }, sort: 'date-desc' });
  const rows = (result.rows || []).map((v) => `<div class="record-row record-row-detail">
    <div><strong>${esc(v.visitCode || '—')} · ${esc(v.reason || '—')}</strong><small>${dateFull(v.date)}${v.diagnosis ? ` · Dx: ${esc(v.diagnosis)}` : ''}${v.followUpDate ? ` · Follow-up ${date(v.followUpDate)}` : ''}</small>
    ${v.treatmentPerformed ? `<p class="record-detail-text">${esc(v.treatmentPerformed)}</p>` : ''}${v.findings ? `<p class="record-detail-text muted">${esc(v.findings)}</p>` : ''}${v.notes ? `<p class="record-detail-text muted">${esc(v.notes)}</p>` : ''}</div>
    <div class="row-actions">${button('Print visit', 'print-visit', 'printer', 'link', `data-id="${attr(v.id)}"`)}${button('Edit', 'open-visit', 'edit', 'link', `data-id="${attr(v.id)}"`)}</div></div>`).join('');
  return `<section class="card"><div class="card-title"><div class="card-title-text">${icon('clipboard', 17)}<h2>Clinical records</h2></div>${button('Record visit', 'open-visit', 'plus', 'secondary', `data-id="${attr(id)}"`)}</div>
    ${rows || emptyState('clipboard', 'No visits yet', 'Clinical visits for this patient appear here.', button('Record visit', 'open-visit', 'plus', 'secondary', `data-id="${attr(id)}"`))}</section>`;
}

async function renderPatientDental(p, patient) {
  const history = await q('dentalHistory', { patientId: p.id });
  const records = history.records || [];
  const statusFor = (tooth) => { const current = records.filter((r) => Number(r.tooth) === Number(tooth) && !r.superseded && (r.dentition || 'adult') === ui.dentition).sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))[0]; return current; };
  const teeth = Array.from({ length: 32 }, (_, i) => i + 1);
  const chart = (set, label) => `<div class="dental-set"><h3>${esc(label)}${ui.dentition === set ? '' : ` <button class="link-button" data-action="set-dentition" data-dentition="${set}">View</button>`}</h3><div class="tooth-grid">${teeth.map((tooth) => { const record = ui.dentition === set ? statusFor(tooth) : null; return `<button class="tooth ${record ? `tooth-${String(record.status || '').toLowerCase().replace(/\\s+/g, '-')}` : ''}" data-action="select-tooth" data-tooth="${tooth}" title="Tooth ${tooth} — ${record?.status || record?.note || 'No record'}"><span>${tooth}</span></button>`; }).join('')}</div></div>`;
  const selected = ui.dentalTooth ? statusFor(ui.dentalTooth) : null;
  return `<section class="card dental-card">
    <div class="card-title"><div class="card-title-text">${icon('tooth', 17)}<h2>Dental chart — ${esc(p.fullName)}</h2></div><div class="dentition-toggle"><button class="btn ${ui.dentition === 'adult' ? 'btn-primary' : 'btn-secondary'}" data-action="set-dentition" data-dentition="adult">Adult</button><button class="btn ${ui.dentition === 'primary' ? 'btn-primary' : 'btn-secondary'}" data-action="set-dentition" data-dentition="primary">Primary</button></div></div>
    ${chart('adult', 'Permanent (FDI 11–48)')}${chart('primary', 'Primary (FDI 51–85)')}
    <div class="dental-detail">
      ${ui.dentalTooth ? `<div class="dental-detail-head"><strong>Tooth ${ui.dentalTooth} (${ui.dentition})</strong><span class="muted">${records.filter((r) => Number(r.tooth) === Number(ui.dentalTooth) && (r.dentition || 'adult') === ui.dentition).length} record(s) in history</span></div>
        <div class="tooth-status-row">${['', 'Missing', 'Caries', 'Restored', 'Crown', 'Root canal', 'Extracted', 'Implant'].map((status) => `<button class="chip-button ${selected?.status === status ? 'selected' : ''}" data-action="set-tooth-status" data-status="${attr(status)}">${esc(status || 'Clear')}</button>`).join('')}</div>
        <label class="field-label">Chart note<textarea name="dental-note" rows="2" placeholder="Procedure or clinical note for this tooth">${attr(ui.toothNote ?? selected?.note ?? '')}</textarea></label>
        <div class="dental-actions">${button('Save chart note', 'save-tooth', 'check', 'primary')}${button('Clear record', 'remove-tooth', 'trash', 'link')}${button('Print chart', 'print-chart', 'printer', 'secondary', `data-id="${attr(p.id)}"`)}</div>
        <div class="tooth-history">${records.filter((r) => Number(r.tooth) === Number(ui.dentalTooth) && (r.dentition || 'adult') === ui.dentition).map((r) => `<div class="record-row"><div><strong>${esc(r.status || 'Note')}${r.procedure ? ` · ${esc(r.procedure)}` : ''}</strong><small>${dateFull(r.createdAt?.slice(0, 10))}${r.superseded ? ' · superseded' : ''} · ${esc(r.note || '')}</small></div></div>`).join('')}</div>`
      : emptyState('tooth', 'Select a tooth', 'Click any tooth to record its status, procedure or a chart note. History is preserved.')}
    </div>
  </section>`;
}

async function renderPatientPlans(id, patient) {
  const result = await q('list', { collection: 'treatmentPlans', page: 1, pageSize: 50, filters: { patientId: id } });
  const rows = (result.rows || []).map((plan) => `<div class="record-row record-row-detail">
    <div><strong>${esc(plan.title)}</strong><small>${statusBadge(plan.status)} · ${currency(centsToMoney(plan.estimatedTotalCents ?? plan.estimatedTotal))}${plan.startDate ? ` · starts ${date(plan.startDate)}` : ''}</small>
    ${(plan.stages || []).length ? `<ul class="stage-list">${plan.stages.map((stage) => `<li data-action="cycle-plan-stage" data-plan="${attr(plan.id)}" data-stage="${attr(stage.id)}" title="Click to advance stage status"><span class="stage-dot ${stage.status}"></span><span class="stage-title">${esc(stage.title)}</span><small>${esc(stage.status)}${stage.plannedDate ? ` · ${date(stage.plannedDate)}` : ''}${stage.estimatedCost ? ` · ${currency(stage.estimatedCost)}` : ''}</small></li>`).join('')}</ul>` : ''}
    </div>
    <div class="row-actions">${button('Print estimate', 'print-estimate', 'printer', 'link', `data-id="${attr(plan.id)}"`)}${button('Convert to visit', 'convert-treatment-plan', 'arrow', 'link', `data-id="${attr(plan.id)}"`)}${button('Edit', 'open-treatment-plan', 'edit', 'link', `data-id="${attr(plan.id)}"`)}</div>
  </div>`).join('');
  return `<section class="card"><div class="card-title"><div class="card-title-text">${icon('layers', 17)}<h2>Treatment plans</h2></div>${button('New treatment plan', 'open-treatment-plan', 'plus', 'secondary', `data-id="${attr(id)}"`)}</div>
    ${rows || emptyState('layers', 'No treatment plans yet', 'Clinician-authored plans for this patient appear here.', button('New treatment plan', 'open-treatment-plan', 'plus', 'secondary', `data-id="${attr(id)}"`))}</section>`;
}

async function renderPatientBilling(id, patient) {
  const result = await q('list', { collection: 'invoices', page: 1, pageSize: 100, filters: { patientId: id }, sort: 'date-desc' });
  const rows = (result.rows || []).map((inv) => `<div class="record-row">
    <div><strong>${esc(inv.invoiceNumber || '—')}</strong><small>${date(inv.date)} · ${currency(centsToMoney(inv.totalCents ?? inv.total))} · paid ${currency(centsToMoney(inv.paidCents ?? inv.paid))} · due ${currency(centsToMoney(inv.dueCents ?? inv.due))}</small></div>
    <div class="row-actions">${statusBadge(inv.status)}${button('Print', 'print-invoice', 'printer', 'link', `data-id="${attr(inv.id)}"`)}${inv.status !== 'Cancelled' ? button('Record payment', 'open-payment', 'credit', 'link', `data-id="${attr(inv.id)}"`) : ''}${can('billing.void') ? button('Void', 'void-invoice', 'trash', 'link', `data-id="${attr(inv.id)}"`) : ''}</div>
  </div>`).join('');
  return `<section class="card"><div class="card-title"><div class="card-title-text">${icon('receipt', 17)}<h2>Invoices</h2></div>${button('New invoice', 'open-invoice', 'plus', 'secondary', `data-id="${attr(id)}"`)}</div>
    ${rows || emptyState('receipt', 'No invoices yet', 'Billing for this patient appears here.', button('New invoice', 'open-invoice', 'plus', 'secondary', `data-id="${attr(id)}"`))}</section>`;
}

async function renderPatientPayments(id, patient) {
  const result = await q('list', { collection: 'payments', page: 1, pageSize: 100, filters: { patientId: id }, sort: 'date-desc' });
  const rows = (result.rows || []).map((payment) => `<div class="record-row">
    <div><strong>${esc(payment.receiptNumber || '—')} · ${money(payment)}</strong><small>${date(payment.date)} · ${esc(payment.method || '—')}${payment.refundedAmount ? ` · refunded ${currency(payment.refundedAmount)}` : ''}</small></div>
    <div class="row-actions">${statusBadge(payment.status || 'Recorded')}${button('Print receipt', 'print-payment', 'printer', 'link', `data-id="${attr(payment.id)}"`)}${can('payments.refund') ? button('Refund', 'open-refund', 'undo', 'link', `data-id="${attr(payment.id)}"`) : ''}</div>
  </div>`).join('');
  return `<section class="card"><div class="card-title"><div class="card-title-text">${icon('credit', 17)}<h2>Payments</h2></div>${button('Record payment', 'open-payment', 'plus', 'secondary', `data-id="${attr(id)}"`)}</div>
    ${rows || emptyState('credit', 'No payments yet', 'Payments for this patient appear here.', button('Record payment', 'open-payment', 'plus', 'secondary', `data-id="${attr(id)}"`))}</section>`;
}

async function renderPatientStatement(id, patient) {
  const statement = await q('patientStatement', { patientId: id });
  const entries = statement.rows || [];
  const rows = entries.map((entry) => `<tr><td>${date(entry.date)}</td><td>${esc(entry.type)}</td><td>${esc(entry.reference)}</td><td class="${entry.debit > 0 ? 'text-danger' : 'muted'}">${entry.debit > 0 ? currency(centsToMoney(entry.debitCents ?? entry.debit)) : ''}</td><td class="${entry.credit > 0 ? 'text-success' : 'muted'}">${entry.credit > 0 ? currency(centsToMoney(entry.creditCents ?? entry.credit)) : ''}</td><td><strong>${currency(centsToMoney(entry.balanceCents ?? entry.balance))}</strong></td><td class="muted">${esc(entry.note || '')}</td></tr>`).join('');
  return `<section class="card statement-card">
    <div class="card-title"><div class="card-title-text">${icon('chart', 17)}<h2>Financial statement</h2></div><div class="statement-actions"><div class="mini-stat"><small>Total charges</small><strong>${currency(statement.billedCents)}</strong></div><div class="mini-stat"><small>Balance</small><strong class="${(statement.balanceCents || 0) > 0 ? 'text-warning' : ''}">${currency(statement.balanceCents)}</strong></div>${button('Print statement', 'print-patient-statement', 'printer', 'secondary', `data-id="${attr(id)}"`)}</div></div>
    ${entries.length ? dataTable(['Date', 'Type', 'Reference', 'Debit', 'Credit', 'Balance', 'Note'], rows) : emptyState('chart', 'No financial activity', 'Invoices and payments for this patient build the running balance.')}
  </section>`;
}

async function renderPatientAttachments(id, patient) {
  const result = await q('list', { collection: 'attachments', page: 1, pageSize: 100, filters: { patientId: id }, sort: 'recent' });
  const rows = (result.rows || []).map((attachment) => `<div class="record-row">
    <div class="person-cell"><span class="file-icon">${icon(attachment.type?.startsWith('image/') ? 'image' : 'file', 20)}</span><div><strong>${esc(attachment.name || 'Untitled')}</strong><small>${date(attachment.createdAt?.slice(0, 10))} · ${esc(attachment.category || attachment.type || '—')} · ${formatBytes(attachment.size || 0)}</small></div></div>
    <div class="row-actions">${button('View', 'open-attachment', 'eye', 'link', `data-id="${attr(attachment.id)}"`)}${button('Download original', 'download-attachment', 'download', 'link', `data-id="${attr(attachment.id)}"`)}${can('attachments.delete') ? button('Remove', 'delete-attachment', 'trash', 'link', `data-id="${attr(attachment.id)}"`) : ''}</div>
  </div>`).join('');
  return `<section class="card"><div class="card-title"><div class="card-title-text">${icon('paperclip', 17)}<h2>Attachments</h2></div>${button('Attach file', 'open-attachment-add', 'plus', 'secondary', `data-id="${attr(id)}"`)}</div>
    ${rows || emptyState('paperclip', 'No attachments yet', 'X-rays, PDFs and clinical documents attach to this patient. PDF active content is never embedded.')}
  </section>`;
}

async function renderPatientReferrals(id, patient) {
  const result = await q('list', { collection: 'referrals', page: 1, pageSize: 50, filters: { patientId: id }, sort: 'date-desc' });
  const rows = (result.rows || []).map((referral) => `<div class="record-row"><div><strong>→ ${esc(referral.referralTo)}${referral.specialty ? ` (${esc(referral.specialty)})` : ''}</strong><small>${date(referral.date)} · ${esc(referral.reason || '')}${referral.response ? ` · response: ${esc(referral.response)}` : ''}</small></div><div class="row-actions">${statusBadge(referral.status || 'Sent')}${button('Edit', 'open-referral', 'edit', 'link', `data-id="${attr(referral.id)}"`)}</div></div>`).join('');
  return `<section class="card"><div class="card-title"><div class="card-title-text">${icon('send', 17)}<h2>Referrals</h2></div>${button('New referral', 'open-referral', 'plus', 'secondary', `data-id="${attr(id)}"`)}</div>
    ${rows || emptyState('send', 'No referrals yet', 'Outgoing referrals and their responses appear here.')}</section>`;
}

async function renderPatientFollowups(id, patient) {
  const result = await q('list', { collection: 'followUpTasks', page: 1, pageSize: 50, filters: { patientId: id }, sort: 'due' });
  const rows = (result.rows || []).map((task) => `<div class="record-row"><div><strong>${esc(task.title || 'Follow-up')}</strong><small>due ${date(task.dueDate)}${task.reason ? ` · ${esc(task.reason)}` : ''}</small></div><div class="row-actions">${statusBadge(task.status || 'Open')}${task.status !== 'Completed' ? button('Complete', 'complete-followup', 'check', 'link', `data-id="${attr(task.id)}"`) : ''}${button('Edit', 'open-followup', 'edit', 'link', `data-id="${attr(task.id)}"`)}</div></div>`).join('');
  return `<section class="card"><div class="card-title"><div class="card-title-text">${icon('flag', 17)}<h2>Follow-ups</h2></div>${button('Schedule follow-up', 'open-followup', 'plus', 'secondary', `data-id="${attr(id)}"`)}</div>
    ${rows || emptyState('flag', 'No follow-ups scheduled', 'Follow-up dates from visits or manual scheduling appear here.')}</section>`;
}

/* ----------------------------- appointments ---------------------------- */
function appointmentViewDay(value) {
  return `<div class="view-pane">${value.map(appointmentRow).join('') || emptyState('calendar', 'Nothing booked', 'No appointments on this day.', button('Book appointment', 'open-appointment', 'plus', 'secondary'))}</div>`;
}
function appointmentViewWeek(value) {
  const byDay = {};
  value.forEach((a) => { (byDay[a.date] = byDay[a.date] || []).push(a); });
  return `<div class="week-grid">${Object.keys(byDay).sort().map((day) => `<div class="week-day"><h3>${dateFull(day)}</h3>${byDay[day].sort((a, b) => a.time.localeCompare(b.time)).map(appointmentRow).join('')}</div>`).join('') || emptyState('calendar', 'No appointments this week', 'Pick a day or book a new appointment.', button('Book appointment', 'open-appointment', 'plus', 'secondary'))}</div>`;
}
function appointmentViewAgenda(value) {
  return `<div class="agenda-list">${value.map((a) => `<div class="agenda-row" data-action="open-appointment-detail" data-id="${attr(a.id)}"><span class="agenda-date">${dateFull(a.date)}</span><span class="appt-time">${time(a.time)}</span><strong>${esc(patientName(a.patientId))}</strong><small>${esc(a.reason || '—')}</small>${statusBadge(a.status)}</div>`).join('') || emptyState('calendar', 'Upcoming agenda is empty', 'Book appointments to build the agenda.')}</div>`;
}
async function renderAppointments() {
  let data;
  if (ui.apptView === 'day') {
    const day = await q('appointmentDay', { date: ui.calendarDate });
    data = day.appointments || [];
  } else {
    const from = ui.calendarDate;
    const to = ui.apptView === 'week' ? shiftDate(ui.calendarDate, 6) : shiftDate(ui.calendarDate, 30);
    const result = await q('appointmentsBetween', { from, to, query: listState.appointments.query });
    data = result.rows || [];
  }
  const viewControls = `<div class="view-switch">${[['day', 'Day'], ['week', 'Week'], ['agenda', 'Agenda']].map(([key, label]) => `<button class="btn ${ui.apptView === key ? 'btn-primary' : 'btn-secondary'}" data-action="set-appt-view" data-view="${key}">${esc(localized(label))}</button>`).join('')}</div>`;
  const nav = ui.apptView === 'day'
    ? `<div class="cal-nav"><button class="icon-button" data-action="cal-step" data-step="-1" aria-label="Previous day">${icon('left', 16)}</button><strong>${dateFull(ui.calendarDate)}</strong><button class="icon-button" data-action="cal-step" data-step="1" aria-label="Next day">${icon('right', 16)}</button></div>`
    : `<div class="cal-nav"><button class="icon-button" data-action="cal-step" data-step="${ui.apptView === 'week' ? -7 : -30}" aria-label="Previous">${icon('left', 16)}</button><strong>${date(ui.calendarDate)} → ${date(shiftDate(ui.calendarDate, ui.apptView === 'week' ? 6 : 29))}</strong><button class="icon-button" data-action="cal-step" data-step="${ui.apptView === 'week' ? 7 : 30}" aria-label="Next">${icon('right', 16)}</button></div>`;
  return `<div class="page">
    ${pageHeader('Appointments', 'Schedule, reschedule and track every visit.', `${viewControls}${button('Print queue', 'print-queue', 'printer', 'secondary')}${button('Book appointment', 'open-appointment', 'plus', 'primary')}`)}
    ${nav}
    ${ui.apptView === 'day' ? appointmentViewDay(data) : ui.apptView === 'week' ? appointmentViewWeek(data) : appointmentViewAgenda(data)}
  </div>`;
}
function shiftDate(value, days) {
  const d = new Date(`${value}T00:00:00`);
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

async function renderQueue() {
  const day = await q('appointmentDay', { date: today() });
  const queue = (day.appointments || []).filter((a) => a.status !== 'Cancelled' && a.status !== 'No Show').sort((a, b) => a.time.localeCompare(b.time));
  const waiting = queue.filter((a) => ['Checked In', 'Waiting', 'In Treatment'].includes(a.status));
  return `<div class="page">
    ${pageHeader("Today's Queue", 'Check patients in and keep the chair moving.', `${button('Print queue', 'print-queue', 'printer', 'secondary')}${button('Book appointment', 'open-appointment', 'plus', 'primary')}`)}
    <div class="queue-metrics"><div class="queue-ring big"><strong>${waiting.length}</strong><span>waiting now</span></div><div class="queue-copy"><strong>${queue.length} scheduled today</strong><p>Click a card to check in, start or complete. Serials are assigned automatically at check-in.</p></div></div>
    <div class="queue-list">${queue.map((a) => `<div class="queue-card ${a.status === 'Completed' ? 'is-done' : ''}" data-id="${attr(a.id)}">
      <div class="queue-card-top"><span class="queue-serial">${esc(a.serial || `Q-${String(queue.indexOf(a) + 1).padStart(3, '0')}`)}</span>${statusBadge(a.status)}</div>
      <strong>${esc(patientName(a.patientId))}</strong><small>${time(a.time)} · ${esc(a.reason || '—')}${a.chair ? ` · ${esc(a.chair)}` : ''}</small>
      <div class="queue-card-actions">
        ${['Checked In', 'Waiting', 'In Treatment', 'Completed'].map((status) => `<button class="chip-button ${a.status === status ? 'selected' : ''}" data-action="queue-status" data-id="${attr(a.id)}" data-status="${attr(status)}" ${can('appointments.queue') ? '' : 'disabled'}>${esc(status)}</button>`).join('')}
        ${can('appointments.cancel') ? `<button class="chip-button danger" data-action="cancel-appointment" data-id="${attr(a.id)}">Cancel</button>` : ''}
      </div>
    </div>`).join('') || emptyState('clipboard', 'No appointments in today’s queue', 'Check in patients as they arrive.', button('Book appointment', 'open-appointment', 'plus', 'secondary'))}
  </div></div>`;
}

/* ------------------------------- clinical ------------------------------ */
async function renderClinical() {
  const result = await listQuery('visits', { patientId: ui.patientId || undefined });
  const rows = (result.rows || []).map((v) => `<tr class="clickable-row" data-action="open-visit" data-id="${attr(v.id)}">
    <td>${esc(v.visitCode || '—')}</td><td><strong>${esc(patientName(v.patientId))}</strong></td><td>${date(v.date)}</td><td>${esc(v.reason || '—')}</td><td>${esc(v.diagnosis || '—')}</td><td>${v.followUpDate ? relativeDate(v.followUpDate) : '<span class="muted">—</span>'}</td><td>${statusBadge(v.status || 'Completed')}</td>
  </tr>`).join('');
  return `<div class="page">
    ${pageHeader('Clinical Records', 'Every visit, diagnosis and treatment note, patient by patient.', `${button('Record visit', 'open-visit', 'plus', 'primary')}`)}
    ${toolbar(`<label class="search-field"><span>${icon('search', 16)}</span><input type="search" placeholder="Search visits or patient" value="${attr(listState.visits.query)}" data-input="list-query" data-collection="visits" aria-label="Search visits"></label>`, '')}
    ${dataTable(['Visit', 'Patient', 'Date', 'Reason', 'Diagnosis', 'Follow-up', 'Status'], rows, emptyState('clipboard', 'No matching records', 'Record a visit or adjust your search.', button('Record visit', 'open-visit', 'plus', 'secondary')))}
    ${tablePager(result.total || 0, listState.visits.page, 'visits')}
  </div>`;
}

async function renderPrescriptions() {
  const result = await listQuery('prescriptions');
  const rows = (result.rows || []).map((rx) => `<tr class="clickable-row" data-action="open-prescription" data-id="${attr(rx.id)}">
    <td>${esc(rx.prescriptionCode || '—')}</td><td><strong>${esc(patientName(rx.patientId))}</strong></td><td>${date(rx.date)}</td><td>${esc(rx.doctor || '—')}</td><td>${(rx.medications || []).slice(0, 3).map((m) => esc(m.medicine)).join(', ') || '—'}</td><td class="row-actions">${button('Print', 'print-prescription', 'printer', 'link', `data-id="${attr(rx.id)}"`)}</td>
  </tr>`).join('');
  return `<div class="page">
    ${pageHeader('Prescriptions', 'Clinician-authored medicine lists, ready to print.', `${button('New prescription', 'open-prescription', 'plus', 'primary')}`)}
    ${toolbar(`<label class="search-field"><span>${icon('search', 16)}</span><input type="search" placeholder="Search code, doctor or patient" value="${attr(listState.prescriptions.query)}" data-input="list-query" data-collection="prescriptions" aria-label="Search prescriptions"></label>`, '')}
    ${dataTable(['Code', 'Patient', 'Date', 'Prescriber', 'Medicines', ''], rows, emptyState('file', 'No prescriptions yet', 'Prescriptions written for patients appear here.', button('New prescription', 'open-prescription', 'plus', 'secondary')))}
    ${tablePager(result.total || 0, listState.prescriptions.page, 'prescriptions')}
  </div>`;
}

async function renderDental() {
  const patients = appState.directory.patients.slice(0, 200);
  return `<div class="page">
    ${pageHeader('Dental Chart', 'Tooth-level records with preserved history.', button('Open from a patient', 'navigate', 'arrow', 'secondary', 'data-page="patients"'))}
    <section class="card"><div class="card-title"><div class="card-title-text">${icon('tooth', 17)}<h2>Choose a patient</h2></div></div>
      <div class="dental-patient-picker"><label class="field-label">Patient<select data-change="dental-patient">${['', 'Choose patient...'].map((v) => `<option value="${v}"></option>`).join('')}${patients.map((p) => `<option value="${attr(p.id)}">${esc(`${p.patientCode || ''} · ${p.fullName}`)}</option>`).join('')}</select></label></div>
      <p class="form-note">${icon('shield', 14)} Every tooth keeps its full history — new records supersede, they never overwrite. Dentiva Pro records what you enter; it does not recommend treatment.</p>
    </section>
  </div>`;
}

async function renderTreatments() {
  const result = await listQuery('treatments');
  const rows = (result.rows || []).map((t) => `<tr class="clickable-row" data-action="open-treatment" data-id="${attr(t.id)}">
    <td>${esc(t.code || '—')}</td><td><strong>${esc(t.name)}</strong></td><td>${esc(t.category || 'General')}</td><td>${currency(t.defaultPrice || 0)}</td><td>${t.duration || 30} min</td><td>${t.toothRequired ? badge('Tooth required', 'neutral') : ''}</td><td>${statusBadge(t.active === false ? 'Inactive' : 'Active')}</td><td class="row-actions">${button('Edit', 'open-treatment', 'edit', 'link', `data-id="${attr(t.id)}"`)}</td>
  </tr>`).join('');
  return `<div class="page">
    ${pageHeader('Treatment Catalog', 'Consistent names, prices and durations across the practice.', `${button('Add treatment', 'open-treatment', 'plus', 'primary')}`)}
    ${toolbar(`<label class="search-field"><span>${icon('search', 16)}</span><input type="search" placeholder="Search treatments" value="${attr(listState.treatments.query)}" data-input="list-query" data-collection="treatments" aria-label="Search treatments"></label>`, '')}
    ${dataTable(['Code', 'Treatment', 'Category', 'Price', 'Duration', 'Tooth', 'Status', ''], rows, emptyState('layers', 'No treatments yet', 'Add the treatments you perform to speed up invoices and plans.', button('Add treatment', 'open-treatment', 'plus', 'secondary')))}
    ${tablePager(result.total || 0, listState.treatments.page, 'treatments')}
  </div>`;
}

async function renderBilling() {
  const result = await listQuery('invoices');
  const rows = (result.rows || []).map((inv) => `<tr class="clickable-row" data-action="open-invoice" data-id="${attr(inv.id)}">
    <td>${esc(inv.invoiceNumber || '—')}</td><td><strong>${esc(patientName(inv.patientId))}</strong></td><td>${date(inv.date)}</td><td>${currency(centsToMoney(inv.totalCents ?? inv.total))}</td><td>${currency(centsToMoney(inv.paidCents ?? inv.paid))}</td><td class="${(inv.dueCents ?? inv.due ?? 0) > 0 ? 'text-warning' : ''}"><strong>${currency(centsToMoney(inv.dueCents ?? inv.due))}</strong></td><td>${statusBadge(inv.status)}</td><td class="row-actions">${button('Print', 'print-invoice', 'printer', 'link', `data-id="${attr(inv.id)}"`)}</td>
  </tr>`).join('');
  return `<div class="page">
    ${pageHeader('Billing', 'Invoices with payments, adjustments and refunds kept exact to the taka.', `${button('Print billing', 'print-billing', 'printer', 'secondary')}${button('New invoice', 'open-invoice', 'plus', 'primary')}`)}
    ${toolbar(`<label class="search-field"><span>${icon('search', 16)}</span><input type="search" placeholder="Search invoice or patient" value="${attr(listState.invoices.query)}" data-input="list-query" data-collection="invoices" aria-label="Search invoices"></label>
      <select data-change="invoice-status-filter" aria-label="Invoice status"><option value="" ${!listState.invoices.filters.status ? 'selected' : ''}>All statuses</option>${['Draft', 'Issued', 'Partially Paid', 'Paid', 'Refunded', 'Adjusted', 'Cancelled'].map((s) => `<option value="${s}" ${listState.invoices.filters.status === s ? 'selected' : ''}>${esc(s)}</option>`).join('')}</select>`, '')}
    ${dataTable(['Invoice', 'Patient', 'Date', 'Total', 'Paid', 'Due', 'Status', ''], rows, emptyState('receipt', 'No matching records', 'Create invoices from patient billing or the quick actions.', button('New invoice', 'open-invoice', 'plus', 'secondary')))}
    ${tablePager(result.total || 0, listState.invoices.page, 'invoices')}
  </div>`;
}

async function renderPayments() {
  const result = await listQuery('payments');
  const rows = (result.rows || []).map((payment) => `<tr class="clickable-row" data-action="open-payment-detail" data-id="${attr(payment.id)}">
    <td>${esc(payment.receiptNumber || '—')}</td><td><strong>${esc(patientName(payment.patientId))}</strong></td><td>${date(payment.date)}</td><td>${money(payment)}</td><td>${esc(payment.method || '—')}</td><td>${payment.refundedAmount ? badge(`Refunded ${currency(payment.refundedAmount)}`, 'warning') : ''}</td><td>${statusBadge(payment.status || 'Recorded')}</td><td class="row-actions">${can('payments.refund') ? button('Refund', 'open-refund', 'undo', 'link', `data-id="${attr(payment.id)}"`) : ''}${button('Print receipt', 'print-payment', 'printer', 'link', `data-id="${attr(payment.id)}"`)}</td>
  </tr>`).join('');
  return `<div class="page">
    ${pageHeader('Payments', 'Receipts, refunds and adjustments with an exact money trail.', `${button('Record payment', 'open-payment', 'plus', 'primary')}`)}
    ${toolbar(`<label class="search-field"><span>${icon('search', 16)}</span><input type="search" placeholder="Search receipt, reference or patient" value="${attr(listState.payments.query)}" data-input="list-query" data-collection="payments" aria-label="Search payments"></label>`, '')}
    ${dataTable(['Receipt', 'Patient', 'Date', 'Amount', 'Method', 'Refund', 'Status', ''], rows, emptyState('credit', 'No matching records', 'Record a payment to see it here.', button('Record payment', 'open-payment', 'plus', 'secondary')))}
    ${tablePager(result.total || 0, listState.payments.page, 'payments')}
  </div>`;
}

async function renderAccounting() {
  const summary = await q('accountingSummary', { rangeKey: 'all' });
  const methodRows = (summary.byMethod || []).map((m) => `<div class="mix-row"><span>${esc(m.label)}</span><div class="mix-bar"><span style="width:${summary.collectedCents ? Math.max(2, (m.cents / summary.collectedCents) * 100) : 0}%"></span></div><strong>${currency(m.cents)}</strong><small>${m.count} tx</small></div>`).join('');
  const agingRows = (summary.aging || []).map((bucket) => `<tr><td>${esc(bucket.label)}</td><td><strong>${currency(bucket.cents)}</strong></td><td>${number(bucket.count)} invoice(s)</td></tr>`).join('');
  const categoryRows = (summary.expenseCategories || []).map((c) => `<tr><td>${esc(c.label)}</td><td><strong>${currency(c.cents)}</strong></td><td>${number(c.count)}</td></tr>`).join('');
  return `<div class="page">
    ${pageHeader('Accounting', 'Operating money in one honest place — no guessing.', `${button('Record expense', 'open-expense', 'plus', 'primary')}`)}
    <div class="metric-grid">
      <div class="metric-card"><div class="metric-top"><span class="metric-label">Collected (all time)</span><span class="metric-icon soft-purple">${icon('credit', 18)}</span></div><strong>${currency(summary.collectedCents)}</strong><small>${currency(summary.refundedCents)} refunded</small></div>
      <div class="metric-card"><div class="metric-top"><span class="metric-label">Expenses (all time)</span><span class="metric-icon soft-amber">${icon('dollar', 18)}</span></div><strong>${currency(summary.expensesCents)}</strong><small>${(summary.expenseCategories || []).length} categories</small></div>
      <div class="metric-card ${summary.netOperatingCents < 0 ? 'metric-negative' : ''}"><div class="metric-top"><span class="metric-label">Net operating</span><span class="metric-icon">${icon('chart', 18)}</span></div><strong>${currency(summary.netOperatingCents)}</strong><small>Collected − expenses</small></div>
      <div class="metric-card"><div class="metric-top"><span class="metric-label">Receivables</span><span class="metric-icon soft-blue">${icon('receipt', 18)}</span></div><strong>${currency(summary.receivablesCents)}</strong><small>Outstanding invoice balance</small></div>
    </div>
    <div class="accounting-grid">
      <section class="card"><div class="card-title"><div class="card-title-text">${icon('credit', 17)}<h2>Payment mix</h2></div></div>${methodRows || emptyState('credit', 'No payment data', 'Recorded payments build this mix.')}</section>
      <section class="card"><div class="card-title"><div class="card-title-text">${icon('clock', 17)}<h2>Receivables aging</h2></div></div>${dataTable(['Age bucket', 'Outstanding', 'Invoices'], agingRows) || emptyState('clock', 'Nothing outstanding', 'Every invoice is settled.')}</section>
      <section class="card card-wide"><div class="card-title"><div class="card-title-text">${icon('dollar', 17)}<h2>Expense categories</h2></div>${button('Record expense', 'open-expense', 'plus', 'secondary')}</div>${dataTable(['Category', 'Total', 'Entries'], categoryRows, emptyState('dollar', 'No expenses yet', 'Operating costs appear here by category.'))}</section>
    </div>
  </div>`;
}

async function renderInventory() {
  const result = await listQuery('inventory');
  const ledgerCard = await inventoryLedgerCard();
  const rows = (result.rows || []).map((item) => `<tr class="clickable-row" data-action="open-inventory-item" data-id="${attr(item.id)}">
    <td>${esc(item.itemCode || '—')}</td><td><strong>${esc(item.name)}</strong>${item.batch ? `<small>batch ${esc(item.batch)}</small>` : ''}</td><td>${esc(item.category || 'Other')}</td><td><strong class="${Number(item.currentStock) <= Number(item.minimumStock || 0) ? 'text-warning' : ''}">${number(item.currentStock)} ${esc(item.unit || '')}</strong></td><td>${currency(item.purchasePrice || 0)}</td><td>${currency(item.salePrice || 0)}</td><td>${item.expiryDate ? badge(date(item.expiryDate), item.expiryDate < today() ? 'danger' : 'neutral') : '<span class="muted">—</span>'}</td><td>${Number(item.currentStock) <= Number(item.minimumStock || 0) ? badge('Low stock', 'warning') : statusBadge('In stock')}</td>
    <td class="row-actions">${button('Move stock', 'open-stock-adjustment', 'swap', 'link', `data-id="${attr(item.id)}"`)}</td>
  </tr>`).join('');
  const filters = listState.inventory.filters;
  return `<div class="page">
    ${pageHeader('Inventory', 'Stock, movements and expiry — always accurate, never negative.', `${button('Add stock', 'open-stock', 'plus', 'primary')}`)}
    ${toolbar(`<label class="search-field"><span>${icon('search', 16)}</span><input type="search" placeholder="Search item, code or batch" value="${attr(listState.inventory.query)}" data-input="list-query" data-collection="inventory" aria-label="Search inventory"></label>
      <select data-change="inventory-category-filter" aria-label="Category"><option value="" ${!filters.category ? 'selected' : ''}>All categories</option>${['Consumable', 'Material', 'Equipment', 'Chemical', 'Other'].map((c) => `<option value="${c}" ${filters.category === c ? 'selected' : ''}>${esc(c)}</option>`).join('')}</select>
      <label class="check-label"><input type="checkbox" data-change="inventory-lowstock" ${filters.lowStock ? 'checked' : ''}> Low stock</label>
      <label class="check-label"><input type="checkbox" data-change="inventory-expiring" ${filters.expiringBefore ? 'checked' : ''}> Expiring soon</label>`, '')}
    ${dataTable(['Code', 'Item', 'Category', 'On hand', 'Purchase', 'Sale', 'Expiry', 'Status', ''], rows, emptyState('box', 'No matching records', 'Add stock items to track purchases and usage.', button('Add stock', 'open-stock', 'plus', 'secondary')))}
    ${tablePager(result.total || 0, listState.inventory.page, 'inventory')}
    ${ledgerCard}
  </div>`;
}
async function inventoryLedgerCard() {
  const ledger = await q('list', { collection: 'stockMovements', page: 1, pageSize: 12, query: '', filters: {}, sort: 'date-desc' }).catch(() => ({ rows: [] }));
  const items = new Map(((await q('list', { collection: 'inventory', page: 1, pageSize: 1000, query: '', filters: {} }).catch(() => ({ rows: [] }))).rows || []).map((item) => [item.id, item.name]));
  const userRows = ((await q('users', {}).catch(() => ({ rows: [] }))).rows) || [];
  const userNames = new Map(userRows.map((user) => [user.id, user.name]));
  const rows = (ledger.rows || []).map((move) => `<tr><td><small>${date(move.date)} ${esc(String(move.createdAt || '').slice(11, 16))}</small></td><td><strong>${esc(items.get(move.itemId) || '—')}</strong></td><td>${statusBadge(move.type)}</td><td class="${Number(move.quantity) < 0 ? 'text-danger' : 'text-success'}"><strong>${Number(move.quantity) > 0 ? '+' : ''}${number(move.quantity)}</strong></td><td><small>${number(move.before)} → ${number(move.after)}</small></td><td>${esc(move.reason || '—')}${move.notes ? `<small>${esc(move.notes)}</small>` : ''}</td><td><small>${esc(userNames.get(move.userId) || '—')}</small></td></tr>`).join('');
  if (!rows) return `<section class="card movement-ledger-card"><div class="card-title"><div class="card-title-text">${icon('activity', 17)}<h2>Movement ledger</h2></div></div><p class="form-note">Every purchase, usage and correction lands here, attributed and immutable. No movements recorded yet.</p></section>`;
  return `<section class="card movement-ledger-card"><div class="card-title"><div class="card-title-text">${icon('activity', 17)}<h2>Movement ledger</h2></div><small class="muted">Most recent ${number(ledger.rows?.length || 0)} of ${number(ledger.total || 0)} — full history in the Activity log</small></div>${dataTable(['When', 'Item', 'Type', 'Δ', 'Stock', 'Reason', 'By'], rows)}</section>`;
}

async function renderSuppliers() {
  const result = await listQuery('suppliers');
  const rows = (result.rows || []).map((supplier) => `<tr class="clickable-row" data-action="open-supplier" data-id="${attr(supplier.id)}">
    <td>${esc(supplier.code || '—')}</td><td><strong>${esc(supplier.name)}</strong></td><td>${esc(supplier.contactPerson || '—')}</td><td>${esc(supplier.phone || '—')}</td><td>${esc(supplier.email || '—')}</td><td class="row-actions">${button('Edit', 'open-supplier', 'edit', 'link', `data-id="${attr(supplier.id)}"`)}</td>
  </tr>`).join('');
  return `<div class="page">
    ${pageHeader('Suppliers', 'Purchasing contacts behind your inventory.', `${button('Add supplier', 'open-supplier', 'plus', 'primary')}`)}
    ${toolbar(`<label class="search-field"><span>${icon('search', 16)}</span><input type="search" placeholder="Search suppliers" value="${attr(listState.suppliers.query)}" data-input="list-query" data-collection="suppliers" aria-label="Search suppliers"></label>`, '')}
    ${dataTable(['Code', 'Supplier', 'Contact', 'Phone', 'Email', ''], rows, emptyState('truck', 'No suppliers yet', 'Connect the vendors you purchase from.', button('Add supplier', 'open-supplier', 'plus', 'secondary')))}
    ${tablePager(result.total || 0, listState.suppliers.page, 'suppliers')}
  </div>`;
}

async function renderStaff() {
  const result = await listQuery('staff');
  const rows = (result.rows || []).map((member) => `<tr class="clickable-row" data-action="open-staff" data-id="${attr(member.id)}">
    <td><div class="person-cell"><span class="avatar avatar-small">${initials(member.name)}</span><div><strong>${esc(member.name)}</strong><small>${esc(member.specialization || '')}</small></div></div></td><td>${esc(member.role || 'Other')}</td><td>${esc(member.phone || '—')}</td><td>${esc(member.email || '—')}</td><td>${date(member.joinDate || member.joiningDate)}</td><td>${statusBadge(member.active === false ? 'Inactive' : 'Active')}</td><td class="row-actions">${button('Edit', 'open-staff', 'edit', 'link', `data-id="${attr(member.id)}"`)}</td>
  </tr>`).join('');
  return `<div class="page">
    ${pageHeader('Staff', 'The people behind the practice.', `${button('Add staff member', 'open-staff', 'plus', 'primary')}`)}
    ${toolbar(`<label class="search-field"><span>${icon('search', 16)}</span><input type="search" placeholder="Search staff" value="${attr(listState.staff.query)}" data-input="list-query" data-collection="staff" aria-label="Search staff"></label>`, '')}
    ${dataTable(['Staff', 'Role', 'Phone', 'Email', 'Joined', 'Status', ''], rows, emptyState('briefcase', 'No staff yet', 'Add the team members who work in the practice.', button('Add staff member', 'open-staff', 'plus', 'secondary')))}
    ${tablePager(result.total || 0, listState.staff.page, 'staff')}
  </div>`;
}

async function renderReports() {
  const type = ui.reportType;
  const report = await q('report', { type, rangeKey: ui.reportsRange === 'custom' ? 'custom' : ui.reportsRange, from: ui.rangeFrom || undefined, to: ui.rangeTo || undefined, page: listState.expenses.page === 1 ? 1 : 1, pageSize: 15 });
  const kpis = report.kpis || {};
  const rows = report.rows || {};
  const kpiCard = (label, value, sub = '') => `<div class="metric-card"><div class="metric-top"><span class="metric-label">${esc(label)}</span></div><strong>${value}</strong>${sub ? `<small>${esc(sub)}</small>` : ''}</div>`;
  let kpiMarkup = '';
  let rowMarkup = '';
  if (type === 'revenue') {
    kpiMarkup = kpiCard('Collected', currency(kpis.collectedCents), `${kpis.paymentCount ?? 0} payments`) + kpiCard('Billed', currency(kpis.billedCents), `${kpis.invoiceCount ?? 0} invoices`) + kpiCard('Expenses', currency(kpis.expensesCents), `${kpis.expenseCount ?? 0} entries`);
    rowMarkup = dataTable(['Receipt', 'Patient', 'Date', 'Method', 'Amount'], (rows.rows || []).map((p) => `<tr><td>${esc(p.receiptNumber || '—')}</td><td>${esc(patientName(p.patientId))}</td><td>${date(p.date)}</td><td>${esc(p.method || '—')}</td><td>${money(p)}</td></tr>`).join(''));
  } else if (type === 'patients') {
    kpiMarkup = kpiCard('Registered', number(kpis.registered ?? 0)) + kpiCard('With phone', number(kpis.withPhone ?? 0)) + kpiCard('Upcoming visits', number(kpis.upcoming ?? 0));
    rowMarkup = dataTable(['Patient', 'Phone', 'Registered', 'Balance'], (rows.rows || []).map((p) => `<tr><td>${esc(p.fullName)}</td><td>${esc(p.phone || '—')}</td><td>${date(p.registrationDate)}</td><td>${currency(centsToMoney(p.balanceCents || 0))}</td></tr>`).join(''));
  } else if (type === 'visits') {
    kpiMarkup = kpiCard('Visits', number(kpis.visits ?? 0)) + kpiCard('Unique patients', number(kpis.uniquePatients ?? 0)) + kpiCard('With follow-up', number(kpis.withFollowUp ?? 0));
    rowMarkup = dataTable(['Visit', 'Patient', 'Date', 'Reason', 'Diagnosis'], (rows.rows || []).map((v) => `<tr><td>${esc(v.visitCode || '—')}</td><td>${esc(patientName(v.patientId))}</td><td>${date(v.date)}</td><td>${esc(v.reason || '—')}</td><td>${esc(v.diagnosis || '—')}</td></tr>`).join(''));
  } else if (type === 'appointments') {
    kpiMarkup = kpiCard('Appointments', number(kpis.appointments ?? 0)) + kpiCard('Completed', number(kpis.completed ?? 0), `${kpis.completionPct ?? 0}% completion`) + kpiCard('No shows', number(kpis.noShows ?? 0));
    rowMarkup = dataTable(['Code', 'Patient', 'Date', 'Time', 'Reason', 'Status'], (rows.rows || []).map((a) => `<tr><td>${esc(a.appointmentCode || '—')}</td><td>${esc(patientName(a.patientId))}</td><td>${date(a.date)}</td><td>${time(a.time)}</td><td>${esc(a.reason || '—')}</td><td>${statusBadge(a.status)}</td></tr>`).join(''));
  } else if (type === 'outstanding') {
    kpiMarkup = kpiCard('Outstanding', currency(kpis.dueCents ?? 0)) + kpiCard('Open invoices', number(kpis.openInvoices ?? 0)) + kpiCard('Partially paid', number(kpis.partiallyPaid ?? 0));
    rowMarkup = dataTable(['Invoice', 'Patient', 'Date', 'Total', 'Due'], (rows.rows || []).map((i) => `<tr><td>${esc(i.invoiceNumber || '—')}</td><td>${esc(patientName(i.patientId))}</td><td>${date(i.date)}</td><td>${currency(centsToMoney(i.totalCents ?? i.total))}</td><td class="text-warning"><strong>${currency(centsToMoney(i.dueCents ?? i.due))}</strong></td></tr>`).join(''));
  } else if (type === 'inventory') {
    kpiMarkup = kpiCard('Items tracked', number(kpis.itemsTracked ?? 0)) + kpiCard('Low stock', number(kpis.lowStock ?? 0)) + kpiCard('Expired', number(kpis.expired ?? 0)) + kpiCard('Stock value', currency(kpis.stockValueCents ?? 0));
    rowMarkup = dataTable(['Item', 'Category', 'On hand', 'Value'], (rows.rows || []).map((i) => `<tr><td>${esc(i.name)}</td><td>${esc(i.category || 'Other')}</td><td>${number(i.currentStock)} ${esc(i.unit || '')}</td><td>${currency(centsToMoney(i.purchasePriceCents ?? 0) * Number(i.currentStock || 0))}</td></tr>`).join(''));
  } else {
    kpiMarkup = kpiCard('Total', currency(kpis.totalCents ?? 0)) + kpiCard('Transactions', number(kpis.transactions ?? 0)) + kpiCard('Average', currency(kpis.averageCents ?? 0));
    rowMarkup = dataTable(['Date', 'Description', 'Category', 'Method', 'Amount'], (rows.rows || []).map((e) => `<tr><td>${date(e.date)}</td><td>${esc(e.description)}</td><td>${esc(e.category || 'Other')}</td><td>${esc(e.method || '—')}</td><td>${money(e)}</td></tr>`).join(''));
  }
  return `<div class="page">
    ${pageHeader('Reports', 'Honest numbers for any range — every figure traces to a record.', button('Print report', 'print-report', 'printer', 'secondary'))}
    ${toolbar(`
      <select data-change="report-type" aria-label="Report type">${[['revenue', 'Revenue'], ['patients', 'Patients'], ['visits', 'Visits'], ['appointments', 'Appointments'], ['outstanding', 'Outstanding'], ['inventory', 'Inventory'], ['expenses', 'Expenses']].map(([key, label]) => `<option value="${key}" ${type === key ? 'selected' : ''}>${esc(label)}</option>`).join('')}</select>
      ${periodPicker('reports-range', ui.reportsRange)}`, '')}
    <div class="metric-grid">${kpiMarkup}</div>
    ${rowMarkup || emptyState('chart', 'No records in this range', 'Change the date range or create records to populate this report.')}
  </div>`;
}

async function renderAnalytics() {
  const analytics = await q('analytics', { rangeKey: ui.analyticsRange === 'custom' ? 'month' : ui.analyticsRange });
  const totals = analytics.totals || {};
  const counts = analytics.counts || {};
  const maxMonthly = Math.max(1, ...(analytics.monthly || []).map((m) => m.cents));
  const monthBars = (analytics.monthly || []).slice(-12).map((m) => `<div class="bar-col" title="${m.month} · ${currency(m.cents)}"><span class="bar" style="height:${Math.max(3, (m.cents / maxMonthly) * 100)}%"></span><small>${String(m.month).slice(5)}${String(m.month).slice(0, 3)}</small></div>`).join('');
  const maxVisits = Math.max(1, ...(analytics.visitMonthly || []).map((m) => m.count));
  const visitBars = (analytics.visitMonthly || []).slice(-12).map((m) => `<div class="bar-col" title="${m.month} · ${m.count} visits"><span class="bar bar-blue" style="height:${Math.max(3, (m.count / maxVisits) * 100)}%"></span><small>${String(m.month).slice(5)}${String(m.month).slice(0, 3)}</small></div>`).join('');
  return `<div class="page">
    ${pageHeader('Analytics', 'Where your practice is heading, month by month.', periodPicker('analytics-range', ui.analyticsRange))}
    <div class="metric-grid">
      <div class="metric-card"><div class="metric-top"><span class="metric-label">Collected</span></div><strong>${currency(totals.collectedCents || 0)}</strong></div>
      <div class="metric-card"><div class="metric-top"><span class="metric-label">Billed</span></div><strong>${currency(totals.billedCents || 0)}</strong></div>
      <div class="metric-card"><div class="metric-top"><span class="metric-label">Visits</span></div><strong>${number(counts.visits || 0)}</strong></div>
      <div class="metric-card"><div class="metric-top"><span class="metric-label">New patients</span></div><strong>${number(counts.newPatients || 0)}</strong></div>
    </div>
    <div class="analytics-grid">
      <section class="card"><div class="card-title"><div class="card-title-text">${icon('chart', 17)}<h2>Revenue trend</h2></div></div><div class="bar-chart">${monthBars || emptyState('chart', 'No payment data', 'Revenue bars appear once payments are recorded.')}</div></section>
      <section class="card"><div class="card-title"><div class="card-title-text">${icon('activity', 17)}<h2>Clinical activity</h2></div></div><div class="bar-chart">${visitBars || emptyState('activity', 'No visit data', 'Visit bars appear once clinical visits are recorded.')}</div></section>
      <section class="card"><div class="card-title"><div class="card-title-text">${icon('credit', 17)}<h2>Payment mix</h2></div></div>${(analytics.byMethod || []).map((m) => `<div class="mix-row"><span>${esc(m.label)}</span><strong>${currency(m.cents)}</strong></div>`).join('') || emptyState('credit', 'No payment data', 'Method mix appears once payments are recorded.')}</section>
      <section class="card"><div class="card-title"><div class="card-title-text">${icon('users', 17)}<h2>Top dentists</h2></div></div>${(analytics.topDentists || []).map((d) => `<div class="mix-row"><span>${esc(d.label)}</span><strong>${number(d.count)} visits</strong></div>`).join('') || emptyState('users', 'No visit data', 'Dentist workload appears once visits are recorded.')}</section>
    </div>
  </div>`;
}

async function renderNotifications() {
  const notes = notificationItems();
  const rules = notificationRules();
  const ruleRow = (kind, label) => `<label class="notification-rule"><input type="checkbox" data-change="notification-rule" data-kind="${attr(kind)}" ${rules[kind] !== false ? 'checked' : ''}><span>${esc(label)}</span></label>`;
  return `<div class="page">
    ${pageHeader('Notifications', 'Live signals from your workspace — nothing here is fabricated.', `${button('Mark all read', 'mark-notifications-read', 'check', 'secondary')}`)}
    <section class="card">
      <div class="card-title"><div class="card-title-text">${icon('settings', 17)}<h2>Signal categories</h2></div></div>
      <div class="notification-rules">${NOTIFICATION_RULE_LABELS.map(([kind, label]) => ruleRow(kind, label)).join('')}</div>
      <p class="form-note">${appState.settings.notifications === false ? 'Notifications are disabled in Settings — the feed stays quiet until re-enabled.' : 'Signals refresh automatically; turn a category off to silence just that kind.'}</p>
    </section>
    <section class="card notification-center">
      ${notes.length ? notes.map((n) => `<div class="notification-row ${n.read ? '' : 'unread'}">
        <button class="notification-open" data-action="notification-open" data-id="${attr(n.id)}"><span class="notification-icon">${icon(n.type === 'warning' ? 'warning' : n.type === 'backup' ? 'backup' : n.type === 'queue' ? 'clock' : 'bell', 16)}</span><span class="notification-body"><strong>${esc(n.title)}</strong><p>${esc(n.message)}</p><small>${date(n.date || today())}${n.priority === 'high' ? ' · high priority' : ''}</small></span>${icon('arrow', 14)}</button>
        <button class="icon-button tiny" data-action="notification-dismiss" data-id="${attr(n.id)}" aria-label="Dismiss notification" title="Dismiss">${icon('close', 13)}</button>
      </div>`).join('') : emptyState('bell', 'No notifications right now', 'Appointments, follow-ups, payments, stock, expiry, queue and backup signals appear here as they fire.')}
    </section>
  </div>`;
}

function buildRestorePlanView(candidate) {
  const modules = [];
  if (ui.restoreCandidate && ui.restoreCandidate.selectedModules) {
    ui.restoreCandidate.selectedModules.forEach((key) => {
      if (key === 'patients') modules.push('patients');
      if (key === 'clinical') modules.push('clinical');
      if (key === 'finance') modules.push('finance');
      if (key === 'operations') modules.push('operations');
    });
  }
  if (!modules.length) modules.push('patients', 'clinical', 'finance', 'operations');
  const plan = candidate && candidate.state ? buildRestorePlan({}, candidate.state, { modules, strategy: ui.restoreCandidate?.strategy || 'Replace' }) : null;
  return { modules, plan };
}
const AUDIT_ENTITIES = ['Appointment', 'Attachment', 'Dashboard', 'Dental record', 'Expense', 'Follow-up', 'Inventory', 'Inventory movement', 'Invoice', 'Medication catalog', 'Notification', 'Notifications', 'Patient', 'Payment', 'Payment adjustment', 'Prescription', 'Referral', 'Saved search', 'Settings', 'Staff', 'Supplier', 'Treatment', 'Treatment plan', 'User', 'Visit', 'Workspace'];
const auditState = () => listState.audit || (listState.audit = { page: 1, pageSize: 25, query: '', filters: {} });
async function renderAuditLogPage() {
  const state = auditState();
  const users = can('settings.view') ? (await q('users', {}).catch(() => ({ users: [] }))) : { users: [] };
  const userRows = users.users || users.rows || [];
  const result = await q('auditList', {
    page: state.page, pageSize: state.pageSize, query: state.query,
    entity: state.filters.entity || '', userId: state.filters.userId || '',
    from: state.filters.from || '', to: state.filters.to || ''
  });
  const roleByUserId = new Map(userRows.map((user) => [user.id, user.role]));
  const rows = (result.rows || []).map((row) => `<tr>
    <td><small>${esc(String(row.createdAt || '').replace('T', ' ').slice(0, 19))}</small></td>
    <td><strong>${esc(row.userName || 'System')}</strong></td>
    <td>${esc(roleByUserId.get(row.userId) || row.role || '—')}</td>
    <td>${esc(row.action || '—')}</td>
    <td>${esc(row.entity || '—')}</td>
    <td><code class="code-chip">${esc(String(row.entityId || '—').slice(0, 24))}</code></td>
    <td>${row.entity === 'Patient' && row.entityId ? esc(patientName(row.entityId)) : esc(row.patientId ? patientName(row.patientId) : '—')}</td>
    <td>${esc(row.summary || '')}</td>
    <td class="row-actions">${button('Details', 'audit-details', 'eye', 'link', `data-id="${attr(row.id)}"`)}</td>
  </tr>`).join('');
  return `<div class="page">
    ${pageHeader('Activity log', 'Every protected action, attributed to the account that performed it — append-only and tamper-evident.', can('audit.export') ? button('Export CSV', 'audit-export', 'download', 'secondary') : '')}
    ${toolbar(`
      <label class="search-field"><span>${icon('search', 16)}</span><input type="search" placeholder="Search action, user or summary" value="${attr(state.query)}" data-input="list-query" data-collection="audit" aria-label="Search audit log"></label>
      <select data-change="audit-entity" aria-label="Filter by record type"><option value="">All record types</option>${AUDIT_ENTITIES.map((entity) => `<option value="${attr(entity)}" ${state.filters.entity === entity ? 'selected' : ''}>${esc(entity)}</option>`).join('')}</select>
      ${userRows.length ? `<select data-change="audit-user" aria-label="Filter by user"><option value="">All users</option>${userRows.map((user) => `<option value="${attr(user.id)}" ${state.filters.userId === user.id ? 'selected' : ''}>${esc(user.name)} · ${esc(user.role)}</option>`).join('')}</select>` : ''}
      <input type="date" data-change="audit-from" value="${attr(state.filters.from || '')}" aria-label="From date">
      <input type="date" data-change="audit-to" value="${attr(state.filters.to || '')}" aria-label="To date">`, `${badge(`${number(result.total || 0)} entr${(result.total || 0) === 1 ? 'y' : 'ies'}`)}`)}
    ${(result.rows || []).length ? dataTable(['Time', 'User', 'Role', 'Action', 'Record', 'ID', 'Patient', 'Summary', ''], rows) : emptyState('activity', 'No audit entries match', 'Adjust the filters or date range — the trail itself is never deleted.')}
    ${tablePager(result.total || 0, state.page, 'audit')}
  </div>`;
}
function modalAuditDetail(data = {}) {
  const row = data.row || {};
  const payload = (() => {
    const candidate = row.payload && typeof row.payload === 'object' ? row.payload : {};
    const safe = {};
    for (const [key, value] of Object.entries(candidate)) {
      if (/pin|hash|secret|password|salt|token/i.test(key)) continue;
      safe[key] = value;
    }
    return safe;
  })();
  return `${modalHead('AUDIT EVENT', row.action || 'Event', `${esc(String(row.createdAt || '').replace('T', ' ').slice(0, 19))} · ${esc(row.userName || 'System')}`)}
    <div class="detail-list">
      <div><dt>Entity</dt><dd>${esc(row.entity || '—')} · <code class="code-chip">${esc(String(row.entityId || '—').slice(0, 32))}</code></dd></div>
      <div><dt>Summary</dt><dd>${esc(row.summary || '—')}</dd></div>
      ${Object.keys(payload).length ? `<div><dt>Recorded snapshot</dt><dd><pre class="audit-payload">${esc(JSON.stringify(payload, null, 2).slice(0, 4000))}</pre></dd></div>` : ''}
    </div>
    <p class="form-note">${icon('shield', 14)} The trail is append-only: entries can never be edited or deleted by any account. Snapshot keys that could hold secrets are removed before display.</p>
    ${modalFooter('Close', '', '')}`;
}

async function renderBackup() {
  const [list, info] = await Promise.all([api.listBackups().catch(() => ({ ok: true, backups: [] })), api.workspaceInfo().catch(() => null)]);
  const backups = list.backups || [];
  const storage = info?.storage || appState.storage || {};
  const candidate = ui.restoreCandidate;
  const candidateSection = candidate ? renderRestoreCandidate(candidate) : '';
  return `<div class="page">
    ${pageHeader('Backup & Restore', 'Your practice data stays on this device — backups are explicit and verified.', `${button('Create secure backup', 'create-backup', 'backup', 'primary')}${button('Choose backup folder…', 'restore-from-folder', 'folder', 'secondary')}${button('Import JSON backup…', 'restore-from-file', 'upload', 'secondary')}`)}
    ${candidateSection}
    <section class="card backup-summary">
      <div class="backup-stat"><span class="backup-icon">${icon('database', 20)}</span><div><small>Database</small><strong>${formatBytes(storage.bytes || 0)}</strong></div></div>
      <div class="backup-stat"><span class="backup-icon">${icon('paperclip', 20)}</span><div><small>Attachments</small><strong>${formatBytes(storage.attachmentBytes || 0)} · ${number(storage.attachmentFiles || 0)} files</strong></div></div>
      <div class="backup-stat"><span class="backup-icon">${icon('users', 20)}</span><div><small>Records</small><strong>${number(Object.values(storage.recordCounts || {}).reduce((a, b) => a + b, 0))}</strong></div></div>
      <div class="backup-stat"><span class="backup-icon">${icon('backup', 20)}</span><div><small>Last backup</small><strong>${(info?.lastBackupAt || storage.lastBackupAt) ? date(String(info?.lastBackupAt || storage.lastBackupAt).slice(0, 10)) : 'Never'}</strong></div></div>
    </section>
    ${(() => {
      const auto = (() => { try { return JSON.parse(info?.lastAutoBackupStatus || 'null'); } catch { return null; } })();
      const enabled = appState.settings.backupEnabled !== false;
      const freq = { 12: 'every 12 hours', 24: 'every 24 hours', 72: 'every 3 days', 168: 'weekly' }[Number(appState.settings.backupIntervalHours) || 24] || `every ${Number(appState.settings.backupIntervalHours) || 24} hours`;
      return `<section class="card">
        <div class="card-title"><div class="card-title-text">${icon('clock', 17)}<h2>Automatic backups</h2></div><span class="badge ${enabled ? 'success' : 'muted'}">${enabled ? 'Scheduler on' : 'Scheduler off'}</span></div>
        ${enabled ? `<p class="form-note">${icon('backup', 14)} Runs ${esc(freq)} on this device, keeping the newest ${number(appState.settings.backupRetention || 10)} backup(s). Automatic backups are full verified snapshots — identical to manual ones.</p>` : `<p class="form-note">${icon('warning', 14)} Automatic backups are disabled in Settings → Backup behaviour. Manual backups still work; clinics are strongly advised to keep the scheduler on.</p>`}
        ${auto ? (auto.ok
          ? `<p class="form-note">${icon('check', 14)} Last automatic backup: ${dateFull(String(auto.at || '').slice(0, 10))} (${esc(auto.name || 'snapshot')}${auto.pruned ? ` · pruned ${number(auto.pruned)} older copy/copies` : ''})</p>`
          : `<p class="form-note text-danger">${icon('warning', 14)} The last automatic backup failed at ${dateFull(String(auto.at || '').slice(0, 10))}: ${esc(auto.error || 'unknown error')}. Check free disk space, then create a manual backup.</p>`) : '<p class="form-note">No automatic backup has run yet in this session.</p>'}
      </section>`;
    })()}
    <section class="card">
      <div class="card-title"><div class="card-title-text">${icon('backup', 17)}<h2>Backups on this device</h2></div></div>
      ${backups.length ? backups.map((backup) => `<div class="record-row"><div><strong>${backup.name}</strong><small>${backup.createdAt ? dateFull(backup.createdAt.slice(0, 10)) : '—'}${backup.label ? ` · ${esc(backup.label)}` : ''} · ${formatBytes(backup.bytes || 0)} · ${number(Object.values(backup.recordCounts || {}).reduce((a, b) => a + b, 0))} records${backup.valid ? '' : ' · manifest unreadable'}</small></div><div class="row-actions">${button('Validate and restore selection', 'validate-backup', 'check', 'secondary', `data-id="${attr(backup.name)}"`)}${can('backup.restore') ? button('Restore', 'restore-backup', 'upload', 'primary', `data-id="${attr(backup.name)}"`) : ''}${can('backup.restore') ? button('Delete', 'delete-backup', 'trash', 'link', `data-id="${attr(backup.name)}"`) : ''}</div></div>`).join('') : emptyState('backup', 'No backups yet', 'Create a secure backup to protect this workspace. Restores always keep a pre-restore safety backup.')}
      <p class="form-note">${icon('shield', 14)} Restores are validated first (checksums + integrity), then a safety backup of the current workspace is written before anything is swapped. Keep verified backups off this device for true disaster protection.</p>
    </section>
  </div>`;
}
function renderRestoreCandidate(candidate) {
  const { modules, plan } = buildRestorePlanView(candidate);
  const stats = plan ? plan.stats || {} : {};
  return `<section class="card restore-candidate">
    <div class="card-title"><div class="card-title-text">${icon('upload', 17)}<h2>Validate and restore selection</h2></div>${button('Close', 'close-restore-candidate', 'close', 'link')}</div>
    <p class="form-note">Source: <strong>${esc(candidate.sourceLabel || 'backup')}</strong> · ${candidate.validated ? badge('Validated', 'success') : badge('Validation pending', 'warning')}</p>
    <div class="restore-modules">${Object.entries({ patients: 'Patients & identities', clinical: 'Clinical records', finance: 'Finance & billing', operations: 'Operations & scheduling' }).map(([key, label]) => `<label class="module-option"><input type="checkbox" data-change="restore-module" data-module="${key}" ${modules.includes(key) ? 'checked' : ''}><span>${esc(label)}</span><small>${(RESTORE_MODULE_GROUPS[key] || []).join(' · ')}</small></label>`).join('')}</div>
    <div class="restore-strategy"><span class="eyebrow">CONFLICT STRATEGY</span>${['Keep Existing', 'Replace', 'Create New Copy'].map((strategy) => `<label class="radio-option"><input type="radio" name="restore-strategy" data-change="restore-strategy" value="${attr(strategy)}" ${(ui.restoreCandidate?.strategy || 'Replace') === strategy ? 'checked' : ''}><span>${esc(strategy)}</span></label>`).join('')}</div>
    ${plan ? `<p class="form-note">${number(stats.toInsert ?? 0)} to insert · ${number(stats.toSkip ?? 0)} skipped by strategy · relationships are re-linked automatically.</p>` : ''}
    <div class="restore-actions">${button('Cancel restore', 'close-restore-candidate', 'close', 'secondary')}${button('Restore now', 'confirm-restore', 'upload', 'primary', `data-source="${attr(candidate.sourceKind || 'folder')}"`)}
  </section>`;
}

/* ----------------------------- diagnostics ----------------------------- */
async function renderDiagnostics() {
  const diag = await api.diagnostics().catch(() => null);
  if (!diag) return `<div class="page">${pageHeader('Diagnostics', 'Workspace health in one glance.')}<div class="empty-state"><h3>Diagnostics unavailable</h3><p>The health report could not be produced. Your data is unaffected.</p></div></div>`;
  const storage = diag.storage || {};
  const issues = diag.issues || [];
  return `<div class="page">
    ${pageHeader('Diagnostics', 'Workspace health in one glance.', button('Run integrity check', 'run-integrity-check', 'refresh', 'primary'))}
    <div class="metric-grid">
      <div class="metric-card ${diag.ok ? '' : 'metric-negative'}"><div class="metric-top"><span class="metric-label">Integrity</span><span class="metric-icon">${icon('shield', 18)}</span></div><strong>${diag.ok ? 'Healthy' : 'Needs attention'}</strong><small>${diag.integrity?.integrity || '—'} · ${diag.integrity?.foreignKeyViolationCount ?? 0} FK issue(s)</small></div>
      <div class="metric-card"><div class="metric-top"><span class="metric-label">Database</span></div><strong>${formatBytes(storage.bytes || 0)}</strong><small>${esc(storage.journalMode || '')} journal</small></div>
      <div class="metric-card"><div class="metric-top"><span class="metric-label">Attachments</span></div><strong>${formatBytes(storage.attachmentBytes || 0)}</strong><small>${number(storage.attachmentFiles || 0)} files</small></div>
      <div class="metric-card"><div class="metric-top"><span class="metric-label">Free disk</span></div><strong>${diag.freeDiskBytes ? formatBytes(diag.freeDiskBytes) : '—'}</strong></div>
    </div>
    <section class="card"><div class="card-title"><div class="card-title-text">${icon('warning', 17)}<h2>Integrity results</h2></div></div>
      ${issues.length ? issues.map((entry) => `<div class="signal-item ${entry.severity === 'error' ? 'signal-danger' : entry.severity === 'warning' ? 'signal-warning' : ''}"><span class="signal-icon">${icon(entry.severity === 'error' ? 'warning' : 'info', 16)}</span><div><strong>${esc(entry.code)}</strong><small>${esc(entry.message)}</small></div>${badge(entry.severity, entry.severity === 'error' ? 'danger' : entry.severity === 'warning' ? 'warning' : 'neutral')}</div>`).join('') : emptyState('check', 'No current integrity issues', 'Structure, relationships and money fields pass every check.')}
    </section>
    <section class="card"><div class="card-title"><div class="card-title-text">${icon('database', 17)}<h2>Record counts</h2></div></div>
      <div class="count-grid">${Object.entries(storage.recordCounts || {}).map(([collection, count]) => `<div class="count-cell"><small>${esc(collection)}</small><strong>${number(count)}</strong></div>`).join('')}</div>
    </section>
  </div>`;
}

/* ------------------------------- settings ------------------------------ */
async function renderSettings() {
  const s = appState.settings;
  const logo = safeLogoSource(s.logo);
  return `<div class="page">
    ${pageHeader('Settings', 'The practice identity behind every document and screen.', '')}
    <form data-form="settings" class="settings-form">
      <section class="card"><div class="card-title"><div class="card-title-text">${icon('building', 17)}<h2>Clinic identity</h2></div></div>
        <div class="form-grid two">
          <div class="logo-block">${logo ? `<img class="logo-preview" src="${logo}" alt="Clinic logo">` : `<span class="logo-placeholder">${icon('building', 26)}</span>`}<button type="button" class="btn btn-secondary" data-action="upload-logo">${logo ? 'Change logo' : 'Upload clinic logo'}</button>${logo ? `<button type="button" class="link-button" data-action="remove-logo">Remove logo</button>` : ''}</div>
          ${field('Clinic / practice name', 'clinicName', s.clinicName)}
          ${field('Chamber / branch', 'chamberName', s.chamberName)}
          ${field('Dentist name', 'dentistName', s.dentistName)}
          ${field('Professional title', 'professionalTitle', s.professionalTitle)}
          ${field('Phone', 'phone', s.phone, 'tel')}
          ${field('Secondary phone', 'secondaryPhone', s.secondaryPhone, 'tel')}
          ${field('Email', 'email', s.email, 'email')}
          ${field('Address', 'address', s.address, 'textarea', 'rows="2"')}
          <div class="field-split">${field('City', 'city', s.city)}${field('District', 'district', s.district)}</div>
          ${field('Country', 'country', s.country, 'text', 'value="Bangladesh"')}
        </div>
      </section>
      <section class="card"><div class="card-title"><div class="card-title-text">${icon('globe', 17)}<h2>Language & formats</h2></div></div>
        <div class="form-grid two">
          ${selectField('Default language', 'language', [['English', 'English'], ['Bengali', 'Bengali']], s.language || 'English')}
          ${selectField('Currency', 'currency', [['BDT', 'BDT (৳)'], ['USD', 'USD ($)'], ['EUR', 'EUR (€)'], ['INR', 'INR (₹)']], s.currency || 'BDT')}
          ${field('Date format', 'dateFormat', s.dateFormat || 'DD/MM/YYYY')}
          ${selectField('Time format', 'timeFormat', [['12', '12-hour'], ['24', '24-hour']], s.timeFormat || '12')}
          ${selectField('Print page size', 'printPageSize', [['A4', 'A4'], ['Letter', 'Letter'], ['Legal', 'Legal'], ['A5', 'A5']], s.printPageSize || 'A4')}
          ${selectField('Timezone', 'timezone', [['Asia/Dhaka', 'Asia/Dhaka (GMT+6)']], s.timezone || 'Asia/Dhaka')}
        </div>
      </section>
      <section class="card"><div class="card-title"><div class="card-title-text">${icon('hash', 17)}<h2>Numbering</h2></div></div>
        <div class="form-grid two">
          ${field('Patient code prefix', 'patientPrefix', s.patientPrefix || 'PT')}
          ${field('Invoice prefix', 'invoicePrefix', s.invoicePrefix || 'INV')}
          ${field('Appointment prefix', 'appointmentPrefix', s.appointmentPrefix || 'APT')}
          ${field('Queue serial prefix', 'serialPrefix', s.serialPrefix || 'Q')}
          ${field('Receipt prefix', 'receiptPrefix', s.receiptPrefix || 'RCP')}
          ${field('Visit prefix', 'visitPrefix', s.visitPrefix || 'VIS')}
        </div>
      </section>
      <section class="card"><div class="card-title"><div class="card-title-text">${icon('credit', 17)}<h2>Commerce</h2></div></div>
        <div class="form-grid two">
          <label class="check-label"><input type="checkbox" name="taxEnabled" ${s.taxEnabled ? 'checked' : ''}> Enable tax on invoices</label>
          ${field('Tax rate (%)', 'taxRate', s.taxRate ?? 0, 'number', 'min="0" max="100" step="0.01"')}
          ${field('Default appointment duration (minutes)', 'defaultDuration', s.defaultDuration || 30, 'number', 'min="5" max="480" step="5"')}
          <label class="field-label">Payment methods (comma separated)<input type="text" name="paymentMethods" value="${attr((s.paymentMethods || []).join(', '))}" placeholder="Cash, Bank, bKash, Nagad"></label>
          <label class="field-label">Expense categories (comma separated)<input type="text" name="expenseCategories" value="${attr((s.expenseCategories || []).join(', '))}" placeholder="Rent, Utilities, Supplies"></label>
          <label class="field-label">Inventory categories (comma separated)<input type="text" name="inventoryCategories" value="${attr((s.inventoryCategories || []).join(', '))}"></label>
          <label class="field-label">Chairs (comma separated)<input type="text" name="chairs" value="${attr((s.chairs || []).join(', '))}"></label>
          <label class="field-label">Rooms (comma separated)<input type="text" name="rooms" value="${attr((s.rooms || []).join(', '))}"></label>
          ${field('Low stock threshold', 'lowStockThreshold', s.lowStockThreshold || 5, 'number', 'min="0"')}
          ${field('Document footer (printed documents)', 'documentFooter', (s.documentTemplate || {}).footer || '', 'textarea', 'rows="2"')}
          <label class="check-label"><input type="checkbox" name="showLogo" ${(s.documentTemplate || {}).showLogo !== false ? 'checked' : ''}> Show clinic logo in documents</label>
          <label class="check-label"><input type="checkbox" name="showClinicContact" ${(s.documentTemplate || {}).showClinicContact !== false ? 'checked' : ''}> Show clinic contact in documents</label>
        </div>
      </section>
      <section class="card"><div class="card-title"><div class="card-title-text">${icon('settings', 17)}<h2>Custom patient fields</h2></div></div>
        <p class="form-note">Define additional practice-specific details captured on every patient form (stored on the patient record, searchable in profile; e.g. Guardian name, Referral source).</p>
        <div class="form-grid">
          ${(s.customPatientFields || []).map((definition, index) => `<div class="custom-field-row"><input type="text" name="customFieldLabel" value="${attr(definition.label || '')}" placeholder="Field label" aria-label="Custom field ${index + 1} label"><select name="customFieldType" aria-label="Custom field ${index + 1} type">${['text', 'number', 'date', 'textarea'].map((type) => `<option value="${type}" ${definition.type === type ? 'selected' : ''}>${type}</option>`).join('')}</select><button type="button" class="icon-button tiny" data-action="remove-custom-field" data-index="${index}" aria-label="Remove field">${icon('trash', 14)}</button></div>`).join('') || '<p class="form-note muted">No custom fields defined.</p>'}
        </div>
        <button type="button" class="btn btn-secondary" data-action="add-custom-field">${icon('plus', 15)}<span>Add custom field</span></button>
      </section>

      <section class="card"><div class="card-title"><div class="card-title-text">${icon('backup', 17)}<h2>Backup behaviour</h2></div></div>
        <div class="form-grid two">
          <label class="check-label"><input type="checkbox" name="backupEnabled" ${s.backupEnabled !== false ? 'checked' : ''}> Automatically back up this workspace</label>
          ${selectField('Automatic backup frequency', 'backupIntervalHours', [['12', 'Every 12 hours'], ['24', 'Every 24 hours (daily)'], ['72', 'Every 3 days'], ['168', 'Weekly']], String(s.backupIntervalHours || 24))}
          ${field('Backups to keep (retention)', 'backupRetention', s.backupRetention || 10, 'number', 'min="1" max="365" step="1"')}
          <label class="check-label"><input type="checkbox" name="notifications" ${s.notifications !== false ? 'checked' : ''}> Enable operational notifications</label>
        </div>
        <p class="form-note">${icon('shield', 14)} Automatic backups run silently on this device, keep the newest N copies, and surface their status on the Backup &amp; Restore page. Manual backups always work too.</p>
      </section>
      <div class="form-actions-bar"><div class="form-note">${icon('shield', 14)} No cloud required — settings apply to this device only.</div>${button('Cancel', 'close-modal', 'close', 'link')}${button('Save settings', 'submit', 'check', 'primary')}</div>
    </form>
  </div>`;
}

/* -------------------------------- users -------------------------------- */
const USER_ROLE_OPTIONS = [['Administrator', 'Administrator'], ['Dentist', 'Dentist'], ['Manager', 'Manager'], ['Receptionist', 'Receptionist'], ['Dental Assistant', 'Dental Assistant'], ['Accountant', 'Accountant'], ['Cleaner', 'Cleaner'], ['Other', 'Other'], ['Custom Role', 'Custom Role']];
function effectivePermissions(user) {
  if (!user) return [];
  return permissionsForRole(user.role, user.permissions || []);
}
async function renderUsers() {
  const result = await listQuery('users');
  const rows = (result.rows || []).map((user) => `<tr class="clickable-row" data-action="open-user-account" data-id="${attr(user.id)}">
    <td><div class="person-cell"><span class="avatar avatar-small">${initials(user.name)}</span><div><strong>${esc(user.name)}</strong><small>${user.pinHash || user.hasPin ? 'PIN protected' : 'PIN not configured'}${user.failedAttempts ? ` · ${user.failedAttempts} failed attempt(s)` : ''}${Number(user.lockedUntil || 0) > Date.now() ? ' · locked' : ''}</small></div></div></td>
    <td>${esc(user.role || 'Custom Role')}</td>
    <td>${esc(staffName(user.staffId))}</td>
    <td>${user.lastLogin ? `${date(user.lastLogin.slice(0, 10))} ${time(user.lastLogin.slice(11, 16))}` : 'Never'}</td>
    <td>${statusBadge(user.active === false ? 'Inactive' : 'Active')}</td>
    <td class="row-actions">${button('Edit', 'open-user-account', 'edit', 'link', `data-id="${attr(user.id)}"`)}</td>
  </tr>`).join('');
  return `<div class="page">
    ${pageHeader('User Accounts', 'Secure local accounts with explicit access.', `${button('Add user account', 'open-user-account', 'plus', 'primary')}`)}
    ${toolbar(`<label class="search-field"><span>${icon('search', 16)}</span><input type="search" placeholder="Search accounts" value="${attr(listState.users.query)}" data-input="list-query" data-collection="users" aria-label="Search user accounts"></label>`, '')}
    ${dataTable(['Account', 'Role', 'Staff', 'Last sign-in', 'Status', ''], rows, emptyState('users', 'No user accounts yet', 'Create an account for each person who uses the workspace.', button('Add user account', 'open-user-account', 'plus', 'secondary')))}
    ${tablePager(result.total || 0, listState.users.page, 'users')}
    <p class="form-note">${icon('shield', 14)} PINs are protected with PBKDF2 hashing. Failed attempts temporarily lock the account, and inactive accounts cannot sign in. Authorization is enforced by the application core — hiding a button never grants access (users.manage boundary).</p>
  </div>`;
}

function renderHelp() {
  return `<div class="page">
    ${pageHeader('Help centre', 'Everything Dentiva Pro does, explained briefly.', '')}
    <div class="help-grid">
      <section class="card"><div class="card-title"><div class="card-title-text">${icon('users', 17)}<h2>Patients & scheduling</h2></div></div><p>Add patients, book appointments (conflicts are flagged, not silently accepted), run the daily queue with serials, and keep follow-ups on a due date that becomes an actionable task.</p></section>
      <section class="card"><div class="card-title"><div class="card-title-text">${icon('tooth', 17)}<h2>Clinical</h2></div></div><p>Record visits, update the tooth-level chart with preserved history, write clinician-authored prescriptions and treatment plans. Dentiva Pro never diagnoses or recommends treatment — it records what you enter.</p></section>
      <section class="card"><div class="card-title"><div class="card-title-text">${icon('receipt', 17)}<h2>Billing & money</h2></div></div><p>Invoices, payments, partial refunds and adjustments keep an exact, integer-taka balance. Re-pricing a paid invoice is blocked by design; every figure traces to a record.</p></section>
      <section class="card"><div class="card-title"><div class="card-title-text">${icon('box', 17)}<h2>Inventory</h2></div></div><p>Stock moves only through recorded movements (purchase, usage, correction) and can never go negative. Low stock and expiry surface on the dashboard and in reports.</p></section>
      <section class="card"><div class="card-title"><div class="card-title-text">${icon('shield', 17)}<h2>Security & backup</h2></div></div><p>Local accounts use PBKDF2-hashed PINs with lockout. Backups are validated before restore, and every restore keeps a safety copy. No cloud, no telemetry — No cloud required, ever.</p></section>
      <section class="card"><div class="card-title"><div class="card-title-text">${icon('search', 17)}<h2>Fast actions</h2></div></div><p>Press <kbd>⌘K</kbd> / <kbd>Ctrl K</kbd> for the command palette: open patients, book appointments, record payments, run reports — without hunting through menus.</p></section>
    </div>
  </div>`;
}
function renderAbout() {
  const s = appState.settings;
  return `<div class="page">
    ${pageHeader('About Dentiva Pro', 'Professional dental practice management for Bangladesh.', '')}
    <section class="card about-card">
      <div class="about-brand">${icon('tooth', 34)}<div><h2>Dentiva Pro <span>v${APP_VERSION}</span></h2><p>Offline-first · Light mode · Local privacy</p></div></div>
      <div class="about-grid">
        <div class="info-card"><h3>Your practice data stays yours.</h3><p>Everything is stored on this device in a relational local database. No cloud required — no account, no sync, no telemetry.</p></div>
        <div class="info-card"><h3>Built with care in Dhaka.</h3><p>Created by Md. Shohan Khan · helloiamshohan@gmail.com</p></div>
        <div class="info-card"><h3>Clinician-in-control.</h3><p>Dentiva Pro records clinical decisions made by qualified professionals. It does not diagnose, prescribe or recommend treatment.</p></div>
        <div class="info-card"><h3>Made for Bangladesh.</h3><p>Full Bengali + English interface, BDT by default, and the payment methods practices actually use.</p></div>
      </div>
      <p class="form-note">${s.clinicName ? `${esc(s.clinicName)} · ` : ''}Workspace on this device · last backup ${appState.storage?.lastBackupAt ? date(appState.storage.lastBackupAt.slice(0, 10)) : 'never'}</p>
    </section>
  </div>`;
}

/* ------------------------------------------------------------------ */
/* Modals                                                              */
/* ------------------------------------------------------------------ */
function modal() {
  const type = ui.modal?.type;
  const data = ui.modal?.data || {};
  const builders = {
    setup: modalSetup, patient: modalPatient, appointment: modalAppointment, appointmentDetail: modalAppointmentDetail,
    visit: modalVisit, prescription: modalPrescription, dental: modalDentalTooth, invoice: modalInvoice, invoiceDetail: modalInvoiceDetail,
    payment: modalPayment, refund: modalRefund, expense: modalExpense, stock: modalStock, 'stock-adjustment': modalStockAdjustment,
    supplier: modalSupplier, staff: modalStaff, treatment: modalTreatment, 'treatment-plan': modalTreatmentPlan,
    referral: modalReferral, followup: modalFollowup, attachment: modalAttachment, 'attachment-preview': modalAttachmentPreview,
    'user-account': modalUserAccount, security: modalSecurity, 'csv-import': modalCsvImport, search: modalSearch,
    'saved-filters': modalSavedFilters, 'dashboard-customizer': modalDashboardCustomizer, 'audit-detail': modalAuditDetail,
    notifications: modalNotifications, merge: modalPatientMerge, 'print-preview': modalPrintPreview
  };
  const builder = builders[type] || (() => '');
  return `<div class="modal-overlay" data-modal-window><div class="modal-window" role="dialog" aria-modal="true">${builder(data)}</div></div>`;
}
function modalHead(eyebrow, title, subtitle = '') {
  return `<div class="modal-head"><div><span class="eyebrow">${esc(eyebrow)}</span><h2>${esc(localized(title))}</h2>${subtitle ? `<p>${esc(localized(subtitle))}</p>` : ''}</div><button class="icon-button" data-action="close-modal" aria-label="Close dialog">${icon('close', 18)}</button></div>`;
}
function modalFooter(cancel = 'Cancel', save = 'Save record', saveAction = 'submit-modal') {
  return `<div class="modal-footer"><button class="btn btn-link" data-action="close-modal">${esc(cancel)}</button><button class="btn btn-primary" type="submit" data-submit-action="${saveAction}">${icon('check', 16)}<span>${esc(save)}</span></button></div>`;
}
function field(label, name, value = '', type = 'text', extra = '') {
  return `<label class="field-label">${esc(localized(label))}${type === 'textarea' ? `<textarea name="${attr(name)}" ${extra}>${attr(value)}</textarea>` : `<input type="${type}" name="${attr(name)}" value="${attr(value)}" ${extra}>`}</label>`;
}
function selectField(label, name, options, value = '', extra = '') {
  return `<label class="field-label">${esc(localized(label))}<select name="${attr(name)}" ${extra}>${options.map(([val, label]) => `<option value="${attr(val)}" ${String(val) === String(value) ? 'selected' : ''}>${esc(label)}</option>`).join('')}</select></label>`;
}
function patientOptions(value = '', onlyActive = true) {
  const list = (onlyActive ? appState.directory.patients : appState.directory.patients).sort((a, b) => String(a.fullName).localeCompare(String(b.fullName)));
  return [['', 'Choose patient...'], ...list.map((p) => [p.id, `${p.patientCode || ''} · ${p.fullName}`])];
}
function dentistOptions(value = '') {
  return [['', appState.settings.dentistName || 'Primary dentist'], ...appState.directory.staff.filter((s) => ['Dentist', 'Manager'].includes(s.role)).map((s) => [s.id, s.name])];
}
function treatmentOptions(value = '') {
  return [['', 'No catalog treatment'], ...appState.directory.treatments.filter((t) => t.active !== false).map((t) => [t.id, `${t.name} · ${currency(t.defaultPrice || 0)}`])];
}

/* Form-level permissions: the UI refuses to even open forms the session
 * cannot submit — the backend enforces the same rule on every call. */
const formPermissions = {
  patient: 'patients.create', appointment: 'appointments.create', visit: 'clinical.create',
  prescription: 'prescriptions.create', invoice: 'billing.create', payment: 'payments.create',
  refund: 'payments.refund', expense: 'accounting.create', stock: 'inventory.purchase',
  supplier: 'inventory.purchase', staff: 'staff.create', treatment: 'clinical.create',
  'treatment-plan': 'clinical.plan', referral: 'clinical.create', followup: 'clinical.create',
  attachment: 'clinical.attachments', security: 'settings.edit', 'user-account': 'users.manage',
  settings: 'settings.edit', merge: 'patients.edit', 'stock-adjustment': 'inventory.adjust'
};
function openModal(type, data = {}) {
  const permission = formPermissions[type];
  if (permission && !can(permission)) return requirePermission(permission);
  ui.modal = { type, data };
  render();
  window.setTimeout(() => document.querySelector('[data-modal-window] input, [data-modal-window] select, [data-modal-window] textarea')?.focus(), 40);
}
function closeModal() {
  if (ui.modal?.type === 'csv-import' && ui.csvImport) ui.csvImport = null;
  ui.modal = null;
  render();
}

/* ------------------------------ setup ------------------------------ */
function modalSetup(data = {}) {
  const step = data.step || 1;
  if (step === 3) {
    return `<div class="modal-window-inner">${modalHead('FIRST RUN', 'All set', 'Your workspace is ready. Enter to start the day.')}
      <div class="setup-success">${icon('check', 34)}<p>${esc(data.clinicName || 'Your clinic')} · ${esc(data.dentistName || 'Dentist')} · ${esc(data.language || 'English')} · ${esc(data.currency || 'BDT')}</p><p class="form-note">The administrator account now has a local PIN. You can add team accounts any time from User Accounts.</p></div>
      <div class="modal-footer"><button class="btn btn-link" data-action="close-modal">Review settings</button><button class="btn btn-primary" type="button" data-action="finish-setup">${icon('arrow', 16)}<span>Enter workspace</span></button></div>
    </div>`;
  }
  if (step === 1) {
    return `<form data-form="setup"><input type="hidden" name="setupStep" value="1">${modalHead('FIRST RUN', 'Welcome to Dentiva Pro', 'Set your clinic identity. Everything stays on this device.')}
      <div class="form-grid two">
        ${field('Clinic / practice name', 'clinicName', data.clinicName, 'text', 'required')}
        ${field('Dentist name', 'dentistName', data.dentistName)}
        ${field('Professional title', 'professionalTitle', data.professionalTitle || 'Dr.')}
        ${field('Phone', 'phone', data.phone, 'tel')}
        ${field('Email', 'email', data.email, 'email')}
        ${field('Address', 'address', data.address, 'textarea', 'rows="2"')}
      </div>
      ${modalFooter('Exit', 'Continue')}
    </form>`;
  }
  return `<form data-form="setup"><input type="hidden" name="setupStep" value="2">${modalHead('FIRST RUN', 'Finalise the workspace', 'Choose language, currency and create the first Administrator account.')}
    <div class="form-grid two">
      ${selectField('Default language', 'language', [['English', 'English'], ['Bengali', 'Bengali']], data.language || 'English')}
      ${selectField('Currency', 'currency', [['BDT', 'BDT (৳)'], ['USD', 'USD ($)'], ['INR', 'INR (₹)']], data.currency || 'BDT')}
      ${field('Administrator PIN', 'adminPin', '', 'password', 'required minlength=4 maxlength=12 inputmode="numeric" pattern="[0-9]{4,12}" autocomplete="new-password" placeholder="4–12 digits"')}
      ${field('Confirm PIN', 'adminPinConfirm', '', 'password', 'required minlength=4 maxlength=12 inputmode="numeric" pattern="[0-9]{4,12}" autocomplete="new-password"')}
    </div>
    <p class="form-note">${icon('shield', 14)} The PIN is hashed locally with PBKDF2 and never stored as readable text.</p>
    <div class="modal-footer"><button class="btn btn-link" data-action="close-modal">Cancel</button><button class="btn btn-primary" type="submit">${icon('check', 16)}<span>Finish setup</span></button><button class="btn btn-secondary" type="button" data-action="finish-setup">${icon('arrow', 16)}<span>Enter workspace</span></button></div>
  </form>`;
}

/* ----------------------------- patient ----------------------------- */
function modalPatient(data = {}) {
  const p = data.patient || {};
  const editing = Boolean(p.id);
  return `<form data-form="patient"><input type="hidden" name="id" value="${attr(p.id || '')}">${modalHead('PATIENT', editing ? 'Edit patient' : 'Add patient', 'One clear identity per person — search matches name, code and phone.')}
    <div class="form-grid two">
      ${field('Full name', 'fullName', p.fullName, 'text', 'required')}
      ${field('Preferred name', 'preferredName', p.preferredName)}
      ${field('Phone', 'phone', p.phone, 'tel', 'required')}
      ${field('Email', 'email', p.email, 'email')}
      ${selectField('Gender', 'gender', [['', '—'], ['Female', 'Female'], ['Male', 'Male'], ['Other', 'Other']], p.gender)}
      ${field('Date of birth', 'dateOfBirth', p.dateOfBirth, 'date')}
      ${field('Blood group', 'bloodGroup', p.bloodGroup, 'text', 'placeholder="e.g. B+"')}
      ${field('Address', 'address', p.address, 'textarea', 'rows="2"')}
      <div class="field-split">${field('City', 'city', p.city)}${field('District', 'district', p.district)}</div>
      ${field('Occupation', 'occupation', p.occupation)}
      ${field('Marital status', 'maritalStatus', p.maritalStatus)}
      ${field('Emergency contact name', 'emergencyName', p.emergencyName)}
      ${field('Emergency contact phone', 'emergencyPhone', p.emergencyPhone, 'tel')}
      ${field('Tags (comma separated)', 'tags', Array.isArray(p.tags) ? p.tags.join(', ') : p.tags)}
      ${field('Allergies', 'allergies', p.allergies, 'textarea', 'rows="2"')}
      ${field('Medical history', 'medicalHistory', p.medicalHistory, 'textarea', 'rows="2"')}
      ${field('Important alerts', 'importantAlerts', p.importantAlerts, 'textarea', 'rows="2"')}
      ${field('Communication notes', 'communicationNotes', p.communicationNotes, 'textarea', 'rows="2"')}
      ${field('Notes', 'notes', p.notes, 'textarea', 'rows="3"')}
      ${(appState.settings.customPatientFields || []).map((definition) => field(definition.label || definition.key, `custom_${definition.key}`, (p.customFields || {})[definition.key], definition.type === 'textarea' ? 'textarea' : definition.type === 'date' ? 'date' : definition.type === 'number' ? 'number' : 'text')).join('')}
    </div>
    ${modalFooter('Cancel', editing ? 'Save patient' : 'Add patient')}
  </form>`;
}
function modalPatientMerge(data = {}) {
  const p = data.patient || {};
  return `<form data-form="merge"><input type="hidden" name="primaryId" value="${attr(p.id || '')}">${modalHead('MERGE PATIENTS', 'Merge duplicate into this patient', 'Every record from the duplicate moves here; the duplicate is archived. Codes and history are preserved.')}
    <div class="form-grid">
      ${selectField('Duplicate patient to merge', 'duplicateId', appState.directory.patients.filter((x) => x.id !== p.id).map((x) => [x.id, `${x.patientCode || ''} · ${x.fullName}`]), '')}
      <p class="form-note">Review the two records before confirming. This cannot be undone without a restore.</p>
    </div>
    ${modalFooter('Cancel', 'Merge records', 'merge-patients')}
  </form>`;
}

/* --------------------------- appointment --------------------------- */
function modalAppointment(data = {}) {
  const a = data.appointment || {};
  const editing = Boolean(a.id);
  return `<form data-form="appointment"><input type="hidden" name="id" value="${attr(a.id || '')}">${modalHead('APPOINTMENT', editing ? 'Edit appointment' : 'Book appointment', 'Conflicts with the same chair or dentist are flagged before you confirm.')}
    <div class="form-grid two">
      ${selectField('Patient', 'patientId', patientOptions(a.patientId || ui.patientId), a.patientId || ui.patientId, 'required')}
      ${field('Date', 'date', a.date || today(), 'date', 'required')}
      ${field('Time', 'time', a.time || '10:00', 'time', 'required')}
      ${field('Duration (minutes)', 'duration', a.duration || appState.settings.defaultDuration || 30, 'number', 'min="5" max="480" step="5"')}
      ${selectField('Dentist', 'dentistId', dentistOptions(a.dentistId), a.dentistId)}
      <div class="field-split">${selectField('Chair', 'chair', (appState.settings.chairs || ['Chair 1']).map((c) => [c, c]), a.chair || 'Chair 1')}${selectField('Room', 'room', (appState.settings.rooms || ['Room 1']).map((r) => [r, r]), a.room || 'Room 1')}</div>
      ${field('Reason', 'reason', a.reason, 'text', 'required')}
      ${field('Planned treatment', 'treatment', a.treatment)}
      ${field('Notes', 'notes', a.notes, 'textarea', 'rows="2"')}
      ${selectField('Status', 'status', [['Scheduled', 'Scheduled'], ['Confirmed', 'Confirmed'], ['Checked In', 'Checked In'], ['Waiting', 'Waiting'], ['In Treatment', 'In Treatment'], ['Completed', 'Completed']], a.status || 'Scheduled')}
    </div>
    ${modalFooter('Cancel', editing ? 'Save appointment' : 'Book appointment')}
  </form>`;
}
function modalAppointmentDetail(data = {}) {
  const a = data.appointment || {};
  return `${modalHead('APPOINTMENT', `${a.appointmentCode || 'Appointment'}`, `${dateFull(a.date)} · ${time(a.time)}`)}
    <div class="detail-list">
      <div><dt>Patient</dt><dd>${button(patientName(a.patientId), 'open-patient-profile', 'arrow', 'link', `data-id="${attr(a.patientId)}"`)}</dd></div>
      <div><dt>Reason</dt><dd>${esc(a.reason || '—')}</dd></div>
      <div><dt>Treatment</dt><dd>${esc(a.treatment || '—')}</dd></div>
      <div><dt>Dentist</dt><dd>${esc(staffName(a.dentistId))}</dd></div>
      <div><dt>Chair / Room</dt><dd>${esc(a.chair || '—')} · ${esc(a.room || '—')}</dd></div>
      <div><dt>Status</dt><dd>${statusBadge(a.status || 'Scheduled')}</dd></div>
      ${a.notes ? `<div><dt>Notes</dt><dd>${esc(a.notes)}</dd></div>` : ''}
    </div>
    <div class="queue-card-actions">
      ${['Checked In', 'Waiting', 'In Treatment', 'Completed', 'No Show'].map((status) => `<button class="chip-button ${a.status === status ? 'selected' : ''}" data-action="queue-status" data-id="${attr(a.id)}" data-status="${attr(status)}">${esc(status)}</button>`).join('')}
      ${can('visits.create') && !['Completed', 'Cancelled', 'No Show'].includes(a.status) ? `<button class="chip-button primary" data-action="start-visit" data-id="${attr(a.id)}">${icon('clipboard', 13)} Start visit</button>` : ''}
      ${can('appointments.cancel') ? `<button class="chip-button danger" data-action="cancel-appointment" data-id="${attr(a.id)}">Cancel</button>` : ''}
      ${can('appointments.edit') ? `<button class="chip-button" data-action="open-appointment" data-id="${attr(a.id)}">Edit</button>` : ''}
      <button class="chip-button" data-action="print-appointment" data-id="${attr(a.id)}">Print slip</button>
    </div>
    <div class="modal-footer"><button class="btn btn-primary" data-action="close-modal">Done</button></div>`;
}

/* ------------------------------ visit ------------------------------ */
function modalVisit(data = {}) {
  const v = data.visit || {};
  const editing = Boolean(v.id);
  return `<form data-form="visit"><input type="hidden" name="id" value="${attr(v.id || '')}"><input type="hidden" name="appointmentId" value="${attr(v.appointmentId || '')}">${modalHead('CLINICAL RECORD', editing ? 'Edit visit' : 'Record visit', 'What happened, what was found, what was done — and when to follow up.')}
    <div class="form-grid two">
      ${selectField('Patient', 'patientId', patientOptions(v.patientId || ui.patientId), v.patientId || ui.patientId, 'required')}
      ${field('Date', 'date', v.date || today(), 'date', 'required')}
      ${field('Reason', 'reason', v.reason, 'text')}
      ${field('Chief complaint', 'chiefComplaint', v.chiefComplaint, 'textarea', 'rows="2"')}
      ${field('Symptoms', 'symptoms', v.symptoms, 'textarea', 'rows="2"')}
      ${field('Findings', 'findings', v.findings, 'textarea', 'rows="2"')}
      ${field('Diagnosis', 'diagnosis', v.diagnosis, 'textarea', 'rows="2')}
      ${field('Treatment performed', 'treatmentPerformed', v.treatmentPerformed, 'textarea', 'rows="2"')}
      ${field('Procedures (comma separated)', 'procedures', v.procedures)}
      ${field('Tooth number(s)', 'teeth', v.teeth)}
      ${selectField('Dentist', 'dentistId', dentistOptions(v.dentistId), v.dentistId)}
      ${field('Follow-up date', 'followUpDate', v.followUpDate, 'date')}
      <p class="form-note full">A follow-up date automatically creates an actionable follow-up task.</p>
      ${field('Notes', 'notes', v.notes, 'textarea', 'rows="2"')}
    </div>
    ${modalFooter('Cancel', editing ? 'Save visit' : 'Record visit')}
  </form>`;
}

/* --------------------------- prescription --------------------------- */
function modalPrescription(data = {}) {
  const rx = data.prescription || {};
  const editing = Boolean(rx.id);
  const first = (rx.medications || [])[0] || {};
  const medicationLines = (rx.medications || []).slice(1).map((m) => [m.medicine, m.strength, m.dosage, m.frequency, m.duration, m.route, m.instructions].filter(Boolean).join('|')).join('\n');
  return `<form data-form="prescription"><input type="hidden" name="id" value="${attr(rx.id || '')}">${modalHead('PRESCRIPTION', editing ? 'Edit prescription' : 'New prescription', 'Clear instructions, multiple medicines and a print-ready record.')}
    <div class="form-grid two">
      ${selectField('Saved medication', 'prescriptionTemplate', [['', 'Choose a saved medicine...'], ...((appState.medicationCatalog || []).filter((item) => item.active !== false).map((item) => [item.id, `${item.name}${item.strength ? ` · ${item.strength}` : ''}`]))], '')}
      ${selectField('Patient', 'patientId', patientOptions(rx.patientId || ui.patientId), rx.patientId || ui.patientId, 'required')}
      ${field('Date', 'date', rx.date || today(), 'date', 'required')}
      ${field('Doctor', 'doctor', rx.doctor || appState.settings.dentistName, 'text', 'required')}
      ${field('Medicine', 'medicine', first.medicine, 'text', 'required placeholder="Medicine name"')}
      ${field('Strength', 'strength', first.strength, 'text', 'placeholder="e.g. 500 mg"')}
      ${field('Dosage', 'dosage', first.dosage, 'text', 'placeholder="e.g. 1 tablet"')}
      ${field('Frequency', 'frequency', first.frequency, 'text', 'placeholder="e.g. Twice daily"')}
      ${field('Duration', 'duration', first.duration, 'text', 'placeholder="e.g. 5 days"')}
      ${field('Route', 'route', first.route || 'Oral')}
      ${field('Instructions', 'instructions', first.instructions, 'textarea', 'rows="3" placeholder="How and when to take this medicine"')}
    </div>
    <div class="medication-tools form-full"><button type="button" class="text-button" data-action="save-medication-template">${icon('plus', 14)} Save current medicine to catalog</button><small class="field-hint">Saved locally for repeat prescriptions; it never makes a clinical recommendation.</small></div>
    <label class="field-label form-full">Additional medicines <textarea name="medicationsText" rows="4" placeholder="One medicine per line: medicine | strength | dosage | frequency | duration | route | instructions">${attr(medicationLines)}</textarea><small class="field-hint">The first medicine above is included automatically. Add more lines for a complete prescription.</small></label>
    ${field('Prescription notes', 'notes', rx.notes, 'textarea', 'rows="2"')}
    <div class="form-note">${icon('shield', 14)} The medicine and instructions reflect the prescriber’s input. Dentiva Pro does not generate medical recommendations.</div>
    ${modalFooter('Cancel', editing ? 'Save prescription' : 'Create prescription')}
  </form>`;
}

/* ----------------------------- dental tooth ----------------------------- */
function modalDentalTooth(data = {}) {
  const record = data.record || {};
  return `${modalHead('DENTAL CHART', `Tooth ${data.tooth} (${data.dentition || 'adult'})`, 'Status, procedure and notes — previous records stay in history.')}
    <div class="form-grid">
      <div class="tooth-status-row">${['', 'Missing', 'Caries', 'Restored', 'Crown', 'Root canal', 'Extracted', 'Implant'].map((status) => `<button type="button" class="chip-button ${record.status === status ? 'selected' : ''}" data-action="set-tooth-status" data-status="${attr(status)}">${esc(status || 'Clear')}</button>`).join('')}</div>
      <label class="field-label">Procedure<textarea name="dental-procedure" rows="1" placeholder="e.g. Composite restoration">${attr(record.procedure || data.procedure || '')}</textarea></label>
      <label class="field-label">Chart note<textarea name="dental-note" rows="3" placeholder="Clinical note for this tooth">${attr(record.note || data.note || '')}</textarea></label>
    </div>
    <div class="modal-footer"><button class="btn btn-link" data-action="remove-tooth">Clear record</button><button class="btn btn-primary" data-action="save-tooth">${icon('check', 16)}<span>Save chart note</span></button></div>`;
}

/* ------------------------------ invoice ------------------------------ */
function invoiceTotals(data) {
  const items = (Array.isArray(data.items) ? data.items : []).map((item) => ({ quantity: Number(item.quantity) || 1, unitPrice: Number(item.unitPrice) || 0, total: (Number(item.quantity) || 1) * (Number(item.unitPrice) || 0) })).filter((item) => item.total > 0);
  const subtotal = items.reduce((sum, item) => sum + item.total, 0);
  return calculateInvoice({ quantity: 1, unitPrice: subtotal, discount: data.discount || 0, taxRate: data.taxRate || 0 });
}
function modalInvoice(data = {}) {
  const inv = data.invoice || {};
  const editing = Boolean(inv.id);
  const items = inv.items || [];
  return `<form data-form="invoice"><input type="hidden" name="id" value="${attr(inv.id || '')}">${modalHead('INVOICE', editing ? `Edit invoice ${inv.invoiceNumber || ''}` : 'New invoice', 'Line items with catalog defaults; totals are exact to the taka.')}
    <div class="form-grid two">
      ${selectField('Patient', 'patientId', patientOptions(inv.patientId || ui.patientId), inv.patientId || ui.patientId, 'required')}
      ${field('Date', 'date', inv.date || today(), 'date', 'required')}
      ${selectField('Dentist', 'dentistId', dentistOptions(inv.dentistId), inv.dentistId)}
      <label class="field-label">Treatment<select name="treatmentId" data-change="invoice-treatment">${treatmentOptions(inv.treatmentId)}</select></label>
    </div>
    <div class="invoice-lines">${items.map((item, index) => `<div class="invoice-line"><input type="text" name="items[${index}][name]" value="${attr(item.name)}" placeholder="Item / treatment" required><input type="number" name="items[${index}][quantity]" value="${attr(item.quantity || 1)}" min="1" step="1" aria-label="Quantity"><input type="number" name="items[${index}][unitPrice]" value="${attr(item.unitPrice || '')}" min="0" step="0.01" aria-label="Unit price"><button type="button" class="icon-button" data-action="remove-invoice-line" data-index="${index}" aria-label="Remove line">${icon('trash', 15)}</button></div>`).join('')}
      <button type="button" class="btn btn-secondary" data-action="add-invoice-line">${icon('plus', 15)}<span>Add line</span></button></div>
    <div class="invoice-totals">
      ${field('Discount', 'discount', inv.discount || 0, 'number', 'min="0" step="0.01"')}
      <label class="check-label"><input type="checkbox" name="taxEnabled" ${appState.settings.taxEnabled ? 'checked' : ''}> Apply tax</label>
      ${field('Tax rate (%)', 'taxRate', inv.taxRate ?? (appState.settings.taxEnabled ? appState.settings.taxRate || 0 : 0), 'number', 'min="0" max="100" step="0.01"')}
      <div class="totals-summary"><small>Subtotal</small><strong id="invoice-subtotal">—</strong><small>Discount</small><strong id="invoice-discount">—</strong><small>Tax</small><strong id="invoice-tax">—</strong><small>Total</small><strong class="total-main" id="invoice-total">—</strong></div>
    </div>
    ${field('Notes', 'notes', inv.notes, 'textarea', 'rows="2"')}
    ${editing && Number(inv.paidCents ?? inv.paid ?? 0) > 0 ? `<div class="form-note warning-note">Payments exist on this invoice — pricing is locked. Only notes and status can change.</div>` : ''}
    ${modalFooter('Cancel', editing ? 'Save invoice' : 'Create invoice')}
  </form>`;
}
function modalInvoiceDetail(data = {}) {
  const inv = data.invoice || {};
  const payments = data.payments || [];
  const adjustments = data.adjustments || [];
  return `${modalHead('INVOICE', `${inv.invoiceNumber || ''} · ${patientName(inv.patientId)}`, `${dateFull(inv.date)} · ${statusBadge(inv.status)}`)}
    <div class="invoice-detail-grid">
      <div class="detail-list">
        <div><dt>Total</dt><dd><strong>${currency(centsToMoney(inv.totalCents ?? inv.total))}</strong></dd></div>
        <div><dt>Paid (net)</dt><dd><strong>${currency(centsToMoney(data.netPaidCents ?? 0))}</strong></dd></div>
        <div><dt>Refunded</dt><dd>${currency(data.refundedCents ?? 0)}</dd></div>
        <div><dt>Adjusted</dt><dd>${currency(data.adjustedCents ?? 0)}</dd></div>
        <div><dt>Due</dt><dd><strong class="${(data.dueCents ?? 0) > 0 ? 'text-warning' : ''}">${currency(data.dueCents ?? 0)}</strong></dd></div>
      </div>
      <div>
        <h3 class="section-sub">Payments</h3>
        ${payments.map((payment) => `<div class="record-row"><div><strong>${esc(payment.receiptNumber || '—')} · ${money(payment)}</strong><small>${date(payment.date)} · ${esc(payment.method || '—')}</small></div><div class="row-actions">${statusBadge(payment.status || 'Recorded')}${can('payments.refund') ? button('Refund', 'open-refund', 'undo', 'link', `data-id="${attr(payment.id)}"`) : ''}</div></div>`).join('') || '<p class="muted">No payments.</p>'}
        <h3 class="section-sub">Adjustments & refunds</h3>
        ${adjustments.map((adjustment) => `<div class="record-row"><div><strong>${esc(adjustment.type)} · ${money(adjustment)}</strong><small>${date(adjustment.date)} · ${esc(adjustment.reason || '')}</small></div></div>`).join('') || '<p class="muted">None recorded.</p>'}
      </div>
    </div>
    <div class="modal-footer"><button class="btn btn-link" data-action="print-invoice" data-id="${attr(inv.id)}">${icon('printer', 15)}<span>Print invoice</span></button>${can('payments.adjust') ? `<button class="btn btn-secondary" data-action="open-adjustment" data-id="${attr(inv.id)}">${icon('swap', 15)}<span>Adjust balance</span></button>` : ''}${can('billing.void') && inv.status !== 'Cancelled' ? `<button class="btn btn-link danger" data-action="void-invoice" data-id="${attr(inv.id)}">${icon('trash', 15)}<span>Void invoice</span></button>` : ''}<button class="btn btn-primary" data-action="close-modal">Done</button></div>`;
}

/* ------------------------------ payment ------------------------------ */
function modalPayment(data = {}) {
  const p = data.payment || {};
  const inv = data.invoice || (data.invoiceId ? null : {});
  return `<form data-form="payment"><input type="hidden" name="invoiceId" value="${attr(p.invoiceId || data.invoiceId || '')}">${modalHead('PAYMENT', 'Record payment', 'Overpayment is blocked; the receipt number stays sequential.')}
    <div class="form-grid two">
      ${selectField('Patient', 'patientId', patientOptions(p.patientId || ui.patientId), p.patientId || ui.patientId, 'required')}
      ${selectField('Invoice (optional)', 'invoiceId', [['', 'Standalone payment'], ...((ui.invoiceOptions || []).map((i) => [i.id, `${i.invoiceNumber} · due ${currency(centsToMoney(i.dueCents ?? i.due))}`]))], p.invoiceId || data.invoiceId || '')}
      ${field('Date', 'date', p.date || today(), 'date', 'required')}
      ${selectField('Method', 'method', paymentMethodOptions(), p.method || 'Cash', 'required')}
      ${field('Amount', 'amount', p.amount || '', 'number', 'min="0.01" step="0.01" required')}
      ${field('Reference', 'reference', p.reference, 'text', 'placeholder="Transaction / cheque no."')}
      ${field('Notes', 'notes', p.notes, 'textarea', 'rows="2"')}
    </div>
    ${inv ? `<div class="form-note">Invoice ${esc(inv.invoiceNumber || '')} — total ${currency(centsToMoney(inv.totalCents ?? inv.total))}, due ${currency(centsToMoney(inv.dueCents ?? inv.due))}.</div>` : ''}
    ${modalFooter('Cancel', 'Record payment')}
  </form>`;
}
function paymentMethodOptions() {
  const methods = [...new Set(['Cash', 'Bank', 'Card', ...(appState.settings.paymentMethods || [])].map((method) => String(method).trim()).filter(Boolean))];
  return methods.map((method) => [method, method]);
}
function modalRefund(data = {}) {
  const p = data.payment || {};
  const remaining = Math.max(0, numeric(p.amount) - numeric(p.refundedAmount));
  return `<form data-form="refund"><input type="hidden" name="paymentId" value="${attr(p.id || '')}">${modalHead('REFUND', `Refund payment ${p.receiptNumber || ''}`, 'The original payment is never mutated; a Refund entry keeps the trail exact.')}
    <div class="form-grid">
      ${field('Amount', 'amount', Math.min(remaining, numeric(p.amount)) || '', 'number', 'min="0.01" step="0.01" required')}
      ${field('Date', 'date', today(), 'date', 'required')}
      ${field('Reason', 'reason', '', 'text', 'required placeholder="Why is money going back?"')}
    </div>
    <p class="form-note">Remaining refundable: ${currency(remaining)}. A full refund reopens the invoice balance.</p>
    ${modalFooter('Cancel', 'Record refund')}
  </form>`;
}
function modalAdjustment(data = {}) {
  const inv = data.invoice || {};
  return `<form data-form="adjustment"><input type="hidden" name="invoiceId" value="${attr(inv.id || '')}">${modalHead('ADJUSTMENT', `Adjust ${inv.invoiceNumber || 'invoice balance'}`, 'Reduce the outstanding amount for a documented reason (waiver, correction). Capped at the current due.')}
    <div class="form-grid">
      ${field('Amount', 'amount', '', 'number', 'min="0.01" step="0.01" required')}
      ${field('Reason', 'reason', '', 'text', 'required placeholder="e.g. Patient hardship — waived"')}
    </div>
    <p class="form-note">Current due: ${currency(centsToMoney(inv.dueCents ?? inv.due))}.</p>
    ${modalFooter('Cancel', 'Apply adjustment')}
  </form>`;
}

/* ------------------------------ expense ------------------------------ */
function modalExpense(data = {}) {
  const e = data.expense || {};
  const editing = Boolean(e.id);
  const categories = [...new Set([...(appState.settings.expenseCategories || []), 'Rent', 'Utilities', 'Supplies', 'Internet', 'Other'])];
  return `<form data-form="expense"><input type="hidden" name="id" value="${attr(e.id || '')}">${modalHead('EXPENSE', editing ? 'Edit expense' : 'Record expense', 'Keep operating costs separate from patient billing.')}
    <div class="form-grid two">
      ${field('Description', 'description', e.description, 'text', 'required placeholder="e.g. Monthly clinic rent"')}
      ${field('Amount', 'amount', e.amount || '', 'number', 'min="0.01" step="0.01" required')}
      ${field('Date', 'date', e.date || today(), 'date', 'required')}
      ${selectField('Category', 'category', categories.map((category) => [category, category]), e.category || 'Other')}
      ${selectField('Method', 'method', [['Cash', 'Cash'], ['Bank', 'Bank'], ['Card', 'Card'], ['Other', 'Other']], e.method || 'Cash')}
      ${field('Reference', 'reference', e.reference)}
      ${field('Notes', 'notes', e.notes, 'textarea', 'rows="2"')}
    </div>
    ${modalFooter('Cancel', editing ? 'Save expense' : 'Record expense')}
  </form>`;
}

/* ------------------------------ inventory ------------------------------ */
function modalStock(data = {}) {
  const item = data.item || {};
  const editing = Boolean(item.id);
  const categories = [...new Set([...(appState.settings.inventoryCategories || []), 'Consumable', 'Material', 'Equipment', 'Chemical', 'Other'])];
  return `<form data-form="stock"><input type="hidden" name="id" value="${attr(item.id || '')}">${modalHead('STOCK ITEM', editing ? 'Edit stock item' : 'Add stock item', 'Opening stock is recorded as a purchase movement. Stock changes only through movements.')}
    <div class="form-grid two">
      ${field('Item name', 'name', item.name, 'text', 'required')}
      <div class="field-split">${selectField('Category', 'category', categories.map((c) => [c, c]), item.category || 'Other')}${field('Unit', 'unit', item.unit || 'pcs')}</div>
      ${selectField('Supplier', 'supplierId', [['', 'No supplier'], ...((ui.supplierOptions || []).map((supplier) => [supplier.id, supplier.name]))], item.supplierId)}
      ${field('Brand', 'brand', item.brand)}
      ${field('Batch / lot', 'batch', item.batch)}
      ${field('Purchase price', 'purchasePrice', item.purchasePrice || '', 'number', 'min="0" step="0.01"')}
      ${field('Sale price', 'salePrice', item.salePrice || '', 'number', 'min="0" step="0.01"')}
      ${field('Minimum stock', 'minimumStock', item.minimumStock || '', 'number', 'min="0"')}
      ${field('Expiry date', 'expiryDate', item.expiryDate, 'date')}
      ${field('Location', 'location', item.location)}
      ${field('Opening stock', 'openingStock', item.currentStock || '', 'number', 'min="0" step="0.01', 'disabled="', item.id ? 'disabled' : '')}
      ${field('Notes', 'notes', item.notes, 'textarea', 'rows="2"')}
    </div>
    ${modalFooter('Cancel', editing ? 'Save item' : 'Add stock')}
  </form>`;
}
function modalStockAdjustment(data = {}) {
  const item = data.item || {};
  return `<form data-form="stock-adjustment"><input type="hidden" name="itemId" value="${attr(item.id || '')}">${modalHead('INVENTORY MOVEMENT', `Move stock — ${item.name || ''}`, 'Purchases, usage, expiry and corrections remain visible in the movement ledger.')}
    <div class="form-grid two">
      ${selectField('Movement type', 'movementType', [['Purchase', 'Purchase / received'], ['Usage', 'Usage / issued'], ['Return', 'Return to stock'], ['Expiry', 'Expired / quarantined'], ['Damage', 'Damaged / lost'], ['Correction', 'Correction'], ['Adjustment', 'Inventory correction']], data.movementType || 'Usage')}
      ${field('Quantity', 'quantity', '', 'number', 'min="0.01" step="0.01" required')}
      ${selectField('Correction direction', 'direction', [['decrease', 'Decrease'], ['increase', 'Increase']], data.direction || 'decrease')}
      ${field('Date', 'date', today(), 'date', 'required')}
      ${field('Reason / note', 'reason', '', 'textarea', 'rows="2" required placeholder="Why did this movement occur?"')}
    </div>
    <p class="form-note">Current on hand: ${number(item.currentStock || 0)} ${esc(item.unit || '')}. A movement can never make stock negative.</p>
    ${modalFooter('Cancel', 'Record movement')}
  </form>`;
}
function modalSupplier(data = {}) {
  const s = data.supplier || {};
  const editing = Boolean(s.id);
  return `<form data-form="supplier"><input type="hidden" name="id" value="${attr(s.id || '')}">${modalHead(editing ? 'SUPPLIER' : 'NEW SUPPLIER', editing ? 'Edit supplier' : 'Add a supplier', 'Keep purchasing contacts connected to inventory.')}
    <div class="form-grid two">
      ${field('Supplier name', 'name', s.name, 'text', 'required')}
      ${field('Contact person', 'contactPerson', s.contactPerson)}
      ${field('Phone', 'phone', s.phone, 'tel')}
      ${field('Email', 'email', s.email, 'email')}
      ${field('Address', 'address', s.address, 'textarea', 'rows="2"')}
      ${field('Notes', 'notes', s.notes, 'textarea', 'rows="2"')}
    </div>
    ${modalFooter('Cancel', editing ? 'Save supplier' : 'Add supplier')}
  </form>`;
}
function modalStaff(data = {}) {
  const s = data.staff || {};
  const editing = Boolean(s.id);
  return `<form data-form="staff"><input type="hidden" name="id" value="${attr(s.id || '')}">${modalHead(editing ? 'STAFF MEMBER' : 'NEW STAFF MEMBER', editing ? 'Edit staff member' : 'Add staff member', 'Roles keep the access architecture clear as the practice grows.')}
    <div class="form-grid two">
      ${field('Full name', 'name', s.name, 'text', 'required')}
      ${selectField('Role', 'role', [['Dentist', 'Dentist'], ['Dental Assistant', 'Dental Assistant'], ['Receptionist', 'Receptionist'], ['Manager', 'Manager'], ['Cleaner', 'Cleaner'], ['Other', 'Other']], s.role || 'Receptionist')}
      ${field('Phone', 'phone', s.phone, 'tel')}
      ${field('Email', 'email', s.email, 'email')}
      ${field('Specialization', 'specialization', s.specialization)}
      ${field('Joining date', 'joinDate', s.joinDate || s.joiningDate || today(), 'date')}
      ${field('Notes', 'notes', s.notes, 'textarea', 'rows="2"')}
    </div>
    ${modalFooter('Cancel', editing ? 'Save staff member' : 'Add staff member')}
  </form>`;
}
function modalTreatment(data = {}) {
  const t = data.treatment || {};
  const editing = Boolean(t.id);
  return `<form data-form="treatment"><input type="hidden" name="id" value="${attr(t.id || '')}">${modalHead(editing ? 'TREATMENT CATALOG' : 'NEW TREATMENT', editing ? 'Edit treatment' : 'Add a treatment', 'Catalog defaults help the team stay consistent; each invoice remains reviewable.')}
    <div class="form-grid two">
      ${field('Treatment name', 'name', t.name, 'text', 'required placeholder="e.g. Composite restoration"')}
      ${field('Code', 'code', t.code, 'text', 'placeholder="e.g. REST-C"')}
      ${field('Category', 'category', t.category || 'General')}
      ${field('Default price', 'defaultPrice', t.defaultPrice || '', 'number', 'min="0" step="0.01"')}
      ${field('Duration (minutes)', 'duration', t.duration || 30, 'number', 'min="5" step="5"')}
      ${selectField('Tooth required', 'toothRequired', [['false', 'No'], ['true', 'Yes']], String(t.toothRequired || false))}
      ${field('Description', 'description', t.description, 'textarea', 'rows="3"')}
      ${selectField('Status', 'active', [['true', 'Active'], ['false', 'Inactive']], String(t.active !== false))}
    </div>
    ${modalFooter('Cancel', editing ? 'Save treatment' : 'Add treatment')}
  </form>`;
}
function modalTreatmentPlan(data = {}) {
  const plan = data.plan || {};
  const editing = Boolean(plan.id);
  const stages = plan.stages || [];
  return `<form data-form="treatment-plan"><input type="hidden" name="id" value="${attr(plan.id || '')}">${modalHead(editing ? 'TREATMENT PLAN' : 'NEW TREATMENT PLAN', editing ? 'Edit treatment plan' : 'Create a treatment plan', 'Treatment plan is clinician-authored; stages can be converted to a visit explicitly.')}
    <div class="form-grid two">
      ${selectField('Patient', 'patientId', patientOptions(plan.patientId || ui.patientId), plan.patientId || ui.patientId, 'required')}
      ${field('Plan title', 'title', plan.title, 'text', 'required')}
      ${field('Clinical goal', 'goal', plan.goal, 'textarea', 'rows="2"')}
      ${selectField('Plan status', 'status', [['Draft', 'Draft'], ['In Progress', 'In Progress'], ['Completed', 'Completed'], ['Cancelled', 'Cancelled']], plan.status || 'Draft')}
      ${field('Start date', 'startDate', plan.startDate, 'date')}
      ${field('Review date', 'reviewDate', plan.reviewDate, 'date')}
      ${selectField('Dentist', 'dentistId', dentistOptions(plan.dentistId), plan.dentistId)}
      ${field('Estimated duration (minutes)', 'estimatedDuration', plan.estimatedDuration || '', 'number', 'min="0" step="5"')}
      ${field('Estimated cost', 'estimatedCost', plan.estimatedCost || '', 'number', 'min="0" step="0.01"')}
      ${field('Discount', 'discount', plan.discount || 0, 'number', 'min="0" step="0.01"')}
      ${field('Procedures', 'procedures', plan.procedures, 'textarea', 'rows="2"')}
      ${field('Tooth number(s)', 'teeth', plan.teeth)}
      ${field('Notes', 'notes', plan.notes, 'textarea', 'rows="2"')}
    </div>
    <h3 class="section-sub">Stages</h3>
    <div class="plan-stages">${stages.map((stage, index) => `<div class="plan-stage-row"><input type="text" name="stages[${index}][title]" value="${attr(stage.title)}" placeholder="Stage name" required><input type="date" name="stages[${index}][plannedDate]" value="${attr(stage.plannedDate || '')}"><input type="number" name="stages[${index}][estimatedCost]" value="${attr(stage.estimatedCost || '')}" min="0" step="0.01" placeholder="Cost"><button type="button" class="icon-button" data-action="remove-plan-stage" data-index="${index}" aria-label="Remove stage">${icon('trash', 15)}</button></div>`).join('')}
      <button type="button" class="btn btn-secondary" data-action="add-plan-stage">${icon('plus', 15)}<span>Add stage</span></button></div>
    ${modalFooter('Cancel', editing ? 'Save plan' : 'Create plan')}
  </form>`;
}
function modalReferral(data = {}) {
  const r = data.referral || {};
  const editing = Boolean(r.id);
  return `<form data-form="referral"><input type="hidden" name="id" value="${attr(r.id || '')}">${modalHead(editing ? 'REFERRAL' : 'NEW REFERRAL', editing ? 'Edit referral' : 'Record a referral', 'Keep the reason, destination and response connected to the patient record.')}
    <div class="form-grid two">
      ${selectField('Patient', 'patientId', patientOptions(r.patientId || ui.patientId), r.patientId || ui.patientId, 'required')}
      ${field('Referral date', 'date', r.date || today(), 'date', 'required')}
      ${field('Referred to', 'referralTo', r.referralTo, 'text', 'required placeholder="Doctor, specialist or organisation"')}
      ${field('Specialty', 'specialty', r.specialty)}
      ${field('Reason', 'reason', r.reason, 'textarea', 'rows="3" required')}
      ${field('Response / report', 'response', r.response, 'textarea', 'rows="3"')}
      ${selectField('Status', 'status', [['Sent', 'Sent'], ['Acknowledged', 'Acknowledged'], ['Report received', 'Report received'], ['Closed', 'Closed'], ['Cancelled', 'Cancelled']], r.status || 'Sent')}
    </div>
    ${modalFooter('Cancel', editing ? 'Save referral' : 'Create referral')}
  </form>`;
}
function modalFollowup(data = {}) {
  const task = data.task || {};
  const editing = Boolean(task.id);
  return `<form data-form="followup"><input type="hidden" name="id" value="${attr(task.id || '')}">${modalHead('FOLLOW-UP', editing ? 'Edit follow-up' : 'Schedule follow-up', 'A due follow-up date becomes an actionable task on the dashboard.')}
    <div class="form-grid two">
      ${selectField('Patient', 'patientId', patientOptions(task.patientId || ui.patientId), task.patientId || ui.patientId, 'required')}
      ${field('Title', 'title', task.title, 'text')}
      ${field('Reason', 'reason', task.reason, 'text')}
      ${field('Due date', 'dueDate', task.dueDate || today(), 'date', 'required')}
      ${selectField('Status', 'status', [['Open', 'Open'], ['Contacted', 'Contacted'], ['Scheduled', 'Scheduled'], ['Completed', 'Completed'], ['Cancelled', 'Cancelled']], task.status || 'Open')}
      ${field('Notes', 'notes', task.notes, 'textarea', 'rows="2"')}
    </div>
    ${modalFooter('Cancel', editing ? 'Save follow-up' : 'Schedule follow-up')}
  </form>`;
}
function modalAttachment(data = {}) {
  const p = data.patient || {};
  return `<form data-form="attachment"><input type="hidden" name="patientId" value="${attr(p.id || ui.patientId || '')}">${modalHead('ATTACH FILE', 'Attach to patient record', 'Images, PDFs and clinical documents. Executables and scripts are blocked for safety.')}
    <div class="form-grid">
      <label class="file-drop" data-action="pick-attachment"><input type="file" name="file" accept="image/*,application/pdf,.doc,.docx,.txt" hidden><span class="file-drop-inner">${icon('upload', 22)}<strong>${esc(data.fileName || 'Choose a file…')}</strong><small>Click to browse — stored locally with a checksum</small></span></label>
      ${field('Attachment name', 'name', data.name || '', 'text', 'required')}
      ${selectField('Category', 'category', [['Image / X-ray', 'Image / X-ray'], ['PDF report', 'PDF report'], ['Clinical document', 'Clinical document']], data.category || '')}
      ${field('Notes', 'notes', '', 'textarea', 'rows="2"')}
    </div>
    <p class="form-note">${icon('shield', 14)} PDF active content is never embedded — previews are inert images of the first page.</p>
    ${modalFooter('Cancel', 'Attach file')}
  </form>`;
}
function modalAttachmentPreview(data = {}) {
  const attachment = data.attachment || {};
  return `${modalHead('ATTACHMENT', attachment.name || 'Attachment', `${attachment.type || ''} · ${formatBytes(attachment.size || 0)}`)}
    <div class="attachment-preview-body">${data.previewHtml || '<p class="muted">Loading preview…</p>'}</div>
    <div class="modal-footer"><button class="btn btn-link" data-action="download-attachment" data-id="${attr(attachment.id)}">${icon('download', 15)}<span>Download original</span></button>${can('attachments.delete') ? `<button class="btn btn-link danger" data-action="delete-attachment" data-id="${attr(attachment.id)}">${icon('trash', 15)}<span>Remove</span></button>` : ''}<button class="btn btn-primary" data-action="close-modal">Done</button></div>`;
}
function modalUserAccount(data = {}) {
  const user = data.user || {};
  const editing = Boolean(user.id);
  const selected = new Set(editing ? effectivePermissions(user) : permissionsForRole(user.role || 'Receptionist', []));
  return `<form data-form="user-account"><input type="hidden" name="id" value="${attr(user.id || '')}">${modalHead(editing ? 'LOCAL USER ACCOUNT' : 'NEW LOCAL USER', editing ? 'Edit account access' : 'Create a secure user account', 'PINs are protected with PBKDF2 hashing. Staff association and account status remain auditable.')}
    <div class="form-grid two">
      ${field('Full name', 'name', user.name, 'text', 'required')}
      ${selectField('Role template', 'role', USER_ROLE_OPTIONS, user.role || 'Receptionist', 'required data-change="user-role"')}
      ${selectField('Associated staff member', 'staffId', [['', 'No staff link'], ...appState.directory.staff.map((s) => [s.id, `${s.name} · ${s.role || 'Staff'}`])], user.staffId)}
      ${selectField('Account status', 'active', [['true', 'Active'], ['false', 'Inactive']], String(user.active !== false))}
      ${field(editing ? 'New PIN (leave blank to keep current)' : 'PIN', 'pin', '', 'password', `${editing ? '' : 'required '}minlength="4" maxlength="12" inputmode="numeric" pattern="[0-9]{4,12}" autocomplete="new-password" placeholder="4–12 digits"`)}
      ${field('Confirm PIN', 'confirmPin', '', 'password', `${editing ? '' : 'required '}minlength="4" maxlength="12" inputmode="numeric" pattern="[0-9]{4,12}" autocomplete="new-password" placeholder="Repeat the PIN"`)}
    </div>
    <fieldset class="permission-fieldset"><legend>Effective permissions</legend>
      <p class="form-note">Role templates are a starting point. Custom Role can be narrowed or expanded explicitly.</p>
      <div class="permission-grid">${permissionGroups.length ? permissionGroupsHtml(selected) : ''}</div>
    </fieldset>
    ${modalFooter('Cancel', editing ? 'Save account' : 'Create account')}
  </form>`;
}
function modalSecurity(data = {}) {
  return `<form data-form="security">${modalHead('PRIVACY & SECURITY', 'Change my PIN', 'The PIN is hashed locally with PBKDF2 and never stored as readable text.')}
    <div class="security-modal-icon">${icon('lock', 26)}</div>
    <div class="form-grid">
      ${field('New PIN', 'pin', '', 'password', 'required minlength=4 maxlength=12 inputmode="numeric" pattern="[0-9]{4,12}" autocomplete="new-password" placeholder="4–12 digits"')}
      ${field('Confirm PIN', 'confirmPin', '', 'password', 'required minlength=4 maxlength=12 inputmode="numeric" pattern="[0-9]{4,12}" autocomplete="new-password" placeholder="Enter the PIN again"')}
    </div>
    <p class="form-note">${icon('shield', 14)} This PIN protects your local account. Keep a verified backup separately; a forgotten PIN cannot be recovered.</p>
    ${modalFooter('Cancel', 'Update PIN')}
  </form>`;
}
function modalCsvImport(data = {}) {
  const importState = ui.csvImport;
  const headers = importState?.headers || [];
  const fields = ['fullName', 'phone', 'email', 'dateOfBirth', 'gender', 'address', 'allergies', 'notes'];
  return `${modalHead('IMPORT', 'Import patients from CSV', 'Map the columns. Duplicates (name + phone) are skipped unless you create copies.')}
    <div class="form-grid">
      <div class="csv-file-row">${importState?.fileName ? `<span class="file-chip">${icon('file', 15)}${esc(importState.fileName)} · ${number(importState.rows.length)} rows</span>` : `<label class="file-drop small" data-action="pick-csv"><input type="file" accept=".csv,text/csv" hidden><span>${icon('upload', 18)}<strong>Choose a CSV file</strong></span></label>`}</div>
      ${importState ? `<div class="csv-mapping">${fields.map((field) => `<label class="field-label">Map ${esc(field)}<select name="map-${attr(field)}">${['', 'Choose column...'].map((v) => `<option value="${v}"></option>`).join('')}${headers.map((header, index) => `<option value="${index}" ${(importState.mapping[field] === index ? 'selected' : '')}>${esc(header)}</option>`).join('')}</select></label>`).join('')}</div>
      <div class="restore-strategy"><span class="eyebrow">DUPLICATE STRATEGY</span><label class="radio-option"><input type="radio" name="csv-strategy" value="Skip" checked><span>Skip duplicates</span></label><label class="radio-option"><input type="radio" name="csv-strategy" value="Create New Copy"><span>Create New Copy</span></label></div>` : ''}
    </div>
    ${importState ? modalFooter('Cancel', 'Import patients', 'import-csv') : `<div class="modal-footer"><button class="btn btn-link" data-action="close-modal">Close</button></div>`}`;
}
function modalSearch(data = {}) {
  return `${modalHead('COMMANDS', 'Open quick search', 'Type to search patients, appointments and records.')}
    <input type="search" class="command-input" name="command" placeholder="Search your workspace" value="${attr(data.query || '')}" data-input="command-search" autofocus>
    <div class="command-results" id="command-results">${data.results || ''}</div>`;
}
function modalSavedFilters(data = {}) {
  return `${modalHead('SAVED VIEWS', 'Patient views', 'Keep the current search and patient filters available for the next visit.')}
    <div class="form-grid"><label class="field-label">View name<input type="text" name="filterName" value="${attr(data.name || '')}" placeholder="e.g. Follow-up due" required></label></div>
    <div class="modal-footer"><button class="btn btn-link" data-action="close-modal">Cancel</button><button class="btn btn-primary" data-action="save-filter" data-collection="${attr(data.collection || 'patients')}">${icon('check', 16)}<span>Save this patient view</span></button></div>`;
}
function modalDashboardCustomizer(data = {}) {
  const widgets = [['schedule', 'Today’s schedule', 'Your upcoming appointments and chair flow.'], ['queue', 'Today’s queue', 'Checked-in, waiting and completed patient counts.'], ['followups', 'Follow-ups due', 'Clinical follow-up dates that need attention.'], ['signals', 'Operational signals', 'Outstanding balances, low stock and backup health.']];
  const layout = data.layout || ['schedule', 'queue', 'followups', 'signals'];
  return `${modalHead('DASHBOARD', 'Customize your command centre', 'Keep the signals your team needs in view. Changes are saved locally per practice workspace.')}
    <div class="dashboard-widget-options">${widgets.map(([key, title, description]) => { const enabled = layout.includes(key); const position = layout.indexOf(key); return `<div class="dashboard-widget-option ${enabled ? 'selected' : ''}"><button class="widget-toggle" data-action="toggle-dashboard-widget" data-widget="${key}" aria-pressed="${enabled}"><span class="widget-check">${icon(enabled ? 'check' : 'plus', 15)}</span><span><strong>${title}</strong><small>${description}</small></span></button>${enabled ? `<span class="widget-order" aria-label="Dashboard card order"><button class="icon-button tiny" data-action="move-dashboard-widget" data-widget="${key}" data-direction="up" ${position === 0 ? 'disabled' : ''} aria-label="Move ${title} up">${icon('up', 14)}</button><button class="icon-button tiny" data-action="move-dashboard-widget" data-widget="${key}" data-direction="down" ${position === layout.length - 1 ? 'disabled' : ''} aria-label="Move ${title} down">${icon('down', 14)}</button></span>` : ''}</div>`; }).join('')}</div>
    <p class="form-note">The metric strip and shortcut actions are always visible. Keep at least one operational card enabled. Use the arrows to reorder enabled cards.</p>
    <div class="modal-footer"><button class="btn btn-link" data-action="reset-dashboard-widgets">Reset layout</button><button class="btn btn-primary" data-action="close-modal">Done</button></div>`;
}
function modalNotifications(data = {}) {
  const notes = notificationItems().slice(0, 12);
  return `${modalHead('NOTIFICATIONS', 'Notification centre', notes.length ? 'Meaningful signals from your workspace.' : 'Your workspace is quiet.')}
    <div class="notification-list">${notes.length ? notes.map((n) => `<button class="notification-row ${n.read ? '' : 'unread'}" data-action="notification-open" data-id="${attr(n.id)}"><span class="notification-icon">${icon(n.type === 'warning' ? 'warning' : n.type === 'backup' ? 'backup' : 'bell', 16)}</span><span><strong>${esc(n.title)}</strong><p>${esc(n.message)}</p><small>${date(n.date || today())} · Open ${esc(n.page || 'workspace')}</small></span>${icon('arrow', 14)}</button>`).join('') : emptyState('bell', 'No notifications', 'Appointment, follow-up, stock and backup signals will appear here.')}
    </div>
    <div class="modal-footer"><button class="btn btn-link" data-action="mark-notifications-read">Mark all as read</button><button class="btn btn-primary" data-action="close-modal">Done</button></div>`;
}

/* ------------------------------------------------------------------ */
/* Commands                                                            */
/* ------------------------------------------------------------------ */
const COMMANDS = [
  { id: 'new-patient', label: 'New patient', run: () => openModal('patient') },
  { id: 'new-appointment', label: 'Book appointment', run: () => openModal('appointment') },
  { id: 'new-visit', label: 'Record visit', run: () => openModal('visit') },
  { id: 'new-invoice', label: 'New invoice', run: () => openModal('invoice') },
  { id: 'new-payment', label: 'Record payment', run: () => openModal('payment') },
  { id: 'new-stock', label: 'Add stock item', run: () => openModal('stock') },
  { id: 'open-reports', label: 'Open reports', run: () => { ui.page = 'reports'; render(); } },
  { id: 'open-analytics', label: 'Open analytics', run: () => { ui.page = 'analytics'; render(); } },
  { id: 'open-backup', label: 'Open backup & restore', run: () => { ui.page = 'backup'; render(); } },
  { id: 'open-settings', label: 'Open settings', run: () => { ui.page = 'settings'; render(); } },
  { id: 'run-integrity', label: 'Run integrity check', run: () => runIntegrityCheck() }
];
async function runCommand(command) {
  command.run();
  notify(`${command.label} executed.`, 'info');
}
async function globalSearch(qText) {
  if (!qText || qText.length < 2) return { patients: [], appointments: [], invoices: [] };
  const [patients, appointments, invoices] = await Promise.all([
    q('list', { collection: 'patients', query: qText, page: 1, pageSize: 5 }).catch(() => ({ rows: [] })),
    q('list', { collection: 'appointments', query: qText, page: 1, pageSize: 5 }).catch(() => ({ rows: [] })),
    q('list', { collection: 'invoices', query: qText, page: 1, pageSize: 5 }).catch(() => ({ rows: [] }))
  ]);
  return {
    patients: (patients.rows || []).map((p) => ({ id: p.id, label: `${p.patientCode || ''} · ${p.fullName}`, sub: p.phone || '' })),
    appointments: (appointments.rows || []).map((a) => ({ id: a.id, label: `${a.date} ${a.time} · ${patientName(a.patientId)}`, sub: a.reason || '' })),
    invoices: (invoices.rows || []).map((i) => ({ id: i.id, label: `${i.invoiceNumber} · ${patientName(i.patientId)}`, sub: currency(centsToMoney(i.totalCents ?? i.total)) }))
  };
}

/* ------------------------------------------------------------------ */
/* Form submission (every mutation goes through the ops layer)         */
/* ------------------------------------------------------------------ */
function formData(event) {
  const out = Object.fromEntries(new FormData(event.target).entries());
  return out;
}
function checkFormPermission(formName, _data) {
  const permission = formPermissions[formName];
  if (!permission) return true;
  return requirePermission(permission);
}

async function handleSubmit(event) {
  event.preventDefault();
  const form = event.target;
  const formName = form.dataset.form;
  const data = formData(event);
  if (formName === 'user-login') {
    const result = await api.login(data.userId || (appState.boot?.userDirectory || [])[0]?.id || '', data.pin);
    if (result.ok) {
      appState.session = result.session;
      ui.unlockUserId = data.userId || '';
      recordActivity();
      notify(`Welcome back, ${result.session?.userName || 'doctor'}.`, 'success');
      render();
    } else notify(result.error || 'Sign-in failed.', 'error');
    return;
  }
  if (formName === 'unlock') {
    const result = await unlockWorkspace(data.pin);
    idleLastActivity = performance.now();
    if (result) render();
    return;
  }
  if (formName === 'setup') {
    await saveSetupStep(data);
    return;
  }
  if (!checkFormPermission(formName, data)) return;
  const editing = Boolean(data.id);

  if (formName === 'patient') {
    const result = await op(editing ? 'patient.update' : 'patient.create', data);
    if (result) { await refreshDirectory(); notify(editing ? 'Patient saved.' : `${result.record.fullName} added.`); ui.patientId = result.record.id; closeModal(); render(); }
    return;
  }
  if (formName === 'merge') {
    if (!window.confirm(`Move every record from the duplicate into ${patientName(data.primaryId)} and archive the duplicate? This cannot be undone without a restore.`)) return;
    const result = await op('patient.merge', { ...data, confirm: true });
    if (result) { await refreshDirectory(); notify(`Merged — ${result.moved} record(s) reassigned.`); closeModal(); render(); }
    return;
  }
  if (formName === 'appointment') {
    const payload = { ...data, duration: data.duration || undefined };
    if (editing) {
      const existing = await q('record', { collection: 'appointments', id: data.id }).then((r) => r.record);
      if (existing && (existing.date !== payload.date || existing.time !== payload.time) && payload.status === undefined) payload.status = existing.status;
    }
    const result = await op(editing ? 'appointment.update' : 'appointment.create', payload);
    if (result) { notify(editing ? 'Appointment saved.' : `Appointment booked for ${date(payload.date)} ${time(payload.time)}.`); closeModal(); render(); }
    return;
  }
  if (formName === 'visit') {
    const result = await op(editing ? 'visit.update' : 'visit.create', data);
    if (result) { notify(data.followUpDate ? 'Visit saved — follow-up task scheduled.' : 'Visit saved.'); closeModal(); render(); }
    return;
  }
  if (formName === 'prescription') {
    const payload = { ...data };
    if (payload.prescriptionTemplate) { const saved = (appState.medicationCatalog || []).find((m) => m.id === payload.prescriptionTemplate); if (saved && !payload.medicine) { payload.medicine = saved.name; payload.strength = saved.strength || ''; payload.dosage = saved.dosage || ''; payload.frequency = saved.frequency || ''; } }
    const result = await op(editing ? 'prescription.update' : 'prescription.create', payload);
    if (result) { notify('Prescription saved.'); closeModal(); render(); }
    return;
  }
  if (formName === 'invoice') {
    const items = [];
    for (let index = 0; ; index += 1) {
      const name = data[`items[${index}][name]`];
      if (name === undefined) break;
      const item = { name: String(name || '').trim(), quantity: Number(data[`items[${index}][quantity]`] || 1), unitPrice: Number(data[`items[${index}][unitPrice]`] || 0) };
      if (item.name && item.quantity > 0) items.push(item);
    }
    const payload = { ...data, items, discount: data.discount || 0, taxRate: data.taxEnabled === 'on' || data.taxEnabled === 'true' ? Number(data.taxRate || 0) : 0 };
    const result = await op(editing ? 'invoice.update' : 'invoice.create', payload);
    if (result) { await refreshDirectory(); notify(editing ? 'Invoice saved.' : `Invoice ${result.record.invoiceNumber} created.`); closeModal(); render(); }
    return;
  }
  if (formName === 'payment') {
    const result = await op('payment.record', data);
    if (result) { await refreshDirectory(); notify(`Payment recorded — receipt ${result.record.receiptNumber}.`); closeModal(); render(); }
    return;
  }
  if (formName === 'refund') {
    const result = await op('payment.refund', data);
    if (result) { notify('Refund recorded — the original payment stays untouched in the trail.'); closeModal(); render(); }
    return;
  }
  if (formName === 'adjustment') {
    const result = await op('payment.adjust', data);
    if (result) { notify('Balance adjusted.'); closeModal(); render(); }
    return;
  }
  if (formName === 'expense') {
    const result = await op(editing ? 'expense.update' : 'expense.create', data);
    if (result) { notify('Expense saved.'); closeModal(); render(); }
    return;
  }
  if (formName === 'stock') {
    const result = await op(editing ? 'inventory.updateItem' : 'inventory.createItem', data);
    if (result) { notify(editing ? 'Stock item saved.' : 'Stock item added.'); closeModal(); render(); }
    return;
  }
  if (formName === 'stock-adjustment') {
    const result = await op('inventory.movement', data);
    if (result) { notify(`Stock moved — now ${number(result.item?.currentStock ?? '')} on hand.`); closeModal(); render(); }
    return;
  }
  if (formName === 'supplier') {
    const result = await op(editing ? 'supplier.update' : 'supplier.create', data);
    if (result) { notify('Supplier saved.'); closeModal(); render(); }
    return;
  }
  if (formName === 'staff') {
    const result = await op(editing ? 'staff.update' : 'staff.create', data);
    if (result) { await refreshDirectory(); notify('Staff member saved.'); closeModal(); render(); }
    return;
  }
  if (formName === 'treatment') {
    const result = await op(editing ? 'treatment.update' : 'treatment.create', data);
    if (result) { await refreshDirectory(); notify('Treatment saved.'); closeModal(); render(); }
    return;
  }
  if (formName === 'treatment-plan') {
    const stages = [];
    for (let index = 0; ; index += 1) {
      const title = data[`stages[${index}][title]`];
      if (title === undefined) break;
      if (String(title || '').trim()) stages.push({ title: String(title).trim(), plannedDate: data[`stages[${index}][plannedDate]`] || '', estimatedCost: Number(data[`stages[${index}][estimatedCost]`] || 0) });
    }
    const result = await op(editing ? 'treatmentPlan.update' : 'treatmentPlan.create', { ...data, stages });
    if (result) { notify('Treatment plan saved.'); closeModal(); render(); }
    return;
  }
  if (formName === 'referral') {
    const result = await op(editing ? 'referral.update' : 'referral.create', data);
    if (result) { notify('Referral saved.'); closeModal(); render(); }
    return;
  }
  if (formName === 'followup') {
    const result = await op(editing ? 'followup.update' : 'followup.create', data);
    if (result) { notify('Follow-up saved.'); closeModal(); render(); }
    return;
  }
  if (formName === 'attachment') {
    const fileInput = form.querySelector('input[type="file"]');
    const file = fileInput?.files?.[0];
    if (!file) return notify('Choose a file to attach.', 'error');
    if (!validateAttachmentFile({ type: file.type, size: file.size, name: file.name }).allowed) return notify('This file type or size is not allowed.', 'error');
    const dataUrl = await new Promise((resolve) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.readAsDataURL(file); });
    const result = await op('attachment.add', { patientId: data.patientId, name: data.name || file.name, type: file.type, size: file.size, category: data.category || '', notes: data.notes || '', data: dataUrl });
    if (result) { notify(`${result.record.name} attached.`); closeModal(); render(); }
    return;
  }
  if (formName === 'user-account') {
    const permissions = form.querySelectorAll('input[name="permissions"]:checked').map((input) => input.value);
    const result = await op(editing ? 'user.update' : 'user.create', { ...data, permissions });
    if (result) { notify(editing ? 'Account updated.' : 'Account created.'); closeModal(); render(); }
    return;
  }
  if (formName === 'security') {
    const result = await op('user.changeOwnPin', { newPin: data.pin, confirmPin: data.confirmPin });
    if (result) { notify('PIN updated.'); closeModal(); render(); }
    return;
  }
  if (formName === 'settings') {
    const payload = { ...data };
    for (const key of ['paymentMethods', 'expenseCategories', 'inventoryCategories', 'chairs', 'rooms']) {
      if (typeof payload[key] === 'string') payload[key] = payload[key].split(',').map((part) => part.trim()).filter(Boolean);
    }
    for (const key of ['taxRate', 'defaultDuration', 'lowStockThreshold']) if (payload[key] !== undefined) payload[key] = Number(payload[key] || 0);
    payload.taxEnabled = payload.taxEnabled === 'on' || payload.taxEnabled === 'true';
    payload.backupEnabled = payload.backupEnabled === 'on' || payload.backupEnabled === 'true';
    payload.notifications = payload.notifications === 'on' || payload.notifications === 'true';
    if (payload.backupIntervalHours !== undefined) payload.backupIntervalHours = Number(payload.backupIntervalHours || 24);
    if (payload.backupRetention !== undefined) payload.backupRetention = Number(payload.backupRetention || 10);
    if (payload.sessionTimeoutMinutes !== undefined) payload.sessionTimeoutMinutes = Number(payload.sessionTimeoutMinutes || 30);
    if (payload.autoLockMinutes !== undefined) payload.autoLockMinutes = Number(payload.autoLockMinutes || 0);
    payload.customPatientFields = (() => {
      const labels = [...form.querySelectorAll('input[name="customFieldLabel"]')].map((input) => String(input.value || '').trim());
      const types = [...form.querySelectorAll('select[name="customFieldType"]')].map((input) => input.value);
      return labels.map((label, index) => label ? ({ label, type: types[index] || 'text', key: label.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '') || `field_${index + 1}` }) : null).filter(Boolean).slice(0, 40);
    })();
    payload.documentTemplate = {
      ...(appState.settings.documentTemplate || {}),
      footer: String(payload.documentFooter ?? (appState.settings.documentTemplate || {}).footer ?? ''),
      showLogo: payload.showLogo === 'on' || payload.showLogo === 'true',
      showClinicContact: payload.showClinicContact === 'on' || payload.showClinicContact === 'true'
    };
    delete payload.showLogo;
    delete payload.showClinicContact;
    const result = await op('settings.update', payload);
    if (result) { appState.settings = result.settings; notify('Settings saved.'); if (ui.page !== 'settings') render(); }
    return;
  }
  notify('This form is not connected yet.', 'error');
}

async function saveSetupStep(data) {
  if (data.setupStep === '2') {
    if (data.adminPin && data.adminPin !== data.adminPinConfirm) return notify('PIN confirmation does not match.', 'error');
    if (!/^\d{4,12}$/.test(data.adminPin || '')) return notify('PINs must be 4–12 digits.', 'error');
    const existingUsers = appState.boot?.userDirectory || [];
    const admin = existingUsers.find((user) => user.role === 'Administrator' && user.active !== false) || existingUsers[0];
    await op('settings.update', { language: data.language || 'English', currency: data.currency || 'BDT' });
    let accountSaved = true;
    if (admin && admin.id) {
      const result = await op('user.update', { id: admin.id, name: admin.name, role: admin.role, active: true, pin: data.adminPin, confirmPin: data.adminPinConfirm });
      if (result) appState.boot = { ...appState.boot, userDirectory: (await q('list', { collection: 'users', page: 1, pageSize: 50 })).rows };
      else accountSaved = false;
    } else {
      const result = await op('user.create', { name: data.dentistName || 'Administrator', role: 'Administrator', active: true, pin: data.adminPin, confirmPin: data.adminPinConfirm });
      if (result) appState.boot = { ...appState.boot, userDirectory: [result.record] };
      else accountSaved = false;
    }
    if (!accountSaved) return;
    appState.setupComplete = true;
    appState.settings = { ...appState.settings, language: data.language || 'English', currency: data.currency || 'BDT' };
    ui.modal = { type: 'setup', data: { step: 3, clinicName: data.clinicName || appState.settings.clinicName, dentistName: data.dentistName || appState.settings.dentistName, language: data.language || 'English', currency: data.currency || 'BDT' } };
    notify('Account PIN saved.', 'success');
    render();
    return;
  }
  const result = await op('setup.complete', { clinicName: data.clinicName, dentistName: data.dentistName, professionalTitle: data.professionalTitle, phone: data.phone, email: data.email, address: data.address, city: data.city, language: data.language, currency: data.currency });
  if (result) {
    appState.setupComplete = true;
    appState.settings = { ...appState.settings, clinicName: data.clinicName, dentistName: data.dentistName };
    ui.modal = { type: 'setup', data: { step: 2, clinicName: data.clinicName, dentistName: data.dentistName, language: data.language || 'English', currency: data.currency || 'BDT' } };
    render();
  }
}

/* ------------------------------------------------------------------ */
/* Click actions                                                       */
/* ------------------------------------------------------------------ */
async function handleClick(event) {
  const target = event.target.closest('[data-action]');
  if (!target) {
    // Backdrop clicks (the overlay itself) close the dialog. Clicks on any
    // descendant — inputs, labels, submit buttons — must never close it, or
    // the form is disconnected mid-submission and the browser cancels the
    // submit ("Form submission canceled because the form is not connected").
    if (event.target.classList && event.target.classList.contains('modal-overlay')) return closeModal();
    return;
  }
  // Custom actions never perform a native form submission. Buttons inside
  // forms default to type="submit"; without this, "Add line", "Cancel" and
  // similar action buttons would also fire the form's save handler.
  if (target.tagName === 'BUTTON' && target.closest('form') && !target.hasAttribute('data-submit-action')) event.preventDefault();
  const action = target.dataset.action;
  const id = target.dataset.id || '';
  const navigate = (page) => { ui.page = page; ui.modal = null; op('navigation.pushRecent', { page }).catch(() => {}); render(); };

  switch (action) {
    case 'navigate': return navigate(target.dataset.page);
    case 'retry-page': return render();
    case 'close-modal': return closeModal();
    case 'close-toast': ui.toast = null; return render();
    case 'toggle-mobile-nav': ui.mobileNav = !ui.mobileNav; return render();
    case 'lock-workspace': return lockWorkspace('Workspace locked');
    case 'logout':
      await api.logout();
      appState.session = null;
      notify('Signed out.', 'info');
      return render();

    case 'open-setup': return openModal('setup', { step: 1, clinicName: appState.settings.clinicName, dentistName: appState.settings.dentistName, professionalTitle: appState.settings.professionalTitle, phone: appState.settings.phone, email: appState.settings.email, address: appState.settings.address });
    case 'finish-setup':
      if (ui.modal?.data?.step === 3) {
        await op('setup.complete', { clinicName: ui.modal.data.clinicName, dentistName: ui.modal.data.dentistName });
        appState.firstRun = false;
        appState.setupComplete = true;
        appState.boot = { ...appState.boot, firstRun: false, setupComplete: true };
        ui.modal = null;
        ui.page = 'dashboard';
        notify('Workspace ready. Welcome to Dentiva Pro.', 'success');
        render();
      }
      return;

    case 'open-patient': return openModal('patient', { patient: id ? appState.directory.patients.find((p) => p.id === id) || (await q('record', { collection: 'patients', id })).record : {} });
    case 'open-patient-profile': ui.patientId = id; ui.patientTab = 'overview'; ui.page = 'patients'; return render();
    case 'open-patient-merge': return openModal('merge', { patient: await q('record', { collection: 'patients', id }).then((r) => r.record) });
    case 'patient-tab': ui.patientTab = target.dataset.tab; return render();
    case 'print-patient': { const record = await q('record', { collection: 'patients', id }).then((r) => r.record); return printPatient(record); }
    case 'print-patient-statement': { const record = await q('record', { collection: 'patients', id }).then((r) => r.record); return printPatientStatement(record); }

    case 'open-appointment': {
      const appointment = id ? (await q('record', { collection: 'appointments', id })).record : {};
      return openModal('appointment', { appointment });
    }
    case 'open-appointment-detail': {
      const appointment = (await q('record', { collection: 'appointments', id })).record;
      ui.modal = { type: 'appointmentDetail', data: { appointment } };
      return render();
    }
    case 'start-visit': {
      const a = (await q('record', { collection: 'appointments', id })).record;
      if (!a) return;
      if (['Scheduled', 'Checked In', 'Waiting'].includes(a.status)) await op('appointment.setStatus', { id: a.id, status: 'In Treatment' });
      return openModal('visit', { visit: { patientId: a.patientId, appointmentId: a.id, date: today(), reason: a.reason || '', procedures: a.treatment || '', dentistId: a.dentistId || '', room: a.room || '', chair: a.chair || '' } });
    }
    case 'queue-status': {
      const result = await op('appointment.setStatus', { id, status: target.dataset.status });
      if (result) { notify(`Queue updated: ${result.record.status}.`); return render(); }
      return;
    }
    case 'cancel-appointment':
      if (!window.confirm('Cancel this appointment?')) return;
      await op('appointment.cancel', { id, reason: 'Cancelled from queue' });
      return render();
    case 'set-appt-view': ui.apptView = target.dataset.view; return render();
    case 'cal-step': ui.calendarDate = shiftDate(ui.calendarDate, Number(target.dataset.step) || 1); return render();
    case 'print-queue': return printQueue();
    case 'print-billing': return printBilling();
    case 'print-report': return printReportDocument();
    case 'print-send': return executePrint('print');
    case 'print-save-pdf': return executePrint('pdf');
    case 'print-appointment': { const appt = (await q('record', { collection: 'appointments', id })).record; return printAppointmentSlip(appt); }
    case 'print-estimate': { const plan = (await q('record', { collection: 'treatmentPlans', id })).record; return printEstimate(plan); }

    case 'open-visit': {
      const visit = id ? (await q('record', { collection: 'visits', id })).record : {};
      return openModal('visit', { visit });
    }
    case 'print-visit': { const visit = (await q('record', { collection: 'visits', id })).record; return printVisit(visit); }

    case 'open-prescription': {
      const prescription = id ? (await q('record', { collection: 'prescriptions', id })).record : {};
      return openModal('prescription', { prescription });
    }
    case 'print-prescription': { const rx = (await q('record', { collection: 'prescriptions', id })).record; return printPrescription(rx); }
    case 'save-medication-template': {
      const form = document.querySelector('form[data-form="prescription"]');
      if (!form) return;
      const data = formData({ target: form });
      if (!data.medicine) return notify('Enter the medicine first.', 'error');
      const result = await op('medicationCatalog.save', { name: data.medicine, strength: data.strength, dosage: data.dosage, frequency: data.frequency, duration: data.duration });
      if (result) notify('Medicine saved to the catalog.', 'success');
      return;
    }

    case 'select-tooth':
      ui.dentalTooth = Number(target.dataset.tooth);
      return render();
    case 'set-dentition': ui.dentition = target.dataset.dentition; return render();
    case 'set-tooth-status': ui.toothStatus = target.dataset.status || ''; return render();
    case 'save-tooth': {
      const note = document.querySelector('[name="dental-note"]')?.value ?? ui.toothNote ?? '';
      const procedure = document.querySelector('[name="dental-procedure"]')?.value ?? '';
      const patientId = ui.patientId || ui.dentalPatientId;
      if (!patientId || !ui.dentalTooth) return notify('Choose a patient and tooth first.', 'error');
      const result = await op('dental.save', { patientId, tooth: ui.dentalTooth, dentition: ui.dentition, status: ui.toothStatus || '', note, procedure });
      if (result) { ui.toothStatus = undefined; ui.toothNote = undefined; notify(`Tooth ${ui.dentalTooth} record saved.`); return render(); }
      return;
    }
    case 'remove-tooth': {
      if (!ui.dentalTooth) return;
      const result = await op('dental.removeCurrent', { patientId: ui.patientId || ui.dentalPatientId, tooth: ui.dentalTooth, dentition: ui.dentition });
      if (result) { ui.dentalTooth = null; notify('Tooth record cleared — history preserved.'); return render(); }
      return;
    }
    case 'print-chart': { const patient = appState.directory.patients.find((p) => p.id === id) || (await q('record', { collection: 'patients', id })).record; return printDentalChart(patient); }

    case 'open-invoice': {
      const invoice = id ? (await q('record', { collection: 'invoices', id })).record : {};
      if (!invoice.id) return openModal('invoice', { invoice: {} });
      if (Number(invoice.paidCents ?? invoice.paid ?? 0) > 0 || !can('billing.edit')) return openInvoiceDetail(invoice);
      return openModal('invoice', { invoice });
    }
    case 'open-invoice-detail': {
      const invoice = (await q('record', { collection: 'invoices', id })).record;
      return openInvoiceDetail(invoice);
    }
    case 'print-invoice': { const invoice = (await q('record', { collection: 'invoices', id })).record; return printInvoice(invoice); }
    case 'void-invoice':
      if (!window.confirm('Void this invoice? It must have no recorded payments.')) return;
      await op('invoice.cancel', { id, reason: 'Voided' });
      return render();
    case 'add-invoice-line': {
      const container = document.querySelector('.invoice-lines');
      const index = container.querySelectorAll('.invoice-line').length;
      const row = document.createElement('div');
      row.className = 'invoice-line';
      row.innerHTML = `<input type="text" name="items[${index}][name]" placeholder="Item / treatment" required><input type="number" name="items[${index}][quantity]" value="1" min="1" step="1" aria-label="Quantity"><input type="number" name="items[${index}][unitPrice]" value="" min="0" step="0.01" aria-label="Unit price"><button type="button" class="icon-button" data-action="remove-invoice-line" data-index="${index}" aria-label="Remove line">${icon('trash', 15)}</button>`;
      container.insertBefore(row, container.lastElementChild);
      return;
    }
    case 'remove-invoice-line': {
      const line = target.closest('.invoice-line');
      if (line) { line.remove(); document.querySelectorAll('.invoice-line').forEach((row, idx) => { row.querySelectorAll('input').forEach((input) => { const part = input.name.split(']').pop(); input.name = `items[${idx}][${part}]`; }); }); }
      return;
    }

    case 'open-payment': {
      const patientId = id && (ui.patientId === id || !ui.patientId) ? id : ui.patientId;
      const invoices = await q('list', { collection: 'invoices', page: 1, pageSize: 30, filters: { patientId: patientId || undefined }, sort: 'date-desc' }).catch(() => ({ rows: [] }));
      ui.invoiceOptions = invoices.rows || [];
      return openModal('payment', { payment: {}, invoiceId: id || '' });
    }
    case 'open-payment-detail': { const payment = (await q('record', { collection: 'payments', id })).record; return openModal('refund', { payment }); }
    case 'open-refund': { const payment = (await q('record', { collection: 'payments', id })).record; return openModal('refund', { payment }); }
    case 'open-adjustment': { const invoice = (await q('record', { collection: 'invoices', id })).record; return openModal('adjustment', { invoice }); }
    case 'print-payment': { const payment = (await q('record', { collection: 'payments', id })).record; return printPayment(payment); }

    case 'open-expense': { const expense = id ? (await q('record', { collection: 'expenses', id })).record : {}; return openModal('expense', { expense }); }
    case 'print-expense': { const expense = (await q('record', { collection: 'expenses', id })).record; return printExpense(expense); }

    case 'open-stock': {
      ui.supplierOptions = (await q('list', { collection: 'suppliers', page: 1, pageSize: 200 }).catch(() => ({ rows: [] }))).rows || [];
      const item = id ? (await q('record', { collection: 'inventory', id })).record : {};
      return openModal('stock', { item });
    }
    case 'open-stock-adjustment': { const item = (await q('record', { collection: 'inventory', id })).record; return openModal('stock-adjustment', { item }); }
    case 'open-inventory-item': {
      ui.supplierOptions = (await q('list', { collection: 'suppliers', page: 1, pageSize: 200 }).catch(() => ({ rows: [] }))).rows || [];
      const item = (await q('record', { collection: 'inventory', id })).record;
      return openModal('stock', { item });
    }
    case 'open-supplier': { const supplier = id ? (await q('record', { collection: 'suppliers', id })).record : {}; return openModal('supplier', { supplier }); }
    case 'open-staff': { const staff = id ? (await q('record', { collection: 'staff', id })).record : {}; return openModal('staff', { staff }); }
    case 'open-treatment': { const treatment = id ? (await q('record', { collection: 'treatments', id })).record : {}; return openModal('treatment', { treatment }); }
    case 'add-plan-stage': {
      const container = document.querySelector('.plan-stages');
      const index = container.querySelectorAll('.plan-stage-row').length;
      const row = document.createElement('div');
      row.className = 'plan-stage-row';
      row.innerHTML = `<input type="text" name="stages[${index}][title]" placeholder="Stage name" required><input type="date" name="stages[${index}][plannedDate]" value=""><input type="number" name="stages[${index}][estimatedCost]" value="" min="0" step="0.01" placeholder="Cost"><button type="button" class="icon-button" data-action="remove-plan-stage" data-index="${index}" aria-label="Remove stage">${icon('trash', 15)}</button>`;
      container.insertBefore(row, container.lastElementChild);
      return;
    }
    case 'remove-plan-stage': { const row = target.closest('.plan-stage-row'); if (row) row.remove(); return; }
    case 'cycle-plan-stage': {
      const planId = target.dataset.plan;
      const stageId = target.dataset.stage;
      const plan = (await q('record', { collection: 'treatmentPlans', id: planId })).record;
      const order = ['Planned', 'In progress', 'Completed', 'Deferred'];
      const stage = (plan.stages || []).find((s) => s.id === stageId);
      if (!stage) return;
      const nextStatus = order[(order.indexOf(stage.status) + 1) % order.length];
      const updatedStages = plan.stages.map((s) => (s.id === stageId ? { ...s, status: nextStatus } : s));
      await op('treatmentPlan.update', { id: planId, ...plan, stages: updatedStages });
      return render();
    }
    case 'convert-treatment-plan': {
      const plan = (await q('record', { collection: 'treatmentPlans', id })).record;
      if (!window.confirm(`Convert "${plan.title}" to a clinical visit? This creates a visit record only — no financial records are created automatically.`)) return;
      const result = await op('treatmentPlan.convert', { id });
      if (result) { notify(`Visit ${result.record.visitCode} created from the plan.`); return render(); }
      return;
    }
    case 'open-treatment-plan': { const plan = id ? (await q('record', { collection: 'treatmentPlans', id })).record : {}; return openModal('treatment-plan', { plan }); }
    case 'open-referral': { const referral = id ? (await q('record', { collection: 'referrals', id })).record : {}; return openModal('referral', { referral }); }
    case 'open-followup': { const task = id ? (await q('record', { collection: 'followUpTasks', id })).record : {}; return openModal('followup', { task }); }
    case 'complete-followup': await op('followup.complete', { id }); return render();

    case 'open-attachment': {
      if (id) {
        const attachment = (await q('record', { collection: 'attachments', id })).record;
        ui.modal = { type: 'attachment-preview', data: { attachment, previewHtml: '' } };
        render();
        const content = await api.readAttachment(id);
        if (content?.ok && ui.modal?.type === 'attachment-preview') {
          ui.modal.data.previewHtml = content.type?.startsWith('image/') ? `<img class="attachment-image" src="${content.dataUrl}" alt="${esc(attachment.name)}">` : `<p class="muted">${esc(attachment.type || 'Document')}${content.type === 'application/pdf' ? ' — PDF active content is never embedded; download to view.' : ''}</p>`;
          const body = document.querySelector('.attachment-preview-body');
          if (body) body.innerHTML = ui.modal.data.previewHtml;
        }
        return;
      }
      return openModal('attachment', { patient: appState.directory.patients.find((p) => p.id === ui.patientId) || {} });
    }
    case 'pick-attachment': { const input = target.querySelector('input[type="file"]'); if (input) input.click(); return; }
    case 'download-attachment': {
      const content = await api.readAttachment(id);
      if (content?.ok) {
        const link = document.createElement('a');
        link.href = content.dataUrl;
        const row = document.querySelector(`[data-action="open-attachment"][data-id="${CSS.escape(id)}"]`)?.closest('.record-row');
        link.download = row?.querySelector('strong')?.textContent || 'attachment';
        document.body.appendChild(link);
        link.click();
        link.remove();
      }
      return render();
    }
    case 'delete-attachment':
      if (!window.confirm('Remove this attachment? This cannot be undone unless it exists in a backup.')) return;
      await op('attachment.delete', { id, confirm: true });
      return render();

    case 'open-user-account': {
      const user = id ? (await q('record', { collection: 'users', id })).record : {};
      return openModal('user-account', { user });
    }
    case 'open-security': return openModal('security', {});
    case 'open-csv-import': ui.csvImport = null; return openModal('csv-import', {});
    case 'pick-csv': { const input = target.querySelector('input[type="file"]'); if (input) input.click(); return; }
    case 'import-csv': return importPatientsFromCsv();

    case 'open-notifications': ui.modal = { type: 'notifications', data: {} }; return render();
    case 'mark-notifications-read': await op('notification.markAllRead', {}); await refreshNotifications(); return render();
    case 'add-custom-field': {
      const grid = target.closest('.card')?.querySelector('.form-grid');
      if (grid) {
        const count = grid.querySelectorAll('.custom-field-row').length;
        if (count >= 40) return notify('Up to 40 custom fields are supported.', 'error');
        grid.querySelector('.form-note.muted')?.remove();
        grid.insertAdjacentHTML('beforeend', `<div class="custom-field-row"><input type="text" name="customFieldLabel" value="" placeholder="Field label" aria-label="Custom field label"><select name="customFieldType" aria-label="Custom field type">${['text', 'number', 'date', 'textarea'].map((type) => `<option value="${type}">${type}</option>`).join('')}</select><button type="button" class="icon-button tiny" data-action="remove-custom-field" aria-label="Remove field">${icon('trash', 14)}</button></div>`);
        grid.querySelector('.custom-field-row:last-child input')?.focus();
      }
      return;
    }
    case 'remove-custom-field': { target.closest('.custom-field-row')?.remove(); return; }
    case 'notification-dismiss': { const dismissed = await op('notification.dismiss', { id }); if (dismissed) await refreshNotifications(); return render(); }
    case 'audit-details': { const state = auditState(); const result = await q('auditList', { page: state.page, pageSize: state.pageSize, query: state.query, entity: state.filters.entity || '', userId: state.filters.userId || '', from: state.filters.from || '', to: state.filters.to || '' }); const row = (result.rows || []).find((entry) => entry.id === id) || {}; ui.modal = { type: 'audit-detail', data: { row } }; return render(); }
    case 'audit-export': {
      const state = auditState();
      const head = ['Time', 'User', 'Action', 'Record type', 'Record ID', 'Summary'];
      const out = [head.join(',')];
      let page = 1; let total = Infinity; let exported = 0;
      while (exported < total) {
        const chunk = await q('auditList', { page, pageSize: 500, query: state.query, entity: state.filters.entity || '', userId: state.filters.userId || '', from: state.filters.from || '', to: state.filters.to || '' });
        total = chunk.total || 0;
        for (const row of chunk.rows || []) {
          out.push([String(row.createdAt || ''), row.userName || 'System', row.action || '', row.entity || '', row.entityId || '', row.summary || ''].map((cell) => `"${String(cell ?? '').replaceAll('"', '""')}"`).join(','));
        }
        exported += (chunk.rows || []).length;
        page += 1;
        if (!(chunk.rows || []).length) break;
      }
      downloadBlob(out.join('\n'), `dentiva-audit-log-${today()}.csv`, 'text/csv');
      notify(`Exported ${number(exported)} audit entr${exported === 1 ? 'y' : 'ies'}.`);
      return;
    }
    case 'notification-open':
      await op('notification.markRead', { id });
      const note = notificationItems().find((item) => item.id === id);
      if (note?.page) navigate(note.page);
      return;

    case 'open-dashboard-customizer': {
      const dash = await q('dashboard', {});
      ui.modal = { type: 'dashboard-customizer', data: { layout: dash.dashboardLayout?.widgets?.length ? dash.dashboardLayout.widgets : ['schedule', 'queue', 'followups', 'signals'] } };
      return render();
    }
    case 'toggle-dashboard-widget': {
      const result = await op('dashboard.toggleWidget', { widget: target.dataset.widget });
      if (result) ui.modal.data.layout = result.dashboard;
      return render();
    }
    case 'move-dashboard-widget': {
      const layout = [...ui.modal.data.layout];
      const index = layout.indexOf(target.dataset.widget);
      const delta = target.dataset.direction === 'up' ? -1 : 1;
      const swap = index + delta;
      if (index < 0 || swap < 0 || swap >= layout.length) return;
      [layout[index], layout[swap]] = [layout[swap], layout[index]];
      await op('dashboard.setLayout', { layout });
      ui.modal.data.layout = layout;
      return render();
    }
    case 'reset-dashboard-widgets':
      await op('dashboard.setLayout', { layout: ['schedule', 'queue', 'followups', 'signals'] });
      return render();

    case 'open-audit-log': ui.modal = { type: 'audit-log', data: {} }; return render();
    case 'run-audit-search': {
      const queryText = document.querySelector('[name="auditQuery"]')?.value || '';
      ui.modal = null;
      const result = await q('auditList', { query: queryText });
      notify(`${result.total} audit entr${result.total === 1 ? 'y' : 'ies'} match.`, 'info');
      return render();
    }

    case 'save-filter': {
      const collection = target.dataset.collection || 'patients';
      const nameInput = document.querySelector('[name="filterName"]');
      const name = nameInput?.value || ui.search || 'My view';
      const result = await op('savedFilter.save', { entity: collection, name, query: listState[collection]?.query || ui.search || '', filters: listState[collection]?.filters || {} });
      if (result) notify('View saved.', 'success');
      return render();
    }
    case 'apply-saved-filter': {
      const view = (await q('list', { collection: 'savedFilters', page: 1, pageSize: 50 })).rows.find((item) => item.id === id);
      if (!view) return;
      const state = listState[view.entity || 'patients'];
      state.query = view.query || '';
      state.filters = view.filters || {};
      state.page = 1;
      ui.search = view.query || '';
      return render();
    }
    case 'export-patients-csv': return exportPatientsCsv();

    case 'create-backup': {
      const result = await api.createBackup('manual');
      if (result.ok) { notify(result.exported ? 'Backup exported to your downloads.' : 'Backup created.', 'success'); appState.storage = { ...appState.storage, lastBackupAt: result.manifest?.createdAt }; return render(); }
      notify(result.error || 'Backup failed.', 'error');
      return;
    }
    case 'restore-from-folder': {
      const picked = await api.pickFolder();
      if (!picked || picked.canceled) return;
      const validation = await api.validateBackup(picked.path);
      if (!validation.ok) return notify(`Backup validation failed: ${(validation.problems || []).join(' ') || 'unknown problem'}`, 'error');
      ui.restoreCandidate = { sourceKind: 'folder', sourceLabel: picked.path, path: picked.path, validated: true, selectedModules: ['patients', 'clinical', 'finance', 'operations'], strategy: 'Replace', state: null };
      return render();
    }
    case 'restore-from-file': {
      const picked = await api.pickFile();
      if (!picked || picked.canceled) return;
      try {
        const parsed = JSON.parse(picked.text);
        const state = parsed.state || parsed;
        ui.restoreCandidate = { sourceKind: 'file', sourceLabel: picked.path, path: picked.path, text: picked.text, validated: true, selectedModules: ['patients', 'clinical', 'finance', 'operations'], strategy: 'Replace', state, manifest: parsed.manifest || null };
        render();
      } catch {
        notify('That file is not a valid Dentiva JSON backup.', 'error');
      }
      return;
    }
    case 'validate-backup': {
      const validation = await api.validateBackup(id);
      if (!validation.ok) return notify(`Validation failed: ${(validation.problems || []).join(' ') || 'unknown problem'}`, 'error');
      if (!requirePermission('backup.restore')) return;
      ui.restoreCandidate = { sourceKind: 'folder', sourceLabel: id, path: id, validated: true, selectedModules: ['patients', 'clinical', 'finance', 'operations'], strategy: 'Replace', state: null };
      return render();
    }
    case 'restore-backup': {
      if (!requirePermission('backup.restore')) return;
      if (!window.confirm('Restore this backup? A safety backup of the current workspace is created first. Continue?')) return;
      const result = await api.restoreBackup(id);
      if (result.ok) { notify('Workspace restored.', 'success'); return boot(); }
      notify(result.error || 'Restore failed.', 'error');
      return;
    }
    case 'delete-backup':
      if (!requirePermission('backup.restore')) return;
      if (!window.confirm('Delete this backup permanently?')) return;
      await api.deleteBackup(id);
      return render();
    case 'close-restore-candidate': ui.restoreCandidate = null; return render();
    case 'confirm-restore': {
      if (!requirePermission('backup.restore')) return;
      const candidate = ui.restoreCandidate;
      const modules = candidate?.selectedModules || [];
      const strategy = candidate?.strategy || 'Replace';
      if (candidate.sourceKind === 'file') {
        const result = await api.restoreJson(candidate.text, { modules, strategy });
        if (result.ok) { notify('JSON backup restored.', 'success'); ui.restoreCandidate = null; return boot(); }
        return notify(result.error || 'Restore failed.', 'error');
      }
      if (!window.confirm('Restore this backup? A safety backup of the current workspace is created first. Continue?')) return;
      const result = await api.restoreBackup(candidate.path);
      if (result.ok) { notify('Workspace restored.', 'success'); ui.restoreCandidate = null; return boot(); }
      return notify(result.error || 'Restore failed.', 'error');
    }

    case 'run-integrity-check': return runIntegrityCheck();
    case 'export-unsupported-store': {
      const result = await api.exportWorkspace();
      if (result?.ok) notify(result.canceled ? 'Export cancelled.' : `Preserved workspace exported to: ${result.path}`, 'info');
      return;
    }
    case 'reset-unsupported-workspace': {
      if (!window.confirm('Reset this workspace? Export the preserved data first because this cannot be undone.')) return;
      const resetResult = await op('workspace.reset', { confirmToken: 'RESET' });
      if (resetResult) { notify('Workspace reset. The preserved export should already be safe somewhere else.', 'success'); return boot(); }
      return;
    }

    case 'list-page': {
      const collection = target.dataset.collection;
      listState[collection].page = Number(target.dataset.page) || 1;
      return render();
    }

    case 'upload-logo': {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = 'image/png,image/jpeg,image/webp';
      input.onchange = async () => {
        const file = input.files?.[0];
        if (!file) return;
        const dataUrl = await new Promise((resolve) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.readAsDataURL(file); });
        const result = await op('settings.update', { logo: dataUrl });
        if (result) { appState.settings = result.settings; render(); }
      };
      input.click();
      return;
    }
    case 'remove-logo': {
      const result = await op('settings.update', { logo: '' });
      if (result) { appState.settings = result.settings; render(); }
      return;
    }

    default:
      if (action.startsWith('open-')) { ui.modal = null; }
  }
}
async function importPatientsFromCsv() {
  if (!requirePermission('patients.create')) return;
  const importState = ui.csvImport;
  if (!importState) return;
  const fields = ['fullName', 'phone', 'email', 'dateOfBirth', 'gender', 'address', 'allergies', 'notes'];
  const rows = importState.rows.map((row) => Object.fromEntries(fields.map((field) => [field, row[importState.mapping[field]] || '']))).filter((row) => String(row.fullName || '').trim() && String(row.phone || '').trim());
  if (!rows.length) return notify('No valid rows found (full name + phone required).', 'error');
  const created = [];
  let skipped = 0;
  const createCopy = importState.strategy === 'Create New Copy';
  for (const row of rows) {
    const result = await op('patient.create', { ...row, fullName: row.fullName.trim(), phone: row.phone.trim(), status: 'Active', confirmDuplicate: createCopy || undefined });
    if (result) created.push(result.record);
    else if (result?.code === 'duplicate-confirm') skipped += 1;
  }
  await refreshDirectory();
  ui.csvImport = null;
  closeModal();
  notify(`Patient import complete: ${created.length} added, ${skipped} duplicate${skipped === 1 ? '' : 's'} skipped.`, created.length ? 'success' : 'error');
}
async function runIntegrityCheck() {
  const diag = await api.diagnostics();
  if (!diag) return notify('Diagnostics unavailable.', 'error');
  if (diag.ok) notify('Integrity check passed — structure, relationships and money fields are sound.', 'success');
  else notify(`${diag.issues.length} integrity issue(s) found. Open Diagnostics to review.`, 'error');
  ui.page = 'diagnostics';
  render();
}
async function exportPatientsCsv() {
  const result = await q('list', { collection: 'patients', page: 1, pageSize: 5000, filters: { status: 'active' } });
  const headers = ['fullName', 'phone', 'email', 'dateOfBirth', 'gender', 'address', 'allergies', 'notes'];
  const lines = [headers.map(csvEscape).join(',')];
  for (const p of result.rows || []) lines.push(headers.map((h) => csvEscape(p[h])).join(','));
  downloadBlob(lines.join('\n'), `dentiva-patients-${today()}.csv`, 'text/csv');
  notify(`Exported ${(result.rows || []).length} patients to CSV.`, 'success');
}
function csvEscape(value) { return `"${String(value ?? '').replace(/"/g, '""')}"`; }
function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = '';
  let inQuotes = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (inQuotes) {
      if (char === '"') { if (text[index + 1] === '"') { cell += '"'; index += 1; } else inQuotes = false; }
      else cell += char;
    } else if (char === '"') inQuotes = true;
    else if (char === ',') { row.push(cell); cell = ''; }
    else if (char === '\n' || char === '\r') {
      if (char === '\r' && text[index + 1] === '\n') index += 1;
      row.push(cell); cell = '';
      if (row.some((part) => part !== '')) rows.push(row);
      row = [];
    } else cell += char;
  }
  row.push(cell);
  if (row.some((part) => part !== '')) rows.push(row);
  return rows;
}
function downloadBlob(content, filename, type = 'application/json') {
  const blob = new Blob([content], { type });
  const anchor = document.createElement('a');
  anchor.href = URL.createObjectURL(blob);
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(anchor.href);
}

/* ------------------------------------------------------------------ */
/* Input / change / keydown                                            */
/* ------------------------------------------------------------------ */
async function handleInput(event) {
  const target = event.target;
  const key = target.dataset.input;
  recordActivity();
  if (key === 'global-search') {
    ui.search = target.value;
    if (ui.modal?.type === 'search') {
      const results = await globalSearch(target.value);
      const container = document.getElementById('command-results');
      if (container) container.innerHTML = commandResultsHtml(results);
    }
    return;
  }
  if (key === 'command-search') {
    const results = await globalSearch(target.value);
    const container = document.getElementById('command-results');
    if (container) container.innerHTML = commandResultsHtml(results);
    return;
  }
  if (key === 'list-query') {
    const collection = target.dataset.collection;
    const state = listState[collection] || (listState[collection] = { page: 1, pageSize: 25, query: '', filters: {} });
    clearTimeout(state._timer);
    state._timer = setTimeout(() => { state.query = target.value; state.page = 1; render(); }, 220);
    return;
  }
  if (key === 'dental-note') { ui.toothNote = target.value; return; }
  if (key === 'invoice-lines') { updateInvoiceTotals(); return; }
}
function handleFilePick(event) {
  const target = event.target;
  const file = target.files?.[0];
  if (!file) return;
  if (target.closest('[data-action="pick-csv"]')) {
    const reader = new FileReader();
    reader.onload = () => {
      const rows = parseCsv(String(reader.result));
      if (rows.length < 2) return notify('The CSV needs a header row and at least one data row.', 'error');
      ui.csvImport = { fileName: file.name, headers: rows[0], rows: rows.slice(1), mapping: { fullName: rows[0].findIndex((h) => /name/i.test(h)), phone: rows[0].findIndex((h) => /phone/i.test(h)) }, strategy: 'Skip' };
      if (ui.csvImport.mapping.fullName < 0) ui.csvImport.mapping.fullName = 0;
      if (ui.csvImport.mapping.phone < 0) ui.csvImport.mapping.phone = 1;
      render();
    };
    reader.readAsText(file);
    return;
  }
  if (target.closest('[data-action="pick-attachment"]')) {
    const nameInput = document.querySelector('form[data-form="attachment"] [name="name"]');
    if (nameInput && !nameInput.value) nameInput.value = file.name;
    const label = document.querySelector('.file-drop strong');
    if (label) label.textContent = file.name;
  }
}
async function handleChange(event) {
  const target = event.target;
  const key = target.dataset.change;
  recordActivity();
  switch (key) {
    case 'dashboard-range': ui.range = target.value; if (ui.range !== 'custom') { ui.rangeFrom = ''; ui.rangeTo = ''; } return render();
    case 'dashboard-range-from': ui.rangeFrom = target.value; return render();
    case 'dashboard-range-to': ui.rangeTo = target.value; return render();
    case 'reports-range': ui.reportsRange = target.value; if (ui.reportsRange !== 'custom') { ui.rangeFrom = ''; ui.rangeTo = ''; } return render();
    case 'reports-range-from': ui.rangeFrom = target.value; return render();
    case 'reports-range-to': ui.rangeTo = target.value; return render();
    case 'analytics-range': ui.analyticsRange = target.value; return render();
    case 'report-type': ui.reportType = target.value; return render();
    case 'print-page-size': if (ui.modal?.type === 'print-preview') { ui.modal.data.pageSize = target.value; return render(); } return;
    case 'audit-entity': auditState().filters.entity = target.value; auditState().page = 1; return render();
    case 'audit-user': auditState().filters.userId = target.value; auditState().page = 1; return render();
    case 'audit-from': auditState().filters.from = target.value; auditState().page = 1; return render();
    case 'audit-to': auditState().filters.to = target.value; auditState().page = 1; return render();
    case 'notification-rule': {
      const kind = target.dataset.kind;
      const nextRules = { ...notificationRules(), [kind]: target.checked };
      appState.notificationRules = nextRules;
      const saved = await op('settings.update', { notificationRules: nextRules });
      if (saved) { appState.settings = saved.settings; await refreshNotifications({ scan: true }); }
      return render();
    }
    case 'patient-status-filter': ui.patientStatusFilter = target.value; listState.patients.page = 1; return render();
    case 'patient-balance-filter': ui.patientBalanceFilter = target.value; listState.patients.page = 1; return render();
    case 'invoice-status-filter': listState.invoices.filters = { ...listState.invoices.filters, status: target.value || undefined }; listState.invoices.page = 1; return render();
    case 'inventory-category-filter': listState.inventory.filters = { ...listState.inventory.filters, category: target.value || undefined }; listState.inventory.page = 1; return render();
    case 'inventory-lowstock': listState.inventory.filters = { ...listState.inventory.filters, lowStock: target.checked || undefined }; listState.inventory.page = 1; return render();
    case 'inventory-expiring': listState.inventory.filters = { ...listState.inventory.filters, expiringBefore: target.checked ? shiftDate(today(), 60) : undefined }; listState.inventory.page = 1; return render();
    case 'dental-patient': {
      if (target.value) { ui.dentalPatientId = target.value; ui.patientId = target.value; ui.patientTab = 'dental'; ui.page = 'patients'; render(); }
      return;
    }
    case 'user-role': {
      const form = target.closest('form');
      const role = form?.querySelector('[name="role"]')?.value || 'Receptionist';
      const grid = form?.querySelector('.permission-grid');
      if (grid) grid.innerHTML = permissionGroupsHtml(new Set((await import('./core.js')).permissionsForRole(role, [])));
      return;
    }
    case 'restore-module': {
      const candidate = ui.restoreCandidate;
      if (candidate) {
        const modules = new Set(candidate.selectedModules || []);
        if (target.checked) modules.add(target.dataset.module); else modules.delete(target.dataset.module);
        candidate.selectedModules = [...modules];
        if (!candidate.selectedModules.length) { candidate.selectedModules = ['patients']; target.checked = true; }
        render();
      }
      return;
    }
    case 'restore-strategy': if (ui.restoreCandidate) { ui.restoreCandidate.strategy = target.value; render(); } return;
    case 'csv-strategy': if (ui.csvImport) ui.csvImport.strategy = target.value; return;
    case 'invoice-treatment': {
      const selected = appState.directory.treatments.find((t) => t.id === target.value);
      if (selected) {
        const container = document.querySelector('.invoice-lines');
        if (container && container.querySelectorAll('.invoice-line').length <= 1) {
          const inputs = container.querySelector('.invoice-line')?.querySelectorAll('input');
          if (inputs) { inputs[0].value = selected.name; inputs[2].value = selected.defaultPrice || ''; }
          updateInvoiceTotals();
        }
      }
      return;
    }
    default: return;
  }
}
function handleKeydown(event) {
  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
    event.preventDefault();
    ui.modal = { type: 'search', data: { query: '', results: '' } };
    render();
    return;
  }
  if (event.key === 'Escape' && ui.modal) { event.preventDefault(); closeModal(); }
}

function commandResultsHtml(results) {
  const sections = [];
  if (results.patients?.length) sections.push(`<div class="command-section"><h4>Patients</h4>${results.patients.map((item) => `<button class="command-row" data-action="open-patient-profile" data-id="${attr(item.id)}"><strong>${esc(item.label)}</strong><small>${esc(item.sub || '')}</small></button>`).join('')}</div>`);
  if (results.appointments?.length) sections.push(`<div class="command-section"><h4>Appointments</h4>${results.appointments.map((item) => `<button class="command-row" data-action="open-appointment-detail" data-id="${attr(item.id)}"><strong>${esc(item.label)}</strong><small>${esc(item.sub || '')}</small></button>`).join('')}</div>`);
  if (results.invoices?.length) sections.push(`<div class="command-section"><h4>Invoices</h4>${results.invoices.map((item) => `<button class="command-row" data-action="open-invoice-detail" data-id="${attr(item.id)}"><strong>${esc(item.label)}</strong><small>${esc(item.sub || '')}</small></button>`).join('')}</div>`);
  if (!sections.length) return `<p class="muted">No matching records for this search.</p>`;
  return sections.join('');
}
function updateInvoiceTotals() {
  const form = document.querySelector('form[data-form="invoice"]');
  if (!form) return;
  const items = [...form.querySelectorAll('.invoice-line')].map((line) => {
    const inputs = line.querySelectorAll('input');
    return { name: inputs[0]?.value || '', quantity: Number(inputs[1]?.value || 1), unitPrice: Number(inputs[2]?.value || 0) };
  }).filter((item) => item.name && item.quantity > 0);
  const subtotal = items.reduce((sum, item) => sum + item.quantity * item.unitPrice, 0);
  const discount = Number(form.querySelector('[name="discount"]')?.value || 0);
  const taxEnabled = form.querySelector('[name="taxEnabled"]')?.checked;
  const taxRate = taxEnabled ? Number(form.querySelector('[name="taxRate"]')?.value || 0) : 0;
  const totals = calculateInvoice({ quantity: 1, unitPrice: subtotal, discount, taxRate });
  document.getElementById('invoice-subtotal')?.replaceChildren(currency(totals.subtotal));
  document.getElementById('invoice-discount')?.replaceChildren(currency(totals.discount));
  document.getElementById('invoice-tax')?.replaceChildren(currency(totals.tax));
  document.getElementById('invoice-total')?.replaceChildren(currency(totals.total));
}

/* ------------------------------------------------------------------ */
/* Printing (isolated window; no active content)                       */
/* ------------------------------------------------------------------ */
function printPageCssSize(pageSize) {
  return { A4: 'A4 portrait', A5: 'A5 portrait', Letter: 'letter portrait', Legal: 'legal portrait', Receipt80: '80mm 200mm' }[pageSize] || 'A4 portrait';
}
function normalizePrintPageSize(value) {
  const v = String(value || '');
  return ['A4', 'A5', 'Letter', 'Legal', 'Receipt80'].includes(v) ? v : 'A4';
}
function buildPrintDocument(title, content, pageSize = 'A4') {
  const size = normalizePrintPageSize(pageSize);
  const receipt = size === 'Receipt80';
  const doc = appState.settings.documentTemplate || {};
  const showLogo = doc.showLogo !== false;
  const showContact = doc.showClinicContact !== false;
  const footer = doc.footer || '';
  const s = appState.settings;
  const lang = (s.language || 'English') === 'Bengali' ? 'bn' : 'en';
  const logo = showLogo ? safeLogoSource(s.logo) : '';
  const brand = s.clinicName || 'Dentiva Pro';
  const contactParts = showContact
    ? [s.chamberName, [s.address, s.city, s.district].filter(Boolean).join(', '), [s.phone, s.secondaryPhone].filter(Boolean).join(' / '), s.email].filter(Boolean)
    : [];
  const prescriberLine = [s.dentistName, s.professionalTitle].filter(Boolean).join(', ');
  return `<!doctype html><html lang="${lang}"><head><meta charset="utf-8"><title>${esc(title)}</title><style>
    html,body{margin:0;padding:${receipt ? '4mm' : '12mm'};color:#111;background:#fff;font-size:${receipt ? '11px' : '13px'};line-height:1.45;
      font-family:'SolaimanLipi','Nirmala UI','Noto Sans Bengali','Hind Siliguri',Arial,Helvetica,sans-serif}
    .print-header{display:flex;justify-content:space-between;align-items:flex-start;gap:12px;border-bottom:2px solid #0c6b70;padding-bottom:10px;margin-bottom:14px}
    .print-brand{display:flex;gap:10px;align-items:flex-start}
    .print-logo{max-height:${receipt ? '34px' : '48px'};max-width:120px;object-fit:contain}
    .print-brand-name{font-size:${receipt ? '14px' : '18px'};font-weight:800;color:#0c6b70}
    .print-brand small{display:block;font-size:${receipt ? '9px' : '10.5px'};color:#555;font-weight:400}
    .print-doc-title{text-align:right}.print-doc-title h1{font-size:${receipt ? '13px' : '19px'};margin:0 0 2px;color:#111}
    .print-doc-title small{color:#666;font-size:${receipt ? '9px' : '10.5px'}}
    .summary{display:flex;gap:10px;flex-wrap:wrap;margin:10px 0}.summary div{background:#f4f7f7;padding:5px 10px;border-radius:6px}
    .summary .muted{display:block;font-size:9px;text-transform:uppercase;letter-spacing:.05em;color:#5c6f6f}
    .print-table{width:100%;border-collapse:collapse;margin:8px 0;page-break-inside:auto}
    .print-table thead{display:table-header-group}
    .print-table tr{page-break-inside:avoid}
    .print-table th,.print-table td{text-align:left;padding:${receipt ? '4px 5px' : '6px 8px'};border-bottom:1px solid #dfe7e7;font-size:inherit;vertical-align:top}
    .print-table th{background:#f4f7f7;text-transform:uppercase;font-size:9px;letter-spacing:.05em}
    .print-footer{margin-top:18px;padding-top:8px;border-top:1px solid #dfe7e7;font-size:${receipt ? '9px' : '10.5px'};color:#5c6f6f;page-break-inside:avoid}
    h2{font-size:${receipt ? '11px' : '13.5px'};margin:12px 0 6px}
    p{margin:4px 0}
    @page{size:${printPageCssSize(size)};margin:${receipt ? '4mm' : '10mm'}}
    @media print{body{padding:0}}
  </style></head><body>
  <div class="print-header">
    <div class="print-brand">${logo ? `<img class="print-logo" src="${logo}" alt="">` : ''}<div><div class="print-brand-name">${esc(brand)}</div>${prescriberLine ? `<small>${esc(prescriberLine)}</small>` : ''}${contactParts.map((part) => `<small>${esc(part)}</small>`).join('')}</div></div>
    <div class="print-doc-title"><h1>${esc(title)}</h1><small>${dateFull(today())}</small></div>
  </div>
  ${content}
  ${footer ? `<div class="print-footer">${esc(footer)}</div>` : ''}
  </body></html>`;
}
function defaultPrintPageSize() { return normalizePrintPageSize(appState.settings.printPageSize === 'Receipt80' ? 'A4' : appState.settings.printPageSize || 'A4'); }
function openPrintPreview(title, content, pageSize) {
  openModal('print-preview', { title, content, pageSize: normalizePrintPageSize(pageSize || defaultPrintPageSize()) });
}
async function executePrint(mode) {
  const data = ui.modal?.data;
  if (!data || ui.modal?.type !== 'print-preview') return;
  const markup = buildPrintDocument(data.title, data.content, data.pageSize);
  let result;
  try {
    result = await api.printHtml(markup, { mode, pageSize: data.pageSize, title: data.title });
  } catch (error) {
    return notify(`${mode === 'pdf' ? 'PDF export' : 'Printing'} failed: ${error?.message || 'unknown error'}`, 'error');
  }
  if (!result) return notify('No response from the print service.', 'error');
  if (result.ok === false) return notify(result.error || 'The document could not be produced.', 'error');
  if (result.cancelled) return notify(mode === 'pdf' ? 'PDF save cancelled — nothing was written.' : 'Print cancelled — nothing was sent to the printer.', 'info');
  if (result.saved) { notify(`PDF saved: ${result.path}`); return closeModal(); }
  if (result.printed) { notify('Document sent to the printer.'); return closeModal(); }
  if (result.fallback) { notify('Opened the browser print window — complete printing in the browser dialog.', 'info'); return closeModal(); }
  notify('The print service returned an unexpected result.', 'error');
}
function modalPrintPreview(data = {}) {
  const markup = buildPrintDocument(data.title || 'Document', data.content || '', data.pageSize || 'A4');
  return `${modalHead('PRINT DOCUMENT', data.title || 'Document', 'Preview the document, choose the paper size, then print or save as PDF. Nothing prints silently.')}
    <div class="print-preview-toolbar">
      <label class="field-label inline">Paper size
        <select name="print-page-size" data-change="print-page-size">${[['A4', 'A4'], ['A5', 'A5'], ['Letter', 'Letter'], ['Legal', 'Legal'], ['Receipt80', '80 mm receipt']].map(([value, label]) => `<option value="${value}" ${value === data.pageSize ? 'selected' : ''}>${esc(label)}</option>`).join('')}</select>
      </label>
    </div>
    <iframe class="print-preview-frame" sandbox="" title="Print preview" srcdoc="${attr(markup)}"></iframe>
    <div class="modal-footer">
      <button class="btn btn-link" data-action="close-modal">Close</button>
      <button class="btn btn-secondary" data-action="print-save-pdf">${icon('file', 15)}<span>Save as PDF</span></button>
      <button class="btn btn-primary" data-action="print-send">${icon('printer', 15)}<span>Print…</span></button>
    </div>`;
}
function documentSummary(rows) { return `<div class="summary">${rows.map(([label, value]) => `<div><span class="muted">${esc(label)}</span><strong>${value}</strong></div>`).join('')}</div>`; }

async function printInvoice(inv) {
  return openPrintPreview(`Invoice ${inv.invoiceNumber || ''}`, documentSummary([['Patient', esc(patientName(inv.patientId))], ['Invoice date', dateFull(inv.date)], ['Status', esc(inv.status)]]) +
    `<table class="print-table"><thead><tr><th>Item</th><th>Qty</th><th>Unit price</th><th>Total</th></tr></thead><tbody>${(inv.items || []).map((item) => `<tr><td>${esc(item.name)}</td><td>${item.quantity}</td><td>${currency(item.unitPrice)}</td><td>${currency(item.total)}</td></tr>`).join('')}</tbody></table>` +
    `<div class="summary" style="justify-content:flex-end"><div><span class="muted">Subtotal</span><strong>${currency(inv.subtotal)}</strong></div><div><span class="muted">Discount</span><strong>${currency(inv.discount)}</strong></div><div><span class="muted">Tax</span><strong>${currency(inv.tax)}</strong></div><div><span class="muted">Total</span><strong>${currency(inv.total)}</strong></div></div>`);
}
async function printPayment(payment) {
  const refunded = Number(payment.refundedAmount) || 0;
  return openPrintPreview(`Money receipt ${payment.receiptNumber || ''}`, documentSummary([['Receipt', esc(payment.receiptNumber || '—')], ['Patient', esc(patientName(payment.patientId))], ['Date', dateFull(payment.date)]]) +
    `<h2>Received</h2><p style="font-size:24px;font-weight:700">${currency(Math.max(0, (Number(payment.amount) || 0) - refunded))}</p>${refunded ? `<p>Refunded / reversed: ${currency(refunded)}</p>` : ''}<p>Payment method: <b>${esc(payment.method || '—')}</b><br>Reference: ${esc(payment.reference || '—')}<br>Status: ${esc(payment.status || 'Recorded')}</p>`, 'Receipt80');
}
async function printPrescription(rx) {
  return openPrintPreview(`Prescription ${rx.prescriptionCode || ''}`, documentSummary([['Patient', esc(patientName(rx.patientId))], ['Date', dateFull(rx.date)], ['Prescriber', esc(rx.doctor || appState.settings.dentistName || '')]]) +
    `<table class="print-table"><thead><tr><th>Medicine</th><th>Dosage</th><th>Frequency</th><th>Duration</th><th>Instructions</th></tr></thead><tbody>${(rx.medications || []).map((m) => `<tr><td>${esc(m.medicine)}<br>${esc(m.strength || '')}</td><td>${esc(m.dosage || '—')}</td><td>${esc(m.frequency || '—')}</td><td>${esc(m.duration || '—')}</td><td>${esc(m.instructions || '')}</td></tr>`).join('')}</tbody></table><p style="margin-top:40px">${esc(rx.notes || '')}</p>`);
}
async function printPatient(patient) {
  const visits = (await q('list', { collection: 'visits', page: 1, pageSize: 100, filters: { patientId: patient.id }, sort: 'date-desc' })).rows || [];
  return openPrintPreview(`Patient summary — ${patient.fullName}`, documentSummary([['Patient code', esc(patient.patientCode || '—')], ['Phone', esc(patient.phone || '—')], ['Registration', dateFull(patient.registrationDate)]]) +
    `<h2>Patient details</h2><table class="print-table"><tbody><tr><th>Date of birth</th><td>${patient.dateOfBirth ? dateFull(patient.dateOfBirth) : '—'}</td><th>Gender</th><td>${esc(patient.gender || '—')}</td></tr><tr><th>Allergies</th><td>${esc(patient.allergies || 'None recorded')}</td><th>Blood group</th><td>${esc(patient.bloodGroup || '—')}</td></tr><tr><th>Address</th><td colspan="3">${esc([patient.address, patient.city, patient.district].filter(Boolean).join(', ') || '—')}</td></tr></tbody></table>` +
    `<h2>Visit history</h2>${visits.length ? `<table class="print-table"><thead><tr><th>Date</th><th>Reason</th><th>Diagnosis</th><th>Treatment</th></tr></thead><tbody>${visits.map((v) => `<tr><td>${dateFull(v.date)}</td><td>${esc(v.reason || '—')}</td><td>${esc(v.diagnosis || '—')}</td><td>${esc(v.treatmentPerformed || '—')}</td></tr>`).join('')}</tbody></table>` : '<p>No visits recorded.</p>'}`);
}
async function printPatientStatement(patient) {
  const statement = await q('patientStatement', { patientId: patient.id });
  const entries = statement.rows || [];
  const balance = statement.balanceCents || 0;
  return openPrintPreview(`Financial statement — ${patient.fullName}`, documentSummary([['Patient', esc(patient.fullName)], ['Patient code', esc(patient.patientCode || '—')], ['Balance', currency(centsToMoney(balance))]]) +
    (entries.length ? `<table class="print-table"><thead><tr><th>Date</th><th>Type</th><th>Reference</th><th>Debit</th><th>Credit</th><th>Balance</th></tr></thead><tbody>${entries.map((entry) => `<tr><td>${dateFull(entry.date)}</td><td>${esc(entry.type)}</td><td>${esc(entry.reference)}</td><td>${entry.debit > 0 ? currency(centsToMoney(entry.debitCents ?? entry.debit)) : ''}</td><td>${entry.credit > 0 ? currency(centsToMoney(entry.creditCents ?? entry.credit)) : ''}</td><td>${currency(centsToMoney(entry.balanceCents ?? entry.balance))}</td></tr>`).join('')}</tbody></table>` : '<p>No financial activity recorded.</p>'));
}
async function printQueue() {
  const day = await q('appointmentDay', { date: today() });
  const queue = (day.appointments || []).filter((a) => a.status !== 'Cancelled').sort((a, b) => (a.time || '').localeCompare(b.time || ''));
  return openPrintPreview('Today’s Queue', documentSummary([['Date', dateFull(today())], ['Appointments', queue.length]]) +
    (queue.length ? `<table class="print-table"><thead><tr><th>Serial</th><th>Time</th><th>Patient</th><th>Reason</th><th>Chair</th><th>Status</th></tr></thead><tbody>${queue.map((a, i) => `<tr><td>${esc(a.serial || `Q-${String(i + 1).padStart(3, '0')}`)}</td><td>${time(a.time)}</td><td>${esc(patientName(a.patientId))}</td><td>${esc(a.reason || '—')}</td><td>${esc(a.chair || 'Chair 1')}</td><td>${esc(a.status || 'Scheduled')}</td></tr>`).join('')}</tbody></table>` : '<p>No appointments scheduled today.</p>'));
}
async function printBilling() {
  const invoices = (await q('list', { collection: 'invoices', page: 1, pageSize: 2000 })).rows || [];
  const payments = (await q('list', { collection: 'payments', page: 1, pageSize: 2000 })).rows || [];
  const billed = invoices.reduce((sum, i) => sum + (i.totalCents ?? 0), 0);
  const collected = payments.reduce((sum, p) => sum + Math.max(0, (p.amountCents ?? 0) - (p.refundedCents ?? 0)), 0);
  const outstanding = invoices.reduce((sum, i) => sum + (i.dueCents ?? 0), 0);
  return openPrintPreview('Billing statement', documentSummary([['Total billed', currency(centsToMoney(billed))], ['Collected', currency(centsToMoney(collected))], ['Outstanding', currency(centsToMoney(outstanding))]]) +
    (invoices.length ? `<table class="print-table"><thead><tr><th>Invoice</th><th>Patient</th><th>Date</th><th>Total</th><th>Paid</th><th>Due</th></tr></thead><tbody>${invoices.map((i) => `<tr><td>${esc(i.invoiceNumber)}</td><td>${esc(patientName(i.patientId))}</td><td>${dateFull(i.date)}</td><td>${currency(centsToMoney(i.totalCents ?? i.total))}</td><td>${currency(centsToMoney(i.paidCents ?? i.paid))}</td><td>${currency(centsToMoney(i.dueCents ?? i.due))}</td></tr>`).join('')}</tbody></table>` : '<p>No invoices created.</p>'));
}
async function printVisit(visit) {
  return openPrintPreview(`Visit ${visit.visitCode || ''} — ${patientName(visit.patientId)}`, documentSummary([['Patient', esc(patientName(visit.patientId))], ['Date', dateFull(visit.date)], ['Dentist', esc(staffName(visit.dentistId))]]) +
    `<table class="print-table"><tbody><tr><th>Reason</th><td>${esc(visit.reason || '—')}</td></tr><tr><th>Chief complaint</th><td>${esc(visit.chiefComplaint || '—')}</td></tr><tr><th>Findings</th><td>${esc(visit.findings || '—')}</td></tr><tr><th>Diagnosis</th><td>${esc(visit.diagnosis || '—')}</td></tr><tr><th>Treatment performed</th><td>${esc(visit.treatmentPerformed || '—')}</td></tr><tr><th>Notes</th><td>${esc(visit.notes || '—')}</td></tr></tbody></table>`);
}
async function printDentalChart(patient) {
  const history = await q('dentalHistory', { patientId: patient.id });
  const teeth = {};
  for (const record of history.records || []) {
    if (record.superseded) continue;
    teeth[`${record.dentition || 'adult'}:${record.tooth}`] = record;
  }
  const rows = [['adult', 32, 'Permanent'], ['primary', 16, 'Primary']].map(([dentition, count, label]) => `<h2>${label} dentition</h2><table class="print-table"><tbody><tr>${Array.from({ length: count }, (_, i) => i + 1).map((tooth) => `<td style="text-align:center"><b>${tooth}</b><br><small>${esc(teeth[`${dentition}:${tooth}`]?.status || '')}</small>${teeth[`${dentition}:${tooth}`]?.note ? `<br><small>${esc(String(teeth[`${dentition}:${tooth}`].note).slice(0, 40))}</small>` : ''}</td>`).join('')}</tr></tbody></table>`).join('');
  return openPrintPreview(`Dental chart — ${patient.fullName}`, documentSummary([['Patient', esc(patient.fullName)], ['Patient code', esc(patient.patientCode || '—')], ['Date', dateFull(today())]]) + rows);
}
async function printExpense(expense) {
  return openPrintPreview('Expense record', documentSummary([['Date', dateFull(expense.date)], ['Category', esc(expense.category || 'Other')], ['Amount', currency(expense.amount)]]) +
    `<table class="print-table"><tbody><tr><th>Description</th><td>${esc(expense.description)}</td></tr><tr><th>Payment method</th><td>${esc(expense.method || '—')}</td></tr><tr><th>Reference</th><td>${esc(expense.reference || '—')}</td></tr><tr><th>Notes</th><td>${esc(expense.notes || '—')}</td></tr></tbody></table>`);
}
async function printAppointmentSlip(a) {
  return openPrintPreview(`Appointment slip ${a.appointmentCode || ''}`, documentSummary([
    ['Patient', esc(patientName(a.patientId))], ['Date', dateFull(a.date)], ['Time', time(a.time)], ['Serial', esc(a.serial || '—')]
  ]) + `<table class="print-table"><tbody><tr><th>Appointment</th><td>${esc(a.appointmentCode || '—')}</td></tr><tr><th>Dentist</th><td>${esc(staffName(a.dentistId))}</td></tr><tr><th>Chair / Room</th><td>${esc(a.chair || '—')} · ${esc(a.room || '—')}</td></tr><tr><th>Reason</th><td>${esc(a.reason || '—')}</td></tr><tr><th>Status</th><td>${esc(a.status || 'Scheduled')}</td></tr></tbody></table><p>Please arrive 10 minutes early and bring this slip.</p>`, 'Receipt80');
}
async function printEstimate(plan) {
  const stages = plan.stages || [];
  const total = plan.estimatedTotalCents ?? 0;
  const stageCost = (stage) => {
    const raw = Number(stage.estimatedCost) || 0;
    return currency(centsToMoney(raw > 0 && raw < 1000 ? Math.round(raw * 100) : raw));
  };
  return openPrintPreview(`Treatment estimate — ${patientName(plan.patientId)}`, documentSummary([
    ['Plan', esc(plan.title || '—')], ['Patient', esc(patientName(plan.patientId))], ['Estimated total', currency(centsToMoney(total))]
  ]) + (stages.length
    ? `<table class="print-table"><thead><tr><th>Stage</th><th>Planned date</th><th>Status</th><th>Estimated cost</th></tr></thead><tbody>${stages.map((stage, i) => `<tr><td>Stage ${i + 1} — ${esc(stage.title)}</td><td>${stage.plannedDate ? dateFull(stage.plannedDate) : '—'}</td><td>${esc(stage.status || 'Planned')}</td><td>${stageCost(stage)}</td></tr>`).join('')}</tbody></table>`
    : '<p>No priced stages recorded.</p>')
  + `<div class="summary" style="justify-content:flex-end"><div><span class="muted">Estimated total</span><strong>${currency(centsToMoney(total))}</strong></div></div><p><small>This is an estimate prepared for planning. It is not an invoice; final charges are billed after treatment.</small></p>`);
}
async function printReportDocument() {
  const type = ui.reportType || 'revenue';
  const rangeKey = ui.reportsRange === 'custom' ? 'custom' : ui.reportsRange;
  const report = await q('report', { type, rangeKey, from: ui.rangeFrom || undefined, to: ui.rangeTo || undefined, page: 1, pageSize: 500 });
  if (!report) return notify('The report could not be loaded for printing.', 'error');
  const kpis = report.kpis || {};
  const rows = (report.rows?.rows) || [];
  const label = { revenue: 'Revenue', patients: 'Patients', visits: 'Visits', appointments: 'Appointments', outstanding: 'Outstanding', inventory: 'Inventory', expenses: 'Expenses' }[type] || 'Report';
  const table = (headers, bodyHtml) => rows.length ? `<table class="print-table"><thead><tr>${headers.map((h) => `<th>${esc(h)}</th>`).join('')}</tr></thead><tbody>${bodyHtml}</tbody></table>` : '<p>No records in this range.</p>';
  const tr = (cells) => `<tr>${cells.map((c) => `<td>${c}</td>`).join('')}</tr>`;
  let kpiPairs = [];
  let body = '';
  if (type === 'revenue') { kpiPairs = [['Collected', currency(kpis.collectedCents)], ['Billed', currency(kpis.billedCents)], ['Expenses', currency(kpis.expensesCents)]]; body = table(['Receipt', 'Patient', 'Date', 'Method', 'Amount'], rows.map((r) => tr([esc(r.receiptNumber || '—'), esc(patientName(r.patientId)), dateFull(r.date), esc(r.method || '—'), money(r)])).join('')); }
  else if (type === 'patients') { kpiPairs = [['Registered', number(kpis.registered ?? 0)], ['With phone', number(kpis.withPhone ?? 0)], ['Upcoming visits', number(kpis.upcoming ?? 0)]]; body = table(['Patient', 'Phone', 'Registered', 'Balance'], rows.map((r) => tr([esc(r.fullName), esc(r.phone || '—'), dateFull(r.registrationDate), currency(centsToMoney(r.balanceCents || 0))])).join('')); }
  else if (type === 'visits') { kpiPairs = [['Visits', number(kpis.visits ?? 0)], ['Unique patients', number(kpis.uniquePatients ?? 0)], ['With follow-up', number(kpis.withFollowUp ?? 0)]]; body = table(['Visit', 'Patient', 'Date', 'Reason', 'Diagnosis'], rows.map((r) => tr([esc(r.visitCode || '—'), esc(patientName(r.patientId)), dateFull(r.date), esc(r.reason || '—'), esc(r.diagnosis || '—')])).join('')); }
  else if (type === 'appointments') { kpiPairs = [['Appointments', number(kpis.appointments ?? 0)], ['Completed', number(kpis.completed ?? 0)], ['No shows', number(kpis.noShows ?? 0)]]; body = table(['Code', 'Patient', 'Date', 'Time', 'Reason', 'Status'], rows.map((r) => tr([esc(r.appointmentCode || '—'), esc(patientName(r.patientId)), dateFull(r.date), time(r.time), esc(r.reason || '—'), esc(r.status || 'Scheduled')])).join('')); }
  else if (type === 'outstanding') { kpiPairs = [['Outstanding', currency(kpis.dueCents ?? 0)], ['Open invoices', number(kpis.openInvoices ?? 0)]]; body = table(['Invoice', 'Patient', 'Date', 'Total', 'Due'], rows.map((r) => tr([esc(r.invoiceNumber || '—'), esc(patientName(r.patientId)), dateFull(r.date), currency(centsToMoney(r.totalCents ?? r.total)), currency(centsToMoney(r.dueCents ?? r.due))])).join('')); }
  else if (type === 'inventory') { kpiPairs = [['Items tracked', number(kpis.itemsTracked ?? 0)], ['Low stock', number(kpis.lowStock ?? 0)], ['Stock value', currency(kpis.stockValueCents ?? 0)]]; body = table(['Item', 'Category', 'On hand', 'Value'], rows.map((r) => tr([esc(r.name), esc(r.category || 'Other'), `${number(r.currentStock)} ${esc(r.unit || '')}`, currency(centsToMoney(r.purchasePriceCents ?? 0) * Number(r.currentStock || 0))])).join('')); }
  else { kpiPairs = [['Total', currency(kpis.totalCents ?? 0)], ['Transactions', number(kpis.transactions ?? 0)]]; body = table(['Date', 'Description', 'Category', 'Method', 'Amount'], rows.map((r) => tr([dateFull(r.date), esc(r.description), esc(r.category || 'Other'), esc(r.method || '—'), money(r)])).join('')); }
  const rangeText = rangeKey === 'custom' && ui.rangeFrom ? `${ui.rangeFrom} – ${ui.rangeTo || ui.rangeFrom}` : String(rangeKey);
  return openPrintPreview(`${label} report (${rangeText})`, documentSummary(kpiPairs) + body + `<p><small>${rows.length} row(s); every figure traces to the underlying records for ${esc(rangeText)}.</small></p>`);
}

async function openInvoiceDetail(invoice) {
  const [payments, adjustments] = await Promise.all([
    q('list', { collection: 'payments', page: 1, pageSize: 100, filters: { invoiceId: invoice.id }, sort: 'date-desc' }),
    q('list', { collection: 'paymentAdjustments', page: 1, pageSize: 100, filters: { invoiceId: invoice.id }, sort: 'date-desc' })
  ]);
  const paidCents = (payments.rows || []).reduce((sum, p) => sum + (p.amountCents ?? 0), 0);
  const refundedCents = (payments.rows || []).reduce((sum, p) => sum + (p.refundedCents ?? 0), 0);
  const netPaidCents = Math.max(0, paidCents - refundedCents);
  const adjustedCents = (adjustments.rows || []).filter((a) => a.type === 'Adjustment').reduce((sum, a) => sum + (a.amountCents ?? 0), 0);
  const dueCents = Math.max(0, (invoice.totalCents ?? 0) - netPaidCents - adjustedCents);
  ui.modal = { type: 'invoiceDetail', data: { invoice, payments: payments.rows || [], adjustments: adjustments.rows || [], netPaidCents, refundedCents, adjustedCents, dueCents } };
  render();
}

/* ------------------------------------------------------------------ */
/* Boot                                                                */
/* ------------------------------------------------------------------ */
let permissionGroups = [];
async function refreshDirectory() {
  try {
    const directory = await q('directory', {});
    if (directory) {
      appState.directory = { patients: directory.patients || [], staff: directory.staff || [], treatments: directory.treatments || [] };
      appState.medicationCatalog = directory.medicationCatalog || [];
    }
  } catch { /* keep last directory */ }
}
function permissionGroupsHtml(prechecked = null) {
  return permissionGroups.map(([group, permissions]) => `<div class="permission-group"><h4>${esc(group)}</h4>${permissions.map((permission) => `<label class="permission-option"><input type="checkbox" name="permissions" value="${attr(permission)}" ${prechecked?.has(permission) ? 'checked' : ''}><span>${esc(permission.replaceAll('.', ' · '))}</span></label>`).join('')}</div>`).join('');
}
async function initPermissionGroups() {
  const core = await import('./core.js');
  const groups = {};
  for (const permission of core.PERMISSIONS || []) {
    const head = String(permission).split('.')[0];
    (groups[head] = groups[head] || []).push(permission);
  }
  permissionGroups = Object.entries(groups).map(([key, list]) => [key, list]);
}
async function boot() {
  app.innerHTML = `<div class="boot-screen"><div class="boot-spinner"></div><p>Opening your local workspace…</p></div>`;
  const result = await api.bootstrap();
  if (!result || !result.ok) {
    app.innerHTML = `<div class="boot-screen"><h1>Dentiva Pro could not start</h1><p>${esc(result?.error || 'The local workspace is unavailable.')} If this continues, check disk space or restore from a verified backup.</p></div>`;
    return;
  }
  appState.boot = result;
  appState.session = result.session;
  appState.firstRun = Boolean(result.firstRun);
  appState.setupComplete = Boolean(result.setupComplete);
  appState.settings = result.settings || {};
  appState.unsupportedSchema = Boolean(result.unsupportedSchema);
  appState.migrationError = result.migrationError || '';
  appState.storage = result.storage || null;
  appState.counts = result.counts || {};
  ui.unlockUserId = result.session?.userId || (result.userDirectory || [])[0]?.id || '';
  await refreshDirectory();
  await loadNotifications();
  startNotificationInterval();
  appState.ready = true;
  render();
  if (appState.firstRun && !appState.setupComplete) {
    ui.modal = { type: 'setup', data: { step: 1 } };
    render();
  }
}
function render() {
  document.title = `${appState.unsupportedSchema ? 'Upgrade required' : requiresLogin() ? 'Sign in' : ui.locked ? 'Workspace locked' : pageTitle()} · Dentiva Pro`;
  app.innerHTML = shell();
  const main = document.querySelector('#main-content');
  if (!main) return;
  if (appState.unsupportedSchema) { main.innerHTML = unsupportedSchemaScreen(); translateDom(); return; }
  if (requiresLogin()) { main.innerHTML = authScreen(); translateDom(); return; }
  if (ui.locked) { main.innerHTML = lockScreen(); translateDom(); return; }
  main.innerHTML = `<div class="page-loading"><div class="boot-spinner small"></div></div>`;
  renderPage().then((html) => {
    const current = document.querySelector('#main-content');
    if (current) current.innerHTML = html;
    translateDom();
  }).catch((error) => {
    console.error(error);
    const current = document.querySelector('#main-content');
    if (current) current.innerHTML = `<div class="empty-state"><h3>View could not be loaded</h3><p>${esc(error?.message || 'Unexpected error.')}</p><button class="btn btn-primary" data-action="retry-page">Retry</button></div>`;
  });
}

/* ------------------------------------------------------------------ */
/* Event wiring (delegated — survives re-renders)                      */
/* ------------------------------------------------------------------ */
document.addEventListener('submit', handleSubmit);
document.addEventListener('click', handleClick);
document.addEventListener('input', handleInput);
document.addEventListener('change', (event) => {
  if (event.target && event.target.type === 'file') handleFilePick(event);
  else handleChange(event);
});
document.addEventListener('keydown', handleKeydown);

/* idle lock — application lockout after autoLockMinutes without interaction */
const IDLE_EVENTS = ['pointerdown', 'pointermove', 'keydown', 'wheel', 'touchstart'];
let idleLastActivity = performance.now();
let idleWatch = null;
function idleLockMinutes() {
  const minutes = Number(appState.settings?.autoLockMinutes || 0);
  return Number.isFinite(minutes) && minutes > 0 ? minutes : 0;
}
function idleTick() {
  const minutes = idleLockMinutes();
  if (!minutes || ui.locked || requiresLogin() || appState.unsupportedSchema) return;
  if (performance.now() - idleLastActivity >= minutes * 60000) {
    ui.locked = true;
    ui.modal = null;
    notify(`Workspace locked after ${minutes} min without activity.`, 'info');
    render();
  }
}
function armIdleLock() {
  IDLE_EVENTS.forEach((name) => document.addEventListener(name, () => { idleLastActivity = performance.now(); }, { passive: true }));
  idleWatch = window.setInterval(idleTick, 15000);
}

window.addEventListener('DOMContentLoaded', () => {
  initPermissionGroups();
  armIdleLock();
  boot();
});
