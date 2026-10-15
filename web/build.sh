#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")"

case "${1:-}" in
	''|--serve) ;;
	*) echo "Usage: $0 [--serve]" >&2; exit 1 ;;
esac

# Bundle the extension parser and UI, with separate demo element/style names.
sed 's/^export const parseArgs/const parseArgs/' ../extension/src/background/parseArgs.js > demo-shell-ui.js
sed -e 's/browser-lambdas-shell/browser-lambdas-demo-terminal/g' \
    -e 's/shell-/demo-shell-/g' \
    -e 's/browser-lambdas-default-style/browser-lambdas-demo-default-style/g' \
    -e 's/browser-lambdas-user-style/browser-lambdas-demo-user-style/g' \
    ../extension/src/pages/shell/shellUi.js >> demo-shell-ui.js

html_files=()
for file in *.html; do
	[ -e "$file" ] || continue
	html_files+=("$file")
done

if [ ${#html_files[@]} -eq 0 ]; then
	echo "No HTML files found" >&2
	exit 1
fi

html_to_md() {
	awk '
	function trim(s) { gsub(/^[[:space:]]+|[[:space:]]+$/, "", s); return s }
	function decode(s) {
		gsub(/&gt;/, ">", s); gsub(/&lt;/, "<", s); gsub(/&amp;/, "\\&", s);
		gsub(/&quot;/, "\"", s); gsub(/&#39;/, "'\''", s); gsub(/&nbsp;/, " ", s);
		return s
	}
	function inline_md(s) {
		s = decode(s)
		gsub(/<strong>/, "**", s); gsub(/<\/strong>/, "**", s)
		gsub(/<b>/, "**", s); gsub(/<\/b>/, "**", s)
		gsub(/<em>/, "_", s); gsub(/<\/em>/, "_", s)
		gsub(/<i>/, "_", s); gsub(/<\/i>/, "_", s)
		while (match(s, /<code>[^<]*<\/code>/)) {
			code = substr(s, RSTART + 6, RLENGTH - 13)
			s = substr(s, 1, RSTART - 1) "`" code "`" substr(s, RSTART + RLENGTH)
		}
		while (match(s, /<a href="[^"]+">[^<]*<\/a>/)) {
			link = substr(s, RSTART, RLENGTH)
			href = link; sub(/^<a href="/, "", href); sub(/">.*$/, "", href)
			text = link; sub(/^<a href="[^"]+">/, "", text); sub(/<\/a>$/, "", text)
			s = substr(s, 1, RSTART - 1) "[" text "](" href ")" substr(s, RSTART + RLENGTH)
		}
		gsub(/<kbd>/, "`", s); gsub(/<\/kbd>/, "`", s)
		gsub(/<span[^>]*>/, "", s); gsub(/<\/span>/, "", s)
		gsub(/<[^>]+>/, "", s)
		gsub(/[[:space:]]+/, " ", s)
		return trim(s)
	}
	function print_block(s) { s = inline_md(s); if (s != "") print s "\n" }
	function table_cells(row, out, n, i, cell, rest, open_len, close_start) {
		n = 0
		while (match(row, /<t[hd][^>]*>/)) {
			open_len = RLENGTH
			rest = substr(row, RSTART + open_len)
			if (!match(rest, /<\/t[hd]>/)) break
			close_start = RSTART
			cell = substr(rest, 1, close_start - 1)
			out[++n] = inline_md(cell)
			row = substr(rest, close_start + RLENGTH)
		}
		if (n == 0) return ""
		line = "|"
		for (i = 1; i <= n; i++) line = line " " out[i] " |"
		return line
	}
	function reset_block() { block = ""; tag = "" }
	BEGIN { in_article = 0; in_pre = 0; in_table = 0; skip_section = 0; reset_block() }
	/<article[^>]*id="docs-content"/ { in_article = 1; next }
	in_article && /<\/article>/ { exit }
	!in_article { next }
	{
		line = $0
		gsub(/^[[:space:]]+/, "", line)
		if (skip_section) {
			if (line ~ /<\/section>/) skip_section = 0
			next
		}
		if (line ~ /<section[^>]*data-skip-export="true"/) { skip_section = 1; next }
		if (in_pre) {
			if (line ~ /<\/code><\/pre>/) {
				sub(/<\/code><\/pre>.*/, "", line)
				print decode(line)
				print "```\n"
				in_pre = 0
			} else {
				print decode(line)
			}
			next
		}
		if (line ~ /<pre><code[^>]*>/) {
			print "```"
			sub(/^.*<pre><code[^>]*>/, "", line)
			if (line ~ /<\/code><\/pre>/) {
				sub(/<\/code><\/pre>.*/, "", line)
				print decode(line)
				print "```\n"
			} else {
				print decode(line)
				in_pre = 1
			}
			next
		}
		if (in_table) {
			if (line ~ /<tr>/) row = line; else row = row line
			if (line ~ /<\/tr>/) {
				mdrow = table_cells(row)
				if (mdrow != "") {
					print mdrow
					if (!table_header_printed) {
						divider = mdrow; gsub(/[^|]+/, " --- ", divider); print divider; table_header_printed = 1
					}
				}
				row = ""
			}
			if (line ~ /<\/table>/) { print ""; in_table = 0 }
			next
		}
		if (line ~ /<table>/) { in_table = 1; table_header_printed = 0; row = ""; next }
		if (line ~ /^<h[1-6][^>]*>/) {
			level = substr(line, 3, 1)
			heading = inline_md(line)
			prefix = ""; for (i = 0; i < level; i++) prefix = prefix "#"
			print prefix " " heading "\n"
			next
		}
		if (line ~ /^<li>/) { print "- " inline_md(line); next }
		if (line ~ /^<\/(ul|ol)>/) { print ""; next }
		if (line ~ /^<p>/ && line ~ /<\/p>/) { print_block(line); next }
		if (line ~ /^<p>/) { tag = "p"; block = line; next }
		if (tag == "p") {
			block = block " " line
			if (line ~ /<\/p>/) { print_block(block); reset_block() }
			next
		}
	}
	' "$1" | awk 'BEGIN { blank = 0 } /^$/ { if (!blank) print; blank = 1; next } { print; blank = 0 }' | sed '${/^$/d;}'
}

slugify() {
	local text="$1"
	text=$(printf '%s' "$text" | tr '[:upper:]' '[:lower:]')
	text=$(printf '%s' "$text" | sed -E 's/[^a-z0-9[:space:]-]//g; s/^[[:space:]]+|[[:space:]]+$//g; s/[[:space:]]+/-/g; s/-+/-/g')
	printf '%s' "$text"
}

content_file=$(mktemp)
sitemap_file=$(mktemp)
trap 'rm -f "$content_file" "$sitemap_file"' EXIT
: > "$content_file"
: > "$sitemap_file"

for html in "${html_files[@]}"; do
	md="${html%.html}.md"
	html_to_md "$html" > "$md"

	printf 'Source: /%s\n\n' "$md" >> "$content_file"
	cat "$md" >> "$content_file"
	printf '\n\n' >> "$content_file"

	in_fence=0
	seen_slugs=("")
	while IFS= read -r line; do
		if [ "$line" = '```' ]; then
			if [ "$in_fence" -eq 0 ]; then in_fence=1; else in_fence=0; fi
			continue
		fi
		[ "$in_fence" -eq 0 ] || continue

		case "$line" in
			'# '*) level=1; title=${line#'# '} ;;
			'## '*) level=2; title=${line#'## '} ;;
			'### '*) level=3; title=${line#'### '} ;;
			*) continue ;;
		esac
		slug=$(slugify "$title")
		count=0
		for seen_slug in "${seen_slugs[@]}"; do
			if [ "$seen_slug" = "$slug" ]; then count=$((count + 1)); fi
		done
		seen_slugs+=("$slug")
		if [ "$count" -gt 0 ]; then slug="$slug-$((count + 1))"; fi
		indent=""
		if [ "$level" -eq 2 ]; then indent="  "; fi
		if [ "$level" -eq 3 ]; then indent="    "; fi
		printf '%s- [%s](/%s#%s)\n' "$indent" "$title" "$md" "$slug" >> "$sitemap_file"
	done < "$md"
	unset seen_slugs
done

awk -v sitemap_path="$sitemap_file" -v content_path="$content_file" '
BEGIN {
	while ((getline line < sitemap_path) > 0) sitemap = sitemap line "\n";
	close(sitemap_path);
	while ((getline line < content_path) > 0) content = content line "\n";
	close(content_path);
	sub(/\n+$/, "", sitemap);
	sub(/\n+$/, "", content);
}
{
	if ($0 == "{{SITEMAP}}") print sitemap;
	else if ($0 == "{{CONTENT}}") print content;
	else print;
}
' llms.template.txt > llms.txt

{
	printf 'window.LLMS_TEXT = "'
	awk '{ gsub(/\\/, "\\\\"); gsub(/"/, "\\\""); printf "%s\\n", $0 }' llms.txt
	printf '";\n'
} > llms-data.js

echo "Generated ${html_files[*]/%.html/.md} and llms.txt"

echo "Website build complete."
if [ "${1:-}" = '--serve' ]; then
	echo "Preview: http://localhost:8080"
	exec python3 -m http.server 8080 --bind 127.0.0.1
fi
