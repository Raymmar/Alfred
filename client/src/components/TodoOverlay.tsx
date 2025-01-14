import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { TaskList } from "./TaskList";

interface TodoOverlayProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function TodoOverlay({ open, onOpenChange }: TodoOverlayProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-none w-screen h-screen p-8">
        <div className="max-w-5xl mx-auto">
          <DialogHeader>
            <DialogTitle className="text-3xl">All Tasks</DialogTitle>
            <DialogDescription>View and manage all your tasks in one place</DialogDescription>
          </DialogHeader>

          <ScrollArea className="flex-1 h-[calc(100vh-12rem)] pr-4 bg-transparent">
            <div className="flex justify-center">
              <TaskList maintainOrder className="w-full max-w-2xl" />
            </div>
          </ScrollArea>
        </div>
      </DialogContent>
    </Dialog>
  );
}