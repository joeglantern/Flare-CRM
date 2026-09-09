/**
 * Sidebar navigation, filtered by role exactly as the App Shell design specifies.
 * Counts come from live queries and are wired in Sidebar.
 */
import {
  Activity,
  BarChart3,
  Building2,
  Contact,
  FileSpreadsheet,
  Inbox,
  Kanban,
  LayoutDashboard,
  Phone,
  Settings,
  SquareCheck,
  Target,
  type LucideIcon,
} from 'lucide-react';
import type { FeatureKey, Permission } from '@crm/shared';

export interface NavItem {
  id: string;
  label: string;
  icon: LucideIcon;
  href: string;
  roles: ('admin' | 'manager' | 'agent')[];
  permission?: Permission;
  /** Hidden when the customer's plan does not include this (docs/20). */
  feature?: FeatureKey;
  /** Which live count feeds the badge. */
  count?: 'leads' | 'tasks' | 'calls' | 'inbox';
}

export const NAV_ITEMS: NavItem[] = [
  {
    id: 'home',
    label: 'Home',
    icon: LayoutDashboard,
    href: '/home',
    roles: ['admin', 'manager', 'agent'],
  },
  {
    id: 'contacts',
    label: 'Contacts',
    icon: Contact,
    href: '/contacts',
    roles: ['admin', 'manager', 'agent'],
    permission: 'contact:read',
  },
  {
    id: 'companies',
    label: 'Companies',
    icon: Building2,
    href: '/companies',
    roles: ['admin', 'manager', 'agent'],
    permission: 'company:read',
  },
  {
    id: 'leads',
    label: 'Leads',
    icon: Target,
    href: '/leads',
    roles: ['admin', 'manager', 'agent'],
    permission: 'lead:read',
    count: 'leads',
    feature: 'leads',
  },
  {
    id: 'deals',
    label: 'Deals',
    icon: Kanban,
    href: '/deals',
    roles: ['admin', 'manager', 'agent'],
    permission: 'deal:read',
    feature: 'deals',
  },
  {
    id: 'tasks',
    label: 'Tasks',
    icon: SquareCheck,
    href: '/tasks',
    roles: ['admin', 'manager', 'agent'],
    permission: 'task:read',
    count: 'tasks',
  },
  {
    id: 'calls',
    label: 'Calls',
    icon: Phone,
    href: '/calls',
    roles: ['admin', 'manager', 'agent'],
    permission: 'call:read',
    count: 'calls',
    feature: 'telephony',
  },
  {
    id: 'live',
    label: 'Live calls',
    icon: Activity,
    href: '/live-calls',
    roles: ['admin', 'manager'],
    permission: 'pbx:view_status',
    feature: 'telephony',
  },
  {
    id: 'inbox',
    label: 'Inbox',
    icon: Inbox,
    href: '/inbox',
    roles: ['admin', 'manager', 'agent'],
    permission: 'chat:read',
    count: 'inbox',
    feature: 'messaging',
  },
  {
    id: 'reports',
    label: 'Reports',
    icon: BarChart3,
    href: '/reports',
    roles: ['admin', 'manager', 'agent'],
    permission: 'report:view_own',
    feature: 'reports',
  },
  {
    id: 'imports',
    label: 'Imports',
    icon: FileSpreadsheet,
    href: '/imports',
    roles: ['admin', 'manager'],
    permission: 'contact:import',
    feature: 'imports',
  },
  {
    id: 'settings',
    label: 'Settings',
    icon: Settings,
    href: '/settings',
    roles: ['admin', 'manager'],
    permission: 'settings:read',
  },
];
