import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    
    if (user?.role !== 'admin') {
      return Response.json({ error: 'Forbidden: Admin access required' }, { status: 403 });
    }

    // Get all vendors and create a name-to-ID map
    const vendors = await base44.asServiceRole.entities.Vendor.list();
    const vendorMap = new Map();
    vendors.forEach(v => {
      vendorMap.set(v.name.toLowerCase(), v.id);
    });

    // Get all inventory items
    const items = await base44.asServiceRole.entities.InventoryItem.list();
    
    let updatedCount = 0;
    let errorCount = 0;
    const errors = [];

    // Process items in batches to avoid rate limits
    const batchSize = 10;
    for (let i = 0; i < items.length; i += batchSize) {
      const batch = items.slice(i, i + batchSize);
      
      for (const item of batch) {
        const purchaseOptions = item.purchase_options || [];
        let needsUpdate = false;
        
        // Update each purchase option with correct vendor_id
        const updatedOptions = purchaseOptions.map(opt => {
          if (!opt.vendor_id && opt.vendor_name) {
            const vendorId = vendorMap.get(opt.vendor_name.toLowerCase());
            if (vendorId) {
              needsUpdate = true;
              return { ...opt, vendor_id: vendorId };
            } else {
              errors.push(`Item "${item.name}": Vendor "${opt.vendor_name}" not found`);
            }
          }
          return opt;
        });

        // Also update item-level vendor_id if missing
        let itemVendorId = item.vendor_id;
        if (!itemVendorId && purchaseOptions.length > 0) {
          const preferredOpt = purchaseOptions.find(o => o.is_preferred) || purchaseOptions[0];
          if (preferredOpt.vendor_name) {
            const vendorId = vendorMap.get(preferredOpt.vendor_name.toLowerCase());
            if (vendorId) {
              itemVendorId = vendorId;
              needsUpdate = true;
            }
          }
        }

        if (needsUpdate) {
          try {
            await base44.asServiceRole.entities.InventoryItem.update(item.id, {
              purchase_options: updatedOptions,
              vendor_id: itemVendorId
            });
            updatedCount++;
          } catch (err) {
            errorCount++;
            errors.push(`Item "${item.name}": ${err.message}`);
          }
        }
      }
      
      // Wait between batches to avoid rate limits
      if (i + batchSize < items.length) {
        await new Promise(resolve => setTimeout(resolve, 3000));
      }
    }

    return Response.json({
      success: true,
      updated: updatedCount,
      errors: errors.slice(0, 20), // Limit error output
      totalErrors: errors.length
    });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});