import { useState } from 'react';
import { Outlet } from 'react-router-dom';
import Sidebar from './Sidebar';
import { cn } from '@/lib/utils';
import { useIsMobile } from '@/hooks/useIsMobile';
import { Menu, X } from 'lucide-react';
import { Button } from '@/components/ui/button';

export default function AppLayout() {
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const isMobile = useIsMobile();

  return (
    <div className="flex h-screen bg-background overflow-hidden">
      {/* Mobile sidebar overlay */}
      {isMobile && mobileOpen && (
        <div 
          className="fixed inset-0 bg-black/50 z-40 lg:hidden"
          onClick={() => setMobileOpen(false)}
        />
      )}
      
      {/* Sidebar */}
      <div className={cn(
        "transition-all duration-300 z-50",
        isMobile 
          ? cn("fixed inset-y-0 left-0 transform", mobileOpen ? "translate-x-0" : "-translate-x-full") 
          : cn("relative", collapsed ? "w-16" : "w-60")
      )}>
        <Sidebar 
          collapsed={isMobile ? false : collapsed} 
          onToggle={() => isMobile ? setMobileOpen(false) : setCollapsed(c => !c)}
          mobileOpen={isMobile ? mobileOpen : undefined}
          setMobileOpen={isMobile ? setMobileOpen : undefined}
        />
      </div>

      {/* Main content */}
      <main className="flex-1 overflow-y-auto transition-all duration-300">
        {/* Mobile header */}
        {isMobile && (
          <div className="sticky top-0 z-30 bg-background border-b border-border px-4 py-3 flex items-center justify-between">
            <Button
              variant="ghost"
              size="icon"
              onClick={() => setMobileOpen(true)}
              className="h-10 w-10"
            >
              <Menu className="w-5 h-5" />
            </Button>
            <span className="font-semibold text-lg">InventoryHQ</span>
            <div className="w-10" /> {/* Spacer for balance */}
          </div>
        )}
        
        <Outlet />
      </main>
    </div>
  );
}