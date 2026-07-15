#!/usr/bin/env bash
# Build @moq/watch and emit a @norskvideo-scoped copy at dist-norsk/, so a local
# checkout can be linked into norsk-ctl (which consumes @norskvideo/moq-*) via a
# file: dependency, without the usual npm republish. See dashboard/package.json.
set -euo pipefail
cd "$(dirname "$0")"

echo "==> building @moq/watch"
bun run build

echo "==> rescoping dist -> dist-norsk (@moq/ -> @norskvideo/moq-)"
rm -rf dist-norsk
cp -r dist dist-norsk
python3 - <<'PY'
import glob, json, os
root = "dist-norsk"
for path in glob.glob(root + "/**/*", recursive=True):
    if os.path.isfile(path) and path.endswith((".js", ".ts", ".map")):
        d = open(path, encoding="utf-8", errors="replace").read()
        nd = d.replace("@moq/", "@norskvideo/moq-")
        if nd != d:
            open(path, "w", encoding="utf-8").write(nd)
p = root + "/package.json"
pkg = json.load(open(p))
pkg["name"] = "@norskvideo/moq-watch"
if "dependencies" in pkg:
    # Reuse whatever @norskvideo/moq-* versions the consumer already has pinned.
    pkg["dependencies"] = {k.replace("@moq/", "@norskvideo/moq-"): "^0.1.0" for k in pkg["dependencies"]}
json.dump(pkg, open(p, "w"), indent="\t")
print("  name:", pkg["name"], "deps:", pkg.get("dependencies"))
PY
echo "==> done: $(pwd)/dist-norsk"
