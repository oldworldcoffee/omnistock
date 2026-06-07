import { useState, useEffect, useRef } from 'react';
import { base44 } from '@/api/base44Client';
import { useAuth } from '@/lib/AuthContext';
import { useIsMobile } from '@/hooks/useIsMobile';
import { Camera, Upload, CheckCircle, XCircle, Eye, AlertTriangle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import PageHeader from '@/components/layout/PageHeader';
import StatusBadge from '@/components/ui/StatusBadge';
import { format } from 'date-fns';

export default function Invoices() {
  const { canAccessLocation } = useAuth();
  const isMobile = useIsMobile();
  const [locations, setLocations] = useState([]);
  const [items, setItems] = useState([]);
  const [locInv, setLocInv] = useState([]);
  const [invoices, setInvoices] = useState([]);
  const [uploadDialog, setUploadDialog] = useState(false);
  const [reviewDialog, setReviewDialog] = useState(null);
  const [selectedLoc, setSelectedLoc] = useState('');
  const [uploading, setUploading] = useState(false);
  const [extracting, setExtracting] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [loading, setLoading] = useState(true);
  const fileRef = useRef();

  const load = () => Promise.all([
    base44.entities.Location.list(),
    base44.entities.InventoryItem.filter({ is_active: true }),
    base44.entities.LocationInventory.list(),
    base44.entities.Invoice.list('-created_date', 50),
  ]).then(([locs, itms, linv, invs]) => {
    setLocations(locs.filter(l => canAccessLocation(l.id)));
    setItems(itms);
    setLocInv(linv);
    setInvoices(invs);
    setLoading(false);
  });

  useEffect(() => { load(); }, []);

  const handleFileUpload = async (file) => {
    if (!file || !selectedLoc) return;
    setUploading(true);
    const { file_url } = await base44.integrations.Core.UploadFile({ file });
    setUploading(false);
    setExtracting(true);

    // AI extraction
    const result = await base44.integrations.Core.InvokeLLM({
      prompt: `You are an expert at reading food & beverage supplier invoices. Extract the following structured data from this invoice image. For each line item, try to match the item name to items in our inventory catalog: ${items.map(i => `"${i.name}" (id: ${i.id})`).join(', ')}. Return null for item_id if no match found. Extract all line items.`,
      file_urls: [file_url],
      response_json_schema: {
        type: 'object',
        properties: {
          vendor_name: { type: 'string' },
          invoice_number: { type: 'string' },
          invoice_date: { type: 'string' },
          total_amount: { type: 'number' },
          items: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                item_name: { type: 'string' },
                item_id: { type: 'string' },
                quantity: { type: 'number' },
                unit_cost: { type: 'number' },
                total_cost: { type: 'number' },
                matched: { type: 'boolean' },
              }
            }
          }
        }
      }
    });
    setExtracting(false);

    const invoice = await base44.entities.Invoice.create({
      location_id: selectedLoc,
      vendor_name: result.vendor_name || '',
      invoice_number: result.invoice_number || '',
      invoice_date: result.invoice_date || '',
      image_url: file_url,
      status: 'pending_review',
      extracted_items: result.items || [],
      total_amount: result.total_amount || 0,
    });

    await load();
    setUploadDialog(false);
    setReviewDialog({ ...invoice, extracted_items: result.items || [] });
  };

  const updateExtractedItem = (idx, field, val) => {
    setReviewDialog(prev => {
      const its = [...prev.extracted_items];
      its[idx] = { ...its[idx], [field]: field === 'item_id' ? val : (parseFloat(val) || 0) };
      if (field === 'item_id') {
        const item = items.find(i => i.id === val);
        if (item) its[idx].item_name = item.name;
      }
      return { ...prev, extracted_items: its };
    });
  };

  const confirmInvoice = async () => {
    setConfirming(true);
    await base44.entities.Invoice.update(reviewDialog.id, {
      status: 'confirmed',
      extracted_items: reviewDialog.extracted_items,
    });
    // Update stock levels for matched items
    for (const row of reviewDialog.extracted_items) {
      if (!row.item_id) continue;
      const li = locInv.find(l => l.location_id === reviewDialog.location_id && l.item_id === row.item_id);
      const newQty = (li?.on_hand_quantity || 0) + (row.quantity || 0);
      if (li) await base44.entities.LocationInventory.update(li.id, { ...li, on_hand_quantity: newQty });
      else await base44.entities.LocationInventory.create({ location_id: reviewDialog.location_id, item_id: row.item_id, on_hand_quantity: newQty, par_level: 0, reorder_point: 0 });
    }
    // Update related commissary order status to 'received'
    if (reviewDialog.order_id) {
      try {
        const order = await base44.entities.Order.get(reviewDialog.order_id);
        if (order && order.type === 'commissary') {
          await base44.entities.Order.update(reviewDialog.order_id, {
            status: 'received',
            received_at: new Date().toISOString()
          });
        }
      } catch (err) {
        console.error('Failed to update order status:', err);
      }
    }
    await load();
    setReviewDialog(null);
    setConfirming(false);
  };

  const rejectInvoice = async () => {
    await base44.entities.Invoice.update(reviewDialog.id, { status: 'rejected' });
    await load();
    setReviewDialog(null);
  };

  const locName = (id) => locations.find(l => l.id === id)?.name || '—';
  const pendingCount = invoices.filter(i => i.status === 'pending_review').length;

  return (
    <div className={isMobile ? "p-4 max-w-full" : "p-6 max-w-7xl mx-auto"}>
      <PageHeader
        title="Invoices"
        subtitle="Scan invoices with your camera to auto-receive stock"
        actions={<Button onClick={() => setUploadDialog(true)}><Camera className="w-4 h-4 mr-1" />Scan Invoice</Button>}
      />

      {pendingCount > 0 && (
        <div className="mb-4 bg-amber-50 border border-amber-200 rounded-lg p-3 flex items-center gap-2 text-amber-700 text-sm">
          <AlertTriangle className="w-4 h-4 flex-shrink-0" />
          {pendingCount} invoice{pendingCount > 1 ? 's' : ''} pending your review
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center h-32"><div className="w-6 h-6 border-2 border-primary/30 border-t-primary rounded-full animate-spin" /></div>
      ) : isMobile ? (
        <div className="space-y-3">
          {invoices.length === 0 ? (
            <div className="bg-card border border-border rounded-xl p-8 text-center text-muted-foreground">No invoices yet. Scan your first invoice to get started.</div>
          ) : invoices.map(inv => (
            <div key={inv.id} className={`bg-card border rounded-xl p-4 space-y-3 ${inv.status === 'pending_review' ? 'border-amber-300 bg-amber-50/30' : 'border-border'}`}>
              <div className="flex items-start justify-between gap-2">
                <div>
                  <p className="font-semibold text-sm">{inv.vendor_name || '—'}</p>
                  <p className="text-xs text-muted-foreground">{locName(inv.location_id)} · {format(new Date(inv.created_date), 'MMM d, yyyy')}</p>
                </div>
                <StatusBadge status={inv.status} />
              </div>
              <div className="grid grid-cols-3 gap-2 text-xs">
                <div><span className="text-muted-foreground block">Invoice #</span><span className="font-mono font-medium">{inv.invoice_number || '—'}</span></div>
                <div><span className="text-muted-foreground block">Total</span><span className="font-semibold text-green-700">${(inv.total_amount || 0).toFixed(2)}</span></div>
                <div><span className="text-muted-foreground block">Items</span><span className="font-medium">{inv.extracted_items?.length || 0}</span></div>
              </div>
              {inv.status === 'pending_review' && (
                <Button size="sm" className="w-full h-9" onClick={() => setReviewDialog(inv)}>
                  <Eye className="w-4 h-4 mr-1" />Review Invoice
                </Button>
              )}
            </div>
          ))}
        </div>
      ) : (
        <div className="bg-card border border-border rounded-xl overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-muted/50">
              <tr>
                {['Date', 'Location', 'Vendor', 'Invoice #', 'Total', 'Items', 'Status', ''].map(h => (
                  <th key={h} className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wide">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {invoices.length === 0 ? (
                <tr><td colSpan={8} className="px-4 py-8 text-center text-muted-foreground">No invoices yet. Scan your first invoice to get started.</td></tr>
              ) : invoices.map(inv => (
                <tr key={inv.id} className={`hover:bg-muted/30 transition-colors ${inv.status === 'pending_review' ? 'bg-amber-50/50' : ''}`}>
                  <td className="px-4 py-3">{format(new Date(inv.created_date), 'MMM d, yyyy')}</td>
                  <td className="px-4 py-3">{locName(inv.location_id)}</td>
                  <td className="px-4 py-3 font-medium">{inv.vendor_name || '—'}</td>
                  <td className="px-4 py-3 text-muted-foreground font-mono">{inv.invoice_number || '—'}</td>
                  <td className="px-4 py-3 font-medium">${(inv.total_amount || 0).toFixed(2)}</td>
                  <td className="px-4 py-3 text-muted-foreground">{inv.extracted_items?.length || 0}</td>
                  <td className="px-4 py-3"><StatusBadge status={inv.status} /></td>
                  <td className="px-4 py-3">
                    {inv.status === 'pending_review' && (
                      <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => setReviewDialog(inv)}>
                        Review
                      </Button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Upload Dialog */}
      <Dialog open={uploadDialog} onOpenChange={setUploadDialog}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>Scan Invoice</DialogTitle></DialogHeader>
          <div className="space-y-4 py-2">
            <div>
              <Label>Location *</Label>
              <select className="mt-1 w-full border border-input rounded-md px-3 py-2 text-sm bg-background" value={selectedLoc} onChange={e => setSelectedLoc(e.target.value)}>
                <option value="">Select location...</option>
                {locations.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}
              </select>
            </div>

            <input type="file" ref={fileRef} accept="image/*" capture="environment" className="hidden" onChange={e => handleFileUpload(e.target.files[0])} />

            <div className="border-2 border-dashed border-border rounded-xl p-8 flex flex-col items-center gap-3 text-center">
              {uploading && <div className="w-8 h-8 border-4 border-primary/30 border-t-primary rounded-full animate-spin" />}
              {extracting && (
                <div className="space-y-1">
                  <div className="w-8 h-8 border-4 border-amber-300 border-t-amber-600 rounded-full animate-spin mx-auto" />
                  <p className="text-sm text-amber-700 font-medium">AI is extracting invoice data...</p>
                </div>
              )}
              {!uploading && !extracting && (
                <>
                  <Camera className="w-8 h-8 text-muted-foreground" />
                  <p className="text-sm text-muted-foreground">Take a photo or upload an invoice image</p>
                  <div className="flex gap-2">
                    <Button variant="outline" size="sm" onClick={() => fileRef.current?.click()} disabled={!selectedLoc}>
                      <Camera className="w-4 h-4 mr-1" />Camera
                    </Button>
                    <Button variant="outline" size="sm" onClick={() => { if (fileRef.current) { fileRef.current.removeAttribute('capture'); fileRef.current.click(); } }} disabled={!selectedLoc}>
                      <Upload className="w-4 h-4 mr-1" />Upload
                    </Button>
                  </div>
                  {!selectedLoc && <p className="text-xs text-amber-600">Please select a location first</p>}
                </>
              )}
            </div>
          </div>
          <DialogFooter><Button variant="outline" onClick={() => setUploadDialog(false)}>Cancel</Button></DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Review Dialog */}
      <Dialog open={!!reviewDialog} onOpenChange={() => setReviewDialog(null)}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle>Review Invoice — AI Extracted Data</DialogTitle></DialogHeader>
          {reviewDialog && (
            <div className="space-y-4 py-2">
              <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 text-sm text-amber-700">
                AI has extracted the data below. Please review and correct before confirming. Confirmed items will automatically update stock levels.
              </div>
              <div className="grid grid-cols-2 gap-3 text-sm">
                <div><span className="text-muted-foreground">Vendor:</span> <span className="font-medium">{reviewDialog.vendor_name || '—'}</span></div>
                <div><span className="text-muted-foreground">Invoice #:</span> <span className="font-medium font-mono">{reviewDialog.invoice_number || '—'}</span></div>
                <div><span className="text-muted-foreground">Date:</span> <span className="font-medium">{reviewDialog.invoice_date || '—'}</span></div>
                <div><span className="text-muted-foreground">Total:</span> <span className="font-bold">${(reviewDialog.total_amount || 0).toFixed(2)}</span></div>
              </div>

              {reviewDialog.image_url && (
                <div>
                  <a href={reviewDialog.image_url} target="_blank" rel="noopener noreferrer" className="text-sm text-primary underline">View Original Image</a>
                </div>
              )}

              <div>
                <Label className="mb-2 block">Line Items — match to inventory items to update stock</Label>
                <div className="border border-border rounded-lg overflow-hidden">
                  <table className="w-full text-sm">
                    <thead className="bg-muted/50">
                      <tr>
                        {['AI Extracted Name', 'Match to Item', 'Qty', 'Unit Cost', 'Total'].map(h => (
                          <th key={h} className="text-left px-3 py-2 text-xs font-medium text-muted-foreground">{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {(reviewDialog.extracted_items || []).map((row, idx) => (
                        <tr key={idx} className="hover:bg-muted/20">
                          <td className="px-3 py-2 text-xs text-muted-foreground">{row.item_name}</td>
                          <td className="px-3 py-2">
                            <select
                              className="w-full border border-input rounded px-2 py-1 text-xs bg-background"
                              value={row.item_id || ''}
                              onChange={e => updateExtractedItem(idx, 'item_id', e.target.value)}
                            >
                              <option value="">— No match —</option>
                              {items.map(i => <option key={i.id} value={i.id}>{i.name}</option>)}
                            </select>
                          </td>
                          <td className="px-3 py-2">
                            <Input type="number" className="w-20 h-7 text-xs" value={row.quantity} onChange={e => updateExtractedItem(idx, 'quantity', e.target.value)} />
                          </td>
                          <td className="px-3 py-2">
                            <Input type="number" step="0.01" className="w-20 h-7 text-xs" value={row.unit_cost} onChange={e => updateExtractedItem(idx, 'unit_cost', e.target.value)} />
                          </td>
                          <td className="px-3 py-2 text-xs font-medium">${((row.quantity || 0) * (row.unit_cost || 0)).toFixed(2)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" className="text-destructive" onClick={rejectInvoice}>
              <XCircle className="w-4 h-4 mr-1" />Reject
            </Button>
            <Button onClick={confirmInvoice} disabled={confirming}>
              <CheckCircle className="w-4 h-4 mr-1" />{confirming ? 'Confirming...' : 'Confirm & Receive Stock'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}