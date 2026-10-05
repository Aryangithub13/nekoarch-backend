import os
import hashlib
import json

def hash_file(path):
    h = hashlib.sha256()
    with open(path, "rb") as f:
        while chunk := f.read(65536):
            h.update(chunk)
    return h.hexdigest()

root = "."
manifest = {
    "generatedAt": "2026-10-05T06:24:00Z",
    "gitHead": "7086209efd9e337a2c175b9bed1e562fde54ca68",
    "gitTag": "backend-v1-phase22-complete",
    "phase23Status": "uncommitted_in_working_tree",
    "files": {}
}

subdirs = ["apps", "packages", "supabase", "scripts", "test-support", "docs"]
for s in subdirs:
    for dirpath, dirnames, filenames in os.walk(s):
        if "node_modules" in dirpath or ".git" in dirpath or "dist" in dirpath:
            continue
        for fn in sorted(filenames):
            fp = os.path.join(dirpath, fn)
            # relative path normalized
            rel_path = os.path.normpath(fp)
            if not rel_path.startswith("docs/backend-audit-1-23"):
                manifest["files"][rel_path] = {
                    "sha256": hash_file(fp),
                    "size": os.path.getsize(fp)
                }

with open("docs/backend-audit-1-23/source-manifest.json", "w", encoding="utf-8") as out:
    json.dump(manifest, out, indent=2)

print(f"Recorded {len(manifest['files'])} files in docs/backend-audit-1-23/source-manifest.json")
