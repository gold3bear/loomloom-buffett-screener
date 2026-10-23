#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Render the v4 relationship diagrams used in docs/images.

Requires Pillow (the DSH bundled Python has it). macOS CJK font: Hiragino Sans GB.
This is a documentation build tool, not part of the Skill runtime.
"""

from __future__ import annotations

import math
import os

from PIL import Image, ImageDraw, ImageFont

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "images")

BG = "#07101F"
PANEL = "#0D1A2E"
PANEL_2 = "#112039"
BORDER = "#2B4A6F"
TEXT = "#F4F7FB"
MUTED = "#9EAFC8"
BLUE = "#1596F3"
CYAN = "#62E2FF"
GOLD = "#F5C965"
GREEN = "#6EE7B7"
RED = "#FF8585"
PURPLE = "#B79CFF"

WARNINGS = []

CJK = "/System/Library/Fonts/Hiragino Sans GB.ttc"
MONO = "/System/Library/Fonts/Menlo.ttc"


def font(size, mono=False, bold=False):
    path = MONO if mono else CJK
    face = ImageFont.truetype(path, size)
    return face


def wrap(draw, text, face, max_width):
    lines = []
    for paragraph in str(text).split("\n"):
        if not paragraph.strip():
            lines.append("")
            continue
        words = paragraph.split(" ")
        current = ""
        for word in words:
            candidate = word if not current else current + " " + word
            if draw.textlength(candidate, font=face) <= max_width:
                current = candidate
                continue
            if current:
                lines.append(current)
            if draw.textlength(word, font=face) <= max_width:
                current = word
                continue
            buffer = ""
            for char in word:
                if draw.textlength(buffer + char, font=face) <= max_width:
                    buffer += char
                else:
                    lines.append(buffer)
                    buffer = char
            current = buffer
        if current:
            lines.append(current)
    return lines


def text(draw, xy, value, face, fill=TEXT, anchor="la", spacing=6, max_width=None):
    if max_width is None:
        draw.text(xy, value, font=face, fill=fill, anchor=anchor)
        return
    lines = wrap(draw, value, face, max_width)
    x, y = xy
    for line in lines:
        draw.text((x, y), line, font=face, fill=fill, anchor=anchor)
        y += face.size + spacing
    return y


def box(draw, x, y, w, h, title, body="", accent=BLUE, fill=PANEL_2, title_size=24, body_size=17, mono_title=False):
    draw.rounded_rectangle((x, y, x + w, y + h), radius=14, fill=fill, outline=BORDER, width=2)
    draw.rounded_rectangle((x, y, x + 8, y + h), radius=4, fill=accent, outline=accent)
    title_face = font(title_size, mono=mono_title)
    if draw.textlength(title, font=title_face) > w - 34:
        WARNINGS.append("title overflow: %s (%.0f > %d)" % (title, draw.textlength(title, font=title_face), w - 34))
    draw.text((x + 24, y + 14), title, font=title_face, fill=TEXT)
    if body:
        body_face = font(body_size)
        lines = wrap(draw, body, body_face, w - 44)
        needed = 16 + title_size + 12 + len(lines) * (body_size + 5) + 8
        if needed > h:
            WARNINGS.append("body overflow: %s (needed %d > %d)" % (title, needed, h))
        text(draw, (x + 24, y + 16 + title_size + 12), body, body_face, fill=MUTED, spacing=5, max_width=w - 44)


def container(draw, x, y, w, h, title, accent=BORDER):
    draw.rounded_rectangle((x, y, x + w, y + h), radius=22, fill=PANEL, outline=accent, width=2)
    draw.text((x + 26, y + 20), title, font=font(26), fill=TEXT)


def arrow(draw, points, color=BLUE, width=3, dashed=False, head=12):
    for index in range(len(points) - 1):
        x1, y1 = points[index]
        x2, y2 = points[index + 1]
        if dashed:
            total = math.hypot(x2 - x1, y2 - y1)
            if total == 0:
                continue
            step = 12
            travelled = 0
            while travelled < total:
                end = min(travelled + step, total)
                draw.line(
                    (
                        x1 + (x2 - x1) * travelled / total,
                        y1 + (y2 - y1) * travelled / total,
                        x1 + (x2 - x1) * end / total,
                        y1 + (y2 - y1) * end / total,
                    ),
                    fill=color,
                    width=width,
                )
                travelled += step * 2
        else:
            draw.line((x1, y1, x2, y2), fill=color, width=width)
    x1, y1 = points[-2]
    x2, y2 = points[-1]
    angle = math.atan2(y2 - y1, x2 - x1)
    left = (x2 - head * math.cos(angle - 0.45), y2 - head * math.sin(angle - 0.45))
    right = (x2 - head * math.cos(angle + 0.45), y2 - head * math.sin(angle + 0.45))
    draw.polygon([(x2, y2), left, right], fill=color)


def badge(draw, x, y, label, color=GREEN):
    face = font(16)
    width = draw.textlength(label, font=face) + 22
    draw.rounded_rectangle((x, y, x + width, y + 28), radius=14, fill=color, outline=color)
    draw.text((x + 11, y + 5), label, font=face, fill=BG)


def build_pipeline():
    image = Image.new("RGB", (1900, 1560), BG)
    draw = ImageDraw.Draw(image)

    draw.text((60, 34), "LoomLoom v4 关系图：数据、模型与审计", font=font(40), fill=TEXT)
    draw.text((62, 88), "本地取证 → 云端并行评审 + 确定性 Code 节点 → 本地重算、不变量审计与交付", font=font(20), fill=MUTED)

    container(draw, 60, 140, 520, 1320, "① 本地准备 / Local", BLUE)
    container(draw, 620, 140, 640, 1320, "② 云端 v4 模板（一次 run）", CYAN)
    container(draw, 1300, 140, 540, 1320, "③ 本地审计 / Audit", GOLD)

    # Column 1
    box(draw, 80, 205, 480, 85, "用户输入", "ticker / CSV / Excel / 标准化指标表", BLUE)
    box(draw, 80, 300, 480, 150, "三个 packet", "identityPacket · 公司、行业、日期、来源\nfinancialPacket · 三表 + balanceSheet + 行情\nqualitativePacket · 商业模式、护城河、风险", BLUE)
    box(draw, 80, 475, 480, 130, "modelAssumptions", "bear / base / bull 三情景\n增长、利润率、税率、D&A、Capex、NWC、WACC、终值", GOLD)
    box(draw, 80, 620, 480, 140, "preflight 闸门", "新鲜度 / HTTPS 来源 / 单位\n市值勾稽 / 数组等长\n模型 driver 与期初 BS 字段", BLUE)
    box(draw, 80, 785, 480, 140, "run-model.mjs", "同一份 Python 引擎本地重算\n→ model.json + model.xlsx\n（Python 3.9+，纯标准库）", GREEN)
    box(draw, 80, 950, 480, 130, "证据纪律", "每条事实：URL + as-of + S/A/B/C\nC 级（论坛/博客/维基）不作为证据\n缺失进 unknowns，不进证据字段", PURPLE)
    box(draw, 80, 1100, 480, 320, "三条铁律", "缺 driver 不建模，绝不填默认 WACC / 增长率\n\n模型值 ≠ 目标价，不输出买卖、仓位、预期收益\n\n云端与本地不一致 → model_recompute_mismatch 否决", RED)

    # Column 2
    box(draw, 640, 205, 600, 58, "TemplateSpec v2 · 5 steps", "", CYAN, title_size=22)
    draw.text((642, 266), "已创建：03cc5781… / fa5309c1…", font=font(14), fill=MUTED)
    box(draw, 640, 290, 285, 112, "stp_business", "商业模式\n能力圈", CYAN, title_size=22, mono_title=True)
    box(draw, 955, 290, 285, 112, "stp_management", "护城河\n管理层", CYAN, title_size=22, mono_title=True)
    box(draw, 640, 427, 285, 112, "stp_financial", "财务质量\n现金流", CYAN, title_size=22, mono_title=True)
    box(draw, 955, 427, 285, 112, "stp_valuation", "估值\n安全边际", CYAN, title_size=22, mono_title=True)
    box(
        draw,
        640,
        562,
        600,
        170,
        "stp_model01 · codeProfile",
        "python-pure@1 · 无网络 / 无三方包 / 无 secret\n三表 + DCF + 反 DCF + 5×5 敏感性 + xlsx\n源码 63,355 / 65,536 bytes（AST 压缩，语义等价）",
        GREEN,
        title_size=22,
        mono_title=True,
    )
    box(draw, 640, 758, 600, 126, "输出", "4 × review JSON（text/plain）\nmodel JSON（typed value）\nworkbook.xlsx（artifact，17 sheets）", CYAN, title_size=22)
    box(draw, 640, 895, 600, 150, "同一份源码的两份拷贝", "valuation_model.py（可读，source of truth）\n↔ valuation_model.cloud.py（压缩，注入模板）\ntest_minify 验证输出逐字节一致", GREEN, title_size=22)
    box(
        draw,
        640,
        1070,
        600,
        150,
        "Code 节点约束",
        "65,536 bytes 源码上限\n无网络 / 无第三方依赖 / 不可读平台 secret\nartifact 只能写执行工作目录\n失败不静默降级",
        RED,
        title_size=22,
    )

    # Column 3
    box(
        draw,
        1320,
        205,
        520,
        195,
        "merge-public-results.mjs",
        "证据审计：source_ref 必须解析回输入行\nsource_value 必须逐字匹配原子事实\n模型重算比对：相对误差 ≤ 1e-4\n4 类模型 veto + 既有硬否决",
        GOLD,
        title_size=22,
        mono_title=True,
    )
    box(
        draw,
        1320,
        425,
        520,
        190,
        "check-invariants.mjs",
        "packet / model / workbook / audit\n24 项 error 检查\n一条命令给出 PASS / FAIL\n可用作 CI 门禁",
        GOLD,
        title_size=22,
        mono_title=True,
    )
    box(
        draw,
        1320,
        640,
        520,
        160,
        "决策层",
        "deep_research / watchlist\npass / rejected\n模型不覆盖四维评分，只加独立锚与矛盾否决",
        PURPLE,
        title_size=22,
    )
    box(
        draw,
        1320,
        825,
        520,
        220,
        "交付物",
        "report.md（含模型段与不变量）\naudit.json\nmodel.json + model.xlsx\ninvariants.json\nrun ID / 费用 / 数据与价格截止",
        GOLD,
        title_size=22,
    )
    box(
        draw,
        1320,
        1070,
        520,
        150,
        "本次实跑（2026-10-23）",
        "NVDA · overall 82 · watchlist\ncloud/local matched · gate 25/25\n实际费用 0.0196 CNY · 17-sheet xlsx",
        GREEN,
        title_size=22,
    )

    # Arrows in column 1
    for y1, y2 in ((290, 300), (450, 475), (605, 620), (760, 785), (925, 950), (1080, 1100)):
        arrow(draw, [(320, y1), (320, y2)], BLUE, 3)

    # Inputs to cloud
    arrow(draw, [(560, 375), (600, 375), (600, 345), (640, 345)], BLUE, 3)
    draw.text((566, 330), "packets", font=font(15), fill=MUTED)
    arrow(draw, [(560, 535), (600, 535), (600, 645), (640, 645)], GOLD, 3)
    draw.text((566, 520), "assumptions", font=font(15), fill=MUTED)

    # Cloud output to merge
    arrow(draw, [(1240, 814), (1272, 814), (1272, 300), (1320, 300)], GREEN, 4)
    draw.text((1178, 780), "model + reviews + xlsx", font=font(15), fill=GREEN)

    # Local model to merge (dashed, corridor below)
    arrow(draw, [(560, 855), (592, 855), (592, 1240), (1286, 1240), (1286, 260), (1320, 260)], GREEN, 3, dashed=True)
    draw.text((760, 1212), "本地重算 model.json（同一份引擎，独立路径）", font=font(15), fill=GREEN)

    # Column 3 vertical
    for y1, y2 in ((400, 425), (615, 640), (800, 825), (1045, 1070)):
        arrow(draw, [(1580, y1), (1580, y2)], GOLD, 3)

    # Legend
    arrow(draw, [(80, 1495), (150, 1495)], BLUE, 3)
    draw.text((164, 1482), "数据流", font=font(16), fill=MUTED)
    arrow(draw, [(260, 1495), (330, 1495)], GREEN, 3, dashed=True)
    draw.text((344, 1482), "重算 / 校验", font=font(16), fill=MUTED)
    draw.text((520, 1482), "研究辅助，不构成投资建议；模型值是假设条件下的算术结果，不是目标价。", font=font(16), fill=MUTED)

    os.makedirs(OUT, exist_ok=True)
    path = os.path.join(OUT, "v4-pipeline.png")
    image.save(path, "PNG")
    print("wrote", path, image.size)


def build_model_map():
    image = Image.new("RGB", (1600, 1400), BG)
    draw = ImageDraw.Draw(image)

    draw.text((60, 34), "模型内部关系：三表 → FCFF → DCF → 每股价值", font=font(38), fill=TEXT)
    draw.text((62, 86), "每个 error 级不变量失败 → model_ready=false；warning 只标注，不阻断", font=font(20), fill=MUTED)

    container(draw, 40, 130, 360, 1120, "输入", BLUE)
    container(draw, 420, 130, 780, 1120, "确定性计算链", GREEN)
    container(draw, 1220, 130, 340, 1120, "不变量", GOLD)

    # Left inputs
    box(draw, 60, 210, 320, 120, "packets + assumptions", "identity / financial\nqualitative / modelAssumptions", BLUE, title_size=22)
    box(draw, 60, 370, 320, 140, "历史与期初", "3 年 revenue / NI / FCF\n期初 BS、股数、当前价", BLUE, title_size=22)
    box(draw, 60, 550, 320, 110, "营运资本与投资", "D&A / Capex / ΔNWC\n按收入百分比驱动", BLUE, title_size=22)
    box(draw, 60, 700, 320, 130, "折现与终值", "WACC / terminalGrowth\n或 exitMultiple", GOLD, title_size=22)
    box(draw, 60, 870, 320, 110, "价值桥输入", "期末债务 - 期末现金\n= 净债务", GOLD, title_size=22)
    box(draw, 60, 1020, 320, 110, "市场输入", "当前价 + 价格时间戳\n股数（稀释）", PURPLE, title_size=22)
    box(draw, 60, 1160, 320, 82, "输出", "model.json + xlsx", GREEN, title_size=22)

    # Center chain
    cx, cw = 440, 740
    box(
        draw,
        cx,
        180,
        cw,
        130,
        "① 显式假设（无默认值）",
        "revenueGrowth · ebitMargin · taxRate · D&A · Capex · NWC\nWACC · terminalGrowth 或 exitMultiple · shares",
        GOLD,
        title_size=24,
    )
    box(
        draw,
        cx,
        345,
        cw,
        150,
        "② 三表联动",
        "P&L：Revenue → EBIT → 利息 → 税 → 净利润\nBS：Cash + NWC + NetPPE + Other = Debt + OtherLiab + Equity\nCF：NI + D&A - ΔNWC - Capex - 分配",
        BLUE,
        title_size=24,
    )
    box(
        draw,
        cx,
        530,
        cw,
        120,
        "③ FCFF",
        "NOPAT = EBIT × (1 - tax)\nFCFF = NOPAT + D&A - Capex - ΔNWC",
        GREEN,
        title_size=24,
    )
    box(
        draw,
        cx,
        685,
        cw,
        150,
        "④ 折现与终值",
        "PV_t = FCFF_t / (1 + WACC)^t\nTV = FCFF_N × (1 + g) / (WACC - g)\n或 TV = EBIT_N × exitMultiple",
        GREEN,
        title_size=24,
    )
    box(
        draw,
        cx,
        870,
        cw,
        140,
        "⑤ 价值桥",
        "EV = ΣPV(FCFF) + PV(TV)\nEquity = EV - NetDebt\nValue per share = Equity / Shares",
        CYAN,
        title_size=24,
    )
    box(
        draw,
        cx,
        1045,
        cw,
        145,
        "⑥ 安全边际与反解",
        "MOS = (Value per share - Price) / Value per share\n反 DCF：价格隐含的显式期平均增长率\n敏感性：WACC × terminal growth → 每股价值",
        GOLD,
        title_size=24,
    )

    # Center arrows
    for y1, y2 in ((310, 345), (495, 530), (650, 685), (835, 870), (1010, 1045)):
        arrow(draw, [(810, y1), (810, y2)], GREEN, 4)

    # Left to center arrows
    for y, color in ((270, BLUE), (440, BLUE), (605, BLUE), (760, GOLD), (925, GOLD), (1075, PURPLE)):
        arrow(draw, [(380, y), (440, y)], color, 3)

    # Right invariant rail
    rail_x, rail_w = 1240, 300
    draw.text((rail_x, 190), "会计恒等式", font=font(22), fill=GOLD)
    items = [
        ("BS", "资产 = 负债 + 权益", GREEN),
        ("CF", "期末现金 = 期初 + Σ净变动", GREEN),
        ("EQ", "期末权益 = 期初 + NI - 分配", GREEN),
        ("FCFF", "NOPAT + D&A - Capex - ΔNWC", GREEN),
        ("DCF", "EV = ΣPV + PV(TV)", GREEN),
        ("WACC", "WACC > terminal g", GREEN),
        ("SENS", "网格中心 = base 价值", CYAN),
        ("REV", "反 DCF 复现当前价", CYAN),
        ("TV", "终值 / EV ≤ 85%（warning）", GOLD),
        ("NWC", "期初 NWC 与 driver 一致（warning）", GOLD),
    ]
    y = 230
    for tag, label, color in items:
        draw.rounded_rectangle((rail_x, y, rail_x + 52, y + 28), radius=8, fill=color, outline=color)
        draw.text((rail_x + 8, y + 4), tag, font=font(15, mono=True), fill=BG)
        text(draw, (rail_x + 64, y + 2), label, font(16), fill=MUTED, spacing=4, max_width=rail_w - 70)
        y += 74

    draw.text((rail_x, 980), "两条模型级定理", font=font(22), fill=CYAN)
    text(draw, (rail_x, 1020), "敏感性网格中心必须等于 base 每股价值。", font(17), fill=MUTED, spacing=5, max_width=rail_w)
    text(draw, (rail_x, 1085), "用反解增长率重跑，必须复现当前价格（±1%）。", font(17), fill=MUTED, spacing=5, max_width=rail_w)
    text(draw, (rail_x, 1155), "任一 error 失败：model_ready=false，报告与审计都拒绝使用该模型。", font(16), fill=RED, spacing=4, max_width=rail_w)

    # Bottom banner
    draw.rounded_rectangle((60, 1280, 1540, 1350), radius=14, fill=PANEL_2, outline=BORDER, width=2)
    text(
        draw,
        (84, 1298),
        "模型值是假设条件下的确定性算术，不是目标价、收益预测或买卖指令。缺 driver 时模型拒绝运行。",
        font(19),
        fill=MUTED,
        max_width=1430,
    )

    os.makedirs(OUT, exist_ok=True)
    path = os.path.join(OUT, "v4-model-map.png")
    image.save(path, "PNG")
    print("wrote", path, image.size)




def build_loomloom_flow():
    """Render the LoomLoom-native step DAG directly from template.json."""
    import json

    template_path = os.path.join(HERE, "..", "templates", "buffett-four-filters-model.cogfoundry", "template.json")
    with open(template_path, "r", encoding="utf-8") as handle:
        spec = json.load(handle)
    steps = spec["steps"]
    llm_steps = [step for step in steps if step["executionBinding"]["kind"] == "capabilityProfile"]
    code_steps = [step for step in steps if step["executionBinding"]["kind"] == "codeProfile"]
    preflight = next(step for step in code_steps if step["stepId"] == "stp_preflight")
    model = next(step for step in code_steps if step["stepId"] == "stp_model01")
    preflight_size = len(preflight["code"]["source"].encode("utf-8"))
    model_size = len(model["code"]["source"].encode("utf-8"))

    image = Image.new("RGB", (1900, 1300), BG)
    draw = ImageDraw.Draw(image)

    draw.text((40, 30), "LoomLoom 原生模板流程图（由 template.json 生成）", font=font(37), fill=TEXT)
    draw.text((42, 80), "前置 Code 门禁 + 五个 when 条件节点；ready=false 时下游全部跳过、不产生 LLM 费用", font=font(19), fill=MUTED)

    box(
        draw,
        40,
        120,
        1820,
        80,
        "Run input · 1 row",
        "tickerPacket（三个 packet + balanceSheet + marketCapUsd）  +  modelAssumptions  +  asOf（可选）",
        BLUE,
        title_size=23,
        body_size=16,
    )
    arrow(draw, [(950, 200), (950, 220)], BLUE, 4)

    box(
        draw,
        40,
        220,
        1820,
        125,
        "stp_preflight · codeProfile · 前置门禁",
        "python-pure@1 · %s bytes · 无网络 / 无三方包\npacket 结构 / 新鲜度 / HTTPS 来源 / 单位 / 市值勾稽 / 期初 BS / source tier / DCF drivers\noutputs：ready(boolean) · findings(array) · summary(object)" % format(preflight_size, ","),
        GREEN,
        title_size=22,
        body_size=16,
        mono_title=True,
    )

    positions = [40, 400, 760, 1120, 1480]
    widths = [340, 340, 340, 340, 380]
    labels = {
        "stp_business": "商业模式 · 能力圈",
        "stp_management": "护城河 · 管理层",
        "stp_financial": "财务质量",
        "stp_valuation": "估值 · 安全边际",
    }
    for step, x, w in zip(llm_steps, positions[:4], widths[:4]):
        box(
            draw,
            x,
            365,
            w,
            180,
            step["stepId"],
            "capabilityProfile · when ready=true\n%s\n%s\n%s\n→ output · text/plain" % (
                step["executionBinding"].get("profileId", ""),
                step.get("modelSelection", {}).get("defaultModelId", ""),
                labels.get(step["stepId"], ""),
            ),
            CYAN,
            title_size=20,
            body_size=13,
            mono_title=True,
        )
    box(
        draw,
        positions[-1],
        365,
        widths[-1],
        180,
        model["stepId"] + " · codeProfile",
        "when ready=true\npython-pure@1 · 无网络 / 无三方包\n三表 + DCF + 反 DCF + 敏感性\n%s / 65,536 bytes" % format(model_size, ","),
        GREEN,
        title_size=18,
        body_size=14,
        mono_title=True,
    )

    for x, w in zip(positions, widths):
        arrow(draw, [(x + w / 2, 345), (x + w / 2, 365)], CYAN if x < positions[-1] else GREEN, 3)
    draw.text((48, 350), "when ready=true", font=font(14), fill=MUTED)

    # Review outputs
    for x, w in zip(positions[:4], widths[:4]):
        arrow(draw, [(x + w / 2, 545), (x + w / 2, 565)], CYAN, 2)
        draw.rounded_rectangle((x + w / 2 - 92, 565, x + w / 2 + 92, 597), radius=12, fill=PANEL_2, outline=BORDER, width=1)
        draw.text((x + w / 2, 572), "output · text/plain", font=font(14), fill=MUTED, anchor="ma")

    # Code outputs
    box(draw, positions[-1], 560, widths[-1], 70, "model · value (object)", "typed value · 22 fields", GREEN, title_size=16, body_size=13, mono_title=True)
    box(draw, positions[-1], 638, widths[-1], 70, "workbook · artifact", "xlsx · 17 sheets · 25 KB", GREEN, title_size=16, body_size=13, mono_title=True)

    # Result
    box(
        draw,
        40,
        720,
        1820,
        105,
        "run result-rows · 1 row",
        "values[]: stp_preflight/ready, findings, summary + stp_model01/model（object）\nartifacts[]: stp_business…stp_valuation/output（text）+ stp_model01/workbook（xlsx）",
        GOLD,
        title_size=23,
        body_size=15,
    )
    for x, w in zip(positions[:4], widths[:4]):
        arrow(draw, [(x + w / 2, 597), (x + w / 2, 720)], CYAN, 2, dashed=True)
    arrow(draw, [(positions[-1] + widths[-1] / 2, 708), (positions[-1] + widths[-1] / 2, 720)], GREEN, 3)

    # Local chain
    box(draw, 40, 855, 560, 115, "merge-public-results.mjs", "证据审计 + 模型重算比对\n+ 透传 preflight findings", GOLD, title_size=21, body_size=15, mono_title=True)
    box(draw, 670, 855, 560, 115, "check-invariants.mjs", "packet / model / workbook / audit\n24 项 error 检查", GOLD, title_size=21, body_size=15, mono_title=True)
    box(draw, 1300, 855, 560, 115, "render-report.mjs", "report.md + audit.json\n+ invariants.json", GOLD, title_size=21, body_size=15, mono_title=True)
    arrow(draw, [(950, 825), (950, 855)], GOLD, 3)
    arrow(draw, [(600, 912), (670, 912)], GOLD, 3)
    arrow(draw, [(1230, 912), (1300, 912)], GOLD, 3)

    # CLI lifecycle
    draw.text((40, 1000), "CLI 生命周期（本次实跑）", font=font(23), fill=TEXT)
    phases = ["check", "create-version", "upload", "precheck", "run", "watch", "result-rows", "artifact download"]
    px = 40
    for index, phase in enumerate(phases):
        face = font(15, mono=True)
        width = draw.textlength(phase, font=face) + 24
        draw.rounded_rectangle((px, 1042, px + width, 1078), radius=15, fill=PANEL_2, outline=BORDER, width=1)
        draw.text((px + 12, 1048), phase, font=face, fill=CYAN)
        px += width
        if index < len(phases) - 1:
            arrow(draw, [(px + 3, 1060), (px + 21, 1060)], BLUE, 2, head=8)
            px += 24

    # Native facts
    facts = [
        "1 个前置 Code 门禁",
        "5 个 when 条件节点",
        "6 个 step 全部无 dependsOn 冲突",
        "preflight 21,080 bytes",
        "model 63,355 / 65,536 bytes",
    ]
    x = 40
    for fact in facts:
        face = font(14)
        width = draw.textlength(fact, font=face) + 22
        draw.rounded_rectangle((x, 1095, x + width, 1127), radius=16, fill=PANEL_2, outline=BORDER, width=1)
        draw.text((x + 11, 1101), fact, font=face, fill=MUTED)
        x += width + 12

    draw.rounded_rectangle((40, 1160, 1860, 1245), radius=14, fill=PANEL_2, outline=BORDER, width=2)
    text(
        draw,
        (64, 1178),
        "LoomLoom 对象链：TemplateSpec v2 → TemplateVersion → OrchestrationInput → Run → Task → Step Attempt → Value / Artifact。\npreflight 失败时，五个下游 Step 记录为 skipped，不创建 Attempt、不产生模型调用费用。",
        font(17),
        fill=MUTED,
        spacing=6,
        max_width=1760,
    )

    path = os.path.join(OUT, "v4-loomloom-flow.png")
    image.save(path, "PNG")
    print("wrote", path, image.size)


if __name__ == "__main__":
    build_pipeline()
    build_model_map()
    build_loomloom_flow()
    if WARNINGS:
        print("LAYOUT WARNINGS:")
        for warning in WARNINGS:
            print(" -", warning)
    else:
        print("layout: no overflow warnings")
