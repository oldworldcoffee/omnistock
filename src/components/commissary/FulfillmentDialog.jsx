import React, { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { toast } from 'sonner';
import { base44 } from '@/api/base44Client';

export default function FulfillmentDialog({ open, onOpenChange, order, commissaryLocationId, onFulfilled }) {
  const [fulfillmentItems, setFulfillmentItems] = useState([]);
  const [notes, setNotes] = useState('');
  const [fulfilling, setFulfilling] = useState(false);
  const [splitOption, setSplitOption] = useState('close');
  const [variants, setVariants] = useState([]);

  useEffect(() => {
    if (open) {
      base44.entities.ItemVariant.list().then(setVariants);
    }
  }, [open]);

  useEffect(() => {
    if (order && open) {
      // Expand items with variant_quantities into separate line items
      const expandedItems = (order.items || []).flatMap(item => {
        const hasVariantBreakdown = item.variant_quantities && Object.keys(item.variant_quantities).length > 0;
        
        if (hasVariantBreakdown) {
          // Expand variant quantities into separate items
          return Object.entries(item.variant_quantities)
            .filter(([, qty]) => qty > 0)
            .map(([variantId, qty]) => {
              const variant = variants.find(v => v.id === variantId);
              const baseName = item.item_name.replace(/\s*\([^()]+\)$/, '');
              return {
                ...item,
                variant_id: variantId,
                item_name: variant ? `${baseName} (${variant.variant_name})` : `${baseName} (${variantId})`,
                quantity_ordered: qty,
                quantity_fulfilled: qty,
                notes: ''
              };
            });
        } else {
          // Single item or single variant
          const variant = item.variant_id ? variants.find(v => v.id === item.variant_id) : null;
          return [{
            ...item,
            item_name: variant ? `${item.item_name.replace(/\s*\([^()]+\)$/, '')} (${variant.variant_name})` : item.item_name,
            quantity_fulfilled: item.quantity_ordered,
            notes: ''
          }];
        }
      });
      setFulfillmentItems(expandedItems);
      setNotes('');
    }
  }, [order, open, variants]);

  const updateItem = (idx, field, value) => {
    setFulfillmentItems(prev =>
      prev.map((item, i) => (i === idx ? { ...item, [field]: value } : item))
    );
  };

  const hasPartialFulfillment = fulfillmentItems.some(item => (item.quantity_fulfilled || 0) < (item.quantity_ordered || 0));

  const handleFulfill = async () => {
    if (!order || !commissaryLocationId) return;

    setFulfilling(true);
    try {
      const response = await base44.functions.invoke('fulfillCommissaryOrder', {
        order_id: order.id,
        commissary_location_id: commissaryLocationId,
        fulfillment_items: fulfillmentItems,
        notes,
        split_option: hasPartialFulfillment ? splitOption : 'close'
      });

      toast.success(hasPartialFulfillment && splitOption === 'split' ? 'Partial fulfillment complete! Split invoice created.' : 'Order fulfilled! Invoice generated.');
      onFulfilled?.(response.data);
      onOpenChange(false);
    } catch (error) {
      toast.error('Failed to fulfill: ' + error.message);
    } finally {
      setFulfilling(false);
    }
  };

  const totalAmount = fulfillmentItems.reduce(
    (sum, item) => sum + (item.quantity_fulfilled || 0) * (item.unit_cost || 0),
    0
  );

  if (!order) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Fulfill Order #{order.order_number}</DialogTitle>
          <p className="text-sm text-muted-foreground mt-1">
            Retail Location: <span className="font-medium">{order.location_id}</span>
          </p>
        </DialogHeader>

        <div className="mt-4 space-y-4">
          <div className="border border-border rounded-lg overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-muted/60">
                <tr>
                  <th className="text-left px-3 py-2">Item</th>
                  <th className="text-right px-3 py-2">Ordered</th>
                  <th className="text-right px-3 py-2">Fulfill</th>
                  <th className="text-right px-3 py-2">Unit Cost</th>
                  <th className="text-right px-3 py-2">Total</th>
                  <th className="px-3 py-2">Notes</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {fulfillmentItems.map((item, idx) => (
                  <tr key={item.item_id + (item.variant_id || '') + idx} className="hover:bg-muted/30">
                    <td className="px-3 py-2.5 font-medium">{item.item_name}</td>
                    <td className="px-3 py-2.5 text-right">{item.quantity_ordered} {item.unit_of_measure}</td>
                    <td className="px-3 py-2.5 text-right">
                      <Input
                        type="number"
                        className="w-20 ml-auto"
                        value={item.quantity_fulfilled}
                        onChange={e => updateItem(idx, 'quantity_fulfilled', parseFloat(e.target.value) || 0)}
                        max={item.quantity_ordered}
                        min={0}
                        step={1}
                      />
                    </td>
                    <td className="px-3 py-2.5 text-right">
                      <Input
                        type="number"
                        className="w-20 ml-auto"
                        value={item.unit_cost}
                        onChange={e => updateItem(idx, 'unit_cost', parseFloat(e.target.value) || 0)}
                        step="0.01"
                        min={0}
                      />
                    </td>
                    <td className="px-3 py-2.5 text-right font-medium">
                      ${((item.quantity_fulfilled || 0) * (item.unit_cost || 0)).toFixed(2)}
                    </td>
                    <td className="px-3 py-2.5">
                      <Input
                        className="w-full"
                        value={item.notes || ''}
                        onChange={e => updateItem(idx, 'notes', e.target.value)}
                        placeholder="Optional note"
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot className="bg-muted/40">
                <tr>
                  <td colSpan={4} className="px-3 py-2 text-right font-semibold">Total:</td>
                  <td className="px-3 py-2 text-right font-bold text-primary">${totalAmount.toFixed(2)}</td>
                  <td></td>
                </tr>
              </tfoot>
            </table>
          </div>

          {hasPartialFulfillment && (
            <div className="border border-amber-200 rounded-lg p-4 bg-amber-50">
              <Label className="text-amber-900">Partial Fulfillment Detected</Label>
              <p className="text-xs text-amber-700 mt-1 mb-3">Some items have quantities less than ordered. How would you like to handle the remaining items?</p>
              <div className="space-y-2">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="radio"
                    name="split_option"
                    value="close"
                    checked={splitOption === 'close'}
                    onChange={(e) => setSplitOption(e.target.value)}
                    className="w-4 h-4 text-primary"
                  />
                  <div>
                    <span className="text-sm font-medium text-amber-900">Close Invoice</span>
                    <p className="text-xs text-amber-700">Complete this invoice with fulfilled items only. Remaining items will stay on the order.</p>
                  </div>
                </label>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="radio"
                    name="split_option"
                    value="split"
                    checked={splitOption === 'split'}
                    onChange={(e) => setSplitOption(e.target.value)}
                    className="w-4 h-4 text-primary"
                  />
                  <div>
                    <span className="text-sm font-medium text-amber-900">Split & Create New Invoice</span>
                    <p className="text-xs text-amber-700">Create a second invoice for the remaining items to be fulfilled later.</p>
                  </div>
                </label>
              </div>
            </div>
          )}

          <div>
            <Label>Fulfillment Notes</Label>
            <Textarea
              className="mt-1"
              value={notes}
              onChange={e => setNotes(e.target.value)}
              placeholder="Any notes about this fulfillment..."
              rows={3}
            />
          </div>
        </div>

        <DialogFooter className="mt-4">
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={handleFulfill} disabled={fulfilling}>
            {fulfilling ? 'Processing...' : 'Fulfill & Generate Invoice'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}