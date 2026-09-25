#!/usr/bin/env bash
# M-LANG2a broken-file fixture: the unterminated `case` below makes
# tree-sitter wrap the WHOLE program in an ERROR node (probed against
# tree-sitter-bash 0.25) — the frontend must report the drop, keep the
# healthy function it swallowed, and emit no garbage IR.

healthy() {
  echo "still parsed"
}

case x
