const STORAGE_KEY = "summachat_fp";

function collectBrowserProperties(): string {
  const props = [
    navigator.userAgent,
    navigator.language,
    navigator.languages?.join(",") ?? "",
    String(screen.width),
    String(screen.height),
    String(screen.colorDepth),
    String(screen.pixelDepth),
    String(new Date().getTimezoneOffset()),
    String(navigator.hardwareConcurrency ?? ""),
    String((navigator as any).deviceMemory ?? ""),
    Intl.DateTimeFormat().resolvedOptions().timeZone,
  ];
  return props.join("|");
}

function djb2(str: string): string {
  let hash = 5381;
  for (let i = 0; i < str.length; i++) {
    hash = (hash * 33) ^ str.charCodeAt(i);
    hash = hash >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}

async function sha256Short(str: string): Promise<string> {
  try {
    const buf = await crypto.subtle.digest(
      "SHA-256",
      new TextEncoder().encode(str)
    );
    return Array.from(new Uint8Array(buf))
      .slice(0, 8)
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
  } catch {
    return djb2(str);
  }
}

let _cachedFp: string | null = null;

export async function getFingerprint(): Promise<string> {
  if (_cachedFp) return _cachedFp;

  const stored = localStorage.getItem(STORAGE_KEY);
  if (stored) {
    _cachedFp = stored;
    return stored;
  }

  const raw = collectBrowserProperties();
  const hash = await sha256Short(raw);
  const fp = `fp_${hash}`;

  localStorage.setItem(STORAGE_KEY, fp);
  _cachedFp = fp;
  return fp;
}
