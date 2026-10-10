import { BlockOverlay } from "./BlockOverlay";
import type { OcrBlock } from "@/types";

interface BlockOverlayLayerProps {
  blocks: OcrBlock[];
  scale: number;
  highlightedBlockId: number | null;
  onBlockHover: (id: number | null) => void;
  pdfPageWidth: number;
  pdfPageHeight: number;
  ocrPageWidth: number | null;
  ocrPageHeight: number | null;
  overlayOpaque: boolean;
  onBlockClick: (id: number) => void;
}

export function BlockOverlayLayer({
  blocks,
  scale,
  highlightedBlockId,
  onBlockHover,
  pdfPageWidth,
  pdfPageHeight,
  ocrPageWidth,
  ocrPageHeight,
  overlayOpaque,
  onBlockClick,
}: BlockOverlayLayerProps) {
  if (blocks.length === 0) return null;

  const scaleX = ocrPageWidth ? pdfPageWidth / ocrPageWidth : 1;
  const scaleY = ocrPageHeight ? pdfPageHeight / ocrPageHeight : 1;

  return (
    <div
      className="absolute inset-0"
      style={{ pointerEvents: "none" }}
    >
      {blocks.map((block) => (
        <BlockOverlay
          key={block.block_index}
          block={block}
          scale={scale}
          isHighlighted={block.block_index === highlightedBlockId}
          onHover={onBlockHover}
          scaleX={scaleX}
          scaleY={scaleY}
          opaque={overlayOpaque}
          onClick={onBlockClick}
        />
      ))}
    </div>
  );
}
