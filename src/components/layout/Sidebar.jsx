import { Link, useLocation } from 'react-router-dom';
import {
  LayoutDashboard, Package, MapPin, ArrowLeftRight,
  ShoppingCart, FileText, BarChart3, Users, Truck,
  ClipboardList, Store, ChevronRight, Boxes, LogOut, Globe, ShoppingBasket, X
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useAuth } from '@/lib/AuthContext';
import { useState, useEffect } from 'react';
import { base44 } from '@/api/base44Client';
import { useIsMobile } from '@/hooks/useIsMobile';

const navGroups = [
  {
    label: 'Overview',
    items: [
      { label: 'Dashboard', icon: LayoutDashboard, href: '/' },
    ]
  },
  {
    label: 'Inventory',
    items: [
      { label: 'Master Catalog', icon: Boxes, href: '/catalog', permission: 'master_catalog' },
      { label: 'Location Stock', icon: MapPin, href: '/stock' },
      { label: 'Count Inventory', icon: ClipboardList, href: '/counts' },
    ]
  },
  {
    label: 'Ordering',
    items: [
      { label: 'Vendor Orders', icon: ShoppingCart, href: '/orders' },
      { label: 'Online Orders', icon: Globe, href: '/online-orders' },
      { label: 'In-Store Shopping', icon: ShoppingBasket, href: '/instore-orders' },
      { label: 'Commissary', icon: Store, href: '/commissary', commissaryOnly: true },
      { label: 'Transfers', icon: ArrowLeftRight, href: '/transfers' },
    ]
  },
  {
    label: 'Receiving',
    items: [
      { label: 'Invoices', icon: FileText, href: '/invoices' },
    ]
  },
  {
    label: 'Management',
    items: [
      { label: 'Vendors', icon: Truck, href: '/vendors' },
      { label: 'Locations', icon: MapPin, href: '/locations' },
      { label: 'Reports', icon: BarChart3, href: '/reports', permission: 'hq_reports' },
      { label: 'Settings', icon: Users, href: '/settings', adminOnly: true },
    ]
  }
];

export default function Sidebar({ collapsed, onToggle, mobileOpen, setMobileOpen }) {
  const location = useLocation();
  const { user, userPermission, canAccessCommissary, logout } = useAuth();
  const [companyLogo, setCompanyLogo] = useState(null);
  const isMobile = useIsMobile();

  const loadLogo = async () => {
    const settings = await base44.entities.CompanySettings.list();
    if (settings.length > 0 && settings[0].logo_url) {
      setCompanyLogo(settings[0].logo_url);
    }
  };

  useEffect(() => {
    loadLogo();
    
    // Subscribe to real-time updates
    const unsubscribe = base44.entities.CompanySettings.subscribe((event) => {
      if (event.type === 'update' || event.type === 'create') {
        loadLogo();
      }
    });
    
    return () => unsubscribe();
  }, []);

  const canSee = (item) => {
    if (item.adminOnly) return user?.role === 'admin';
    if (item.permission) return userPermission?.permissions?.[item.permission] === true;
    if (item.commissaryOnly) return canAccessCommissary();
    return true;
  };

  return (
    <aside className={cn(
      "h-full bg-sidebar flex flex-col",
      isMobile ? "w-64 shadow-2xl" : (collapsed ? "w-16" : "w-60")
    )}>
      {/* Logo */}
      <div className="flex items-center gap-3 px-4 py-5 border-b border-sidebar-border">
        {companyLogo ? (
          <img src={companyLogo} alt="Company logo" className="h-8 w-auto object-contain flex-shrink-0" />
        ) : (
          <div className="w-8 h-8 bg-primary rounded-lg flex items-center justify-center flex-shrink-0">
            <Package className="w-4 h-4 text-white" />
          </div>
        )}
        {!isMobile && !collapsed && (
          <span className="text-sidebar-foreground font-semibold text-base tracking-tight">InventoryHQ</span>
        )}
        {isMobile && (
          <button
            onClick={() => setMobileOpen?.(false)}
            className="ml-auto text-sidebar-muted hover:text-sidebar-foreground"
          >
            <X className="w-5 h-5" />
          </button>
        )}
      </div>

      {/* Nav */}
      <nav className="flex-1 overflow-y-auto py-4 px-2 space-y-5">
        {navGroups.map((group) => (
          <div key={group.label}>
            {!collapsed && (
              <p className="text-sidebar-muted text-[10px] font-semibold uppercase tracking-widest px-2 mb-1">
                {group.label}
              </p>
            )}
            <ul className="space-y-0.5">
              {group.items.filter(canSee).map((item) => {
                const active = location.pathname === item.href;
                return (
                  <li key={item.href}>
                    <Link
                      to={item.href}
                      onClick={() => isMobile && setMobileOpen?.(false)}
                      className={cn(
                        "flex items-center gap-3 px-2 py-2 rounded-lg transition-colors text-sm font-medium",
                        active
                          ? "bg-primary/20 text-white"
                          : "text-sidebar-foreground/70 hover:bg-sidebar-border hover:text-sidebar-foreground",
                        collapsed && "justify-center"
                      )}
                      title={collapsed ? item.label : undefined}
                    >
                      <item.icon className={cn("flex-shrink-0", active ? "text-primary" : "", "w-4 h-4")} />
                      {!collapsed && <span>{item.label}</span>}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </nav>

      {/* User + logout */}
      <div className="border-t border-sidebar-border p-3 space-y-1">
        {!collapsed && user && (
          <div className="px-2 py-1.5">
            <p className="text-xs font-medium text-sidebar-foreground truncate">{user.full_name || user.email}</p>
            <p className="text-[10px] text-sidebar-muted truncate">{user.email}</p>
          </div>
        )}
        <button
          onClick={() => logout()}
          className={cn(
            "flex items-center gap-3 w-full px-2 py-2 rounded-lg transition-colors text-sm text-sidebar-muted hover:text-sidebar-foreground hover:bg-sidebar-border",
            collapsed && "justify-center"
          )}
          title={collapsed ? "Log out" : undefined}
        >
          <LogOut className="w-4 h-4 flex-shrink-0" />
          {!collapsed && <span>Log out</span>}
        </button>
      </div>

      {/* Collapse toggle - only show on desktop */}
      {!isMobile && (
        <button
          onClick={onToggle}
          className="flex items-center justify-center p-3 border-t border-sidebar-border text-sidebar-muted hover:text-sidebar-foreground transition-colors"
        >
          <ChevronRight className={cn("w-4 h-4 transition-transform", !collapsed && "rotate-180")} />
        </button>
      )}
    </aside>
  );
}