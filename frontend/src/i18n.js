// Lightweight i18n. Add translations by extending the dictionary.
export const translations = {
  en: {
    login: 'Sign in', email: 'Email', password: 'Password', otp: 'One-time password',
    dashboard: 'Dashboard', leads: 'Leads', pipeline: 'Pipeline', projects: 'Projects',
    inventory: 'Inventory', customers: 'Customers', employees: 'Employees', finance: 'Finance',
    marketing: 'Marketing', reports: 'Reports', settings: 'Settings', users: 'Users & Roles',
    audit: 'Audit Log', support: 'Support', logout: 'Logout', portal: 'Customer Portal',
    search: 'Search', add: 'Add', export: 'Export', save: 'Save', cancel: 'Cancel', close: 'Close',
    loading: 'Loading...', noData: 'No data yet', name: 'Name', phone: 'Phone', email: 'Email',
    source: 'Source', priority: 'Priority', status: 'Status', owner: 'Owner', stage: 'Stage',
    budget: 'Budget', area: 'Area', city: 'City', created: 'Created', actions: 'Actions',
    followups: 'Follow-ups', sitevisits: 'Site Visits', newLead: 'New Lead', view: 'View',
    edit: 'Edit', delete: 'Delete', assign: 'Assign', totalLeads: 'Total Leads',
    active: 'Active', newToday: 'New Today', bookings: 'Bookings', revenue: 'Revenue'
  },
  hi: {
    login: 'साइन इन करें', email: 'ईमेल', password: 'पासवर्ड', otp: 'वन-टाइम पासवर्ड',
    dashboard: 'डैशबोर्ड', leads: 'लीड्स', pipeline: 'पाइपलाइन', projects: 'प्रोजेक्ट',
    inventory: 'इन्वेंटरी', customers: 'ग्राहक', employees: 'कर्मचारी', finance: 'वित्त',
    marketing: 'मार्केटिंग', reports: 'रिपोर्ट', settings: 'सेटिंग्स', users: 'यूज़र और भूमिकाएं',
    audit: 'ऑडिट लॉग', support: 'सहायता', logout: 'लॉगआउट', portal: 'ग्राहक पोर्टल',
    search: 'खोजें', add: 'जोड़ें', export: 'निर्यात', save: 'सहेजें', cancel: 'रद्द करें',
    close: 'बंद करें', loading: 'लोड हो रहा है...', noData: 'अभी कोई डेटा नहीं',
    name: 'नाम', phone: 'फ़ोन', email: 'ईमेल', source: 'स्रोत', priority: 'प्राथमिकता',
    status: 'स्थिति', owner: 'मालिक', stage: 'चरण', budget: 'बजट', area: 'क्षेत्र',
    city: 'शहर', created: 'बनाया गया', actions: 'क्रियाएँ', newLead: 'नई लीड'
  }
};

export function t(lang, key) {
  return (translations[lang] && translations[lang][key]) || translations.en[key] || key;
}
