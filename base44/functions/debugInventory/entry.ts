import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const body = await req.json();
    const { location_id, item_name } = body;

    if (!location_id) {
      return Response.json({ error: 'location_id required' }, { status: 400 });
    }

    // Get all location inventory for this location
    const allInv = await base44.asServiceRole.entities.LocationInventory.filter({ 
      location_id 
    });

    // Get all items to find the one matching the name
    const allItems = await base44.asServiceRole.entities.InventoryItem.list();
    
    // If item_name provided, find specific item
    if (item_name) {
      const matchingItem = allItems.find(i => i.name?.toLowerCase().includes(item_name.toLowerCase()));
      if (matchingItem) {
        const inv = allInv.find(i => i.item_id === matchingItem.id);
        return Response.json({ 
          item: matchingItem,
          inventory: inv,
          allInventoryForLocation: allInv
        });
      }
    }

    return Response.json({ 
      location_id,
      itemCount: allInv.length,
      items: allInv.slice(0, 20)
    });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});