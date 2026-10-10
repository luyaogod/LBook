import { BLOCK_LABEL_COLORS } from "./blockColors";
import type { OcrBlock } from "@/types";

interface BlockOverlayProps {
  block: OcrBlock;
  scale: number;
  isHighlighted: boolean;
  onHover: (id: number | null) => void;
  scaleX: number;
  scaleY: number;
  opaque: boolean;
  onClick: (id: number) => void;
}

export function BlockOverlay({ block, scale, isHighlighted, onHover, scaleX, scaleY, opaque, onClick }: BlockOverlayProps) {
  const [x1, y1, x2, y2] = block.block_bbox;
  const colors = BLOCK_LABEL_COLORS[block.block_label] ?? BLOCK_LABEL_COLORS.__default__;

  const pdfX1 = x1 * scaleX;
  const pdfY1 = y1 * scaleY;
  const pdfX2 = x2 * scaleX;
  const pdfY2 = y2 * scaleY;

  return (
    <div
      className="absolute cursor-pointer transition-all duration-100"
      style={{
        left: Math.round(pdfX1 * scale),
        top: Math.round(pdfY1 * scale),
        width: Math.round((pdfX2 - pdfX1) * scale),
        height: Math.round((pdfY2 - pdfY1) * scale),
        border: `1px solid ${colors.border}`,
        backgroundColor: opaque
          ? colors.border
          : isHighlighted
            ? colors.highlightBg
            : colors.bg,
        pointerEvents: "auto",
      }}
      data-block-id={block.block_index}
      onMouseEnter={() => onHover(block.block_index)}
      onMouseLeave={() => onHover(null)}
      onClick={(e) => { e.stopPropagation(); onClick(block.block_index); }}
      title={`${block.block_label}: ${block.block_content?.slice(0, 100) ?? ""}`}
    />
  );
}
