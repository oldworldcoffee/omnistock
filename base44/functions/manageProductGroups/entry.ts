import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    
    if (!user || user.role !== 'admin') {
      return Response.json({ error: 'Forbidden: Admin access required' }, { status: 403 });
    }

    const { action, groupId, name, description, itemIds, sortOrder } = await req.json();

    // Create new group
    if (action === 'create') {
      const group = await base44.entities.ProductGroup.create({
        name,
        description: description || '',
        company_id: user.company_id,
        sort_order: sortOrder || 0,
        is_active: true
      });
      return Response.json({ success: true, group });
    }

    // Update group
    if (action === 'update') {
      if (!groupId) {
        return Response.json({ error: 'Group ID required' }, { status: 400 });
      }
      const updateData = {};
      if (name !== undefined) updateData.name = name;
      if (description !== undefined) updateData.description = description;
      if (sortOrder !== undefined) updateData.sort_order = sortOrder;
      
      try {
        await base44.entities.ProductGroup.update(groupId, updateData);
        const group = await base44.entities.ProductGroup.get(groupId);
        return Response.json({ success: true, group });
      } catch (error) {
        if (error.message?.includes('not found')) {
          // Legacy group - create new ProductGroup and migrate items
          // Get company_id from first item in the group
          const items = await base44.entities.InventoryItem.filter({ product_group_id: groupId });
          if (!items || items.length === 0) {
            return Response.json({ error: 'No items found in group' }, { status: 400 });
          }
          const companyId = items[0].company_id;
          
          const newGroup = await base44.entities.ProductGroup.create({
            name: name,
            description: description || '',
            company_id: companyId,
            sort_order: sortOrder || 0,
            is_active: true
          });
          
          // Update all items with the old group ID to use the new one
          for (const item of items) {
            await base44.entities.InventoryItem.update(item.id, { product_group_id: newGroup.id });
          }
          
          return Response.json({ success: true, group: newGroup, migrated: true });
        }
        throw error;
      }
    }

    // Delete group
    if (action === 'delete') {
      if (!groupId) {
        return Response.json({ error: 'Group ID required' }, { status: 400 });
      }
      // Ungroup items first
      const items = await base44.entities.InventoryItem.filter({ product_group_id: groupId });
      for (const item of items) {
        await base44.entities.InventoryItem.update(item.id, { product_group_id: null });
      }
      await base44.entities.ProductGroup.delete(groupId);
      return Response.json({ success: true });
    }

    // Add items to group
    if (action === 'add_items') {
      if (!groupId || !itemIds || !Array.isArray(itemIds)) {
        return Response.json({ error: 'Group ID and item IDs required' }, { status: 400 });
      }
      for (const itemId of itemIds) {
        await base44.entities.InventoryItem.update(itemId, { product_group_id: groupId });
      }
      return Response.json({ success: true });
    }

    // Remove items from group
    if (action === 'remove_items') {
      if (!itemIds || !Array.isArray(itemIds)) {
        return Response.json({ error: 'Item IDs required' }, { status: 400 });
      }
      for (const itemId of itemIds) {
        await base44.entities.InventoryItem.update(itemId, { product_group_id: null });
      }
      return Response.json({ success: true });
    }

    return Response.json({ error: 'Invalid action' }, { status: 400 });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});