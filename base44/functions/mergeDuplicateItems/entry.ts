import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    
    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    if (user.role !== 'admin') {
      return Response.json({ error: 'Admin access required' }, { status: 403 });
    }

    const body = await req.json().catch(() => ({}));
    const { item1_id, item2_id, keep_id } = body;

    // If specific items provided, merge just those two
    if (item1_id && item2_id && keep_id) {
      const item1 = await base44.asServiceRole.entities.InventoryItem.get(item1_id);
      const item2 = await base44.asServiceRole.entities.InventoryItem.get(item2_id);
      
      if (!item1 || !item2) {
        return Response.json({ error: 'One or both items not found' }, { status: 404 });
      }

      const keep = keep_id === item1_id ? item1 : item2;
      const remove = keep_id === item1_id ? item2 : item1;

      // Merge purchase options - check for duplicates by comparing full option details
      const keepOptions = keep.purchase_options || [];
      const removeOptions = remove.purchase_options || [];
      
      console.log('MERGE DEBUG:', {
        keep_name: keep.name,
        keep_options: keepOptions.length,
        remove_name: remove.name,
        remove_options: removeOptions.length,
        keep_options_detail: keepOptions.map(o => ({ vendor_name: o.vendor_name, product_code: o.product_code, vendor_id: o.vendor_id, pack_size: o.pack_size })),
        remove_options_detail: removeOptions.map(o => ({ vendor_name: o.vendor_name, product_code: o.product_code, vendor_id: o.vendor_id, pack_size: o.pack_size }))
      });
      
      // Create a set of existing options based on vendor_id + vendor_name + product_code + pack_size breakdown
      // Different pack breakdowns from same vendor are considered different purchase options
      const existingOptionKeys = new Set(keepOptions.map(o => 
        `${o.vendor_id || ''}|${(o.vendor_name || '').toLowerCase()}|${(o.product_code || '').toLowerCase()}|${o.inner_pack_units || ''}|${(o.inner_pack_name || '').toLowerCase()}|${o.packs_per_case || ''}`
      ));
      
      const newOptions = [];
      for (const opt of removeOptions) {
        const optionKey = `${opt.vendor_id || ''}|${(opt.vendor_name || '').toLowerCase()}|${(opt.product_code || '').toLowerCase()}|${opt.inner_pack_units || ''}|${(opt.inner_pack_name || '').toLowerCase()}|${opt.packs_per_case || ''}`;
        
        // Only add if this exact option doesn't already exist
        if (!existingOptionKeys.has(optionKey)) {
          newOptions.push(opt);
          existingOptionKeys.add(optionKey);
        }
      }
      
      console.log('MERGE RESULT:', { new_options_count: newOptions.length, total_options: keepOptions.length + newOptions.length });
      
      // Combine and save all purchase options
      const updatedOptions = [...keepOptions, ...newOptions];
      await base44.asServiceRole.entities.InventoryItem.update(keep.id, {
        purchase_options: updatedOptions
      });
      
      // Delete the duplicate
      await base44.asServiceRole.entities.InventoryItem.delete(remove.id);
      
      // Reload the kept item to confirm it exists and has the merged data
      const keptItemAfterMerge = await base44.asServiceRole.entities.InventoryItem.get(keep.id);
      
      return Response.json({
        success: true,
        kept_id: keptItemAfterMerge.id,
        kept_name: keptItemAfterMerge.name,
        kept_purchase_options_count: (keptItemAfterMerge.purchase_options || []).length,
        removed_name: remove.name
      });
    }

    // Otherwise, auto-merge all duplicates (original behavior)
    const allItems = await base44.asServiceRole.entities.InventoryItem.list();
    
    // Group by name (case-insensitive)
    const itemsByName = new Map();
    for (const item of allItems) {
      const name = item.name?.toLowerCase();
      if (!name) continue;
      if (!itemsByName.has(name)) {
        itemsByName.set(name, []);
      }
      itemsByName.get(name).push(item);
    }
    
    // Find duplicates (groups with more than 1 item)
    const duplicateGroups = Array.from(itemsByName.values()).filter(group => group.length > 1);
    
    let mergedCount = 0;
    let remainingCount = 0;
    
    // Process each duplicate group
    for (const group of duplicateGroups) {
      // Sort by created_date to keep the oldest as primary
      group.sort((a, b) => new Date(a.created_date) - new Date(b.created_date));
      
      const primary = group[0];
      const toMerge = group.slice(1);
      
      // Merge purchase options from duplicates into primary
      const existingVendorNames = new Set((primary.purchase_options || []).map(o => o.vendor_name?.toLowerCase()));
      const newOptions = [];
      
      for (const dup of toMerge) {
        const dupOptions = dup.purchase_options || [];
        for (const opt of dupOptions) {
          if (!existingVendorNames.has(opt.vendor_name?.toLowerCase())) {
            newOptions.push(opt);
            existingVendorNames.add(opt.vendor_name.toLowerCase());
          }
        }
      }
      
      // Update primary with merged purchase options
      if (newOptions.length > 0) {
        const updatedOptions = [...(primary.purchase_options || []), ...newOptions];
        await base44.asServiceRole.entities.InventoryItem.update(primary.id, {
          purchase_options: updatedOptions
        });
      }
      
      // Delete duplicates
      for (const dup of toMerge) {
        await base44.asServiceRole.entities.InventoryItem.delete(dup.id);
        mergedCount++;
      }
      
      remainingCount++;
      
      // Small delay to avoid rate limits
      await new Promise(resolve => setTimeout(resolve, 200));
    }
    
    return Response.json({
      success: true,
      merged: mergedCount,
      remaining: remainingCount
    });
    
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});