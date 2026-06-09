import { useState } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Package, Plus } from "lucide-react";
import { toast } from "sonner";

export default function AssignToGroupDialog({ open, onOpenChange, itemIds, itemNames }) {
  const [selectedGroupId, setSelectedGroupId] = useState("");
  const [showCreateOption, setShowCreateOption] = useState(false);
  const [newGroupName, setNewGroupName] = useState("");

  const queryClient = useQueryClient();

  const { data: groups } = useQuery({
    queryKey: ['productGroups'],
    queryFn: () => base44.entities.ProductGroup.list(),
    enabled: open,
  });

  const manageGroupsMutation = useMutation({
    mutationFn: (payload) => base44.functions.invoke('manageProductGroups', payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['productGroups'] });
      queryClient.invalidateQueries({ queryKey: ['inventoryItems'] });
      onOpenChange(false);
      setSelectedGroupId("");
      setNewGroupName("");
      toast.success("Items assigned to group");
    },
    onError: (error) => {
      toast.error(error.message || "Failed to assign items");
    },
  });

  const handleAssign = () => {
    if (!selectedGroupId) {
      toast.error("Please select a group");
      return;
    }

    if (selectedGroupId === 'new') {
      if (!newGroupName.trim()) {
        toast.error("Please enter a group name");
        return;
      }
      // Create new group first, then assign items
      manageGroupsMutation.mutate({
        action: 'create',
        name: newGroupName.trim(),
      }, {
        onSuccess: (data) => {
          const newGroupId = data?.data?.group?.id || data?.group?.id;
          manageGroupsMutation.mutate({
            action: 'add_items',
            groupId: newGroupId,
            itemIds,
          });
        }
      });
    } else {
      manageGroupsMutation.mutate({
        action: 'add_items',
        groupId: selectedGroupId,
        itemIds,
      });
    }
  };

  const isSingleItem = itemIds?.length === 1;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {isSingleItem ? 'Assign Item to Group' : 'Assign Items to Group'}
          </DialogTitle>
          <DialogDescription>
            {isSingleItem
              ? `Assign "${itemNames?.[0]}" to a product group.`
              : `Assign ${itemIds?.length} items to a product group.`
            }
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          <div className="space-y-2">
            <label className="text-sm font-medium">Select Group</label>
            <Select value={selectedGroupId} onValueChange={setSelectedGroupId}>
              <SelectTrigger>
                <SelectValue placeholder="Choose a group..." />
              </SelectTrigger>
              <SelectContent>
                {groups?.map((group) => (
                  <SelectItem key={group.id} value={group.id}>
                    <div className="flex items-center gap-2">
                      <Package className="w-4 h-4" />
                      {group.name}
                    </div>
                  </SelectItem>
                ))}
                <SelectItem value="new">
                  <div className="flex items-center gap-2 text-primary">
                    <Plus className="w-4 h-4" />
                    Create New Group...
                  </div>
                </SelectItem>
              </SelectContent>
            </Select>
          </div>

          {selectedGroupId === 'new' && (
            <div className="space-y-2">
              <label className="text-sm font-medium">New Group Name</label>
              <Input
                placeholder="e.g., Coffee, Soda, Snacks"
                value={newGroupName}
                onChange={(e) => setNewGroupName(e.target.value)}
                autoFocus
              />
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={handleAssign} disabled={manageGroupsMutation.isPending}>
            {manageGroupsMutation.isPending ? "Assigning..." : "Assign to Group"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
