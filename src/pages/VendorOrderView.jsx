import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { base44 } from "@/api/base44Client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Package, Calendar, DollarSign, Mail, CheckCircle2, AlertCircle, MapPin, Phone, User } from "lucide-react";
import StatusBadge from "@/components/ui/StatusBadge";
import { format } from "date-fns";

export default function VendorOrderView() {
  const [searchParams] = useSearchParams();
  const token = searchParams.get("token");
  const [order, setOrder] = useState(null);
  const [location, setLocation] = useState(null);
  const [settings, setSettings] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!token) {
      setError("Missing order token");
      setLoading(false);
      return;
    }

    base44.functions
      .invoke("validateVendorToken", { token })
      .then(async (res) => {
        if (res.data.error) {
          setError(res.data.error);
        } else {
          const orderData = res.data.order;
          setOrder(orderData);
          setLocation(res.data.location || null);
          setSettings(res.data.settings || null);
        }
      })
      .catch((err) => {
        setError("Invalid or expired order link");
      })
      .finally(() => {
        setLoading(false);
      });
  }, [token]);

  if (loading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="flex flex-col items-center gap-3">
          <div className="w-10 h-10 border-4 border-primary/20 border-t-primary rounded-full animate-spin"></div>
          <p className="text-sm text-muted-foreground font-medium">Loading order details...</p>
        </div>
      </div>
    );
  }

  if (error || !order) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-6">
        <Card className="max-w-md w-full">
          <CardHeader className="text-center">
            <AlertCircle className="w-12 h-12 text-destructive mx-auto mb-2" />
            <CardTitle className="text-xl">Order Not Found</CardTitle>
          </CardHeader>
          <CardContent className="text-center text-muted-foreground">
            <p>{error || "This order link is invalid or has expired."}</p>
            <p className="text-sm mt-2">Please contact the sender for assistance.</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background py-8 px-4">
      <div className="max-w-4xl mx-auto space-y-6">
        {/* Company Header */}
        {settings?.logo_url && (
          <div className="flex justify-center mb-8">
            <img src={settings.logo_url} alt="Company Logo" className="h-16 object-contain" />
          </div>
        )}

        {/* Order Header */}
        <Card>
          <CardHeader>
            <div className="text-center mb-6">
              <h1 className="text-3xl font-bold text-primary mb-2">Purchase Order</h1>
              <p className="text-muted-foreground">Order #{order.order_number || order.id}</p>
              <p className="text-sm text-muted-foreground mt-1">
                {order.email_sent_at ? format(new Date(order.email_sent_at), 'MMMM d, yyyy') : "N/A"}
              </p>
            </div>
            <Separator className="mb-6" />
            <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
              <div className="space-y-1">
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Package className="w-4 h-4" />
                  <span>Items</span>
                </div>
                <p className="font-medium">{order.items?.length || 0}</p>
              </div>
              <div className="space-y-1">
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <DollarSign className="w-4 h-4" />
                  <span>Total</span>
                </div>
                <p className="font-medium">${order.total_amount?.toFixed(2) || "0.00"}</p>
              </div>
              <div className="space-y-1">
                <StatusBadge status={order.status} />
              </div>
            </div>
          </CardHeader>
        </Card>

        {/* Order Items */}
        <Card>
          <CardHeader>
            <CardTitle>Order Items</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b">
                    <th className="text-left py-3 px-4 text-sm font-medium text-muted-foreground">Item</th>
                    <th className="text-right py-3 px-4 text-sm font-medium text-muted-foreground">Qty</th>
                    <th className="text-right py-3 px-4 text-sm font-medium text-muted-foreground">Unit Cost</th>
                    <th className="text-right py-3 px-4 text-sm font-medium text-muted-foreground">Total</th>
                  </tr>
                </thead>
                <tbody>
                  {order.items?.map((item, idx) => (
                    <tr key={idx} className="border-b last:border-0">
                      <td className="py-3 px-4">
                        <p className="font-medium">{item.item_name}</p>
                        {item.unit_of_measure && (
                          <p className="text-sm text-muted-foreground">{item.unit_of_measure}</p>
                        )}
                      </td>
                      <td className="text-right py-3 px-4">{item.quantity_ordered}</td>
                      <td className="text-right py-3 px-4">${item.unit_cost?.toFixed(2) || "0.00"}</td>
                      <td className="text-right py-3 px-4">${item.total_cost?.toFixed(2) || "0.00"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>

        {/* Location Details */}
        {location && (
          <Card>
            <CardHeader>
              <CardTitle className="text-lg flex items-center gap-2">
                <MapPin className="w-5 h-5" />
                Location Details
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                <div>
                  <p className="text-sm text-muted-foreground">Location Name</p>
                  <p className="font-medium">{location.business_name ? location.business_name + ' - ' : ''}{location.name}</p>
                </div>
                {location.address && (
                  <div>
                    <p className="text-sm text-muted-foreground">Address</p>
                    <p className="font-medium">{location.address}</p>
                  </div>
                )}
                {location.phone && (
                  <div>
                    <p className="text-sm text-muted-foreground">Phone</p>
                    <p className="font-medium">{location.phone}</p>
                  </div>
                )}
                {location.email && (
                  <div>
                    <p className="text-sm text-muted-foreground">Email</p>
                    <p className="font-medium">{location.email}</p>
                  </div>
                )}
              </div>
            </CardContent>
          </Card>
        )}

        {/* Notes */}
        {order.notes && (
          <Card>
            <CardHeader>
              <CardTitle>Order Notes</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-muted-foreground whitespace-pre-wrap">{order.notes}</p>
            </CardContent>
          </Card>
        )}

        {/* Footer */}
        <div className="text-center text-sm text-muted-foreground py-4">
          <p>This order has been marked as viewed.</p>
          <p className="mt-1">Questions? Contact the sender directly.</p>
        </div>
      </div>
    </div>
  );
}
