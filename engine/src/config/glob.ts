function normalizePath(value: string): string {
  return value.replace(/\\/g, "/").replace(/^\.\//, "").replace(/\/{2,}/g, "/");
}

function escapeRegex(value: string): string {
  return value.replace(/[|\\{}()[\]^$+?.]/g, "\\$&");
}

export function matchesGlob(pattern: string, value: string): boolean {
  const normalizedPattern = normalizePath(pattern);
  const normalizedValue = normalizePath(value);
  let source = "^";

  for (let i = 0; i < normalizedPattern.length; i += 1) {
    const char = normalizedPattern[i];
    if (char === "*") {
      if (normalizedPattern[i + 1] === "*") {
        i += 1;
        if (normalizedPattern[i + 1] === "/") {
          i += 1;
          source += "(?:.*/)?";
        } else {
          source += ".*";
        }
      } else {
        source += "[^/]*";
      }
      continue;
    }

    if (char === "?") {
      source += "[^/]";
      continue;
    }

    source += escapeRegex(char ?? "");
  }

  source += "$";
  return new RegExp(source).test(normalizedValue);
}

export function matchesAnyGlob(patterns: string[], value: string): boolean {
  return patterns.some((pattern) => matchesGlob(pattern, value));
}
