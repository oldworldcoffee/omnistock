import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    
    if (user?.role !== 'admin') {
      return Response.json({ error: 'Admin access required' }, { status: 403 });
    }

    // Get company_id from CompanySettings
    const settings = await base44.entities.CompanySettings.list();
    const companyId = settings.length > 0 ? (settings[0].company_id || settings[0].id) : null;
    
    if (!companyId) {
      return Response.json({ error: 'No company settings found' }, { status: 400 });
    }

    // Get yesterday's date (snapshot represents end-of-day yesterday)
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const snapshotDate = yesterday.toISOString().split('T')[0]; // YYYY-MM-DD

    // Get all active locations and items
    const [locations, items, locInv] = await Promise.all([
      base44.entities.Location.list(),
      base44.entities.InventoryItem.list(),
      base44.entities.LocationInventory.list()
    ]);

    const activeLocations = locations.filter(l => l.is_active !== false);
    const activeItems = items.filter(i => i.is_active !== false);

    let created = 0;
    let skipped = 0;

    // Create snapshot for each location/item combination
    for (const location of activeLocations) {
      for (const item of activeItems) {
        // Find current inventory state
        const current = locInv.find(li => 
          li.location_id === location.id && 
          li.item_id === item.id
        );

        // Calculate unit cost from preferred vendor option
        const preferred = item.purchase_options?.find(o => o.is_preferred) || item.purchase_options?.[0];
        const unitCost = preferred?.unit_cost || item.unit_cost || 0;
        const quantity = current?.on_hand_quantity || 0;
        const inventoryValue = quantity * unitCost;

        // Check if snapshot already exists for this date
        const existing = await base44.entities.InventorySnapshot.filter({
          snapshot_date: snapshotDate,
          location_id: location.id,
          item_id: item.id
        });

        if (existing.length > 0) {
          skipped++;
          continue;
        }

        // Create snapshot record
        await base44.entities.InventorySnapshot.create({
          company_id: companyId,
          snapshot_date: snapshotDate,
          location_id: location.id,
          item_id: item.id,
          quantity_on_hand: quantity,
          unit_cost: unitCost,
          inventory_value: inventoryValue
        });

        created++;
      }
    }

    // Delete snapshots older than 365 days
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - 365);
    const oldSnapshots = await base44.entities.InventorySnapshot.filter({
      company_id: companyId
    });
    
    let deleted = 0;
    for (const snapshot of oldSnapshots) {
      if (new Date(snapshot.snapshot_date) < cutoffDate) {
        await base44.entities.InventorySnapshot.delete(snapshot.id);
        deleted++;
      }
    }

    return Response.json({
      success: true,
      message: 'Daily snapshot complete',
      details: {
        snapshotDate,
        locationsCount: activeLocations.length,
        itemsCount: activeItems.length,
        snapshotsCreated: created,
        snapshotsSkipped: skipped,
        oldSnapshotsDeleted: deleted
      }
    });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});