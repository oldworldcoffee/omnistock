import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    
    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Return CSV template
    const csvContent = `Item Name,SKU,Category,Unit of Measure,Unit Cost,Is Commissary Item,Commissary Price,Description,Vendor Name,Vendor Email,Product Name,Product Code,Pack Size,Inner Pack Units,Inner Pack Name,Packs Per Case,AI Suggested Par,Minimum Reorder Volume,Is Active
"Sample Item","SKU001","Produce","EA",2.50,No,,"Fresh produce item","Example Vendor","vendor@example.com","Product ABC","ABC123","6x10oz",6,"Pack",10,100,50,Yes
"Another Item","SKU002","Dairy","EA",5.75,No,,"Dairy product","Dairy Supplier","dairy@example.com","Milk Carton","MILK001","12 pack",12,"Carton",1,50,25,Yes`;

    return new Response(csvContent, {
      status: 200,
      headers: {
        'Content-Type': 'text/csv',
        'Content-Disposition': 'attachment; filename="catalog_import_template.csv"'
      }
    });
    
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});