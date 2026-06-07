import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    
    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Get company_id from CompanySettings
    const settings = await base44.entities.CompanySettings.list();
    const companyId = settings.length > 0 ? (settings[0].company_id || settings[0].id) : null;
    
    if (!companyId) {
      return Response.json({ error: 'No company settings found' }, { status: 400 });
    }

    // Check if user has a UserPermission record
    const perms = await base44.entities.UserPermission.filter({ email: user.email });
    
    if (perms.length === 0) {
      // Create a UserPermission record for this user
      await base44.entities.UserPermission.create({
        company_id: companyId,
        user_id: user.id,
        email: user.email,
        full_name: user.full_name,
        role: user.role === 'admin' ? 'admin' : 'manager',
        status: 'active',
        permissions: user.role === 'admin' 
          ? { master_catalog: true, hq_reports: true, all_locations: true, location_ids: [] }
          : { master_catalog: false, hq_reports: true, all_locations: true, location_ids: [] },
        invited_at: new Date().toISOString()
      });
      
      return Response.json({ 
        success: true, 
        message: 'UserPermission record created',
        companyId,
        userRole: user.role
      });
    } else {
      // Update existing permission record with company_id if missing
      for (const perm of perms) {
        if (!perm.company_id) {
          await base44.entities.UserPermission.update(perm.id, { company_id: companyId });
        }
      }
      
      return Response.json({ 
        success: true, 
        message: 'UserPermission company_id updated',
        companyId,
        existingPerms: perms.length
      });
    }
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});