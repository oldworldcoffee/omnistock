import { cn } from '@/lib/utils';

const variants = {
  // Order statuses
  draft: 'bg-muted text-muted-foreground',
  sent: 'bg-blue-100 text-blue-700',
  viewed: 'bg-purple-100 text-purple-700',
  backstocked: 'bg-amber-100 text-amber-700',
  received: 'bg-blue-100 text-blue-700',
  fulfilled: 'bg-green-100 text-green-700',
  cancelled: 'bg-red-100 text-red-700',
  partial: 'bg-orange-100 text-orange-700',
  // Transfer statuses
  pending: 'bg-amber-100 text-amber-700',
  in_transit: 'bg-blue-100 text-blue-700',
  // Inventory / count
  in_progress: 'bg-amber-100 text-amber-700',
  submitted: 'bg-green-100 text-green-700',
  // Invoice statuses
  pending_review: 'bg-amber-100 text-amber-700',
  confirmed: 'bg-green-100 text-green-700',
  rejected: 'bg-red-100 text-red-700',
  // Location types
  location: 'bg-blue-100 text-blue-700',
  commissary: 'bg-purple-100 text-purple-700',
  // Stock levels
  low: 'bg-red-100 text-red-700',
  ok: 'bg-green-100 text-green-700',
  // Generic
  active: 'bg-green-100 text-green-700',
  inactive: 'bg-muted text-muted-foreground',
  // Commissary fulfillment statuses
  split_pending: 'bg-pink-100 text-pink-700',
};

export default function StatusBadge({ status, label }) {
  const cls = variants[status] || 'bg-muted text-muted-foreground';
  // Custom display labels
  const customLabels = {
    sent: 'New',
    backstocked: 'Backstocked',
    split_pending: 'Split Pending',
  };
  const display = label || customLabels[status] || status?.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
  return (
    <span className={cn('inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium', cls)}>
      {display}
    </span>
  );
}