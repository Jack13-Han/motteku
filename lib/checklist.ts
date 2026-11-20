/** Keep AI starter checklists within the same item-name limits as the packing editor. */
export function checklistItems(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const result: string[] = [];
  for (const entry of value) {
    if (typeof entry !== 'string') continue;
    const name = entry.trim();
    const key = name.normalize('NFKC').toLocaleLowerCase();
    if (!name || name.length > 200 || seen.has(key)) continue;
    seen.add(key); result.push(name);
    if (result.length === 20) break;
  }
  return result;
}
