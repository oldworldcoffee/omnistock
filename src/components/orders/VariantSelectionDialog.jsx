import { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Plus, Package } from 'lucide-react';

export default function VariantSelectionDialog({ open, onOpenChange, group, items, onConfirm }) {
  const [quantities, setQuantities] = useState({});

  if (!group) return null;

  const handleConfirm = () => {
    const selectedVariants = items
      .filter(item => quantities[item.id] > 0)
      .map(item => ({
        item_id: item.id,
        item_name: item.name,
        category: item.category,
        unit_of_measure: item.unit_of_measure,
        qty: quantities[item.id],
      }));
    
    if (selectedVariants.length === 0) return;
    onConfirm(selectedVariants);
    setQuantities({});
    onOpenChange(false);
  };

  const handleCancel = () => {
    setQuantities({});
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={handleCancel}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Select Variants - {group.name}</DialogTitle>
        </DialogHeader>
        
        <div className="space-y-3 py-4">
          <p className="text-sm text-muted-foreground">Choose which variants to add to your order:</p>
          
          <div className="space-y-2 max-h-80 overflow-y-auto">
            {items.map((item, idx) => (
              <div key={item.id} className="flex items-center justify-between gap-3 p-3 border border-border rounded-lg hover:bg-muted/30 transition-colors">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <Package className="w-3.5 h-3.5 text-muted-foreground" />
                    <p className="text-sm font-medium truncate">{item.name}</p>
                  </div>
                  <p className="text-xs text-muted-foreground mt-0.5">{item.unit_of_measure} • ${(item.unit_cost || 0).toFixed(2)}</p>
                </div>
                <div className="flex items-center gap-2">
                  <Input
                    type="number"
                    min="0"
                    className="w-20 h-8"
                    placeholder="0"
                    value={quantities[item.id] || ''}
                    onChange={(e) => setQuantities({ ...quantities, [item.id]: parseInt(e.target.value) || 0 })}
                  />
                </div>
              </div>
            ))}
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={handleCancel}>Cancel</Button>
          <Button onClick={handleConfirm} disabled={Object.values(quantities).every(q => !q || q === 0)}>
            <Plus className="w-4 h-4 mr-1" /> Add to Cart
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}