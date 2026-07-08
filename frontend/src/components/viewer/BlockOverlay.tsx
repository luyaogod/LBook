import { BLOCK_LABEL_COLORS } from "./blockColors";
import type { OcrBlock } from "@/types";

interface BlockOverlayProps {
  block: OcrBlock;
  scale: number;
  isHighlighted: boolean;
  onHover: (id: number | null) => void;
}

export function BlockOverlay({ block, scale, isHighlighted, onHover }: BlockOverlayProps) {
  const [x1, y1, x2, y2] = block.block_bbox;
  const colors = BLOCK_LABEL_COLORS[block.block_label] ?? BLOCK_LABEL_COLORS.__default__;

  return (
    <div
      className="absolute cursor-pointer transition-all duration-100"
      style={{
        left: Math.round(x1 * scale),
        top: Math.round(y1 * scale),
        width: Math.round((x2 - x1) * scale),
        height: Math.round((y2 - y1) * scale),
        border: `1px solid ${colors.border}`,
        backgroundColor: isHighlighted ? colors.highlightBg : colors.bg,
        pointerEvents: "auto",
      }}
      onMouseEnter={() => onHover(block.id)}
      onMouseLeave={() => onHover(null)}
      title={`${block.block_label}: ${block.block_content?.slice(0, 100) ?? ""}`}
    />
  );
}
