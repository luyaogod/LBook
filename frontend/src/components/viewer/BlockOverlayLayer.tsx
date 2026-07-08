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
          key={block.id}
          block={block}
          scale={scale}
          isHighlighted={block.id === highlightedBlockId}
          onHover={onBlockHover}
          scaleX={scaleX}
          scaleY={scaleY}
        />
      ))}
    </div>
  );
}
