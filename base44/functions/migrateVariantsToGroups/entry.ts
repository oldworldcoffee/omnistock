import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (user?.role !== 'admin') {
      return Response.json({ error: 'Forbidden: Admin access required' }, { status: 403 });
    }

    // Fetch all items with variants
    const items = await base44.entities.InventoryItem.list();
    const variants = await base44.entities.ItemVariant.list();

    // Group variants by parent item
    const variantsByItem = {};
    variants.forEach(variant => {
      if (!variantsByItem[variant.item_id]) {
        variantsByItem[variant.item_id] = [];
      }
      variantsByItem[variant.item_id].push(variant);
    });

    let migratedCount = 0;
    let errorCount = 0;
    const errors = [];

    // Process each item that has variants
    for (const item of items) {
      const itemVariants = variantsByItem[item.id] || [];
      
      if (itemVariants.length === 0) {
        continue; // No variants to migrate
      }

      // Generate a product group ID
      const productGroupId = `group-${item.id}-${Date.now()}`;

      // Update the parent item with product_group_id
      await base44.entities.InventoryItem.update(item.id, {
        product_group_id: productGroupId,
        group_sort_order: 0,
        // Keep the base item's name as-is (it represents the base product)
      });

      // Convert each variant to a standalone item
      for (let i = 0; i < itemVariants.length; i++) {
        const variant = itemVariants[i];
        
        // Extract the size/variant name from variant_name
        const variantName = variant.variant_name || 'Default';
        
        // Create new item name: "Base Name - Variant"
        const newItemName = `${item.name} - ${variantName}`;

        try {
          await base44.entities.InventoryItem.create({
            company_id: item.company_id,
            name: newItemName,
            sku: variant.sku || item.sku,
            category: item.category,
            unit_of_measure: item.unit_of_measure,
            unit_cost: variant.unit_cost || item.unit_cost,
            is_commissary_item: item.is_commissary_item,
            commissary_price: item.commissary_price,
            commissary_vendor_id: item.commissary_vendor_id,
            is_active: item.is_active,
            description: item.description,
            vendor_id: item.vendor_id,
            inner_pack_units: item.inner_pack_units,
            inner_pack_name: item.inner_pack_name,
            packs_per_case: item.packs_per_case,
            count_units: item.count_units,
            purchase_options: item.purchase_options,
            product_group_id: productGroupId,
            group_sort_order: i + 1,
          });
          migratedCount++;
        } catch (err) {
          errorCount++;
          errors.push(`Failed to migrate variant ${variant.id}: ${err.message}`);
        }
      }
    }

    return Response.json({
      success: true,
      migratedCount,
      errorCount,
      errors: errors.slice(0, 10), // Limit error output
      message: `Migrated ${migratedCount} variants to grouped items. ${errorCount > 0 ? `${errorCount} errors occurred.` : ''}`
    });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});