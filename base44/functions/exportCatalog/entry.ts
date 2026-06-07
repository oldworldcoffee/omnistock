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

    const { format, items } = await req.json();
    
    if (!format || !items) {
      return Response.json({ error: 'Format and items required' }, { status: 400 });
    }

    if (format === 'pdf') {
      const doc = new jsPDF();
      
      // Title
      doc.setFontSize(18);
      doc.text('Master Catalog', 14, 20);
      doc.setFontSize(11);
      doc.text(`Generated: ${new Date().toLocaleDateString()}`, 14, 28);
      doc.text(`Total Items: ${items.length}`, 14, 34);
      
      // Table
      const tableData = items.map(item => {
        const opts = item.purchase_options || [];
        const preferred = opts.find(o => o.is_preferred) || opts[0];
        return [
          item.name,
          item.sku || '—',
          item.category || '—',
          item.unit_of_measure,
          preferred ? `$${parseFloat(preferred.unit_cost || 0).toFixed(2)}` : '$0.00',
          item.is_commissary_item ? `Yes ($${parseFloat(item.commissary_price || 0).toFixed(2)})` : 'No',
          item.is_active ? 'Active' : 'Inactive'
        ];
      });
      
      doc.autoTable({
        startY: 40,
        head: [['Item Name', 'SKU', 'Category', 'UOM', 'Cost', 'Commissary', 'Status']],
        body: tableData,
        theme: 'striped',
        headStyles: { fillColor: [41, 128, 185] },
        styles: { fontSize: 8 },
        columnStyles: {
          0: { cellWidth: 50 },
          1: { cellWidth: 25 },
          2: { cellWidth: 30 },
          3: { cellWidth: 15 },
          4: { cellWidth: 20 },
          5: { cellWidth: 25 },
          6: { cellWidth: 20 }
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
    } else {
      // CSV format
      const headers = ['Item Name', 'SKU', 'Category', 'Unit of Measure', 'Unit Cost', 'Is Commissary Item', 'Commissary Price', 'Vendor', 'Is Active'];
      const csvRows = [headers.join(',')];
      
      items.forEach(item => {
        const opts = item.purchase_options || [];
        const preferred = opts.find(o => o.is_preferred) || opts[0];
        const row = [
          `"${item.name}"`,
          `"${item.sku || ''}"`,
          `"${item.category || ''}"`,
          `"${item.unit_of_measure}"`,
          parseFloat(preferred?.unit_cost || item.unit_cost || 0).toFixed(2),
          item.is_commissary_item ? 'Yes' : 'No',
          parseFloat(item.commissary_price || 0).toFixed(2),
          `"${preferred?.vendor_name || ''}"`,
          item.is_active ? 'Yes' : 'No'
        ];
        csvRows.push(row.join(','));
      });
      
      const csvContent = csvRows.join('\n');
      
      return new Response(csvContent, {
        status: 200,
        headers: {
          'Content-Type': 'text/csv',
          'Content-Disposition': `attachment; filename="master_catalog_${new Date().toISOString().split('T')[0]}.csv"`
        }
      });
    }
    
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});