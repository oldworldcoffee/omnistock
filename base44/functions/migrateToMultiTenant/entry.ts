import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    
    if (user?.role !== 'admin') {
      return Response.json({ error: 'Admin access required' }, { status: 403 });
    }

    // Get or create company settings
    let settings = await base44.entities.CompanySettings.list();
    let companyId;
    
    if (settings.length === 0) {
      // Create company settings with ID as company_id
      const newSettings = await base44.entities.CompanySettings.create({
        company_id: 'temp_' + Date.now(),
        company_name: 'My Company'
      });
      // Update to use the record ID as company_id for consistency
      await base44.entities.CompanySettings.update(newSettings.id, { company_id: newSettings.id });
      companyId = newSettings.id;
    } else {
      companyId = settings[0].company_id || settings[0].id;
    }

    // Migrate UserPermission records
    const allPerms = await base44.entities.UserPermission.list();
    for (const perm of allPerms) {
      if (!perm.company_id) {
        await base44.entities.UserPermission.update(perm.id, { company_id: companyId });
      }
    }

    // Migrate Location records
    const allLocations = await base44.entities.Location.list();
    for (const loc of allLocations) {
      if (!loc.company_id) {
        await base44.entities.Location.update(loc.id, { company_id: companyId });
      }
    }

    // Migrate Vendor records
    const allVendors = await base44.entities.Vendor.list();
    for (const vendor of allVendors) {
      if (!vendor.company_id) {
        await base44.entities.Vendor.update(vendor.id, { company_id: companyId });
      }
    }

    // Migrate InventoryItem records
    const allItems = await base44.entities.InventoryItem.list();
    for (const item of allItems) {
      if (!item.company_id) {
        await base44.entities.InventoryItem.update(item.id, { company_id: companyId });
      }
    }

    // Migrate Invoice records
    const allInvoices = await base44.entities.Invoice.list();
    for (const inv of allInvoices) {
      if (!inv.company_id) {
        await base44.entities.Invoice.update(inv.id, { company_id: companyId });
      }
    }

    // Migrate Transfer records
    const allTransfers = await base44.entities.Transfer.list();
    for (const t of allTransfers) {
      if (!t.company_id) {
        await base44.entities.Transfer.update(t.id, { company_id: companyId });
      }
    }

    // Migrate InventoryCount records
    const allCounts = await base44.entities.InventoryCount.list();
    for (const c of allCounts) {
      if (!c.company_id) {
        await base44.entities.InventoryCount.update(c.id, { company_id: companyId });
      }
    }

    // Migrate CommissaryFulfillment records
    const allFulfillments = await base44.entities.CommissaryFulfillment.list();
    for (const f of allFulfillments) {
      if (!f.company_id) {
        await base44.entities.CommissaryFulfillment.update(f.id, { company_id: companyId });
      }
    }

    // Migrate Order records
    const allOrders = await base44.entities.Order.list();
    for (const o of allOrders) {
      if (!o.company_id) {
        await base44.entities.Order.update(o.id, { company_id: companyId });
      }
    }

    return Response.json({ 
      success: true, 
      message: 'Migration complete',
      details: {
        companyId,
        userPermissionsMigrated: allPerms.filter(p => !p.company_id).length,
        locationsMigrated: allLocations.filter(l => !l.company_id).length,
        vendorsMigrated: allVendors.filter(v => !v.company_id).length,
        itemsMigrated: allItems.filter(i => !i.company_id).length,
        invoicesMigrated: allInvoices.filter(i => !i.company_id).length,
        transfersMigrated: allTransfers.filter(t => !t.company_id).length,
        countsMigrated: allCounts.filter(c => !c.company_id).length,
        fulfillmentsMigrated: allFulfillments.filter(f => !f.company_id).length,
        ordersMigrated: allOrders.filter(o => !o.company_id).length
      }
    });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});