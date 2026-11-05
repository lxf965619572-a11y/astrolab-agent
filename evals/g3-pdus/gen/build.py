#!/usr/bin/env python3
"""由 gen/ 下的源文件生成 materials/ 下各阶段的材料。
需要 pandoc（md→docx）和 LibreOffice（docx→pdf）。材料生成后提交到仓库，评测时不需要再运行本脚本。
用法：python3 evals/g3-pdus/gen/build.py
"""
import os, shutil, subprocess, sys, re

G = os.path.dirname(os.path.abspath(__file__))
E = os.path.dirname(G)
M = os.path.join(E, 'materials')
CODE = os.path.join(E, 'code')


def strip_comment(src, dst):
    """去掉评测用的 HTML 注释（交给智能体的输入不需要）"""
    s = open(src, encoding='utf8').read()
    s = re.sub(r'<!-- 虚构示例[^>]*-->\n*', '', s)
    open(dst, 'w', encoding='utf8').write(s)


def render(tpl, var, out):
    subprocess.run([sys.executable, os.path.join(G, 'render.py'), os.path.join(G, tpl), var, out], check=True)
    strip_comment(out, out)


def docx(md, out):
    subprocess.run(['pandoc', md, '-o', out], check=True)


def stage(name):
    d = os.path.join(M, name, 'g3-pdus')
    os.makedirs(d, exist_ok=True)
    return d


def copytree(src, dst):
    shutil.copytree(src, dst, dirs_exist_ok=True)


if os.path.exists(M):
    shutil.rmtree(M)
tmp = os.path.join(G, '.tmp')
os.makedirs(tmp, exist_ok=True)

# 1 需求：任务书、协议 V1.0（docx）、硬件接口说明；XY-7 基线（需求规格说明、详细设计、代码）
d = stage('1-需求')
os.makedirs(os.path.join(d, 'input'))
strip_comment(os.path.join(G, 'input', 'XY-9卫星配电单元软件研制任务书.md'), os.path.join(tmp, 'rw.md'))
docx(os.path.join(tmp, 'rw.md'), os.path.join(d, 'input', 'XY-9卫星配电单元软件研制任务书.docx'))
render('protocol.tpl.md', 'O', os.path.join(tmp, 'p10.md'))
strip_comment(os.path.join(tmp, 'p10.md'), os.path.join(tmp, 'p10.md'))
docx(os.path.join(tmp, 'p10.md'), os.path.join(d, 'input', 'XY-9卫星配电单元与数管分系统通信协议-V1.0.docx'))
strip_comment(os.path.join(G, 'input', 'PDU硬件接口说明-摘录.md'), os.path.join(d, 'input', 'PDU硬件接口说明-摘录.md'))
b = os.path.join(d, 'baseline', 'XY-7-V1.00')
os.makedirs(os.path.join(b, 'doc'))
render('srs.tpl.md', 'O', os.path.join(b, 'doc', '软件需求规格说明-XY7-PDUS-V1.0.md'))
render('dd.tpl.md', 'O', os.path.join(b, 'doc', '软件详细设计说明-XY7-PDUS-V1.00.md'))
copytree(os.path.join(CODE, 'V1.00', 'src'), os.path.join(b, 'src'))
copytree(os.path.join(CODE, 'V1.00', 'include'), os.path.join(b, 'include'))

# 2 设计：发布的需求规格说明 V1.1、问题答复单、协议 V1.1
d = stage('2-设计')
os.makedirs(os.path.join(d, 'released'))
os.makedirs(os.path.join(d, 'input'))
render('srs.tpl.md', 'N', os.path.join(d, 'released', '软件需求规格说明-PDUS-V1.1.md'))
strip_comment(os.path.join(G, 'released', 'XY-9配电单元软件需求待确认问题答复单.md'), os.path.join(d, 'released', 'XY-9配电单元软件需求待确认问题答复单.md'))
render('protocol.tpl.md', 'N', os.path.join(tmp, 'p11.md'))
strip_comment(os.path.join(tmp, 'p11.md'), os.path.join(tmp, 'p11.md'))
docx(os.path.join(tmp, 'p11.md'), os.path.join(d, 'input', 'XY-9卫星配电单元与数管分系统通信协议-V1.1.docx'))

# 3 代码：开发方 V1.01 代码、发布的详细设计说明 V1.01
d = stage('3-代码')
copytree(os.path.join(CODE, 'V1.01'), os.path.join(d, 'dev', 'V1.01'))
os.makedirs(os.path.join(d, 'released'))
render('dd.tpl.md', 'N', os.path.join(d, 'released', '软件详细设计说明-PDUS-V1.01.md'))

# 5 V1.02：改正后的代码、问题处理说明（第 4、6 阶段的执行记录表由 make-exec.mjs 按智能体导出的表生成）
d = stage('5-V1.02')
copytree(os.path.join(CODE, 'V1.02'), os.path.join(d, 'dev', 'V1.02'))
strip_comment(os.path.join(G, 'dev', 'V1.02问题处理说明.md'), os.path.join(d, 'dev', 'V1.02', '问题处理说明.md'))

# 7 数据包
d = stage('7-数据包')
p = os.path.join(d, 'package')
os.makedirs(p)
for f in sorted(os.listdir(os.path.join(G, 'package'))):
    src = os.path.join(G, 'package', f)
    if f.endswith('.md'):
        strip_comment(src, os.path.join(p, f))
    else:
        shutil.copy(src, os.path.join(p, f))

# 数据包中的 Word、PDF 文件（测试 docreader 读取）
ps = os.path.join(G, 'package-src')
docx(os.path.join(ps, '评审纪要-第三方评测评审.md'), os.path.join(p, '评审纪要-第三方评测评审.docx'))
docx(os.path.join(ps, '第三方评测报告-PDUS.md'), os.path.join(p, '第三方评测报告-PDUS.docx'))
docx(os.path.join(ps, '评审纪要-软件需求评审.md'), os.path.join(tmp, '需求评审.docx'))
subprocess.run(['soffice', '--headless', '--convert-to', 'pdf', '--outdir', tmp, os.path.join(tmp, '需求评审.docx')], check=True, capture_output=True)
shutil.copy(os.path.join(tmp, '需求评审.pdf'), os.path.join(p, '评审纪要-软件需求评审.pdf'))

shutil.rmtree(tmp)
for root, _, files in os.walk(M):
    for f in files:
        print(os.path.relpath(os.path.join(root, f), M))
