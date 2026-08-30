import { Ps2IconView } from "@/components/memory-card/ps2-icon-view";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { displayDirentName } from "@/lib/ps2/ps2-sjis";
import type { Ps2DateTime, Ps2SaveInfo } from "@/lib/ps2/ps2-types";
import { cn } from "@/lib/utils";

interface Ps2SaveListProps {
  saves: Ps2SaveInfo[];
  selectedSave: string | null;
  onSelectSave: (name: string) => void;
}

const pad = (n: number) => n.toString().padStart(2, "0");

const formatDate = (t: Ps2DateTime): string =>
  `${t.year}-${pad(t.month)}-${pad(t.day)} ${pad(t.hour)}:${pad(t.min)}`;

const formatSize = (bytes: number): string =>
  bytes >= 1024 * 1024
    ? `${(bytes / (1024 * 1024)).toFixed(1)} MB`
    : `${Math.ceil(bytes / 1024)} KB`;

const Ps2SaveRow: React.FC<{
  save: Ps2SaveInfo;
  index: number;
  isSelected: boolean;
  onClick: () => void;
}> = ({ save, index, isSelected, onClick }) => (
  <Card
    data-ps2-save-name={save.name}
    className={cn(
      "mb-2 cursor-pointer border-none py-0",
      isSelected ? "bg-card" : "bg-card/40 hover:bg-card/80",
    )}
    onClick={onClick}
  >
    <CardContent className="flex-row items-center gap-0 p-3">
      <div className="text-muted-foreground mr-2 w-6 text-xs">
        {pad(index + 1)}
      </div>
      <Ps2IconView
        animate={isSelected}
        save={save}
        className="mr-2 size-10 shrink-0 rounded-sm"
      />
      <div className="min-w-0 grow">
        <h3 className="text-foreground truncate text-sm font-medium">
          {save.title}
        </h3>
        <p className="text-muted-foreground truncate font-mono text-xs">
          {displayDirentName(save.name)}
        </p>
      </div>
      <div className="ml-2 flex flex-col items-end gap-1">
        <div className="flex items-center gap-1">
          {save.ps1 && <Badge variant="outline">PS1</Badge>}
          {save.pocketStation && <Badge variant="outline">PS</Badge>}
          {save.hidden && <Badge variant="outline">Hidden</Badge>}
        </div>
        <p className="text-muted-foreground text-xs">
          {formatSize(save.totalSize)}
        </p>
        <Tooltip>
          <TooltipTrigger asChild>
            <p className="text-muted-foreground text-xs">
              {formatDate(save.modified)}
            </p>
          </TooltipTrigger>
          <TooltipContent>
            <p>Modified (JST)</p>
          </TooltipContent>
        </Tooltip>
      </div>
    </CardContent>
  </Card>
);

export const Ps2SaveList: React.FC<Ps2SaveListProps> = ({
  saves,
  selectedSave,
  onSelectSave,
}) => {
  if (saves.length === 0) {
    return (
      <div className="bg-card/80 text-muted-foreground flex grow flex-col items-center justify-center p-4">
        <p className="mb-4 text-lg">No saves</p>
        <p className="text-sm">This card has no save directories</p>
      </div>
    );
  }
  return (
    <ScrollArea className="bg-card/60 grow overflow-hidden" type="always">
      <div className="min-h-full p-4">
        {saves.map((save, index) => (
          <Ps2SaveRow
            key={save.name}
            save={save}
            index={index}
            isSelected={selectedSave === save.name}
            onClick={() => onSelectSave(save.name)}
          />
        ))}
      </div>
    </ScrollArea>
  );
};
