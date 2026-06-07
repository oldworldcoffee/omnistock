import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    
    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { order_items, location_id } = await req.json();

    if (!order_items || !location_id) {
      return Response.json({ error: 'Order items and location ID required' }, { status: 400 });
    }

    // Fetch location settings
    const locations = await base44.asServiceRole.entities.Location.list();
    const location = locations.find(l => l.id === location_id);
    const preferredWeeks = location?.preferred_stock_weeks || 2;

    // Fetch recent orders (last 60 days)
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
          date: order.received_at || order.email_sent_at
        });
      });
    });

    // Fetch current inventory levels
    const locInv = await base44.asServiceRole.entities.LocationInventory.list();
    const inventoryItems = await base44.asServiceRole.entities.InventoryItem.list();

    const reviewItems = [];

    for (const orderItem of order_items) {
      const item = inventoryItems.find(i => i.id === orderItem.item_id);
      const currentInv = locInv.find(l => l.location_id === location_id && l.item_id === orderItem.item_id);
      const history = itemOrderHistory[orderItem.item_id] || [];
      
      const onHand = currentInv?.on_hand_quantity || 0;
      const aiPar = item?.ai_suggested_par || 0;
      const minReorder = item?.minimum_reorder_volume || 0;
      const orderQty = orderItem.quantity_ordered || 0;

      // Calculate average order qty from history
      const avgOrderQty = history.length > 0 
        ? history.reduce((sum, h) => sum + h.quantity, 0) / history.length 
        : 0;

      const lastOrderDate = history.length > 0 
        ? history[history.length - 1].date 
        : null;

      // Build prompt for this item
      const prompt = `Analyze this order item for alignment with consumption patterns:

Item: ${orderItem.item_name}
Current On-Hand: ${onHand} units
AI Suggested Par: ${aiPar} units
Minimum Reorder Volume: ${minReorder} units
Order Quantity in Draft: ${orderQty} units
Average Historical Order: ${avgOrderQty.toFixed(1)} units
Last Ordered: ${lastOrderDate || 'Never'}
Location Preferred Stock Buffer: ${preferredWeeks} weeks

Question: Does the order quantity align with consumption patterns?
Explain any deviations and flag concerns.

Return ONLY valid JSON in this exact format:
{
  "status": "ok" | "warning" | "question",
  "message": "<formal technical explanation>",
  "recommendation": "<suggested action or confirmation question>"
}`;

      const llmResponse = await base44.asServiceRole.integrations.Core.InvokeLLM({
        prompt: prompt,
        response_json_schema: {
          type: 'object',
          properties: {
            status: { type: 'string', enum: ['ok', 'warning', 'question'] },
            message: { type: 'string' },
            recommendation: { type: 'string' }
          },
          required: ['status', 'message', 'recommendation']
        }
      });

      const llmData = typeof llmResponse === 'string' ? JSON.parse(llmResponse) : llmResponse;

      reviewItems.push({
        item_id: orderItem.item_id,
        item_name: orderItem.item_name,
        order_quantity: orderQty,
        on_hand: onHand,
        ai_par: aiPar,
        min_reorder: minReorder,
        avg_historical_order: avgOrderQty,
        status: llmData.status,
        message: llmData.message,
        recommendation: llmData.recommendation
      });
    }

    return Response.json({
      success: true,
      location_id: location_id,
      items_reviewed: reviewItems.length,
      review: reviewItems
    });

  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});