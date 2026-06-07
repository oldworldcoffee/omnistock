import { cn } from '@/lib/utils';

export default function StatCard({ label, value, sub, icon: Icon, color = 'text-primary', trend }) {
  return (
    <div className="bg-card border border-border rounded-xl p-5 flex items-start gap-4">
      {Icon && (
        <div className={cn('w-10 h-10 rounded-lg flex items-center justify-center bg-primary/10 flex-shrink-0')}>
          <Icon className={cn('w-5 h-5', color)} />
        </div>
      )}
      <div className="min-w-0">
        <p className="text-muted-foreground text-xs font-medium uppercase tracking-wide">{label}</p>
        <p className="text-2xl font-bold text-foreground mt-0.5 truncate">{value}</p>
        {sub && <p className="text-muted-foreground text-xs mt-0.5">{sub}</p>}
        {trend && <p className={cn('text-xs font-medium mt-1', trend.up ? 'text-green-600' : 'text-red-500')}>{trend.label}</p>}
      </div>
    </div>
  );
}