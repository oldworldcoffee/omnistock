import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';
import jsPDF from 'npm:jspdf@4.0.0';
import 'npm:jspdf-autotable@4.0.0';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    
    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { items } = await req.json();
    
    const doc = new jsPDF();
    
    // Title
    doc.setFontSize(18);
    doc.text('Master Catalog', 14, 20);
    
    doc.setFontSize(10);
    doc.text(`Generated: ${new Date().toLocaleDateString()} | Total Items: ${items.length}`, 14, 28);
    
    // Table headers
    const headers = [['Item Name', 'SKU', 'Category', 'UOM', 'Vendor', 'Cost', 'Active']];
    
    const data = items.map(item => {
      const opts = item.purchase_options || [];
      const preferred = opts.find(o => o.is_preferred) || opts[0];
      
      return [
        item.name,
        item.sku || '—',
        item.category || '—',
        item.unit_of_measure,
        preferred?.vendor_name || '—',
        preferred?.unit_cost ? `$${parseFloat(preferred.unit_cost).toFixed(2)}` : '—',
        item.is_active !== false ? 'Yes' : 'No'
      ];
    });
    
    doc.autoTable({
      head: headers,
      body: data,
      startY: 35,
      theme: 'striped',
      headStyles: { fillColor: [41, 128, 185] },
      styles: { fontSize: 8 },
      columnStyles: {
        0: { cellWidth: 50 },
        1: { cellWidth: 25 },
        2: { cellWidth: 30 },
        3: { cellWidth: 20 },
        4: { cellWidth: 35 },
        5: { cellWidth: 20 },
        6: { cellWidth: 15 }
      }
    });
    
    const pdfBytes = doc.output('arraybuffer');
    
    return new Response(pdfBytes, {
      status: 200,
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="master_catalog_${new Date().toISOString().split('T')[0]}.pdf"`
      }
    });
    
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});