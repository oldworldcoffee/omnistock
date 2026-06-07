import { Eye, Pencil, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import StatusBadge from '@/components/ui/StatusBadge';
import { format } from 'date-fns';

export default function OrderHistory({ orders, locName, vendorName, onView, onEdit, onDelete }) {
  return (
    <div className="bg-card border border-border rounded-xl overflow-hidden">
      <table className="w-full text-sm">
        <thead className="bg-muted/50">
          <tr>
            {['Order #', 'Location', 'Vendor', 'Items', 'Total', 'Status', 'Sent', 'Actions'].map(h => (
              <th key={h} className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wide">{h}</th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {orders.length === 0 ? (
            <tr>
              <td colSpan={8} className="px-4 py-12 text-center text-muted-foreground">
                No orders yet. Create your first order using the "New Order" button.
              </td>
            </tr>
          ) : orders.map(o => (
            <tr key={o.id} className="hover:bg-muted/30 transition-colors">
              <td className="px-4 py-3 font-medium font-mono">{o.order_number}</td>
              <td className="px-4 py-3">{locName(o.location_id)}</td>
              <td className="px-4 py-3">{vendorName(o.vendor_id)}</td>
              <td className="px-4 py-3">
                <div className="text-muted-foreground">{o.items?.length || 0} items</div>
                {o.status === 'partial' && (
                  <div className="text-xs text-green-600 font-medium">
                    {o.items?.reduce((sum, item) => sum + (item.quantity_received || 0), 0)} received
                  </div>
                )}
              </td>
              <td className="px-4 py-3 font-medium">${(o.total_amount || 0).toFixed(2)}</td>
              <td className="px-4 py-3"><StatusBadge status={o.status} /></td>
              <td className="px-4 py-3 text-muted-foreground text-xs">
                {o.email_sent_at ? format(new Date(o.email_sent_at), 'MMM d, h:mm a') : '—'}
              </td>
              <td className="px-4 py-3">
                <div className="flex gap-1">
                  {o.status === 'draft' && (
                    <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => onEdit(o)}>
                      <Pencil className="w-3.5 h-3.5" />
                    </Button>
                  )}
                  {(o.status === 'draft' || o.status === 'sent' || o.status === 'viewed') && (
                    <Button variant="ghost" size="icon" className="h-7 w-7 text-red-600 hover:text-red-700" onClick={() => onDelete(o)}>
                      <Trash2 className="w-3.5 h-3.5" />
                    </Button>
                  )}
                  <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => onView(o)}>
                    <Eye className="w-3.5 h-3.5" />
                  </Button>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}