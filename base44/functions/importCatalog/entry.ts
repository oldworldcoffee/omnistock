import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';
import * as XLSX from 'npm:xlsx@0.18.5';

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

    const { file_url } = await req.json();
    if (!file_url) {
      return Response.json({ error: 'file_url is required' }, { status: 400 });
    }

    // Download the file
    const response = await fetch(file_url);
    const arrayBuffer = await response.arrayBuffer();
    
    // Parse Excel file
    const workbook = XLSX.read(arrayBuffer, { type: 'array' });
    const sheetName = workbook.SheetNames[0];
    const worksheet = workbook.Sheets[sheetName];
    const data = XLSX.utils.sheet_to_json(worksheet);
    
    if (!data || data.length === 0) {
      return Response.json({ 
        success: false, 
        error: 'No data found in spreadsheet' 
      }, { status: 400 });
    }

    const results = {
      items: { created: 0, updated: 0, errors: [] },
      vendors: { created: 0, errors: [] }
    };
    
    // Get existing items and vendors
    const existingItems = await base44.asServiceRole.entities.InventoryItem.list();
    const itemMap = new Map(existingItems.map(i => [i.name.toLowerCase(), i]));
    
    const existingVendors = await base44.asServiceRole.entities.Vendor.list();
    const vendorMap = new Map(existingVendors.map(v => [v.name.toLowerCase(), v]));
    
    // Group rows by item name (same item can have multiple purchase options)
    const itemsByName = new Map();
    for (const row of data) {
      const itemName = row['Inventory item'];
      if (!itemName) continue;
      
      if (!itemsByName.has(itemName)) {
        itemsByName.set(itemName, []);
      }
      itemsByName.get(itemName).push(row);
    }
    
    // First pass: Create all vendors
    const uniqueVendors = new Set();
    for (const rows of itemsByName.values()) {
      for (const row of rows) {
        if (row['Supplier']) {
          uniqueVendors.add(row['Supplier']);
        }
      }
    }
    
    // Create missing vendors and refresh the vendor list to get IDs
    const batchSize = 20;
    let vendorIndex = 0;
    for (const vendorName of uniqueVendors) {
      if (!vendorMap.has(vendorName.toLowerCase())) {
        try {
          const created = await base44.asServiceRole.entities.Vendor.create({
            name: vendorName,
            email: '',
            contact_name: '',
            phone: '',
            address: '',
            notes: 'Auto-created during catalog import',
            is_active: true
          });
          results.vendors.created++;
          vendorMap.set(vendorName.toLowerCase(), { id: created.id, name: vendorName });
          console.log(`Created vendor "${vendorName}" with ID: ${created.id}`);
        } catch (err) {
          results.vendors.errors.push(`Vendor "${vendorName}": ${err.message}`);
        }
        
        vendorIndex++;
        if (vendorIndex % batchSize === 0) {
          await new Promise(resolve => setTimeout(resolve, 300));
        }
      }
    }
    
    // Refresh vendor map with all vendors to ensure we have IDs
    const allVendors = await base44.asServiceRole.entities.Vendor.list();
    allVendors.forEach(v => {
      vendorMap.set(v.name.toLowerCase(), { id: v.id, name: v.name });
    });
    console.log('Final vendor map:', Object.fromEntries(vendorMap));
    
    // Second pass: Create/update items with consolidated purchase options
    let itemIndex = 0;
    for (const [itemName, rows] of itemsByName.entries()) {
      try {
        // Use first row as base item info
        const firstRow = rows[0];
        const category = firstRow['Category'] || '';
        const uom = firstRow['UOM'] || 'EA';
        const orderingEnabled = (firstRow['Ordering enabled'] || 'Yes').toString().toLowerCase() === 'yes';
        
        // Build purchase options from ALL rows with same item name
        const purchaseOptions = [];
        let preferredSet = false;
        
        for (const row of rows) {
          const supplier = row['Supplier'];
          if (!supplier) continue;
          
          // Refresh vendor map to ensure we have the latest created vendors
          const vendor = vendorMap.get(supplier.toLowerCase());
          console.log(`Looking up vendor "${supplier}":`, vendor);
          const purchaseOptionsName = row['Purchase options'] || itemName;
          const productCode = row['Product Code'] || '';
          const price = parseFloat(row['Price after discount'] || row['Price'] || 0) || 0;
          const innerPackQty = parseFloat(row['Inner pack quantity'] || 0) || null;
          const packNickname = row['Pack nickname'] || '';
          const packsPerCase = parseFloat(row['Packs per case'] || 0) || null;
          
          purchaseOptions.push({
            vendor_id: vendor?.id || null,
            vendor_name: supplier,
            product_name: purchaseOptionsName,
            product_code: productCode,
            pack_size: '',
            unit_cost: price,
            inner_pack_units: innerPackQty,
            inner_pack_name: packNickname,
            packs_per_case: packsPerCase,
            is_preferred: !preferredSet,
            location_ids: null,
            notes: ''
          });
          preferredSet = true;
        }
        
        // Get the best price from all purchase options
        const bestPrice = purchaseOptions.length > 0 
          ? Math.min(...purchaseOptions.map(po => po.unit_cost))
          : (parseFloat(firstRow['Price after discount'] || firstRow['Price'] || 0) || 0);
        
        const itemData = {
          name: itemName,
          sku: firstRow['Product Code'] || '',
          category: category,
          unit_of_measure: uom,
          description: '',
          is_active: orderingEnabled,
          is_commissary_item: false,
          commissary_price: null,
          unit_cost: bestPrice,
          purchase_options: purchaseOptions,
          ai_suggested_par: parseFloat(firstRow['Par level'] || 0) || null,
          minimum_reorder_volume: parseFloat(firstRow['Min On Hand'] || firstRow['Min order quantity'] || 0) || null,
          last_par_calculation_date: null
        };
        
        const existingItem = itemMap.get(itemName.toLowerCase());
        
        if (existingItem) {
          // Merge purchase options with existing ones
          const existingOptions = existingItem.purchase_options || [];
          const existingVendorNames = new Set(existingOptions.map(o => o.vendor_name?.toLowerCase()));
          
          // Only add new purchase options that don't already exist
          const newOptions = purchaseOptions.filter(po => !existingVendorNames.has(po.vendor_name?.toLowerCase()));
          
          if (newOptions.length > 0) {
            itemData.purchase_options = [...existingOptions, ...newOptions];
            await base44.asServiceRole.entities.InventoryItem.update(existingItem.id, itemData);
            results.items.updated++;
          }
        } else {
          await base44.asServiceRole.entities.InventoryItem.create(itemData);
          results.items.created++;
        }
        
        // Add small delay every 20 items to avoid rate limits
        itemIndex++;
        if (itemIndex % batchSize === 0) {
          await new Promise(resolve => setTimeout(resolve, 500));
        }
      } catch (err) {
        results.items.errors.push(`Item "${itemName}": ${err.message}`);
      }
    }
    
    return Response.json({
      success: true,
      results
    });
    
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});