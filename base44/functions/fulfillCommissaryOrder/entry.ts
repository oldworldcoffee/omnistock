import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { order_id, commissary_location_id, fulfillment_items, notes, split_option } = await req.json();

    if (!order_id || !commissary_location_id || !fulfillment_items) {
      return Response.json({ error: 'Missing required fields' }, { status: 400 });
    }

    // Get the original order
    const order = await base44.entities.Order.get(order_id);
    if (!order) {
      return Response.json({ error: 'Order not found' }, { status: 404 });
    }

    // Get commissary location
    const commissary = await base44.entities.Location.get(commissary_location_id);
    if (!commissary || commissary.type !== 'commissary') {
      return Response.json({ error: 'Invalid commissary location' }, { status: 400 });
    }

    // Calculate totals
    let total_amount = 0;
    const items = fulfillment_items.map(item => {
      const total = (item.quantity_fulfilled || 0) * (item.unit_cost || 0);
      total_amount += total;
      return {
        item_id: item.item_id,
        item_name: item.item_name,
        unit_of_measure: item.unit_of_measure,
        quantity_ordered: item.quantity_ordered,
        quantity_fulfilled: item.quantity_fulfilled,
        unit_cost: item.unit_cost,
        total_cost: total,
        notes: item.notes || '',
        ...(item.variant_id ? { variant_id: item.variant_id } : {}),
        ...(item.variant_quantities ? { variant_quantities: item.variant_quantities } : {})
      };
    });

    // Determine fulfillment status
    const allFulfilled = items.every(item => item.quantity_fulfilled >= item.quantity_ordered);
    const someFulfilled = items.some(item => item.quantity_fulfilled > 0);
    const hasRemaining = items.some(item => (item.quantity_fulfilled || 0) < (item.quantity_ordered || 0));
    const status = allFulfilled ? 'fulfilled' : someFulfilled ? 'partial' : 'pending';

    // Get company_id from order
    const company_id = order.company_id;

    // Create fulfillment record
    const fulfillment = await base44.entities.CommissaryFulfillment.create({
      company_id,
      order_id,
      order_number: order.order_number,
      retail_location_id: order.location_id,
      commissary_location_id,
      items,
      status,
      fulfillment_date: new Date().toISOString(),
      notes: notes || ''
    });

    // Deplete commissary inventory for each fulfilled item
    for (const item of items.filter(i => (i.quantity_fulfilled || 0) > 0)) {
      const invRecords = await base44.entities.LocationInventory.filter({
        location_id: commissary_location_id,
        item_id: item.item_id,
      });
      if (invRecords.length > 0) {
        const inv = invRecords[0];
        const newQty = Math.max(0, (inv.on_hand_quantity || 0) - (item.quantity_fulfilled || 0));
        await base44.entities.LocationInventory.update(inv.id, { on_hand_quantity: newQty });
      }
    }

    // Handle split invoice if requested and there are remaining items
    if (split_option === 'split' && hasRemaining) {
      // Update original order to show ONLY fulfilled items with received quantities
      const fulfilledOrderItems = items.map(item => ({
        item_id: item.item_id,
        item_name: item.item_name,
        unit_of_measure: item.unit_of_measure,
        quantity_ordered: item.quantity_fulfilled,
        quantity_received: item.quantity_fulfilled,
        unit_cost: item.unit_cost,
        total_cost: item.quantity_fulfilled * item.unit_cost,
        ...(item.variant_id ? { variant_id: item.variant_id } : {}),
        ...(item.variant_quantities ? { variant_quantities: item.variant_quantities } : {})
      }));

      await base44.entities.Order.update(order_id, {
        status: 'fulfilled',
        received_at: new Date().toISOString(),
        items: fulfilledOrderItems,
        total_amount: fulfilledOrderItems.reduce((s, i) => s + i.total_cost, 0),
        notes: (order.notes || '') + `\n[Split on ${new Date().toISOString()}] Original order fulfilled. Split order created for remaining items.`
      });

      // Create a NEW order for ONLY the remaining items
      const splitOrderItems = items
        .filter(item => (item.quantity_fulfilled || 0) < (item.quantity_ordered || 0))
        .map(item => ({
          item_id: item.item_id,
          item_name: item.item_name,
          unit_of_measure: item.unit_of_measure,
          quantity_ordered: (item.quantity_ordered || 0) - (item.quantity_fulfilled || 0),
          quantity_received: 0,
          unit_cost: item.unit_cost,
          total_cost: ((item.quantity_ordered || 0) - (item.quantity_fulfilled || 0)) * item.unit_cost,
          ...(item.variant_id ? { variant_id: item.variant_id } : {}),
          ...(item.variant_quantities ? { variant_quantities: item.variant_quantities } : {})
        }));

      const splitOrder = await base44.entities.Order.create({
        company_id,
        type: 'commissary',
        status: 'sent',
        location_id: order.location_id,
        vendor_id: order.vendor_id,
        items: splitOrderItems,
        total_amount: splitOrderItems.reduce((s, i) => s + i.total_cost, 0),
        order_number: `${order.order_number}-SPLIT`,
        notes: `Split from original order ${order.order_number}. Remaining items awaiting fulfillment.`,
        backstock_note: null
      });

      // Update vendor order to reflect partial fulfillment quantities
      const vendorOrders = await base44.entities.Order.filter({ type: 'vendor', location_id: order.location_id });
      const relatedVendorOrder = vendorOrders.find(vo => 
        vo.items?.some(vi => items.some(fi => fi.item_id === vi.item_id))
      );
      
      if (relatedVendorOrder) {
        const updatedItems = relatedVendorOrder.items.map(vi => {
          const fulfilledItem = items.find(fi => fi.item_id === vi.item_id);
          if (fulfilledItem) {
            return {
              ...vi,
              quantity_received: (vi.quantity_received || 0) + (fulfilledItem.quantity_fulfilled || 0)
            };
          }
          return vi;
        });
        await base44.entities.Order.update(relatedVendorOrder.id, {
          items: updatedItems,
          status: 'partial'
        });
      }

      // Update the fulfillment record to track the split
      await base44.entities.CommissaryFulfillment.update(fulfillment.id, {
        is_split_invoice: true,
        status: 'fulfilled',
        notes: `Partial fulfillment - split created for remaining items. Split order: ${splitOrder.order_number}`
      });

      // Create invoice for the fulfilled items only (linked to original order)
      const invoice = await base44.entities.Invoice.create({
        company_id,
        location_id: order.location_id,
        vendor_id: commissary_location_id,
        vendor_name: commissary.name,
        invoice_number: `INV-${Date.now()}`,
        invoice_date: new Date().toISOString().split('T')[0],
        status: 'pending_review',
        extracted_items: items.filter(item => item.quantity_fulfilled > 0).map(item => ({
          item_id: item.item_id,
          item_name: item.item_name,
          quantity: item.quantity_fulfilled,
          unit_cost: item.unit_cost,
          total_cost: item.total_cost,
          matched: true,
          ...(item.variant_id ? { variant_id: item.variant_id } : {}),
          ...(item.variant_quantities ? { variant_quantities: item.variant_quantities } : {})
        })),
        total_amount,
        order_id: order_id,
        notes: `Partial fulfillment from ${commissary.name}. Original Order: ${order.order_number}. Split order created: ${splitOrder.order_number}`
      });

      return Response.json({
        fulfillment,
        split_order: splitOrder,
        invoice,
        message: 'Partial fulfillment complete. Split order created for remaining items.'
      });
    }

    // No split - close invoice
    // If there are remaining items and split_option is 'close', mark as partial and keep open
    const shouldKeepOpen = hasRemaining && split_option === 'close';
    const newStatus = shouldKeepOpen ? 'partial' : 'fulfilled';
    await base44.entities.Order.update(order_id, {
      status: newStatus,
      received_at: newStatus === 'fulfilled' ? new Date().toISOString() : null
    });

    // Create invoice for the retail location
    const invoice = await base44.entities.Invoice.create({
      company_id,
      location_id: order.location_id,
      vendor_id: commissary_location_id,
      vendor_name: commissary.name,
      invoice_number: `INV-${Date.now()}`,
      invoice_date: new Date().toISOString().split('T')[0],
      status: 'pending_review',
      extracted_items: items.filter(item => item.quantity_fulfilled > 0).map(item => ({
        item_id: item.item_id,
        item_name: item.item_name,
        quantity: item.quantity_fulfilled,
        unit_cost: item.unit_cost,
        total_cost: item.total_cost,
        matched: true,
        ...(item.variant_id ? { variant_id: item.variant_id } : {}),
        ...(item.variant_quantities ? { variant_quantities: item.variant_quantities } : {})
      })),
      total_amount,
      order_id,
      notes: `Fulfilled from ${commissary.name}. Original Order: ${order.order_number}`
    });

    return Response.json({
      fulfillment,
      invoice,
      message: 'Order fulfilled and invoice generated'
    });

  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});