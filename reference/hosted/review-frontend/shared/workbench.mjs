export function createWorkbench(config) {
  const REVIEW_STATUSES = Object.freeze({
    pending: '未审阅',
    keep: '保留',
    check: '待检查',
    skip: '暂不用'
  });
  function validReview(value) {
    return value && typeof value === 'object' && !Array.isArray(value) && typeof value.status === 'string' && Object.hasOwn(REVIEW_STATUSES, value.status) && (value.comment === undefined || typeof value.comment === 'string');
  }
  function sanitizeReviews(input, knownIds) {
    const result = Object.create(null);
    if (!input || typeof input !== 'object' || Array.isArray(input)) return result;
    for (const [id, r] of Object.entries(input)) {
      if (!knownIds.has(id) || ['__proto__', 'prototype', 'constructor'].includes(id) || !validReview(r)) continue;
      result[id] = {
        status: r.status,
        comment: (r.comment || '').slice(0, 10000),
        updatedAt: typeof r.updatedAt === 'string' ? r.updatedAt : null
      };
    }
    return result;
  }
  function parseReviewImport(text, knownIds, {
    allowLegacy = false
  } = {}) {
    const data = JSON.parse(text);
    if (!data || data.format !== config.importFormat || ![1, 2].includes(data.version) || !data.reviews || typeof data.reviews !== 'object' || Array.isArray(data.reviews)) throw Error(`不是支持的 ${config.label} 审阅文件`);
    if (!config.projectId || !config.datasetId) throw Error('当前项目缺少 projectId/datasetId，不能安全导入');
    if (data.version === 2) {
      if (data.projectId !== config.projectId || data.datasetId !== config.datasetId) throw Error('审阅备份项目或数据集身份不匹配');
    } else {
      if (data.projectId !== undefined && data.projectId !== config.projectId || data.datasetId !== undefined && data.datasetId !== config.datasetId) throw Error('旧版审阅备份声明的项目或数据集身份不匹配');
      if (!allowLegacy) {
        const error = Error('旧版 v1 备份没有完整身份保证；需确认来自当前项目及数据集后迁移');
        error.code = 'LEGACY_REVIEW_CONFIRMATION_REQUIRED';
        throw error;
      }
    }
    return {
      reviews: sanitizeReviews(data.reviews, knownIds),
      selected: (Array.isArray(data.selected) ? data.selected : []).filter(id => typeof id === 'string' && knownIds.has(id)),
      migratedLegacy: data.version === 1
    };
  }
  function countByType(items) {
    return items.reduce((out, a) => (out[a.type] = (out[a.type] || 0) + 1, out), Object.create(null));
  }
  function availableProfile(profile) {
    return profile && profile.implemented !== false && profile.available !== false && !['unavailable', 'not-implemented', 'unsupported', 'planned'].includes(profile.status) && ['material', 'clay', 'toon', 'source', 'unlit', 'lit', 'banded', 'cozy', 'hamster'].includes(profile.mode || profile.id);
  }
  const RENDER_PREFERENCE_KEY = config.renderPreferenceKey;
  function validDefaultProfile(value, profiles) {
    const fallback = profiles.find(profile => profile.id === config.defaultProfile && profile.implemented)?.id || profiles.find(profile => profile.implemented)?.id || 'material';
    return typeof value === 'string' && profiles.some(profile => profile.id === value && profile.implemented) ? value : fallback;
  }
  function readDefaultProfile(storage, profiles) {
    try {
      const raw = storage.getItem(RENDER_PREFERENCE_KEY),
        saved = config.profileStorageFormat === 'string' ? raw : JSON.parse(raw || 'null');
      return validDefaultProfile(config.profileStorageFormat === 'string' ? saved : saved?.version === 1 ? saved.profileId : null, profiles);
    } catch {
      return validDefaultProfile(null, profiles);
    }
  }
  function writeDefaultProfile(storage, value, profiles) {
    const profileId = validDefaultProfile(value, profiles);
    try {
      storage.setItem(RENDER_PREFERENCE_KEY, config.profileStorageFormat === 'string' ? profileId : JSON.stringify({
        version: 1,
        profileId
      }));
      return {
        profileId,
        saved: true
      };
    } catch {
      return {
        profileId,
        saved: false
      };
    }
  }
  const PAGE_SIZE = 20;
  function pageSlice(items, requestedPage = 1) {
    const total = items.length,
      totalPages = Math.ceil(total / PAGE_SIZE);
    const numeric = Number(requestedPage);
    const page = Math.min(Math.max(1, Number.isFinite(numeric) ? Math.floor(numeric) : 1), Math.max(1, totalPages));
    const start = total ? (page - 1) * PAGE_SIZE + 1 : 0,
      end = Math.min(page * PAGE_SIZE, total);
    return {
      items: items.slice(total ? start - 1 : 0, end),
      page,
      total,
      totalPages,
      start,
      end,
      hasPrevious: page > 1,
      hasNext: page < totalPages
    };
  }
  function paginationTokens(page, totalPages) {
    if (totalPages <= 7) return Array.from({
      length: Math.max(0, totalPages)
    }, (_, i) => i + 1);
    const pages = new Set([1, totalPages, page - 1, page, page + 1]);
    if (page <= 3) {
      pages.add(2);
      pages.add(3);
      pages.add(4);
    }
    if (page >= totalPages - 2) {
      pages.add(totalPages - 3);
      pages.add(totalPages - 2);
      pages.add(totalPages - 1);
    }
    const sorted = [...pages].filter(n => n >= 1 && n <= totalPages).sort((a, b) => a - b),
      result = [];
    for (const n of sorted) {
      if (result.length && n - result.at(-1) > 1) result.push('…');
      result.push(n);
    }
    return result;
  }
  return {
    REVIEW_STATUSES,
    validReview,
    sanitizeReviews,
    parseReviewImport,
    countByType,
    availableProfile,
    RENDER_PREFERENCE_KEY,
    validDefaultProfile,
    readDefaultProfile,
    writeDefaultProfile,
    PAGE_SIZE,
    pageSlice,
    paginationTokens
  };
}
export function createWorkbenchState() {
  return {
    view: "objects",
    type: "all",
    category: "all",
    query: "",
    review: "all",
    preview: "all",
    sort: "featured",
    bg: "light",
    page: 1
  };
}
