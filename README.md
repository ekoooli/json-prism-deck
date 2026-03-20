# JSON Prism Deck

一个可直接加载到 Chrome 的 Manifest V3 JSON 格式化预览插件。

当前版本：`1.0.2`

更新记录见：[更新记录.md](/Users/rcc/Personal/json-extensions/更新记录.md)

## 功能

- 点击插件图标直接打开 `index.html` 工作台
- 编辑区支持行号、拖放导入、快捷键格式化/压缩
- 预览区支持树形 / 文本 / 元数据三种视图
- 树形预览支持单节点展开折叠、展开全部、折叠全部
- 预览树支持字段顺序切换：源顺序 / 字母升序 / 字母降序
- 预览区与错误态都使用虚拟滚动，避免大数据量卡顿
- 实时校验 JSON，非法时高亮错误行列并保留原文预览
- 支持下载当前 JSON、复制编辑区内容、复制节点路径、复制节点值
- 支持左右 / 上下布局切换、主题切换和状态持久化

## 加载方式

1. 打开 Chrome，进入 `chrome://extensions/`
2. 打开右上角“开发者模式”
3. 点击“加载已解压的扩展程序”
4. 选择当前目录 `/Users/rcc/Personal/json-extensions`
5. 加载完成后点击工具栏图标，即可打开 `chrome-extension://.../index.html`

## 快捷键

- `Ctrl/Cmd + Shift + F`：格式化
- `Ctrl/Cmd + Shift + M`：压缩
- `Ctrl/Cmd + S`：下载当前 JSON
