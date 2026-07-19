# GESP 错题训练更新说明

网页题库与 Word 来源分开保存：网站只读取 `data/level-4/questions.json` 和 `data/level-4/answers.json`，Word 继续作为家长整理和归档文件。

## 新增或更新 Word 后

在工作区根目录执行：

```powershell
$py = "C:\Users\xiaolv\.cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe"
$tool = "D:\FPython_workspace\Fwebsite\_preview_gesp_wrong_book_20260719\tools\build_gesp_wrong_book.py"
& $py $tool extract --source-dir "D:\FPython_workspace\Fwebsite\gesp" --level 4 --review-dir "$env:TEMP\gesp4-review"
& $py $tool validate --questions "D:\FPython_workspace\Fwebsite\_preview_gesp_wrong_book_20260719\gesp\wrong-book\data\level-4\questions.json" --answers "D:\FPython_workspace\Fwebsite\_preview_gesp_wrong_book_20260719\gesp\wrong-book\data\level-4\answers.json"
```

`extract` 会按 Word 中图片出现的顺序提取截图、计算 SHA-256，并标记 `new`、`unchanged` 和待确认删除项。当前截图型 Word 没有可靠的本机中文代码 OCR，因此新增截图要人工转写和校对后，再更新两个 JSON 文件。

未来 5–8 级只需新增对应的 `data/level-N/` 目录和 `levels.json` 注册项，答题页逻辑不需要复制。
