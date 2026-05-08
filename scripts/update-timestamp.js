// scripts/update-timestamp.js
// 作用：扫描 data.js，把 __META_START__ / __META_END__ 之间的元数据
//      自动更新为当前 UTC 时间 + 当天自增序号版本。
// 用法：node scripts/update-timestamp.js
const fs = require('fs');
const path = require('path');

const DATA_FILE = path.join(__dirname, '..', 'data.js');

if (!fs.existsSync(DATA_FILE)) {
    console.error('❌ 找不到 data.js:', DATA_FILE);
    process.exit(1);
}

let content = fs.readFileSync(DATA_FILE, 'utf8');

const now = new Date();
const isoTime = now.toISOString();          // 2026-05-08T10:23:45.678Z
const dateStr = isoTime.slice(0, 10);       // 2026-05-08

// 版本号：YYYY-MM-DD-NNN，同一天多次更新自动递增
const versionRegex = /version:\s*'(\d{4}-\d{2}-\d{2})-(\d+)'/;
const match = content.match(versionRegex);
let seq = 1;
if (match && match[1] === dateStr) {
    seq = parseInt(match[2], 10) + 1;
}
const newVersion = `${dateStr}-${String(seq).padStart(3, '0')}`;

const newMetaBlock =
`/* __META_START__ */
window.APP_DATA_META = {
    version:   '${newVersion}',
    updatedAt: '${isoTime}',
    source:    'github'
};
/* __META_END__ */`;

const metaRegex = /\/\* __META_START__ \*\/[\s\S]*?\/\* __META_END__ \*\//;

if (!metaRegex.test(content)) {
    console.error('❌ data.js 中找不到 __META_START__ / __META_END__ 标记');
    console.error('   请确保 data.js 顶部保留这两个注释标记');
    process.exit(1);
}

const newContent = content.replace(metaRegex, newMetaBlock);

// 如果没有任何变化，不写文件（避免无意义的 mtime 变化）
if (newContent === content) {
    console.log('ℹ️  data.js 元数据无需更新');
    process.exit(0);
}

fs.writeFileSync(DATA_FILE, newContent, 'utf8');
console.log(`✅ data.js 元数据已更新`);
console.log(`   version:   ${newVersion}`);
console.log(`   updatedAt: ${isoTime}`);