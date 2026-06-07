import { useState } from 'react';
import { Outlet } from 'react-router-dom';
import Sidebar from './Sidebar';
import { cn } from '@/lib/utils';

export default function AppLayout() {
  const [collapsed, setCollapsed] = useState(false);

  return (
    <div className="flex h-screen bg-background overflow-hidden">
      <Sidebar collapsed={collapsed} onToggle={() => setCollapsed(c => !c)} />
      <main className={cn(
        "flex-1 overflow-y-auto transition-all duration-300",
        collapsed ? "ml-16" : "ml-60"
      )}>
        <Outlet />
      </main>
    </div>
  );
}