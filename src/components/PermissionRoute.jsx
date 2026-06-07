import { Navigate, Outlet } from 'react-router-dom';
import { useAuth } from '@/lib/AuthContext';

/**
 * Protects a route by checking the user's permission record.
 * - adminOnly: only users with role="admin" can access
 * - permission: key in userPermission.permissions that must be true
 */
export default function PermissionRoute({ adminOnly = false, permission = null }) {
  const { user, userPermission, isLoadingAuth } = useAuth();

  if (isLoadingAuth) return null;

  if (adminOnly && user?.role !== 'admin') {
    return <Navigate to="/" replace />;
  }

  if (permission && userPermission?.permissions?.[permission] !== true) {
    return <Navigate to="/" replace />;
  }

  return <Outlet />;
}