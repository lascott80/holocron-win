// Where a vault lives, shortened for a one-line label next to its name.

/**
 * The vault's parent folder, with the middle elided when it's deep:
 * "~\AppData\Local\Temp\Work\Smoke Vault" → "~\…\Temp\Work". The vault's own
 * folder is left off; its name is already shown beside it.
 */
export function shortLocation(displayPath: string): string {
  const sep = displayPath.includes("\\") ? "\\" : "/";
  const parts = displayPath.split(sep).filter((part, index) => part !== "" || index === 0);
  parts.pop();
  if (parts.length > 3) parts.splice(1, parts.length - 3, "…");
  return parts.join(sep) || sep;
}
