import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

async function withRetry(fn, retries = 6, baseDelayMs = 2000) {
  for (let i = 0; i < retries; i++) {
    try {
      return await fn();
    } catch (err) {
      const isRateLimit = err?.message?.includes('Rate limit') || err?.status === 429 || err?.message?.includes('429');
      if (isRateLimit && i < retries - 1) {
        await sleep(baseDelayMs * Math.pow(2, i)); // 2s, 4s, 8s, 16s, 32s
        continue;
      }
      throw err;
    }
  }
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    // locInvMap: { [itemId]: existingLocationInventoryRecordId } — passed from frontend
    // itemQtyMap: { [itemId]: totalQty }
    const { countId, locationId, companyId, itemQtyMap, locInvMap } = await req.json();

    if (!countId || !locationId || !companyId || !itemQtyMap) {
      return Response.json({ error: 'Missing required fields' }, { status: 400 });
    }

    const creates = [];
    const updates = []; // { id, qty }

    for (const [itemId, totalQty] of Object.entries(itemQtyMap)) {
      const existingId = locInvMap?.[itemId];
      if (existingId) {
        updates.push({ id: existingId, on_hand_quantity: totalQty });
      } else {
        creates.push({
          company_id: companyId,
          location_id: locationId,
          item_id: itemId,
          on_hand_quantity: totalQty,
          par_level: 0,
          reorder_point: 0,
        });
      }
    }

    // Bulk create new records (single API call)
    if (creates.length > 0) {
      await withRetry(() => base44.asServiceRole.entities.LocationInventory.bulkCreate(creates));
      await sleep(500);
    }

    // Process updates sequentially with delay to stay under rate limit
    for (const u of updates) {
      await withRetry(() =>
        base44.asServiceRole.entities.LocationInventory.update(u.id, { on_hand_quantity: u.on_hand_quantity })
      );
      await sleep(150);
    }

    // Mark count as submitted
    await withRetry(() =>
      base44.asServiceRole.entities.InventoryCount.update(countId, {
        status: 'submitted',
        submitted_at: new Date().toISOString(),
      })
    );

    return Response.json({ success: true, updated: updates.length, created: creates.length });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});