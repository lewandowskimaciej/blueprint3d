const fs = require('fs');
const path = require('path');

function walkDir(dir, callback) {
  fs.readdirSync(dir).forEach(f => {
    let dirPath = path.join(dir, f);
    let isDirectory = fs.statSync(dirPath).isDirectory();
    isDirectory ? walkDir(dirPath, callback) : callback(path.join(dir, f));
  });
}

walkDir('src', function(filePath) {
  if (filePath.endsWith('.ts')) {
    let content = fs.readFileSync(filePath, 'utf8');
    let original = content;
    content = content.replace(/import \* as \$ from ['"]jquery['"];/g, "import $ from 'jquery';");
    if (content !== original) {
      fs.writeFileSync(filePath, content, 'utf8');
    }
  }
});

let itemFile = 'src/items/item.ts';
if (fs.existsSync(itemFile)) {
  let itemCode = fs.readFileSync(itemFile, 'utf8');
  itemCode = itemCode.replace('public remove() {', 'public override remove(...objects: THREE.Object3D[]): this {\n    if (objects.length > 0) return super.remove(...objects);');
  fs.writeFileSync(itemFile, itemCode, 'utf8');
}

if (fs.existsSync('src/core/configuration.ts')) fs.unlinkSync('src/core/configuration.ts');
if (fs.existsSync('src/core/log.ts')) fs.unlinkSync('src/core/log.ts');
