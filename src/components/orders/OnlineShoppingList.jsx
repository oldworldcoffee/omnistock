import { ExternalLink, Check } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useState } from 'react';

export default function OnlineShoppingList({ carts, vendors, onUpdateQty, onRemove, onClearCart }) {
  const [markedItems, setMarkedItems] = useState({});

  const handleMarkAsOrdered = (vendorId, itemId) => {
    const key = `${vendorId}_${itemId}`;
    setMarkedItems(prev => ({ ...prev, [key]: !prev[key] }));
  };

  const allMarked = (vendorId, cart) =>
    cart.every(item => markedItems[`${vendorId}_${item.item_id}`]);

  const handleVendorComplete = (vendorId, cart) => {
    const allKeys = cart.map(item => `${vendorId}_${item.item_id}`);
    const allCurrentlyMarked = allKeys.every(key => markedItems[key]);
    if (allCurrentlyMarked) {
      const newMarked = { ...markedItems };
      allKeys.forEach(key => delete newMarked[key]);
      setMarkedItems(newMarked);
    } else {
      const newMarked = { ...markedItems };
      allKeys.forEach(key => newMarked[key] = true);
      setMarkedItems(newMarked);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold">Online Shopping List</h2>
        <p className="text-sm text-muted-foreground">Click vendor links to order, then mark items as completed</p>
      </div>

      {Object.entries(carts).map(([vendorId, cart]) => {
        const vendor = vendors.find(v => v.id === vendorId);
        const vendorComplete = allMarked(vendorId, cart);
        const total = cart.reduce((s, i) => s + (i.total_cost || 0), 0);

        return (
          <div key={vendorId} className="border border-border rounded-lg overflow-hidden">
            <div className="bg-muted/50 px-4 py-3 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <h3 className="font-semibold">{vendor?.name || 'Unknown Vendor'}</h3>
                <span className="text-xs text-muted-foreground">{cart.length} items</span>
              </div>
              <div className="flex items-center gap-2">
                <Button size="sm" variant={vendorComplete ? "default" : "outline"} onClick={() => handleVendorComplete(vendorId, cart)}>
                  <Check className="w-3.5 h-3.5 mr-1" />
                  {vendorComplete ? 'All Complete' : 'Mark All Complete'}
                </Button>
                <Button size="sm" variant="ghost" onClick={() => onClearCart(vendorId)}>Clear</Button>
              </div>
            </div>

            <div className="divide-y divide-border">
              {cart.map((item, idx) => {
                const itemKey = `${vendorId}_${item.item_id}`;
                const isMarked = !!markedItems[itemKey];
                const preferredOption = item.purchase_options?.find(p => p.is_preferred && p.vendor_id === vendorId) ||
                                        item.purchase_options?.find(p => p.vendor_id === vendorId);
                const productUrl = preferredOption?.product_url;
                const imageUrl = preferredOption?.product_image_url;

                return (
                  <div key={idx} className={`p-4 flex items-center gap-4 hover:bg-muted/30 ${isMarked ? 'bg-success/5' : ''}`}>
                    <div className="w-16 h-16 bg-muted rounded-lg flex items-center justify-center flex-shrink-0 overflow-hidden border">
                      {imageUrl ? (
                        <img src={imageUrl} alt={item.item_name} className="w-full h-full object-cover"
                          onError={(e) => { e.target.style.display = 'none'; e.target.parentElement.innerHTML = '<span class="text-xs text-muted-foreground">No image</span>'; }} />
                      ) : (
                        <span className="text-xs text-muted-foreground">No image</span>
                      )}
                    </div>

                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <h4 className={`font-medium ${isMarked ? 'line-through text-muted-foreground' : ''}`}>{item.item_name}</h4>
                        {isMarked && (
                          <span className="text-xs text-success font-medium flex items-center">
                            <Check className="w-3 h-3 mr-0.5" /> Ordered
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-4 mt-1 text-sm text-muted-foreground">
                        <div className="flex items-center gap-0.5">
                          <button onClick={() => onUpdateQty(vendorId, idx, item.qty - 1)}
                            className="w-5 h-5 rounded border border-input flex items-center justify-center hover:bg-muted text-xs">−</button>
                          <span className="w-8 text-center text-xs font-medium text-foreground">{item.qty}</span>
                          <button onClick={() => onUpdateQty(vendorId, idx, item.qty + 1)}
                            className="w-5 h-5 rounded border border-input flex items-center justify-center hover:bg-muted text-xs">+</button>
                        </div>
                        <span>{item.unit_of_measure}</span>
                        <span>${(item.total_cost || 0).toFixed(2)}</span>
                      </div>
                    </div>

                    <div className="flex items-center gap-2">
                      {productUrl ? (
                        <a href={productUrl} target="_blank" rel="noopener noreferrer"
                          className="inline-flex items-center gap-1.5 px-3 py-2 bg-primary text-primary-foreground rounded-md hover:bg-primary/90 text-sm font-medium transition-colors">
                          <ExternalLink className="w-3.5 h-3.5" />Buy Now
                        </a>
                      ) : (
                        <Button variant="outline" disabled size="sm">No Link</Button>
                      )}
                      <Button variant={isMarked ? "outline" : "default"} size="sm"
                        onClick={() => handleMarkAsOrdered(vendorId, item.item_id)}>
                        {isMarked ? 'Undo' : 'Mark Done'}
                      </Button>
                      <button onClick={() => onRemove(vendorId, idx)}
                        className="text-muted-foreground hover:text-destructive p-1">
                        <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <path d="M3 6h18M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/>
                        </svg>
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>

            <div className="bg-muted/30 px-4 py-2 flex justify-end">
              <span className="text-sm font-semibold">Total: ${total.toFixed(2)}</span>
            </div>
          </div>
        );
      })}
    </div>
  );
}