// RBAC permission catalog + default matrices for every role.
// Permissions are keyed `module.action` and are overridable per company.

export const PERMISSION_CATALOG = [
  { key: 'dashboard.view', label: 'View Dashboard', group: 'Dashboard' },
  { key: 'dashboard.custom', label: 'Custom Dashboards', group: 'Dashboard' },
  { key: 'lead.view', label: 'View Leads', group: 'Leads' },
  { key: 'lead.create', label: 'Create Leads', group: 'Leads' },
  { key: 'lead.edit', label: 'Edit Leads', group: 'Leads' },
  { key: 'lead.delete', label: 'Delete Leads', group: 'Leads' },
  { key: 'lead.assign', label: 'Assign Leads', group: 'Leads' },
  { key: 'lead.transfer', label: 'Transfer Leads', group: 'Leads' },
  { key: 'lead.export', label: 'Export Leads', group: 'Leads' },
  { key: 'lead.import', label: 'Import Leads', group: 'Leads' },
  { key: 'lead.merge', label: 'Merge Duplicates', group: 'Leads' },
  { key: 'pipeline.view', label: 'View Pipeline', group: 'Leads' },
  { key: 'pipeline.manage', label: 'Manage Pipeline Stages', group: 'Leads' },
  { key: 'project.view', label: 'View Projects', group: 'Master Data' },
  { key: 'project.create', label: 'Create Projects', group: 'Master Data' },
  { key: 'project.edit', label: 'Edit Projects', group: 'Master Data' },
  { key: 'project.delete', label: 'Delete Projects', group: 'Master Data' },
  { key: 'inventory.view', label: 'View Inventory', group: 'Master Data' },
  { key: 'inventory.create', label: 'Create Inventory', group: 'Master Data' },
  { key: 'inventory.edit', label: 'Edit Inventory', group: 'Master Data' },
  { key: 'inventory.delete', label: 'Delete Inventory', group: 'Master Data' },
  { key: 'inventory.reserve', label: 'Reserve Units', group: 'Master Data' },
  { key: 'customer.view', label: 'View Customers', group: 'Customers' },
  { key: 'customer.create', label: 'Create Customers', group: 'Customers' },
  { key: 'customer.edit', label: 'Edit Customers', group: 'Customers' },
  { key: 'customer.kyc', label: 'Approve KYC', group: 'Customers' },
  { key: 'customer.export', label: 'Export Customers', group: 'Customers' },
  { key: 'activity.view', label: 'View Activities', group: 'Activities' },
  { key: 'activity.create', label: 'Log Activities', group: 'Activities' },
  { key: 'activity.edit', label: 'Edit Activities', group: 'Activities' },
  { key: 'sitevisit.view', label: 'View Site Visits', group: 'Activities' },
  { key: 'sitevisit.approve', label: 'Verify Site Visits', group: 'Activities' },
  { key: 'employee.view', label: 'View Employees', group: 'HR' },
  { key: 'employee.create', label: 'Create Employees', group: 'HR' },
  { key: 'employee.edit', label: 'Edit Employees', group: 'HR' },
  { key: 'employee.delete', label: 'Delete Employees', group: 'HR' },
  { key: 'employee.export', label: 'Export Employees', group: 'HR' },
  { key: 'employee.salary', label: 'View Salary', group: 'HR' },
  { key: 'employee.attendance', label: 'Manage Attendance', group: 'HR' },
  { key: 'hr.leave', label: 'Manage Leave', group: 'HR' },
  { key: 'hr.payroll', label: 'View Payroll', group: 'HR' },
  { key: 'finance.view', label: 'View Finance', group: 'Finance' },
  { key: 'finance.create', label: 'Record Payments', group: 'Finance' },
  { key: 'finance.edit', label: 'Edit Finance', group: 'Finance' },
  { key: 'finance.approve', label: 'Approve Finance', group: 'Finance' },
  { key: 'finance.export', label: 'Export Finance', group: 'Finance' },
  { key: 'finance.invoice', label: 'Create Invoices', group: 'Finance' },
  { key: 'vendor.manage', label: 'Manage Vendors', group: 'Finance' },
  { key: 'commission.view', label: 'View Commissions', group: 'Finance' },
  { key: 'commission.edit', label: 'Manage Commissions', group: 'Finance' },
  { key: 'partner.view', label: 'View Partners', group: 'Channel' },
  { key: 'partner.create', label: 'Create Partners', group: 'Channel' },
  { key: 'partner.edit', label: 'Edit Partners', group: 'Channel' },
  { key: 'marketing.view', label: 'View Marketing', group: 'Marketing' },
  { key: 'marketing.create', label: 'Create Campaigns', group: 'Marketing' },
  { key: 'marketing.edit', label: 'Edit Campaigns', group: 'Marketing' },
  { key: 'report.view', label: 'View Reports', group: 'Reports' },
  { key: 'report.export', label: 'Export Reports', group: 'Reports' },
  { key: 'report.schedule', label: 'Schedule Reports', group: 'Reports' },
  { key: 'notification.view', label: 'View Notifications', group: 'System' },
  { key: 'audit.view', label: 'View Audit Logs', group: 'System' },
  { key: 'settings.view', label: 'View Settings', group: 'System' },
  { key: 'settings.edit', label: 'Edit Settings', group: 'System' },
  { key: 'settings.users', label: 'Manage Users & Roles', group: 'System' },
  { key: 'api.key', label: 'Manage API Keys', group: 'System' },
  { key: 'support.view', label: 'Support Tickets', group: 'System' },
  { key: 'portal.view', label: 'Customer Portal', group: 'System' },
  { key: 'org.view', label: 'View Organization', group: 'Organization' },
  { key: 'org.manage', label: 'Manage Departments & Teams', group: 'Organization' },
  { key: 'org.members', label: 'Assign Team Members', group: 'Organization' },
  { key: 'task.view', label: 'View Tasks', group: 'Organization' },
  { key: 'task.assign', label: 'Assign Tasks', group: 'Organization' },
  { key: 'task.edit', label: 'Edit Tasks', group: 'Organization' },
  { key: 'cross.access', label: 'Grant Cross-Department Access', group: 'Organization' },
  { key: 'gps.view', label: 'View GPS Tracking', group: 'Field Force' },
  { key: 'gps.own', label: 'View Own GPS', group: 'Field Force' },
  { key: 'chat.use', label: 'Internal Chat', group: 'Communication' },
  { key: 'chat.moderate', label: 'Moderate Chat', group: 'Communication' },
  { key: 'support.chat', label: 'Customer Support Chat', group: 'Communication' },
  { key: 'listing.view', label: 'View Listings', group: 'Listings' },
  { key: 'listing.create', label: 'Create Listings', group: 'Listings' },
  { key: 'listing.edit', label: 'Edit Listings', group: 'Listings' },
  { key: 'listing.import', label: 'Import Listings', group: 'Listings' },
  { key: 'listing.export', label: 'Export Listings', group: 'Listings' },
  { key: 'loan.view', label: 'View Home Loans', group: 'Loans' },
  { key: 'loan.create', label: 'Create Home Loans', group: 'Loans' },
  { key: 'loan.edit', label: 'Edit Home Loans', group: 'Loans' },
  { key: 'loan.export', label: 'Export Home Loans', group: 'Loans' },
  { key: 'billing.export', label: 'Export Billings', group: 'Finance' },
  { key: 'backup.manage', label: 'Manage Backups', group: 'System' },
  { key: 'subbroker.view', label: 'View Sub-brokers', group: 'Channel' },
  { key: 'subbroker.create', label: 'Create Sub-brokers', group: 'Channel' },
  { key: 'subbroker.edit', label: 'Edit Sub-brokers', group: 'Channel' }
];

