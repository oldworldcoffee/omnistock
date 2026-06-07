import React, { useState, useEffect } from 'react';
import { base44 } from '@/api/base44Client';
import { TrendingUp, AlertTriangle, CheckCircle, HelpCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';

export default function AIReviewDialog({ open, onOpenChange, orderItems, locationId, onConfirm }) {
  const [review, setReview] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const loadReview = async () => {
    if (!orderItems || orderItems.length === 0) return;
    
    setLoading(true);
    setError(null);
    
    try {
      const response = await base44.functions.invoke('reviewOrderBeforeSend', {
        order_items: orderItems,
        location_id: locationId
      });
      
      if (response.data && response.data.success) {
        setReview(response.data.review);
      } else {
        setError('Failed to load review');
      }
    } catch (err) {
      setError(err.message || 'Failed to analyze order');
    } finally {
      setLoading(false);
    }
  };

  React.useEffect(() => {
    if (open && orderItems?.length > 0) {
      loadReview();
    }
  }, [open]);

  const getStatusIcon = (status) => {
    switch (status) {
      case 'ok':
        return <CheckCircle className="w-4 h-4 text-green-600" />;
      case 'warning':
        return <AlertTriangle className="w-4 h-4 text-amber-600" />;
      case 'question':
        return <HelpCircle className="w-4 h-4 text-blue-600" />;
      default:
        return null;
    }
  };

  const getStatusColor = (status) => {
    switch (status) {
      case 'ok': return 'bg-green-50 border-green-200';
      case 'warning': return 'bg-amber-50 border-amber-200';
      case 'question': return 'bg-blue-50 border-blue-200';
      default: return 'bg-muted border-border';
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[80vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <TrendingUp className="w-5 h-5 text-primary" />
            AI Order Review
          </DialogTitle>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto py-4">
          {loading ? (
            <div className="flex flex-col items-center justify-center h-40 gap-3">
              <div className="w-6 h-6 border-2 border-primary/30 border-t-primary rounded-full animate-spin" />
              <p className="text-sm text-muted-foreground">Analyzing order against consumption patterns...</p>
            </div>
          ) : error ? (
            <div className="bg-red-50 border border-red-200 rounded-lg p-4 text-center">
              <p className="text-sm text-red-700">{error}</p>
            </div>
          ) : !review || review.length === 0 ? (
            <div className="text-center text-muted-foreground py-8">
              <p>No items to review</p>
            </div>
          ) : (
            <div className="space-y-3">
              {review.map((item, idx) => (
                <div
                  key={idx}
                  className={`rounded-lg border p-4 ${getStatusColor(item.status)}`}
                >
                  <div className="flex items-start gap-3">
                    <div className="mt-0.5">{getStatusIcon(item.status)}</div>
                    <div className="flex-1">
                      <div className="flex items-center justify-between mb-1">
                        <h4 className="font-semibold text-sm">{item.item_name}</h4>
                        <span className="text-xs font-medium bg-background px-2 py-0.5 rounded border">
                          Order: {item.order_quantity} units
                        </span>
                      </div>
                      
                      <div className="grid grid-cols-3 gap-2 mb-2 text-xs">
                        <div>
                          <span className="text-muted-foreground">On Hand:</span>
                          <span className="ml-1 font-medium">{item.on_hand}</span>
                        </div>
                        <div>
                          <span className="text-muted-foreground">AI Par:</span>
                          <span className="ml-1 font-medium">{item.ai_par}</span>
                        </div>
                        <div>
                          <span className="text-muted-foreground">Avg Historical:</span>
                          <span className="ml-1 font-medium">{item.avg_historical_order.toFixed(1)}</span>
                        </div>
                      </div>

                      <p className="text-sm text-muted-foreground mb-2">{item.message}</p>
                      
                      {item.recommendation && (
                        <div className="bg-background/50 rounded p-2 border">
                          <p className="text-xs font-medium text-foreground">Recommendation:</p>
                          <p className="text-xs text-muted-foreground mt-0.5">{item.recommendation}</p>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Back to Edit
          </Button>
          <Button onClick={onConfirm} disabled={!review || review.length === 0}>
            Confirm and Send
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}