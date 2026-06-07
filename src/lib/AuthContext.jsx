import React, { createContext, useState, useContext, useEffect } from 'react';
import { base44 } from '@/api/base44Client';

const AuthContext = createContext();

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  const [userPermission, setUserPermission] = useState(null);
  const [allLocations, setAllLocations] = useState([]);
  const [companyId, setCompanyId] = useState(null);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [isLoadingAuth, setIsLoadingAuth] = useState(true);
  const [isLoadingPublicSettings, setIsLoadingPublicSettings] = useState(true);
  const [authError, setAuthError] = useState(null);
  const [authChecked, setAuthChecked] = useState(false);
  const [appPublicSettings, setAppPublicSettings] = useState(null); // Contains only { id, public_settings }

  useEffect(() => {
    checkAppState();
  }, []);

  const checkAppState = async () => {
    setIsLoadingPublicSettings(false);
    setAppPublicSettings({ public_settings: { auth_required: true } });
    await checkUserAuth();
  };

  const checkUserAuth = async () => {
    try {
      // Now check if the user is authenticated
      setIsLoadingAuth(true);
      setAuthError(null);
      if (!base44.auth.getToken()) {
        setUser(null);
        setUserPermission(null);
        setAllLocations([]);
        setCompanyId(null);
        setIsAuthenticated(false);
        setIsLoadingAuth(false);
        setAuthChecked(true);
        return;
      }

      const currentUser = await base44.auth.me();
      setUser(currentUser);
      setIsAuthenticated(true);
      
      // Load company_id from UserPermission or CompanySettings
      let resolvedCompanyId = null;

      if (currentUser?.role === 'admin') {
        setUserPermission({ role: 'admin', permissions: { master_catalog: true, hq_reports: true, all_locations: true } });
        // Admin gets company_id from first CompanySettings record
        const settings = await base44.entities.CompanySettings.list();
        if (settings.length > 0) {
          resolvedCompanyId = settings[0].company_id || settings[0].id;
          setCompanyId(resolvedCompanyId);
        }
      } else {
        const perms = await base44.entities.UserPermission.filter({ email: currentUser.email });
        const perm = perms?.[0] || null;
        setUserPermission(perm);
        if (perm?.company_id) {
          resolvedCompanyId = perm.company_id;
          setCompanyId(resolvedCompanyId);
        }
      }
      
      // Load locations filtered by company using local variable (not stale state)
      const locs = resolvedCompanyId
        ? await base44.entities.Location.filter({ company_id: resolvedCompanyId })
        : await base44.entities.Location.list();
      setAllLocations(locs);
      setIsLoadingAuth(false);
      setAuthChecked(true);
    } catch (error) {
      console.error('User auth check failed:', error);
      setIsLoadingAuth(false);
      setIsAuthenticated(false);
      setAuthChecked(true);
      
      // If user auth fails, it might be an expired token
      if (error.status === 401 || error.status === 403) {
        setAuthError({
          type: 'auth_required',
          message: 'Authentication required'
        });
      }
    }
  };

  const logout = (shouldRedirect = true) => {
    setUser(null);
    setIsAuthenticated(false);
    
    if (shouldRedirect) {
      // Use the SDK's logout method which handles token cleanup and redirect
      base44.auth.logout(window.location.href);
    } else {
      // Just remove the token without redirect
      base44.auth.logout();
    }
  };

  const navigateToLogin = () => {
    // Use the SDK's redirectToLogin method
    base44.auth.redirectToLogin(window.location.href);
  };

  // Returns true if the user can access a given location ID
  const canAccessLocation = (locationId) => {
    if (!userPermission) return true; // still loading or admin
    if (userPermission.permissions?.all_locations) return true;
    return (userPermission.permissions?.location_ids || []).includes(locationId);
  };

  // Returns true if the user can manage (fulfill) at least one commissary
  const canAccessCommissary = () => {
    if (!userPermission) return true;
    if (userPermission.permissions?.all_locations) return true;
    return (userPermission.permissions?.commissary_manage_ids || []).length > 0;
  };

  // Returns array of commissary location IDs this user can manage/fulfill
  const getManagedCommissaryLocationIds = () => {
    if (!userPermission) return allLocations.filter(l => l.type === 'commissary').map(l => l.id);
    if (userPermission.permissions?.all_locations) return allLocations.filter(l => l.type === 'commissary').map(l => l.id);
    return userPermission.permissions?.commissary_manage_ids || [];
  };

  return (
    <AuthContext.Provider value={{ 
      user,
      userPermission,
      allLocations,
      companyId,
      canAccessLocation,
      canAccessCommissary,
      getManagedCommissaryLocationIds,
      isAuthenticated, 
      isLoadingAuth,
      isLoadingPublicSettings,
      authError,
      appPublicSettings,
      authChecked,
      logout,
      navigateToLogin,
      checkUserAuth,
      checkAppState
    }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};
