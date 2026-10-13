#!/usr/bin/env bash

set -euo pipefail

if [[ $# -lt 1 ]]; then
  echo "usage: $0 WORDLIST [OUTDIR]" >&2
  exit 1
fi

input=$1
outdir=${2:-patterns}

if [[ ! -f $input ]]; then
  echo "error: '$input' not found" >&2
  exit 1
fi

mkdir -p "$outdir"
rm -f "$outdir"/*.json

{ tr -d '\r' < "$input" | tr 'A-Z' 'a-z' | grep -E '^[a-z]+(-[a-z]+)*$' || true; } \
  | sort -u \
  | awk '
    {
      w = $0
      n = length(w)
      for (i = 1; i <= n; i++) {
        key = substr(w, 1, i - 1) "*" substr(w, i + 1)
        b[key] = (key in b) ? b[key] "," w : w
      }
    }
    END {
      for (k in b) printf "%d\t%s\t%s\n", length(k), k, b[k]
    }
  ' \
  | LC_ALL=C sort -t $'\t' -k1,1n -k2,2 \
  | awk -F'\t' -v out="$outdir" '
    function finish() {
      if (file != "") {
        printf "\n}\n" > file
        close(file)
      }
    }
    {
      if ($1 != cur) {
        finish()
        cur = $1
        file = out "/" cur ".json"
        printf "{\n" > file
        first = 1
      }
      n = split($3, a, ",")
      list = ""
      for (i = 1; i <= n; i++) list = list (i > 1 ? ", " : "") "\"" a[i] "\""
      if (!first) printf ",\n" > file
      printf "  \"%s\": [%s]", $2, list > file
      first = 0
    }
    END { finish() }
  '

echo "Wrote:"
for f in "$outdir"/*.json; do
  [[ -e $f ]] || { echo "  (no valid words found)"; break; }
  echo "  $f"
done
