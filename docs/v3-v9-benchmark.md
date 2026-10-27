# v9 vs 原版 6-step 基线：量化对比

日期：2026-10-27  
范围：ORCL、NVDA、AAPL  
结论先行：**v9 的可复核性和端到端完成度更高；评分只提升 1 分，分析结论没有质变。**  
v9 的主要价值是“云端闭环”，不是“突然更会选股”。

## 1. 对比对象

### v9

- 模板：`03cc5781-ddca-40e3-a9df-ccf1fe626447`
- 版本：v9 `7ca2a5d6-dbd7-4e4f-85c1-004d1456bd44`
- 步骤：preflight + 4 reviews + model + audit + report（8 步）
- 输出：6 artifacts，8 values
- 审计：云端 `stp_audit1`
- 报告：云端 `stp_report`
- 本地后处理：不需要

### 原版基线

- 来源：归档的 6-step run（`.tools/orcl-result.json`、`.tools/nvda-result.json`）
- 步骤：preflight + 4 reviews + model（6 步）
- 输出：5 artifacts，4 values
- 审计：本地 `merge-public-results.mjs`
- 报告：本地 `render-report.mjs`
- 本地后处理：merge + report + check-invariants

> 公开 Market 的 v3 Listing 只有 4 路 review，没有云端 model/audit/report；它比这个 6-step 基线更早，不能直接按模型指标对比。

### 为什么不是 v1 实跑

v1 旧版本在当前服务端已无法直接运行：

```text
codeSteps[0]: invalid Code sourceRef:
require sha256 and 1..1048576 bytes; re-save old template versions
```

因此本报告使用已归档的 6-step 结果做基线，并明确标注它是归档数据，不是本次重跑。

## 2. 结果总表

| 指标 | 原版 6-step | v9 | 变化 |
|---|---|---:|---:|
| 云端步骤数 | 6 | 8 | +2 |
| Artifacts / row | 5 | 6 | +1 report |
| Values / row | 4 | 8 | +4 |
| 云端 audit | 无 | 有 | 新增 |
| 云端 report | 无 | 有 | 新增 |
| 本地必需命令 | merge/report/check | 无 | 减少 |
| ORCL score | 69 | 70 | +1 |
| NVDA score | 81 | 82 | +1 |
| AAPL score | 未跑 | 86 | — |
| ORCL evidence | 41 / 0 | 42 / 4 | 隔离 4 |
| NVDA evidence | 29 / 3 | 35 / 3 | +6 verified |
| ORCL narrative conflicts | 0 | 0 | 持平 |
| NVDA narrative conflicts | 3 | 1 | −2 |
| ORCL base value | −34.7275 | −34.7275 | 0 |
| NVDA base value | 140.0333 | 136.6394 | −3.39 (−2.4%) |
| v9 estimated cost | 未记录 | 0.0401–0.0506 CNY | — |

## 3. 逐 ticker

### ORCL

| 项目 | 原版 | v9 |
|---|---:|---:|
| Decision | watchlist | watchlist |
| Score | 69 | 70 |
| Evidence | 41 / 0 | 42 / 4 quarantined |
| Narrative conflicts | 0 | 0 |
| Base value/share | −34.73 | −34.73 |
| Model verdict | model_incomplete | model_incomplete |
| Cost | 未记录 | 0.0497763 CNY |

结论：**几乎完全一致。**  
v9 多出的 4 条 quarantine 没有改变结论；audit/report 让负值解释更明确，但估值判断不变。

### NVDA

| 项目 | 原版 | v9 |
|---|---:|---:|
| Decision | watchlist | watchlist |
| Score | 81 | 82 |
| Evidence | 29 / 3 | 35 / 3 |
| Narrative conflicts | 3 | 1 |
| Base value/share | 140.03 | 136.64 |
| Model verdict | price_above_model_value | price_above_model_value |
| Cost | 未记录 | 0.0505781 CNY |

结论：**结论一致，数值有 2.4% 差异，narrative 冲突减少。**  
v9 的模型版本/输入口径与归档版本不同，不能把 136.64 vs 140.03 当作“更准确”，只能当作版本差异。

### AAPL

| 项目 | v9 |
|---|---:|
| Decision | watchlist |
| Score | 86 |
| Evidence | 35 / 3 |
| Narrative conflicts | 0 |
| Base value/share | 122.81 |
| Bull value/share | 206.47 |
| Price | 220.50 |
| Cost | 0.0401169 CNY |

说明：AAPL 没有可用的原版 6-step 归档结果，因此只报告 v9 单边结果。  
数据日期为 2026-09-01，不是 2026-10-27 的实时价格。

## 4. 过程质量

### 4.1 Evidence

| Ticker | 原版 verified | v9 verified | 原版 rejected | v9 quarantined |
|---|---:|---:|---:|---:|
| ORCL | 41 | 42 | 0 | 4 |
| NVDA | 29 | 35 | 3 | 3 |
| AAPL | — | 35 | — | 3 |

v9 的 quarantine 是“丢弃坏条目并继续”，不是“全部通过”。  
它比原版更透明，但也意味着 `accepted=true` 可能带 3–4 条 warning。

### 4.2 Narrative

- ORCL：两者都没有 narrative conflict；
- NVDA：原版 3 条，v9 1 条；
- AAPL：v9 0 条。

v9 的 narrative 检查覆盖更好，但仍不能证明叙述完全正确。

