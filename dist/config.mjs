// Read one directive per line. Reject unsupported checks explicitly.
export function readConfig(source) {
  const settings = {init: "Init", next: "Next", invariant: "", deadlock: true};
  const seen = new Set();
  for (const raw of source.split(/\r?\n/)) {
    const line = raw.split("\\*")[0].trim();
    if (!line) continue;
    const [key, value, ...extra] = line.split(/\s+/);
    if (seen.has(key) || extra.length || !value) throw Error("Unsupported configuration: " + line);
    seen.add(key);
    if (key === "CHECK_DEADLOCK" && ["TRUE", "FALSE"].includes(value)) {
      settings.deadlock = value === "TRUE";
    } else if (["INIT", "NEXT", "INVARIANT"].includes(key) && /^[A-Za-z]\w*$/.test(value)) {
      settings[key.toLowerCase()] = value;
    } else throw Error("Unsupported configuration: " + line);
  }
  return settings;
}
