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
