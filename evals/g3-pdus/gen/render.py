#!/usr/bin/env python3
"""按变体渲染模板：行首 'N|' 只在 N 版保留，'O|' 只在 O 版保留；行内 {{N:...||O:...}}。
用法：python3 render.py <模板> <N|O> <输出>"""
import re, sys
tpl, var, out = sys.argv[1], sys.argv[2], sys.argv[3]
lines = []
for l in open(tpl, encoding='utf8').read().split('\n'):
    m = re.match(r'^([NO])\|(.*)$', l)
    if m:
        if m.group(1) != var: continue
        l = m.group(2)
    l = re.sub(r'\{\{N:(.*?)\|\|O:(.*?)\}\}', lambda m: m.group(1) if var == 'N' else m.group(2), l)
    lines.append(l)
text = '\n'.join(lines)
text = re.sub(r'\n{3,}', '\n\n', text)
assert '{{N:' not in text and '||O:' not in text, '未展开的变体'
open(out, 'w', encoding='utf8').write(text)