export const ROLES = [
  'super_admin',
  'company_admin',
  'ceo',
  'hod',
  'sr_manager',
  'manager',
  'assistant_manager',
  'team_lead',
  'sr_executive',
  'executive',
  'director',
  'general_manager',
  'sales_manager',
  'team_leader',
  'sales_executive',
  'telecaller',
  'marketing_manager',
  'finance_manager',
  'hr_manager',
  'accounts_executive',
  'operations_manager',
  'legal',
  'channel_partner',
  'customer',
  'guest'
];

export const ROLE_LABELS = {
  super_admin: 'Super Admin',
  company_admin: 'Company Owner / Admin',
  ceo: 'CEO',
  hod: 'Department Head (HOD)',
  sr_manager: 'Senior Manager',
  manager: 'Manager',
  assistant_manager: 'Assistant Manager',
  team_lead: 'Team Lead',
  sr_executive: 'Senior Executive',
  executive: 'Executive',
  director: 'Director',
  general_manager: 'General Manager',
  sales_manager: 'Sales Manager',
  team_leader: 'Team Leader',
  sales_executive: 'Sales Executive',
  telecaller: 'Telecaller',
  marketing_manager: 'Marketing Manager',
  finance_manager: 'Finance Manager',
  hr_manager: 'HR Manager',
  accounts_executive: 'Accounts Executive',
  operations_manager: 'Operations Manager',
  legal: 'Legal Team',
  channel_partner: 'Channel Partner',
  customer: 'Customer',
  guest: 'Guest'
};

