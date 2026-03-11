import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

/**
 * 将 API 返回的 tables 结构展平为行数组
 * tables: [{ thscode, table: { time: [], open: [], ... } }, ...]
 */
export function flattenTables(apiResponse) {
  if (!apiResponse.tables) return [];

  const rows = [];

  for (const item of apiResponse.tables) {
    const code = item.thscode;
    const table = item.table;
    if (!table) continue;

    // 找出所有列名和行数
    const keys = Object.keys(table);
    const len = table[keys[0]]?.length || 0;

    for (let i = 0; i < len; i++) {
      const row = { code };
      for (const key of keys) {
        row[key] = table[key]?.[i] ?? '';
      }
      rows.push(row);
    }
  }

  return rows;
}

/**
 * 导出 CSV
 */
export function exportCSV(rows, filepath) {
  if (rows.length === 0) {
    console.log('[export] 无数据可导出');
    return;
  }

  mkdirSync(dirname(filepath), { recursive: true });

  const headers = Object.keys(rows[0]);
  const lines = [headers.join(',')];

  for (const row of rows) {
    const values = headers.map(h => {
      const v = row[h];
      // 包含逗号或引号的值需要用引号包裹
      if (typeof v === 'string' && (v.includes(',') || v.includes('"') || v.includes('\n'))) {
        return `"${v.replace(/"/g, '""')}"`;
      }
      return v ?? '';
    });
    lines.push(values.join(','));
  }

  writeFileSync(filepath, lines.join('\n'), 'utf-8');
  console.log(`[export] CSV 已导出: ${filepath} (${rows.length} 行)`);
}

/**
 * 导出 JSON
 */
export function exportJSON(rows, filepath) {
  if (rows.length === 0) {
    console.log('[export] 无数据可导出');
    return;
  }

  mkdirSync(dirname(filepath), { recursive: true });
  writeFileSync(filepath, JSON.stringify(rows, null, 2), 'utf-8');
  console.log(`[export] JSON 已导出: ${filepath} (${rows.length} 行)`);
}
