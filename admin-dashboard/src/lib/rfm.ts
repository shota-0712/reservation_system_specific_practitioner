export type CanonicalRfmSegment = "champion" | "loyal" | "new" | "atRisk" | "hibernating";

export const rfmSegmentLabels: Record<CanonicalRfmSegment, { label: string; color: string }> = {
    champion: { label: "チャンピオン", color: "bg-emerald-100 text-emerald-700" },
    loyal: { label: "ロイヤル", color: "bg-blue-100 text-blue-700" },
    new: { label: "新規", color: "bg-cyan-100 text-cyan-700" },
    atRisk: { label: "要注意", color: "bg-amber-100 text-amber-700" },
    hibernating: { label: "休眠", color: "bg-gray-100 text-gray-600" },
};

export const fallbackSegmentStyle = { label: "未分類", color: "bg-gray-100 text-gray-600" };

export function toCanonicalSegment(segment?: string): CanonicalRfmSegment | null {
    if (!segment) return null;
    const normalized = segment.replace(/\s+/g, "").toLowerCase();
    if (normalized === "champion" || normalized === "vip") return "champion";
    if (normalized === "loyal") return "loyal";
    if (normalized === "new" || normalized === "potential") return "new";
    if (normalized === "atrisk" || normalized === "dormant" || normalized === "needsattention") return "atRisk";
    if (normalized === "hibernating" || normalized === "lost" || normalized === "inactive") return "hibernating";
    return null;
}

/** Returns display label/color for any segment string, or null if segment is absent. Unknown segments render as "未分類". */
export function getRfmSegmentDisplay(segment?: string): { label: string; color: string } | null {
    if (!segment) return null;
    const canonical = toCanonicalSegment(segment);
    return canonical ? rfmSegmentLabels[canonical] : fallbackSegmentStyle;
}
