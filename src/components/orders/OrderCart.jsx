import { useState } from 'react';
import { Search, Plus, Minus, Trash2, ShoppingCart, RefreshCw, PackageOpen } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

export default function OrderCart({
  locations, vendors, items, locInv,
  selectedLocation, selectedVendor,
  cart, cartTotal,
  onSelectLocation, onSelectVendor,
  onAddToCart, onUpdateQty, onRemove,
  onFillToPar, onCreateOrder, onClearCart,
}) {
  const [search, setSearch] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('all');

  const getLocInv = (itemId) => locInv.find(l => l.location_id === selectedLocation && l.item_id === itemId);

  // Filter catalog items by vendor if selected
  const catalogItems = items.filter(item => {
    if (selectedVendor) {
      const hasVendor = item.vendor_id === selectedVendor ||
        (item.purchase_options || []).some(p => p.vendor_id === selectedVendor);
      if (!hasVendor) return false;
    }
    if (search && !item.name.toLowerCase().includes(search.toLowerCase()) &&
        !(item.category || '').toLowerCase().includes(search.toLowerCase())) return false;
    if (categoryFilter !== 'all' && item.category !== categoryFilter) return false;
    return true;
  });

  const categories = ['all', ...new Set(items.map(i => i.category).filter(Boolean))];

  const cartItemIds = new Set(cart.map(c => c.item_id));

  const canOrder = selectedLocation && cart.filter(c => c.qty > 0).length > 0;

  return (
    <div className="flex gap-4 h-[calc(100vh-180px)]">
      {/* LEFT: Catalog */}
      <div className="flex-1 flex flex-col bg-card border border-border rounded-xl overflow-hidden">
        {/* Filters bar */}
        <div className="p-4 border-b border-border bg-muted/30 space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-xs">Location *</Label>
              <select
                className="mt-1 w-full border border-input rounded-md px-3 py-2 text-sm bg-background"
                value={selectedLocation}
                onChange={e => onSelectLocation(e.target.value)}
              >
                <option value="">Select location...</option>
                {locations.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}
              </select>
            </div>
            <div>
              <Label className="text-xs">Vendor (optional)</Label>
              <select
                className="mt-1 w-full border border-input rounded-md px-3 py-2 text-sm bg-background"
                value={selectedVendor}
                onChange={e => onSelectVendor(e.target.value)}
              >
                <option value="">All vendors</option>
                {vendors.map(v => <option key={v.id} value={v.id}>{v.name}</option>)}
              </select>
            </div>
          </div>
          <div className="flex gap-2">
            <div className="relative flex-1">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input
                className="pl-8 h-8 text-sm"
                placeholder="Search items..."
                value={search}
                onChange={e => setSearch(e.target.value)}
              />
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={onFillToPar}
              disabled={!selectedLocation}
              className="gap-1.5 whitespace-nowrap"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              Fill to Par
            </Button>
          </div>
          <div className="flex gap-1.5 flex-wrap">
            {categories.map(cat => (
              <button
                key={cat}
                onClick={() => setCategoryFilter(cat)}
                className={`px-2.5 py-0.5 rounded-full text-xs font-medium transition-colors ${
                  categoryFilter === cat
                    ? 'bg-primary text-primary-foreground'
                    : 'bg-muted text-muted-foreground hover:bg-muted/80'
                }`}
              >
                {cat === 'all' ? 'All' : cat}
              </button>
            ))}
          </div>
        </div>

        {/* Item grid */}
        <div className="flex-1 overflow-y-auto p-4">
          {catalogItems.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-40 text-muted-foreground gap-2">
              <PackageOpen className="w-8 h-8 opacity-40" />
              <p className="text-sm">No items match your filters</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {catalogItems.map(item => {
                const li = getLocInv(item.id);
                const onHand = li?.on_hand_quantity ?? null;
                const par = li?.par_level ?? null;
                const preferred = (item.purchase_options || []).find(p => p.is_preferred) || (item.purchase_options || [])[0];
                const cost = preferred?.unit_cost || item.unit_cost || 0;
                const inCart = cartItemIds.has(item.id);

                return (
                  <div
                    key={item.id}
                    className={`rounded-lg border p-3 flex flex-col gap-2 transition-all ${
                      inCart ? 'border-primary/50 bg-primary/5' : 'border-border bg-background hover:border-primary/30'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-1">
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium leading-tight truncate">{item.name}</p>
                        {item.category && <p className="text-xs text-muted-foreground mt-0.5">{item.category}</p>}
                      </div>
                      {inCart && (
                        <span className="text-xs bg-primary text-primary-foreground rounded-full px-1.5 py-0.5 shrink-0">In cart</span>
                      )}
                    </div>

                    <div className="flex items-center justify-between text-xs text-muted-foreground">
                      <span>${cost.toFixed(2)} / {item.unit_of_measure}</span>
                      {selectedLocation && onHand !== null && (
                        <span className={onHand < (par || 0) ? 'text-orange-500 font-medium' : ''}>
                          {onHand} on hand {par ? `/ ${par} par` : ''}
                        </span>
                      )}
                    </div>

                    <Button
                      size="sm"
                      variant={inCart ? 'secondary' : 'default'}
                      className="w-full h-7 text-xs"
                      onClick={() => onAddToCart(item)}
                    >
                      <Plus className="w-3 h-3 mr-1" />{inCart ? 'Add more' : 'Add to order'}
                    </Button>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* RIGHT: Cart */}
      <div className="w-80 flex flex-col bg-card border border-border rounded-xl overflow-hidden">
        <div className="p-4 border-b border-border bg-muted/30 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <ShoppingCart className="w-4 h-4 text-primary" />
            <span className="font-semibold text-sm">Order Cart</span>
            {cart.length > 0 && (
              <span className="bg-primary text-primary-foreground rounded-full text-xs w-5 h-5 flex items-center justify-center font-bold">
                {cart.length}
              </span>
            )}
          </div>
          {cart.length > 0 && (
            <button onClick={onClearCart} className="text-xs text-muted-foreground hover:text-destructive transition-colors">
              Clear all
            </button>
          )}
        </div>

        <div className="flex-1 overflow-y-auto">
          {cart.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full text-muted-foreground gap-3 p-6">
              <ShoppingCart className="w-10 h-10 opacity-20" />
              <div className="text-center">
                <p className="text-sm font-medium">Cart is empty</p>
                <p className="text-xs mt-1">Add items from the catalog or use "Fill to Par"</p>
              </div>
            </div>
          ) : (
            <div className="divide-y divide-border">
              {cart.map((item, idx) => (
                <div key={item.item_id} className="p-3 flex flex-col gap-2">
                  <div className="flex items-start justify-between gap-1">
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-medium leading-tight truncate">{item.item_name}</p>
                      <p className="text-xs text-muted-foreground">${item.unit_cost.toFixed(2)} / {item.unit_of_measure}</p>
                    </div>
                    <button
                      onClick={() => onRemove(idx)}
                      className="text-muted-foreground hover:text-destructive transition-colors p-0.5"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>

                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-1">
                      <button
                        onClick={() => onUpdateQty(idx, item.qty - 1)}
                        className="w-6 h-6 rounded border border-input flex items-center justify-center hover:bg-muted transition-colors"
                      >
                        <Minus className="w-3 h-3" />
                      </button>
                      <input
                        type="number"
                        min="0"
                        value={item.qty}
                        onChange={e => onUpdateQty(idx, e.target.value)}
                        className="w-12 h-6 text-center text-xs border border-input rounded bg-background"
                      />
                      <button
                        onClick={() => onUpdateQty(idx, item.qty + 1)}
                        className="w-6 h-6 rounded border border-input flex items-center justify-center hover:bg-muted transition-colors"
                      >
                        <Plus className="w-3 h-3" />
                      </button>
                    </div>
                    <span className="text-xs font-semibold text-primary">${item.total_cost.toFixed(2)}</span>
                  </div>

                  {item.par_level > 0 && (
                    <p className="text-xs text-muted-foreground">
                      On hand: {item.on_hand} / Par: {item.par_level}
                    </p>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Cart footer */}
        <div className="p-4 border-t border-border bg-muted/30 space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium text-muted-foreground">Order Total</span>
            <span className="text-lg font-bold text-primary">${cartTotal.toFixed(2)}</span>
          </div>
          <Button
            className="w-full"
            disabled={!canOrder}
            onClick={onCreateOrder}
          >
            <ShoppingCart className="w-4 h-4 mr-2" />
            Place Order
          </Button>
          {!selectedLocation && (
            <p className="text-xs text-center text-muted-foreground">Select a location to place order</p>
          )}
        </div>
      </div>
    </div>
  );
}