// ---- Data scope level per role (used by lib/scope.js) ----
// all: entire company | department: own dept + cross-access grants |
// teams: teams led by user | own: only the user's own records
export const ROLE_SCOPE = {
  super_admin: 'all',
  company_admin: 'all',
  ceo: 'all',
  director: 'all',
  general_manager: 'all',
  marketing_manager: 'all',
  finance_manager: 'all',
  hr_manager: 'all',
  accounts_executive: 'all',
  operations_manager: 'all',
  legal: 'all',
  hod: 'department',
  sr_manager: 'department',
  manager: 'teams',
  assistant_manager: 'teams',
  team_lead: 'teams',
  sales_manager: 'teams',
  team_leader: 'teams',
  sr_executive: 'own',
  executive: 'own',
  sales_executive: 'own',
  telecaller: 'own',
  channel_partner: 'own',
  customer: 'own',
  guest: 'own'
};

const ALL = PERMISSION_CATALOG.map((p) => p.key);

const MANAGER_CORE = [
  'dashboard.view', 'dashboard.custom',
  'lead.view', 'lead.create', 'lead.edit', 'lead.assign', 'lead.transfer', 'lead.export', 'lead.import', 'lead.merge',
  'pipeline.view', 'pipeline.manage',
  'project.view', 'inventory.view', 'inventory.reserve',
  'customer.view', 'customer.create', 'customer.edit', 'customer.export',
  'activity.view', 'activity.create', 'activity.edit', 'sitevisit.view', 'sitevisit.approve',
  'employee.view',
  'report.view', 'report.export', 'report.schedule',
  'marketing.view',
  'notification.view', 'audit.view',
  'partner.view', 'commission.view',
  'loan.view', 'loan.create',
  'support.view', 'portal.view'
];

const SUBBROKER_ALL = ['subbroker.view', 'subbroker.create', 'subbroker.edit'];