### 4.3 Model

- ORCL 两者都得到负值，v9 明确标记 `MODEL_VALUE_NON_POSITIVE`；
- NVDA 两者都判断价格高于模型值；
- v9 增加了 opening net debt、平衡表、现金流、FCFF 等 checks；
- 归档版本与 v9 的 NVDA 值差 2.4%，说明模型版本差异真实存在。

## 5. 成本与工作量

v9 run 成本：

```text
ORCL 0.0497763 CNY
NVDA 0.0505781 CNY
AAPL 0.0401169 CNY
平均 0.0468 CNY
```

原版归档 run 没有保存 cost，不能给出可靠对比。  
但原版还需要本地：

```text
merge-public-results.mjs
render-report.mjs
check-invariants.mjs
```

v9 云端直接给出：

```text
model + audit + report + workbook
```

因此 **本地步骤减少 3 个命令**，这是 v9 最确定的收益。

## 6. 人工复核结论

不是统计准确率，因为没有独立 ground truth。按人工复核：

| 项目 | 原版 | v9 | 判断 |
|---|---|---|---|
| 证据可追溯 | 中 | 高 | v9 更好 |
| 模型可复算 | 高 | 高 | 持平 |
| 叙述一致性 | 中 | 中高 | v9 略好 |
| 报告完整性 | 中 | 高 | v9 更好 |
| 本地依赖 | 高 | 低 | v9 更好 |
| 结论差异 | — | 很小 | 没有质变 |

## 7. 最终结论

**v9 是更好的“研究流水线”，不是更好的“选股器”。**

- 评分提升只有 +1；
- ORCL 模型值完全一致；
- NVDA 模型值差 2.4%，属于版本差异，不是准确性提升；
- AAPL 仍显示价格远高于 Base/Bull 值；
- v9 的真正收益是云端 audit/report、负值解释、证据隔离和本地步骤减少。

## 8. 下一步

1. 等旧版本完成 `sourceRef` 迁移后，重跑 v1/v3 同批数据；
2. 扩大到 10 个 ticker；
3. 加入独立人工标注，才能谈“准确率”；
4. 用 v9 作为默认研究引擎，但公开 Listing 仍等生产 Code 支持；
5. Retry 版本不进入默认产品，直到 Loop 成本确认。

> 研究辅助，不构成投资建议。

## 9. 公开 v3 与 v9 的边界

公开 Market 的 v3 Listing 不是这个 6-step 基线：

| 项目 | 公开 v3 | v9 |
|---|---|---|
| 输入 | 3 packets | tickerPacket + modelAssumptions + modelChoice + asOf |
| 云端步骤 | 4 路 review | 8 步，含 preflight/model/audit/report |
| 云端 model | 无 | 有 |
| 云端 audit | 无 | 有 |
| 云端 report | 无 | 有 |
| 本地后处理 | 必需 | 可选 |
| 当前可公开运行 | 是 | 否（生产 Code 未开通） |

因此：

- **公开 v3 无法用本报告的 model/evidence 指标对比**，它根本没有云端模型；
- 本报告中的“原版 6-step”是 v3 之后、v9 之前的中间基线；
- v9 相对公开 v3 是能力跃迁，相对 6-step 基线则主要是 audit/report 和本地依赖减少。

## 10. 补充：本地依赖到底少了多少

如果只看“跑完一只股票需要本地执行什么”，v9 的改善很大：

| 环节 | 原版 6-step | v9 | 本地依赖变化 |
|---|---|---|---|
| 输入 packet / assumptions | 本地 JSON | 本地 JSON，字段更多 | **略增** |
| 三表 + DCF | 云端 model | 云端 model | 持平 |
| 证据审计 | 本地 `merge-public-results` | 云端 `stp_audit1` | **移除** |
| 单行报告 | 本地 `render-report` | 云端 `stp_report` | **移除** |
| Workbook | 云端 artifact + 本地检查 | 云端 artifact | 生成移除，检查仍在本地 |
| 跨行排名 | 本地 merge/ranking | 无云端排名 | **仍在本地** |
| 结果落盘 | 本地文件 | artifact 下载 | 仍需本地文件 |
| 模板/版本维护 | 本地 JSON | 本地 JSON + sync | 仍需本地 |

### 结论

- **单行执行：v9 本地依赖显著减少。**
  - 不再需要本地 Python 跑模型；
  - 不再需要 `merge` 做证据审计；
  - 不再需要 `render-report` 生成报告；
  - 不再需要本地生成 workbook。
- **输入准备：没有减少，甚至更重。**
  - 需要 `tickerPacket`；
  - 需要显式 `modelAssumptions`；
  - 需要 `modelChoice` / `asOf`。
- **批量层：没有完全解决。**
  - v9 是 per-row audit/report；
  - 跨行排序、组合筛选、Top N 仍要本地或 Agent 做。
- **Workbook 结构校验：仍在本地。**
  - 云端 Code 不接受 xlsx artifact 输入；
  - `check-invariants` 仍是可选本地步骤。

所以更准确的说法是：

> **v9 把“单行的模型、审计、报告”从本地搬到了云端；但没有把“输入构造、批量排名、workbook 结构校验”搬走。**

如果按“本地文件依赖”单独打分，v9 明确优于原版；如果按“公开可运行产品”，v9 仍受生产 Code 未开通限制。两者不是一回事。
