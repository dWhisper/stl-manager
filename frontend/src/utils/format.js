// 195126 -> "195,126" (uses the viewer's locale separators)
export function formatCount(n) {
  return Number(n ?? 0).toLocaleString();
}
