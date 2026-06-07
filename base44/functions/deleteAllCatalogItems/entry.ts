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

    // Get all items
    const allItems = await base44.asServiceRole.entities.InventoryItem.list();
    
    // Delete in batches to avoid rate limits
    const batchSize = 20;
    let deletedCount = 0;
    let errorCount = 0;
    
    for (let i = 0; i < allItems.length; i++) {
      try {
        await base44.asServiceRole.entities.InventoryItem.delete(allItems[i].id);
        deletedCount++;
        
        // Add small delay every 20 items
        if ((i + 1) % batchSize === 0) {
          await new Promise(resolve => setTimeout(resolve, 500));
        }
      } catch (err) {
        errorCount++;
        console.error(`Failed to delete item ${allItems[i].name}: ${err.message}`);
      }
    }
    
    return Response.json({
      success: true,
      deleted: deletedCount,
      errors: errorCount
    });
    
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});