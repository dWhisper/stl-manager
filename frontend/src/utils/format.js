// 195126 -> "195,126" (uses the viewer's locale separators)
export function formatCount(n) {
  return Number(n ?? 0).toLocaleString();
}

// 1536 -> "1.5 KB" (1024 base)
export function formatBytes(n) {
  let v = Number(n ?? 0);
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let i = 0;
  while (v >= 1024 && i < units.length - 1) { v /= 1024; i++; }
  return i === 0 ? `${v} B` : `${v.toFixed(1)} ${units[i]}`;
}