export const DEFAULT_PERMISSIONS = {
  super_admin: ALL,
  company_admin: [...ALL],
  ceo: [...ALL],
  director: [...MANAGER_CORE, 'finance.view', 'commission.view', 'loan.view', 'loan.create', 'loan.edit', 'loan.export', 'billing.export', 'employee.export', 'listing.export', 'backup.manage', ...SUBBROKER_ALL],
  general_manager: [...MANAGER_CORE, 'finance.view', 'commission.view', 'employee.salary', 'loan.view', 'loan.create', 'loan.edit', 'loan.export', 'billing.export', 'employee.export', 'listing.export', 'backup.manage', ...SUBBROKER_ALL],
  // Department head: full dept scope, can manage teams/members/tasks within dept
  hod: [...MANAGER_CORE, 'org.view', 'org.manage', 'org.members', 'task.view', 'task.assign', 'task.edit', 'gps.view', 'chat.use', 'chat.moderate', 'support.chat', 'employee.view', 'employee.create', 'employee.edit', 'employee.export', 'loan.edit', 'loan.export', 'billing.export', 'listing.export', ...SUBBROKER_ALL],
  // Senior manager: dept-wide, assign members/tasks, GPS view
  sr_manager: ['dashboard.view', 'lead.view', 'lead.create', 'lead.edit', 'lead.assign', 'lead.export', 'pipeline.view', 'project.view', 'inventory.view', 'customer.view', 'activity.view', 'activity.create', 'sitevisit.view', 'org.view', 'org.members', 'task.view', 'task.assign', 'task.edit', 'gps.view', 'chat.use', 'notification.view', 'report.view', ...SUBBROKER_ALL],
  // Manager: only own teams
  manager: ['dashboard.view', 'lead.view', 'lead.create', 'lead.edit', 'lead.assign', 'pipeline.view', 'project.view', 'inventory.view', 'customer.view', 'activity.view', 'activity.create', 'sitevisit.view', 'org.view', 'org.members', 'task.view', 'task.assign', 'task.edit', 'gps.view', 'chat.use', 'notification.view'],
  assistant_manager: ['dashboard.view', 'lead.view', 'lead.create', 'lead.edit', 'lead.assign', 'pipeline.view', 'project.view', 'customer.view', 'activity.view', 'activity.create', 'sitevisit.view', 'org.view', 'task.view', 'task.assign', 'chat.use', 'notification.view'],
  team_lead: ['dashboard.view', 'lead.view', 'lead.create', 'lead.edit', 'pipeline.view', 'project.view', 'customer.view', 'activity.view', 'activity.create', 'sitevisit.view', 'org.view', 'task.view', 'task.assign', 'chat.use', 'gps.view', 'notification.view'],
  // Senior/regular executives: strictly their own records only (including GPS)
  sr_executive: ['dashboard.view', 'lead.view', 'lead.create', 'lead.edit', 'pipeline.view', 'project.view', 'customer.view', 'activity.view', 'activity.create', 'sitevisit.view', 'gps.own', 'chat.use', 'notification.view'],
  executive: ['dashboard.view', 'lead.view', 'lead.create', 'pipeline.view', 'project.view', 'customer.view', 'activity.view', 'activity.create', 'gps.own', 'chat.use', 'notification.view'],
  sales_manager: [...MANAGER_CORE, 'employee.attendance', 'hr.leave', ...SUBBROKER_ALL],
  team_leader: [...MANAGER_CORE],
  sales_executive: [
    'dashboard.view', 'lead.view', 'lead.create', 'lead.edit',
    'pipeline.view', 'project.view', 'inventory.view', 'inventory.reserve',
    'customer.view', 'customer.create', 'customer.edit',
    'activity.view', 'activity.create', 'activity.edit', 'sitevisit.view',
    'notification.view', 'portal.view'
  ],
  telecaller: [
    'dashboard.view', 'lead.view', 'lead.create', 'lead.edit',
    'project.view', 'inventory.view', 'customer.view',
    'activity.view', 'activity.create', 'notification.view', 'portal.view'
  ],
  marketing_manager: [
    'dashboard.view', 'lead.view', 'lead.export',
    'project.view', 'inventory.view', 'customer.view',
    'report.view', 'report.export',
    'marketing.view', 'marketing.create', 'marketing.edit',
    'notification.view', 'portal.view'
  ],
  finance_manager: [
    'dashboard.view', 'customer.view', 'finance.view', 'finance.create', 'finance.edit', 'finance.approve', 'finance.export', 'finance.invoice',
    'commission.view', 'commission.edit', 'report.view', 'report.export', 'billing.export',
    'loan.view', 'loan.create', 'loan.edit', 'loan.export',
    'vendor.manage',
    'notification.view', 'audit.view', 'portal.view', 'backup.manage', ...SUBBROKER_ALL
  ],
  hr_manager: [
    'dashboard.view', 'employee.view', 'employee.create', 'employee.edit', 'employee.delete', 'employee.export', 'employee.salary', 'employee.attendance',
    'hr.leave', 'hr.payroll', 'report.view', 'notification.view', 'portal.view'
  ],
  accounts_executive: ['dashboard.view', 'finance.view', 'finance.create', 'finance.export', 'finance.invoice', 'billing.export', 'customer.view', 'vendor.manage', 'notification.view', 'portal.view'],
  operations_manager: ['dashboard.view', 'lead.view', 'project.view', 'inventory.view', 'inventory.edit', 'activity.view', 'employee.view', 'report.view', 'notification.view', 'portal.view', ...SUBBROKER_ALL],
  legal: ['dashboard.view', 'customer.view', 'customer.kyc', 'project.view', 'inventory.view', 'finance.view', 'report.view', 'notification.view', 'portal.view'],
  channel_partner: ['dashboard.view', 'lead.view', 'lead.create', 'lead.edit', 'customer.view', 'activity.view', 'activity.create', 'portal.view'],
  customer: ['portal.view'],
  guest: []
};

const allPerms = new Set(ALL);
export function normalizePerms(list) {
  if (!Array.isArray(list)) return [];
  return [...new Set(list.filter((k) => allPerms.has(k)))];
}
