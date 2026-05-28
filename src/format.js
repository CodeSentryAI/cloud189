function formatBytes(value) {
  const size = Number(value || 0);
  if (size < 1024) return `${size} B`;

  const units = ['KB', 'MB', 'GB', 'TB'];
  let current = size / 1024;
  let index = 0;
  while (current >= 1024 && index < units.length - 1) {
    current /= 1024;
    index += 1;
  }
  return `${current.toFixed(current >= 10 ? 1 : 2)} ${units[index]}`;
}

function table(rows, columns) {
  const widths = columns.map((column) => {
    return Math.max(
      column.header.length,
      ...rows.map((row) => String(row[column.key] ?? '').length)
    );
  });

  const render = (row) => {
    return columns
      .map((column, index) => String(row[column.key] ?? '').padEnd(widths[index]))
      .join('  ');
  };

  return [
    render(Object.fromEntries(columns.map((column) => [column.key, column.header]))),
    widths.map((width) => '-'.repeat(width)).join('  '),
    ...rows.map(render)
  ].join('\n');
}

function formatListing(response) {
  const folders = response.fileListAO.folderList.map((item) => ({
    type: 'dir',
    id: item.id,
    name: item.name,
    size: '',
    modified: item.lastOpTime || item.createDate || ''
  }));

  const files = response.fileListAO.fileList.map((item) => ({
    type: 'file',
    id: item.id,
    name: item.name,
    size: formatBytes(item.size),
    modified: item.lastOpTime || item.createDate || ''
  }));

  return table([...folders, ...files], [
    { key: 'type', header: 'TYPE' },
    { key: 'id', header: 'ID' },
    { key: 'name', header: 'NAME' },
    { key: 'size', header: 'SIZE' },
    { key: 'modified', header: 'MODIFIED' }
  ]);
}

function formatEntries(entries) {
  const rows = entries.map((item) => ({
    type: item.type,
    id: item.id,
    path: item.path || item.name,
    size: item.type === 'file' ? formatBytes(item.size) : '',
    modified: item.lastOpTime || item.createDate || ''
  }));

  return table(rows, [
    { key: 'type', header: 'TYPE' },
    { key: 'id', header: 'ID' },
    { key: 'path', header: 'PATH' },
    { key: 'size', header: 'SIZE' },
    { key: 'modified', header: 'MODIFIED' }
  ]);
}

module.exports = {
  formatBytes,
  formatEntries,
  formatListing,
  table
};
