import { saveReviewState } from './selection-state.mjs';

// Keep migration consent separate from parsing and from mutable UI state.
export function importReviewBackup({
  text,
  knownIds,
  parse,
  config,
  confirmLegacy
}) {
  try {
    return parse(text, knownIds);
  } catch (error) {
    if (error.code !== 'LEGACY_REVIEW_CONFIRMATION_REQUIRED') throw error;
    if (!confirmLegacy(`旧版 v1 备份无法证明项目身份。仅当你确认文件属于当前项目 ${config.projectId} / 数据集 ${config.datasetId} 时继续；相同 ID 的现有审阅将被覆盖。是否迁移？`)) return null;
    return parse(text, knownIds, {
      allowLegacy: true
    });
  }
}

// Exact replacement is deliberately limited to one localStorage envelope.
// Web Storage setItem either succeeds as a whole or leaves the previous value.
export function canRestoreReviewSnapshot(config) {
  return config.sharedSelections === false && !config.selectionStorageKey;
}
export function restoreReviewSnapshot({text, knownIds, parse, config, storage, confirmReplace}) {
  if (!canRestoreReviewSnapshot(config)) throw Error('精确恢复仅支持单存储键的本地审阅，不支持共享选择或独立选择键');
  const snapshot = parse(text, knownIds, {exact: true});
  if (!confirmReplace(`精确恢复 ${config.projectId} / ${config.datasetId}：将替换全部现有审阅记录和选择，备份中没有的记录将被删除（空备份会清空）。没有自动撤销；若未导出备份，被替换内容无法恢复。请先导出当前完整备份以便回退。这不是模型备份，也不是跨标签页事务；请关闭其他同目录标签页。是否替换？`)) return null;
  if (!saveReviewState(storage, config, {...snapshot, legacySelected: []})) throw Error('浏览器保存失败，未替换当前审阅与选择');
  return snapshot;
}
