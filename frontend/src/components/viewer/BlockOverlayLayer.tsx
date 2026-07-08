import { BlockOverlay } from "./BlockOverlay";
import type { OcrBlock } from "@/types";

interface BlockOverlayLayerProps {
  blocks: OcrBlock[];
  scale: number;
  highlightedBlockId: number | null;
  onBlockHover: (id: number | null) => void;
}

export function BlockOverlayLayer({
  blocks,
  scale,
  highlightedBlockId,
  onBlockHover,
}: BlockOverlayLayerProps) {
  if (blocks.length === 0) return null;

  return (
    <div
      className="absolute inset-0"
      style={{ pointerEvents: "none" }}
    >
      {blocks.map((block) => (
        <BlockOverlay
          key={block.id}
          block={block}
          scale={scale}
          isHighlighted={block.id === highlightedBlockId}
          onHover={onBlockHover}
        />
      ))}
    </div>
  );
}
