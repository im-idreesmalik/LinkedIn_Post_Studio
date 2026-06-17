const STYLES: Record<string, { label: string; cls: string; dot?: string }> = {
  generating: { label: "Generating", cls: "bg-gray-100 text-gray-600", dot: "bg-gray-400 animate-pulse" },
  in_review: { label: "Ready to review", cls: "bg-brand-light text-brand", dot: "bg-brand" },
  edited: { label: "Edited", cls: "bg-amber-100 text-amber-700", dot: "bg-amber-500" },
  approved: { label: "Publishing", cls: "bg-indigo-100 text-indigo-700", dot: "bg-indigo-500 animate-pulse" },
  published: { label: "Published", cls: "bg-green-100 text-green-700", dot: "bg-green-500" },
  generation_failed: { label: "Failed", cls: "bg-red-100 text-red-700", dot: "bg-red-500" },
  publish_failed: { label: "Publish failed", cls: "bg-red-100 text-red-700", dot: "bg-red-500" },
};

export function StatusBadge({ status }: { status: string }) {
  const s = STYLES[status] ?? { label: status, cls: "bg-gray-100 text-gray-600" };
  return (
    <span className={`badge ${s.cls}`}>
      {s.dot && <span className={`w-1.5 h-1.5 rounded-full ${s.dot}`} />}
      {s.label}
    </span>
  );
}
