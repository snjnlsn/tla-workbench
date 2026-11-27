"""Build the browser checker with portable source paths."""
import json
import os
import shutil
import subprocess
from pathlib import Path

root = Path(__file__).resolve().parents[1]
home = Path.home()
sysroot = Path(subprocess.check_output(["rustc", "--print", "sysroot"], text=True).strip())
paths = [
    (home, "home"),
    (sysroot, "toolchain"),
    (Path(os.environ.get("CARGO_HOME", home / ".cargo")), "cargo"),
    (root, "workbench"),
]
# Rust applies the last matching prefix. Put specific paths last.
flags = [f"--remap-path-prefix={p.resolve()}={label}" for p, label in paths]
env = dict(os.environ, CARGO_ENCODED_RUSTFLAGS="\x1f".join(flags))
target = "wasm32-unknown-unknown"
subprocess.run(
    ["cargo", "build", "--locked", "--release", "--target", target, "--target-dir", "target"],
    cwd=root, env=env, check=True,
)
shutil.copyfile(root / "target" / target / "release/tla_workbench.wasm", root / "dist/checker.wasm")

examples = {p.stem: p.read_text() for p in sorted((root / "tla").glob("*.tla"))}
(root / "dist/examples.mjs").write_text("export const examples = " + json.dumps(examples, indent=2) + ";\n")
