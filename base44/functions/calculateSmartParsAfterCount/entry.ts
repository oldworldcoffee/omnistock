import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    
    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { count_id, location_id } = await req.json();

    if (!location_id) {
      return Response.json({ error: 'Location ID required' }, { status: 400 });
    }

    // Fetch location to get preferred_stock_weeks
    const locations = await base44.asServiceRole.entities.Location.list();
    const location = locations.find(l => l.id === location_id);
    
    if (!location) {
      return Response.json({ error: 'Location not found' }, { status: 404 });
    }

    const preferredWeeks = location.preferred_stock_weeks || 2;

    // Fetch all orders from last 60 days
    const allOrders = await base44.asServiceRole.entities.Order.list();
    const sixtyDaysAgo = new Date();
    sixtyDaysAgo.setDate(sixtyDaysAgo.getDate() - 60);
    
    const recentOrders = allOrders.filter(o => {
      const orderDate = o.received_at ? new Date(o.received_at) : (o.email_sent_at ? new Date(o.email_sent_at) : null);
      return orderDate && orderDate >= sixtyDaysAgo && o.location_id === location_id && o.status === 'received';
    });

    // Build order history per item
    const itemOrderHistory = {};
    recentOrders.forEach(order => {
      order.items?.forEach(item => {
        if (!itemOrderHistory[item.item_id]) {
          itemOrderHistory[item.item_id] = [];
        }
        itemOrderHistory[item.item_id].push({
          quantity: item.quantity_received || item.quantity_ordered || 0,
          date: order.received_at || order.email_sent_at,
          item_name: item.item_name
        });
      });
    });

    // Fetch all inventory items
    const inventoryItems = await base44.asServiceRole.entities.InventoryItem.list();
    const activeItems = inventoryItems.filter(i => i.is_active !== false);

    const results = [];
    const updates = [];

    for (const item of activeItems) {
      const history = itemOrderHistory[item.id] || [];
      
      if (history.length === 0) {
        // No order history - ask user
        results.push({
          item_id: item.id,
          item_name: item.name,
          status: 'no_history',
          message: 'Insufficient data; verify manually'
        });
        continue;
      }

      // Calculate average weekly consumption
      const totalQty = history.reduce((sum, h) => sum + h.quantity, 0);
      const weeks = 60 / 7; // ~8.57 weeks
      const avgWeeklyConsumption = totalQty / weeks;

      // Call LLM to calculate smart pars
      const prompt = `Given this inventory item's order history over the past 60 days:
Item: ${item.name}
Order History: ${JSON.stringify(history.map(h => ({ quantity: h.quantity, date: h.date })))}
Average Weekly Consumption: ${avgWeeklyConsumption.toFixed(2)} units
Location Preferred Stock Buffer: ${preferredWeeks} weeks

Calculate:
1. Recommended par level (should cover ${preferredWeeks} weeks of consumption)
2. Minimum reorder point (safety stock for 1 week)

Return ONLY valid JSON in this exact format:
{
  "suggested_par": <number>,
  "minimum_reorder_volume": <number>,
  "reasoning": "<brief explanation>"
}`;

      const llmResponse = await base44.asServiceRole.integrations.Core.InvokeLLM({
        prompt: prompt,
        response_json_schema: {
          type: 'object',
          properties: {
            suggested_par: { type: 'number' },
            minimum_reorder_volume: { type: 'number' },
            reasoning: { type: 'string' }
          },
          required: ['suggested_par', 'minimum_reorder_volume', 'reasoning']
        }
      });

      const llmData = typeof llmResponse === 'string' ? JSON.parse(llmResponse) : llmResponse;

      // Update the item
      const updateData = {
        ai_suggested_par: Math.round(llmData.suggested_par),
        minimum_reorder_volume: Math.round(llmData.minimum_reorder_volume),
        last_par_calculation_date: new Date().toISOString()
      };

      await base44.asServiceRole.entities.InventoryItem.update(item.id, updateData);

      results.push({
        item_id: item.id,
        item_name: item.name,
        suggested_par: updateData.ai_suggested_par,
        minimum_reorder_volume: updateData.minimum_reorder_volume,
        reasoning: llmData.reasoning,
        status: 'updated'
      });

      updates.push(item.id);
    }

    return Response.json({
      success: true,
      location_id: location_id,
      items_processed: results.length,
      items_updated: updates.length,
      results: results
    });

  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});