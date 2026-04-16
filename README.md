# 需求共创 (Requirement Co-creation)

PRD 需求分析与知识驱动的协作工具。

## 架构

- `requirement-cocreation.html` — 主体单文件 Web App
- `rc-server.js` — 本地代理服务器（免 API Key）

## 使用

**方式一（有 API Key）：** 直接浏览器打开 `requirement-cocreation.html`

**方式二（免 Key）：**
```bash
node rc-server.js
# 浏览器打开 http://localhost:3456
```

## 工作流

| Phase | 说明 |
|-------|------|
| 0 | 需求决策验证（OKR对齐 + 三问法 + 六不要 + 三看） |
| 1 | PRD 扫描（提取业务域/市场/实体） |
| 2 | 知识匹配（按内容匹配知识库条目） |
| 3 | 交叉检查 + Checklist |
| 4 | 输出与导出 |
