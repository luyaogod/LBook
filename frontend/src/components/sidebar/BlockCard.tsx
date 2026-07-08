import type { OcrBlock } from "@/types";
import { BLOCK_LABEL_COLORS } from "@/components/viewer/blockColors";
import { Image, Table2, FileText } from "lucide-react";

interface BlockCardProps {
  block: OcrBlock;
  isHighlighted: boolean;
  onHover: (id: number | null) => void;
}

function isImageBlock(block: OcrBlock): boolean {
  return ["image", "header_image", "footer_image"].includes(block.block_label);
}

function isTableBlock(block: OcrBlock): boolean {
  return block.block_label === "table";
}

function formatLabel(label: string): string {
  return label.replace(/_/g, " ");
}

export function BlockCard({ block, isHighlighted, onHover }: BlockCardProps) {
  const colors = BLOCK_LABEL_COLORS[block.block_label] ?? BLOCK_LABEL_COLORS.__default__;

  return (
    <div
      className={`rounded-md border p-3 transition-colors cursor-pointer ${
        isHighlighted
          ? "ring-2 ring-primary/50 bg-accent/30"
          : "hover:bg-accent/20"
      }`}
      style={{ borderColor: isHighlighted ? colors.border : undefined }}
      onMouseEnter={() => onHover(block.id)}
      onMouseLeave={() => onHover(null)}
    >
      <div className="mb-1 flex items-center gap-2">
        <span
          className="inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide"
          style={{
            backgroundColor: colors.bg,
            color: colors.text,
            border: `1px solid ${colors.border}`,
          }}
        >
          {formatLabel(block.block_label)}
        </span>
        {block.block_order != null && (
          <span className="text-[10px] text-muted-foreground">
            #{block.block_order}
          </span>
        )}
      </div>

      <div className="text-sm leading-relaxed" dir="auto">
        {isImageBlock(block) ? (
          <span className="inline-flex items-center gap-1 text-muted-foreground italic">
            <Image className="h-3.5 w-3.5" />
            Image block
          </span>
        ) : isTableBlock(block) ? (
          <span className="inline-flex items-center gap-1 text-muted-foreground italic">
            <Table2 className="h-3.5 w-3.5" />
            Table block
          </span>
        ) : block.block_content ? (
          <span className="whitespace-pre-wrap">{block.block_content}</span>
        ) : (
          <span className="text-muted-foreground italic">
            <FileText className="mr-1 inline h-3.5 w-3.5" />
            Empty
          </span>
        )}
      </div>
    </div>
  );
}
