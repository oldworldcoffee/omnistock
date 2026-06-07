import { useState } from 'react';
import { Check, ShoppingBasket, Minus, Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';

export default function InStoreShoppingList({ carts, vendors, onClearCart, onUpdateQty, onRemove }) {
  const [checkedItems, setCheckedItems] = useState({});

  const toggleCheck = (vendorId, itemId) => {
    const key = `${vendorId}_${itemId}`;
    setCheckedItems(prev => ({ ...prev, [key]: !prev[key] }));
  };

  const isChecked = (vendorId, itemId) => !!checkedItems[`${vendorId}_${itemId}`];

  const checkedCount = (vendorId, cart) =>
    cart.filter(item => checkedItems[`${vendorId}_${item.item_id}`]).length;

  const markAll = (vendorId, cart) => {
    const allKeys = cart.map(item => `${vendorId}_${item.item_id}`);
    const allMarked = allKeys.every(k => checkedItems[k]);
    const newChecked = { ...checkedItems };
    allKeys.forEach(k => { if (allMarked) delete newChecked[k]; else newChecked[k] = true; });
    setCheckedItems(newChecked);
  };

  const handleDone = (vendorId) => {
    // Clear checked items from state then clear cart
    const newChecked = { ...checkedItems };
    Object.keys(newChecked).forEach(k => { if (k.startsWith(`${vendorId}_`)) delete newChecked[k]; });
    setCheckedItems(newChecked);
    onClearCart(vendorId);
  };

  if (Object.keys(carts).length === 0) {
    return (
      <div className="text-center py-16">
        <ShoppingBasket className="w-12 h-12 mx-auto text-muted-foreground/30 mb-3" />
        <p className="text-muted-foreground font-medium">No items in your shopping list</p>
        <p className="text-sm text-muted-foreground mt-1">Add items from the catalog using the Fill to Par or add them individually</p>
      </div>
    );
  }

  return (
    <div className="space-y-6 max-w-2xl mx-auto">
      <div>
        <h2 className="text-lg font-semibold">In-Store Shopping List</h2>
        <p className="text-sm text-muted-foreground">Check off items as you add them to your cart</p>
      </div>

      {Object.entries(carts).map(([vendorId, cart]) => {
        const vendor = vendors.find(v => v.id === vendorId);
        const done = checkedCount(vendorId, cart);
        const total = cart.length;

        return (
          <div key={vendorId} className="border border-border rounded-xl overflow-hidden shadow-sm">
            {/* Vendor header */}
            <div className="bg-muted/50 px-4 py-3 flex items-center justify-between border-b border-border">
              <div className="flex items-center gap-3">
                <ShoppingBasket className="w-4 h-4 text-primary" />
                <div>
                  <h3 className="font-semibold text-sm">{vendor?.name || 'Unknown Store'}</h3>
                  <p className="text-xs text-muted-foreground">{done}/{total} items checked off</p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Button size="sm" variant="outline" onClick={() => markAll(vendorId, cart)}>
                  <Check className="w-3.5 h-3.5 mr-1" />
                  {cart.every(i => checkedItems[`${vendorId}_${i.item_id}`]) ? 'Uncheck All' : 'Check All'}
                </Button>
                {done === total && total > 0 && (
                  <Button size="sm" variant="default" onClick={() => handleDone(vendorId)}>
                    Done & Clear
                  </Button>
                )}
                <Button size="sm" variant="ghost" className="text-muted-foreground" onClick={() => onClearCart(vendorId)}>
                  Clear
                </Button>
              </div>
            </div>

            {/* Progress bar */}
            <div className="h-1 bg-muted">
              <div
                className="h-1 bg-success transition-all duration-300"
                style={{ width: total > 0 ? `${(done / total) * 100}%` : '0%' }}
              />
            </div>

            {/* Items */}
            <div className="divide-y divide-border bg-card">
              {cart.map((item, idx) => {
                const checked = isChecked(vendorId, item.item_id);
                return (
                  <div
                    key={item.item_id}
                    className={`flex items-center gap-3 px-4 py-3 transition-colors ${checked ? 'bg-success/5' : 'hover:bg-muted/20'}`}
                  >
                    {/* Checkbox */}
                    <button
                      onClick={() => toggleCheck(vendorId, item.item_id)}
                      className={`w-6 h-6 rounded-full border-2 flex items-center justify-center flex-shrink-0 transition-all ${
                        checked
                          ? 'bg-success border-success text-white'
                          : 'border-muted-foreground/40 hover:border-primary'
                      }`}
                    >
                      {checked && <Check className="w-3.5 h-3.5" />}
                    </button>

                    {/* Item info */}
                    <div className="flex-1 min-w-0">
                      <p className={`text-sm font-medium ${checked ? 'line-through text-muted-foreground' : ''}`}>
                        {item.item_name}
                      </p>
                      {item.category && (
                        <p className="text-xs text-muted-foreground">{item.category}</p>
                      )}
                    </div>

                    {/* Qty controls */}
                    <div className="flex items-center gap-1.5">
                      <button
                        onClick={() => {
                          if (item.qty <= 1) onRemove(vendorId, idx);
                          else onUpdateQty(vendorId, idx, item.qty - 1);
                        }}
                        className="w-7 h-7 rounded-full border border-input flex items-center justify-center hover:bg-muted transition-colors"
                      >
                        <Minus className="w-3 h-3" />
                      </button>
                      <span className="w-10 text-center text-sm font-semibold">
                        {item.qty}
                      </span>
                      <button
                        onClick={() => onUpdateQty(vendorId, idx, item.qty + 1)}
                        className="w-7 h-7 rounded-full border border-input flex items-center justify-center hover:bg-muted transition-colors"
                      >
                        <Plus className="w-3 h-3" />
                      </button>
                      <span className="text-xs text-muted-foreground w-12">{item.unit_of_measure}</span>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Footer total */}
            <div className="px-4 py-2.5 bg-muted/30 border-t border-border flex items-center justify-between">
              <span className="text-xs text-muted-foreground">{total} items</span>
              <span className="text-sm font-bold text-primary">
                ${cart.reduce((s, i) => s + (i.total_cost || 0), 0).toFixed(2)} est.
              </span>
            </div>
          </div>
        );
      })}
    </div>
  );
}