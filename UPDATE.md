# 更新方式（维护者）

本站由本地知识库生成，不在网页上直接编辑。

## 本地更新

1. 修改本地知识库（研报卡片/深读笔记/问题方案/复现结果）。
2. 运行：

```powershell
cd 参考文献知识库\08_可视化
python build_site_data.py
python build_public_site.py
```

3. 进入 `public_site/`，提交并推送：

```bash
git add -A
git commit -m "update knowledge base"
git push
```

GitHub Pages 会自动重新部署（约 1 分钟）。

## 一键脚本

本地已提供 `08_可视化/publish_github.ps1`，运行它会重建 `public_site/` 并推送。
