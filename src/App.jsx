import { Toaster } from "sonner"
import { QueryClientProvider } from '@tanstack/react-query'
import { queryClientInstance } from '@/lib/query-client'
import { BrowserRouter as Router, Route, Routes } from 'react-router-dom';
import PageNotFound from './lib/PageNotFound';
import { AuthProvider, useAuth } from '@/lib/AuthContext';
import UserNotRegisteredError from '@/components/UserNotRegisteredError';
import AppLayout from '@/components/layout/AppLayout';
import { Navigate } from 'react-router-dom';
import Login from '@/pages/Login';
import Register from '@/pages/Register';
import ForgotPassword from '@/pages/ForgotPassword';
import ResetPassword from '@/pages/ResetPassword';
import ProtectedRoute from '@/components/ProtectedRoute';
import PermissionRoute from '@/components/PermissionRoute';

import Dashboard from '@/pages/Dashboard';
import MasterCatalog from '@/pages/MasterCatalog';
import LocationStock from '@/pages/LocationStock';
import InventoryCounts from '@/pages/InventoryCounts';
import VendorOrders from '@/pages/VendorOrders';
import Commissary from '@/pages/Commissary';
import Transfers from '@/pages/Transfers';
import Invoices from '@/pages/Invoices';
import Vendors from '@/pages/Vendors';
import Locations from '@/pages/Locations';
import Reports from '@/pages/Reports';
import Settings from '@/pages/Settings';
import VendorOrderView from '@/pages/VendorOrderView';
import OnlineOrders from '@/pages/OnlineOrders';
import InStoreOrders from '@/pages/InStoreOrders';

const AuthenticatedApp = () => {
  const { isLoadingAuth, isLoadingPublicSettings, authError, navigateToLogin } = useAuth();

  if (isLoadingPublicSettings || isLoadingAuth) {
    return (
      <div className="fixed inset-0 flex items-center justify-center bg-background">
        <div className="flex flex-col items-center gap-3">
          <div className="w-10 h-10 border-4 border-primary/20 border-t-primary rounded-full animate-spin"></div>
          <p className="text-sm text-muted-foreground font-medium">Loading InventoryHQ...</p>
        </div>
      </div>
    );
  }

  if (authError) {
    if (authError.type === 'user_not_registered') return <UserNotRegisteredError />;
  }

  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/register" element={<Register />} />
      <Route path="/forgot-password" element={<ForgotPassword />} />
      <Route path="/reset-password" element={<ResetPassword />} />
      <Route element={<ProtectedRoute unauthenticatedElement={<Navigate to="/login" replace />} />}>
        <Route element={<AppLayout />}>
          <Route path="/" element={<Dashboard />} />
          <Route path="/stock" element={<LocationStock />} />
          <Route path="/counts" element={<InventoryCounts />} />
          <Route path="/orders" element={<VendorOrders />} />
          <Route path="/commissary" element={<Commissary />} />
          <Route path="/online-orders" element={<OnlineOrders />} />
          <Route path="/instore-orders" element={<InStoreOrders />} />
          <Route path="/transfers" element={<Transfers />} />
          <Route path="/invoices" element={<Invoices />} />
          <Route path="/vendors" element={<Vendors />} />
          <Route path="/locations" element={<Locations />} />
          {/* Permission-gated routes */}
          <Route element={<PermissionRoute permission="master_catalog" />}>
            <Route path="/catalog" element={<MasterCatalog />} />
          </Route>
          <Route element={<PermissionRoute permission="hq_reports" />}>
            <Route path="/reports" element={<Reports />} />
          </Route>
          <Route element={<PermissionRoute adminOnly />}>
            <Route path="/settings" element={<Settings />} />
          </Route>
        </Route>
      </Route>
      {/* Public vendor order view (no auth required) */}
      <Route path="/vendor/order" element={<VendorOrderView />} />
      {/* Public vendor order view (no auth required) */}
      <Route path="/vendor/order" element={<VendorOrderView />} />
      <Route path="*" element={<PageNotFound />} />
    </Routes>
  );
};

function App() {
  return (
    <AuthProvider>
      <QueryClientProvider client={queryClientInstance}>
        <Router>
          <AuthenticatedApp />
        </Router>
        <Toaster />
      </QueryClientProvider>
    </AuthProvider>
  );
}

export default App;